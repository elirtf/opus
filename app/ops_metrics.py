"""
Prometheus-style counters (prometheus_client). One registry per process.

- API (Flask): import failures from NVR probe; expose GET /metrics
- Recorder: segment registration, FFmpeg launches/exits, shelved incidents; GET /metrics on status port
- Processor: clip success/fail, detector errors, heartbeat gauge; GET /metrics on processor status port
"""

from prometheus_client import Counter, Gauge, generate_latest, CONTENT_TYPE_LATEST

# ── API process (Flask) ──────────────────────────────────────────────────────

nvr_channel_probe_failures_total = Counter(
    "opus_nvr_channel_probe_failures_total",
    "Channels where main RTSP probe failed during NVR import/sync",
)

# ── Recorder process ─────────────────────────────────────────────────────────

recordings_segments_registered_total = Counter(
    "opus_recordings_segments_registered_total",
    "Recording DB rows added when scanning completed segment files from disk",
)

recorder_ffmpeg_launches_total = Counter(
    "opus_recorder_ffmpeg_launches_total",
    "Successful FFmpeg segment writer launches",
)

recorder_ffmpeg_process_exits_total = Counter(
    "opus_recorder_ffmpeg_process_exits_total",
    "FFmpeg segment writer processes that exited (crash, kill, or end of stream)",
)

recorder_shelved_incidents_total = Counter(
    "opus_recorder_shelved_incidents_total",
    "Cameras shelved after repeated FFmpeg crashes (MAX_CRASHES)",
)

recordings_disk_free_gb = Gauge(
    "opus_recordings_disk_free_gigabytes",
    "Free space on the filesystem hosting RECORDINGS_DIR (recorder process)",
)

# ── Processor process ─────────────────────────────────────────────────────────

processor_clips_written_total = Counter(
    "opus_processor_clips_written_total",
    "Motion event clips written successfully",
)

processor_clips_failed_total = Counter(
    "opus_processor_clips_failed_total",
    "Motion clip FFmpeg writes that failed or produced unusable files",
)

processor_detector_errors_total = Counter(
    "opus_processor_detector_errors_total",
    "Exceptions while running motion detection",
)

processor_last_tick_unixtime = Gauge(
    "opus_processor_last_tick_unixtime",
    "Unix time of last processing engine loop iteration",
)


def prometheus_response_body():
    """Raw bytes and content-type for HTTP handlers."""
    return generate_latest(), CONTENT_TYPE_LATEST
