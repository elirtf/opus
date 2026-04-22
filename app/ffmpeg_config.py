"""
Shared FFmpeg hardware acceleration flags for recorder and processing services.
Set FFMPEG_HWACCEL to none (default), cuda, qsv, vaapi, videotoolbox, dxva2, d3d11va.
Optional FFMPEG_HWACCEL_DEVICE for multi-GPU (e.g. 0).

Recording typically uses stream copy, so H.265 is preserved in MP4; browser live view
may need an H.264 sub stream or per-camera transcoding — see go2rtc/README-HEVC.md.
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


def rtsp_input_queue_args():
    """
    Optional larger thread message queue before -i — eases bursty RTSP when many writers run.
    Set FFMPEG_RTSP_THREAD_QUEUE_SIZE (e.g. 512 or 1024); unset = FFmpeg default.
    """
    raw = (os.environ.get("FFMPEG_RTSP_THREAD_QUEUE_SIZE") or "").strip()
    if raw.isdigit() and int(raw) > 0:
        return ["-thread_queue_size", raw]
    return []


def _ffmpeg_hwaccel_effective() -> str:
    """Normalized env value: none when disabled."""
    if FFMPEG_HWACCEL in ("", "none", "off", "false", "0"):
        return "none"
    return FFMPEG_HWACCEL


def _paths_that_decode_frames():
    """
    Where FFmpeg/OpenCV actually decode pixels. Recording uses stream copy unless changed.
    MOTION_DETECTOR is set on the processor service; unset in a typical recorder-only process.
    """
    raw = os.environ.get("MOTION_DETECTOR")
    if raw is None:
        return (
            [],
            "Motion decoding runs in the processor service; set MOTION_DETECTOR there.",
        )
    det = raw.strip().lower()
    if det in ("stub", "none", "off"):
        return ([], "MOTION_DETECTOR is off or stub — no frame decode for motion.")
    if det in ("opencv", "diff"):
        return (["motion_detection_opencv"], None)
    if det in ("opencv_mog2", "mog2"):
        return (["motion_detection_opencv_mog2"], None)
    return (["motion_detection_%s" % det], None)


def get_video_pipeline_summary():
    """
    Single JSON-friendly description of how Opus uses FFmpeg (copy vs decode, hwaccel scope).
    Safe to log and expose on status/diagnostics endpoints.
    """
    paths, paths_note = _paths_that_decode_frames()
    hw = _ffmpeg_hwaccel_effective()
    out = {
        "recording_video_mode": "stream_copy",
        "decoder_used_for_recording": False,
        "recording_note": (
            "Segments and clips use -c:v copy; the camera bitstream is remuxed to MP4 without re-encoding."
        ),
        "ffmpeg_hwaccel_env": hw,
        "ffmpeg_hwaccel_device": FFMPEG_HWACCEL_DEVICE or None,
        "hwaccel_expected_impact_on_recording": "minimal",
        "hwaccel_note": (
            "FFMPEG_HWACCEL applies when FFmpeg decodes frames; stream copy does not decode for output."
        ),
        "paths_that_decode_frames": paths,
    }
    if paths_note:
        out["paths_that_decode_frames_note"] = paths_note
    return out
