"""
RTSP URL selection for motion sampling (main vs sub, direct vs go2rtc relay).

Separated from ProcessingEngine so the tick loop only orchestrates: resolve URL →
detect → clip. Camera DB lookups stay here; go2rtc health maps are passed in.
"""

from __future__ import annotations

import logging

from app.go2rtc import go2rtc_rtsp_source, go2rtc_stream_name_from_rtsp

logger = logging.getLogger("opus.processing.motion_rtsp")


def paired_sub_name(cam_name: str) -> str | None:
    if cam_name.endswith("-main"):
        return cam_name.replace("-main", "-sub", 1)
    return None


def resolve_sub_rtsp_url(cam) -> str | None:
    """Direct RTSP URL for the sub stream when not using go2rtc, or when only URLs exist in DB."""
    from app.models import Camera

    sub = (getattr(cam, "rtsp_substream_url", None) or "").strip()
    if sub:
        return sub
    sub_key = paired_sub_name(cam.name)
    if not sub_key:
        return None
    sub_row = Camera.get_or_none(Camera.name == sub_key)
    if not sub_row:
        return None
    return (sub_row.rtsp_url or "").strip() or None


def sub_stream_registered(cam) -> bool:
    """True if we should expect go2rtc to serve …-sub (virtual or NVR row)."""
    from app.models import Camera

    if (getattr(cam, "rtsp_substream_url", None) or "").strip():
        return True
    sk = paired_sub_name(cam.name)
    if sk and Camera.select().where(Camera.name == sk).exists():
        return True
    return False


def resolve_motion_sub_go2rtc(cam, go2rtc_rtsp_url: str) -> str | None:
    """go2rtc RTSP URL for the sub stream, if configured."""
    if not go2rtc_rtsp_url or not sub_stream_registered(cam):
        return None
    sk = paired_sub_name(cam.name)
    if not sk:
        return None
    return go2rtc_rtsp_source(go2rtc_rtsp_url, sk)


def main_rtsp(cam, go2rtc_rtsp_url: str) -> str:
    """Record / clip source (always main stream key or direct URL)."""
    if go2rtc_rtsp_url:
        return go2rtc_rtsp_source(go2rtc_rtsp_url, cam.name)
    return cam.rtsp_url


def motion_rtsp(cam, go2rtc_rtsp_url: str, motion_rtsp_mode: str) -> str:
    """
    RTSP used only for OpenCV motion sampling.
    Default (auto): sub when paired / rtsp_substream_url / go2rtc sub exists.
    Clips still use main_rtsp (full quality).
    """
    if motion_rtsp_mode == "main":
        return main_rtsp(cam, go2rtc_rtsp_url)

    sub_url = resolve_motion_sub_go2rtc(cam, go2rtc_rtsp_url)
    if not sub_url and not go2rtc_rtsp_url:
        sub_url = resolve_sub_rtsp_url(cam)

    if motion_rtsp_mode == "sub":
        if sub_url:
            return sub_url
        logger.warning(
            "MOTION_RTSP_MODE=sub but no sub stream for %s; using main",
            cam.name,
        )
        return main_rtsp(cam, go2rtc_rtsp_url)

    if sub_url:
        return sub_url
    return main_rtsp(cam, go2rtc_rtsp_url)


def go2rtc_stream_key_from_motion_rtsp(motion_rtsp: str, go2rtc_rtsp_url: str) -> str | None:
    """Last path segment of rtsp://go2rtc:8554/<key> when using the go2rtc relay.

    Percent-decoded so it can be matched against go2rtc's /api/streams map,
    whose keys are the raw stream names (with spaces, etc.) as registered.
    """
    return go2rtc_stream_name_from_rtsp(motion_rtsp, go2rtc_rtsp_url)


def motion_stream_has_go2rtc_producers(
    motion_rtsp: str,
    health: dict[str, bool] | None,
    go2rtc_rtsp_url: str,
) -> bool | None:
    """
    None = cannot decide (no relay, go2rtc unreachable, or direct camera RTSP).
    True = go2rtc lists the stream with active producers.
    False = missing from /api/streams or no producers.
    """
    if health is None:
        return None
    key = go2rtc_stream_key_from_motion_rtsp(motion_rtsp, go2rtc_rtsp_url)
    if not key:
        return None
    return bool(health.get(key))
