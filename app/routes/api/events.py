"""
Event clips API (motion / future AI) — files live under RECORDINGS_DIR/clips/<camera>/.
"""

import os
from datetime import datetime

from flask import Blueprint, request, send_from_directory
from flask_login import current_user

from app.models import RecordingEvent
from app.routes.api.utils import (
    api_response,
    api_error,
    login_required_api,
    accessible_camera_names,
    to_iso,
)

bp = Blueprint("api_events", __name__, url_prefix="/api/events")

RECORDINGS_DIR = os.environ.get("RECORDINGS_DIR", "/recordings")


def event_to_dict(ev: RecordingEvent) -> dict:
    return {
        "id": ev.id,
        "camera_name": ev.camera_name,
        "filename": ev.filename,
        "file_size": ev.file_size,
        "size_mb": round(ev.file_size / (1024 * 1024), 1),
        "started_at": to_iso(ev.started_at),
        "ended_at": to_iso(ev.ended_at),
        "duration_seconds": ev.duration_seconds,
        "reason": ev.reason,
        "download_url": f"/api/events/{ev.camera_name}/{ev.filename}",
    }


@bp.before_request
def _perm():
    if request.method == "OPTIONS":
        return None
    if not current_user.is_authenticated:
        return None
    if current_user.is_admin:
        return None
    if getattr(current_user, "can_view_recordings", True):
        return None
    return api_error("Recorded footage access is disabled for this account.", 403)


@bp.route("/", methods=["GET"])
@login_required_api
def list_events():
    allowed = accessible_camera_names(current_user)
    if allowed is not None and not allowed:
        return api_response({"events": [], "total": 0})

    cam = request.args.get("camera")
    start_str = request.args.get("start")
    end_str = request.args.get("end")
    limit = min(int(request.args.get("limit", 100)), 500)
    offset = int(request.args.get("offset", 0))
    order = request.args.get("order", "desc")

    q = RecordingEvent.select().where(RecordingEvent.status == "complete")
    if cam:
        if allowed is not None and cam not in allowed:
            return api_error("Access denied to this camera.", 403)
        q = q.where(RecordingEvent.camera_name == cam)
    elif allowed is not None:
        q = q.where(RecordingEvent.camera_name.in_(allowed))

    if start_str:
        try:
            q = q.where(RecordingEvent.started_at >= datetime.fromisoformat(start_str))
        except ValueError:
            return api_error("Invalid 'start' datetime.", 400)
    if end_str:
        try:
            q = q.where(RecordingEvent.started_at <= datetime.fromisoformat(end_str))
        except ValueError:
            return api_error("Invalid 'end' datetime.", 400)

    total = q.count()
    if order == "asc":
        q = q.order_by(RecordingEvent.started_at.asc())
    else:
        q = q.order_by(RecordingEvent.started_at.desc())
    rows = q.offset(offset).limit(limit)
    return api_response(
        {"events": [event_to_dict(e) for e in rows], "total": total, "limit": limit, "offset": offset}
    )


@bp.route("/timeline", methods=["GET"])
@login_required_api
def events_timeline():
    """Same shape as recordings timeline for UI reuse: one day per camera."""
    from datetime import timedelta

    camera_names = request.args.getlist("camera")
    date_str = request.args.get("date")
    if not camera_names:
        return api_error("At least one 'camera' query param is required.", 400)

    allowed = accessible_camera_names(current_user)
    if allowed is not None:
        camera_names = [c for c in camera_names if c in allowed]
        if not camera_names:
            return api_error("Access denied to the requested cameras.", 403)

    if date_str:
        try:
            target_date = datetime.fromisoformat(date_str).date()
        except ValueError:
            return api_error("Invalid 'date' format.", 400)
    else:
        target_date = datetime.now().date()

    day_start = datetime.combine(target_date, datetime.min.time())
    day_end = day_start + timedelta(days=1)

    evs = (
        RecordingEvent.select()
        .where(
            (RecordingEvent.camera_name.in_(camera_names))
            & (RecordingEvent.started_at >= day_start)
            & (RecordingEvent.started_at < day_end)
            & (RecordingEvent.status == "complete")
        )
        .order_by(RecordingEvent.started_at.asc())
    )
    cameras = {name: [] for name in camera_names}
    for ev in evs:
        st = ev.started_at
        if isinstance(st, str):
            start_hms = st.split("T")[-1].split(" ")[-1][:8]
        else:
            start_hms = st.strftime("%H:%M:%S") if st else None
        et = ev.ended_at
        if et:
            if isinstance(et, str):
                end_hms = et.split("T")[-1].split(" ")[-1][:8]
            else:
                end_hms = et.strftime("%H:%M:%S")
        else:
            end_hms = None
        cameras.setdefault(ev.camera_name, []).append(
            {
                "id": ev.id,
                "start": start_hms,
                "end": end_hms,
                "filename": ev.filename,
                "size_mb": round(ev.file_size / (1024 * 1024), 1),
                "duration": ev.duration_seconds,
                "reason": ev.reason,
            }
        )
    return api_response({"date": target_date.isoformat(), "cameras": cameras})


@bp.route("/<camera_name>/<filename>", methods=["GET"])
@login_required_api
def serve_event_clip(camera_name, filename):
    if ".." in camera_name or ".." in filename:
        return api_error("Invalid path.", 400)
    if not filename.endswith(".mp4"):
        return api_error("Invalid file type.", 400)

    allowed = accessible_camera_names(current_user)
    if allowed is not None and camera_name not in allowed:
        return api_error("Access denied.", 403)

    clip_dir = os.path.join(RECORDINGS_DIR, "clips", camera_name)
    filepath = os.path.join(clip_dir, filename)
    if not os.path.exists(filepath):
        return api_error("Clip not found.", 404)

    return send_from_directory(
        clip_dir,
        filename,
        as_attachment=False,
        mimetype="video/mp4",
    )
