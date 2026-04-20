"""
Retention: age/size caps on `recording` rows, clip events, events_only rolling buffer.

Separated from RecordingEngine so FFmpeg supervision does not own storage policy details.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta

logger = logging.getLogger("opus.recorder.retention")


def total_mp4_bytes_under(recordings_dir: str) -> int:
    """Sum byte size of all *.mp4 under per-camera subfolders (approximate storage use)."""
    total = 0
    try:
        for d in os.listdir(recordings_dir):
            dp = os.path.join(recordings_dir, d)
            if not os.path.isdir(dp):
                continue
            for f in os.listdir(dp):
                if f.endswith(".mp4"):
                    try:
                        total += os.path.getsize(os.path.join(dp, f))
                    except OSError:
                        pass
    except OSError:
        pass
    return total


def enforce_recording_retention(
    recordings_dir: str,
    *,
    retention_days: int,
    max_storage_gb: float,
    clip_retention_days: int,
    events_only_buffer_hours: int,
) -> None:
    """
    Apply age retention, optional max-storage trim, orphan DB cleanup, empty dir cleanup,
    clip retention, and events_only segment buffer purge. Logs aggregate actions.
    """
    from app.database import db

    deleted = 0

    if retention_days > 0:
        cutoff = (datetime.now() - timedelta(days=retention_days)).isoformat()
        try:
            rows = db.execute_sql(
                "SELECT id, file_path FROM recording WHERE started_at < ?", (cutoff,)
            ).fetchall()
            for rid, fp in rows:
                try:
                    if os.path.exists(fp):
                        os.remove(fp)
                    db.execute_sql("DELETE FROM recording WHERE id=?", (rid,))
                    deleted += 1
                except Exception:
                    pass
        except Exception:
            logger.exception("Age retention failed")

    if max_storage_gb > 0:
        cap = max_storage_gb * 1024**3
        total = total_mp4_bytes_under(recordings_dir)
        if total > cap:
            try:
                rows = db.execute_sql(
                    "SELECT id,file_path,file_size FROM recording ORDER BY started_at ASC"
                ).fetchall()
                freed = 0
                for rid, fp, sz in rows:
                    if freed >= total - cap:
                        break
                    try:
                        if os.path.exists(fp):
                            os.remove(fp)
                        db.execute_sql("DELETE FROM recording WHERE id=?", (rid,))
                        freed += sz or 0
                        deleted += 1
                    except Exception:
                        pass
            except Exception:
                pass

    try:
        rows = db.execute_sql("SELECT id,file_path FROM recording").fetchall()
        orphans = [r[0] for r in rows if not os.path.exists(r[1])]
        if orphans:
            ph = ",".join("?" * len(orphans))
            db.execute_sql("DELETE FROM recording WHERE id IN (%s)" % ph, orphans)
            logger.info("Cleaned %d orphan records", len(orphans))
    except Exception:
        pass

    try:
        for d in os.listdir(recordings_dir):
            p = os.path.join(recordings_dir, d)
            if os.path.isdir(p) and not os.listdir(p):
                os.rmdir(p)
    except OSError:
        pass

    if deleted:
        logger.info("Retention: deleted %d segments", deleted)

    if clip_retention_days > 0:
        _purge_old_clips(clip_retention_days)

    if events_only_buffer_hours > 0:
        _purge_events_only_buffer(events_only_buffer_hours)


def _purge_old_clips(clip_retention_days: int) -> None:
    """Delete motion/AI clip rows and files past clip_retention_days."""
    from app.database import db

    cutoff = (datetime.now() - timedelta(days=clip_retention_days)).isoformat()
    removed = 0
    try:
        rows = db.execute_sql(
            "SELECT id, file_path FROM recording_event WHERE started_at < ?",
            (cutoff,),
        ).fetchall()
        for rid, fp in rows:
            try:
                if fp and os.path.exists(fp):
                    os.remove(fp)
                db.execute_sql("DELETE FROM recording_event WHERE id=?", (rid,))
                removed += 1
            except Exception:
                pass
    except Exception:
        logger.exception("Clip retention failed")
    if removed:
        logger.info("Clip retention: deleted %d event clips", removed)


def _purge_events_only_buffer(events_only_buffer_hours: int) -> None:
    from app.database import db
    from app.models import Camera

    try:
        names = [
            c.name
            for c in Camera.select(Camera.name).where(
                (Camera.recording_policy == "events_only")
                & (Camera.active == True)
                & (Camera.recording_enabled == True)
            )
        ]
    except Exception:
        logger.exception("events_only buffer: camera query failed")
        return
    if not names:
        return

    cutoff = (datetime.now() - timedelta(hours=events_only_buffer_hours)).isoformat()
    deleted = 0
    try:
        for cam_name in names:
            rows = db.execute_sql(
                "SELECT id, file_path FROM recording WHERE camera_name = ? AND started_at < ?",
                (cam_name, cutoff),
            ).fetchall()
            for rid, fp in rows:
                try:
                    if fp and os.path.exists(fp):
                        os.remove(fp)
                    db.execute_sql("DELETE FROM recording WHERE id=?", (rid,))
                    deleted += 1
                except Exception:
                    pass
    except Exception:
        logger.exception("events_only buffer purge failed")
    if deleted:
        logger.info("events_only buffer: removed %d old segments", deleted)
