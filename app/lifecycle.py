"""
Post-create_app hooks: operational alerts thread and go2rtc config + stream sync.

Keeps Flask factory focused on wiring; side-effectful startup lives here.
"""

from __future__ import annotations

import logging
import os
import threading
import time

import requests as http

logger = logging.getLogger("opus.lifecycle")

# Bounds for the deferred go2rtc startup sync; see _deferred_go2rtc_sync.
_SYNC_INITIAL_DELAY_S = 2.0
_SYNC_BACKOFF_START_S = 1.0
_SYNC_BACKOFF_CAP_S = 30.0
_SYNC_PROBE_TIMEOUT_S = 2.0
# Soft ceiling for log noise — the thread keeps trying after this, but stops
# re-logging so unreachable installs don't flood opus logs.
_SYNC_MAX_LOG_ATTEMPTS = 30


def _go2rtc_is_up(base_url: str) -> bool:
    """Lightweight liveness probe. Any 2xx on /api/streams is enough."""
    base = (base_url or "").strip().rstrip("/")
    if not base:
        return False
    try:
        r = http.get(f"{base}/api/streams", timeout=_SYNC_PROBE_TIMEOUT_S)
        return r.ok
    except Exception:
        return False


def _deferred_go2rtc_sync(app) -> None:
    """
    Wait for go2rtc to come up, then call sync_all_on_startup() exactly once.

    Runs off the request thread so create_app() returns immediately. Previously
    sync_all_on_startup ran synchronously and each failed PUT burned an 8 s
    timeout per camera — with 64 streams and a go2rtc that wasn't ready yet,
    that blocked Flask from serving for minutes on cold boot.
    """
    from app.go2rtc import sync_all_on_startup

    base_url = app.config.get("GO2RTC_URL") or os.environ.get("GO2RTC_URL", "")
    time.sleep(_SYNC_INITIAL_DELAY_S)

    delay = _SYNC_BACKOFF_START_S
    attempts = 0
    while True:
        attempts += 1
        if _go2rtc_is_up(base_url):
            break
        if attempts <= _SYNC_MAX_LOG_ATTEMPTS:
            logger.info(
                "go2rtc not reachable at %s yet (attempt %s) — retrying in %.1fs",
                base_url or "<unset>",
                attempts,
                delay,
            )
        elif attempts == _SYNC_MAX_LOG_ATTEMPTS + 1:
            logger.warning(
                "go2rtc still unreachable at %s after %s attempts — silencing further warnings until it responds",
                base_url or "<unset>",
                _SYNC_MAX_LOG_ATTEMPTS,
            )
        time.sleep(delay)
        delay = min(_SYNC_BACKOFF_CAP_S, delay * 2)

    try:
        with app.app_context():
            sync_all_on_startup()
    except Exception:
        logger.exception("deferred go2rtc startup sync failed")


def start_background_services(app) -> None:
    from app.go2rtc_config import write_go2rtc_yaml
    from app.ops_alerts import start_ops_alerts_thread

    start_ops_alerts_thread(app)

    # Writing the yaml is a local filesystem op and must happen synchronously so
    # that when the go2rtc container starts (possibly after us, possibly before)
    # it always sees an up-to-date config.
    with app.app_context():
        write_go2rtc_yaml(app)

    # The API-level re-sync depends on go2rtc being reachable and was previously
    # the dominant cold-boot stall. Run it off the factory thread.
    t = threading.Thread(
        target=_deferred_go2rtc_sync,
        args=(app,),
        daemon=True,
        name="go2rtc-startup-sync",
    )
    t.start()
