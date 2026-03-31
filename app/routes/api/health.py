import os

from flask import Blueprint, current_app
from app.routes.api.utils import api_response, api_error, login_required_api, admin_required
from app.services.camera_stream_health import fetch_stream_online_map
from app.services.host_diagnostics import collect_host_diagnostics

bp = Blueprint("api_health", __name__, url_prefix="/api/health")


@bp.route("/", methods=["GET"])
@login_required_api
def stream_health():
    """
    Returns { stream_name: bool } where True means the stream has at least
    one active producer (i.e. is online / connected to the camera).
    """
    health = fetch_stream_online_map(current_app.config["GO2RTC_URL"])
    if health is None:
        return api_error("Could not reach go2rtc.", 503)
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