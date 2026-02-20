"""
003_user_nvr
------------
Adds a user_nvr join table for NVR-level access control.

A user with no entries in this table sees nothing (unless they are an admin).
A user with entries sees only cameras belonging to their assigned NVRs.
Admins always see everything regardless of assignments.
"""


def migrate(conn):
    conn.execute("""
        CREATE TABLE IF NOT EXISTS "user_nvr" (
            id      INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            nvr_id  INTEGER NOT NULL,
            UNIQUE(user_id, nvr_id)
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_user_nvr_user ON user_nvr(user_id)
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_user_nvr_nvr ON user_nvr(nvr_id)
    """)


def rollback(conn):
    conn.execute('DROP TABLE IF EXISTS "user_nvr"')