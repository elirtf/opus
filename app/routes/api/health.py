import os

from flask import Blueprint, current_app
from app.routes.api.utils import api_response, api_error, login_required_api, admin_required
from app.services.host_diagnostics import collect_host_diagnostics
import requests as http

bp = Blueprint("api_health", __name__, url_prefix="/api/health")


@bp.route("/", methods=["GET"])
@login_required_api
def stream_health():
    """
    Fetches go2rtc's /api/streams and returns a dict of
    { stream_name: bool } where True means the stream has at least
    one active producer (i.e. is online / connected to the camera).
    """
    try:
        res = http.get(
            f"{current_app.config['GO2RTC_URL']}/api/streams",
            timeout=3,
        )
        streams = res.json()
    except Exception as e:
        current_app.logger.warning(f"go2rtc health check failed: {e}")
        return api_error("Could not reach go2rtc.", 503)

    health = {}
    for name, info in streams.items():
        # go2rtc marks a stream as online when it has producers
        producers = info.get("producers") or []
        health[name] = len(producers) > 0

    return api_response(health)


@bp.route("/diagnostics", methods=["GET"])
@login_required_api
@admin_required
def host_diagnostics():
    """Admin-only host/container capability snapshot (see docs/hw-diagnostics-spec.md)."""
    return api_response(collect_host_diagnostics())


@bp.route("/about", methods=["GET"])
@login_required_api
@admin_required
def about_opus():
    """Opus version + host summary for Configuration → System (no secrets)."""
    diag = collect_host_diagnostics()
    keys = (
        "platform_system",
        "platform_machine",
        "platform_release",
        "python_version",
        "cpu_count_logical",
        "recordings_dir",
        "recordings_disk",
        "mem_total_kb",
    )
    host = {k: diag[k] for k in keys if k in diag}
    return api_response(
        {
            "opus_version": os.environ.get("OPUS_VERSION", "dev"),
            "timezone": os.environ.get("TZ", "") or None,
            "host": host,
        }
    )