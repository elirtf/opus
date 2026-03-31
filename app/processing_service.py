"""
Standalone processing worker (motion → clips for events_only cameras).
"""

import logging
import time

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)

import os

from app import create_app
from app.ffmpeg_config import get_video_pipeline_summary
from app.processing.engine import ProcessingEngine
from app.processing import engine as engine_module
from app.services.worker_status_server import start_worker_status_server


def main():
    app = create_app()
    eng = ProcessingEngine(app)
    engine_module.engine = eng
    eng.start()
    vp = get_video_pipeline_summary()
    app.logger.info(
        "Video pipeline: mode=%s decoder_for_recording=%s hwaccel=%s",
        vp["recording_video_mode"],
        vp["decoder_used_for_recording"],
        vp["ffmpeg_hwaccel_env"],
    )
    status_port = int(os.environ.get("PROCESSOR_STATUS_PORT", "5056"))
    start_worker_status_server(eng, port=status_port, worker_name="processor")
    app.logger.info("Processor status HTTP on 0.0.0.0:%s (/status)", status_port)
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        eng.stop()


if __name__ == "__main__":
    main()
