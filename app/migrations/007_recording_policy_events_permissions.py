"""
Add recording_policy + substream URL on cameras, recording_event clips,
user_camera scoping, and user permission flags.
"""


def migrate(conn):
    # ── camera: recording mode + optional substream for motion sampling ─────
    try:
        conn.execute(
            "ALTER TABLE camera ADD COLUMN recording_policy VARCHAR(20) NOT NULL DEFAULT 'continuous'"
        )
    except Exception:
        pass
    try:
        conn.execute(
            "ALTER TABLE camera ADD COLUMN rtsp_substream_url VARCHAR(255)"
        )
    except Exception:
        pass

    conn.execute("""
        UPDATE camera SET recording_policy = CASE
            WHEN recording_enabled = 1 THEN 'continuous'
            ELSE 'off'
        END
    """)

    # ── Clips / motion events ───────────────────────────────────────────────
    conn.execute("""
        CREATE TABLE IF NOT EXISTS recording_event (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            camera INTEGER,
            camera_name VARCHAR(50) NOT NULL,
            filename VARCHAR(255) NOT NULL,
            file_path VARCHAR(512) NOT NULL,
            file_size INTEGER NOT NULL DEFAULT 0,
            started_at DATETIME,
            ended_at DATETIME,
            duration_seconds INTEGER,
            reason VARCHAR(20) NOT NULL DEFAULT 'motion',
            recording_id INTEGER,
            status VARCHAR(20) NOT NULL DEFAULT 'complete'
        )
    """)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_recording_event_cam_start "
        "ON recording_event (camera_name, started_at)"
    )

    # ── Per-user camera allowlist (optional; empty = use NVR assignments only) ─
    conn.execute("""
        CREATE TABLE IF NOT EXISTS user_camera (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            camera_id INTEGER NOT NULL,
            UNIQUE (user_id, camera_id)
        )
    """)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_user_camera_user ON user_camera (user_id)"
    )

    # ── Fine-grained flags (default allow for existing users) ───────────────
    try:
        conn.execute(
            'ALTER TABLE "user" ADD COLUMN can_view_live INTEGER NOT NULL DEFAULT 1'
        )
    except Exception:
        pass
    try:
        conn.execute(
            'ALTER TABLE "user" ADD COLUMN can_view_recordings INTEGER NOT NULL DEFAULT 1'
        )
    except Exception:
        pass
