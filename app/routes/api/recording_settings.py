"""
Recording Settings API
======================
Endpoints for managing recording configuration from the UI.

Stores settings in a `setting` key-value table so they persist across restarts
and can be changed without editing .env files.

Settings hierarchy: DB settings > env vars > defaults
"""

import os
from datetime import datetime
from flask import Blueprint, request
from flask_login import current_user
from app.routes.api.utils import api_response, api_error, login_required_api, admin_required, is_original_admin
from app.database import db

bp = Blueprint("api_recording_settings", __name__, url_prefix="/api/recordings/settings")

# ── Defaults ──────────────────────────────────────────────────────────────────

DEFAULTS = {
    "segment_minutes":    "5",
    "retention_days":     "90",
    "max_storage_gb":     "0",
    "recordings_dir":     "/recordings",
    "stagger_seconds":    "2",
    "setup_complete":     "false",
    # Processor / motion clips (events_only) — also settable via .env on processor service
    "motion_clip_seconds":       "45",   # core capture length after trigger
    "motion_clip_pre_seconds":   "0",    # prepend from latest segment file (needs rolling segments)
    "motion_clip_post_seconds":  "0",    # extra seconds after trigger (extends core capture)
    "motion_poll_seconds":       "6",
    "motion_cooldown_seconds":   "75",
    # Operational knobs (previously env-only)
    "clip_retention_days":       "90",
    "events_only_buffer_hours":  "48",
    "events_only_record_segments": "false",
    "min_free_gb":               "1",
    # Decode/performance tuning
    "ffmpeg_hwaccel":            "none",
    "ffmpeg_hwaccel_device":     "",
    "motion_max_concurrent":     "4",
    "motion_analysis_max_width": "320",
    "motion_rtsp_mode":          "auto",
}


def _ensure_table():
    """Create setting table if it doesn't exist."""
    db.execute_sql("""
        CREATE TABLE IF NOT EXISTS setting (
            key   VARCHAR(100) PRIMARY KEY,
            value TEXT NOT NULL
        )
    """)


def get_setting(key, default=None):
    try:
        _ensure_table()
        row = db.execute_sql(
            "SELECT value FROM setting WHERE key = ?", (key,)
        ).fetchone()
        if row:
            return row[0]
    except Exception:
        pass
    env_map = {
        "segment_minutes": "RECORDING_SEGMENT_MINUTES",
        "retention_days":  "RECORDING_RETENTION_DAYS",
        "max_storage_gb":  "RECORDING_MAX_STORAGE_GB",
        "recordings_dir":  "RECORDINGS_DIR",
        "stagger_seconds": "RECORDING_STAGGER_SECONDS",
        "motion_clip_seconds": "CLIP_SECONDS",
        "motion_clip_pre_seconds": "CLIP_PRE_SECONDS",
        "motion_clip_post_seconds": "CLIP_POST_SECONDS",
        "motion_poll_seconds": "PROCESSING_POLL_SECONDS",
        "motion_cooldown_seconds": "MOTION_COOLDOWN_SECONDS",
        "ffmpeg_hwaccel": "FFMPEG_HWACCEL",
        "ffmpeg_hwaccel_device": "FFMPEG_HWACCEL_DEVICE",
        "motion_max_concurrent": "MOTION_MAX_CONCURRENT",
        "motion_analysis_max_width": "MOTION_ANALYSIS_MAX_WIDTH",
        "motion_rtsp_mode": "MOTION_RTSP_MODE",
        "clip_retention_days": "CLIP_RETENTION_DAYS",
        "events_only_buffer_hours": "EVENTS_ONLY_BUFFER_HOURS",
        "events_only_record_segments": "EVENTS_ONLY_RECORD_SEGMENTS",
        "min_free_gb": "RECORDING_MIN_FREE_GB",
    }
    env_key = env_map.get(key)
    if env_key and os.environ.get(env_key):
        return os.environ[env_key]
    return default if default is not None else DEFAULTS.get(key, "")


def set_setting(key, value):
    _ensure_table()
    db.execute_sql(
        "INSERT OR REPLACE INTO setting (key, value) VALUES (?, ?)",
        (key, str(value))
    )


# ── Audit trail ───────────────────────────────────────────────────────────────

def _ensure_audit_table():
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


def write_audit(key, old_value, new_value):
    """Append an audit row for a setting change.  Safe to call outside a transaction."""
    _ensure_audit_table()
    uid = getattr(current_user, "id", None) if current_user and current_user.is_authenticated else None
    uname = getattr(current_user, "username", None) if current_user and current_user.is_authenticated else None
    db.execute_sql(
        "INSERT INTO setting_audit (user_id, username, key, old_value, new_value, changed_at) VALUES (?,?,?,?,?,?)",
        (uid, uname, key, str(old_value) if old_value is not None else None, str(new_value), datetime.utcnow().isoformat()),
    )


