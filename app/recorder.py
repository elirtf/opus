"""
Recording Engine - Opus NVR
Manages FFmpeg recording via go2rtc relay.
Uses raw SQL (SqliteQueueDatabase compatible).
Staggers FFmpeg launches to avoid overwhelming go2rtc/NVR.
FFmpeg args matched to Frigate's battle-tested presets.
"""

import os
import signal
import subprocess
import threading
import time
from collections import deque
import shutil
import logging
from app.config import get_recordings_dir
from app.ffmpeg_config import get_video_pipeline_summary
from app.go2rtc import go2rtc_rtsp_source
from app import recorder_retention
from app import recorder_segments
from app.routes.api.utils import env_bool

logger = logging.getLogger("opus.recorder")


def _start_ffmpeg_stderr_drain(proc: subprocess.Popen, camera_name: str):
    """
    FFmpeg is started with stderr=PIPE so crashes can be diagnosed. The supervisor
    must drain that pipe while the process runs; otherwise the OS buffer fills and
    FFmpeg blocks on logging (segment rotation appears to stall indefinitely).
    Returns (daemon_thread, deque of recent lines for last_error on exit).
    """
    recent: deque[str] = deque(maxlen=80)

    def _run():
        try:
            errpipe = proc.stderr
            if errpipe is None:
                return
            for line in iter(errpipe.readline, b""):
                if not line:
                    break
                text = line.decode(errors="replace").rstrip()
                if text:
                    recent.append(text)
                    logger.debug("%s ffmpeg: %s", camera_name, text)
        except Exception:
            logger.exception("stderr drain failed for %s", camera_name)

    t = threading.Thread(
        target=_run,
        name="ffmpeg-stderr-%s" % (camera_name[:24] or "cam"),
        daemon=True,
    )
    t.start()
    return t, recent


RECORDINGS_DIR       = get_recordings_dir()
SEGMENT_MINUTES      = int(os.environ.get("RECORDING_SEGMENT_MINUTES", "5"))
RETENTION_DAYS       = int(os.environ.get("RECORDING_RETENTION_DAYS", "90"))
CLIP_RETENTION_DAYS  = int(os.environ.get("CLIP_RETENTION_DAYS", "90"))
MAX_STORAGE_GB       = float(os.environ.get("RECORDING_MAX_STORAGE_GB", "0"))
POLL_INTERVAL        = int(os.environ.get("RECORDING_POLL_SECONDS", "10"))
SCAN_INTERVAL        = int(os.environ.get("RECORDING_SCAN_SECONDS", "30"))
RETENTION_INTERVAL   = int(os.environ.get("RECORDING_RETENTION_SECONDS", "300"))
FFMPEG_RESTART_DELAY = int(os.environ.get("FFMPEG_RESTART_DELAY_SECONDS", "5"))
GO2RTC_RTSP_URL      = os.environ.get("GO2RTC_RTSP_URL", "")
MAX_CRASHES          = int(os.environ.get("RECORDING_MAX_CRASHES", "3"))
SHELVE_RETRY_MIN     = int(os.environ.get("RECORDING_SHELVE_RETRY_MINUTES", "1"))
# Any FFmpeg run that stayed up at least this long is considered healthy; the
# next crash is treated as a fresh first-offence rather than accumulating
# toward the shelve threshold. This keeps brief upstream hiccups (e.g. a
# go2rtc container restart or NVR session drop) from disabling recording for
# minutes at a time while still letting persistently-broken cameras fail fast
# (crashes within the first few seconds still accumulate as before).
HEALTHY_RUN_SECONDS  = int(os.environ.get("RECORDING_HEALTHY_RUN_SECONDS", "60"))
STAGGER_DELAY        = float(os.environ.get("RECORDING_STAGGER_SECONDS", "2"))
# Rolling segment buffer for events_only cameras (hours); older segments are purged first.
EVENTS_ONLY_BUFFER_HOURS = int(os.environ.get("EVENTS_ONLY_BUFFER_HOURS", "48"))
PROBE_SEGMENT_DURATIONS = env_bool("RECORDING_PROBE_DURATIONS", False)


# When True, events_only cameras get 24/7 FFmpeg segment recording (rolling buffer up to EVENTS_ONLY_BUFFER_HOURS).
# When False (default), events_only does not run segment recording — only motion clips from the processor.
EVENTS_ONLY_RECORD_SEGMENTS = env_bool("EVENTS_ONLY_RECORD_SEGMENTS", False)


