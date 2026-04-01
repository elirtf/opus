import re
import time
import requests as http
from flask import Blueprint, request, current_app
from flask_login import current_user

from app.models import Camera, NVR
from app.services.camera_stream_health import (
    camera_online_from_health_map,
    fetch_stream_online_map,
    health_lookup_stream_name,
)
from app.routes.api.utils import (
    api_response,
    api_error,
    login_required_api,
    admin_required,
    camera_catalog_allowed,
    live_playback_allowed,
    accessible_camera_names,
    is_original_admin,
)

RECORDING_POLICIES = frozenset({"off", "continuous", "events_only"})
from app.go2rtc import stream_sync, stream_delete, validate_stream_url_for_go2rtc

bp = Blueprint("api_cameras", __name__, url_prefix="/api/cameras")

# ── Helpers ───────────────────────────────────────────────────────────────────

_CRED_RE = re.compile(r"(rtsp://)([^@]+)@", re.IGNORECASE)

# Fast in-memory stream health cache to avoid hammering go2rtc when the UI refreshes.
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


def _rtsp_hostname(url: str):
    if not url:
        return None
    try:
        from urllib.parse import urlparse

        return urlparse(url).hostname
    except Exception:
        return None


def _guess_channel_from_name(name: str):
    m = re.search(r"-ch(\d+)-", name or "")
    return int(m.group(1)) if m else None


def _cameras_query_for_user():
    """Ordered camera query scoped by NVR + optional UserCamera rows. None = no access."""
    allowed_nvrs = current_user.allowed_nvr_ids()
    q = Camera.select().order_by(Camera.name)
    if allowed_nvrs is not None:
        if not allowed_nvrs:
            return None
        q = q.where(Camera.nvr.in_(allowed_nvrs))
    subset = current_user.allowed_camera_ids_subset()
    if subset is not None:
        q = q.where(Camera.id.in_(subset))
    return q


def _sync_policy_and_enabled(cam: Camera):
    if cam.recording_policy == "off":
        cam.recording_enabled = False
    else:
        cam.recording_enabled = True


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
        health = fetch_stream_online_map(current_app.config["GO2RTC_URL"])
        if health is None:
            raise RuntimeError("go2rtc unreachable")
        _state_cache["ts"] = now
        _state_cache["health"] = health
        return health
    except Exception as e:
        current_app.logger.warning(f"go2rtc health fetch failed: {e}")
        # Don’t blow up the UI—return the last known cache or empty.
        return _state_cache.get("health", {}) or {}


def _live_view_playback_warnings(video_codec: str | None) -> list[dict[str, str]]:
    """
    go2rtc WebRTC requires codecs the browser can negotiate (typically H.264, VP8, VP9, AV1).
    H.265/HEVC from the camera often yields: codecs not matched: video:H265 => ...
    """
    if not video_codec:
        return []
    u = (video_codec or "").upper().replace(" ", "")
    if "265" in u or "HEVC" in u:
        return [
            {
                "code": "HEVC_WEBRTC",
                "message": (
                    "This stream is H.265 (HEVC). Web browsers cannot negotiate H.265 over WebRTC, "
                    "so go2rtc reports a codec mismatch (for example: video:H265 vs H.264/VP8/VP9/AV1). "
                    "Configure an H.264 sub stream, or add FFmpeg transcoding in go2rtc — see go2rtc/README-HEVC.md."
                ),
            }
        ]
    return []


def _live_view_stream_name(cam, all_camera_names=None):
    """
    go2rtc stream key for live preview: use sub when configured (rtsp_substream_url or paired *-sub row).
    Recording and motion analysis always use the main stream's rtsp_url on *-main cameras.
    """
    if not cam.name.endswith("-main"):
        return cam.name
    sub_name = cam.name.replace("-main", "-sub", 1)
    if (getattr(cam, "rtsp_substream_url", None) or "").strip():
        return sub_name
    if all_camera_names is not None:
        if sub_name in all_camera_names:
            return sub_name
    else:
        if Camera.select().where(Camera.name == sub_name).exists():
            return sub_name
    return cam.name


