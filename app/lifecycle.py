"""
Post-create_app hooks: operational alerts thread and go2rtc config + stream sync.

Keeps Flask factory focused on wiring; side-effectful startup lives here.
"""

from __future__ import annotations


def start_background_services(app) -> None:
    from app.go2rtc import sync_all_on_startup
    from app.go2rtc_config import write_go2rtc_yaml
    from app.ops_alerts import start_ops_alerts_thread

    start_ops_alerts_thread(app)

    with app.app_context():
        write_go2rtc_yaml(app)
        try:
            sync_all_on_startup()
        except Exception:
            # Defensive — sync_all_on_startup already catches internally.
            pass
