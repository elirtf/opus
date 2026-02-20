import os
from datetime import datetime
from flask import Blueprint, current_app, send_from_directory
from app.models import Camera
from app.routes.api.utils import api_response, api_error, login_required_api, admin_required

bp = Blueprint("api_recordings", __name__, url_prefix="/api/recordings")

RECORDINGS_DIR = os.environ.get("RECORDINGS_DIR", "/recordings")


def parse_recording_dt(filename: str):
    """Parse datetime from go2rtc segment filename like 2024-01-15_14-00-00.mp4"""
    stem = filename.replace(".mp4", "")
    try:
        return datetime.strptime(stem, "%Y-%m-%d_%H-%M-%S")
    except ValueError:
        return None


def recording_to_dict(camera_name: str, filename: str) -> dict:
    path     = os.path.join(RECORDINGS_DIR, camera_name, filename)
    size     = os.path.getsize(path)
    dt       = parse_recording_dt(filename)
    return {
        "camera_name": camera_name,
        "filename":    filename,
        "size":        size,
        "size_mb":     round(size / 1024 / 1024, 1),
        "started_at":  dt.isoformat() if dt else None,
        "download_url": f"/api/recordings/{camera_name}/{filename}",
    }


@bp.route("/", methods=["GET"])
@login_required_api
@admin_required
def list_recordings():
    """
    Returns recordings grouped by camera.
    Optional query param: ?camera=camera-name to filter to one camera.
    """
    filter_camera = (
        current_app.request.args.get("camera")
        if hasattr(current_app, "request")
        else None
    )

    from flask import request
    filter_camera = request.args.get("camera")

    if not os.path.exists(RECORDINGS_DIR):
        return api_response({})

    result = {}

    # Get camera dirs that exist on disk
    try:
        cam_dirs = [
            d for d in os.listdir(RECORDINGS_DIR)
            if os.path.isdir(os.path.join(RECORDINGS_DIR, d))
        ]
    except PermissionError:
        return api_error("Cannot read recordings directory.", 500)

    if filter_camera:
        cam_dirs = [d for d in cam_dirs if d == filter_camera]

    for cam_name in sorted(cam_dirs):
        cam_dir = os.path.join(RECORDINGS_DIR, cam_name)
        files   = sorted([
            f for f in os.listdir(cam_dir)
            if f.endswith(".mp4")
        ], reverse=True)  # newest first

        if files:
            result[cam_name] = [recording_to_dict(cam_name, f) for f in files]

    return api_response(result)


@bp.route("/<camera_name>/<filename>", methods=["GET"])
@login_required_api
def serve_recording(camera_name, filename):
    """Serve a recording file for download or in-browser playback."""
    # Sanitize — prevent path traversal
    if ".." in camera_name or ".." in filename:
        return api_error("Invalid path.", 400)
    if not filename.endswith(".mp4"):
        return api_error("Invalid file type.", 400)

    cam_dir = os.path.join(RECORDINGS_DIR, camera_name)
    if not os.path.exists(os.path.join(cam_dir, filename)):
        return api_error("Recording not found.", 404)

    return send_from_directory(
        cam_dir,
        filename,
        as_attachment=False,  # allows in-browser playback
        mimetype="video/mp4",
    )