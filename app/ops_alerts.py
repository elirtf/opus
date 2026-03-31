"""
Background health checks → optional webhook (JSON POST).

Enable with ALERT_WEBHOOK_URL on the API process. Not enabled by default.

Env (API / opus container):
  ALERT_WEBHOOK_URL              — POST JSON alerts here (empty = disabled)
  ALERT_CHECK_INTERVAL_SECONDS   — default 60
  ALERT_COOLDOWN_SECONDS         — min seconds between two alerts of the same type (default 3600)
  ALERT_DISK_FREE_GB_THRESHOLD   — fire when free space on recordings volume is below this (0 = off)
  ALERT_DISK_PERCENT_USED_THRESHOLD — fire when used% >= this (0 = off)
  RECORDER_INTERNAL_STATUS_URL   — same as recordings API (e.g. http://recorder:5055/status)
  PROCESSOR_INTERNAL_STATUS_URL  — processor /status (e.g. http://processor:5056/status)
  ALERT_PROCESSOR_STUCK_SECONDS   — no tick for this long → stuck (default max(180, 5 * PROCESSING_POLL_SECONDS) inferred from status)
  ALERT_CAMERA_OFFLINE_ENABLED    — if 0/false/off, skip camera stream checks (default: on)
  ALERT_CAMERA_ONLINE_ENABLED     — if 1/true/on, also alert when a camera recovers (default: off)
"""

from __future__ import annotations

import logging
import os
import threading
import time

import requests

from app.config import get_recordings_dir
from app.routes.api.utils import env_bool
from app.services.camera_stream_health import (
    camera_online_from_health_map,
    fetch_stream_online_map,
    health_lookup_stream_name,
)

logger = logging.getLogger("opus.alerts")

_last_fired: dict[str, float] = {}

# Per-camera last known online bool for transition detection (not persisted).
_camera_prev_online: dict[str, bool | None] = {}


def _cooldown_ok(key: str, cooldown: float) -> bool:
    now = time.time()
    last = _last_fired.get(key, 0)
    if now - last < cooldown:
        return False
    _last_fired[key] = now
    return True



def _post_webhook(url: str, payload: dict) -> None:
    try:
        r = requests.post(url, json=payload, timeout=15, headers={"Content-Type": "application/json"})
        if r.status_code >= 400:
            logger.warning("Alert webhook HTTP %s: %s", r.status_code, r.text[:200])
    except Exception:
        logger.exception("Alert webhook POST failed")


def _check_disk(app, webhook: str, cooldown: float) -> None:
    from app.services.disk_usage import get_disk_usage

    free_thr = float(os.environ.get("ALERT_DISK_FREE_GB_THRESHOLD") or "0")
    pct_thr = float(os.environ.get("ALERT_DISK_PERCENT_USED_THRESHOLD") or "0")
    if free_thr <= 0 and pct_thr <= 0:
        return
    rd = get_recordings_dir()
    if not os.path.exists(rd):
        os.makedirs(rd, exist_ok=True)
    du = get_disk_usage(rd)
    if du is None:
        return
    free_gb = du["free_gb"]
    pct_used = du["percent_used"]

    fire = False
    reason = []
    if free_thr > 0 and free_gb < free_thr:
        fire = True
        reason.append("free_gb_below_threshold")
    if pct_thr > 0 and pct_used >= pct_thr:
        fire = True
        reason.append("percent_used_above_threshold")
    if not fire:
        return
    key = "disk"
    if not _cooldown_ok(key, cooldown):
        return
    _post_webhook(
        webhook,
        {
            "source": "opus",
            "alert": "disk_low",
            "severity": "warning",
            "detail": {
                "recordings_dir": rd,
                "free_gb": free_gb,
                "percent_used": pct_used,
                "thresholds": {"free_gb_min": free_thr or None, "percent_used_max": pct_thr or None},
                "reason": reason,
            },
        },
    )
    logger.warning(
        "Alert disk_low: free_gb=%.2f used=%s%% (webhook sent)",
        free_gb,
        pct_used,
    )


def _check_recorder_shelved(webhook: str, cooldown: float) -> None:
    url = (os.environ.get("RECORDER_INTERNAL_STATUS_URL") or "").strip()
    if not url:
        return
    try:
        r = requests.get(url, timeout=5)
        if not r.ok:
            return
        data = r.json()
    except Exception:
        return
    shelved = int(data.get("shelved_count") or 0)
    if shelved <= 0:
        return
    key = "recorder_shelved"
    if not _cooldown_ok(key, cooldown):
        return
    _post_webhook(
        webhook,
        {
            "source": "opus",
            "alert": "recorder_shelved",
            "severity": "warning",
            "detail": {
                "shelved_count": shelved,
                "shelved": data.get("shelved") or [],
            },
        },
    )
    logger.warning("Alert recorder_shelved: count=%s (webhook sent)", shelved)


