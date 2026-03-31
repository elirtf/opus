import os
from functools import wraps
from flask import jsonify, send_from_directory
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


def accessible_camera_names(user):
    """
    Camera names visible to this user via NVR assignments and optional UserCamera rows.
    None means admin (no name filter).
    """
    from app.models import Camera

    if not user.is_authenticated:
        return set()
    if user.is_admin:
        return None
    allowed_nvrs = user.allowed_nvr_ids()
    if allowed_nvrs is not None and not allowed_nvrs:
        return set()
    q = Camera.select(Camera.id, Camera.name)
    if allowed_nvrs is not None:
        q = q.where(Camera.nvr.in_(allowed_nvrs))
    rows = list(q)
    subset_ids = user.allowed_camera_ids_subset()
    if subset_ids is not None:
        return {c.name for c in rows if c.id in subset_ids}
    return {c.name for c in rows}


def camera_catalog_allowed(f):
    """List/summary cameras: need live and/or recordings permission."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if not current_user.is_authenticated:
            return api_error("Authentication required.", 401)
        if current_user.is_admin:
            return f(*args, **kwargs)
        live = getattr(current_user, "can_view_live", True)
        rec = getattr(current_user, "can_view_recordings", True)
        if not live and not rec:
            return api_error("No camera catalog access is enabled for this account.", 403)
        return f(*args, **kwargs)
    return decorated


def live_playback_allowed(f):
    """Single-camera live stream metadata and playback URLs."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if not current_user.is_authenticated:
            return api_error("Authentication required.", 401)
        if current_user.is_admin:
            return f(*args, **kwargs)
        if not getattr(current_user, "can_view_live", True):
            return api_error("Live viewing is disabled for this account.", 403)
        return f(*args, **kwargs)
    return decorated


def recordings_view_allowed(f):
    """Recorded segments and event clips."""
    @wraps(f)
    def decorated(*args, **kwargs):
        if not current_user.is_authenticated:
            return api_error("Authentication required.", 401)
        if current_user.is_admin:
            return f(*args, **kwargs)
        if not getattr(current_user, "can_view_recordings", True):
            return api_error("Recorded footage access is disabled for this account.", 403)
        return f(*args, **kwargs)
    return decorated


# ── Shared helpers ────────────────────────────────────────────────────────────

def to_iso(val):
    """Convert a value to ISO string — handles both datetime objects and raw strings."""
    if val is None:
        return None
    if isinstance(val, str):
        return val
    return val.isoformat()


def is_original_admin() -> bool:
    """True only for the first admin account (id == 1). Used to gate sensitive settings."""
    return (
        current_user.is_authenticated
        and current_user.is_admin
        and current_user.id == 1
    )


def env_bool(name: str, default: bool = False) -> bool:
    """Parse an env var as boolean (1/true/yes/on). Missing or empty → *default*."""
    raw = os.environ.get(name)
    if raw is None:
        return default
    s = str(raw).strip().lower()
    if s == "":
        return default
    return s in ("1", "true", "yes", "on")


def serve_mp4_file(base_dir: str, camera_name: str, filename: str):
    """
    Shared handler for serving .mp4 files with path-traversal guard and access control.
    Returns a Flask response or an api_error tuple.
    """
    if ".." in camera_name or ".." in filename:
        return api_error("Invalid path.", 400)
    if not filename.endswith(".mp4"):
        return api_error("Invalid file type.", 400)

    allowed = accessible_camera_names(current_user)
    if allowed is not None and camera_name not in allowed:
        return api_error("Access denied.", 403)

    file_dir = os.path.join(base_dir, camera_name)
    if not os.path.isfile(os.path.join(file_dir, filename)):
        return api_error("File not found.", 404)

    return send_from_directory(file_dir, filename, as_attachment=False, mimetype="video/mp4")