"""
go2rtc settings — stored in the same `setting` table as recording settings.
Env GO2RTC_ALLOW_ARBITRARY_EXEC overrides DB when set (true/false).
"""
from __future__ import annotations

import json
import os

from app.routes.api.recording_settings import get_setting, set_setting

# ── Keys & defaults ───────────────────────────────────────────────────────────

GO2RTC_WEBRTC_CANDIDATES = "go2rtc_webrtc_candidates"
GO2RTC_ALLOW_ARBITRARY_EXEC = "go2rtc_allow_arbitrary_exec"
GO2RTC_ALLOW_EXEC_MODULE = "go2rtc_allow_exec_module"

_DEFAULT_CANDIDATES_JSON = '["stun:8555"]'


def get_webrtc_candidates() -> list[str]:
    raw = get_setting(GO2RTC_WEBRTC_CANDIDATES, _DEFAULT_CANDIDATES_JSON)
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            return [str(x).strip() for x in data if str(x).strip()]
    except (json.JSONDecodeError, TypeError):
        pass
    return ["stun:8555"]


def set_webrtc_candidates(candidates: list[str]) -> None:
    clean = [str(x).strip() for x in candidates if str(x).strip()]
    if not clean:
        clean = ["stun:8555"]
    set_setting(GO2RTC_WEBRTC_CANDIDATES, json.dumps(clean))


def allow_arbitrary_exec_sources() -> bool:
    """
    True if echo:/expr:/exec: stream sources are allowed.
    Env GO2RTC_ALLOW_ARBITRARY_EXEC, when set to true/false, overrides the DB.
    """
    env = os.environ.get("GO2RTC_ALLOW_ARBITRARY_EXEC")
    if env is not None and str(env).strip() != "":
        return str(env).strip().lower() in ("1", "true", "yes")
    return get_setting(GO2RTC_ALLOW_ARBITRARY_EXEC, "false").lower() in ("true", "1", "yes")


def allow_exec_module() -> bool:
    """Include go2rtc exec module (for exec: sources); default off for hardening."""
    return get_setting(GO2RTC_ALLOW_EXEC_MODULE, "false").lower() in ("true", "1", "yes")


def set_allow_arbitrary_exec(value: bool) -> None:
    set_setting(GO2RTC_ALLOW_ARBITRARY_EXEC, "true" if value else "false")


def set_allow_exec_module(value: bool) -> None:
    set_setting(GO2RTC_ALLOW_EXEC_MODULE, "true" if value else "false")


def settings_dict_for_api() -> dict:
    return {
        "webrtc_candidates": get_webrtc_candidates(),
        "allow_arbitrary_exec": allow_arbitrary_exec_sources(),
        "allow_exec_module": allow_exec_module(),
        "arbitrary_exec_env_locked": env_arbitrary_exec_is_set(),
    }


def env_arbitrary_exec_is_set() -> bool:
    return os.environ.get("GO2RTC_ALLOW_ARBITRARY_EXEC") is not None and str(
        os.environ.get("GO2RTC_ALLOW_ARBITRARY_EXEC", "")
    ).strip() != ""
