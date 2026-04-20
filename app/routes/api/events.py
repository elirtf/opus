"""
Event clips API (motion / future AI) — files live under RECORDINGS_DIR/clips/<camera>/.
"""

import os
from datetime import datetime

from flask import Blueprint, request
from flask_login import current_user

from app.config import get_recordings_dir
from app.models import RecordingEvent
from app.routes.api.utils import (
    api_response,
    api_error,
    login_required_api,
    accessible_camera_names,
    to_iso,
    serve_mp4_file,
    parse_timeline_params,
    to_hms,
)

bp = Blueprint("api_events", __name__, url_prefix="/api/events")


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
    result = parse_timeline_params()
    if not isinstance(result, tuple):
        return result
    camera_names, target_date, day_start, day_end = result

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
        cameras.setdefault(ev.camera_name, []).append({
            "id": ev.id,
            "start": to_hms(ev.started_at),
            "end": to_hms(ev.ended_at),
            "filename": ev.filename,
            "size_mb": round(ev.file_size / (1024 * 1024), 1),
            "duration": ev.duration_seconds,
            "reason": ev.reason,
        })

    return api_response({"date": target_date.isoformat(), "cameras": cameras})


@bp.route("/<camera_name>/<filename>", methods=["GET"])
@login_required_api
def serve_event_clip(camera_name, filename):
    clips_dir = os.path.join(get_recordings_dir(), "clips")
    return serve_mp4_file(clips_dir, camera_name, filename)
