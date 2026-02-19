from flask import Blueprint, render_template
from flask_login import login_required
from app.models import Camera

bp = Blueprint("main", __name__)


@bp.route("/")
@login_required
def dashboard():
    cameras = (
        Camera
        .select()
        .where(Camera.active == True, Camera.name.contains("-main"))
        .order_by(Camera.name)
    )
    sub_map = {cam.name: cam.name.replace("-main", "-sub") for cam in cameras}
    return render_template("dashboard.html", cameras=cameras, sub_map=sub_map)