def camera_to_dict(cam, nvr_map=None, health_map=None, all_camera_names=None):
    nvr_name = None
    if cam.nvr and nvr_map:
        nvr = nvr_map.get(cam.nvr)
        nvr_name = nvr.display_name if nvr else None

    online = None
    if health_map is not None:
        online = camera_online_from_health_map(cam.name, health_map)

    sub = getattr(cam, "rtsp_substream_url", None)
    return {
        "id": cam.id,
        "name": cam.name,
        "display_name": cam.display_name,
        "rtsp_url": _mask_rtsp(cam.rtsp_url),
        "rtsp_substream_url": _mask_rtsp(sub) if sub else None,
        "nvr_id": cam.nvr,
        "nvr_name": nvr_name,
        "active": cam.active,
        "recording_enabled": cam.recording_enabled,
        "recording_policy": getattr(cam, "recording_policy", None) or "continuous",
        "is_main": cam.name.endswith("-main"),
        "is_sub": cam.name.endswith("-sub"),
        # Keep for compatibility with any existing frontend usage:
        "stream_url": f"/go2rtc/stream.html?src={cam.name}&mode=mse",
        "live_view_stream_name": _live_view_stream_name(cam, all_camera_names),
        # Optional runtime field for UI badges:
        "online": online,
    }


# ── Configuration endpoints ──────────────────────────────────────────────────

@bp.route("/", methods=["GET"])
@login_required_api
@camera_catalog_allowed
def list_cameras():
    query = _cameras_query_for_user()
    if query is None:
        return api_response([])

    nvr_map = {nvr.id: nvr for nvr in NVR.select()}
    rows = list(query)
    name_set = {c.name for c in rows}
    return api_response([camera_to_dict(c, nvr_map, None, name_set) for c in rows])


