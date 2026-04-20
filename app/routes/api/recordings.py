"""
Recordings API
==============
Endpoints for browsing, querying, downloading, and managing recorded footage.

Key improvements over the original:
  - DB-backed queries instead of directory walks (fast even with millions of segments)
  - Access control: viewers can only access recordings for their assigned NVRs
  - Time-range queries for playback timeline
  - Recording engine status endpoint
  - Clip export (time-range extraction via FFmpeg)
  - Storage statistics
"""

import os
import requests
from datetime import datetime
from flask import Blueprint, request, current_app
from flask_login import current_user
from app.config import get_recordings_dir
from app.models import Recording, Camera
from app.routes.api.utils import (
    api_response,
    api_error,
    require_auth,
    require_admin,
    accessible_camera_names,
    to_iso,
    serve_mp4_file,
    parse_timeline_params,
    to_hms,
)

bp = Blueprint("api_recordings", __name__, url_prefix="/api/recordings")

# Docker: set to http://recorder:5055/status so the API can show recorder process status.
RECORDER_INTERNAL_STATUS_URL = os.environ.get("RECORDER_INTERNAL_STATUS_URL", "").strip()


@bp.before_request
def _recordings_perm():
    if request.method == "OPTIONS":
        return None
    if not current_user.is_authenticated:
        return None
    if current_user.is_admin:
        return None
    if getattr(current_user, "can_view_recordings", True):
        return None
    return api_error("Recorded footage access is disabled for this account.", 403)


# ── Helpers ───────────────────────────────────────────────────────────────────

def recording_to_dict(rec: Recording) -> dict:
    return {
        "id":               rec.id,
        "camera_name":      rec.camera_name,
        "filename":         rec.filename,
        "file_size":        rec.file_size,
        "size_mb":          round(rec.file_size / (1024 * 1024), 1),
        "started_at":       to_iso(rec.started_at),
        "ended_at":         to_iso(rec.ended_at),
        "duration_seconds": rec.duration_seconds,
        "status":           rec.status,
        "download_url":     f"/api/recordings/{rec.camera_name}/{rec.filename}",
    }


def _get_allowed_camera_names() -> set | None:
    """Set of camera names, or None for admin (no restriction)."""
    return accessible_camera_names(current_user)


def _main_stream_names() -> set[str]:
    rows = Camera.select(Camera.name).where(
        (Camera.name.endswith("-main")) | (Camera.stream_role == "main")
    )
    return {r.name for r in rows}


# ── List recordings ──────────────────────────────────────────────────────────

@bp.route("/", methods=["GET"])
@require_auth
def list_recordings():
    """
    List recordings with filtering and pagination.

    Query params:
      camera    — filter by camera name (exact match)
      start     — ISO datetime, only recordings starting after this
      end       — ISO datetime, only recordings starting before this
      limit     — max results (default 100, max 500)
      offset    — pagination offset (default 0)
      order     — "asc" or "desc" (default "desc" = newest first)

    Examples:
      GET /api/recordings/?camera=warehouse-ch1-main
      GET /api/recordings/?start=2024-01-15T00:00:00&end=2024-01-16T00:00:00
      GET /api/recordings/?camera=warehouse-ch1-main&start=2024-01-15T08:00:00&limit=50
    """
    # Access control
    allowed_cameras = _get_allowed_camera_names()
    if allowed_cameras is not None and not allowed_cameras:
        return api_response({"recordings": [], "total": 0})
    main_names = _main_stream_names()
    if allowed_cameras is None:
        allowed_cameras = main_names
    else:
        allowed_cameras = set(allowed_cameras).intersection(main_names)
    if not allowed_cameras:
        return api_response({"recordings": [], "total": 0})

    # Parse query params
    filter_camera = request.args.get("camera")
    start_str     = request.args.get("start")
    end_str       = request.args.get("end")
    limit         = min(int(request.args.get("limit", 100)), 500)
    offset        = int(request.args.get("offset", 0))
    order         = request.args.get("order", "desc")

    # Build query
    query = Recording.select().where(Recording.status == "complete")

    if filter_camera:
        # Enforce access control on the requested camera
        if allowed_cameras is not None and filter_camera not in allowed_cameras:
            return api_error("Access denied to this camera.", 403)
        query = query.where(Recording.camera_name == filter_camera)
    elif allowed_cameras is not None:
        query = query.where(Recording.camera_name.in_(allowed_cameras))

    if start_str:
        try:
            start_dt = datetime.fromisoformat(start_str)
            query = query.where(Recording.started_at >= start_dt)
        except ValueError:
            return api_error("Invalid 'start' datetime format. Use ISO 8601.", 400)

    if end_str:
        try:
            end_dt = datetime.fromisoformat(end_str)
            query = query.where(Recording.started_at <= end_dt)
        except ValueError:
            return api_error("Invalid 'end' datetime format. Use ISO 8601.", 400)

    # Count before pagination
    total = query.count()

    # Order and paginate
    if order == "asc":
        query = query.order_by(Recording.started_at.asc())
    else:
        query = query.order_by(Recording.started_at.desc())

    recordings = query.offset(offset).limit(limit)

    return api_response({
        "recordings": [recording_to_dict(r) for r in recordings],
        "total":      total,
        "limit":      limit,
        "offset":     offset,
    })