# ── Setup status ──────────────────────────────────────────────────────────────

@bp.route("/setup-status", methods=["GET"])
@login_required_api
def setup_status():
    """Check if first-run recording setup has been completed."""
    _ensure_table()
    complete = get_setting("setup_complete", "false") == "true"
    return api_response({
        "setup_complete":    complete,
        "is_original_admin": is_original_admin(),
        "recordings_dir":    get_setting("recordings_dir", "/recordings"),
    })


# ── First-run setup ──────────────────────────────────────────────────────────

@bp.route("/setup", methods=["POST"])
@login_required_api
def initial_setup():
    """
    First-run setup — only the original admin can complete this.
    Body: { "recordings_dir": "/recordings" }
    """
    if not is_original_admin():
        return api_error("Only the original administrator can configure recording setup.", 403)

    data = request.get_json(silent=True) or {}
    recordings_dir = str(data.get("recordings_dir", "/recordings")).strip()

    if not recordings_dir.startswith("/"):
        return api_error("recordings_dir must be an absolute path.", 400)

    set_setting("recordings_dir", recordings_dir)
    set_setting("setup_complete", "true")
    os.environ["RECORDINGS_DIR"] = recordings_dir

    return api_response(
        {"recordings_dir": recordings_dir, "setup_complete": True},
        message="Recording storage is configured. Enable recording per camera from the Recordings tab.",
    )


# ── GET settings ──────────────────────────────────────────────────────────────

@bp.route("/", methods=["GET"])
@login_required_api
def get_settings():
    _ensure_table()
    settings = {}
    for key, default in DEFAULTS.items():
        settings[key] = get_setting(key, default)

    try:    settings["segment_minutes"] = int(settings["segment_minutes"])
    except: settings["segment_minutes"] = 5
    try:    settings["retention_days"] = int(settings["retention_days"])
    except: settings["retention_days"] = 90
    try:    settings["max_storage_gb"] = float(settings["max_storage_gb"])
    except: settings["max_storage_gb"] = 0
    try:    settings["stagger_seconds"] = int(settings["stagger_seconds"])
    except: settings["stagger_seconds"] = 2

    for mk, dv in (
        ("motion_clip_seconds", 45),
        ("motion_clip_pre_seconds", 0),
        ("motion_clip_post_seconds", 0),
        ("motion_poll_seconds", 6),
        ("motion_cooldown_seconds", 75),
        ("motion_max_concurrent", 4),
        ("motion_analysis_max_width", 320),
    ):
        try:
            settings[mk] = int(settings.get(mk, str(dv)))
        except (TypeError, ValueError):
            settings[mk] = dv

    try:    settings["clip_retention_days"] = int(settings["clip_retention_days"])
    except: settings["clip_retention_days"] = 90
    try:    settings["events_only_buffer_hours"] = int(settings["events_only_buffer_hours"])
    except: settings["events_only_buffer_hours"] = 48
    try:    settings["min_free_gb"] = float(settings["min_free_gb"])
    except: settings["min_free_gb"] = 1
    settings["events_only_record_segments"] = str(settings.get("events_only_record_segments", "false")).lower() in ("true", "1", "yes")

    settings["setup_complete"]    = settings.get("setup_complete", "false") == "true"
    settings["is_original_admin"] = is_original_admin()
    settings["ffmpeg_hwaccel"] = str(settings.get("ffmpeg_hwaccel", "none") or "none").strip().lower()
    settings["ffmpeg_hwaccel_device"] = str(settings.get("ffmpeg_hwaccel_device", "") or "").strip()
    settings["motion_rtsp_mode"] = str(settings.get("motion_rtsp_mode", "auto") or "auto").strip().lower()

    return api_response(settings)


# ── PUT settings ──────────────────────────────────────────────────────────────

