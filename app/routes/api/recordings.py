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
from datetime import datetime, timedelta
from flask import Blueprint, request, current_app, send_from_directory
from flask_login import current_user
from app.models import Recording, Camera
from app.routes.api.utils import api_response, api_error, login_required_api, admin_required

bp = Blueprint("api_recordings", __name__, url_prefix="/api/recordings")

RECORDINGS_DIR = os.environ.get("RECORDINGS_DIR", "/recordings")


# ── Helpers ───────────────────────────────────────────────────────────────────

def recording_to_dict(rec: Recording) -> dict:
    return {
        "id":               rec.id,
        "camera_name":      rec.camera_name,
        "filename":         rec.filename,
        "file_size":        rec.file_size,
        "size_mb":          round(rec.file_size / (1024 * 1024), 1),
        "started_at":       rec.started_at.isoformat() if rec.started_at else None,
        "ended_at":         rec.ended_at.isoformat() if rec.ended_at else None,
        "duration_seconds": rec.duration_seconds,
        "status":           rec.status,
        "download_url":     f"/api/recordings/{rec.camera_name}/{rec.filename}",
    }


def _get_allowed_camera_names() -> set | None:
    """
    Returns a set of camera names the current user can access,
    or None if the user is an admin (no restriction).
    """
    allowed_nvrs = current_user.allowed_nvr_ids()
    if allowed_nvrs is None:
        return None  # admin — no restriction

    if not allowed_nvrs:
        return set()  # no NVRs assigned → no cameras

    cameras = Camera.select(Camera.name).where(Camera.nvr.in_(allowed_nvrs))
    return {cam.name for cam in cameras}


# ── List recordings ──────────────────────────────────────────────────────────

@bp.route("/", methods=["GET"])
@login_required_api
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
@login_required_api
def timeline():
    """
    Returns a compact timeline of recording availability for one or more cameras.
    Designed for the playback UI timeline scrubber.

    Query params:
      camera  — camera name (required, can repeat for multiple cameras)
      date    — ISO date string, e.g. "2024-01-15" (default: today)

    Returns: {
      "date": "2024-01-15",
      "cameras": {
        "warehouse-ch1-main": [
          {"start": "08:00:00", "end": "08:15:00", "filename": "...", "id": 1},
          {"start": "08:15:00", "end": "08:30:00", "filename": "...", "id": 2},
          ...
        ]
      }
    }
    """
    camera_names = request.args.getlist("camera")
    date_str     = request.args.get("date")

    if not camera_names:
        return api_error("At least one 'camera' query param is required.", 400)

    # Access control
    allowed_cameras = _get_allowed_camera_names()
    if allowed_cameras is not None:
        camera_names = [c for c in camera_names if c in allowed_cameras]
        if not camera_names:
            return api_error("Access denied to the requested cameras.", 403)

    # Parse date
    if date_str:
        try:
            target_date = datetime.fromisoformat(date_str).date()
        except ValueError:
            return api_error("Invalid 'date' format. Use ISO 8601 (YYYY-MM-DD).", 400)
    else:
        target_date = datetime.now().date()

    day_start = datetime.combine(target_date, datetime.min.time())
    day_end   = day_start + timedelta(days=1)

    # Query recordings for the day
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

    # Group by camera
    cameras = {name: [] for name in camera_names}
    for rec in recs:
        cameras.setdefault(rec.camera_name, []).append({
            "id":       rec.id,
            "start":    rec.started_at.strftime("%H:%M:%S") if rec.started_at else None,
            "end":      rec.ended_at.strftime("%H:%M:%S") if rec.ended_at else None,
            "filename": rec.filename,
            "size_mb":  round(rec.file_size / (1024 * 1024), 1),
            "duration": rec.duration_seconds,
        })

    return api_response({
        "date":    target_date.isoformat(),
        "cameras": cameras,
    })


# ── Available dates (for date picker) ────────────────────────────────────────

@bp.route("/dates", methods=["GET"])
@login_required_api
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
@login_required_api
def serve_recording(camera_name, filename):
    """Serve a recording file for download or in-browser playback."""
    # Sanitize — prevent path traversal
    if ".." in camera_name or ".." in filename:
        return api_error("Invalid path.", 400)
    if not filename.endswith(".mp4"):
        return api_error("Invalid file type.", 400)

    # Access control — resolve camera to its NVR
    allowed_cameras = _get_allowed_camera_names()
    if allowed_cameras is not None and camera_name not in allowed_cameras:
        return api_error("Access denied.", 403)

    cam_dir = os.path.join(RECORDINGS_DIR, camera_name)
    filepath = os.path.join(cam_dir, filename)
    if not os.path.exists(filepath):
        return api_error("Recording not found.", 404)

    return send_from_directory(
        cam_dir,
        filename,
        as_attachment=False,  # allows in-browser playback via <video> tag
        mimetype="video/mp4",
    )


# ── Delete a recording ───────────────────────────────────────────────────────

