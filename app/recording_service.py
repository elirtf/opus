import os
import time

from . import create_app
from . import recorder as recorder_module
from .recorder import RecordingEngine
from .recorder_status_server import start_recorder_status_server


def main():
    """
    Entry point for the dedicated recording service.

    This runs the RecordingEngine in its own process so that API
    workers remain stateless and can be scaled independently.
    """
    app = create_app()

    try:
        from app.recording_reconcile import reconcile_storage_with_db

        removed_r, removed_e = reconcile_storage_with_db()
        if removed_r or removed_e:
            app.logger.info(
                "Startup storage reconcile: removed %s segment row(s), %s event row(s) with missing files",
                removed_r,
                removed_e,
            )
    except Exception:
        app.logger.exception("Startup storage reconcile failed")

    # Create and start the recording engine for this process only.
    # We also assign it to the module-level `engine` so any existing
    # status endpoints that import `app.recorder.engine` continue to work.
    rec_engine = RecordingEngine(app)
    recorder_module.engine = rec_engine
    rec_engine.start()

    status_port = int(os.environ.get("RECORDER_STATUS_PORT", "5055"))
    start_recorder_status_server(rec_engine, port=status_port)
    app.logger.info(
        "Recorder status HTTP on 0.0.0.0:%s (/status, /metrics)", status_port
    )

    app.logger.info("Recording service started and supervising FFmpeg processes")

    # Keep the process alive while the engine's background thread runs.
    try:
        while True:
            time.sleep(60)
    except KeyboardInterrupt:
        app.logger.info("Recording service shutting down")
        rec_engine.stop()


if __name__ == "__main__":
    main()
