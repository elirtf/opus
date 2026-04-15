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
ENABLE_GO2RTC_RECORD_SOURCE = os.environ.get("GO2RTC_ENABLE_RECORD_SOURCE", "").strip().lower() in (
    "1",
    "true",
    "yes",
    "on",
)


def _env_bool(name: str, default: bool) -> bool:
    raw = (os.environ.get(name) or "").strip().lower()
    if raw == "":
        return default
    return raw in ("1", "true", "yes", "on")


def _transcode_default() -> bool:
    # Match go2rtc_config.py — see comment there (MSE + ffmpeg:/exec: in go2rtc 1.9+).
    return _env_bool("GO2RTC_TRANSCODE_DEFAULT", False)


def _camera_transcode_value(camera, default: bool) -> bool:
    val = getattr(camera, "transcode", None)
    if val is None:
        return default
    return bool(val)


def _transcode_source(rtsp_url: str, should_transcode: bool) -> str:
    if not should_transcode:
        return rtsp_url
    return f"ffmpeg:{rtsp_url}#video=h264"


def _put_stream_ok(base_url: str, name: str, src: str, what: str) -> bool:
    """
    Register one source on a go2rtc stream (API), idempotent vs go2rtc.yaml.

    Newer go2rtc returns 400 on PUT when the stream already exists (e.g. loaded from
    go2rtc.yaml written by Opus). In that case PATCH adds/updates the source instead.
    """
    base = (base_url or "").strip().rstrip("/")
    url = f"{base}/api/streams"
    try:
        r = http.put(url, params={"name": name, "src": src}, timeout=8)
        if r.ok:
            return True
        if r.status_code == 400:
            rp = http.patch(url, params={"name": name, "src": src}, timeout=8)
            if rp.ok:
                return True
            logger.warning(
                "go2rtc PUT/PATCH %s failed for stream %s: PUT %s %s | PATCH %s %s",
                what,
                name,
                r.status_code,
                (r.text or "")[:200],
                rp.status_code,
                (rp.text or "")[:200],
            )
            return False
        r.raise_for_status()
        return True
    except Exception as e:
        logger.warning("go2rtc PUT %s failed for stream %s: %s", what, name, e)
        return False


def is_restricted_source(url: str) -> bool:
    """echo:, expr:, and exec: sources can execute arbitrary commands if the API is abused."""
    s = (url or "").strip()
    return s.startswith(("echo:", "expr:", "exec:"))


def register_stream_src(base_url: str, name: str, src: str, what: str = "api") -> bool:
    """PUT/PATCH a stream source (idempotent). Call from blueprints with current_app.config['GO2RTC_URL']."""
    return _put_stream_ok(base_url, name, src, what)


def validate_stream_url_for_go2rtc(url: str) -> str | None:
    """
    Returns an error message if the URL must be rejected, or None if allowed.
    """
    if not (url or "").strip():
        return "Stream URL is required."
    from app.go2rtc_settings import allow_arbitrary_exec_sources

    if allow_arbitrary_exec_sources():
        return None
    if is_restricted_source(url):
        return (
            "Stream sources starting with echo:, expr:, or exec: are disabled. "
            "Enable “Allow arbitrary stream sources” in Configuration → Streaming, "
            "or set GO2RTC_ALLOW_ARBITRARY_EXEC=true."
        )
    return None


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
    transcode_default = _transcode_default()
    main_source = _transcode_source(
        camera.rtsp_url,
        _camera_transcode_value(camera, transcode_default),
    )

    try:
        err = validate_stream_url_for_go2rtc(camera.rtsp_url)
        if err:
            logger.warning("go2rtc stream_sync skipped for %s: %s", name, err)
            return False

        # Register live source in either passthrough RTSP or ffmpeg->H.264 mode.
        if not _put_stream_ok(base_url, name, main_source, "live"):
            return False

        # Optional go2rtc record sink. Disabled by default because the recorder service
        # already writes segments, and duplicate sinks increase disk IO significantly.
        if camera.recording_enabled and ENABLE_GO2RTC_RECORD_SOURCE:
            os.makedirs(os.path.join(get_recordings_dir(), name), exist_ok=True)
            _put_stream_ok(base_url, name, record_path(name), "record")

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
                sub_err = validate_stream_url_for_go2rtc(sub_url)
                if sub_err:
                    logger.warning("go2rtc stream_sync skipped sub %s: %s", sub_name, sub_err)
                else:
                    sub_source = _transcode_source(
                        sub_url,
                        _camera_transcode_value(camera, transcode_default),
                    )
                    _put_stream_ok(base_url, sub_name, sub_source, "substream")
            else:
                if not stream_delete(sub_name):
                    logger.warning("go2rtc stream_sync could not delete stale sub stream %s", sub_name)

        return True
    except Exception as e:
        logger.warning("go2rtc stream_sync failed for %s: %s", name, e)
        return False


def stream_delete(name: str) -> bool:
    """Remove a stream entirely from go2rtc."""
    try:
        r = http.delete(
            f"{_go2rtc_url()}/api/streams",
            params={"name": name},
            timeout=3,
        )
        if r.status_code == 404:
            return True
        r.raise_for_status()
        return True
    except Exception as e:
        logger.warning("go2rtc stream_delete failed for %s: %s", name, e)
        return False


def sync_all_on_startup():
    """
    Called at app startup to ensure go2rtc has all streams registered,
    including record: outputs for cameras with recording enabled.
    go2rtc loses its dynamic streams on restart, so this re-registers them.
    Never raises — a bad go2rtc response must not block Flask from listening.
    """
    from app.models import Camera

    try:
        q = Camera.select().where(Camera.active == True)
        rows = list(q)
        for cam in rows:
            try:
                stream_sync(cam)
            except Exception:
                logger.exception("go2rtc startup sync failed for camera %s", getattr(cam, "name", cam))
        logger.info("go2rtc startup sync complete — %s cameras processed.", len(rows))
    except Exception:
        logger.exception("go2rtc startup sync aborted")