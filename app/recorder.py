"""
Recording Engine
================
Background service that manages FFmpeg processes for continuous camera recording.

Architecture:
  Camera (RTSP) → FFmpeg (segments into MP4 files) → /recordings/{camera_name}/

RECORDING MODES (set via RECORDING_MODE env var):
  "all"       — (default) Records ALL active cameras. No manual toggling needed.
                 Set recording_enabled=False on specific cameras to EXCLUDE them.
  "selective" — Only records cameras where recording_enabled=True.

The engine runs a supervisor loop that:
  1. Syncs FFmpeg processes with the database (start/stop as needed)
  2. Scans the filesystem for completed segments and registers them in the DB
  3. Enforces retention policy (age-based and/or storage-cap-based)
  4. Restarts any FFmpeg processes that crashed
"""

import os
import signal
import subprocess
import threading
import time
import shutil
import logging
from datetime import datetime, timedelta

logger = logging.getLogger("opus.recorder")


# ── Configuration (env vars with sensible defaults) ──────────────────────────

RECORDINGS_DIR          = os.environ.get("RECORDINGS_DIR", "/recordings")
SEGMENT_MINUTES         = int(os.environ.get("RECORDING_SEGMENT_MINUTES", "15"))
RETENTION_DAYS          = int(os.environ.get("RECORDING_RETENTION_DAYS", "90"))
MAX_STORAGE_GB          = float(os.environ.get("RECORDING_MAX_STORAGE_GB", "0"))  # 0 = unlimited
POLL_INTERVAL           = int(os.environ.get("RECORDING_POLL_SECONDS", "10"))
SCAN_INTERVAL           = int(os.environ.get("RECORDING_SCAN_SECONDS", "30"))
RETENTION_INTERVAL      = int(os.environ.get("RECORDING_RETENTION_SECONDS", "300"))  # 5 min
FFMPEG_RESTART_DELAY    = int(os.environ.get("FFMPEG_RESTART_DELAY_SECONDS", "5"))
GO2RTC_RTSP_URL         = os.environ.get("GO2RTC_RTSP_URL", "")  # e.g. rtsp://go2rtc:8554

# "all" = record every active camera (default)
# "selective" = only record cameras with recording_enabled=True
RECORDING_MODE          = os.environ.get("RECORDING_MODE", "all")

# After this many consecutive crashes, shelve the camera (stop retrying frequently)
# This prevents dead NVR channels (no physical camera) from spamming logs
MAX_CRASH_BEFORE_SHELVE = int(os.environ.get("RECORDING_MAX_CRASHES", "3"))
SHELVE_RETRY_MINUTES    = int(os.environ.get("RECORDING_SHELVE_RETRY_MINUTES", "10"))


