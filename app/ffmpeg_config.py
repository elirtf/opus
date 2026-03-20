"""
Shared FFmpeg hardware acceleration flags for recorder and processing services.
Set FFMPEG_HWACCEL to none (default), cuda, qsv, vaapi, videotoolbox, dxva2, d3d11va.
Optional FFMPEG_HWACCEL_DEVICE for multi-GPU (e.g. 0).
"""

import os

FFMPEG_HWACCEL = (os.environ.get("FFMPEG_HWACCEL") or "none").strip().lower()
FFMPEG_HWACCEL_DEVICE = (os.environ.get("FFMPEG_HWACCEL_DEVICE") or "").strip()


def hwaccel_input_args():
    """Insert after `ffmpeg` and before per-input options like -rtsp_transport."""
    if FFMPEG_HWACCEL in ("", "none", "off", "false", "0"):
        return []
    args = ["-hwaccel", FFMPEG_HWACCEL]
    if FFMPEG_HWACCEL_DEVICE:
        args.extend(["-hwaccel_device", FFMPEG_HWACCEL_DEVICE])
    return args
