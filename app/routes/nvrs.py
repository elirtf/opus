from flask import Blueprint, render_template, redirect, url_for, flash, request, current_app
from flask_login import login_required, current_user
from functools import wraps
import requests as http

from app import db
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


# ── camera import logic ──────────────────────────────────────────────────────

def import_cameras_for_nvr(nvr: NVR) -> tuple[int, int]:
    """
    Generate main + sub stream cameras for every channel on the NVR.
    URL pattern (Hikvision-style):
      Main: rtsp://user:pass@ip:554/Streaming/Channels/{channel*100 + 1}
      Sub:  rtsp://user:pass@ip:554/Streaming/Channels/{channel*100 + 2}

    Returns (created, skipped) counts.
    """
    created = 0
    skipped = 0
    base = f"rtsp://{nvr.username}:{nvr.password}@{nvr.ip_address}:554"

    for ch in range(1, nvr.max_channels + 1):
        streams = [
            (
                f"{nvr.name}-ch{ch}-main",
                f"{nvr.display_name} — Ch {ch} Main",
                f"{base}/Streaming/Channels/{ch * 100 + 1}",
            ),
            (
                f"{nvr.name}-ch{ch}-sub",
                f"{nvr.display_name} — Ch {ch} Sub",
                f"{base}/Streaming/Channels/{ch * 100 + 2}",
            ),
        ]

        for name, display_name, rtsp_url in streams:
            if Camera.query.filter_by(name=name).first():
                skipped += 1
                continue

            cam = Camera(
                name=name,
                display_name=display_name,
                rtsp_url=rtsp_url,
                nvr_id=nvr.id,
                active=True,
            )
            db.session.add(cam)
            stream_add(name, rtsp_url)
            created += 1

    db.session.commit()
    return created, skipped


# ── routes ───────────────────────────────────────────────────────────────────

@bp.route("/")
@login_required
def index():
    nvrs = NVR.query.all()
    return render_template("nvrs.html", nvrs=nvrs)


@bp.route("/add", methods=["POST"])
@login_required
@admin_required
def add():
    nvr = NVR(
        name=request.form["name"],
        display_name=request.form["display_name"],
        ip_address=request.form.get("ip_address"),
        username=request.form.get("username"),
        password=request.form.get("password"),
        max_channels=int(request.form.get("max_channels") or 50),
    )
    db.session.add(nvr)
    db.session.commit()

    created, skipped = import_cameras_for_nvr(nvr)
    flash(
        f'NVR "{nvr.display_name}" added. '
        f'Imported {created} camera streams ({skipped} already existed).',
        "success",
    )
    return redirect(url_for("nvrs.index"))


@bp.route("/<int:nvr_id>/sync", methods=["POST"])
@login_required
@admin_required
def sync(nvr_id):
    nvr = db.get_or_404(NVR, nvr_id)
    created, skipped = import_cameras_for_nvr(nvr)
    flash(
        f'Sync complete for "{nvr.display_name}": '
        f'{created} new streams added, {skipped} already existed.',
        "success",
    )
    return redirect(url_for("nvrs.index"))


@bp.route("/<int:nvr_id>/edit", methods=["POST"])
@login_required
@admin_required
def edit(nvr_id):
    nvr = db.get_or_404(NVR, nvr_id)
    nvr.name = request.form["name"]
    nvr.display_name = request.form["display_name"]
    nvr.ip_address = request.form.get("ip_address")
    nvr.username = request.form.get("username")
    if request.form.get("password"):
        nvr.password = request.form["password"]
    nvr.max_channels = int(request.form.get("max_channels") or 50)
    nvr.active = "active" in request.form
    db.session.commit()
    flash(f'NVR "{nvr.display_name}" updated.', "success")
    return redirect(url_for("nvrs.index"))


@bp.route("/<int:nvr_id>/delete", methods=["POST"])
@login_required
@admin_required
def delete(nvr_id):
    nvr = db.get_or_404(NVR, nvr_id)
    db.session.delete(nvr)
    db.session.commit()
    flash(f'NVR "{nvr.display_name}" deleted (and its cameras).', "success")
    return redirect(url_for("nvrs.index"))