class RecordingEngine:
    """
    Manages FFmpeg recording subprocesses for all cameras.

    Usage:
        engine = RecordingEngine(flask_app)
        engine.start()   # call once at app startup
        engine.stop()    # call on shutdown
    """

    def __init__(self, app):
        self.app = app
        self.recordings_dir = app.config.get("RECORDINGS_DIR", RECORDINGS_DIR)

        # {camera_name: ProcessInfo} — tracks running FFmpeg subprocesses
        self._processes: dict[str, dict] = {}
        self._lock = threading.Lock()
        self._running = False
        self._thread: threading.Thread | None = None

        # Stagger heavy operations so they don't all run every tick
        self._last_scan = 0.0
        self._last_retention = 0.0

    # ── Lifecycle ─────────────────────────────────────────────────────────

    def start(self):
        """Start the background supervisor thread."""
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._supervisor_loop, daemon=True, name="recorder")
        self._thread.start()
        logger.info(f"Recording engine started (mode={RECORDING_MODE})")

    def stop(self):
        """Gracefully stop all recordings and the supervisor thread."""
        logger.info("Recording engine stopping...")
        self._running = False
        self._stop_all_processes()
        if self._thread:
            self._thread.join(timeout=15)
        logger.info("Recording engine stopped")

    # ── Supervisor loop ───────────────────────────────────────────────────

    def _supervisor_loop(self):
        """Main loop — runs in background thread."""
        # Small initial delay to let the app finish starting up
        time.sleep(3)

        while self._running:
            try:
                with self.app.app_context():
                    self._sync_processes()

                    now = time.time()

                    # Segment scanning (less frequent than process sync)
                    if now - self._last_scan >= SCAN_INTERVAL:
                        self._scan_completed_segments()
                        self._last_scan = now

                    # Retention enforcement (even less frequent)
                    if now - self._last_retention >= RETENTION_INTERVAL:
                        self._enforce_retention()
                        self._last_retention = now

            except Exception:
                logger.exception("Recording engine supervisor error")

            time.sleep(POLL_INTERVAL)

    # ── Process management ────────────────────────────────────────────────

    def _get_cameras_to_record(self):
        """
        Returns a dict of {camera_name: Camera} that should be recording,
        based on the current RECORDING_MODE.

        Skips sub-streams — only main streams get recorded.
        Sub-streams are low-res duplicates used for live grid view;
        recording them wastes storage with no benefit.
        """
        from app.models import Camera

        if RECORDING_MODE == "selective":
            query = Camera.select().where(
                (Camera.recording_enabled == True) & (Camera.active == True)
            )
        else:
            # "all" mode — record every active camera UNLESS explicitly excluded
            query = Camera.select().where(
                (Camera.active == True) & (Camera.recording_enabled != False)
            )

        # Filter out sub-streams — only record main streams
        return {
            cam.name: cam for cam in query
            if not cam.name.endswith("-sub")
        }

    def _sync_processes(self):
        """
        Reconcile running FFmpeg processes with the database.
        Start processes for cameras that need recording, stop those that don't,
        and restart any that have crashed — with exponential backoff for
        unreachable streams so dead NVR channels don't spam logs.
        """
        desired = self._get_cameras_to_record()

        with self._lock:
            # Stop processes for cameras that no longer need recording
            for name in list(self._processes.keys()):
                if name not in desired:
                    self._stop_process(name)
                    logger.info(f"Stopped recording: {name} (removed or excluded)")

            # Start or restart processes for desired cameras
            for name, cam in desired.items():
                info = self._processes.get(name)

                if info is None:
                    # Never started — launch it
                    self._start_process(cam)

                elif info.get("shelved"):
                    # Camera has been shelved after too many failures.
                    # Only retry every SHELVE_RETRY_INTERVAL (default 10 min).
                    if time.time() >= info.get("retry_after", 0):
                        logger.info(f"Retrying shelved camera: {name} (was {info.get('crash_count', 0)} crashes)")
                        old_crashes = info.get("crash_count", 0)
                        del self._processes[name]
                        self._start_process(cam)
                        if name in self._processes:
                            self._processes[name]["crash_count"] = old_crashes

                elif info["process"].poll() is not None:
                    # Process exited (crashed or stream ended)
                    exit_code = info["process"].returncode
                    runtime = time.time() - info["started_at"]

                    # Read stderr for diagnostics
                    stderr_output = ""
                    try:
                        stderr_output = info["process"].stderr.read().decode(
                            errors="replace"
                        )[-500:]
                    except Exception:
                        pass

                    crash_count = info.get("crash_count", 0) + 1
                    info["crash_count"] = crash_count
                    info["last_error"] = stderr_output[-300:] if stderr_output else f"exit code {exit_code}"

                    # Only log full warning for first few crashes, then reduce noise
                    if crash_count <= 3:
                        logger.warning(
                            f"FFmpeg exited for {name}: code={exit_code}, "
                            f"runtime={runtime:.0f}s, stderr=...{stderr_output[-200:]}"
                        )
                    elif crash_count == 4:
                        logger.warning(
                            f"FFmpeg for {name} has failed {crash_count} times — "
                            f"shelving (will retry every {SHELVE_RETRY_MINUTES}min). "
                            f"Last error: ...{stderr_output[-100:]}"
                        )

                    # Shelve cameras that keep failing (likely no physical camera on that channel)
                    if crash_count >= MAX_CRASH_BEFORE_SHELVE:
                        info["shelved"] = True
                        info["retry_after"] = time.time() + (SHELVE_RETRY_MINUTES * 60)
                        continue

                    # Exponential backoff: 5s, 10s, 20s, 40s, 60s max
                    backoff = min(FFMPEG_RESTART_DELAY * (2 ** (crash_count - 1)), 60)
                    info["restart_after"] = time.time() + backoff
                    continue

                elif info.get("restart_after") and time.time() < info["restart_after"]:
                    continue  # still waiting for backoff

                elif info.get("restart_after") and time.time() >= info["restart_after"]:
                    # Backoff expired — restart
                    old_info = self._processes.pop(name)
                    self._start_process(cam)
                    if name in self._processes:
                        self._processes[name]["crash_count"] = old_info.get("crash_count", 0)
                        self._processes[name]["last_error"] = old_info.get("last_error")

    def _build_ffmpeg_cmd(self, source_url: str, output_pattern: str) -> list:
        """
        Build the FFmpeg command for recording an RTSP stream.

        Key lessons from Frigate's recording pipeline:
          - NEVER use -movflags +faststart with -f segment. Faststart rewrites
            the moov atom after each segment finishes, which conflicts with the
            segment muxer and causes crashes on streams with timestamp quirks.
          - Use -fflags +genpts to regenerate clean timestamps (fixes
            non-monotonic DTS warnings common with NVR RTSP streams).
          - Keep the command minimal — stream copy, no transcode.
        """
        segment_seconds = SEGMENT_MINUTES * 60

        cmd = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel", "error",
            "-y",

            # ── Input options ──
            "-fflags", "+genpts+discardcorrupt",  # regenerate timestamps, drop corrupt frames
            "-rtsp_transport", "tcp",
            "-rtsp_flags", "prefer_tcp",
            "-use_wallclock_as_timestamps", "1",
            "-timeout", "15000000",               # 15s connection timeout (µs)
            "-analyzeduration", "10000000",        # 10s to analyze stream
            "-probesize", "10000000",              # 10MB probe buffer

            "-i", source_url,

            # ── Output options ──
            "-c", "copy",                         # no transcoding — just remux
            "-an",                                # drop audio (saves storage)
            "-avoid_negative_ts", "make_zero",    # normalize timestamps
            "-f", "segment",
            "-segment_time", str(segment_seconds),
            "-segment_format", "mp4",
            "-segment_atclocktime", "1",
            "-strftime", "1",
            "-reset_timestamps", "1",
            "-break_non_keyframes", "1",
            # NOTE: no -movflags +faststart here — it conflicts with -f segment
            # and causes crashes. Browser playback works fine without it.
            # If needed later, we can remux completed segments like Frigate does.

            output_pattern,
        ]

        return cmd

    # ── go2rtc stream name resolution ────────────────────────────────────

    _go2rtc_streams_cache: dict | None = None
    _go2rtc_cache_time: float = 0

    def _resolve_go2rtc_stream(self, camera_name: str) -> str | None:
        """
        Look up the correct go2rtc stream name for a camera.
        go2rtc stream names may use different case (e.g. CBW-ch1-main vs cbw-ch1-main).
        Caches the stream list for 60 seconds to avoid hammering the API.
        """
        import json
        import urllib.request

        now = time.time()
        if self._go2rtc_streams_cache is None or (now - self._go2rtc_cache_time) > 60:
            try:
                go2rtc_api = GO2RTC_RTSP_URL.replace("rtsp://", "http://").replace(":8554", ":1984")
                data = urllib.request.urlopen(f"{go2rtc_api}/api/streams", timeout=5).read()
                streams = json.loads(data)
                # Build case-insensitive lookup: lowercase -> actual name
                self._go2rtc_streams_cache = {k.lower(): k for k in streams.keys()}
                self._go2rtc_cache_time = now
            except Exception as e:
                logger.warning(f"Failed to query go2rtc streams API: {e}")
                # Fall back to using camera name as-is
                return camera_name

        return self._go2rtc_streams_cache.get(camera_name.lower())

    def _start_process(self, camera):
        """Launch an FFmpeg subprocess for a camera."""
        cam_dir = os.path.join(self.recordings_dir, camera.name)
        os.makedirs(cam_dir, exist_ok=True)

        output_pattern = os.path.join(cam_dir, "%Y-%m-%d_%H-%M-%S.mp4")

        # Determine source URL
        if GO2RTC_RTSP_URL:
            # Resolve correct stream name (go2rtc may use different case)
            stream_name = self._resolve_go2rtc_stream(camera.name)
            if stream_name is None:
                logger.warning(
                    f"No go2rtc stream found for {camera.name} — skipping"
                )
                return
            source_url = f"{GO2RTC_RTSP_URL}/{stream_name}"
        else:
            source_url = camera.rtsp_url

        cmd = self._build_ffmpeg_cmd(source_url, output_pattern)

        try:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
            )
        except FileNotFoundError:
            logger.error(
                "ffmpeg not found! Install FFmpeg in the Docker image. "
                "Add 'RUN apt-get update && apt-get install -y ffmpeg' to your Dockerfile."
            )
            return
        except Exception:
            logger.exception(f"Failed to start FFmpeg for {camera.name}")
            return

        self._processes[camera.name] = {
            "process": proc,
            "camera_id": camera.id,
            "camera_name": camera.name,
            "source_url": source_url,
            "started_at": time.time(),
            "restart_after": None,
            "crash_count": 0,
            "last_error": None,
        }

        logger.info(
            f"Recording started: {camera.name} → {cam_dir}/ "
            f"(PID {proc.pid}, {SEGMENT_MINUTES}min segments)"
        )

    def _stop_process(self, camera_name: str):
        """Gracefully stop an FFmpeg process (SIGINT → wait → SIGKILL)."""
        info = self._processes.pop(camera_name, None)
        if not info:
            return

        proc = info["process"]
        if proc.poll() is not None:
            return  # already dead

        try:
            proc.send_signal(signal.SIGINT)
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            logger.warning(f"FFmpeg for {camera_name} didn't stop gracefully — killing")
            proc.kill()
            proc.wait(timeout=5)
        except Exception:
            logger.exception(f"Error stopping FFmpeg for {camera_name}")

    def _stop_all_processes(self):
        """Stop every running FFmpeg process."""
        with self._lock:
            for name in list(self._processes.keys()):
                self._stop_process(name)

    # ── Segment scanning ──────────────────────────────────────────────────

    def _scan_completed_segments(self):
        """
        Walk the recordings directory and register any completed MP4 segments
        that aren't already in the database.
        """
        from app.models import Recording, Camera
        from app.database import db

        if not os.path.exists(self.recordings_dir):
            logger.debug(f"Recordings dir missing: {self.recordings_dir}")
            return

        # ── Ensure the recording table exists ──
        # If the migration hasn't run, create the table directly as a safety net.
        try:
            Recording.select().limit(1).count()
        except Exception as e:
            logger.warning(f"Recording table not found ({e}) — creating it now")
            try:
                db.create_tables([Recording])
                logger.info("Recording table created successfully")
            except Exception:
                logger.exception("Failed to create recording table — scanner disabled")
                return

        # Build a set of camera names with active FFmpeg processes
        active_dirs = set()
        with self._lock:
            for name, info in self._processes.items():
                if not info.get("shelved"):
                    active_dirs.add(name)

        # Build a set of already-known files for fast lookup
        known = set()
        for rec in Recording.select(Recording.camera_name, Recording.filename):
            known.add((rec.camera_name, rec.filename))

        new_segments = []

        try:
            cam_dirs = [
                d for d in os.listdir(self.recordings_dir)
                if os.path.isdir(os.path.join(self.recordings_dir, d))
            ]
        except OSError as e:
            logger.warning(f"Cannot list recordings dir: {e}")
            return

        scanned_files = 0
        skipped_known = 0
        skipped_active = 0
        skipped_small = 0
        skipped_parse = 0

        for cam_name in cam_dirs:
            cam_dir = os.path.join(self.recordings_dir, cam_name)

            try:
                files = [f for f in os.listdir(cam_dir) if f.endswith(".mp4")]
            except OSError:
                continue

            if not files:
                continue

            scanned_files += len(files)

            # Identify the newest file — it's likely still being written
            files_sorted = sorted(files)
            newest_file = files_sorted[-1] if cam_name in active_dirs else None

            for filename in files:
                if (cam_name, filename) in known:
                    skipped_known += 1
                    continue

                if filename == newest_file:
                    skipped_active += 1
                    continue

                filepath = os.path.join(cam_dir, filename)

                try:
                    stat = os.stat(filepath)
                except OSError:
                    continue

                if stat.st_size < 10240:
                    skipped_small += 1
                    continue

                started_at = self._parse_segment_time(filename)
                if not started_at:
                    skipped_parse += 1
                    continue

                duration = self._probe_duration(filepath)

                ended_at = None
                if started_at and duration:
                    ended_at = started_at + timedelta(seconds=int(duration))

                cam = Camera.get_or_none(Camera.name == cam_name)
                camera_id = cam.id if cam else None

                new_segments.append({
                    "camera": camera_id,
                    "camera_name": cam_name,
                    "filename": filename,
                    "file_path": filepath,
                    "file_size": stat.st_size,
                    "started_at": started_at,
                    "ended_at": ended_at,
                    "duration_seconds": int(duration) if duration else None,
                    "status": "complete",
                })

        # Insert new segments — use individual inserts instead of db.atomic()
        # because SqliteQueueDatabase doesn't support atomic() transactions
        inserted = 0
        for seg in new_segments:
            try:
                Recording.create(**seg)
                inserted += 1
            except Exception as e:
                logger.warning(f"Failed to insert segment {seg['filename']}: {e}")

        logger.info(
            f"Scan: {len(cam_dirs)} dirs, {scanned_files} files, "
            f"{inserted} new, {skipped_known} known, "
            f"{skipped_active} active, {skipped_small} small, "
            f"{skipped_parse} unparseable"
        )

    @staticmethod
    def _parse_segment_time(filename: str) -> datetime | None:
        """Parse datetime from segment filename like '2024-01-15_14-00-00.mp4'."""
        stem = filename.replace(".mp4", "")
        try:
            return datetime.strptime(stem, "%Y-%m-%d_%H-%M-%S")
        except ValueError:
            return None

    @staticmethod
    def _probe_duration(filepath: str) -> float | None:
        """Use ffprobe to get the duration of an MP4 file in seconds."""
        try:
            result = subprocess.run(
                [
                    "ffprobe",
                    "-v", "quiet",
                    "-show_entries", "format=duration",
                    "-of", "default=noprint_wrappers=1:nokey=1",
                    filepath,
                ],
                capture_output=True,
                text=True,
                timeout=10,
            )
            if result.returncode == 0 and result.stdout.strip():
                return float(result.stdout.strip())
        except Exception:
            pass
        return None

    # ── Retention enforcement ─────────────────────────────────────────────

    def _enforce_retention(self):
        """
        Delete recordings that exceed retention policy.
        Two policies (both enforced):
          1. Age-based:   delete segments older than RETENTION_DAYS
          2. Storage-cap: delete oldest segments until total < MAX_STORAGE_GB
        """
        from app.models import Recording
        from app.database import db

        deleted_count = 0

        # ── Age-based retention ──
        if RETENTION_DAYS > 0:
            cutoff = datetime.now() - timedelta(days=RETENTION_DAYS)
            old_recordings = (
                Recording.select()
                .where(Recording.started_at < cutoff)
                .order_by(Recording.started_at.asc())
            )

            for rec in old_recordings:
                if self._delete_recording_file(rec):
                    deleted_count += 1

        # ── Storage-cap retention ──
        if MAX_STORAGE_GB > 0:
            max_bytes = MAX_STORAGE_GB * 1024 * 1024 * 1024
            total_size = self._get_total_storage_bytes()

            if total_size > max_bytes:
                overage = total_size - max_bytes
                freed = 0

                # Delete oldest recordings first
                oldest = (
                    Recording.select()
                    .order_by(Recording.started_at.asc())
                )
                for rec in oldest:
                    if freed >= overage:
                        break
                    size = rec.file_size
                    if self._delete_recording_file(rec):
                        freed += size
                        deleted_count += 1

        # ── Orphan cleanup ──
        # Delete DB records whose files no longer exist on disk
        orphans = []
        for rec in Recording.select():
            if not os.path.exists(rec.file_path):
                orphans.append(rec.id)

        if orphans:
            with db.atomic():
                Recording.delete().where(Recording.id.in_(orphans)).execute()
            logger.info(f"Cleaned up {len(orphans)} orphaned DB records")

        # ── Empty directory cleanup ──
        self._cleanup_empty_dirs()

        if deleted_count:
            logger.info(f"Retention: deleted {deleted_count} recording segments")

    def _delete_recording_file(self, recording) -> bool:
        """Delete the file from disk and remove the DB record."""
        try:
            if os.path.exists(recording.file_path):
                os.remove(recording.file_path)
            recording.delete_instance()
            return True
        except Exception:
            logger.exception(f"Failed to delete recording: {recording.file_path}")
            return False

    def _get_total_storage_bytes(self) -> int:
        """Calculate total bytes used by all recordings on disk."""
        total = 0
        try:
            for cam_dir_name in os.listdir(self.recordings_dir):
                cam_dir = os.path.join(self.recordings_dir, cam_dir_name)
                if not os.path.isdir(cam_dir):
                    continue
                for f in os.listdir(cam_dir):
                    if f.endswith(".mp4"):
                        try:
                            total += os.path.getsize(os.path.join(cam_dir, f))
                        except OSError:
                            pass
        except OSError:
            pass
        return total

    def _cleanup_empty_dirs(self):
        """Remove empty camera directories from the recordings folder."""
        try:
            for d in os.listdir(self.recordings_dir):
                cam_dir = os.path.join(self.recordings_dir, d)
                if os.path.isdir(cam_dir) and not os.listdir(cam_dir):
                    os.rmdir(cam_dir)
        except OSError:
            pass

    # ── RTSP Diagnostics ──────────────────────────────────────────────────

    def test_rtsp(self, rtsp_url: str, timeout: int = 10) -> dict:
        """
        Test an RTSP URL by running a short ffprobe against it.
        Returns a diagnostic dict with connection status, codec info, etc.
        Used by the /api/recordings/diagnose endpoint.
        """
        result = {
            "url": rtsp_url,
            "reachable": False,
            "error": None,
            "video_codec": None,
            "resolution": None,
            "fps": None,
            "audio_codec": None,
        }

        try:
            probe = subprocess.run(
                [
                    "ffprobe",
                    "-v", "error",
                    "-rtsp_transport", "tcp",
                    "-rtsp_flags", "prefer_tcp",
                    "-timeout", str(timeout * 1000000),
                    "-show_streams",
                    "-show_format",
                    "-of", "json",
                    rtsp_url,
                ],
                capture_output=True,
                text=True,
                timeout=timeout + 5,
            )

            if probe.returncode != 0:
                result["error"] = probe.stderr.strip()[-300:] if probe.stderr else f"ffprobe exited with code {probe.returncode}"
                return result

            import json
            data = json.loads(probe.stdout)
            result["reachable"] = True

            for stream in data.get("streams", []):
                if stream.get("codec_type") == "video":
                    result["video_codec"] = stream.get("codec_name")
                    result["resolution"] = f"{stream.get('width')}x{stream.get('height')}"
                    # Parse FPS from various fields
                    fps_str = stream.get("r_frame_rate", "0/1")
                    try:
                        num, den = fps_str.split("/")
                        result["fps"] = round(int(num) / int(den), 1)
                    except Exception:
                        result["fps"] = fps_str
                elif stream.get("codec_type") == "audio":
                    result["audio_codec"] = stream.get("codec_name")

        except subprocess.TimeoutExpired:
            result["error"] = f"Connection timed out after {timeout}s — camera may be unreachable or RTSP URL is wrong"
        except FileNotFoundError:
            result["error"] = "ffprobe not found — FFmpeg is not installed in the container"
        except Exception as e:
            result["error"] = str(e)

        return result

    # ── Status API (called by routes) ─────────────────────────────────────

    def get_status(self) -> dict:
        """Return current recording engine status for the API."""
        with self._lock:
            processes = {}
            shelved_cameras = []
            for name, info in self._processes.items():
                if info.get("shelved"):
                    shelved_cameras.append({
                        "name": name,
                        "crash_count": info.get("crash_count", 0),
                        "last_error": info.get("last_error"),
                        "retry_after": datetime.fromtimestamp(
                            info.get("retry_after", 0)
                        ).isoformat() if info.get("retry_after") else None,
                    })
                    continue

                proc = info["process"]
                running = proc.poll() is None
                processes[name] = {
                    "pid": proc.pid,
                    "running": running,
                    "uptime_seconds": int(time.time() - info["started_at"]) if running else 0,
                    "exit_code": proc.returncode if not running else None,
                    "crash_count": info.get("crash_count", 0),
                    "last_error": info.get("last_error"),
                    "source_url": info.get("source_url", ""),
                }

        # Storage stats
        total_bytes = self._get_total_storage_bytes()
        disk = shutil.disk_usage(self.recordings_dir) if os.path.exists(self.recordings_dir) else None

        return {
            "engine_running": self._running,
            "recording_mode": RECORDING_MODE,
            "active_recordings": sum(1 for p in processes.values() if p["running"]),
            "total_processes": len(processes),
            "shelved_count": len(shelved_cameras),
            "processes": processes,
            "shelved": shelved_cameras,
            "storage": {
                "recordings_bytes": total_bytes,
                "recordings_gb": round(total_bytes / (1024**3), 2),
                "disk_total_gb": round(disk.total / (1024**3), 2) if disk else None,
                "disk_free_gb": round(disk.free / (1024**3), 2) if disk else None,
                "max_storage_gb": MAX_STORAGE_GB or None,
            },
            "config": {
                "recording_mode": RECORDING_MODE,
                "segment_minutes": SEGMENT_MINUTES,
                "retention_days": RETENTION_DAYS,
                "max_storage_gb": MAX_STORAGE_GB or None,
                "poll_interval": POLL_INTERVAL,
                "max_crash_before_shelve": MAX_CRASH_BEFORE_SHELVE,
                "shelve_retry_minutes": SHELVE_RETRY_MINUTES,
                "source": "go2rtc_relay" if GO2RTC_RTSP_URL else "direct_rtsp",
            },
        }


# ── Module-level singleton ────────────────────────────────────────────────────
# Initialized in create_app(), accessible everywhere via `from app.recorder import engine`

engine: RecordingEngine | None = None