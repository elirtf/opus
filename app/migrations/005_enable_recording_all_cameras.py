"""
Migration: Enable recording on all existing cameras
====================================================
Flips recording_enabled to True for all existing active cameras.
This supports the new "record-all-by-default" behavior.
"""


def migrate(conn):
    # Add the column if it doesn't exist yet (idempotent)
    try:
        conn.execute("ALTER TABLE camera ADD COLUMN recording_enabled INTEGER NOT NULL DEFAULT 0")
    except Exception:
        pass  # Column already exists

    # Enable recording for all active main-stream cameras
    conn.execute("""
        UPDATE camera
        SET recording_enabled = 1
        WHERE active = 1
        AND name LIKE '%-main'
    """)