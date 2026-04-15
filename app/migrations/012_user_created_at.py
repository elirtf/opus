"""Add created_at to user table (nullable for existing rows)."""


def migrate(conn):
    cur = conn.execute("PRAGMA table_info(user)")
    cols = {row[1] for row in cur.fetchall()}
    if "created_at" not in cols:
        conn.execute('ALTER TABLE "user" ADD COLUMN created_at TEXT')
        conn.execute('UPDATE "user" SET created_at = datetime("now") WHERE created_at IS NULL')


def rollback(conn):
    # SQLite cannot DROP COLUMN easily on older versions — no-op rollback.
    pass
