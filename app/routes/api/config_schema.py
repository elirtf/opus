"""
Config Schema API (read-only)
=============================
Exposes a typed registry of all user-facing settings with metadata:
type, default, valid range, apply policy, and current value.

This is the first step toward a unified config contract; existing
recording_settings and go2rtc_settings APIs remain the write path.
"""

from flask import Blueprint
from app.routes.api.utils import api_response, login_required_api

bp = Blueprint("api_config_schema", __name__, url_prefix="/api/config")

# ── Apply policies ────────────────────────────────────────────────────────────
# hot        — takes effect within seconds, no restart needed
# recorder   — requires recorder service restart (or auto-restarts FFmpeg)
# go2rtc     — requires go2rtc container restart
# processor  — requires processor service restart
# app        — requires full app (API) container restart

SCHEMA = [
    # Recording / segments
    {
        "key": "segment_minutes",
        "label": "Segment duration (minutes)",
        "type": "int",
        "default": 5,
        "min": 1,
        "max": 60,
        "apply": "recorder",
        "description": "Length of each MP4 recording segment. Shorter segments improve seek responsiveness but create more files.",
        "group": "recording",
    },
    {
        "key": "retention_days",
        "label": "Retention (days)",
        "type": "int",
        "default": 90,
        "min": 1,
        "max": 3650,
        "apply": "hot",
        "description": "Recordings older than this are automatically deleted.",
        "group": "recording",
    },
    {
        "key": "max_storage_gb",
        "label": "Max storage (GB)",
        "type": "float",
        "default": 0,
        "min": 0,
        "apply": "hot",
        "description": "Cap total recording storage. 0 means unlimited (age retention only).",
        "group": "recording",
    },
    {
        "key": "recordings_dir",
        "label": "Recordings directory",
        "type": "string",
        "default": "/recordings",
        "apply": "app",
        "description": "Absolute path where recording segments are written.",
        "group": "recording",
    },
    {
        "key": "stagger_seconds",
        "label": "FFmpeg stagger delay (seconds)",
        "type": "int",
        "default": 2,
        "min": 0,
        "max": 30,
        "apply": "recorder",
        "description": "Delay between launching FFmpeg processes to avoid overloading go2rtc on startup.",
        "group": "recording",
    },
    {
        "key": "clip_retention_days",
        "label": "Clip retention (days)",
        "type": "int",
        "default": 90,
        "min": 1,
        "max": 3650,
        "apply": "hot",
        "description": "Motion/event clips older than this are deleted. Independent of segment retention.",
        "group": "recording",
    },
    {
        "key": "events_only_buffer_hours",
        "label": "Events-only rolling buffer (hours)",
        "type": "int",
        "default": 48,
        "min": 1,
        "max": 720,
        "apply": "recorder",
        "description": "For events_only cameras with segment recording enabled, keep a rolling buffer this long.",
        "group": "recording",
    },
    {
        "key": "events_only_record_segments",
        "label": "Record segments for events-only cameras",
        "type": "bool",
        "default": False,
        "apply": "recorder",
        "description": "When true, events_only cameras also run 24/7 segment recording (rolling buffer). Enables pre-roll from segments.",
        "group": "recording",
    },
    {
        "key": "min_free_gb",
        "label": "Minimum free disk (GB)",
        "type": "float",
        "default": 1,
        "min": 0,
        "max": 1000,
        "apply": "hot",
        "description": "Stop starting new FFmpeg writers when free disk space drops below this threshold. 0 disables the check.",
        "group": "recording",
    },
    # Motion / events
    {
        "key": "motion_clip_seconds",
        "label": "Motion clip length (seconds)",
        "type": "int",
        "default": 45,
        "min": 5,
        "max": 300,
        "apply": "hot",
        "description": "Core capture length for motion-triggered clips.",
        "group": "motion",
    },
    {
        "key": "motion_clip_pre_seconds",
        "label": "Pre-roll (seconds)",
        "type": "int",
        "default": 0,
        "min": 0,
        "max": 15,
        "apply": "hot",
        "description": "Seconds prepended from the latest segment file before the motion trigger.",
        "group": "motion",
    },
    {
        "key": "motion_clip_post_seconds",
        "label": "Post-roll (seconds)",
        "type": "int",
        "default": 0,
        "min": 0,
        "max": 120,
        "apply": "hot",
        "description": "Extra seconds captured after the motion trigger ends.",
        "group": "motion",
    },
    {
        "key": "motion_poll_seconds",
        "label": "Motion poll interval (seconds)",
        "type": "int",
        "default": 6,
        "min": 3,
        "max": 60,
        "apply": "hot",
        "description": "How often the processor checks cameras for motion.",
        "group": "motion",
    },
    {
        "key": "motion_cooldown_seconds",
        "label": "Motion cooldown (seconds)",
        "type": "int",
        "default": 75,
        "min": 10,
        "max": 600,
        "apply": "hot",
        "description": "Minimum gap between consecutive motion clips for the same camera.",
        "group": "motion",
    },
    # Performance / decode
    {
        "key": "ffmpeg_hwaccel",
        "label": "FFmpeg hardware acceleration",
        "type": "enum",
        "default": "none",
        "options": ["none", "cuda", "qsv", "vaapi", "videotoolbox", "dxva2", "d3d11va"],
        "apply": "recorder",
        "description": "Hardware decode acceleration mode for FFmpeg recording and motion analysis.",
        "group": "performance",
    },
    {
        "key": "ffmpeg_hwaccel_device",
        "label": "HW accel device",
        "type": "string",
        "default": "",
        "apply": "recorder",
        "description": "Device index or path for hardware acceleration (e.g. '0' for first GPU).",
        "group": "performance",
    },
    {
        "key": "motion_max_concurrent",
        "label": "Motion max concurrent",
        "type": "int",
        "default": 4,
        "min": 1,
        "max": 64,
        "apply": "processor",
        "description": "Maximum simultaneous motion analysis FFmpeg processes.",
        "group": "performance",
    },
    {
        "key": "motion_analysis_max_width",
        "label": "Motion analysis width",
        "type": "int",
        "default": 320,
        "min": 0,
        "max": 1920,
        "apply": "processor",
        "description": "Max width for motion analysis frames. 0 means full resolution.",
        "group": "performance",
    },
    {
        "key": "motion_rtsp_mode",
        "label": "Motion RTSP mode",
        "type": "enum",
        "default": "auto",
        "options": ["auto", "main", "sub"],
        "apply": "processor",
        "description": "Which stream the motion processor reads. 'auto' prefers sub for lower decode cost.",
        "group": "performance",
    },
    # Streaming / go2rtc
    {
        "key": "go2rtc_webrtc_candidates",
        "label": "WebRTC ICE candidates",
        "type": "string_list",
        "default": ["stun:8555"],
        "apply": "go2rtc",
        "description": "ICE candidates written to go2rtc.yaml. Restart go2rtc after changes.",
        "group": "streaming",
    },
    {
        "key": "go2rtc_allow_arbitrary_exec",
        "label": "Allow arbitrary exec sources",
        "type": "bool",
        "default": False,
        "apply": "go2rtc",
        "description": "Enable echo:/expr:/exec: stream sources in go2rtc. Security-sensitive.",
        "group": "streaming",
    },
    {
        "key": "go2rtc_allow_exec_module",
        "label": "Enable exec module",
        "type": "bool",
        "default": False,
        "apply": "go2rtc",
        "description": "Include the go2rtc exec module for exec: pipelines.",
        "group": "streaming",
    },
]


