from flask import Blueprint, render_template, redirect, url_for, flash, request, current_app
from flask_login import login_required, current_user
from functools import wraps
import requests as http

from app.models import NVR, Camera

bp = Blueprint("nvrs", __name__, url_prefix="/nvrs")


def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not current_user.is_admin:
            flash("Admin access required.", "error")
            return redirect(url_for("main.dashboard"))
        return f(*args, **kwargs)
    return decorated


# ── go2rtc helper ────────────────────────────────────────────────────────────

def stream_add(name: str, rtsp_url: str):
    try:
        http.put(
            f"{current_app.config['GO2RTC_URL']}/api/streams",
            params={"name": name, "src": rtsp_url},
            timeout=3,
        )
    except Exception as e:
        current_app.logger.warning(f"go2rtc stream_add failed: {e}")


# ── camera import ─────────────────────────────────────────────────────────────

def import_cameras_for_nvr(nvr: NVR) -> tuple[int, int]:
    created = 0
    skipped = 0
    base = f"rtsp://{nvr.username}:{nvr.password}@{nvr.ip_address}:554"

    for ch in range(1, nvr.max_channels + 1):
        streams = [
            (f"{nvr.name}-ch{ch}-main", f"{nvr.display_name} — Ch {ch} Main", f"{base}/Streaming/Channels/{ch * 100 + 1}"),
            (f"{nvr.name}-ch{ch}-sub",  f"{nvr.display_name} — Ch {ch} Sub",  f"{base}/Streaming/Channels/{ch * 100 + 2}"),
        ]
        for name, display_name, rtsp_url in streams:
            if Camera.select().where(Camera.name == name).exists():
                skipped += 1
                continue
            Camera.create(name=name, display_name=display_name, rtsp_url=rtsp_url, nvr=nvr.id, active=True)
            stream_add(name, rtsp_url)
            created += 1

    return created, skipped


# ── routes ───────────────────────────────────────────────────────────────────

@bp.route("/")
@login_required
def index():
    nvrs = NVR.select()
    # Attach camera counts manually (no ORM relationship in Peewee without FK field)
    for nvr in nvrs:
        nvr._cam_count = Camera.select().where(Camera.nvr == nvr.id).count()
    return render_template("nvrs.html", nvrs=nvrs)


@bp.route("/add", methods=["POST"])
@login_required
@admin_required
def add():
    nvr = NVR.create(
        name=request.form["name"],
        display_name=request.form["display_name"],
        ip_address=request.form.get("ip_address") or None,
        username=request.form.get("username") or None,
        password=request.form.get("password") or None,
        max_channels=int(request.form.get("max_channels") or 50),
    )
    created, skipped = import_cameras_for_nvr(nvr)
    flash(f'NVR "{nvr.display_name}" added. Imported {created} streams ({skipped} already existed).', "success")
    return redirect(url_for("nvrs.index"))


@bp.route("/<int:nvr_id>/sync", methods=["POST"])
@login_required
@admin_required
def sync(nvr_id):
    try:
        nvr = NVR.get_by_id(nvr_id)
    except NVR.DoesNotExist:
        flash("NVR not found.", "error")
        return redirect(url_for("nvrs.index"))
    created, skipped = import_cameras_for_nvr(nvr)
    flash(f'Sync complete: {created} new streams, {skipped} already existed.', "success")
    return redirect(url_for("nvrs.index"))


@bp.route("/<int:nvr_id>/edit", methods=["POST"])
@login_required
@admin_required
def edit(nvr_id):
    try:
        nvr = NVR.get_by_id(nvr_id)
    except NVR.DoesNotExist:
        flash("NVR not found.", "error")
        return redirect(url_for("nvrs.index"))

    nvr.name         = request.form["name"]
    nvr.display_name = request.form["display_name"]
    nvr.ip_address   = request.form.get("ip_address") or None
    nvr.username     = request.form.get("username") or None
    if request.form.get("password"):
        nvr.password = request.form["password"]
    nvr.max_channels = int(request.form.get("max_channels") or 50)
    nvr.active       = "active" in request.form
    nvr.save()
    flash(f'NVR "{nvr.display_name}" updated.', "success")
    return redirect(url_for("nvrs.index"))


@bp.route("/<int:nvr_id>/delete", methods=["POST"])
@login_required
@admin_required
def delete(nvr_id):
    try:
        nvr = NVR.get_by_id(nvr_id)
    except NVR.DoesNotExist:
        flash("NVR not found.", "error")
        return redirect(url_for("nvrs.index"))
    # Delete all cameras belonging to this NVR first
    Camera.delete().where(Camera.nvr == nvr_id).execute()
    nvr.delete_instance()
    flash(f'NVR "{nvr.display_name}" and its cameras deleted.', "success")
    return redirect(url_for("nvrs.index"))