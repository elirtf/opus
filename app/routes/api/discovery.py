"""
ONVIF Camera Discovery
======================
Two-phase discovery:
  1. WS-Discovery multicast — finds cameras that broadcast themselves
  2. Subnet range scan     — parallel port probe of every IP in a CIDR range

For each discovered IP, probe ONVIF to get:
  - Device name / model / manufacturer
  - All media profiles (main + sub streams)
  - RTSP URLs for each profile (with credentials injected)

Long subnet scans run in a background thread; the client polls /scan/status/<job_id>.
"""
import socket
import ipaddress
import concurrent.futures
import logging
import secrets
import threading
from urllib.parse import urlparse

from flask import Blueprint, request, current_app
from app.models import Camera, NVR, UserNVR
from app.routes.api.utils import api_response, api_error, login_required_api, admin_required
from app.go2rtc import stream_sync

logger = logging.getLogger(__name__)

bp = Blueprint("api_discovery", __name__, url_prefix="/api/discovery")

ONVIF_PORTS   = [80, 8080, 8000, 8899]
SCAN_TIMEOUT  = 0.5   # seconds per port probe
MAX_WORKERS   = 64    # parallel threads for subnet scan

_scan_jobs: dict[str, dict] = {}
_scan_lock = threading.Lock()


# ── ONVIF helpers ─────────────────────────────────────────────────────────────

def _probe_onvif(ip: str, port: int, username: str, password: str) -> dict | None:
    """
    Try to connect to an ONVIF device at ip:port and extract all stream info.
    Returns a device dict or None if unreachable / not ONVIF.
    """
    try:
        from onvif import ONVIFCamera
        import zeep

        cam = ONVIFCamera(ip, port, username, password, no_cache=True)

        # Get device info
        try:
            info = cam.devicemgmt.GetDeviceInformation()
            manufacturer = info.Manufacturer or ""
            model        = info.Model or ""
            name         = f"{manufacturer} {model}".strip() or ip
        except Exception:
            name = ip

        # Get media profiles and RTSP URLs
        try:
            media     = cam.create_media_service()
            profiles  = media.GetProfiles()
        except Exception:
            return {
                "ip":       ip,
                "port":     port,
                "name":     name,
                "streams":  [],
                "error":    "Could not read media profiles",
            }

        streams = []
        for i, profile in enumerate(profiles):
            try:
                uri_resp = media.GetStreamUri({
                    "StreamSetup": {
                        "Stream":    "RTP-Unicast",
                        "Transport": {"Protocol": "RTSP"},
                    },
                    "ProfileToken": profile.token,
                })
                raw_url = uri_resp.Uri

                # Inject credentials into the RTSP URL
                parsed  = urlparse(raw_url)
                rtsp_url = parsed._replace(
                    netloc=f"{username}:{password}@{parsed.hostname}"
                           + (f":{parsed.port}" if parsed.port else "")
                ).geturl()

                label = getattr(profile, "Name", None) or f"Stream {i + 1}"
                streams.append({
                    "profile_token": profile.token,
                    "label":         label,
                    "rtsp_url":      rtsp_url,
                })
            except Exception as e:
                logger.debug(f"Stream URI error for {ip} profile {i}: {e}")

        return {
            "ip":      ip,
            "port":    port,
            "name":    name,
            "streams": streams,
        }

    except Exception as e:
        logger.debug(f"ONVIF probe failed {ip}:{port} — {e}")
        return None


def _probe_ip(ip: str, username: str, password: str) -> dict | None:
    """Try each known ONVIF port on an IP and return first successful probe."""
    for port in ONVIF_PORTS:
        # Quick TCP connect check before trying full ONVIF
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(SCAN_TIMEOUT)
            result = sock.connect_ex((ip, port))
            sock.close()
            if result != 0:
                continue
        except Exception:
            continue

        device = _probe_onvif(ip, port, username, password)
        if device:
            return device

    return None


# ── WS-Discovery ──────────────────────────────────────────────────────────────

def _ws_discovery() -> list[str]:
    """
    Run WS-Discovery multicast and return a list of IP addresses found.
    Returns empty list if wsdiscovery is not available or times out.
    """
    try:
        # wsdiscovery>=2.x no longer exports ServiceFilter on the package root; we only need WSDiscovery.
        from wsdiscovery import WSDiscovery

        wsd = WSDiscovery()
        wsd.start()
        services = wsd.searchServices(timeout=3)
        wsd.stop()

        ips = []
        for svc in services:
            for addr in svc.getXAddrs():
                try:
                    parsed = urlparse(addr)
                    host   = parsed.hostname
                    if host and host not in ips:
                        ips.append(host)
                except Exception:
                    pass
        return ips
    except Exception as e:
        logger.warning(f"WS-Discovery failed: {e}")
        return []


# ── Subnet scan ───────────────────────────────────────────────────────────────

def _subnet_scan(cidr: str, known_ips: list[str], username: str, password: str) -> list[dict]:
    """
    Scan every host in a CIDR range for ONVIF devices,
    skipping IPs already found by WS-Discovery.
    """
    try:
        network = ipaddress.IPv4Network(cidr, strict=False)
    except ValueError:
        return []

    hosts     = [str(h) for h in network.hosts() if str(h) not in known_ips]
    results   = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(_probe_ip, ip, username, password): ip for ip in hosts}
        for future in concurrent.futures.as_completed(futures):
            device = future.result()
            if device:
                results.append(device)

    return results


