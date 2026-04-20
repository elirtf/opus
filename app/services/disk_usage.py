"""Centralised recordings-volume disk usage, shared by API, alerts, and diagnostics."""

from __future__ import annotations

import shutil
from app.config import get_recordings_dir


def get_disk_usage(path: str | None = None) -> dict | None:
    """
    Returns { total_gb, used_gb, free_gb, percent_used } for *path*
    (defaults to RECORDINGS_DIR).  Returns None on error.
    """
    target = path or get_recordings_dir()
    try:
        du = shutil.disk_usage(target)
    except OSError:
        return None
    gb = 1024 ** 3
    return {
        "total_gb": round(du.total / gb, 2),
        "used_gb": round(du.used / gb, 2),
        "free_gb": round(du.free / gb, 2),
        "percent_used": round(du.used / du.total * 100, 1) if du.total else 0,
    }