@bp.route("/", methods=["PUT"])
@login_required_api
def update_settings():
    """Only the original administrator can update recording settings."""
    if not is_original_admin():
        return api_error("Only the original administrator can change recording settings.", 403)

    data = request.get_json(silent=True) or {}
    allowed_keys = {
        "segment_minutes",
        "retention_days",
        "max_storage_gb",
        "recordings_dir",
        "stagger_seconds",
        "motion_clip_seconds",
        "motion_clip_pre_seconds",
        "motion_clip_post_seconds",
        "motion_poll_seconds",
        "motion_cooldown_seconds",
        "ffmpeg_hwaccel",
        "ffmpeg_hwaccel_device",
        "motion_max_concurrent",
        "motion_analysis_max_width",
        "motion_rtsp_mode",
        "clip_retention_days",
        "events_only_buffer_hours",
        "events_only_record_segments",
        "min_free_gb",
    }
    updated = []
    validated = []

    for key, value in data.items():
        if key not in allowed_keys:
            continue

        if key == "segment_minutes":
            try:
                v = int(value)
                if v < 1 or v > 60:
                    return api_error("segment_minutes must be 1-60.", 400)
            except (ValueError, TypeError):
                return api_error("segment_minutes must be a number.", 400)

        elif key == "retention_days":
            try:
                v = int(value)
                if v < 1 or v > 3650:
                    return api_error("retention_days must be 1-3650.", 400)
            except (ValueError, TypeError):
                return api_error("retention_days must be a number.", 400)

        elif key == "max_storage_gb":
            try:
                v = float(value)
                if v < 0:
                    return api_error("max_storage_gb cannot be negative.", 400)
            except (ValueError, TypeError):
                return api_error("max_storage_gb must be a number.", 400)

        elif key == "stagger_seconds":
            try:
                v = int(value)
                if v < 0 or v > 30:
                    return api_error("stagger_seconds must be 0-30.", 400)
            except (ValueError, TypeError):
                return api_error("stagger_seconds must be a number.", 400)

        elif key == "recordings_dir":
            value = str(value).strip()
            if not value.startswith("/"):
                return api_error("recordings_dir must be an absolute path.", 400)

        elif key == "motion_clip_seconds":
            try:
                v = int(value)
                if v < 5 or v > 300:
                    return api_error("motion_clip_seconds must be 5-300.", 400)
            except (ValueError, TypeError):
                return api_error("motion_clip_seconds must be an integer.", 400)

        elif key == "motion_clip_pre_seconds":
            try:
                v = int(value)
                if v < 0 or v > 15:
                    return api_error("motion_clip_pre_seconds must be 0-15.", 400)
            except (ValueError, TypeError):
                return api_error("motion_clip_pre_seconds must be an integer.", 400)

        elif key == "motion_clip_post_seconds":
            try:
                v = int(value)
                if v < 0 or v > 120:
                    return api_error("motion_clip_post_seconds must be 0-120.", 400)
            except (ValueError, TypeError):
                return api_error("motion_clip_post_seconds must be an integer.", 400)

        elif key == "motion_poll_seconds":
            try:
                v = int(value)
                if v < 3 or v > 60:
                    return api_error("motion_poll_seconds must be 3-60.", 400)
            except (ValueError, TypeError):
                return api_error("motion_poll_seconds must be an integer.", 400)

        elif key == "motion_cooldown_seconds":
            try:
                v = int(value)
                if v < 10 or v > 600:
                    return api_error("motion_cooldown_seconds must be 10-600.", 400)
            except (ValueError, TypeError):
                return api_error("motion_cooldown_seconds must be an integer.", 400)

        elif key == "ffmpeg_hwaccel":
            mode = str(value).strip().lower()
            allowed = {"none", "cuda", "qsv", "vaapi", "videotoolbox", "dxva2", "d3d11va"}
            if mode not in allowed:
                return api_error(
                    "ffmpeg_hwaccel must be one of: none, cuda, qsv, vaapi, videotoolbox, dxva2, d3d11va.",
                    400,
                )
            value = mode

        elif key == "ffmpeg_hwaccel_device":
            value = str(value or "").strip()
            if len(value) > 64:
                return api_error("ffmpeg_hwaccel_device is too long.", 400)

        elif key == "motion_max_concurrent":
            try:
                v = int(value)
                if v < 1 or v > 64:
                    return api_error("motion_max_concurrent must be 1-64.", 400)
            except (ValueError, TypeError):
                return api_error("motion_max_concurrent must be an integer.", 400)

        elif key == "motion_analysis_max_width":
            try:
                v = int(value)
                if v != 0 and (v < 160 or v > 1920):
                    return api_error("motion_analysis_max_width must be 0 or 160-1920.", 400)
            except (ValueError, TypeError):
                return api_error("motion_analysis_max_width must be an integer.", 400)

        elif key == "motion_rtsp_mode":
            mode = str(value).strip().lower()
            if mode not in {"auto", "main", "sub"}:
                return api_error("motion_rtsp_mode must be auto, main, or sub.", 400)
            value = mode

        elif key == "clip_retention_days":
            try:
                v = int(value)
                if v < 1 or v > 3650:
                    return api_error("clip_retention_days must be 1-3650.", 400)
            except (ValueError, TypeError):
                return api_error("clip_retention_days must be a number.", 400)

        elif key == "events_only_buffer_hours":
            try:
                v = int(value)
                if v < 1 or v > 720:
                    return api_error("events_only_buffer_hours must be 1-720.", 400)
            except (ValueError, TypeError):
                return api_error("events_only_buffer_hours must be a number.", 400)

        elif key == "events_only_record_segments":
            value = "true" if str(value).lower() in ("true", "1", "yes") else "false"

        elif key == "min_free_gb":
            try:
                v = float(value)
                if v < 0 or v > 1000:
                    return api_error("min_free_gb must be 0-1000.", 400)
            except (ValueError, TypeError):
                return api_error("min_free_gb must be a number.", 400)

        validated.append((key, value))

    with db.atomic():
        _ensure_audit_table()
        for key, value in validated:
            old_val = get_setting(key)
            set_setting(key, value)
            if str(old_val) != str(value):
                write_audit(key, old_val, value)
            updated.append(key)

    _sync_env_vars()

    return api_response(
        {"updated": updated},
        message=(
            f"Updated {len(updated)} setting(s). "
            "Segment length is picked up by the recorder within a few seconds (FFmpeg restarts automatically). "
            "Motion clip options apply on the next processor poll (no restart needed). "
            "Other options may require restarting the recorder container if they do not apply immediately."
        ),
    )


