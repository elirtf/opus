"""
Pluggable motion / AI detectors. ProcessingEngine uses MotionDetector protocol.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod

logger = logging.getLogger("opus.detectors")


class BaseDetector(ABC):
    """Future AI detectors implement detect_motion(rtsp_url) -> bool."""

    @abstractmethod
    def detect_motion(self, rtsp_url: str) -> bool:
        pass


class StubDetector(BaseDetector):
    """No-op placeholder for wiring tests or future swap-in."""

    def detect_motion(self, rtsp_url: str) -> bool:
        return False


class OpenCvMotionDetector(BaseDetector):
    """Lightweight frame-difference motion check on a short RTSP sample."""

    def __init__(self, skip_frames: int = 8, mean_threshold: float = 5.0):
        self.skip_frames = skip_frames
        self.mean_threshold = mean_threshold

    def detect_motion(self, rtsp_url: str) -> bool:
        try:
            import cv2
        except ImportError:
            logger.warning("opencv not installed — motion detection disabled")
            return False

        cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)
        try:
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        except Exception:
            pass
        ok, f0 = cap.read()
        if not ok or f0 is None:
            cap.release()
            return False
        for _ in range(self.skip_frames):
            cap.read()
        ok, f1 = cap.read()
        cap.release()
        if not ok or f1 is None:
            return False
        g0 = cv2.cvtColor(f0, cv2.COLOR_BGR2GRAY)
        g1 = cv2.cvtColor(f1, cv2.COLOR_BGR2GRAY)
        diff = cv2.absdiff(g0, g1)
        return float(diff.mean()) >= self.mean_threshold
