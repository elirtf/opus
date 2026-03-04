import re
import time
import requests as http
from flask import Blueprint, request, current_app, Response
from flask_login import current_user
from app.models import Camera, NVR
from app.routes.api.utils import api_response, api_error, login_required_api, admin_required
from app.go2rtc import stream_sync, stream_delete

bp = Blueprint("api_cameras", __name__, url_prefix="/api/cameras")

# ── Helpers ───────────────────────────────────────────────────────────────────

_CRED_RE = re.compile(r"(rtsp://)([^@]+)@", re.IGNORECASE)

# State cache (in-memory)
_STATE_TTL_SECONDS = 2.0
_state_cache = {
    "ts": 0.0,
    "health": {},  # { stream_name: bool }
}

def _mask_rtsp(url: str):
    """Strip credentials from rtsp://user:pass@host/... → rtsp://***:***@host/..."""
    if not url:
        return url
    return _CRED_RE.sub(r"\1***:***@", url)

def _is_original_admin():
    """Original admin = first user ever created (id 1). Only they control recording."""
    return (
            current_user.is_authenticated
            and current_user.is_admin
            and current_user.id == 1
    )

def _fetch_go2rtc_streams():
    """
    Raw go2rtc stream data from /api/streams.
    Returns dict: { stream_name: {...} }
    """
    res = http.get(
        f"{current_app.config['GO2RTC_URL']}/api/streams",
        timeout=3,
    )
    return res.json()

def _get_stream_health_cached():
    """
    Returns { stream_name: bool } where True = has producers.
    Cached briefly to avoid hammering go2rtc when UI refreshes a lot.
    """
    now = time.time()
    if (now - _state_cache["ts"]) < _STATE_TTL_SECONDS:
        return _state_cache["health"]

    try:
        streams = _fetch_go2rtc_streams()
        health = {}
        for name, info in streams.items():
            producers = info.get("producers") or []
            health[name] = len(producers) > 0

        _state_cache["ts"] = now
        _state_cache["health"] = health
        return health
    except Exception as e:
        current_app.logger.warning(f"go2rtc health fetch failed: {e}")
        # Don't blow up the page; return last known cache or empty
        return _state_cache.get("health", {}) or {}

def camera_to_dict(cam, nvr_map=None, health_map=None):
    nvr_name = None
    if cam.nvr and nvr_map:
        nvr = nvr_map.get(cam.nvr)
        nvr_name = nvr.display_name if nvr else None

    online = None
    if health_map is not None:
        online = health_map.get(cam.name)

    return {
        "id":                cam.id,
        "name":              cam.name,
        "display_name":      cam.display_name,
        "rtsp_url":          _mask_rtsp(cam.rtsp_url),
        "nvr_id":            cam.nvr,
        "nvr_name":          nvr_name,
        "active":            cam.active,
        "recording_enabled": cam.recording_enabled,
        "is_main":           cam.name.endswith("-main"),
        "is_sub":            cam.name.endswith("-sub"),
        # keep your existing stream_url for compatibility
        "stream_url":        f"/go2rtc/stream.html?src={cam.name}&mode=mse",
        # Runtime field (optional for frontend)
        "online":            online,
    }

# ── Configuration Endpoints (Your existing API, kept intact) ─────────────────

@bp.route("/", methods=["GET"])
@login_required_api
def list_cameras():
    allowed = current_user.allowed_nvr_ids()

    query = Camera.select().order_by(Camera.name)
    if allowed is not None:
        if not allowed:
            return api_response([])
        query = query.where(Camera.nvr.in_(allowed))

    nvr_map = {nvr.id: nvr for nvr in NVR.select()}
    return api_response([camera_to_dict(c, nvr_map) for c in query])


@bp.route("/", methods=["POST"])
@login_required_api
@admin_required
def create_camera():
    data         = request.get_json(silent=True) or {}
    name         = (data.get("name") or "").strip()
    display_name = (data.get("display_name") or "").strip()
    rtsp_url     = (data.get("rtsp_url") or "").strip()

    if not name or not display_name or not rtsp_url:
        return api_error("name, display_name, and rtsp_url are required.")
    if Camera.select().where(Camera.name == name).exists():
        return api_error(f'Stream name "{name}" is already taken.')

    # Main streams always auto-record
    auto_record = name.endswith("-main")

    cam = Camera.create(
        name=name,
        display_name=display_name,
        rtsp_url=rtsp_url,
        nvr=data.get("nvr_id") or None,
        active=data.get("active", True),
        recording_enabled=auto_record,
    )
    stream_sync(cam)
    nvr_map = {nvr.id: nvr for nvr in NVR.select()}
    return api_response(camera_to_dict(cam, nvr_map), message="Camera created.", status=201)


@bp.route("/<int:cam_id>", methods=["PATCH"])
@login_required_api
@admin_required
def update_camera(cam_id):
    try:
        cam = Camera.get_by_id(cam_id)
    except Camera.DoesNotExist:
        return api_error("Camera not found.", 404)

    data     = request.get_json(silent=True) or {}
    old_name = cam.name

    if "name"              in data: cam.name              = (data["name"] or "").strip()
    if "display_name"      in data: cam.display_name      = (data["display_name"] or "").strip()
    if "rtsp_url"          in data: cam.rtsp_url          = (data["rtsp_url"] or "").strip()
    if "nvr_id"            in data: cam.nvr               = data["nvr_id"] or None
    if "active"            in data: cam.active            = bool(data["active"])

    # Only the original administrator can change recording state
    if "recording_enabled" in data:
        if not _is_original_admin():
            return api_error("Only the original administrator can change recording settings.", 403)
        if bool(data["recording_enabled"]) and not cam.name.endswith("-main"):
            return api_error("Recording is only supported on main streams.", 400)
        cam.recording_enabled = bool(data["recording_enabled"])

    cam.save()

    if old_name != cam.name:
        stream_delete(old_name)
    stream_sync(cam)

    nvr_map = {nvr.id: nvr for nvr in NVR.select()}
    return api_response(camera_to_dict(cam, nvr_map), message="Camera updated.")


