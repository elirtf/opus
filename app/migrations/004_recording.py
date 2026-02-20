"""
004_recording
-------------
Adds recording_enabled flag to the camera table.
Defaults to False — recording must be explicitly enabled per camera.
"""


def migrate(conn):
    cols = {row[1] for row in conn.execute("PRAGMA table_info(camera)")}
    if "recording_enabled" not in cols:
        conn.execute(
            "ALTER TABLE camera ADD COLUMN recording_enabled INTEGER NOT NULL DEFAULT 0"
        )


def rollback(conn):
    # SQLite can't drop columns — would need table rebuild
    pass