@bp.route("/", methods=["POST"])
@login_required_api
@admin_required
def create_camera():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    display_name = (data.get("display_name") or "").strip()
    rtsp_url = (data.get("rtsp_url") or "").strip()

    if not name or not display_name or not rtsp_url:
        return api_error("name, display_name, and rtsp_url are required.")
    if Camera.select().where(Camera.name == name).exists():
        return api_error(f'Stream name "{name}" is already taken.')

    policy = (data.get("recording_policy") or "").strip().lower()
    if not policy:
        policy = "off"
    if policy not in RECORDING_POLICIES:
        return api_error('recording_policy must be one of: off, continuous, events_only.')
    if policy != "off" and not name.endswith("-main"):
        return api_error("Recording policies other than off require a main stream (-main).", 400)
    sub = (data.get("rtsp_substream_url") or "").strip() or None

    v_err = validate_stream_url_for_go2rtc(rtsp_url)
    if v_err:
        return api_error(v_err, 400)
    if sub:
        s_err = validate_stream_url_for_go2rtc(sub)
        if s_err:
            return api_error(f"Substream: {s_err}", 400)

    cam = Camera.create(
        name=name,
        display_name=display_name,
        rtsp_url=rtsp_url,
        nvr=data.get("nvr_id") or None,
        active=data.get("active", True),
        recording_enabled=(policy != "off"),
        recording_policy=policy,
        rtsp_substream_url=sub,
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

    data = request.get_json(silent=True) or {}
    old_name = cam.name

    if "name" in data:
        cam.name = (data["name"] or "").strip()
    if "display_name" in data:
        cam.display_name = (data["display_name"] or "").strip()
    if "rtsp_url" in data:
        cam.rtsp_url = (data["rtsp_url"] or "").strip()
    if "nvr_id" in data:
        cam.nvr = data["nvr_id"] or None
    if "active" in data:
        cam.active = bool(data["active"])

    if "rtsp_substream_url" in data:
        v = data.get("rtsp_substream_url")
        cam.rtsp_substream_url = (v or "").strip() or None

    if "recording_policy" in data:
        if not is_original_admin():
            return api_error("Only the original administrator can change recording settings.", 403)
        pol = (data.get("recording_policy") or "").strip().lower()
        if pol not in RECORDING_POLICIES:
            return api_error('recording_policy must be one of: off, continuous, events_only.')
        if pol != "off" and not cam.name.endswith("-main"):
            return api_error("Recording is only supported on main streams.", 400)
        cam.recording_policy = pol
        _sync_policy_and_enabled(cam)

    # Recording enable/disable is restricted and only allowed on main streams.
    if "recording_enabled" in data:
        if not is_original_admin():
            return api_error("Only the original administrator can change recording settings.", 403)
        if bool(data["recording_enabled"]) and not cam.name.endswith("-main"):
            return api_error("Recording is only supported on main streams.", 400)
        cam.recording_enabled = bool(data["recording_enabled"])
        if cam.recording_enabled:
            if cam.recording_policy == "off":
                cam.recording_policy = "continuous"
        else:
            cam.recording_policy = "off"

    v_err = validate_stream_url_for_go2rtc(cam.rtsp_url)
    if v_err:
        return api_error(v_err, 400)
    if cam.rtsp_substream_url:
        s_err = validate_stream_url_for_go2rtc(cam.rtsp_substream_url)
        if s_err:
            return api_error(f"Substream: {s_err}", 400)

    cam.save()

    if old_name != cam.name:
        stream_delete(old_name)
    stream_sync(cam)

    nvr_map = {nvr.id: nvr for nvr in NVR.select()}
    return api_response(camera_to_dict(cam, nvr_map), message="Camera updated.")


@bp.route("/<int:cam_id>/recording", methods=["POST"], strict_slashes=False)
@login_required_api
def toggle_recording(cam_id):
    """Enable/disable recording for a camera (restricted)."""
    if not is_original_admin():
        return api_error("Only the original administrator can change recording settings.", 403)

    try:
        cam = Camera.get_by_id(cam_id)
    except Camera.DoesNotExist:
        return api_error("Camera not found.", 404)

    data = request.get_json(silent=True) or {}
    if "enabled" not in data:
        return api_error('"enabled" field is required.')

    enabled = bool(data["enabled"])
    if enabled and not cam.name.endswith("-main"):
        return api_error("Recording is only supported on main streams.", 400)

    if enabled:
        pol = (data.get("recording_policy") or "").strip().lower()
        if not pol:
            pol = "continuous"
        if pol not in ("continuous", "events_only"):
            return api_error(
                'When enabling, recording_policy must be "continuous" or "events_only" (or omit for continuous).',
                400,
            )
        cam.recording_policy = pol
    else:
        cam.recording_policy = "off"

    cam.recording_enabled = enabled
    cam.save()
    stream_sync(cam)

    status = "enabled" if cam.recording_enabled else "disabled"
    return api_response(
        {
            "recording_enabled": cam.recording_enabled,
            "recording_policy": getattr(cam, "recording_policy", None) or "continuous",
        },
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
    # Remove virtual go2rtc sub stream if this main row owned it (no separate *-sub Camera).
    if cam.name.endswith("-main"):
        sub_name = cam.name[: -len("-main")] + "-sub"
        if not Camera.select().where(Camera.name == sub_name).exists():
            stream_delete(sub_name)
    name = cam.display_name
    cam.delete_instance()
    return api_response(message=f'Camera "{name}" deleted.')


# ── Runtime endpoints ─────────────────────────────────────────────────────────

@bp.route("/summary", methods=["GET"])
@login_required_api
@camera_catalog_allowed
def cameras_summary():
    """
    Returns all cameras the user can access plus current online/offline state.
    Best endpoint for powering the live dashboard.
    """
    query = _cameras_query_for_user()
    if query is None:
        return api_response([])

    nvr_map = {nvr.id: nvr for nvr in NVR.select()}
    health = _get_stream_health_cached()

    rows = list(query)
    name_set = {c.name for c in rows}
    return api_response([camera_to_dict(c, nvr_map, health, name_set) for c in rows])


@bp.route("/inventory", methods=["GET"])
@login_required_api
@admin_required
def cameras_inventory():
    """
    Admin-only extended list for Configuration → Camera management:
    channel hint, source host, suggested camera web UI URL (heuristic :8000).
    """
    nvr_map = {nvr.id: nvr for nvr in NVR.select()}
    health = _get_stream_health_cached()
    all_cams = list(Camera.select().order_by(Camera.name))
    name_set = {c.name for c in all_cams}
    rows = []
    for c in all_cams:
        d = camera_to_dict(c, nvr_map, health, name_set)
        host = _rtsp_hostname(c.rtsp_url)
        d["channel"] = _guess_channel_from_name(c.name)
        d["source_host"] = host
        d["management_url"] = f"http://{host}:8000" if host else None
        d["protocol"] = "RTSP"
        rows.append(d)
    return api_response(rows)


@bp.route("/<int:cam_id>/source", methods=["GET"])
@login_required_api
@admin_required
def camera_source_secrets(cam_id):
    """Full RTSP URLs for editing (admin only)."""
    try:
        cam = Camera.get_by_id(cam_id)
    except Camera.DoesNotExist:
        return api_error("Camera not found.", 404)
    sub = getattr(cam, "rtsp_substream_url", None)
    return api_response(
        {
            "id": cam.id,
            "name": cam.name,
            "rtsp_url": cam.rtsp_url,
            "rtsp_substream_url": sub or "",
        }
    )


@bp.route("/<string:name>/status", methods=["GET"])
@login_required_api
@live_playback_allowed
def camera_status(name: str):
    """Returns status + metadata for a single camera."""
    allowed_names = accessible_camera_names(current_user)

    try:
        cam = Camera.get(Camera.name == name)
    except Camera.DoesNotExist:
        return api_error("Camera not found.", 404)

    if allowed_names is not None and cam.name not in allowed_names:
        return api_error("Forbidden.", 403)

    health = _get_stream_health_cached()
    online = camera_online_from_health_map(cam.name, health)

    name_set = {r.name for r in Camera.select(Camera.name)}

    return api_response({
        "name": cam.name,
        "display_name": cam.display_name,
        "nvr_id": cam.nvr,
        "active": cam.active,
        "recording_enabled": cam.recording_enabled,
        "recording_policy": getattr(cam, "recording_policy", None) or "continuous",
        "online": online,
        "live_view_stream_name": _live_view_stream_name(cam, name_set),
    })


@bp.route("/<string:name>/streams", methods=["GET"])
@login_required_api
@live_playback_allowed
def camera_streams(name: str):
    """
    Stream endpoints so the frontend can choose the best playback method
    without hardcoding URLs.
    """
    allowed_names = accessible_camera_names(current_user)

    try:
        cam = Camera.get(Camera.name == name)
    except Camera.DoesNotExist:
        return api_error("Camera not found.", 404)

    if allowed_names is not None and cam.name not in allowed_names:
        return api_error("Forbidden.", 403)

    return api_response({
        "webrtc": f"/go2rtc/api/webrtc?src={name}",
        "mse": f"/go2rtc/stream.mse?src={name}",
        "hls": f"/go2rtc/stream.m3u8?src={name}",
        "html": f"/go2rtc/stream.html?src={name}&mode=mse",
    })

@bp.route("/<string:name>/stats", methods=["GET"])
@login_required_api
@live_playback_allowed
def camera_stats(name: str):
    """
    Returns summarized runtime statistics for a camera stream.

    This endpoint aggregates useful metrics from the stream engine
    while hiding low-level internal fields. It is intended for UI
    diagnostics, monitoring panels, and health indicators.
    """

    allowed_names = accessible_camera_names(current_user)

    try:
        cam = Camera.get(Camera.name == name)
    except Camera.DoesNotExist:
        return api_error("Camera not found.", 404)

    if allowed_names is not None and cam.name not in allowed_names:
        return api_error("Forbidden.", 403)

    try:
        all_names = {c.name for c in Camera.select(Camera.name)}
        live_key = _live_view_stream_name(cam, all_names)

        streams = _fetch_go2rtc_streams()
        info = streams.get(live_key) or streams.get(cam.name) or streams.get(name)

        if not info:
            return api_response(
                {
                    "online": False,
                    "producers": 0,
                    "consumers": 0,
                    "codec": None,
                    "resolution": None,
                    "bitrate_kbps": None,
                    "fps": None,
                    "live_view_stream_name": live_key,
                    "live_view_warnings": [],
                }
            )

        producers = info.get("producers") or []
        consumers = info.get("consumers") or []

        codec = None
        resolution = None
        fps = None
        bitrate = None

        if producers:
            video = producers[0].get("video") or {}

            codec = video.get("codec")
            width = video.get("width")
            height = video.get("height")
            fps = video.get("fps")
            bitrate = video.get("bitrate")

            if width and height:
                resolution = f"{width}x{height}"

        warnings = _live_view_playback_warnings(codec)

        return api_response(
            {
                "online": len(producers) > 0,
                "producers": len(producers),
                "consumers": len(consumers),
                "codec": codec,
                "resolution": resolution,
                "fps": fps,
                "bitrate_kbps": bitrate,
                "live_view_stream_name": live_key,
                "live_view_warnings": warnings,
            }
        )

    except Exception as e:
        current_app.logger.warning(f"camera stats fetch failed for {name}: {e}")
        return api_error("Unable to retrieve stream stats.", 500)