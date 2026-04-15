import re
import secrets

from flask import Blueprint, request
from flask_login import login_user, logout_user, current_user
from peewee import IntegrityError
from werkzeug.security import generate_password_hash
from app.models import User
from app.routes.api.utils import api_response, api_error, login_required_api

bp = Blueprint("api_auth", __name__, url_prefix="/api/auth")

_SETUP_USER_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_.-]{1,49}$")


@bp.route("/setup-required", methods=["GET"])
def setup_required():
    """True when no user accounts exist — UI should send the operator to /setup."""
    return api_response({"setup_required": User.select().count() == 0})


@bp.route("/setup", methods=["POST"])
def setup():
    """
    One-time creation of the first (admin) account. Disabled once any user exists.
    Also flips setup_complete so recorder/processor can run.
    """
    from app.database import db
    from app.routes.api.recording_settings import set_setting

    if User.select().count() > 0:
        return api_error("Initial setup has already been completed.", 403)

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
    login_user(user, remember=True)
    return api_response(
        {
            "id": user.id,
            "username": user.username,
            "role": user.role,
            "can_view_live": getattr(user, "can_view_live", True),
            "can_view_recordings": getattr(user, "can_view_recordings", True),
        },
        message="Administrator account created.",
        status=201,
    )


@bp.route("/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    username = data.get("username", "").strip()
    password = data.get("password", "")

    if not username or not password:
        return api_error("Username and password are required.", 400)

    try:
        user = User.get(User.username == username)
    except User.DoesNotExist:
        return api_error("Invalid username or password.", 401)

    if not user.check_password(password):
        return api_error("Invalid username or password.", 401)

    login_user(user, remember=True)
    return api_response({
        "id":       user.id,
        "username": user.username,
        "role":     user.role,
        "can_view_live": getattr(user, "can_view_live", True),
        "can_view_recordings": getattr(user, "can_view_recordings", True),
    }, message="Logged in successfully.")


@bp.route("/logout", methods=["POST"])
@login_required_api
def logout():
    logout_user()
    return api_response(message="Logged out.")


@bp.route("/me", methods=["GET"])
def me():
    """Returns current session info — useful for React to check auth state on load."""
    if not current_user.is_authenticated:
        return api_error("Not authenticated.", 401)
    return api_response({
        "id":       current_user.id,
        "username": current_user.username,
        "role":     current_user.role,
        "can_view_live": getattr(current_user, "can_view_live", True),
        "can_view_recordings": getattr(current_user, "can_view_recordings", True),
    })


@bp.route("/token", methods=["POST"])
@login_required_api
def create_api_token():
    """
    Issue a new API token for the current user (replaces any existing token).
    The plaintext token is returned once; store it as Bearer for non-cookie clients.
    """
    raw = secrets.token_urlsafe(32)
    current_user.api_token_hash = generate_password_hash(raw)
    current_user.save()
    return api_response({"token": raw}, message="API token created. Store it securely; it will not be shown again.")


@bp.route("/token", methods=["DELETE"])
@login_required_api
def revoke_api_token():
    """Remove API token for the current user."""
    current_user.api_token_hash = None
    current_user.save()
    return api_response(message="API token revoked.")