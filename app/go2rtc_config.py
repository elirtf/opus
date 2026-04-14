"""
Write go2rtc.yaml from a hardened template plus DB-backed settings.

go2rtc reads this file at process start; after changes, restart the go2rtc container.
"""
from __future__ import annotations

import logging
import os
from typing import Any

import yaml

from app.go2rtc_settings import allow_exec_module, get_webrtc_candidates

logger = logging.getLogger(__name__)

# Paths used by the UI (via nginx /go2rtc/) and server-side /api/streams.
# Keep in sync with LivePlayer, cameras API, nginx.
#
# go2rtc registers the embedded www/ static file server with handler pattern "/".
# With allow_paths set, HandleFunc only registers routes that appear in this list
# (exact match). Omitting "/" skips static entirely → /stream.html and assets 404.
_DEFAULT_ALLOW_PATHS: tuple[str, ...] = (
    "/",
    "/api/streams",
    "/api/ws",
    "/api/webrtc",
    "/api/stream.m3u8",
    "/api/stream.mp4",
    "/api/frame.jpeg",
    "/stream.html",
    "/stream.mse",
    "/stream.m3u8",
)


def _base_modules(include_exec: bool) -> list[str]:
    mods = ["api", "rtsp", "webrtc", "ffmpeg", "mjpeg"]
    if include_exec:
        mods.append("exec")
    return mods


def _env_bool(name: str, default: bool) -> bool:
    raw = (os.environ.get(name) or "").strip().lower()
    if raw == "":
        return default
    return raw in ("1", "true", "yes", "on")


def _transcode_default() -> bool:
    return _env_bool("GO2RTC_TRANSCODE_DEFAULT", True)


def _transcode_source(rtsp_url: str, should_transcode: bool) -> str:
    if not should_transcode:
        return rtsp_url
    return f"ffmpeg:{rtsp_url}#video=h264"


def _camera_transcode_value(camera, default: bool) -> bool:
    val = getattr(camera, "transcode", None)
    if val is None:
        return default
    return bool(val)


def _build_streams_from_db() -> dict[str, list[str]]:
    """
    Build go2rtc streams from active camera rows.
    - Each camera row contributes its own stream key.
    - A *-main row can also define a virtual paired *-sub stream via rtsp_substream_url
      when no real *-sub row exists.
    """
    try:
        from app.models import Camera
    except Exception as e:
        logger.warning("Could not import Camera model for go2rtc stream generation: %s", e)
        return {}

    try:
        rows = list(Camera.select().where(Camera.active == True))
    except Exception as e:
        logger.warning("Could not read cameras for go2rtc stream generation: %s", e)
        return {}

    by_name = {c.name: c for c in rows}
    default_transcode = _transcode_default()
    streams: dict[str, list[str]] = {}

    for cam in rows:
        rtsp = (getattr(cam, "rtsp_url", None) or "").strip()
        if rtsp:
            source = _transcode_source(rtsp, _camera_transcode_value(cam, default_transcode))
            streams[cam.name] = [source]

        # Build paired sub stream from the main row when there is no explicit *-sub camera row.
        if cam.name.endswith("-main"):
            sub_name = cam.name[: -len("-main")] + "-sub"
            if sub_name in by_name:
                continue
            sub_rtsp = (getattr(cam, "rtsp_substream_url", None) or "").strip()
            if sub_rtsp:
                source = _transcode_source(
                    sub_rtsp,
                    _camera_transcode_value(cam, default_transcode),
                )
                streams[sub_name] = [source]

    return dict(sorted(streams.items(), key=lambda kv: kv[0]))


def build_go2rtc_config_dict() -> dict[str, Any]:
    """Merged go2rtc config (safe defaults + DB)."""
    candidates = get_webrtc_candidates()
    include_exec = allow_exec_module()

    cfg: dict[str, Any] = {
        "app": {"modules": _base_modules(include_exec)},
        "api": {
            "allow_paths": list(_DEFAULT_ALLOW_PATHS),
            "origin": "*",
        },
        "log": {"format": "text"},
        "webrtc": {"candidates": candidates},
    }

    if include_exec:
        cfg["exec"] = {"allow_paths": ["ffmpeg"]}

    streams = _build_streams_from_db()
    if streams:
        cfg["streams"] = streams

    return cfg


def go2rtc_config_path(app=None) -> str:
    if app is not None:
        return app.config.get(
            "GO2RTC_CONFIG_PATH",
            os.environ.get("GO2RTC_CONFIG_PATH", "/config/go2rtc.yaml"),
        )
    return os.environ.get("GO2RTC_CONFIG_PATH", "/config/go2rtc.yaml")


def write_go2rtc_yaml(app=None) -> bool:
    """
    Write merged YAML to GO2RTC_CONFIG_PATH. Returns True if the file was written.
    On failure, logs a warning and returns False (does not raise).
    """
    path = go2rtc_config_path(app)
    cfg = build_go2rtc_config_dict()
    try:
        parent = os.path.dirname(path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            yaml.safe_dump(
                cfg,
                f,
                default_flow_style=False,
                allow_unicode=True,
                sort_keys=False,
            )
        logger.info("Wrote go2rtc config: %s", path)
        return True
    except OSError as e:
        logger.warning("Could not write go2rtc config at %s: %s", path, e)
        return False