# ── Timeline (for playback UI) ───────────────────────────────────────────────

@bp.route("/timeline", methods=["GET"])
@require_auth
def timeline():
    """
    Compact timeline of recording availability for one or more cameras.
    Designed for the playback UI timeline scrubber.

    Query params:
      camera  — camera name (required, can repeat for multiple cameras)
      date    — ISO date string, e.g. "2024-01-15" (default: today)
    """
    result = parse_timeline_params()
    if not isinstance(result, tuple):
        return result
    camera_names, target_date, day_start, day_end = result
    main_names = _main_stream_names()
    camera_names = [n for n in camera_names if n in main_names]
    if not camera_names:
        return api_error("Playback timeline is available for main streams only.", 400)

    recs = (
        Recording.select()
        .where(
            (Recording.camera_name.in_(camera_names))
            & (Recording.started_at >= day_start)
            & (Recording.started_at < day_end)
            & (Recording.status == "complete")
        )
        .order_by(Recording.started_at.asc())
    )

    cameras = {name: [] for name in camera_names}
    for rec in recs:
        cameras.setdefault(rec.camera_name, []).append({
            "id":       rec.id,
            "start":    to_hms(rec.started_at),
            "end":      to_hms(rec.ended_at),
            "filename": rec.filename,
            "size_mb":  round(rec.file_size / (1024 * 1024), 1),
            "duration": rec.duration_seconds,
        })

    return api_response({"date": target_date.isoformat(), "cameras": cameras})


# ── Available dates (for date picker) ────────────────────────────────────────

@bp.route("/dates", methods=["GET"])
@require_auth
def available_dates():
    """
    Returns a list of dates that have recordings for a given camera.
    Used by the UI date picker to highlight which days have footage.

    Query params:
      camera — camera name (required)
      month  — ISO month string, e.g. "2024-01" (optional, defaults to current month)
    """
    camera_name = request.args.get("camera")
    if not camera_name:
        return api_error("'camera' query param is required.", 400)

    # Access control
    allowed_cameras = _get_allowed_camera_names()
    if allowed_cameras is not None and camera_name not in allowed_cameras:
        return api_error("Access denied.", 403)
    cam = Camera.get_or_none(Camera.name == camera_name)
    if cam is None:
        return api_error("Camera not found.", 404)
    role = getattr(cam, "stream_role", None) or ("sub" if cam.name.endswith("-sub") else "main")
    if role != "main":
        return api_error("Playback dates are available for main streams only.", 400)

    month_str = request.args.get("month")
    if month_str:
        try:
            month_start = datetime.strptime(month_str, "%Y-%m")
        except ValueError:
            return api_error("Invalid 'month' format. Use YYYY-MM.", 400)
    else:
        now = datetime.now()
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    # End of month
    if month_start.month == 12:
        month_end = month_start.replace(year=month_start.year + 1, month=1)
    else:
        month_end = month_start.replace(month=month_start.month + 1)

    from peewee import fn
    dates = (
        Recording.select(fn.DATE(Recording.started_at).alias("rec_date"))
        .where(
            (Recording.camera_name == camera_name)
            & (Recording.started_at >= month_start)
            & (Recording.started_at < month_end)
            & (Recording.status == "complete")
        )
        .distinct()
        .dicts()
    )

    date_list = sorted([str(d["rec_date"]) for d in dates])

    return api_response({
        "camera": camera_name,
        "month":  month_start.strftime("%Y-%m"),
        "dates":  date_list,
    })


