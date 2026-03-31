"""
Pluggable motion / AI detectors. ProcessingEngine uses MotionDetector protocol.

Tune via env (processor service):
  MOTION_ANALYSIS_MAX_WIDTH — downscale frames before analysis (default 320; 0 = full res)
  MOTION_SKIP_FRAMES       — frames to drop after first grab (default 8) for fresher compare
  MOTION_DIFF_THRESHOLD    — mean pixel diff for opencv mode (default 5)
  MOTION_GAUSSIAN_KSIZE    — odd kernel e.g. 5 for pre-diff blur; 0 = off

MOG2 mode (MOTION_DETECTOR=opencv_mog2):
  MOTION_MOG2_FG_RATIO     — min fraction of foreground pixels (default 0.002)
  MOTION_MOG2_HISTORY      — MOG2 history length (default 300)
  MOTION_MOG2_VAR_THRESHOLD — sensitivity (default 24)
"""

from __future__ import annotations

import logging
import os
import threading
from abc import ABC, abstractmethod

logger = logging.getLogger("opus.detectors")


def _env_int(name: str, default: int) -> int:
    try:
        v = int(os.environ.get(name, str(default)))
        return v
    except (TypeError, ValueError):
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default


def capture_skipped_frame_pair(rtsp_url: str, skip_frames: int):
    """
    Open RTSP, read first frame, skip `skip_frames` reads, read second frame.
    Returns (f0, f1) BGR numpy arrays or (None, None).
    """
    try:
        import cv2
    except ImportError:
        logger.warning("opencv not installed — motion detection disabled")
        return None, None

    cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)
    try:
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    except Exception:
        pass
    try:
        ok, f0 = cap.read()
        if not ok or f0 is None:
            return None, None
        for _ in range(max(0, skip_frames)):
            cap.read()
        ok, f1 = cap.read()
        if not ok or f1 is None:
            return None, None
        return f0, f1
    finally:
        cap.release()


def _resize_for_analysis(bgr, max_w: int):
    """Shrink wide frames before diff / MOG2 (much less CPU). max_w 0 = no resize."""
    import cv2

    if max_w <= 0:
        return bgr
    h, w = bgr.shape[:2]
    if w <= max_w:
        return bgr
    scale = max_w / float(w)
    return cv2.resize(bgr, (max_w, int(h * scale)), interpolation=cv2.INTER_AREA)


class BaseDetector(ABC):
    @abstractmethod
    def detect_motion(self, rtsp_url: str, stream_key: str | None = None) -> bool:
        pass


class StubDetector(BaseDetector):
    def detect_motion(self, rtsp_url: str, stream_key: str | None = None) -> bool:
        return False


class OpenCvMotionDetector(BaseDetector):
    """
    Frame-difference motion on two time-separated samples.
    Downscales and optional Gaussian blur to cut CPU while keeping sensitivity tunable.
    """

    def __init__(self):
        self.analysis_max_w = _env_int("MOTION_ANALYSIS_MAX_WIDTH", 320)
        self.skip_frames = _env_int("MOTION_SKIP_FRAMES", 8)
        self.mean_threshold = _env_float("MOTION_DIFF_THRESHOLD", 5.0)
        self.gaussian_ksize = _env_int("MOTION_GAUSSIAN_KSIZE", 0)

    def detect_motion(self, rtsp_url: str, stream_key: str | None = None) -> bool:
        try:
            import cv2
        except ImportError:
            logger.warning("opencv not installed — motion detection disabled")
            return False

        f0, f1 = capture_skipped_frame_pair(rtsp_url, self.skip_frames)
        if f0 is None or f1 is None:
            return False

        f0 = _resize_for_analysis(f0, self.analysis_max_w)
        f1 = _resize_for_analysis(f1, self.analysis_max_w)

        g0 = cv2.cvtColor(f0, cv2.COLOR_BGR2GRAY)
        g1 = cv2.cvtColor(f1, cv2.COLOR_BGR2GRAY)

        k = self.gaussian_ksize
        if k >= 3 and k % 2 == 1:
            g0 = cv2.GaussianBlur(g0, (k, k), 0)
            g1 = cv2.GaussianBlur(g1, (k, k), 0)

        diff = cv2.absdiff(g0, g1)
        return float(diff.mean()) >= self.mean_threshold


class Mog2MotionDetector(BaseDetector):
    """
    Per-stream MOG2 background subtractor — adapts over time, fewer shadow/wind speckles
    than raw frame diff when tuned. Higher baseline CPU per poll than diff mode.
    """

    def __init__(self):
        self.analysis_max_w = _env_int("MOTION_ANALYSIS_MAX_WIDTH", 320)
        self.skip_frames = _env_int("MOTION_SKIP_FRAMES", 8)
        self.fg_ratio_threshold = _env_float("MOTION_MOG2_FG_RATIO", 0.002)
        self.history = _env_int("MOTION_MOG2_HISTORY", 300)
        self.var_threshold = _env_float("MOTION_MOG2_VAR_THRESHOLD", 24)
        self._subs: dict[str, object] = {}
        self._lock = threading.Lock()

    def _get_sub(self, key: str):
        import cv2

        with self._lock:
            if key not in self._subs:
                self._subs[key] = cv2.createBackgroundSubtractorMOG2(
                    history=self.history,
                    varThreshold=float(self.var_threshold),
                    detectShadows=False,
                )
            return self._subs[key]

    def detect_motion(self, rtsp_url: str, stream_key: str | None = None) -> bool:
        try:
            import cv2
        except ImportError:
            logger.warning("opencv not installed — motion detection disabled")
            return False

        key = stream_key or rtsp_url
        _prev, f1 = capture_skipped_frame_pair(rtsp_url, self.skip_frames)
        if f1 is None:
            return False

        frame = _resize_for_analysis(f1, self.analysis_max_w)
        sub = self._get_sub(key)
        fg = sub.apply(frame, learningRate=-1)
        _, binary = cv2.threshold(fg, 200, 255, cv2.THRESH_BINARY)
        nz = cv2.countNonZero(binary)
        total = binary.shape[0] * binary.shape[1]
        if total <= 0:
            return False
        ratio = nz / float(total)
        return ratio >= self.fg_ratio_threshold
