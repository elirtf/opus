"""Optional processing engine status (motion worker)."""

from flask import Blueprint
from flask_login import current_user

from app.routes.api.utils import api_response, api_error, login_required_api

bp = Blueprint("api_processing", __name__, url_prefix="/api/processing")


@bp.route("/status", methods=["GET"])
@login_required_api
def processing_status():
    if not current_user.is_admin:
        return api_error("Admin access required.", 403)
    try:
        from app.processing.engine import engine
    except ImportError:
        return api_error("Processing module not available.", 503)

    if engine is None:
        return api_response({"initialized": False, "message": "Processing worker not running."})
    return api_response({"initialized": True, **engine.get_status()})
