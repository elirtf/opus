import re

from flask import Blueprint, current_app, request
from flask_login import current_user, logout_user
from flask_limiter import Limiter
from peewee import IntegrityError

from app.database import db
from app.models import User, UserCamera, UserNVR
from app.opus_auth import (
    attach_session_cookie,
    clear_session_cookie,
    get_effective_client_ip,
    mint_jwt,
    proxy_auth_enabled,
)
from app.routes.api.recording_settings import set_setting
from app.routes.api.utils import api_error, api_response, require_admin, require_auth

bp = Blueprint("api_auth", __name__, url_prefix="/api/auth")

limiter = Limiter(key_func=get_effective_client_ip, storage_uri="memory://")

_SETUP_USER_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_.-]{1,49}$")


def init_auth(app):
    limiter.init_app(app)

    from flask import jsonify
    from flask_limiter.errors import RateLimitExceeded

    @app.errorhandler(RateLimitExceeded)
    def _rate_limited(_e):
        return jsonify({"error": "Too many login attempts. Try again later."}), 429


def _session_payload(user: User):
    """JSON body for login/setup responses (browser cookie + headless token)."""
    app = current_app._get_current_object()
    tok = mint_jwt(app, user)
    return (
        {
            "ok": True,
            "role": user.role,
            "username": user.username,
            "id": user.id,
            "can_view_live": getattr(user, "can_view_live", True),
            "can_view_recordings": getattr(user, "can_view_recordings", True),
            "token": tok,
        },
        tok,
    )


@bp.route("/setup", methods=["GET"])
def setup_needs():
    return api_response({"needs_setup": User.select().count() == 0})


@bp.route("/setup", methods=["POST"])
def setup():
    """Create the first admin. Fails with 409 when any user already exists."""
    if User.select().count() > 0:
        return api_error("Initial setup has already been completed.", 409)

    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""

    if not _SETUP_USER_RE.match(username):
        return api_error(
            "Username must be 2–50 characters: letters, digits, underscore, dot, or hyphen.",
            400,
        )
    if len(password) < 8:
        return api_error("Password must be at least 8 characters.", 400)

    try:
        with db.atomic():
            user = User(username=username, role="admin")
            user.set_password(password)
            user.save(force_insert=True)
            set_setting("setup_complete", "true")
    except IntegrityError:
        return api_error("That username is already taken.", 400)

    payload, tok = _session_payload(user)
    resp = api_response(payload, message="Administrator account created.", status=201)
    body, status = resp
    attach_session_cookie(body, tok)
    return body, status


@bp.route("/login", methods=["POST"])
@limiter.limit("5 per minute;20 per hour")
def login():
    if proxy_auth_enabled():
        return api_error("Login is disabled when proxy authentication is enabled.", 503)

    data = request.get_json(silent=True) or {}
    username = data.get("username", "").strip()
    password = data.get("password") or ""

    if not username or not password:
        return api_error("Username and password are required.", 400)

    try:
        user = User.get(User.username == username)
    except User.DoesNotExist:
        return api_error("Invalid username or password.", 401)

    if not user.check_password(password):
        return api_error("Invalid username or password.", 401)

    payload, tok = _session_payload(user)
    resp = api_response(payload, message="Logged in successfully.")
    body, status = resp
    attach_session_cookie(body, tok)
    return body, status


@bp.route("/logout", methods=["POST"])
@require_auth
def logout():
    logout_user()
    resp = api_response({"ok": True}, message="Logged out.")
    body, status = resp
    clear_session_cookie(body)
    return body, status


@bp.route("/me", methods=["GET"])
def me():
    if not current_user.is_authenticated:
        return api_error("Not authenticated.", 401)
    return api_response(
        {
            "username": current_user.username,
            "role": current_user.role,
            "id": current_user.id,
            "can_view_live": getattr(current_user, "can_view_live", True),
            "can_view_recordings": getattr(current_user, "can_view_recordings", True),
        }
    )


@bp.route("/users", methods=["POST"])
@require_admin
def create_auth_user():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    role = (data.get("role") or "viewer").strip().lower()

    if not _SETUP_USER_RE.match(username):
        return api_error(
            "Username must be 2–50 characters: letters, digits, underscore, dot, or hyphen.",
            400,
        )
    if len(password) < 8:
        return api_error("Password must be at least 8 characters.", 400)
    if role not in ("admin", "viewer"):
        return api_error('role must be "admin" or "viewer".', 400)

    if User.select().where(User.username == username).exists():
        return api_error(f'Username "{username}" is already taken.', 400)

    user = User(username=username, role=role)
    user.set_password(password)
    user.can_view_live = bool(data.get("can_view_live", True))
    user.can_view_recordings = bool(data.get("can_view_recordings", True))
    user.save(force_insert=True)
    return api_response({"username": user.username, "role": user.role}, message="User created.", status=201)


@bp.route("/users/<username>", methods=["DELETE"])
@require_admin
def delete_auth_user(username: str):
    uname = (username or "").strip()
    try:
        user = User.get(User.username == uname)
    except User.DoesNotExist:
        return api_error("User not found.", 404)

    if user.id == current_user.id:
        return api_error("You cannot delete your own account.", 400)

    if user.is_admin:
        admins = User.select().where(User.role == "admin").count()
        if admins <= 1:
            return api_error("Cannot delete the last administrator.", 400)

    UserNVR.delete().where(UserNVR.user_id == user.id).execute()
    UserCamera.delete().where(UserCamera.user_id == user.id).execute()
    user.delete_instance()
    return api_response(message=f'User "{uname}" deleted.')


@bp.route("/users/<username>/password", methods=["PATCH"])
@require_auth
def change_password(username: str):
    uname = (username or "").strip()
    try:
        target = User.get(User.username == uname)
    except User.DoesNotExist:
        return api_error("User not found.", 404)

    is_self = target.id == current_user.id
    if not is_self and not current_user.is_admin:
        return api_error("Admin access required.", 403)

    data = request.get_json(silent=True) or {}
    new_pw = data.get("password") or ""
    if len(new_pw) < 8:
        return api_error("Password must be at least 8 characters.", 400)

    if is_self:
        cur = data.get("current_password") or ""
        if not target.check_password(cur):
            return api_error("Current password is incorrect.", 400)
    else:
        # admin changing another user — no current_password required
        pass

    target.set_password(new_pw)
    target.save()
    return api_response(message="Password updated.")