# ── API endpoints ─────────────────────────────────────────────────────────────

def _execute_onvif_scan(username: str, password: str, subnet: str) -> dict:
    """Run WS-Discovery + optional subnet scan; return payload for api_response."""
    logger.info("ONVIF scan: running WS-Discovery multicast...")
    multicast_ips = _ws_discovery()
    logger.info("WS-Discovery found %s devices: %s", len(multicast_ips), multicast_ips)

    devices = []
    seen_ips = set(multicast_ips)

    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(_probe_ip, ip, username, password): ip for ip in multicast_ips}
        for future in concurrent.futures.as_completed(futures):
            device = future.result()
            if device:
                devices.append(device)

    if subnet:
        logger.info("ONVIF scan: scanning subnet %s...", subnet)
        subnet_devices = _subnet_scan(subnet, list(seen_ips), username, password)
        for d in subnet_devices:
            if d["ip"] not in seen_ips:
                devices.append(d)
                seen_ips.add(d["ip"])
        logger.info("Subnet scan found %s additional devices.", len(subnet_devices))

    logger.info("ONVIF scan complete — %s cameras found.", len(devices))
    return {
        "devices": devices,
        "multicast_count": len(multicast_ips),
        "total": len(devices),
    }


@bp.route("/scan", methods=["POST"])
@login_required_api
@admin_required
def scan():
    """
    Discover ONVIF cameras (synchronous). Prefer /scan/async for large subnets.
    """
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password", "")
    subnet = (data.get("subnet") or "").strip()

    if not username:
        return api_error("username is required for ONVIF probing.")

    return api_response(_execute_onvif_scan(username, password, subnet))


@bp.route("/scan/async", methods=["POST"])
@login_required_api
@admin_required
def scan_async():
    """
    Start discovery in a background thread. Poll GET /scan/status/<job_id>.
    Avoids nginx/upstream timeouts on large subnet scans.
    """
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password", "")
    subnet = (data.get("subnet") or "").strip()

    if not username:
        return api_error("username is required for ONVIF probing.")

    job_id = secrets.token_hex(12)

    with _scan_lock:
        if len(_scan_jobs) > 80:
            for k in list(_scan_jobs.keys()):
                if _scan_jobs.get(k, {}).get("status") != "running":
                    _scan_jobs.pop(k, None)

    def worker():
        try:
            result = _execute_onvif_scan(username, password, subnet)
            with _scan_lock:
                _scan_jobs[job_id] = {"status": "complete", "result": result}
        except Exception as e:
            logger.exception("Async ONVIF scan failed")
            with _scan_lock:
                _scan_jobs[job_id] = {"status": "error", "error": str(e)}

    with _scan_lock:
        _scan_jobs[job_id] = {"status": "running"}
    threading.Thread(target=worker, daemon=True).start()
    return api_response({"job_id": job_id})


@bp.route("/scan/status/<job_id>", methods=["GET"])
@login_required_api
@admin_required
def scan_status(job_id):
    with _scan_lock:
        job = _scan_jobs.get(job_id)
    if not job:
        return api_error("Unknown or expired job.", 404)
    return api_response(job)


@bp.route("/add", methods=["POST"])
@login_required_api
@admin_required
def add_cameras():
    """
    Bulk add selected cameras from discovery results.

    Body:
      {
        "group_name":    "Warehouse Cameras",   // creates a virtual NVR group
        "group_display": "Warehouse",           // display name
        "cameras": [
          {
            "name":         "warehouse-ch1-main",
            "display_name": "Warehouse Ch 1 Main",
            "rtsp_url":     "rtsp://...",
          },
          ...
        ]
      }
    """
    data         = request.get_json(silent=True) or {}
    group_name   = (data.get("group_name") or "").strip()
    group_display= (data.get("group_display") or group_name).strip()
    cameras_data = data.get("cameras", [])

    if not cameras_data:
        return api_error("No cameras provided.")

    # Create or get the virtual NVR group
    nvr = None
    if group_name:
        nvr = NVR.get_or_none(NVR.name == group_name)
        if not nvr:
            nvr = NVR.create(
                name=group_name,
                display_name=group_display,
                ip_address=None,
                username=None,
                password=None,
                max_channels=len(cameras_data),
                active=True,
            )

    created  = []
    skipped  = []
    errors   = []

    for cam_data in cameras_data:
        name         = (cam_data.get("name") or "").strip()
        display_name = (cam_data.get("display_name") or name).strip()
        rtsp_url     = (cam_data.get("rtsp_url") or "").strip()

        if not name or not rtsp_url:
            errors.append(f"Skipped invalid entry: {cam_data}")
            continue

        if Camera.select().where(Camera.name == name).exists():
            skipped.append(name)
            continue

        cam = Camera.create(
            name=name,
            display_name=display_name,
            rtsp_url=rtsp_url,
            nvr=nvr.id if nvr else None,
            active=True,
            recording_enabled=False,
            recording_policy="off",
        )
        stream_sync(cam)
        created.append(name)

    return api_response({
        "created":    len(created),
        "skipped":    len(skipped),
        "errors":     errors,
        "group_name": group_display if nvr else None,
    }, message=f"{len(created)} cameras added, {len(skipped)} already existed.", status=201)