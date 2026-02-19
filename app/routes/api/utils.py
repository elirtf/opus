from functools import wraps
from flask import jsonify
from flask_login import current_user


def api_response(data=None, message=None, status=200):
    """Standard JSON response wrapper."""
    body = {}
    if data is not None:
        body["data"] = data
    if message is not None:
        body["message"] = message
    return jsonify(body), status


def api_error(message, status=400):
    """Standard JSON error response."""
    return jsonify({"error": message}), status


def admin_required(f):
    """Decorator — returns 403 JSON instead of redirecting."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if not current_user.is_authenticated or not current_user.is_admin:
            return api_error("Admin access required.", 403)
        return f(*args, **kwargs)
    return decorated


def login_required_api(f):
    """Decorator — returns 401 JSON instead of redirecting to login page."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if not current_user.is_authenticated:
            return api_error("Authentication required.", 401)
        return f(*args, **kwargs)
    return decorated