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
