"""Optional API Bearer token per user (automation, split-origin UI, mobile clients)."""


def migrate(conn):
    conn.execute("ALTER TABLE user ADD COLUMN api_token_hash VARCHAR(255)")
