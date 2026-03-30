"""Remove DB rows for recordings/events whose files are gone (e.g. volume wiped)."""

from __future__ import annotations

import logging
import os

logger = logging.getLogger("opus.recording_reconcile")


def reconcile_storage_with_db():
    """
    Delete Recording and RecordingEvent rows when file_path is missing on disk.
    Returns (removed_segments, removed_events).
    """
    from app.models import Recording, RecordingEvent

    removed_r = 0
    removed_e = 0

    for rec in Recording.select():
        fp = rec.file_path
        if not fp or not os.path.isfile(fp):
            try:
                rec.delete_instance()
                removed_r += 1
            except Exception:
                pass

    try:
        for ev in RecordingEvent.select():
            fp = ev.file_path
            if not fp or not os.path.isfile(fp):
                try:
                    ev.delete_instance()
                    removed_e += 1
                except Exception:
                    pass
    except Exception:
        pass

    if removed_r or removed_e:
        logger.info(
            "Storage reconcile: removed %d segment row(s), %d event row(s) (missing files)",
            removed_r,
            removed_e,
        )
    return removed_r, removed_e
