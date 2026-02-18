from flask import Blueprint, render_template
from flask_login import login_required
from app.models import Camera

bp = Blueprint("main", __name__)


@bp.route("/")
@login_required
def dashboard():
    # Only show main-stream cameras on the dashboard.
    # The JS swaps to sub streams automatically — all grid sizes use sub streams.
    cameras = Camera.query.filter(
        Camera.active == True,
        Camera.name.like("%-main")
    ).all()

    sub_map = {
        cam.name: cam.name.replace("-main", "-sub")
        for cam in cameras
    }

    return render_template("dashboard.html", cameras=cameras, sub_map=sub_map)