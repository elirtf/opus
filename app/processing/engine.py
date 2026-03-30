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

# Motion sampling: auto = sub when a sub URL/stream exists (lower CPU), else main; main = always main; sub = prefer sub, else main.
_MOTION_MODE_RAW = (os.environ.get("MOTION_RTSP_MODE") or "auto").strip().lower()
if _MOTION_MODE_RAW in ("main", "force_main"):
    MOTION_RTSP_MODE = "main"
elif _MOTION_MODE_RAW in ("sub", "substream"):
    MOTION_RTSP_MODE = "sub"
else:
    MOTION_RTSP_MODE = "auto"


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
            "Processing engine started (poll=%ss, clip=%ss, detector=%s, motion_rtsp_mode=%s)",
            POLL_SECONDS,
            CLIP_SECONDS,
            DETECTOR,
            MOTION_RTSP_MODE,
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

    def _main_rtsp(self, cam) -> str:
        """Record / clip source (always main)."""
        if GO2RTC_RTSP_URL:
            return "%s/%s" % (GO2RTC_RTSP_URL.rstrip("/"), cam.name)
        return cam.rtsp_url

    def _clip_rtsp(self, cam) -> str:
        return self._main_rtsp(cam)

    def _paired_sub_name(self, cam) -> str | None:
        if cam.name.endswith("-main"):
            return cam.name.replace("-main", "-sub", 1)
        return None

    def _resolve_sub_rtsp_url(self, cam) -> str | None:
        """
        Direct RTSP URL for the sub stream when not using go2rtc, or when we only have URLs in DB.
        """
        from app.models import Camera

        sub = (getattr(cam, "rtsp_substream_url", None) or "").strip()
        if sub:
            return sub
        sub_key = self._paired_sub_name(cam)
        if not sub_key:
            return None
        sub_row = Camera.get_or_none(Camera.name == sub_key)
        if not sub_row:
            return None
        return (sub_row.rtsp_url or "").strip() or None

    def _sub_stream_registered(self, cam) -> bool:
        """True if we should expect go2rtc to serve …-sub (virtual or NVR row)."""
        from app.models import Camera

        if (getattr(cam, "rtsp_substream_url", None) or "").strip():
            return True
        sk = self._paired_sub_name(cam)
        if sk and Camera.select().where(Camera.name == sk).exists():
            return True
        return False

    def _resolve_motion_sub_go2rtc(self, cam) -> str | None:
        """go2rtc RTSP URL for the sub stream, if configured."""
        if not GO2RTC_RTSP_URL or not self._sub_stream_registered(cam):
            return None
        sk = self._paired_sub_name(cam)
        if not sk:
            return None
        return "%s/%s" % (GO2RTC_RTSP_URL.rstrip("/"), sk)

    def _motion_rtsp(self, cam) -> str:
        """
        RTSP used only for OpenCV motion sampling.
        Default (auto): sub when paired / rtsp_substream_url / go2rtc sub exists — lighter decode.
        Clips still use _main_rtsp (full quality).
        """
        if MOTION_RTSP_MODE == "main":
            return self._main_rtsp(cam)

        sub_url = self._resolve_motion_sub_go2rtc(cam)
        if not sub_url and not GO2RTC_RTSP_URL:
            sub_url = self._resolve_sub_rtsp_url(cam)

        if MOTION_RTSP_MODE == "sub":
            if sub_url:
                return sub_url
            logger.warning(
                "MOTION_RTSP_MODE=sub but no sub stream for %s; using main",
                cam.name,
            )
            return self._main_rtsp(cam)

        # auto
        if sub_url:
            return sub_url
        return self._main_rtsp(cam)

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
            "motion_rtsp_mode": MOTION_RTSP_MODE,
        }


engine = None
