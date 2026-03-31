"""
go2rtc stream sync helpers.

go2rtc supports multiple sources per stream — use this to add a record:
output alongside the RTSP source when recording is enabled.

Stream registration:
  PUT /api/streams?name=X&src=rtsp://...
  PUT /api/streams?name=X&src=record:///recordings/X/2024-01-01_12-00-00.mp4

Deletion:
  DELETE /api/streams?name=X
"""
import os
import requests as http
import logging

from app.config import get_recordings_dir

logger = logging.getLogger(__name__)


def _go2rtc_url():
    from flask import current_app
    return current_app.config["GO2RTC_URL"]


def record_path(camera_name: str) -> str:
    """
    go2rtc record: path pattern.
    {dt} is replaced by go2rtc with the segment start datetime.
    Creates one file per hour by default.
    """
    cam_dir = os.path.join(get_recordings_dir(), camera_name)
    return f"record://{cam_dir}/{{dt}}.mp4"


def stream_sync(camera) -> bool:
    """
    Register (or re-register) a camera's streams in go2rtc.
    Called on create, edit, or recording toggle.
    Returns True on success.
    """
    from app.models import Camera

    base_url = _go2rtc_url()
    name = camera.name

    try:
        # Always register the RTSP source
        http.put(
            f"{base_url}/api/streams",
            params={"name": name, "src": camera.rtsp_url},
            timeout=3,
        )

        # Add or remove record: output based on flag
        if camera.recording_enabled:
            os.makedirs(os.path.join(get_recordings_dir(), name), exist_ok=True)
            http.put(
                f"{base_url}/api/streams",
                params={"name": name, "src": record_path(name)},
                timeout=3,
            )

        # Live UI plays "{name-main}-sub" in go2rtc for dashboard / camera page (see LivePlayer).
        # NVR import creates a real Camera row per sub stream; standalone cameras use
        # rtsp_substream_url on the *-main row — register that URL under the paired -sub name.
        if name.endswith("-main"):
            sub_name = name[: -len("-main")] + "-sub"
            sub_row = Camera.get_or_none(Camera.name == sub_name)
            sub_url = (getattr(camera, "rtsp_substream_url", None) or "").strip()
            if sub_row:
                pass
            elif sub_url:
                http.put(
                    f"{base_url}/api/streams",
                    params={"name": sub_name, "src": sub_url},
                    timeout=3,
                )
            else:
                stream_delete(sub_name)

        return True
    except Exception as e:
        logger.warning(f"go2rtc stream_sync failed for {name}: {e}")
        return False


def stream_delete(name: str) -> bool:
    """Remove a stream entirely from go2rtc."""
    try:
        http.delete(
            f"{_go2rtc_url()}/api/streams",
            params={"name": name},
            timeout=3,
        )
        return True
    except Exception as e:
        logger.warning(f"go2rtc stream_delete failed for {name}: {e}")
        return False


def sync_all_on_startup():
    """
    Called at app startup to ensure go2rtc has all streams registered,
    including record: outputs for cameras with recording enabled.
    go2rtc loses its dynamic streams on restart, so this re-registers them.
    """
    from app.models import Camera
    cameras = Camera.select().where(Camera.active == True)
    for cam in cameras:
        stream_sync(cam)
    logger.info(f"go2rtc startup sync complete — {len(list(cameras))} cameras registered.")