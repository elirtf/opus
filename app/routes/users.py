from flask import Blueprint, render_template, redirect, url_for, flash, request
from flask_login import login_required, current_user
from functools import wraps
from app.models import User

bp = Blueprint("users", __name__, url_prefix="/users")


def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not current_user.is_admin:
            flash("Admin access required.", "error")
            return redirect(url_for("main.dashboard"))
        return f(*args, **kwargs)
    return decorated


@bp.route("/")
@login_required
@admin_required
def index():
    users = User.select().order_by(User.username)
    return render_template("users.html", users=users)


@bp.route("/add", methods=["POST"])
@login_required
@admin_required
def add():
    username = request.form["username"].strip()
    if User.select().where(User.username == username).exists():
        flash(f'Username "{username}" is already taken.', "error")
        return redirect(url_for("users.index"))

    user = User(username=username, role=request.form.get("role", "viewer"))
    user.set_password(request.form["password"])
    user.save(force_insert=True)
    flash(f'User "{username}" created.', "success")
    return redirect(url_for("users.index"))


@bp.route("/<int:user_id>/edit", methods=["POST"])
@login_required
@admin_required
def edit(user_id):
    try:
        user = User.get_by_id(user_id)
    except User.DoesNotExist:
        flash("User not found.", "error")
        return redirect(url_for("users.index"))

    new_username = request.form["username"].strip()
    conflict = User.select().where(
        (User.username == new_username) & (User.id != user_id)
    ).exists()
    if conflict:
        flash(f'Username "{new_username}" is already taken.', "error")
        return redirect(url_for("users.index"))

    user.username = new_username
    user.role     = request.form.get("role", "viewer")
    if request.form.get("password"):
        user.set_password(request.form["password"])
    user.save()
    flash(f'User "{user.username}" updated.', "success")
    return redirect(url_for("users.index"))


@bp.route("/<int:user_id>/delete", methods=["POST"])
@login_required
@admin_required
def delete(user_id):
    try:
        user = User.get_by_id(user_id)
    except User.DoesNotExist:
        flash("User not found.", "error")
        return redirect(url_for("users.index"))

    if user.id == current_user.id:
        flash("You can't delete your own account.", "error")
        return redirect(url_for("users.index"))

    user.delete_instance()
    flash(f'User "{user.username}" deleted.', "success")
    return redirect(url_for("users.index"))