"""
Processing engine: motion sampling for events_only cameras, clip capture via FFmpeg.
Runs in a dedicated process (see app.processing_service).
"""

from __future__ import annotations

import logging
import os
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

from app.config import get_recordings_dir
from app.processing import clip_ffmpeg
from app.processing import motion_rtsp as motion_rtsp_mod

logger = logging.getLogger("opus.processing")

GO2RTC_RTSP_URL = os.environ.get("GO2RTC_RTSP_URL", "")
GO2RTC_HTTP_URL = os.environ.get("GO2RTC_URL", "http://go2rtc:1984").strip().rstrip("/")
# Defaults only for startup log; runtime uses recording_settings + env via read_motion_clip_settings().
POLL_SECONDS = int(os.environ.get("PROCESSING_POLL_SECONDS", "6"))
CLIP_SECONDS = int(os.environ.get("CLIP_SECONDS", "45"))
MOTION_COOLDOWN_SECONDS = int(os.environ.get("MOTION_COOLDOWN_SECONDS", "75"))
DETECTOR = (os.environ.get("MOTION_DETECTOR") or "opencv").strip().lower()
try:
    MOTION_MAX_CONCURRENT = max(1, int(os.environ.get("MOTION_MAX_CONCURRENT", "4")))
except ValueError:
    MOTION_MAX_CONCURRENT = 4

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
        self.recordings_dir = get_recordings_dir()
        self._running = False
        self._thread = None
        self._last_clip_at = {}
        self._last_tick_ts = 0.0
        self._detector = self._make_detector()

    @staticmethod
    def _make_detector():
        from app.processing.detectors import (
            Mog2MotionDetector,
            OpenCvMotionDetector,
            StubDetector,
        )

        if DETECTOR in ("stub", "none", "off"):
            return StubDetector()
        if DETECTOR in ("opencv_mog2", "mog2"):
            return Mog2MotionDetector()
        return OpenCvMotionDetector()

    def start(self):
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True, name="processing")
        self._thread.start()
        logger.info(
            "Processing engine started (poll=%ss, clip=%ss, detector=%s, motion_rtsp_mode=%s, motion_max_concurrent=%s)",
            POLL_SECONDS,
            CLIP_SECONDS,
            DETECTOR,
            MOTION_RTSP_MODE,
            MOTION_MAX_CONCURRENT,
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
                    from app.processing.motion_settings import read_motion_clip_settings

                    poll = read_motion_clip_settings().poll_seconds
                    self._tick()
            except Exception:
                logger.exception("processing tick failed")
                poll = POLL_SECONDS
            time.sleep(poll)

    def _tick(self):
        from app.models import Camera
        from app.routes.api.recording_settings import get_setting

        ts = time.time()
        self._last_tick_ts = ts

        if get_setting("setup_complete", "false") != "true":
            return

        from app.processing.motion_settings import read_motion_clip_settings

        cooldown_s = read_motion_clip_settings().cooldown_seconds

        qs = list(
            Camera.select().where(
                (Camera.active == True)
                & (Camera.recording_enabled == True)
                & (Camera.recording_policy == "events_only")
            )
        )
        cams = [c for c in qs if c.name.endswith("-main")]
        now = time.time()
        eligible = [
            c
            for c in cams
            if now - self._last_clip_at.get(c.name, 0) >= cooldown_s
        ]
        if not eligible:
            return

        health: dict[str, bool] | None = None
        if GO2RTC_RTSP_URL:
            from app.services.camera_stream_health import fetch_stream_online_map

            health = fetch_stream_online_map(GO2RTC_HTTP_URL, timeout=2.0)

        prepped: list[tuple] = []
        for cam in eligible:
            src_motion = motion_rtsp_mod.motion_rtsp(cam, GO2RTC_RTSP_URL, MOTION_RTSP_MODE)
            has_prod = motion_rtsp_mod.motion_stream_has_go2rtc_producers(
                src_motion, health, GO2RTC_RTSP_URL
            )
            if has_prod is False:
                logger.debug(
                    "skip motion OpenCV probe for %s (go2rtc stream offline or not published: %s)",
                    cam.name,
                    motion_rtsp_mod.go2rtc_stream_key_from_motion_rtsp(src_motion, GO2RTC_RTSP_URL),
                )
                continue
            prepped.append((cam, src_motion))

        if not prepped:
            return

        def run_motion(item):
            cam, src_motion = item
            try:
                return cam, self._detector.detect_motion(src_motion, stream_key=cam.name)
            except Exception:
                logger.exception("detector failed: %s", cam.name)
                return cam, False

        workers = min(MOTION_MAX_CONCURRENT, len(prepped))
        fired = []
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(run_motion, item): item[0] for item in prepped}
            for fut in as_completed(futures):
                cam, motion = fut.result()
                if motion:
                    fired.append(cam)

        for cam in fired:
            logger.info("Motion: %s — capturing clip", cam.name)
            ev = self._write_clip(cam)
            if ev:
                self._last_clip_at[cam.name] = now

    def _write_clip(self, cam):
        from app.models import RecordingEvent
        from app.processing.motion_settings import read_motion_clip_settings

        ms = read_motion_clip_settings()
        core = ms.clip_seconds
        pre = ms.pre_seconds
        post = ms.post_seconds
        capture_sec = core + post
        approx_duration = pre + capture_sec

        clips_dir = os.path.join(self.recordings_dir, "clips", cam.name)
        os.makedirs(clips_dir, exist_ok=True)
        fn = "%s_%s.mp4" % (
            datetime.now().strftime("%Y-%m-%d_%H-%M-%S"),
            uuid.uuid4().hex[:8],
        )
        fp = os.path.join(clips_dir, fn)
        src = motion_rtsp_mod.main_rtsp(cam, GO2RTC_RTSP_URL)

        tmp_main = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False, dir=clips_dir)
        tmp_main.close()
        tmp_pre_path = None
        concat_pre = clip_ffmpeg.concat_pre_enabled()
        try:
            if not clip_ffmpeg.capture_rtsp_clip(
                src, tmp_main.name, capture_sec, camera_name=cam.name
            ):
                return None

            if pre > 0 and concat_pre:
                seg = clip_ffmpeg.latest_stable_segment(self.recordings_dir, cam.name)
                if seg:
                    tmp_pre = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False, dir=clips_dir)
                    tmp_pre.close()
                    tmp_pre_path = tmp_pre.name
                    if clip_ffmpeg.ffmpeg_extract_tail(seg, pre, tmp_pre_path):
                        if clip_ffmpeg.ffmpeg_concat_copy([tmp_pre_path, tmp_main.name], fp):
                            pass
                        else:
                            logger.warning(
                                "concat pre+main failed for %s — saving core clip only",
                                cam.name,
                            )
                            os.replace(tmp_main.name, fp)
                    else:
                        logger.info(
                            "pre-roll extract skipped for %s (segment too short or unreadable)",
                            cam.name,
                        )
                        os.replace(tmp_main.name, fp)
                else:
                    logger.debug(
                        "no segment file for pre-roll on %s — enable rolling segments or continuous",
                        cam.name,
                    )
                    os.replace(tmp_main.name, fp)
            else:
                if pre > 0 and not concat_pre:
                    logger.debug(
                        "CLIP_CONCAT_PRE disabled — skipping pre-roll concat for %s",
                        cam.name,
                    )
                os.replace(tmp_main.name, fp)
        finally:
            for p in (tmp_main.name, tmp_pre_path):
                if p and os.path.exists(p):
                    try:
                        os.remove(p)
                    except OSError:
                        pass

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
            duration_seconds=approx_duration,
            reason="motion",
            recording_id=None,
            status="complete",
        )
        return True

    def get_status(self):
        from app.processing.motion_settings import read_motion_clip_settings

        ms = read_motion_clip_settings()
        return {
            "engine_running": self._running,
            "detector": DETECTOR,
            "poll_seconds": ms.poll_seconds,
            "clip_seconds": ms.clip_seconds,
            "clip_pre_seconds": ms.pre_seconds,
            "clip_post_seconds": ms.post_seconds,
            "cooldown_seconds": ms.cooldown_seconds,
            "motion_rtsp_mode": MOTION_RTSP_MODE,
            "motion_max_concurrent": MOTION_MAX_CONCURRENT,
            "last_tick_unix": self._last_tick_ts,
        }


engine = None