def _check_processor_stuck(webhook: str, cooldown: float) -> None:
    url = (os.environ.get("PROCESSOR_INTERNAL_STATUS_URL") or "").strip()
    if not url:
        return
    try:
        r = requests.get(url, timeout=5)
        if not r.ok:
            return
        data = r.json()
    except Exception:
        return
    if not data.get("engine_running"):
        return
    last = float(data.get("last_tick_unix") or 0)
    poll = float(data.get("poll_seconds") or 6)
    stuck_after = float(os.environ.get("ALERT_PROCESSOR_STUCK_SECONDS") or max(180.0, 5.0 * poll))
    if last <= 0:
        return
    age = time.time() - last
    if age <= stuck_after:
        return
    key = "processor_stuck"
    if not _cooldown_ok(key, cooldown):
        return
    _post_webhook(
        webhook,
        {
            "source": "opus",
            "alert": "processor_stuck",
            "severity": "critical",
            "detail": {
                "last_tick_unix": last,
                "seconds_since_tick": round(age, 1),
                "stuck_threshold_seconds": stuck_after,
                "poll_seconds": poll,
            },
        },
    )
    logger.error(
        "Alert processor_stuck: last_tick %.0fs ago (webhook sent)",
        age,
    )


def _check_camera_streams(app, webhook: str, cooldown: float) -> None:
    if not env_bool("ALERT_CAMERA_OFFLINE_ENABLED", True):
        return
    go2rtc = (app.config.get("GO2RTC_URL") or os.environ.get("GO2RTC_URL") or "").strip()
    if not go2rtc:
        return
    health_map = fetch_stream_online_map(go2rtc)
    if health_map is None:
        return
    online_alerts = env_bool("ALERT_CAMERA_ONLINE_ENABLED", False)

    from app.models import Camera, NVR

    nvr_map = {n.id: n for n in NVR.select()}
    rows = list(Camera.select().where(Camera.active == True))

    global _camera_prev_online
    for cam in rows:
        raw = camera_online_from_health_map(cam.name, health_map)
        cur_bool = bool(raw) if raw is not None else False
        stream_key = health_lookup_stream_name(cam.name)
        prev = _camera_prev_online.get(cam.name)

        if prev is None:
            _camera_prev_online[cam.name] = cur_bool
            continue

        nvr = nvr_map.get(cam.nvr) if cam.nvr else None
        nvr_name = nvr.display_name if nvr else None

        if prev is True and not cur_bool:
            if _cooldown_ok(f"camera_offline:{cam.name}", cooldown):
                _post_webhook(
                    webhook,
                    {
                        "source": "opus",
                        "alert": "camera_offline",
                        "severity": "warning",
                        "detail": {
                            "camera_name": cam.name,
                            "display_name": cam.display_name,
                            "stream_key": stream_key,
                            "nvr_id": cam.nvr,
                            "nvr_name": nvr_name,
                            "online": False,
                        },
                    },
                )
                logger.warning("Alert camera_offline: %s (webhook sent)", cam.name)
            _camera_prev_online[cam.name] = False
        elif online_alerts and prev is False and cur_bool:
            if _cooldown_ok(f"camera_online:{cam.name}", cooldown):
                _post_webhook(
                    webhook,
                    {
                        "source": "opus",
                        "alert": "camera_online",
                        "severity": "info",
                        "detail": {
                            "camera_name": cam.name,
                            "display_name": cam.display_name,
                            "stream_key": stream_key,
                            "nvr_id": cam.nvr,
                            "nvr_name": nvr_name,
                            "online": True,
                        },
                    },
                )
                logger.info("Alert camera_online: %s (webhook sent)", cam.name)
            _camera_prev_online[cam.name] = True
        else:
            _camera_prev_online[cam.name] = cur_bool

    # Drop state for deleted cameras
    kept = {c.name for c in rows}
    for name in list(_camera_prev_online.keys()):
        if name not in kept:
            del _camera_prev_online[name]


def ops_alert_loop(app):
    webhook = (os.environ.get("ALERT_WEBHOOK_URL") or "").strip()
    if not webhook:
        return
    interval = max(15, int(os.environ.get("ALERT_CHECK_INTERVAL_SECONDS") or "60"))
    cooldown = max(60, float(os.environ.get("ALERT_COOLDOWN_SECONDS") or "3600"))
    logger.info("Ops alerts enabled (interval=%ss cooldown=%ss)", interval, cooldown)
    while True:
        try:
            time.sleep(interval)
            with app.app_context():
                _check_disk(app, webhook, cooldown)
                _check_camera_streams(app, webhook, cooldown)
            _check_recorder_shelved(webhook, cooldown)
            _check_processor_stuck(webhook, cooldown)
        except Exception:
            logger.exception("ops alert iteration failed")


def start_ops_alerts_thread(app) -> None:
    if not (os.environ.get("ALERT_WEBHOOK_URL") or "").strip():
        return
    t = threading.Thread(target=ops_alert_loop, args=(app,), daemon=True, name="ops-alerts")
    t.start()