def _sync_env_vars():
    env_map = {
        "segment_minutes": "RECORDING_SEGMENT_MINUTES",
        "retention_days":  "RECORDING_RETENTION_DAYS",
        "max_storage_gb":  "RECORDING_MAX_STORAGE_GB",
        "recordings_dir":  "RECORDINGS_DIR",
        "stagger_seconds": "RECORDING_STAGGER_SECONDS",
        "ffmpeg_hwaccel": "FFMPEG_HWACCEL",
        "ffmpeg_hwaccel_device": "FFMPEG_HWACCEL_DEVICE",
        "motion_max_concurrent": "MOTION_MAX_CONCURRENT",
        "motion_analysis_max_width": "MOTION_ANALYSIS_MAX_WIDTH",
        "motion_rtsp_mode": "MOTION_RTSP_MODE",
        "clip_retention_days": "CLIP_RETENTION_DAYS",
        "events_only_buffer_hours": "EVENTS_ONLY_BUFFER_HOURS",
        "events_only_record_segments": "EVENTS_ONLY_RECORD_SEGMENTS",
        "min_free_gb": "RECORDING_MIN_FREE_GB",
    }
    for setting_key, env_key in env_map.items():
        val = get_setting(setting_key)
        if val:
            os.environ[env_key] = str(val)
        else:
            os.environ.pop(env_key, None)


# ── Bulk toggle (original admin only) ────────────────────────────────────────

@bp.route("/bulk-toggle", methods=["POST"])
@login_required_api
def bulk_toggle_recording():
    """Only the original administrator can bulk-toggle recording."""
    if not is_original_admin():
        return api_error("Only the original administrator can change recording settings.", 403)

    data = request.get_json(silent=True) or {}
    camera_ids = data.get("camera_ids", [])
    enabled = bool(data.get("enabled", False))
    policy_raw = (data.get("recording_policy") or "").strip().lower()

    if not camera_ids:
        return api_error("camera_ids is required.", 400)

    from app.models import Camera

    if enabled:
        if policy_raw and policy_raw not in ("continuous", "events_only"):
            return api_error('recording_policy must be "continuous" or "events_only" when enabling.', 400)
        pol = policy_raw or "continuous"
        main_ids = [
            c.id
            for c in Camera.select(Camera.id, Camera.name).where(
                (Camera.id.in_(camera_ids)) & (Camera.name.endswith("-main"))
            )
        ]
        if not main_ids:
            return api_error("Recording is only supported on main streams.", 400)
        camera_ids = main_ids
        count = (
            Camera.update(recording_enabled=True, recording_policy=pol)
            .where(Camera.id.in_(camera_ids))
            .execute()
        )
    else:
        count = (
            Camera.update(recording_enabled=False, recording_policy="off")
            .where(Camera.id.in_(camera_ids))
            .execute()
        )

    status = "enabled" if enabled else "disabled"
    return api_response(
        {"updated": count, "enabled": enabled},
        message=f"Recording {status} for {count} camera(s)."
    )


# ── Engine control (original admin only) ──────────────────────────────────────

@bp.route("/engine/restart", methods=["POST"])
@login_required_api
def restart_engine():
    if not is_original_admin():
        return api_error("Only the original administrator can restart the recording engine.", 403)
    try:
        from app.recorder import engine
        if engine:
            engine.stop()
            _sync_env_vars()
            engine.start()
            return api_response(message="Recording engine restarted.")
        return api_error(
            "Recording runs in the recorder container, not this API process. "
            "Restart it with: docker restart opus-recorder (or your compose service name).",
            503,
        )
    except Exception as e:
        return api_error(f"Failed to restart engine: {e}", 500)