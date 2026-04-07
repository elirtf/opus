import logging
import os
from concurrent.futures import ThreadPoolExecutor, as_completed

from flask import Blueprint, request, current_app
from flask_login import current_user
from app.models import NVR, Camera, UserNVR
from app.routes.api.utils import api_response, api_error, login_required_api, admin_required
import requests as http

logger = logging.getLogger(__name__)

# When importing from an NVR, try channels 1..N (Hikvision-style /Streaming/Channels/{101,102,...}).
# Non-existent channels are skipped after the main stream fails ffprobe. Override with NVR_IMPORT_CHANNEL_CAP.
DEFAULT_NVR_IMPORT_CHANNEL_CAP = max(1, min(int(os.environ.get("NVR_IMPORT_CHANNEL_CAP", "64")), 256))

bp = Blueprint("api_nvrs",  __name__, url_prefix="/api/nvrs")


# ── Serializer ────────────────────────────────────────────────────────────────

def nvr_to_dict(nvr, cam_count=None, admin=False):
    base = {
        "id":           nvr.id,
        "display_name": nvr.display_name,
        "active":       nvr.active,
        "camera_count": cam_count if cam_count is not None else 0,
    }
    if admin:
        base.update({
            "name":         nvr.name,
            "ip_address":   nvr.ip_address,
            # Never expose username or password to any user
            "max_channels": nvr.max_channels,
        })
    return base


# ── go2rtc + import helpers ───────────────────────────────────────────────────

def stream_add(name, rtsp_url):
    from app.go2rtc import validate_stream_url_for_go2rtc

    err = validate_stream_url_for_go2rtc(rtsp_url)
    if err:
        current_app.logger.warning("go2rtc stream_add rejected %s: %s", name, err)
        return
    try:
        r = http.put(
            f"{current_app.config['GO2RTC_URL']}/api/streams",
            params={"name": name, "src": rtsp_url},
            timeout=3,
        )
        r.raise_for_status()
    except Exception as e:
        current_app.logger.warning("go2rtc stream_add failed for %s: %s", name, e)


def _probe_nvr_main_stream(base: str, channel_index: int, timeout: int) -> tuple[int, bool]:
    """Returns (channel_index, True) if main URL responds to ffprobe."""
    from app.recorder import RecordingEngine

    main_url = f"{base}/Streaming/Channels/{channel_index * 100 + 1}"
    try:
        res = RecordingEngine.test_rtsp(main_url, timeout=timeout)
        return channel_index, bool(res.get("reachable"))
    except Exception as e:
        logger.debug("NVR import probe ch %s: %s", channel_index, e)
        return channel_index, False


def import_cameras(nvr, probe_timeout: int | None = None):
    """Generate main+sub stream cameras for each channel whose main RTSP URL probes OK.

    Loops channels 1..nvr.max_channels, probes main only, then creates rows + go2rtc for
    main+sub. Returns (created, skipped, unreachable_channel_count)."""
    if probe_timeout is None:
        probe_timeout = max(2, min(int(os.environ.get("NVR_IMPORT_PROBE_TIMEOUT", "5")), 30))

    created = 0
    skipped = 0
    base = f"rtsp://{nvr.username}:{nvr.password}@{nvr.ip_address}:554"
    cap = max(1, int(nvr.max_channels or 1))

    workers = min(8, cap)
    valid_channels: list[int] = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [
            pool.submit(_probe_nvr_main_stream, base, ch, probe_timeout)
            for ch in range(1, cap + 1)
        ]
        for fut in as_completed(futures):
            ch, ok = fut.result()
            if ok:
                valid_channels.append(ch)

    valid_channels.sort()
    unreachable = cap - len(valid_channels)

    for ch in valid_channels:
        streams = [
            (f"{nvr.name}-ch{ch}-main", f"{nvr.display_name} — Ch {ch} Main", f"{base}/Streaming/Channels/{ch * 100 + 1}", True),
            (f"{nvr.name}-ch{ch}-sub",  f"{nvr.display_name} — Ch {ch} Sub",  f"{base}/Streaming/Channels/{ch * 100 + 2}", False),
        ]
        for name, display_name, rtsp_url, is_main in streams:
            if Camera.select().where(Camera.name == name).exists():
                skipped += 1
                continue
            Camera.create(
                name=name,
                display_name=display_name,
                rtsp_url=rtsp_url,
                nvr=nvr.id,
                active=True,
                recording_enabled=False,
                recording_policy="off",
            )
            stream_add(name, rtsp_url)
            created += 1

    return created, skipped, unreachable


# ── Routes ────────────────────────────────────────────────────────────────────

@bp.route("/", methods=["GET"])
@login_required_api
def list_nvrs():
    allowed = current_user.allowed_nvr_ids()  # None = admin, set = restricted

    query = NVR.select()
    if allowed is not None:
        if not allowed:
            return api_response([])  # no assignments → see nothing
        query = query.where(NVR.id.in_(allowed))
    result = []

    for nvr in query:
        count = Camera.select().where(Camera.nvr == nvr.id).count()
        result.append(nvr_to_dict(nvr, count, admin=current_user.is_admin))
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

    raw_cap = data.get("max_channels")
    if raw_cap is not None and str(raw_cap).strip() != "":
        max_ch = max(1, min(int(raw_cap), 256))
    else:
        max_ch = DEFAULT_NVR_IMPORT_CHANNEL_CAP

    nvr = NVR.create(
        name=name,
        display_name=display_name,
        ip_address=data.get("ip_address") or None,
        username=data.get("username") or None,
        password=data.get("password") or None,
        max_channels=max_ch,
    )
    created, skipped, unreachable = import_cameras(nvr)
    cam_total = Camera.select().where(Camera.nvr == nvr.id).count()
    result = nvr_to_dict(nvr, cam_total, admin=True)
    result["imported"] = created
    result["skipped_existing"] = skipped
    result["skipped"] = skipped  # alias for older clients
    result["unreachable_channels"] = unreachable
    msg = (
        f"NVR created. {created} new streams registered; "
        f"{unreachable} channel slot(s) had no main stream."
    )
    if skipped:
        msg += f" {skipped} stream row(s) already existed."
    return api_response(result, message=msg, status=201)


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
        nvr.max_channels = max(1, min(int(data["max_channels"]), 256))
    if "active" in data:
        nvr.active = bool(data["active"])

    nvr.save()
    return api_response(nvr_to_dict(nvr, admin=True), message="NVR updated.")


@bp.route("/<int:nvr_id>", methods=["DELETE"])
@login_required_api
@admin_required
def delete_nvr(nvr_id):
    try:
        nvr = NVR.get_by_id(nvr_id)
    except NVR.DoesNotExist:
        return api_error("NVR not found.", 404)

    Camera.delete().where(Camera.nvr == nvr_id).execute()
    UserNVR.delete().where(UserNVR.nvr_id == nvr_id).execute()
    name = nvr.display_name
    nvr.delete_instance()
    return api_response(message=f'"{name}" and its cameras deleted.')


@bp.route("/<int:nvr_id>/sync", methods=["POST"])
@login_required_api
@admin_required
def sync_nvr(nvr_id):
    try:
        nvr = NVR.get_by_id(nvr_id)
    except NVR.DoesNotExist:
        return api_error("NVR not found.", 404)

    created, skipped, unreachable = import_cameras(nvr)
    return api_response(
        {
            "created": created,
            "skipped_existing": skipped,
            "skipped": skipped,
            "unreachable_channels": unreachable,
        },
        message=(
            f"Sync complete: {created} new streams, {skipped} already existed, "
            f"{unreachable} empty slot(s) probed."
        ),
    )