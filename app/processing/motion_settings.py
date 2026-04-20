"""
Resolved motion-clip / processor timing from DB (recording_settings) with env fallback.
Used by the processor service — read on each tick / clip so UI changes apply without restart.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.routes.api.recording_settings import get_setting


@dataclass(frozen=True)
class MotionClipSettings:
    clip_seconds: int
    pre_seconds: int
    post_seconds: int
    poll_seconds: int
    cooldown_seconds: int


def _parse_int(key: str, default: int, lo: int, hi: int) -> int:
    raw = get_setting(key, str(default))
    try:
        v = int(float(raw))
    except (TypeError, ValueError):
        v = default
    return max(lo, min(hi, v))


def read_motion_clip_settings() -> MotionClipSettings:
    return MotionClipSettings(
        clip_seconds=_parse_int("motion_clip_seconds", 45, 5, 300),
        pre_seconds=_parse_int("motion_clip_pre_seconds", 0, 0, 15),
        post_seconds=_parse_int("motion_clip_post_seconds", 0, 0, 120),
        poll_seconds=_parse_int("motion_poll_seconds", 6, 3, 60),
        cooldown_seconds=_parse_int("motion_cooldown_seconds", 75, 10, 600),
    )
