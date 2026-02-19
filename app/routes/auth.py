from flask import Blueprint, render_template, redirect, url_for, flash, request
from flask_login import login_user, logout_user, login_required
from app.models import User

bp = Blueprint("auth", __name__)


@bp.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        try:
            user = User.get(User.username == request.form["username"])
            if user.check_password(request.form["password"]):
                login_user(user, remember=True)
                return redirect(url_for("main.dashboard"))
        except User.DoesNotExist:
            pass
        flash("Invalid username or password.", "error")
    return render_template("login.html")


@bp.route("/logout")
@login_required
def logout():
    logout_user()
    return redirect(url_for("auth.login"))