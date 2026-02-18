from flask import Blueprint, render_template
from flask_login import login_required
from app.models import Camera

bp = Blueprint("main", __name__)


@bp.route("/")
@login_required
def dashboard():
    # Only show main streams on the dashboard.
    # Sub streams are loaded dynamically in the template when the grid is large.
    cameras = Camera.query.filter(
        Camera.active == True,
        Camera.name.like("%-main")
    ).all()

    # Build a lookup: cam.name -> sub stream name
    # e.g. "warehouse-ch1-main" -> "warehouse-ch1-sub"
    sub_map = {
        cam.name: cam.name.replace("-main", "-sub")
        for cam in cameras
    }

    return render_template("dashboard.html", cameras=cameras, sub_map=sub_map)