"""
Add camera stream metadata fields used for deterministic main/sub routing.
"""


def migrate(conn):
    cols = {row[1] for row in conn.execute("PRAGMA table_info(camera)").fetchall()}

    if "stream_role" not in cols:
        conn.execute("ALTER TABLE camera ADD COLUMN stream_role TEXT DEFAULT 'main'")
    if "paired_stream_name" not in cols:
        conn.execute("ALTER TABLE camera ADD COLUMN paired_stream_name TEXT")

    conn.execute(
        """
        UPDATE camera
        SET stream_role = CASE
            WHEN name LIKE '%-sub' THEN 'sub'
            ELSE 'main'
        END
        """
    )
    conn.execute(
        """
        UPDATE camera
        SET paired_stream_name = CASE
            WHEN name LIKE '%-main' THEN REPLACE(name, '-main', '-sub')
            WHEN name LIKE '%-sub' THEN REPLACE(name, '-sub', '-main')
            ELSE NULL
        END
        """
    )