# ── Serve recording file ─────────────────────────────────────────────────────

@bp.route("/<camera_name>/<filename>", methods=["GET"])
@require_auth
def serve_recording(camera_name, filename):
    """Serve a recording file for download or in-browser playback."""
    cam = Camera.get_or_none(Camera.name == camera_name)
    if cam is None:
        return api_error("Camera not found.", 404)
    role = getattr(cam, "stream_role", None) or ("sub" if cam.name.endswith("-sub") else "main")
    if role != "main":
        return api_error("Playback files are available for main streams only.", 400)
    return serve_mp4_file(get_recordings_dir(), camera_name, filename)


# ── Delete a recording ───────────────────────────────────────────────────────

@bp.route("/<int:recording_id>", methods=["DELETE"])
@require_admin
def delete_recording(recording_id):
    """Delete a single recording segment (file + DB record)."""
    try:
        rec = Recording.get_by_id(recording_id)
    except Recording.DoesNotExist:
        return api_error("Recording not found.", 404)

    # Delete file from disk
    try:
        if os.path.exists(rec.file_path):
            os.remove(rec.file_path)
    except OSError as e:
        current_app.logger.warning(f"Could not delete file {rec.file_path}: {e}")

    rec.delete_instance()
    return api_response(message="Recording deleted.")


# ── Bulk delete by camera + date range ────────────────────────────────────────

@bp.route("/bulk-delete", methods=["POST"])
@require_admin
def bulk_delete():
    """
    Delete recordings in a date range for a camera.

    Body: {
      "camera_name": "warehouse-ch1-main",
      "start": "2024-01-01T00:00:00",    // optional
      "end":   "2024-01-31T23:59:59"      // optional
    }
    """
    data = request.get_json(silent=True) or {}
    camera_name = (data.get("camera_name") or "").strip()

    if not camera_name:
        return api_error("camera_name is required.", 400)
    cam = Camera.get_or_none(Camera.name == camera_name)
    if cam is None:
        return api_error("Camera not found.", 404)
    role = getattr(cam, "stream_role", None) or ("sub" if cam.name.endswith("-sub") else "main")
    if role != "main":
        return api_error("Bulk delete is only supported for main stream recordings.", 400)

    query = Recording.select().where(Recording.camera_name == camera_name)

    if data.get("start"):
        try:
            query = query.where(Recording.started_at >= datetime.fromisoformat(data["start"]))
        except ValueError:
            return api_error("Invalid 'start' datetime.", 400)

    if data.get("end"):
        try:
            query = query.where(Recording.started_at <= datetime.fromisoformat(data["end"]))
        except ValueError:
            return api_error("Invalid 'end' datetime.", 400)

    deleted = 0
    for rec in query:
        try:
            if os.path.exists(rec.file_path):
                os.remove(rec.file_path)
        except OSError:
            pass
        rec.delete_instance()
        deleted += 1

    return api_response(
        {"deleted": deleted},
        message=f"Deleted {deleted} recordings for {camera_name}.",
    )


# ── Storage stats ─────────────────────────────────────────────────────────────

def _scan_mp4_folder(folder):
    """Non-recursive MP4 count/size under folder. Returns (count, bytes, oldest, newest)."""
    cam_count = 0
    cam_bytes = 0
    oldest_file = None
    newest_file = None
    if not os.path.isdir(folder):
        return 0, 0, None, None
    try:
        files = sorted(f for f in os.listdir(folder) if f.endswith(".mp4"))
    except OSError:
        return 0, 0, None, None
    for fn in files:
        fp = os.path.join(folder, fn)
        try:
            sz = os.path.getsize(fp)
        except OSError:
            continue
        if sz < 1024:
            continue
        cam_bytes += sz
        cam_count += 1
        if oldest_file is None:
            oldest_file = fn
        newest_file = fn
    return cam_count, cam_bytes, oldest_file, newest_file


