import time

from . import create_app
from .recorder import RecordingEngine, engine as global_engine


def main():
    """
    Entry point for the dedicated recording service.

    This runs the RecordingEngine in its own process so that API
    workers remain stateless and can be scaled independently.
    """
    app = create_app()

    # Create and start the recording engine for this process only.
    # We also assign it to the module-level `engine` so any existing
    # status endpoints that import `app.recorder.engine` continue to work.
    rec_engine = RecordingEngine(app)
    global global_engine
    global_engine = rec_engine
    rec_engine.start()

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

