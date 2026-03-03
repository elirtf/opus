"""
Recording Settings API
======================
Endpoints for managing recording configuration from the UI.

Stores settings in a `setting` key-value table so they persist across restarts
and can be changed without editing .env files.

Settings hierarchy: DB settings > env vars > defaults
"""

import os
from flask import Blueprint, request
from app.routes.api.utils import api_response, api_error, login_required_api, admin_required
from app.database import db

bp = Blueprint("api_recording_settings", __name__, url_prefix="/api/recordings/settings")

# ── Defaults ──────────────────────────────────────────────────────────────────

DEFAULTS = {
    "segment_minutes":    "1",
    "retention_days":     "90",
    "max_storage_gb":     "0",
    "recordings_dir":     "/recordings",
    "stagger_seconds":    "2",
    "auto_record_new":    "false",
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
    """Get a setting value: DB > env var > default."""
    try:
        _ensure_table()
        row = db.execute_sql(
            "SELECT value FROM setting WHERE key = ?", (key,)
        ).fetchone()
        if row:
            return row[0]
    except Exception:
        pass

    # Fall back to env var
    env_map = {
        "segment_minutes": "RECORDING_SEGMENT_MINUTES",
        "retention_days":  "RECORDING_RETENTION_DAYS",
        "max_storage_gb":  "RECORDING_MAX_STORAGE_GB",
        "recordings_dir":  "RECORDINGS_DIR",
        "stagger_seconds": "RECORDING_STAGGER_SECONDS",
    }
    env_key = env_map.get(key)
    if env_key and os.environ.get(env_key):
        return os.environ[env_key]

    return default if default is not None else DEFAULTS.get(key, "")


def set_setting(key, value):
    """Save a setting to the DB."""
    _ensure_table()
    db.execute_sql(
        "INSERT OR REPLACE INTO setting (key, value) VALUES (?, ?)",
        (key, str(value))
    )


# ── GET settings ──────────────────────────────────────────────────────────────

@bp.route("/", methods=["GET"])
@login_required_api
def get_settings():
    """Return all recording configuration settings."""
    _ensure_table()

    settings = {}
    for key, default in DEFAULTS.items():
        settings[key] = get_setting(key, default)

    # Cast numeric types for the frontend
    try:
        settings["segment_minutes"] = int(settings["segment_minutes"])
    except (ValueError, TypeError):
        settings["segment_minutes"] = 1
    try:
        settings["retention_days"] = int(settings["retention_days"])
    except (ValueError, TypeError):
        settings["retention_days"] = 90
    try:
        settings["max_storage_gb"] = float(settings["max_storage_gb"])
    except (ValueError, TypeError):
        settings["max_storage_gb"] = 0
    try:
        settings["stagger_seconds"] = int(settings["stagger_seconds"])
    except (ValueError, TypeError):
        settings["stagger_seconds"] = 2

    settings["auto_record_new"] = settings.get("auto_record_new", "false") == "true"

    return api_response(settings)


# ── PUT settings ──────────────────────────────────────────────────────────────

@bp.route("/", methods=["PUT"])
@login_required_api
@admin_required
def update_settings():
    """
    Update recording configuration.
    Only provided keys are updated; missing keys keep their current values.

    Body: {
      "segment_minutes": 1,
      "retention_days": 90,
      "max_storage_gb": 500,
      "recordings_dir": "/recordings",
      "stagger_seconds": 2,
      "auto_record_new": false
    }
    """
    data = request.get_json(silent=True) or {}

    allowed_keys = set(DEFAULTS.keys())
    updated = []

    for key, value in data.items():
        if key not in allowed_keys:
            continue

        # Validate
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

        elif key == "auto_record_new":
            value = "true" if value else "false"

        elif key == "recordings_dir":
            value = str(value).strip()
            if not value.startswith("/"):
                return api_error("recordings_dir must be an absolute path.", 400)

        set_setting(key, value)
        updated.append(key)

    # Also update the env vars so the running engine picks them up
    _sync_env_vars()

    return api_response(
        {"updated": updated},
        message=f"Updated {len(updated)} setting(s). Restart the recording engine for changes to take effect."
    )


def _sync_env_vars():
    """Push DB settings into env vars so the running engine uses them."""
    env_map = {
        "segment_minutes": "RECORDING_SEGMENT_MINUTES",
        "retention_days":  "RECORDING_RETENTION_DAYS",
        "max_storage_gb":  "RECORDING_MAX_STORAGE_GB",
        "recordings_dir":  "RECORDINGS_DIR",
        "stagger_seconds": "RECORDING_STAGGER_SECONDS",
    }
    for setting_key, env_key in env_map.items():
        val = get_setting(setting_key)
        if val:
            os.environ[env_key] = str(val)


# ── Bulk toggle recording for cameras ────────────────────────────────────────

@bp.route("/bulk-toggle", methods=["POST"])
@login_required_api
@admin_required
def bulk_toggle_recording():
    """
    Enable/disable recording for multiple cameras at once.

    Body: {
      "camera_ids": [1, 2, 3],
      "enabled": true
    }
    """
    data = request.get_json(silent=True) or {}
    camera_ids = data.get("camera_ids", [])
    enabled = bool(data.get("enabled", False))

    if not camera_ids:
        return api_error("camera_ids is required.", 400)

    from app.models import Camera
    count = (
        Camera.update(recording_enabled=enabled)
        .where(Camera.id.in_(camera_ids))
        .execute()
    )

    status = "enabled" if enabled else "disabled"
    return api_response(
        {"updated": count, "enabled": enabled},
        message=f"Recording {status} for {count} camera(s)."
    )


# ── Engine control ────────────────────────────────────────────────────────────

@bp.route("/engine/restart", methods=["POST"])
@login_required_api
@admin_required
def restart_engine():
    """Restart the recording engine to pick up new settings."""
    try:
        from app.recorder import engine
        if engine:
            engine.stop()
            # Re-sync env vars before restarting
            _sync_env_vars()
            engine.start()
            return api_response(message="Recording engine restarted.")
        else:
            return api_error("Recording engine not initialized.", 503)
    except Exception as e:
        return api_error(f"Failed to restart engine: {e}", 500)