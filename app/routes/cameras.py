from flask import Blueprint, render_template, redirect, url_for, flash, request, current_app
from flask_login import login_required, current_user
from functools import wraps
import requests as http

from app.models import Camera, NVR

bp = Blueprint("cameras", __name__, url_prefix="/cameras")


def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not current_user.is_admin:
            flash("Admin access required.", "error")
            return redirect(url_for("main.dashboard"))
        return f(*args, **kwargs)
    return decorated

# go2rtc helpers

def go2rtc_url():
    return current_app.config["GO2RTC_URL"]


def stream_add(name: str, rtsp_url: str):
    """Register (or update) a stream in go2rtc."""
    try:
        http.put(f"{go2rtc_url()}/api/streams", params={"name": name, "src": rtsp_url}, timeout=3)
    except Exception as e:
        current_app.logger.warning(f"go2rtc stream_add failed: {e}")


def stream_delete(name: str):
    """Remove a stream from go2rtc."""
    try:
        http.delete(f"{go2rtc_url()}/api/streams", params={"name": name}, timeout=3)
    except Exception as e:
        current_app.logger.warning(f"go2rtc stream_delete failed: {e}")


@bp.route("/")
@login_required
def index():
    cameras = Camera.select()
    nvrs    = NVR.select().where(NVR.active == True)

    # Build nvr lookup dict for template display
    nvr_map = {nvr.id: nvr for nvr in nvrs}
    return render_template("cameras.html", cameras=cameras, nvrs=nvrs, nvr_map=nvr_map)


@bp.route("/add", methods=["POST"])
@login_required
@admin_required
def add():
    cam = Camera.create(
        name=request.form["name"],
        display_name=request.form["display_name"],
        rtsp_url=request.form["rtsp_url"],
        nvr=request.form.get("nvr_id") or None,
    )
    stream_add(cam.name, cam.rtsp_url)
    flash(f'Camera "{cam.display_name}" added.', "success")
    return redirect(url_for("cameras.index"))


@bp.route("/<int:cam_id>/edit", methods=["POST"])
@login_required
@admin_required
def edit(cam_id):
    try:
        cam = Camera.get_by_id(cam_id)
    except Camera.DoesNotExist:
        flash("Camera not found.", "error")
        return redirect(url_for("cameras.index"))

    old_name = cam.name
    cam.name         = request.form["name"]
    cam.display_name = request.form["display_name"]
    cam.rtsp_url     = request.form["rtsp_url"]
    cam.nvr          = request.form.get("nvr_id") or None
    cam.active       = "active" in request.form
    cam.save()

    if old_name != cam.name:
        stream_delete(old_name)
    stream_add(cam.name, cam.rtsp_url)
    flash(f'Camera "{cam.display_name}" updated.', "success")
    return redirect(url_for("cameras.index"))


@bp.route("/<int:cam_id>/delete", methods=["POST"])
@login_required
@admin_required
def delete(cam_id):
    try:
        cam = Camera.get_by_id(cam_id)
    except Camera.DoesNotExist:
        flash("Camera not found.", "error")
        return redirect(url_for("cameras.index"))
    stream_delete(cam.name)
    cam.delete_instance()
    flash(f'Camera "{cam.display_name}" deleted.', "success")
    return redirect(url_for("cameras.index"))