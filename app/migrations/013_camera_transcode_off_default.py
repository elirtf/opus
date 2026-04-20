"""
Turn off per-camera go2rtc transcoding by default.

Migration 011 added the `transcode` column with DEFAULT 1 and retroactively set
every existing camera to `transcode = 1`. That caused go2rtc to spawn one
FFmpeg child process per stream (ffmpeg:rtsp://...#video=h264) even when the
source was already H.264 — on installs with many channels against a single NVR
this exceeds the NVR's concurrent RTSP session budget and manifests as lag,
stream-load failures, and producer churn.

Post-migration policy: passthrough by default; operators opt individual
HEVC-only cameras back into transcoding via the `camera.transcode` column
(go2rtc/README-HEVC.md) when they migrate.
"""


def migrate(conn):
    cols = {row[1] for row in conn.execute("PRAGMA table_info(camera)").fetchall()}
    if "transcode" not in cols:
        # Should not happen: 011 adds this column. Guard for fresh DBs anyway.
        conn.execute("ALTER TABLE camera ADD COLUMN transcode INTEGER DEFAULT 0")
        return

    # One-shot reset. No UI has surfaced this toggle yet, so every `= 1` row is
    # the migration-011 default rather than a deliberate operator choice.
    conn.execute("UPDATE camera SET transcode = 0 WHERE transcode = 1")