def _norm_recording_policy(cam) -> str:
    p = getattr(cam, "recording_policy", None)
    if p is None:
        return "continuous"
    s = str(p).strip().lower()
    return s if s else "continuous"


def _camera_should_record_segments(cam) -> bool:
    """Whether this camera should have an FFmpeg segment writer (vs clips-only for events_only)."""
    pol = _norm_recording_policy(cam)
    if pol == "off":
        return False
    if pol == "events_only":
        return _events_only_record_segments_from_db()
    return True


# Do not start new FFmpeg writers when free space on the recordings volume drops below this (0 = disabled).
MIN_FREE_GB = float(os.environ.get("RECORDING_MIN_FREE_GB", "1") or "0")


def _segment_minutes_from_db():
    """
    Segment duration from the setting table (same DB the API writes).
    Import-time RECORDING_SEGMENT_MINUTES is only a bootstrap default; the recorder
    service must read the DB so UI changes take effect without container rebuild.
    """
    try:
        from app.routes.api.recording_settings import get_setting

        raw = get_setting("segment_minutes", "5")
        v = int(raw or os.environ.get("RECORDING_SEGMENT_MINUTES", "5"))
        return max(1, min(60, v))
    except Exception:
        return max(1, min(60, int(os.environ.get("RECORDING_SEGMENT_MINUTES", "5"))))


def _clip_retention_days_from_db():
    try:
        from app.routes.api.recording_settings import get_setting
        raw = get_setting("clip_retention_days", "90")
        return max(1, int(raw or 90))
    except Exception:
        return max(1, int(os.environ.get("CLIP_RETENTION_DAYS", "90")))


def _events_only_buffer_hours_from_db():
    try:
        from app.routes.api.recording_settings import get_setting
        raw = get_setting("events_only_buffer_hours", "48")
        return max(1, int(raw or 48))
    except Exception:
        return max(1, int(os.environ.get("EVENTS_ONLY_BUFFER_HOURS", "48")))


def _events_only_record_segments_from_db():
    try:
        from app.routes.api.recording_settings import get_setting
        raw = get_setting("events_only_record_segments", "false")
        return str(raw).lower() in ("true", "1", "yes")
    except Exception:
        return env_bool("EVENTS_ONLY_RECORD_SEGMENTS", False)


def _min_free_gb_from_db():
    try:
        from app.routes.api.recording_settings import get_setting
        raw = get_setting("min_free_gb", "1")
        return max(0.0, float(raw or "0"))
    except Exception:
        return float(os.environ.get("RECORDING_MIN_FREE_GB", "1") or "0")