@bp.route("/storage", methods=["GET"])
@require_auth
def storage_stats():
    """
    Filesystem-backed stats: rolling segments under <dir>/<camera>/ and motion clips
    under <dir>/clips/<camera>/ (events_only). Uses the same recordings path as settings.
    """
    recordings_dir = get_recordings_dir()
    by_cam = {}
    total_segment_files = 0
    total_clip_files = 0
    all_bytes = 0

    def _row(name):
        if name not in by_cam:
            by_cam[name] = {
                "camera_name": name,
                "segment_count": 0,
                "clip_count": 0,
                "total_bytes": 0,
                "total_gb": 0.0,
                "oldest": None,
                "newest": None,
            }
        return by_cam[name]

    if os.path.exists(recordings_dir):
        try:
            for cam_name in sorted(os.listdir(recordings_dir)):
                if cam_name == "clips":
                    continue
                cam_dir = os.path.join(recordings_dir, cam_name)
                if not os.path.isdir(cam_dir):
                    continue
                cnt, bts, old, new = _scan_mp4_folder(cam_dir)
                if cnt <= 0:
                    continue
                r = _row(cam_name)
                r["segment_count"] += cnt
                r["total_bytes"] += bts
                all_bytes += bts
                total_segment_files += cnt
                if old:
                    r["oldest"] = old if r["oldest"] is None else min(r["oldest"], old)
                if new:
                    r["newest"] = new if r["newest"] is None else max(r["newest"], new)

            clips_root = os.path.join(recordings_dir, "clips")
            if os.path.isdir(clips_root):
                for cam_name in sorted(os.listdir(clips_root)):
                    cdir = os.path.join(clips_root, cam_name)
                    if not os.path.isdir(cdir):
                        continue
                    cnt, bts, old, new = _scan_mp4_folder(cdir)
                    if cnt <= 0:
                        continue
                    r = _row(cam_name)
                    r["clip_count"] += cnt
                    r["total_bytes"] += bts
                    all_bytes += bts
                    total_clip_files += cnt
                    if old:
                        r["oldest"] = old if r["oldest"] is None else min(r["oldest"], old)
                    if new:
                        r["newest"] = new if r["newest"] is None else max(r["newest"], new)
        except OSError:
            pass

    cameras = []
    for name in sorted(by_cam.keys()):
        row = by_cam[name]
        tb = row["total_bytes"]
        row["total_gb"] = round(tb / (1024**3), 2) if tb else 0.0
        cameras.append(row)

    from app.services.disk_usage import get_disk_usage

    return api_response({
        "recordings_dir":  recordings_dir,
        "cameras":         cameras,
        "total_segments":  total_segment_files,
        "total_clips":     total_clip_files,
        "total_files":     total_segment_files + total_clip_files,
        "total_gb":        round(all_bytes / (1024**3), 2),
        "total_bytes":     all_bytes,
        "disk":            get_disk_usage(recordings_dir),
    })


# ── Recording engine status ──────────────────────────────────────────────────

@bp.route("/engine/status", methods=["GET"])
@require_auth
def engine_status():
    """Returns the current status of the recording engine (processes, storage, config)."""
    from app.recorder import engine

    if engine is not None:
        return api_response(engine.get_status())

    if RECORDER_INTERNAL_STATUS_URL:
        try:
            r = requests.get(RECORDER_INTERNAL_STATUS_URL, timeout=4)
            if r.ok:
                data = r.json()
                if isinstance(data, dict):
                    data.setdefault("status_source", "recorder_container")
                    return api_response(data)
        except Exception as exc:
            current_app.logger.warning("Recorder status fetch failed: %s", exc)

    return api_response({
        "engine_running": False,
        "active_recordings": 0,
        "total_processes": 0,
        "shelved_count": 0,
        "processes": {},
        "shelved": [],
        "message": (
            "Recording runs in a separate service. Set RECORDER_INTERNAL_STATUS_URL on the API "
            "(e.g. http://recorder:5055/status) and ensure the recorder container is up."
        ),
        "status_source": "api_placeholder",
    })


