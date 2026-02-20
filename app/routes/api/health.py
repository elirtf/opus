from flask import Blueprint, current_app
from app.routes.api.utils import api_response, api_error, login_required_api
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