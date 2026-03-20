"""
Host/container snapshot for admin diagnostics (CPU, RAM, /dev/dri, FFmpeg -hwaccels).
See docs/hw-diagnostics-spec.md for the JSON schema.
"""

import os
import platform
import shutil
import subprocess


def _mem_total_kb_linux():
    try:
        with open("/proc/meminfo", encoding="utf-8") as f:
            for line in f:
                if line.startswith("MemTotal:"):
                    parts = line.split()
                    return int(parts[1])
    except (OSError, ValueError, IndexError):
        return None
    return None


def _parse_ffmpeg_hwaccels(combined_output: str):
    lines = combined_output.replace("\r\n", "\n").split("\n")
    accels = []
    capture = False
    for line in lines:
        s = line.strip()
        if "Hardware acceleration methods" in s:
            capture = True
            continue
        if capture:
            if not s:
                break
            token = s.split()[0]
            if token and not token.startswith("ffmpeg"):
                accels.append(token)
    return accels


def collect_host_diagnostics():
    recordings_dir = os.environ.get("RECORDINGS_DIR", "/recordings")

    out = {
        "schema_version": "1",
        "platform_system": platform.system(),
        "platform_machine": platform.machine(),
        "platform_release": platform.release(),
        "python_version": platform.python_version(),
        "cpu_count_logical": os.cpu_count(),
        "env_ffmpeg_hwaccel": os.environ.get("FFMPEG_HWACCEL", ""),
        "recordings_dir": recordings_dir,
        "dev_dri_present": os.path.isdir("/dev/dri"),
        "nvidia_device_present": os.path.exists("/dev/nvidia0"),
    }

    mem_kb = _mem_total_kb_linux()
    if mem_kb is not None:
        out["mem_total_kb"] = mem_kb

    try:
        du = shutil.disk_usage(recordings_dir)
        gb = 1024**3
        out["recordings_disk"] = {
            "total_gb": round(du.total / gb, 2),
            "used_gb": round((du.total - du.free) / gb, 2),
            "free_gb": round(du.free / gb, 2),
        }
    except OSError as e:
        out["recordings_disk"] = None
        out["recordings_disk_error"] = str(e)

    try:
        proc = subprocess.run(
            ["ffmpeg", "-hide_banner", "-hwaccels"],
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )
        blob = (proc.stdout or "") + "\n" + (proc.stderr or "")
        out["ffmpeg_hwaccels"] = _parse_ffmpeg_hwaccels(blob)
        if proc.returncode != 0 and not out["ffmpeg_hwaccels"]:
            out["ffmpeg_hwaccels_error"] = (proc.stderr or proc.stdout or "ffmpeg failed").strip()
    except FileNotFoundError:
        out["ffmpeg_hwaccels"] = []
        out["ffmpeg_hwaccels_error"] = "ffmpeg not found in PATH"
    except subprocess.TimeoutExpired:
        out["ffmpeg_hwaccels"] = []
        out["ffmpeg_hwaccels_error"] = "ffmpeg -hwaccels timed out"
    except OSError as e:
        out["ffmpeg_hwaccels"] = []
        out["ffmpeg_hwaccels_error"] = str(e)

    return out
