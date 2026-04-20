"""
Centralised runtime configuration accessors.

DB-backed settings are synced to os.environ by recording_settings._sync_env_vars(),
so reading os.environ always reflects the latest persisted value after startup.
"""

import os

_DEFAULT_RECORDINGS_DIR = "/recordings"


def get_recordings_dir() -> str:
    """Canonical recordings path. Prefer this over reading RECORDINGS_DIR from env directly."""
    return os.environ.get("RECORDINGS_DIR", _DEFAULT_RECORDINGS_DIR)
