"""
Shared go2rtc stream online/offline logic for API routes and ops alerting.

Matches dashboard behavior: *_health_lookup_stream_name* uses *-sub* as the
health signal for paired *-main* streams when applicable.
"""

from __future__ import annotations

import logging
from typing import Any

import requests as http

logger = logging.getLogger("opus.stream_health")


def health_lookup_stream_name(cam_name: str) -> str:
    """Live tiles treat paired -sub as the health signal for -main streams when both exist."""
    if cam_name.endswith("-main"):
        return cam_name.replace("-main", "-sub", 1)
    return cam_name


def camera_online_from_health_map(cam_name: str, health_map: dict[str, Any]) -> bool | None:
    """
    Return True/False from health_map, or None if the stream key is unknown
    (go2rtc has no entry yet).

    For *-main* cameras we normally key off the paired *-sub* stream; if the sub
    is explicitly down but the main stream still has producers, treat as online
    so the UI matches live playback (main fallback).
    """
    key = health_lookup_stream_name(cam_name)
    online = health_map.get(key)
    if online is None and key != cam_name:
        online = health_map.get(cam_name)
    if (
        online is False
        and cam_name.endswith("-main")
        and key != cam_name
        and health_map.get(cam_name) is True
    ):
        return True
    return online


def fetch_stream_online_map(go2rtc_url: str, timeout: float = 3) -> dict[str, bool] | None:
    """
    Returns { stream_name: has_producers } from go2rtc /api/streams.
    None if go2rtc could not be reached or returned invalid data.
    """
    base = (go2rtc_url or "").strip().rstrip("/")
    if not base:
        return None
    try:
        res = http.get(f"{base}/api/streams", timeout=timeout)
        if not res.ok:
            return None
        streams = res.json()
    except Exception as e:
        logger.debug("go2rtc stream health fetch failed: %s", e)
        return None
    health: dict[str, bool] = {}
    for name, info in streams.items():
        producers = info.get("producers") or []
        health[name] = len(producers) > 0
    return health