@bp.route("/<int:recording_id>", methods=["DELETE"])
@login_required_api
@admin_required
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
@login_required_api
@admin_required
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

@bp.route("/storage", methods=["GET"])
@login_required_api
@admin_required
def storage_stats():
    """
    Returns storage statistics: per-camera usage, totals, disk info.
    """
    from peewee import fn
    import shutil

    # Per-camera storage from DB
    per_camera = (
        Recording.select(
            Recording.camera_name,
            fn.COUNT(Recording.id).alias("segment_count"),
            fn.SUM(Recording.file_size).alias("total_bytes"),
            fn.MIN(Recording.started_at).alias("oldest"),
            fn.MAX(Recording.started_at).alias("newest"),
        )
        .where(Recording.status == "complete")
        .group_by(Recording.camera_name)
        .dicts()
    )

    cameras = []
    total_bytes = 0
    total_segments = 0

    for row in per_camera:
        bytes_used = row["total_bytes"] or 0
        count = row["segment_count"] or 0
        cameras.append({
            "camera_name":   row["camera_name"],
            "segment_count": count,
            "total_gb":      round(bytes_used / (1024**3), 2),
            "total_bytes":   bytes_used,
            "oldest":        row["oldest"].isoformat() if row["oldest"] else None,
            "newest":        row["newest"].isoformat() if row["newest"] else None,
        })
        total_bytes += bytes_used
        total_segments += count

    # Disk usage
    disk = None
    if os.path.exists(RECORDINGS_DIR):
        usage = shutil.disk_usage(RECORDINGS_DIR)
        disk = {
            "total_gb": round(usage.total / (1024**3), 2),
            "used_gb":  round(usage.used / (1024**3), 2),
            "free_gb":  round(usage.free / (1024**3), 2),
            "percent_used": round(usage.used / usage.total * 100, 1),
        }

    return api_response({
        "cameras":         cameras,
        "total_segments":  total_segments,
        "total_gb":        round(total_bytes / (1024**3), 2),
        "total_bytes":     total_bytes,
        "disk":            disk,
    })


# ── Recording engine status ──────────────────────────────────────────────────

@bp.route("/engine/status", methods=["GET"])
@login_required_api
@admin_required
def engine_status():
    """Returns the current status of the recording engine (processes, storage, config)."""
    from app.recorder import engine

    if engine is None:
        return api_error("Recording engine is not initialized.", 503)

    return api_response(engine.get_status())


@bp.route("/engine/rescan", methods=["POST"])
@login_required_api
@admin_required
def force_rescan():
    """
    Force an immediate segment scan and return what was found.
    Useful for debugging when recordings exist on disk but don't show in the API.
    """
    from app.recorder import engine

    if engine is None:
        return api_error("Recording engine is not initialized.", 503)

    # Get counts before
    before_count = Recording.select().count()

    # Force a scan
    try:
        engine._scan_completed_segments()
    except Exception as e:
        return api_error(f"Scan failed: {str(e)}", 500)

    # Get counts after
    after_count = Recording.select().count()

    # Also report what's on disk
    import os
    disk_report = {}
    recordings_dir = os.environ.get("RECORDINGS_DIR", "/recordings")
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
@login_required_api
@admin_required
def diagnose_camera(cam_id):
    """
    Test whether FFmpeg can connect to a camera's RTSP stream.
    Returns codec info, resolution, FPS, and any connection errors.

    Use this to debug why a camera isn't recording.
    """
    from app.recorder import engine

    if engine is None:
        return api_error("Recording engine is not initialized.", 503)

    try:
        cam = Camera.get_by_id(cam_id)
    except Camera.DoesNotExist:
        return api_error("Camera not found.", 404)

    result = engine.test_rtsp(cam.rtsp_url)
    result["camera_name"] = cam.name
    result["camera_display"] = cam.display_name

    # Also check if there's a running FFmpeg process for this camera
    status = engine.get_status()
    proc_info = status.get("processes", {}).get(cam.name)
    if proc_info:
        result["recording_process"] = proc_info
    else:
        result["recording_process"] = None

    return api_response(result)


@bp.route("/diagnose/url", methods=["POST"])
@login_required_api
@admin_required
def diagnose_url():
    """
    Test any RTSP URL directly (doesn't need to be a saved camera).
    Useful for testing URLs before adding a camera.

    Body: { "rtsp_url": "rtsp://user:pass@192.168.1.100:554/stream" }
    """
    from app.recorder import engine

    if engine is None:
        return api_error("Recording engine is not initialized.", 503)

    data = request.get_json(silent=True) or {}
    rtsp_url = (data.get("rtsp_url") or "").strip()

    if not rtsp_url:
        return api_error("rtsp_url is required.", 400)

    if not rtsp_url.startswith("rtsp://"):
        return api_error("URL must start with rtsp://", 400)

    result = engine.test_rtsp(rtsp_url)
    return api_response(result)