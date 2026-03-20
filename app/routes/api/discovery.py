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
"""
import socket
import ipaddress
import concurrent.futures
import logging
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
        from wsdiscovery import WSDiscovery, ServiceFilter
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

@bp.route("/scan", methods=["POST"])
@login_required_api
@admin_required
def scan():
    """
    Discover ONVIF cameras on the network.

    Body:
      {
        "username": "admin",
        "password": "password",
        "subnet":   "192.168.1.0/24"   // optional, enables range scan
      }

    Returns list of discovered devices with their stream URLs.
    """
    data     = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password", "")
    subnet   = (data.get("subnet") or "").strip()

    if not username:
        return api_error("username is required for ONVIF probing.")

    # Phase 1 — WS-Discovery multicast
    logger.info("ONVIF scan: running WS-Discovery multicast...")
    multicast_ips = _ws_discovery()
    logger.info(f"WS-Discovery found {len(multicast_ips)} devices: {multicast_ips}")

    # Probe multicast results
    devices = []
    seen_ips = set(multicast_ips)

    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(_probe_ip, ip, username, password): ip for ip in multicast_ips}
        for future in concurrent.futures.as_completed(futures):
            device = future.result()
            if device:
                devices.append(device)

    # Phase 2 — Subnet scan fallback
    if subnet:
        logger.info(f"ONVIF scan: scanning subnet {subnet}...")
        subnet_devices = _subnet_scan(subnet, list(seen_ips), username, password)
        for d in subnet_devices:
            if d["ip"] not in seen_ips:
                devices.append(d)
                seen_ips.add(d["ip"])
        logger.info(f"Subnet scan found {len(subnet_devices)} additional devices.")

    logger.info(f"ONVIF scan complete — {len(devices)} cameras found.")
    return api_response({
        "devices":          devices,
        "multicast_count":  len(multicast_ips),
        "total":            len(devices),
    })


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

        is_main = name.endswith("-main")
        cam = Camera.create(
            name=name,
            display_name=display_name,
            rtsp_url=rtsp_url,
            nvr=nvr.id if nvr else None,
            active=True,
            recording_enabled=is_main,
            recording_policy="continuous" if is_main else "off",
        )
        stream_sync(cam)
        created.append(name)

    return api_response({
        "created":    len(created),
        "skipped":    len(skipped),
        "errors":     errors,
        "group_name": group_display if nvr else None,
    }, message=f"{len(created)} cameras added, {len(skipped)} already existed.", status=201)