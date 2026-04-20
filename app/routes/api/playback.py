"""
Playback API — timeline segments + unified HLS entrypoint for live and recorded clips.

Assumptions:
- Recording rows use the same paths the recorder wrote (typically /recordings/... inside Docker).
- go2rtc shares the recordings volume so ffmpeg: file sources resolve for VOD.
- Live HLS uses the camera's *-main go2rtc stream key (same source as segment recording).
"""

from __future__ import annotations

import re
from datetime import datetime
from urllib.parse import urlencode

import requests
from flask import Blueprint, redirect, request, current_app
from flask_login import current_user
from app.models import Camera, Recording
from app.routes.api.utils import (
    api_error,
    api_response,
    require_auth,
    recordings_view_allowed,
    to_iso,
    accessible_camera_names,
)

bp = Blueprint("api_playback", __name__, url_prefix="/api")

_GO2RTC_STREAM_NAME_RE = re.compile(r"^[A-Za-z0-9_.:-]+$")


def _paired_main_name(cam: Camera) -> str | None:
    n = (cam.name or "").strip()
    if n.endswith("-main"):
        return n
    if n.endswith("-sub"):
        return n[: -len("-sub")] + "-main"
    pair = (getattr(cam, "paired_stream_name", None) or "").strip()
    if pair.endswith("-main"):
        return pair
    return None


def _main_camera_for_segments(cam: Camera) -> Camera | None:
    """Segments in DB are keyed by *-main stream names."""
    if (cam.name or "").endswith("-main"):
        return cam
    main_name = _paired_main_name(cam)
    if not main_name:
        return None
    return Camera.get_or_none(Camera.name == main_name)


def _user_can_access_camera(cam: Camera) -> bool:
    allowed = accessible_camera_names(current_user)
    if allowed is None:
        return True
    return cam.name in allowed


def _go2rtc_register_file_stream(stream_name: str, file_path: str) -> tuple[bool, str | None]:
    """Register a short-lived ffmpeg file source in go2rtc for HLS output."""
    base = (current_app.config.get("GO2RTC_URL") or "").rstrip("/")
    if not base:
        return False, "GO2RTC_URL is not configured."
    # go2rtc ffmpeg template: local file + input=file avoids treating URL as live stream.
    src = f"ffmpeg:{file_path}#video=copy#input=file"
    url = f"{base}/api/streams"
    try:
        r = requests.put(url, params={"name": stream_name, "src": src}, timeout=12)
        if r.ok:
            return True, None
        if r.status_code == 400:
            rp = requests.patch(url, params={"name": stream_name, "src": src}, timeout=12)
            if rp.ok:
                return True, None
            return False, (rp.text or rp.reason or "go2rtc PATCH error")[:500]
        if r.status_code >= 400:
            return False, (r.text or r.reason or "go2rtc error")[:500]
        return True, None
    except requests.RequestException as exc:
        current_app.logger.warning("go2rtc register stream failed: %s", exc)
        return False, str(exc)


def _pick_recording_for_time(camera_name: str, at: datetime) -> Recording | None:
    """
    Prefer a segment whose [started_at, ended_at) contains *at* (ended_at may be null).
    If none match, use the latest segment that started at or before *at*, else the earliest after.
    """
    q_base = (
        Recording.select()
        .where(
            (Recording.camera_name == camera_name)
            & (Recording.status == "complete")
        )
    )
    inside = (
        q_base.where(
            (Recording.started_at <= at)
            & (
                Recording.ended_at.is_null(True)
                | (Recording.ended_at > at)
            )
        )
        .order_by(Recording.started_at.desc())
    )
    hit = inside.first()
    if hit:
        return hit

    before = (
        q_base.where(Recording.started_at <= at)
        .order_by(Recording.started_at.desc())
        .first()
    )
    if before:
        return before

    return (
        q_base.where(Recording.started_at > at)
        .order_by(Recording.started_at.asc())
        .first()
    )


