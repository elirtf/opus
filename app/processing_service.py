"""
Standalone processing worker (motion → clips for events_only cameras).
"""

import logging
import time

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)

from app import create_app
from app.processing.engine import ProcessingEngine
from app.processing import engine as engine_module


def main():
    app = create_app()
    eng = ProcessingEngine(app)
    engine_module.engine = eng
    eng.start()
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        eng.stop()


if __name__ == "__main__":
    main()
