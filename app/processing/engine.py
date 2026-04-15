"""
Processing engine: motion sampling for events_only cameras, clip capture via FFmpeg.
Runs in a dedicated process (see app.processing_service).
"""

from __future__ import annotations

import logging
import os
import subprocess
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

from app.config import get_recordings_dir

logger = logging.getLogger("opus.processing")

# Set to 0/false to skip pre-roll concat (two MP4s muxed together can confuse some browsers).
CLIP_CONCAT_PRE = os.environ.get("CLIP_CONCAT_PRE", "1").strip().lower() in (
    "1",
    "true",
    "yes",
    "on",
)

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

    def _go2rtc_stream_key_from_motion_rtsp(self, motion_rtsp: str) -> str | None:
        """Last path segment of rtsp://go2rtc:8554/<key> when using the go2rtc relay."""
        if not GO2RTC_RTSP_URL:
            return None
        base = GO2RTC_RTSP_URL.rstrip("/")
        if not motion_rtsp.startswith(base + "/") and motion_rtsp != base:
            return None
        return motion_rtsp[len(base) :].lstrip("/") or None

    def _motion_stream_has_go2rtc_producers(
        self, motion_rtsp: str, health: dict[str, bool] | None
    ) -> bool | None:
        """
        None = cannot decide (no relay, go2rtc unreachable, or direct camera RTSP) — still probe with OpenCV.
        True = go2rtc lists the stream with active producers.
        False = missing from /api/streams or no producers (OpenCV would usually hit RTSP DESCRIBE 404 / hang).
        """
        if health is None:
            return None
        key = self._go2rtc_stream_key_from_motion_rtsp(motion_rtsp)
        if not key:
            return None
        return bool(health.get(key))

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
            src_motion = self._motion_rtsp(cam)
            has_prod = self._motion_stream_has_go2rtc_producers(src_motion, health)
            if has_prod is False:
                logger.debug(
                    "skip motion OpenCV probe for %s (go2rtc stream offline or not published: %s)",
                    cam.name,
                    self._go2rtc_stream_key_from_motion_rtsp(src_motion),
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

    def _latest_stable_segment(self, cam_name: str) -> str | None:
        """Most recent completed MP4 segment under recordings_dir/cam_name (for pre-roll tail)."""
        cam_dir = os.path.join(self.recordings_dir, cam_name)
        if not os.path.isdir(cam_dir):
            return None
        try:
            names = [f for f in os.listdir(cam_dir) if f.endswith(".mp4")]
        except OSError:
            return None
        if not names:
            return None
        paths = [os.path.join(cam_dir, n) for n in names]
        paths.sort(key=lambda p: os.path.getmtime(p), reverse=True)
        now = time.time()
        for p in paths:
            try:
                if now - os.path.getmtime(p) < 3.0:
                    continue
                if os.path.getsize(p) > 10240:
                    return p
            except OSError:
                continue
        return None

    @staticmethod
    def _ffmpeg_extract_tail(segment_path: str, pre_seconds: int, out_path: str) -> bool:
        """Last N seconds of a seekable MP4 (segment file from recorder)."""
        cmd = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-sseof",
            "-%d" % pre_seconds,
            "-i",
            segment_path,
            "-c",
            "copy",
            "-movflags",
            "+faststart",
            out_path,
        ]
        try:
            r = subprocess.run(cmd, capture_output=True, timeout=pre_seconds + 45)
        except (subprocess.TimeoutExpired, OSError):
            return False
        return r.returncode == 0 and os.path.exists(out_path) and os.path.getsize(out_path) > 1024

    @staticmethod
    def _ffmpeg_concat_copy(paths: list[str], out_path: str) -> bool:
        fd, list_path = tempfile.mkstemp(suffix=".txt", text=True)
        try:
            with os.fdopen(fd, "w") as f:
                for p in paths:
                    ap = os.path.abspath(p).replace("\\", "/")
                    ap = ap.replace("'", "'\\''")
                    f.write("file '%s'\n" % ap)
            cmd = [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                list_path,
                "-c",
                "copy",
                "-movflags",
                "+faststart",
                out_path,
            ]
            r = subprocess.run(cmd, capture_output=True, timeout=600)
            return r.returncode == 0
        except (OSError, subprocess.TimeoutExpired):
            return False
        finally:
            try:
                os.remove(list_path)
            except OSError:
                pass

    def _capture_rtsp_clip(self, cam, src: str, out_path: str, duration_sec: int) -> bool:
        from app.ffmpeg_config import hwaccel_input_args, rtsp_input_queue_args

        cmd = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            *hwaccel_input_args(),
            *rtsp_input_queue_args(),
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
            str(duration_sec),
            "-c:v",
            "copy",
            "-an",
            "-movflags",
            "+faststart",
            "-y",
            out_path,
        ]
        try:
            r = subprocess.run(cmd, capture_output=True, timeout=duration_sec + 90)
        except (subprocess.TimeoutExpired, OSError):
            return False
        if r.returncode != 0:
            err = (r.stderr or b"").decode(errors="replace")[-200:]
            logger.warning("clip capture rc=%s %s", r.returncode, err)
            return False
        try:
            return os.path.getsize(out_path) > 10240
        except OSError:
            return False

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
        src = self._clip_rtsp(cam)

        tmp_main = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False, dir=clips_dir)
        tmp_main.close()
        tmp_pre_path = None
        try:
            if not self._capture_rtsp_clip(cam, src, tmp_main.name, capture_sec):
                return None

            if pre > 0 and CLIP_CONCAT_PRE:
                seg = self._latest_stable_segment(cam.name)
                if seg:
                    tmp_pre = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False, dir=clips_dir)
                    tmp_pre.close()
                    tmp_pre_path = tmp_pre.name
                    if self._ffmpeg_extract_tail(seg, pre, tmp_pre_path):
                        if self._ffmpeg_concat_copy([tmp_pre_path, tmp_main.name], fp):
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
                if pre > 0 and not CLIP_CONCAT_PRE:
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
