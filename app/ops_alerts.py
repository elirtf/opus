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
"""

from __future__ import annotations

import logging
import os
import shutil
import threading
import time

import requests

logger = logging.getLogger("opus.alerts")

_last_fired: dict[str, float] = {}


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
    free_thr = float(os.environ.get("ALERT_DISK_FREE_GB_THRESHOLD") or "0")
    pct_thr = float(os.environ.get("ALERT_DISK_PERCENT_USED_THRESHOLD") or "0")
    if free_thr <= 0 and pct_thr <= 0:
        return
    rd = app.config.get("RECORDINGS_DIR") or os.environ.get("RECORDINGS_DIR", "/recordings")
    try:
        if not os.path.exists(rd):
            os.makedirs(rd, exist_ok=True)
        du = shutil.disk_usage(rd)
        free_gb = du.free / 1024**3
        pct_used = round(du.used / du.total * 100, 1) if du.total else 0
    except OSError as e:
        logger.debug("disk alert: %s", e)
        return

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
                "free_gb": round(free_gb, 3),
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
            _check_recorder_shelved(webhook, cooldown)
            _check_processor_stuck(webhook, cooldown)
        except Exception:
            logger.exception("ops alert iteration failed")


def start_ops_alerts_thread(app) -> None:
    if not (os.environ.get("ALERT_WEBHOOK_URL") or "").strip():
        return
    t = threading.Thread(target=ops_alert_loop, args=(app,), daemon=True, name="ops-alerts")
    t.start()