def _current_values():
    """Read current value for every schema key from the existing settings APIs."""
    from app.routes.api.recording_settings import get_setting, DEFAULTS
    from app.go2rtc_settings import (
        get_webrtc_candidates,
        allow_arbitrary_exec_sources,
        allow_exec_module,
    )

    values = {}
    for entry in SCHEMA:
        key = entry["key"]
        if key == "go2rtc_webrtc_candidates":
            values[key] = get_webrtc_candidates()
        elif key == "go2rtc_allow_arbitrary_exec":
            values[key] = allow_arbitrary_exec_sources()
        elif key == "go2rtc_allow_exec_module":
            values[key] = allow_exec_module()
        else:
            raw = get_setting(key, DEFAULTS.get(key, ""))
            if entry["type"] == "int":
                try:
                    values[key] = int(raw)
                except (TypeError, ValueError):
                    values[key] = entry.get("default")
            elif entry["type"] == "float":
                try:
                    values[key] = float(raw)
                except (TypeError, ValueError):
                    values[key] = entry.get("default")
            elif entry["type"] == "bool":
                values[key] = str(raw).lower() in ("true", "1", "yes")
            else:
                values[key] = raw
    return values


@bp.route("/schema", methods=["GET"])
@login_required_api
def config_schema():
    """Return the typed config registry (no values, just metadata)."""
    return api_response(SCHEMA)


@bp.route("/current", methods=["GET"])
@login_required_api
def config_current():
    """Return schema entries merged with their current runtime values."""
    values = _current_values()
    merged = []
    for entry in SCHEMA:
        merged.append({**entry, "value": values.get(entry["key"])})
    return api_response(merged)


@bp.route("/audit", methods=["GET"])
@login_required_api
def config_audit():
    """Return recent config change audit log."""
    from flask import request as req
    from app.database import db

    limit = min(int(req.args.get("limit", 50)), 500)
    try:
        db.execute_sql("""
            CREATE TABLE IF NOT EXISTS setting_audit (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER,
                username   VARCHAR(120),
                key        VARCHAR(100) NOT NULL,
                old_value  TEXT,
                new_value  TEXT,
                changed_at TEXT NOT NULL
            )
        """)
        rows = db.execute_sql(
            "SELECT id, user_id, username, key, old_value, new_value, changed_at "
            "FROM setting_audit ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    except Exception:
        rows = []
    entries = [
        {
            "id": r[0], "user_id": r[1], "username": r[2],
            "key": r[3], "old_value": r[4], "new_value": r[5], "changed_at": r[6],
        }
        for r in rows
    ]
    return api_response(entries)
