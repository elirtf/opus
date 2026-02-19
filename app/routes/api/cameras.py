from flask import Blueprint, request, current_app
from app.models import Camera, NVR
from app.routes.api.utils import api_response, api_error, login_required_api, admin_required
import requests as http

bp = Blueprint("api_cameras", __name__, url_prefix="/api/cameras")


# ── Serializer ────────────────────────────────────────────────────────────────

def camera_to_dict(cam, nvr_map=None):
    nvr_name = None
    if cam.nvr and nvr_map:
        nvr = nvr_map.get(cam.nvr)
        nvr_name = nvr.display_name if nvr else None

    return {
        "id":           cam.id,
        "name":         cam.name,
        "display_name": cam.display_name,
        "rtsp_url":     cam.rtsp_url,
        "nvr_id":       cam.nvr,
        "nvr_name":     nvr_name,
        "active":       cam.active,
        # Derived fields React will use directly
        "is_main":      cam.name.endswith("-main"),
        "is_sub":       cam.name.endswith("-sub"),
        "stream_url":   f"/go2rtc/stream.html?src={cam.name}&mode=mse",
    }


# ── go2rtc helpers ────────────────────────────────────────────────────────────

def stream_add(name, rtsp_url):
    try:
        http.put(
            f"{current_app.config['GO2RTC_URL']}/api/streams",
            params={"name": name, "src": rtsp_url},
            timeout=3,
        )
    except Exception as e:
        current_app.logger.warning(f"go2rtc stream_add failed: {e}")


def stream_delete(name):
    try:
        http.delete(
            f"{current_app.config['GO2RTC_URL']}/api/streams",
            params={"name": name},
            timeout=3,
        )
    except Exception as e:
        current_app.logger.warning(f"go2rtc stream_delete failed: {e}")


# ── Routes ────────────────────────────────────────────────────────────────────

@bp.route("/", methods=["GET"])
@login_required_api
def list_cameras():
    cameras  = Camera.select().order_by(Camera.name)
    nvr_map  = {nvr.id: nvr for nvr in NVR.select()}
    return api_response([camera_to_dict(c, nvr_map) for c in cameras])


@bp.route("/", methods=["POST"])
@login_required_api
@admin_required
def create_camera():
    data = request.get_json(silent=True) or {}

    name         = (data.get("name") or "").strip()
    display_name = (data.get("display_name") or "").strip()
    rtsp_url     = (data.get("rtsp_url") or "").strip()

    if not name or not display_name or not rtsp_url:
        return api_error("name, display_name, and rtsp_url are required.")

    if Camera.select().where(Camera.name == name).exists():
        return api_error(f'Stream name "{name}" is already taken.')

    cam = Camera.create(
        name=name,
        display_name=display_name,
        rtsp_url=rtsp_url,
        nvr=data.get("nvr_id") or None,
        active=data.get("active", True),
    )
    stream_add(cam.name, cam.rtsp_url)
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

    if "name" in data:
        cam.name = data["name"].strip()
    if "display_name" in data:
        cam.display_name = data["display_name"].strip()
    if "rtsp_url" in data:
        cam.rtsp_url = data["rtsp_url"].strip()
    if "nvr_id" in data:
        cam.nvr = data["nvr_id"] or None
    if "active" in data:
        cam.active = bool(data["active"])

    cam.save()

    if old_name != cam.name:
        stream_delete(old_name)
    stream_add(cam.name, cam.rtsp_url)

    nvr_map = {nvr.id: nvr for nvr in NVR.select()}
    return api_response(camera_to_dict(cam, nvr_map), message="Camera updated.")


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