class RecordingEngine:

    def __init__(self, app):
        self.app = app
        self.recordings_dir = app.config.get("RECORDINGS_DIR", RECORDINGS_DIR)
        self._procs = {}
        self._lock = threading.Lock()
        self._running = False
        self._thread = None
        self._last_scan = 0.0
        self._last_retention = 0.0
        self._table_ok = False

    def start(self):
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True, name="recorder")
        self._thread.start()
        logger.info(
            "Recording engine started (seg=%smin, relay=%s, stagger=%ss, events_only_segments=%s)",
            _segment_minutes_from_db(),
            "yes" if GO2RTC_RTSP_URL else "no",
            STAGGER_DELAY,
            "on" if _events_only_record_segments_from_db() else "off",
        )
        vp = get_video_pipeline_summary()
        logger.info(
            "Video pipeline: mode=%s decoder_for_recording=%s hwaccel=%s",
            vp["recording_video_mode"],
            vp["decoder_used_for_recording"],
            vp["ffmpeg_hwaccel_env"],
        )

    def stop(self):
        self._running = False
        with self._lock:
            for n in list(self._procs):
                self._kill(n)
        if self._thread:
            self._thread.join(timeout=15)

    def _loop(self):
        time.sleep(3)
        while self._running:
            try:
                with self.app.app_context():
                    self._sync()
                    now = time.time()
                    if now - self._last_scan >= SCAN_INTERVAL:
                        self._scan_segments()
                        self._last_scan = now
                    if now - self._last_retention >= RETENTION_INTERVAL:
                        self._enforce_retention()
                        self._last_retention = now
            except Exception:
                logger.exception("Supervisor error")
            time.sleep(POLL_INTERVAL)

    def _setup_allows_recording(self):
        """Recording FFmpeg processes only run after first-run setup in the Recordings UI."""
        try:
            from app.routes.api.recording_settings import get_setting

            return get_setting("setup_complete", "false") == "true"
        except Exception:
            return False

    def _desired(self):
        if not self._setup_allows_recording():
            return {}
        from app.models import Camera

        qs = Camera.select().where(
            (Camera.recording_enabled == True)
            & (Camera.active == True)
            & (Camera.recording_policy != "off")
        )
        cams = [c for c in qs if c.name.endswith("-main")]
        cams = [c for c in cams if _camera_should_record_segments(c)]
        return {c.name: c for c in cams}

    def _recordings_free_gb(self):
        """Free space on the filesystem that holds RECORDINGS_DIR (None if unknown)."""
        try:
            if not os.path.exists(self.recordings_dir):
                os.makedirs(self.recordings_dir, exist_ok=True)
            du = shutil.disk_usage(self.recordings_dir)
            return round(du.free / 1024**3, 3)
        except OSError:
            return None

    def _disk_pressure(self):
        """
        True when free disk is below min_free_gb (new recordings should not start).
        Existing FFmpeg processes are left running until they exit or desired set changes.
        """
        threshold = _min_free_gb_from_db()
        if threshold <= 0:
            return False
        free = self._recordings_free_gb()
        if free is None:
            return False
        return free < threshold

    def _sync(self):
        desired = self._desired()
        disk_pressure = self._disk_pressure()
        with self._lock:
            for n in list(self._procs):
                if n not in desired:
                    self._kill(n)

            launches = 0
            for name, cam in desired.items():
                p = self._procs.get(name)

                if p is None:
                    if disk_pressure:
                        logger.warning(
                            "Skipping record start for %s: disk pressure (free < %.2f GiB)",
                            name,
                            _min_free_gb_from_db(),
                        )
                        continue
                    if launches > 0:
                        time.sleep(STAGGER_DELAY)
                    self._launch(cam)
                    launches += 1
                    continue

                if p.get("shelved"):
                    if time.time() >= p.get("retry_at", 0):
                        logger.info("Retrying shelved: %s", name)
                        cr = p.get("crashes", 0)
                        del self._procs[name]
                        if launches > 0:
                            time.sleep(STAGGER_DELAY)
                        self._launch(cam)
                        if name in self._procs:
                            self._procs[name]["crashes"] = cr
                        launches += 1
                    continue

                if p.get("wait_until") and time.time() < p["wait_until"]:
                    continue

                proc = p["process"]
                if proc.poll() is None:
                    if p.get("crashes", 0) > 0 and time.time() - p["started_at"] > 60:
                        p["crashes"] = 0
                    # Segment length is stored in DB — restart FFmpeg when it changes
                    cur_seg = _segment_minutes_from_db()
                    if p.get("segment_minutes") != cur_seg:
                        logger.info(
                            "Segment length for %s changed %s -> %s min; restarting FFmpeg",
                            name,
                            p.get("segment_minutes"),
                            cur_seg,
                        )
                        self._kill(name)
                        if disk_pressure:
                            logger.warning(
                                "Not restarting %s after segment change: disk pressure",
                                name,
                            )
                            continue
                        if launches > 0:
                            time.sleep(STAGGER_DELAY)
                        self._launch(desired[name])
                        launches += 1
                    continue

                rt = time.time() - p["started_at"]
                prev_cr = p.get("crashes", 0)
                # A run that was healthy for at least HEALTHY_RUN_SECONDS is
                # proof FFmpeg / the upstream stream were fine. Treat this
                # crash as a fresh first-offence so the prior short-run
                # failures don't stack into a shelve. Run-times below that
                # keep accumulating, so a truly broken camera (e.g. bad URL,
                # dead stream) still trips the shelve circuit breaker quickly.
                if rt >= HEALTHY_RUN_SECONDS and prev_cr > 0:
                    logger.info(
                        "Resetting crash counter for %s after %ds healthy run (was %d)",
                        name, int(rt), prev_cr,
                    )
                    cr = 1
                else:
                    cr = prev_cr + 1
                p["crashes"] = cr

                err = ""
                thr = p.get("stderr_thread")
                joined = True
                if thr is not None:
                    thr.join(timeout=3.0)
                    joined = not thr.is_alive()
                try:
                    parts = []
                    buf = p.get("stderr_buf")
                    if buf:
                        parts.append("\n".join(buf))
                    if joined and proc.stderr is not None:
                        rest = proc.stderr.read()
                        if rest:
                            parts.append(rest.decode(errors="replace"))
                    combined = "\n".join(parts).strip()
                    if combined:
                        err = combined[-300:]
                except Exception:
                    pass
                p["last_error"] = err or "exit %s" % proc.returncode

                if cr <= 3:
                    logger.warning("FFmpeg exited: %s code=%s rt=%ds err=...%s", name, proc.returncode, rt, err[-120:])

                if cr >= MAX_CRASHES:
                    if cr == MAX_CRASHES:
                        logger.warning(
                            "Shelving %s (%d short-lived crashes, retry in %dm)",
                            name, cr, SHELVE_RETRY_MIN,
                        )
                    p["shelved"] = True
                    p["retry_at"] = time.time() + SHELVE_RETRY_MIN * 60
                    continue

                backoff = min(FFMPEG_RESTART_DELAY * (2 ** (cr - 1)), 60)
                p["wait_until"] = time.time() + backoff
                del self._procs[name]
                if launches > 0:
                    time.sleep(STAGGER_DELAY)
                self._launch(cam)
                if name in self._procs:
                    self._procs[name]["crashes"] = cr
                launches += 1

    def _launch(self, camera):
        from app.models import Camera

        try:
            cam = Camera.get_by_id(camera.id)
        except Exception:
            cam = camera
        if not _camera_should_record_segments(cam):
            logger.info(
                "Skipping segment FFmpeg for %s (policy=%s, events_only_segment_buffer=%s)",
                cam.name,
                _norm_recording_policy(cam),
                _events_only_record_segments_from_db(),
            )
            return

        cam_dir = os.path.join(self.recordings_dir, cam.name)
        os.makedirs(cam_dir, exist_ok=True)

        if GO2RTC_RTSP_URL:
            # Percent-encode the stream name: camera names like
            # "ABC NVR 1-ch1-main" contain spaces that would otherwise
            # produce a malformed RTSP URL.
            src = go2rtc_rtsp_source(GO2RTC_RTSP_URL, cam.name)
        else:
            src = cam.rtsp_url

        seg_min = _segment_minutes_from_db()
        seg = seg_min * 60
        pat = os.path.join(cam_dir, "%Y-%m-%d_%H-%M-%S.mp4")

        from app.ffmpeg_config import hwaccel_input_args, rtsp_input_queue_args

        # Frigate preset-rtsp-generic input + preset-record-generic output
        cmd = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel", "error",
            *hwaccel_input_args(),
            *rtsp_input_queue_args(),
            # input (Frigate preset-rtsp-generic)
            "-avoid_negative_ts", "make_zero",
            "-fflags", "+genpts+discardcorrupt",
            "-rtsp_transport", "tcp",
            "-timeout", "10000000",
            "-use_wallclock_as_timestamps", "1",
            "-i", src,
            # output (Frigate preset-record-generic)
            "-f", "segment",
            "-segment_time", str(seg),
            "-segment_format", "mp4",
            "-reset_timestamps", "1",
            "-strftime", "1",
            "-c:v", "copy",
            "-an",
            pat,
        ]

        try:
            proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        except FileNotFoundError:
            logger.error("ffmpeg not found")
            return
        except Exception:
            logger.exception("FFmpeg launch failed: %s", cam.name)
            return

        stderr_thread, stderr_buf = _start_ffmpeg_stderr_drain(proc, cam.name)
        self._procs[cam.name] = {
            "process": proc, "camera_id": cam.id, "source": src,
            "started_at": time.time(), "crashes": 0, "last_error": None,
            "shelved": False, "wait_until": None, "retry_at": None,
            "segment_minutes": seg_min,
            "stderr_thread": stderr_thread,
            "stderr_buf": stderr_buf,
        }
        logger.info("Recording: %s PID=%d src=%s", cam.name, proc.pid, src)

    def _kill(self, name):
        info = self._procs.pop(name, None)
        if not info:
            return
        proc = info["process"]
        if proc.poll() is not None:
            return
        try:
            proc.send_signal(signal.SIGINT)
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
            try:
                proc.wait(timeout=5)
            except Exception:
                pass
        except Exception:
            pass

    def _ensure_table(self):
        if self._table_ok:
            return True
        ok = recorder_segments.ensure_recording_table()
        if ok:
            logger.info("Recording table ready")
        self._table_ok = bool(ok)
        return self._table_ok

    def _scan_segments(self):
        if not os.path.exists(self.recordings_dir):
            return
        if not self._ensure_table():
            return

        writing = set()
        with self._lock:
            for n, p in self._procs.items():
                if not p.get("shelved") and p["process"].poll() is None:
                    writing.add(n)

        recorder_segments.scan_register_new_segments(
            self.recordings_dir,
            writing,
            segment_minutes=_segment_minutes_from_db(),
            probe_segment_durations=PROBE_SEGMENT_DURATIONS,
        )

    def _enforce_retention(self):
        recorder_retention.enforce_recording_retention(
            self.recordings_dir,
            retention_days=RETENTION_DAYS,
            max_storage_gb=MAX_STORAGE_GB,
            clip_retention_days=_clip_retention_days_from_db(),
            events_only_buffer_hours=_events_only_buffer_hours_from_db(),
        )

    @staticmethod
    def test_rtsp(url, timeout=10):
        res = {"url": url, "reachable": False, "error": None,
               "video_codec": None, "resolution": None, "fps": None,
               "video_bit_rate": None, "format_bit_rate": None}
        try:
            p = subprocess.run(
                ["ffprobe", "-v", "error", "-rtsp_transport", "tcp",
                 "-timeout", str(timeout * 1000000),
                 "-show_streams", "-show_format", "-of", "json", url],
                capture_output=True, text=True, timeout=timeout + 5,
            )
            if p.returncode != 0:
                res["error"] = (p.stderr or "").strip()[-300:]
                return res
            import json
            data = json.loads(p.stdout)
            res["reachable"] = True
            fmt = data.get("format") or {}
            br = fmt.get("bit_rate")
            if br is not None:
                try:
                    res["format_bit_rate"] = int(br)
                except (TypeError, ValueError):
                    res["format_bit_rate"] = br
            for s in data.get("streams", []):
                if s.get("codec_type") == "video":
                    res["video_codec"] = s.get("codec_name")
                    res["resolution"] = "%sx%s" % (s.get("width"), s.get("height"))
                    vbr = s.get("bit_rate")
                    if vbr is not None:
                        try:
                            res["video_bit_rate"] = int(vbr)
                        except (TypeError, ValueError):
                            res["video_bit_rate"] = vbr
                    try:
                        n, d = s["r_frame_rate"].split("/")
                        res["fps"] = round(int(n) / int(d), 1)
                    except Exception:
                        pass
        except subprocess.TimeoutExpired:
            res["error"] = "Timed out (%ds)" % timeout
        except Exception as e:
            res["error"] = str(e)
        return res

    def get_status(self):
        with self._lock:
            active = {}
            shelved_list = []
            for name, p in self._procs.items():
                if p.get("shelved"):
                    shelved_list.append({"name": name, "crashes": p.get("crashes", 0),
                                         "last_error": p.get("last_error")})
                    continue
                proc = p["process"]
                alive = proc.poll() is None
                active[name] = {
                    "pid": proc.pid, "running": alive,
                    "uptime_seconds": int(time.time() - p["started_at"]) if alive else 0,
                    "exit_code": proc.returncode if not alive else None,
                    "crashes": p.get("crashes", 0),
                    "last_error": p.get("last_error"),
                    "source": p.get("source", ""),
                }

        tb = recorder_retention.total_mp4_bytes_under(self.recordings_dir)
        disk = None
        free_gb = None
        if os.path.exists(self.recordings_dir):
            du = shutil.disk_usage(self.recordings_dir)
            free_gb = round(du.free / 1024**3, 3)
            disk = {"total_gb": round(du.total / 1024**3, 2),
                    "free_gb": free_gb,
                    "percent_used": round(du.used / du.total * 100, 1)}

        pressure = self._disk_pressure()

        return {
            "video_pipeline": get_video_pipeline_summary(),
            "engine_running": self._running,
            "active_recordings": sum(1 for v in active.values() if v["running"]),
            "total_processes": len(active),
            "shelved_count": len(shelved_list),
            "processes": active,
            "shelved": shelved_list,
            "setup_complete_gate": self._setup_allows_recording(),
            "disk_pressure": pressure,
            "storage": {"recordings_gb": round(tb / 1024**3, 2),
                        "max_storage_gb": MAX_STORAGE_GB or None, "disk": disk},
            "config": {"segment_minutes": _segment_minutes_from_db(),
                       "retention_days": RETENTION_DAYS,
                       "clip_retention_days": _clip_retention_days_from_db(),
                       "events_only_record_segments": _events_only_record_segments_from_db(),
                       "events_only_buffer_hours": _events_only_buffer_hours_from_db(),
                       "min_free_gb": _min_free_gb_from_db() or None,
                       "recordings_free_gb": free_gb,
                       "source": "go2rtc_relay" if GO2RTC_RTSP_URL else "direct_rtsp",
                       "stagger_seconds": STAGGER_DELAY,
                       "shelve_after": MAX_CRASHES, "shelve_retry_min": SHELVE_RETRY_MIN,
                       "healthy_run_seconds": HEALTHY_RUN_SECONDS},
        }


engine = None