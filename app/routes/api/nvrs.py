from flask import Blueprint, request, current_app
from app.models import NVR, Camera
from app.routes.api.utils import api_response, api_error, login_required_api, admin_required
import requests as http

bp = Blueprint("api_nvrs",  __name__, url_prefix="/api/nvrs")


# ── Serializer ────────────────────────────────────────────────────────────────

def nvr_to_dict(nvr, cam_count=None):
    return {
        "id":           nvr.id,
        "name":         nvr.name,
        "display_name": nvr.display_name,
        "ip_address":   nvr.ip_address,
        "username":     nvr.username,
        # Never return password — not even hashed
        "max_channels": nvr.max_channels,
        "active":       nvr.active,
        "camera_count": cam_count if cam_count is not None else 0,
    }


# ── go2rtc + import helpers ───────────────────────────────────────────────────

def stream_add(name, rtsp_url):
    try:
        http.put(
            f"{current_app.config['GO2RTC_URL']}/api/streams",
            params={"name": name, "src": rtsp_url},
            timeout=3,
        )
    except Exception as e:
        current_app.logger.warning(f"go2rtc stream_add failed: {e}")


def import_cameras(nvr):
    """Generate main+sub stream cameras for every channel. Returns (created, skipped)."""
    created = 0
    skipped = 0
    base = f"rtsp://{nvr.username}:{nvr.password}@{nvr.ip_address}:554"

    for ch in range(1, nvr.max_channels + 1):
        streams = [
            (f"{nvr.name}-ch{ch}-main", f"{nvr.display_name} — Ch {ch} Main", f"{base}/Streaming/Channels/{ch * 100 + 1}"),
            (f"{nvr.name}-ch{ch}-sub",  f"{nvr.display_name} — Ch {ch} Sub",  f"{base}/Streaming/Channels/{ch * 100 + 2}"),
        ]
        for name, display_name, rtsp_url in streams:
            if Camera.select().where(Camera.name == name).exists():
                skipped += 1
                continue
            Camera.create(name=name, display_name=display_name, rtsp_url=rtsp_url, nvr=nvr.id, active=True)
            stream_add(name, rtsp_url)
            created += 1

    return created, skipped


# ── Routes ────────────────────────────────────────────────────────────────────

@bp.route("/", methods=["GET"])
@login_required_api
def list_nvrs():
    nvrs = NVR.select()
    result = []
    for nvr in nvrs:
        count = Camera.select().where(Camera.nvr == nvr.id).count()
        result.append(nvr_to_dict(nvr, count))
    return api_response(result)


@bp.route("/", methods=["POST"])
@login_required_api
@admin_required
def create_nvr():
    data = request.get_json(silent=True) or {}

    name         = (data.get("name") or "").strip()
    display_name = (data.get("display_name") or "").strip()

    if not name or not display_name:
        return api_error("name and display_name are required.")

    if NVR.select().where(NVR.name == name).exists():
        return api_error(f'NVR name "{name}" is already taken.')

    nvr = NVR.create(
        name=name,
        display_name=display_name,
        ip_address=data.get("ip_address") or None,
        username=data.get("username") or None,
        password=data.get("password") or None,
        max_channels=int(data.get("max_channels") or 50),
    )
    created, skipped = import_cameras(nvr)
    result = nvr_to_dict(nvr, created)
    result["imported"] = created
    result["skipped"]  = skipped
    return api_response(result, message=f"NVR created. {created} streams imported.", status=201)


@bp.route("/<int:nvr_id>", methods=["PATCH"])
@login_required_api
@admin_required
def update_nvr(nvr_id):
    try:
        nvr = NVR.get_by_id(nvr_id)
    except NVR.DoesNotExist:
        return api_error("NVR not found.", 404)

    data = request.get_json(silent=True) or {}

    if "name" in data:
        nvr.name = data["name"].strip()
    if "display_name" in data:
        nvr.display_name = data["display_name"].strip()
    if "ip_address" in data:
        nvr.ip_address = data["ip_address"] or None
    if "username" in data:
        nvr.username = data["username"] or None
    if "password" in data and data["password"]:
        nvr.password = data["password"]
    if "max_channels" in data:
        nvr.max_channels = int(data["max_channels"])
    if "active" in data:
        nvr.active = bool(data["active"])

    nvr.save()
    return api_response(nvr_to_dict(nvr), message="NVR updated.")


@bp.route("/<int:nvr_id>", methods=["DELETE"])
@login_required_api
@admin_required
def delete_nvr(nvr_id):
    try:
        nvr = NVR.get_by_id(nvr_id)
    except NVR.DoesNotExist:
        return api_error("NVR not found.", 404)

    cam_count = Camera.delete().where(Camera.nvr == nvr_id).execute()
    name = nvr.display_name
    nvr.delete_instance()
    return api_response(message=f'"{name}" and {cam_count} cameras deleted.')


@bp.route("/<int:nvr_id>/sync", methods=["POST"])
@login_required_api
@admin_required
def sync_nvr(nvr_id):
    try:
        nvr = NVR.get_by_id(nvr_id)
    except NVR.DoesNotExist:
        return api_error("NVR not found.", 404)

    created, skipped = import_cameras(nvr)
    return api_response(
        {"created": created, "skipped": skipped},
        message=f"Sync complete: {created} new streams, {skipped} already existed."
    )