"""
002_camera_notes — example migration (template)
Adds an optional 'notes' field to the camera table.

HOW TO ADD A NEW MIGRATION
---------------------------
1. Copy this file as 003_your_description.py
2. Write your migrate(conn) function using standard sqlite3
3. Restart the app — runs automatically

COMMON PATTERNS
---------------
    # Add a column (check first — SQLite has no ADD COLUMN IF NOT EXISTS)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(camera)")}
    if "notes" not in cols:
        conn.execute("ALTER TABLE camera ADD COLUMN notes TEXT")

    # Create a new table
    conn.execute("CREATE TABLE IF NOT EXISTS ...")

    # Add an index
    conn.execute("CREATE INDEX IF NOT EXISTS idx_camera_nvr ON camera(nvr)")
"""


def migrate(conn):
    # Always check before ALTER TABLE — SQLite has no IF NOT EXISTS for columns
    cols = {row[1] for row in conn.execute("PRAGMA table_info(camera)")}
    if "notes" not in cols:
        conn.execute("ALTER TABLE camera ADD COLUMN notes TEXT")


def rollback(conn):
    # SQLite can't drop columns directly — would need a table rebuild.
    # For now just leave it; in practice, rollbacks are rare.
    pass