"""
Migration: Enable recording on all existing cameras
====================================================
Flips recording_enabled to True for all existing active cameras.
This supports the new "record-all-by-default" behavior.
"""


def migrate(conn):
    """Set recording_enabled=1 for all active cameras."""
    conn.execute("""
        UPDATE camera
        SET recording_enabled = 1
        WHERE active = 1
    """)