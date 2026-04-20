"""
Filesystem scan → SQLite `recording` rows for completed MP4 segments.

Separated from RecordingEngine so the supervisor loop stays: desired procs → scan → retention.
"""

from __future__ import annotations

import logging
import os
import subprocess
from datetime import datetime, timedelta

logger = logging.getLogger("opus.recorder.segments")


def ensure_recording_table() -> bool:
    """Create legacy `recording` table + index if missing (SqliteQueueDatabase compatible)."""
    from app.database import db

    try:
        db.execute_sql(
            "CREATE TABLE IF NOT EXISTS recording ("
            "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
            "  camera INTEGER,"
            "  camera_name VARCHAR(50) NOT NULL,"
            "  filename VARCHAR(100) NOT NULL,"
            "  file_path VARCHAR(255) NOT NULL,"
            "  file_size INTEGER DEFAULT 0,"
            "  started_at DATETIME,"
            "  ended_at DATETIME,"
            "  duration_seconds INTEGER,"
            "  status VARCHAR(20) DEFAULT 'complete'"
            ")"
        )
        db.execute_sql(
            "CREATE INDEX IF NOT EXISTS idx_rec_cam_start "
            "ON recording (camera_name, started_at)"
        )
        return True
    except Exception:
        logger.exception("Table creation failed")
        return False


def parse_segment_filename_ts(fn: str):
    try:
        return datetime.strptime(fn.replace(".mp4", ""), "%Y-%m-%d_%H-%M-%S")
    except ValueError:
        return None


def ffprobe_segment_duration(fp: str) -> float | None:
    try:
        r = subprocess.run(
            [
                "ffprobe",
                "-v",
                "quiet",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                fp,
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if r.returncode == 0 and r.stdout.strip():
            return float(r.stdout.strip())
    except Exception:
        pass
    return None


def scan_register_new_segments(
    recordings_dir: str,
    writing_camera_names: set[str],
    *,
    segment_minutes: int,
    probe_segment_durations: bool,
) -> int:
    """
    Walk recordings_dir camera folders; insert DB rows for completed MP4s not yet registered.
    Returns count of newly inserted rows.
    """
    from app.database import db
    from app.models import Camera

    if not os.path.exists(recordings_dir):
        return 0

    known = set()
    try:
        cur = db.execute_sql("SELECT camera_name, filename FROM recording")
        for r in cur.fetchall():
            known.add((r[0], r[1]))
    except Exception:
        logger.exception("Cannot query recordings")
        return 0

    added = 0
    try:
        dirs = sorted(os.listdir(recordings_dir))
    except OSError:
        return 0

    for cam_name in dirs:
        cam_dir = os.path.join(recordings_dir, cam_name)
        if not os.path.isdir(cam_dir):
            continue
        try:
            files = sorted(f for f in os.listdir(cam_dir) if f.endswith(".mp4"))
        except OSError:
            continue
        if not files:
            continue
        parsed_ts = {fn: parse_segment_filename_ts(fn) for fn in files}

        newest = files[-1] if cam_name in writing_camera_names else None
        cam_obj = Camera.get_or_none(Camera.name == cam_name)
        cam_id = cam_obj.id if cam_obj else None

        for idx, fn in enumerate(files):
            if (cam_name, fn) in known or fn == newest:
                continue
            fp = os.path.join(cam_dir, fn)
            try:
                sz = os.path.getsize(fp)
            except OSError:
                continue
            if sz < 10240:
                continue
            sa = parsed_ts.get(fn)
            if sa is None:
                continue
            dur = None
            if probe_segment_durations:
                dur = ffprobe_segment_duration(fp)
            if dur is None and idx + 1 < len(files):
                next_sa = parsed_ts.get(files[idx + 1])
                if next_sa and next_sa > sa:
                    dur = float((next_sa - sa).total_seconds())
            if dur is None:
                dur = float(segment_minutes * 60)
            ea = sa + timedelta(seconds=int(dur))
            try:
                db.execute_sql(
                    "INSERT INTO recording"
                    " (camera,camera_name,filename,file_path,file_size,"
                    "  started_at,ended_at,duration_seconds,status)"
                    " VALUES (?,?,?,?,?,?,?,?,?)",
                    (
                        cam_id,
                        cam_name,
                        fn,
                        fp,
                        sz,
                        sa.isoformat() if sa else None,
                        ea.isoformat() if ea else None,
                        int(dur) if dur else None,
                        "complete",
                    ),
                )
                added += 1
            except Exception as exc:
                logger.debug("Insert skip %s: %s", fn, exc)

    if added:
        logger.info("Scan: registered %d new segments", added)
    return added
