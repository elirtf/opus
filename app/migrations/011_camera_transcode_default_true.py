"""
Add per-camera go2rtc transcode toggle.
"""


def migrate(conn):
    cols = {row[1] for row in conn.execute("PRAGMA table_info(camera)").fetchall()}
    if "transcode" not in cols:
        conn.execute("ALTER TABLE camera ADD COLUMN transcode INTEGER DEFAULT 1")
    conn.execute("UPDATE camera SET transcode = 1 WHERE transcode IS NULL")
