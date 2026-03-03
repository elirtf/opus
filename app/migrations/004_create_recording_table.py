"""
004_create_recording_table
------------
Adds the `recording` table for tracking recorded MP4 segments.

To apply manually (if not using the auto-migration system):
  sqlite3 /app/instance/opus.db < this_file.sql

Or via Peewee:
  from app.models import Recording
  from app.database import db
  db.create_tables([Recording])
"""


def migrate(conn):
    """
    Called by the migration runner.
    Creates the recording table with all indexes.
    """
    conn.execute("""
        CREATE TABLE IF NOT EXISTS recording (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            camera           INTEGER,
            camera_name      VARCHAR(50)  NOT NULL,
            filename         VARCHAR(255) NOT NULL,
            file_path        VARCHAR(512) NOT NULL,
            file_size        BIGINT       NOT NULL DEFAULT 0,
            started_at       DATETIME     NOT NULL,
            ended_at         DATETIME,
            duration_seconds INTEGER,
            status           VARCHAR(20)  NOT NULL DEFAULT 'complete'
        )
    """)

    # Index for camera lookups
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_recording_camera
        ON recording (camera)
    """)

    # Index for camera_name lookups (used by the API)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_recording_camera_name
        ON recording (camera_name)
    """)

    # Index for time-range queries
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_recording_started_at
        ON recording (started_at)
    """)

    # Composite index for the most common query:
    # "recordings for camera X between time A and B"
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_recording_camera_time
        ON recording (camera_name, started_at)
    """)