@bp.route("/segments", methods=["GET"])
@require_auth
@recordings_view_allowed
def list_segments():
    """
    Segment metadata for the playback timeline (Peewee / recording table).

    Query: camera_id (int), start, end (ISO 8601). Optional: limit (default 2000, max 5000).
    """
    cam_id = request.args.get("camera_id", type=int)
    start_s = request.args.get("start")
    end_s = request.args.get("end")
    if not cam_id or not start_s or not end_s:
        return api_error("camera_id, start, and end query parameters are required.", 400)

    try:
        start_dt = datetime.fromisoformat(start_s.replace("Z", "+00:00"))
        end_dt = datetime.fromisoformat(end_s.replace("Z", "+00:00"))
    except ValueError:
        return api_error("Invalid start or end datetime. Use ISO 8601.", 400)

    if end_dt <= start_dt:
        return api_error("end must be after start.", 400)

    try:
        cam = Camera.get_by_id(cam_id)
    except Camera.DoesNotExist:
        return api_error("Camera not found.", 404)

    if not _user_can_access_camera(cam):
        return api_error("Forbidden.", 403)

    main_cam = _main_camera_for_segments(cam)
    if main_cam is None:
        return api_response({"segments": [], "camera_id": cam_id, "stream_camera_id": None})

    limit = min(request.args.get("limit", default=2000, type=int) or 2000, 5000)

    q = (
        Recording.select()
        .where(
            (Recording.camera_name == main_cam.name)
            & (Recording.status == "complete")
            & (Recording.started_at < end_dt)
            & (
                Recording.ended_at.is_null(True)
                | (Recording.ended_at > start_dt)
            )
        )
        .order_by(Recording.started_at.asc())
        .limit(limit)
    )

    rows = []
    for rec in q:
        rows.append(
            {
                "id": rec.id,
                "camera_id": main_cam.id,
                "camera_name": rec.camera_name,
                "start_time": to_iso(rec.started_at),
                "end_time": to_iso(rec.ended_at),
                "file_path": rec.file_path,
                "filename": rec.filename,
                "duration_seconds": rec.duration_seconds,
            }
        )

    return api_response(
        {
            "segments": rows,
            "camera_id": cam_id,
            "stream_camera_id": main_cam.id,
        }
    )


@bp.route("/stream/<int:camera_id>/index.m3u8", methods=["GET"])
@require_auth
@recordings_view_allowed
def stream_index(camera_id: int):
    """
    Unified HLS entrypoint.

    - Default: redirect to go2rtc live HLS for the recording (main) stream.
    - recording_id=<id>: register a go2rtc ffmpeg file source for that DB row, then redirect.
    - at=<ISO>: resolve the segment row covering that instant (same as recording_id path).

    The browser follows the redirect; segment URLs inside the playlist stay on /go2rtc/...
    """
    recording_id = request.args.get("recording_id", type=int)
    at_s = request.args.get("at")

    try:
        cam = Camera.get_by_id(camera_id)
    except Camera.DoesNotExist:
        return api_error("Camera not found.", 404)

    if not _user_can_access_camera(cam):
        return api_error("Forbidden.", 403)

    main_cam = _main_camera_for_segments(cam)
    if main_cam is None:
        return api_error("Playback is only available for cameras with a paired main stream.", 400)

    stream_key = main_cam.name
    if not _GO2RTC_STREAM_NAME_RE.match(stream_key):
        return api_error("Invalid stream key.", 400)

    target_rec: Recording | None = None

    if recording_id is not None:
        try:
            target_rec = Recording.get_by_id(recording_id)
        except Recording.DoesNotExist:
            return api_error("Recording not found.", 404)
        if target_rec.camera_name != main_cam.name:
            return api_error("Recording does not belong to this camera.", 403)
    elif at_s:
        try:
            at_dt = datetime.fromisoformat(at_s.replace("Z", "+00:00"))
        except ValueError:
            return api_error("Invalid at datetime. Use ISO 8601.", 400)
        target_rec = _pick_recording_for_time(main_cam.name, at_dt)

    if target_rec is None and (recording_id is not None or at_s):
        return api_error("No recording segment found for the requested time range.", 404)

    if target_rec is not None:
        fp = (target_rec.file_path or "").strip()
        if not fp.endswith(".mp4"):
            return api_error("Invalid recording file.", 400)
        stream_name = f"opuspb{target_rec.id}"
        ok, err = _go2rtc_register_file_stream(stream_name, fp)
        if not ok:
            current_app.logger.warning("go2rtc VOD register failed: %s", err)
            return api_error(f"Could not prepare playback stream: {err or 'unknown error'}", 503)
        stream_key = stream_name

    # LivePlayer uses /go2rtc/api/stream.m3u8 — keep the same path for cache-friendly behavior.
    q = urlencode({"src": stream_key})
    return redirect(f"/go2rtc/api/stream.m3u8?{q}", code=302)
