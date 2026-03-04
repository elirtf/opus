"""
Migration: Set segment_minutes default to 15
=============================================
Fixes the stale value of "1" that may have been saved during initial testing.
"""


def migrate(conn):
    # Create setting table if it doesn't exist yet
    conn.execute("""
        CREATE TABLE IF NOT EXISTS setting (
            key   VARCHAR(100) PRIMARY KEY,
            value TEXT NOT NULL
        )
    """)

    # Update segment_minutes to 15 if it's currently set to "1"
    conn.execute("""
        UPDATE setting SET value = '15'
        WHERE key = 'segment_minutes' AND value = '1'
    """)

    # If no row exists yet, insert the correct default
    conn.execute("""
        INSERT OR IGNORE INTO setting (key, value) VALUES ('segment_minutes', '15')
    """)