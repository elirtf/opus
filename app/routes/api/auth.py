from flask import Blueprint, request
from flask_login import login_user, logout_user, current_user
from app.models import User
from app.routes.api.utils import api_response, api_error, login_required_api

bp = Blueprint("api_auth", __name__, url_prefix="/api/auth")


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
    })