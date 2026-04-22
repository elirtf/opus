"""
go2rtc streaming / hardening settings (admin UI + DB).
"""
from flask import Blueprint, request, current_app
from app.routes.api.utils import api_response, api_error, login_required_api, is_original_admin
from app.go2rtc_config import go2rtc_config_path, write_go2rtc_yaml
from app import go2rtc_settings as gset
from app.routes.api.recording_settings import write_audit

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

    if "allow_arbitrary_exec" in data:
        if gset.env_arbitrary_exec_is_set():
            return api_error(
                "GO2RTC_ALLOW_ARBITRARY_EXEC is set in the environment; remove it to change this in the UI.",
                400,
            )
        old_val = gset.allow_arbitrary_exec_sources()
        new_val = bool(data["allow_arbitrary_exec"])
        gset.set_allow_arbitrary_exec(new_val)
        if old_val != new_val:
            write_audit("go2rtc_allow_arbitrary_exec", old_val, new_val)

    if "allow_exec_module" in data:
        old_val = gset.allow_exec_module()
        new_val = bool(data["allow_exec_module"])
        gset.set_allow_exec_module(new_val)
        if old_val != new_val:
            write_audit("go2rtc_allow_exec_module", old_val, new_val)

    ok = write_go2rtc_yaml(current_app)
    return api_response(
        {**gset.settings_dict_for_api(), "config_written": ok},
        message=(
            "Settings saved. Restart the go2rtc container to apply changes to go2rtc.yaml."
            if ok
            else "Settings saved but go2rtc.yaml could not be written (check GO2RTC_CONFIG_PATH and permissions)."
        ),
    )