@bp.route("/<int:cam_id>/recording", methods=["POST"], strict_slashes=False)
@login_required_api
def toggle_recording(cam_id):
    """Toggle recording — ONLY the original administrator (user id=1) can do this."""
    if not _is_original_admin():
        return api_error("Only the original administrator can change recording settings.", 403)

    try:
        cam = Camera.get_by_id(cam_id)
    except Camera.DoesNotExist:
        return api_error("Camera not found.", 404)

    data = request.get_json(silent=True) or {}
    if "enabled" not in data:
        return api_error('"enabled" field is required.')

    if bool(data["enabled"]) and not cam.name.endswith("-main"):
        return api_error("Recording is only supported on main streams.", 400)

    cam.recording_enabled = bool(data["enabled"])
    cam.save()
    stream_sync(cam)

    status = "enabled" if cam.recording_enabled else "disabled"
    return api_response(
        {"recording_enabled": cam.recording_enabled},
        message=f'Recording {status} for "{cam.display_name}".'
    )


@bp.route("/<int:cam_id>", methods=["DELETE"])
@login_required_api
@admin_required
def delete_camera(cam_id):
    try:
        cam = Camera.get_by_id(cam_id)
    except Camera.DoesNotExist:
        return api_error("Camera not found.", 404)

    stream_delete(cam.name)
    name = cam.display_name
    cam.delete_instance()
    return api_response(message=f'Camera "{name}" deleted.')

# ── Runtime Endpoints ───────────────────────────

@bp.route("/summary", methods=["GET"])
@login_required_api
def cameras_summary():
    """
    One request to power the entire dashboard grid.
    Includes runtime online status (cached).
    """
    allowed = current_user.allowed_nvr_ids()

    query = Camera.select().order_by(Camera.name)
    if allowed is not None:
        if not allowed:
            return api_response([])
        query = query.where(Camera.nvr.in_(allowed))

    nvr_map = {nvr.id: nvr for nvr in NVR.select()}
    health = _get_stream_health_cached()

    return api_response([camera_to_dict(c, nvr_map, health) for c in query])


@bp.route("/<string:name>/status", methods=["GET"])
@login_required_api
def camera_status(name: str):
    """
    Status: online + recording flag + metadata.
    """
    allowed = current_user.allowed_nvr_ids()
    try:
        cam = Camera.get(Camera.name == name)
    except Camera.DoesNotExist:
        return api_error("Camera not found.", 404)

    if allowed is not None and (cam.nvr not in allowed):
        return api_error("Forbidden.", 403)

    health = _get_stream_health_cached()

    return api_response({
        "name": cam.name,
        "display_name": cam.display_name,
        "nvr_id": cam.nvr,
        "active": cam.active,
        "recording_enabled": cam.recording_enabled,
        "online": health.get(cam.name),
    })


@bp.route("/<string:name>/streams", methods=["GET"])
@login_required_api
def camera_streams(name: str):
    """
    Stream endpoints so the frontend doesn't hardcode URLs.
    """
    allowed = current_user.allowed_nvr_ids()
    try:
        cam = Camera.get(Camera.name == name)
    except Camera.DoesNotExist:
        return api_error("Camera not found.", 404)

    if allowed is not None and (cam.nvr not in allowed):
        return api_error("Forbidden.", 403)

    return api_response({
        "webrtc": f"/go2rtc/api/webrtc?src={name}",
        "mse": f"/go2rtc/stream.mse?src={name}",
        "hls": f"/go2rtc/stream.m3u8?src={name}",
        "html": f"/go2rtc/stream.html?src={name}&mode=mse",
    })


@bp.route("/<string:name>/snapshot", methods=["GET"])
@login_required_api
def camera_snapshot(name: str):
    """
    Snapshot.
    We proxy go2rtc's frame endpoint (if available) so the browser can fetch
    via Opus auth/session.

    NOTE: go2rtc commonly supports /api/frame.jpg?src=<name>.
    If your go2rtc build uses a different path, tell me and I'll adjust.
    """
    allowed = current_user.allowed_nvr_ids()
    try:
        cam = Camera.get(Camera.name == name)
    except Camera.DoesNotExist:
        return api_error("Camera not found.", 404)

    if allowed is not None and (cam.nvr not in allowed):
        return api_error("Forbidden.", 403)

    try:
        url = f"{current_app.config['GO2RTC_URL']}/api/frame.jpg"
        res = http.get(url, params={"src": name}, timeout=3)
        if res.status_code != 200 or not res.content:
            return api_error("Snapshot unavailable.", 404)

        return Response(
            res.content,
            status=200,
            mimetype=res.headers.get("Content-Type", "image/jpeg"),
            headers={
                "Cache-Control": "no-store",
            },
        )
    except Exception as e:
        current_app.logger.warning(f"snapshot proxy failed for {name}: {e}")
        return api_error("Snapshot unavailable.", 404)