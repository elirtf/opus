"""
FFmpeg helpers for motion-triggered clip capture (segment tail, concat, RTSP grab).

Used by ProcessingEngine; keeps subprocess argument lists out of the engine loop.
"""

from __future__ import annotations

import logging
import os
import subprocess
import tempfile
import time as time_module

from app.ffmpeg_config import hwaccel_input_args, rtsp_input_queue_args

logger = logging.getLogger("opus.processing.clip_ffmpeg")


def concat_pre_enabled() -> bool:
    """When False, skip pre-roll concat (two MP4s muxed together can confuse some browsers)."""
    return os.environ.get("CLIP_CONCAT_PRE", "1").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )


def latest_stable_segment(recordings_dir: str, cam_name: str) -> str | None:
    """Most recent completed MP4 segment under recordings_dir/cam_name (for pre-roll tail)."""
    cam_dir = os.path.join(recordings_dir, cam_name)
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
    now = time_module.time()
    for p in paths:
        try:
            if now - os.path.getmtime(p) < 3.0:
                continue
            if os.path.getsize(p) > 10240:
                return p
        except OSError:
            continue
    return None


def ffmpeg_extract_tail(segment_path: str, pre_seconds: int, out_path: str) -> bool:
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


def ffmpeg_concat_copy(paths: list[str], out_path: str) -> bool:
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


def capture_rtsp_clip(src: str, out_path: str, duration_sec: int, *, camera_name: str) -> bool:
    """Record duration_sec of RTSP into out_path (-c:v copy)."""
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
        logger.warning("clip capture %s rc=%s %s", camera_name, r.returncode, err)
        return False
    try:
        return os.path.getsize(out_path) > 10240
    except OSError:
        return False
