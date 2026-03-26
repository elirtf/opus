"""
Processing engine: motion sampling for events_only cameras, clip capture via FFmpeg.
Runs in a dedicated process (see app.processing_service).
"""

from __future__ import annotations

import logging
import os
import subprocess
import threading
import time
import uuid
from datetime import datetime

logger = logging.getLogger("opus.processing")

GO2RTC_RTSP_URL = os.environ.get("GO2RTC_RTSP_URL", "")
POLL_SECONDS = int(os.environ.get("PROCESSING_POLL_SECONDS", "6"))
CLIP_SECONDS = int(os.environ.get("CLIP_SECONDS", "45"))
MOTION_COOLDOWN_SECONDS = int(os.environ.get("MOTION_COOLDOWN_SECONDS", "75"))
DETECTOR = (os.environ.get("MOTION_DETECTOR") or "opencv").strip().lower()


class ProcessingEngine:
    def __init__(self, app):
        self.app = app
        self.recordings_dir = app.config.get("RECORDINGS_DIR", "/recordings")
        self._running = False
        self._thread = None
        self._last_clip_at = {}
        self._detector = self._make_detector()

    @staticmethod
    def _make_detector():
        from app.processing.detectors import OpenCvMotionDetector, StubDetector

        if DETECTOR in ("stub", "none", "off"):
            return StubDetector()
        return OpenCvMotionDetector()

    def start(self):
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True, name="processing")
        self._thread.start()
        logger.info(
            "Processing engine started (poll=%ss, clip=%ss, detector=%s)",
            POLL_SECONDS,
            CLIP_SECONDS,
            DETECTOR,
        )

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=15)

    def _loop(self):
        time.sleep(2)
        while self._running:
            try:
                with self.app.app_context():
                    self._tick()
            except Exception:
                logger.exception("processing tick failed")
            time.sleep(POLL_SECONDS)

    def _motion_rtsp(self, cam) -> str:
        """
        Motion detection uses the same source as recording (main stream / go2rtc main name).
        Live view may use a substream via go2rtc; analysis stays on the main channel for accuracy.
        """
        if GO2RTC_RTSP_URL:
            return "%s/%s" % (GO2RTC_RTSP_URL.rstrip("/"), cam.name)
        return cam.rtsp_url

    def _clip_rtsp(self, cam) -> str:
        if GO2RTC_RTSP_URL:
            return "%s/%s" % (GO2RTC_RTSP_URL.rstrip("/"), cam.name)
        return cam.rtsp_url

    def _tick(self):
        from app.models import Camera
        from app.routes.api.recording_settings import get_setting

        if get_setting("setup_complete", "false") != "true":
            return

        qs = list(
            Camera.select().where(
                (Camera.active == True)
                & (Camera.recording_enabled == True)
                & (Camera.recording_policy == "events_only")
            )
        )
        cams = [c for c in qs if c.name.endswith("-main")]
        now = time.time()
        for cam in cams:
            last = self._last_clip_at.get(cam.name, 0)
            if now - last < MOTION_COOLDOWN_SECONDS:
                continue
            src_motion = self._motion_rtsp(cam)
            try:
                motion = self._detector.detect_motion(src_motion)
            except Exception:
                logger.exception("detector failed: %s", cam.name)
                continue
            if not motion:
                continue
            logger.info("Motion: %s — capturing clip", cam.name)
            ev = self._write_clip(cam)
            if ev:
                self._last_clip_at[cam.name] = now

    def _write_clip(self, cam):
        from app.ffmpeg_config import hwaccel_input_args
        from app.models import RecordingEvent

        clips_dir = os.path.join(self.recordings_dir, "clips", cam.name)
        os.makedirs(clips_dir, exist_ok=True)
        fn = "%s_%s.mp4" % (
            datetime.now().strftime("%Y-%m-%d_%H-%M-%S"),
            uuid.uuid4().hex[:8],
        )
        fp = os.path.join(clips_dir, fn)
        src = self._clip_rtsp(cam)
        cmd = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            *hwaccel_input_args(),
            "-avoid_negative_ts",
            "make_zero",
            "-fflags",
            "+genpts+discardcorrupt",
            "-rtsp_transport",
            "tcp",
            "-timeout",
            "10000000",
            "-use_wallclock_as_timestamps",
            "1",
            "-i",
            src,
            "-t",
            str(CLIP_SECONDS),
            "-c:v",
            "copy",
            "-an",
            "-y",
            fp,
        ]
        try:
            r = subprocess.run(cmd, capture_output=True, timeout=CLIP_SECONDS + 60)
        except subprocess.TimeoutExpired:
            logger.warning("clip ffmpeg timeout: %s", cam.name)
            return None
        except Exception:
            logger.exception("clip ffmpeg failed: %s", cam.name)
            return None
        if r.returncode != 0:
            err = (r.stderr or b"").decode(errors="replace")[-200:]
            logger.warning("clip ffmpeg rc=%s %s", r.returncode, err)
            return None
        try:
            sz = os.path.getsize(fp)
        except OSError:
            return None
        if sz < 10240:
            try:
                os.remove(fp)
            except OSError:
                pass
            return None
        started = datetime.now()
        RecordingEvent.create(
            camera=cam.id,
            camera_name=cam.name,
            filename=fn,
            file_path=fp,
            file_size=sz,
            started_at=started,
            ended_at=None,
            duration_seconds=CLIP_SECONDS,
            reason="motion",
            recording_id=None,
            status="complete",
        )
        return True

    def get_status(self):
        return {
            "engine_running": self._running,
            "detector": DETECTOR,
            "poll_seconds": POLL_SECONDS,
            "clip_seconds": CLIP_SECONDS,
            "cooldown_seconds": MOTION_COOLDOWN_SECONDS,
        }


engine = None
