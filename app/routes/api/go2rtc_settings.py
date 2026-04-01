"""
go2rtc streaming / hardening settings (admin UI + DB).
"""
from flask import Blueprint, request, current_app
from app.routes.api.utils import api_response, api_error, login_required_api, is_original_admin
from app.go2rtc_config import go2rtc_config_path, write_go2rtc_yaml
from app import go2rtc_settings as gset

bp = Blueprint("api_go2rtc_settings", __name__, url_prefix="/api/go2rtc")


@bp.route("/settings", methods=["GET"])
@login_required_api
def get_go2rtc_settings():
    if not is_original_admin():
        return api_error("Only the original administrator can view go2rtc settings.", 403)
    data = gset.settings_dict_for_api()
    return api_response(
        {
            **data,
            "config_path": go2rtc_config_path(current_app),
            "restart_hint": "Restart the go2rtc container after saving so it reloads go2rtc.yaml.",
        }
    )


@bp.route("/settings", methods=["PUT"])
@login_required_api
def update_go2rtc_settings():
    if not is_original_admin():
        return api_error("Only the original administrator can change go2rtc settings.", 403)

    data = request.get_json(silent=True) or {}

    if "webrtc_candidates" in data:
        raw = data["webrtc_candidates"]
        if isinstance(raw, str):
            lines = [ln.strip() for ln in raw.replace(",", "\n").splitlines() if ln.strip()]
            candidates = lines
        elif isinstance(raw, list):
            candidates = [str(x).strip() for x in raw if str(x).strip()]
        else:
            return api_error("webrtc_candidates must be a list of strings or newline-separated text.", 400)
        if len(candidates) > 32:
            return api_error("At most 32 WebRTC candidates allowed.", 400)
        for c in candidates:
            if len(c) > 512:
                return api_error("Each candidate must be at most 512 characters.", 400)
        try:
            gset.set_webrtc_candidates(candidates)
        except ValueError as e:
            return api_error(str(e), 400)

    if "allow_arbitrary_exec" in data:
        if gset.env_arbitrary_exec_is_set():
            return api_error(
                "GO2RTC_ALLOW_ARBITRARY_EXEC is set in the environment; remove it to change this in the UI.",
                400,
            )
        gset.set_allow_arbitrary_exec(bool(data["allow_arbitrary_exec"]))

    if "allow_exec_module" in data:
        gset.set_allow_exec_module(bool(data["allow_exec_module"]))

    ok = write_go2rtc_yaml(current_app)
    return api_response(
        {**gset.settings_dict_for_api(), "config_written": ok},
        message=(
            "Settings saved. Restart the go2rtc container to apply changes to go2rtc.yaml."
            if ok
            else "Settings saved but go2rtc.yaml could not be written (check GO2RTC_CONFIG_PATH and permissions)."
        ),
    )
