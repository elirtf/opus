from flask import Blueprint, request
from flask_login import current_user
from app.models import User, UserNVR, NVR
from app.routes.api.utils import api_response, api_error, login_required_api, admin_required

bp = Blueprint("api_users", __name__, url_prefix="/api/users")


# ── Serializer ────────────────────────────────────────────────────────────────

def user_to_dict(user):
    return {
        "id":       user.id,
        "username": user.username,
        "role":     user.role,
    }


# ── Routes ────────────────────────────────────────────────────────────────────

@bp.route("/", methods=["GET"])
@login_required_api
@admin_required
def list_users():
    users = User.select().order_by(User.username)
    return api_response([user_to_dict(u) for u in users])


@bp.route("/", methods=["POST"])
@login_required_api
@admin_required
def create_user():
    data     = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password", "")
    role     = data.get("role", "viewer")

    if not username or not password:
        return api_error("username and password are required.")

    if role not in ("admin", "viewer"):
        return api_error('role must be "admin" or "viewer".')

    if User.select().where(User.username == username).exists():
        return api_error(f'Username "{username}" is already taken.')

    user = User(username=username, role=role)
    user.set_password(password)
    user.save(force_insert=True)
    return api_response(user_to_dict(user), message=f'User "{username}" created.', status=201)


@bp.route("/<int:user_id>", methods=["PATCH"])
@login_required_api
@admin_required
def update_user(user_id):
    try:
        user = User.get_by_id(user_id)
    except User.DoesNotExist:
        return api_error("User not found.", 404)

    data = request.get_json(silent=True) or {}

    if "username" in data:
        new_username = data["username"].strip()
        conflict = User.select().where(
            (User.username == new_username) & (User.id != user_id)
        ).exists()
        if conflict:
            return api_error(f'Username "{new_username}" is already taken.')
        user.username = new_username

    if "role" in data:
        if data["role"] not in ("admin", "viewer"):
            return api_error('role must be "admin" or "viewer".')
        user.role = data["role"]

    if data.get("password"):
        user.set_password(data["password"])

    user.save()
    return api_response(user_to_dict(user), message="User updated.")


@bp.route("/<int:user_id>", methods=["DELETE"])
@login_required_api
@admin_required
def delete_user(user_id):
    try:
        user = User.get_by_id(user_id)
    except User.DoesNotExist:
        return api_error("User not found.", 404)

    if user.id == current_user.id:
        return api_error("You cannot delete your own account.", 400)

    UserNVR.delete().where(UserNVR.user_id == user_id).execute()
    username = user.username
    user.delete_instance()
    return api_response(message=f'User "{username}" deleted.')


@bp.route("/<int:user_id>/nvrs", methods=["GET"])
@login_required_api
@admin_required
def get_user_nvrs(user_id):
    """Returns list of NVR IDs assigned to this user."""
    try:
        User.get_by_id(user_id)
    except User.DoesNotExist:
        return api_error("User not found.", 404)

    assigned = [
        row.nvr_id
        for row in UserNVR.select().where(UserNVR.user_id == user_id)
    ]
    return api_response(assigned)


@bp.route("/<int:user_id>/nvrs", methods=["POST"])
@login_required_api
@admin_required
def set_user_nvrs(user_id):
    """
    Replaces the full set of NVR assignments for a user.
    Send an empty list to revoke all access.
    Body: { "nvr_ids": [1, 2, 3] }
    """
    try:
        user = User.get_by_id(user_id)
    except User.DoesNotExist:
        return api_error("User not found.", 404)

    if user.is_admin:
        return api_error("Admins always have full access — NVR assignments don't apply.", 400)

    data    = request.get_json(silent=True) or {}
    nvr_ids = data.get("nvr_ids", [])

    if not isinstance(nvr_ids, list):
        return api_error("nvr_ids must be a list.")

    # Validate all IDs exist
    for nvr_id in nvr_ids:
        if not NVR.select().where(NVR.id == nvr_id).exists():
            return api_error(f"NVR {nvr_id} not found.", 404)

    # Replace assignments atomically
    UserNVR.delete().where(UserNVR.user_id == user_id).execute()
    for nvr_id in nvr_ids:
        UserNVR.create(user_id=user_id, nvr_id=nvr_id)

    return api_response(nvr_ids, message=f"NVR access updated for {user.username}.")