@bp.route("/reconcile-storage", methods=["POST"])
@require_admin
def reconcile_storage():
    """
    Remove database rows for segment/event files that no longer exist on disk.
    Use after wiping the recordings volume or restoring from backup.
    """
    from app.recording_reconcile import reconcile_storage_with_db

    r, e = reconcile_storage_with_db()
    return api_response(
        {"removed_segments": r, "removed_events": e},
        message=f"Reconciled: removed {r} segment row(s), {e} event row(s).",
    )


@bp.route("/engine/rescan", methods=["POST"])
@require_admin
def force_rescan():
    """
    Force an immediate segment scan and return what was found.
    Useful for debugging when recordings exist on disk but don't show in the API.
    """
    from app.recorder import engine

    if engine is None:
        return api_error(
            "Segment scan runs inside the recorder container. Ensure opus-recorder is running, "
            "or use the recorder service logs to verify FFmpeg.",
            503,
        )

    # Get counts before
    before_count = Recording.select().count()

    # Force a scan
    try:
        engine._scan_segments()
    except Exception as e:
        return api_error(f"Scan failed: {str(e)}", 500)

    # Get counts after
    after_count = Recording.select().count()

    # Also report what's on disk
    disk_report = {}
    recordings_dir = get_recordings_dir()
    if os.path.exists(recordings_dir):
        for cam_name in sorted(os.listdir(recordings_dir)):
            cam_dir = os.path.join(recordings_dir, cam_name)
            if os.path.isdir(cam_dir):
                files = [f for f in os.listdir(cam_dir) if f.endswith(".mp4")]
                if files:
                    sizes = []
                    for f in files:
                        try:
                            sizes.append(os.path.getsize(os.path.join(cam_dir, f)))
                        except OSError:
                            sizes.append(0)
                    disk_report[cam_name] = {
                        "file_count": len(files),
                        "newest": sorted(files)[-1] if files else None,
                        "oldest": sorted(files)[0] if files else None,
                        "total_mb": round(sum(sizes) / (1024 * 1024), 1),
                        "smallest_kb": round(min(sizes) / 1024, 1) if sizes else 0,
                    }

    return api_response({
        "db_before": before_count,
        "db_after": after_count,
        "new_registered": after_count - before_count,
        "disk": disk_report,
    }, message=f"Scan complete. {after_count - before_count} new segments registered.")


# ── RTSP Diagnostics ─────────────────────────────────────────────────────────

@bp.route("/diagnose/<int:cam_id>", methods=["POST"])
@require_admin
def diagnose_camera(cam_id):
    """
    Test whether FFmpeg can connect to a camera's RTSP stream.
    Returns codec info, resolution, FPS, and any connection errors.

    Use this to debug why a camera isn't recording.
    """
    from app.recorder import RecordingEngine, engine

    try:
        cam = Camera.get_by_id(cam_id)
    except Camera.DoesNotExist:
        return api_error("Camera not found.", 404)

    result = RecordingEngine.test_rtsp(cam.rtsp_url)
    result["camera_name"] = cam.name
    result["camera_display"] = cam.display_name

    if engine is not None:
        status = engine.get_status()
        proc_info = status.get("processes", {}).get(cam.name)
        result["recording_process"] = proc_info
    else:
        result["recording_process"] = None
        result["note"] = "FFmpeg recording runs in the recorder container; process list is only available there."

    return api_response(result)


@bp.route("/diagnose/url", methods=["POST"])
@require_admin
def diagnose_url():
    """
    Test any RTSP URL directly (doesn't need to be a saved camera).
    Useful for testing URLs before adding a camera.

    Body: { "rtsp_url": "rtsp://user:pass@192.168.1.100:554/stream" }
    """
    from app.recorder import RecordingEngine

    data = request.get_json(silent=True) or {}
    rtsp_url = (data.get("rtsp_url") or "").strip()

    if not rtsp_url:
        return api_error("rtsp_url is required.", 400)

    if not rtsp_url.startswith("rtsp://"):
        return api_error("URL must start with rtsp://", 400)

    result = RecordingEngine.test_rtsp(rtsp_url)
    return api_response(result)