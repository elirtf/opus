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
import shutil
import logging
from datetime import datetime, timedelta

from app.ffmpeg_config import get_video_pipeline_summary

logger = logging.getLogger("opus.recorder")

RECORDINGS_DIR       = os.environ.get("RECORDINGS_DIR", "/recordings")
SEGMENT_MINUTES      = int(os.environ.get("RECORDING_SEGMENT_MINUTES", "15"))
RETENTION_DAYS       = int(os.environ.get("RECORDING_RETENTION_DAYS", "90"))
CLIP_RETENTION_DAYS  = int(os.environ.get("CLIP_RETENTION_DAYS", "90"))
MAX_STORAGE_GB       = float(os.environ.get("RECORDING_MAX_STORAGE_GB", "0"))
POLL_INTERVAL        = int(os.environ.get("RECORDING_POLL_SECONDS", "10"))
SCAN_INTERVAL        = int(os.environ.get("RECORDING_SCAN_SECONDS", "30"))
RETENTION_INTERVAL   = int(os.environ.get("RECORDING_RETENTION_SECONDS", "300"))
FFMPEG_RESTART_DELAY = int(os.environ.get("FFMPEG_RESTART_DELAY_SECONDS", "5"))
GO2RTC_RTSP_URL      = os.environ.get("GO2RTC_RTSP_URL", "")
MAX_CRASHES          = int(os.environ.get("RECORDING_MAX_CRASHES", "3"))
SHELVE_RETRY_MIN     = int(os.environ.get("RECORDING_SHELVE_RETRY_MINUTES", "10"))
STAGGER_DELAY        = float(os.environ.get("RECORDING_STAGGER_SECONDS", "2"))
# Rolling segment buffer for events_only cameras (hours); older segments are purged first.
EVENTS_ONLY_BUFFER_HOURS = int(os.environ.get("EVENTS_ONLY_BUFFER_HOURS", "48"))


def _env_opt_in(name: str, default: bool = False) -> bool:
    """
    True only when env is explicitly 1/true/yes/on.
    Avoids accidental enable from typos or unknown values (older code used opt-out logic where
    almost any string turned segment recording on for events_only cameras).
    """
    raw = os.environ.get(name)
    if raw is None:
        return default
    s = str(raw).strip().lower()
    if s == "":
        return default
    return s in ("1", "true", "yes", "on")


# When True, events_only cameras get 24/7 FFmpeg segment recording (rolling buffer up to EVENTS_ONLY_BUFFER_HOURS).
# When False (default), events_only does not run segment recording — only motion clips from the processor.
EVENTS_ONLY_RECORD_SEGMENTS = _env_opt_in("EVENTS_ONLY_RECORD_SEGMENTS", False)


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
        return EVENTS_ONLY_RECORD_SEGMENTS
    return True


# Do not start new FFmpeg writers when free space on the recordings volume drops below this (0 = disabled).
MIN_FREE_GB = float(os.environ.get("RECORDING_MIN_FREE_GB", "1") or "0")


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
            SEGMENT_MINUTES,
            "yes" if GO2RTC_RTSP_URL else "no",
            STAGGER_DELAY,
            "on" if EVENTS_ONLY_RECORD_SEGMENTS else "off",
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
        True when free disk is below MIN_FREE_GB (new recordings should not start).
        Existing FFmpeg processes are left running until they exit or desired set changes.
        """
        if MIN_FREE_GB <= 0:
            return False
        free = self._recordings_free_gb()
        if free is None:
            return False
        return free < MIN_FREE_GB

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
                            MIN_FREE_GB,
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
                    continue

                rt = time.time() - p["started_at"]
                cr = p.get("crashes", 0) + 1
                p["crashes"] = cr

                err = ""
                try:
                    err = proc.stderr.read().decode(errors="replace")[-300:]
                except Exception:
                    pass
                p["last_error"] = err or "exit %s" % proc.returncode

                if cr <= 3:
                    logger.warning("FFmpeg exited: %s code=%s rt=%ds err=...%s", name, proc.returncode, rt, err[-120:])

                if cr >= MAX_CRASHES:
                    if cr == MAX_CRASHES:
                        logger.warning("Shelving %s (%d crashes)", name, cr)
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
                EVENTS_ONLY_RECORD_SEGMENTS,
            )
            return

        cam_dir = os.path.join(self.recordings_dir, cam.name)
        os.makedirs(cam_dir, exist_ok=True)

        if GO2RTC_RTSP_URL:
            src = "%s/%s" % (GO2RTC_RTSP_URL, cam.name)
        else:
            src = cam.rtsp_url

        seg = SEGMENT_MINUTES * 60
        pat = os.path.join(cam_dir, "%Y-%m-%d_%H-%M-%S.mp4")

        from app.ffmpeg_config import hwaccel_input_args

        # Frigate preset-rtsp-generic input + preset-record-generic output
        cmd = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel", "error",
            *hwaccel_input_args(),
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

        self._procs[cam.name] = {
            "process": proc, "camera_id": cam.id, "source": src,
            "started_at": time.time(), "crashes": 0, "last_error": None,
            "shelved": False, "wait_until": None, "retry_at": None,
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
        from app.database import db
        try:
            db.execute_sql(
                "CREATE TABLE IF NOT EXISTS recording ("
                "  id INTEGER PRIMARY KEY AUTOINCREMENT,"
                "  camera INTEGER,"
                "  camera_name VARCHAR(50) NOT NULL,"
                "  filename VARCHAR(100) NOT NULL,"
                "  file_path VARCHAR(255) NOT NULL,"
                "  file_size INTEGER DEFAULT 0,"
                "  started_at DATETIME,"
                "  ended_at DATETIME,"
                "  duration_seconds INTEGER,"
                "  status VARCHAR(20) DEFAULT 'complete'"
                ")"
            )
            db.execute_sql(
                "CREATE INDEX IF NOT EXISTS idx_rec_cam_start "
                "ON recording (camera_name, started_at)"
            )
            self._table_ok = True
            logger.info("Recording table ready")
            return True
        except Exception:
            logger.exception("Table creation failed")
            return False

    def _scan_segments(self):
        from app.database import db
        from app.models import Camera

        if not os.path.exists(self.recordings_dir):
            return
        if not self._ensure_table():
            return

        writing = set()
        with self._lock:
            for n, p in self._procs.items():
                if not p.get("shelved") and p["process"].poll() is None:
                    writing.add(n)

        known = set()
        try:
            cur = db.execute_sql("SELECT camera_name, filename FROM recording")
            for r in cur.fetchall():
                known.add((r[0], r[1]))
        except Exception:
            logger.exception("Cannot query recordings")
            return

        added = 0
        try:
            dirs = sorted(os.listdir(self.recordings_dir))
        except OSError:
            return

        for cam_name in dirs:
            cam_dir = os.path.join(self.recordings_dir, cam_name)
            if not os.path.isdir(cam_dir):
                continue
            try:
                files = sorted(f for f in os.listdir(cam_dir) if f.endswith(".mp4"))
            except OSError:
                continue
            if not files:
                continue

            newest = files[-1] if cam_name in writing else None
            cam_obj = Camera.get_or_none(Camera.name == cam_name)
            cam_id = cam_obj.id if cam_obj else None

            for fn in files:
                if (cam_name, fn) in known or fn == newest:
                    continue
                fp = os.path.join(cam_dir, fn)
                try:
                    sz = os.path.getsize(fp)
                except OSError:
                    continue
                if sz < 10240:
                    continue
                sa = self._parse_ts(fn)
                if sa is None:
                    continue
                dur = self._probe_dur(fp)
                ea = (sa + timedelta(seconds=int(dur))) if sa and dur else None
                try:
                    db.execute_sql(
                        "INSERT INTO recording"
                        " (camera,camera_name,filename,file_path,file_size,"
                        "  started_at,ended_at,duration_seconds,status)"
                        " VALUES (?,?,?,?,?,?,?,?,?)",
                        (cam_id, cam_name, fn, fp, sz,
                         sa.isoformat() if sa else None,
                         ea.isoformat() if ea else None,
                         int(dur) if dur else None, "complete"),
                    )
                    added += 1
                except Exception as exc:
                    logger.debug("Insert skip %s: %s", fn, exc)

        if added:
            logger.info("Scan: registered %d new segments", added)

    @staticmethod
    def _parse_ts(fn):
        try:
            return datetime.strptime(fn.replace(".mp4", ""), "%Y-%m-%d_%H-%M-%S")
        except ValueError:
            return None

    @staticmethod
    def _probe_dur(fp):
        try:
            r = subprocess.run(
                ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
                 "-of", "default=noprint_wrappers=1:nokey=1", fp],
                capture_output=True, text=True, timeout=10,
            )
            if r.returncode == 0 and r.stdout.strip():
                return float(r.stdout.strip())
        except Exception:
            pass
        return None

    def _enforce_retention(self):
        from app.database import db
        deleted = 0

        if RETENTION_DAYS > 0:
            cutoff = (datetime.now() - timedelta(days=RETENTION_DAYS)).isoformat()
            try:
                rows = db.execute_sql(
                    "SELECT id, file_path FROM recording WHERE started_at < ?", (cutoff,)
                ).fetchall()
                for rid, fp in rows:
                    try:
                        if os.path.exists(fp):
                            os.remove(fp)
                        db.execute_sql("DELETE FROM recording WHERE id=?", (rid,))
                        deleted += 1
                    except Exception:
                        pass
            except Exception:
                logger.exception("Age retention failed")

        if MAX_STORAGE_GB > 0:
            cap = MAX_STORAGE_GB * 1024 ** 3
            total = self._disk_usage()
            if total > cap:
                try:
                    rows = db.execute_sql(
                        "SELECT id,file_path,file_size FROM recording ORDER BY started_at ASC"
                    ).fetchall()
                    freed = 0
                    for rid, fp, sz in rows:
                        if freed >= total - cap:
                            break
                        try:
                            if os.path.exists(fp):
                                os.remove(fp)
                            db.execute_sql("DELETE FROM recording WHERE id=?", (rid,))
                            freed += sz or 0
                            deleted += 1
                        except Exception:
                            pass
                except Exception:
                    pass

        try:
            rows = db.execute_sql("SELECT id,file_path FROM recording").fetchall()
            orphans = [r[0] for r in rows if not os.path.exists(r[1])]
            if orphans:
                ph = ",".join("?" * len(orphans))
                db.execute_sql("DELETE FROM recording WHERE id IN (%s)" % ph, orphans)
                logger.info("Cleaned %d orphan records", len(orphans))
        except Exception:
            pass

        try:
            for d in os.listdir(self.recordings_dir):
                p = os.path.join(self.recordings_dir, d)
                if os.path.isdir(p) and not os.listdir(p):
                    os.rmdir(p)
        except OSError:
            pass

        if deleted:
            logger.info("Retention: deleted %d segments", deleted)

        if CLIP_RETENTION_DAYS > 0:
            self._purge_old_clips()

        # Short buffer for events_only: keep recent segments for pre-roll context only.
        if EVENTS_ONLY_BUFFER_HOURS > 0:
            self._purge_events_only_buffer()

    def _purge_old_clips(self):
        """Delete motion/AI clip rows and files past CLIP_RETENTION_DAYS."""
        from app.database import db

        cutoff = (datetime.now() - timedelta(days=CLIP_RETENTION_DAYS)).isoformat()
        removed = 0
        try:
            rows = db.execute_sql(
                "SELECT id, file_path FROM recording_event WHERE started_at < ?",
                (cutoff,),
            ).fetchall()
            for rid, fp in rows:
                try:
                    if fp and os.path.exists(fp):
                        os.remove(fp)
                    db.execute_sql("DELETE FROM recording_event WHERE id=?", (rid,))
                    removed += 1
                except Exception:
                    pass
        except Exception:
            logger.exception("Clip retention failed")
        if removed:
            logger.info("Clip retention: deleted %d event clips", removed)

    def _purge_events_only_buffer(self):
        from app.database import db
        from app.models import Camera

        try:
            names = [
                c.name
                for c in Camera.select(Camera.name).where(
                    (Camera.recording_policy == "events_only")
                    & (Camera.active == True)
                    & (Camera.recording_enabled == True)
                )
            ]
        except Exception:
            logger.exception("events_only buffer: camera query failed")
            return
        if not names:
            return
        cutoff = (datetime.now() - timedelta(hours=EVENTS_ONLY_BUFFER_HOURS)).isoformat()
        deleted = 0
        try:
            for cam_name in names:
                rows = db.execute_sql(
                    "SELECT id, file_path FROM recording WHERE camera_name = ? AND started_at < ?",
                    (cam_name, cutoff),
                ).fetchall()
                for rid, fp in rows:
                    try:
                        if fp and os.path.exists(fp):
                            os.remove(fp)
                        db.execute_sql("DELETE FROM recording WHERE id=?", (rid,))
                        deleted += 1
                    except Exception:
                        pass
        except Exception:
            logger.exception("events_only buffer purge failed")
        if deleted:
            logger.info("events_only buffer: removed %d old segments", deleted)

    def _disk_usage(self):
        total = 0
        try:
            for d in os.listdir(self.recordings_dir):
                dp = os.path.join(self.recordings_dir, d)
                if not os.path.isdir(dp):
                    continue
                for f in os.listdir(dp):
                    if f.endswith(".mp4"):
                        try:
                            total += os.path.getsize(os.path.join(dp, f))
                        except OSError:
                            pass
        except OSError:
            pass
        return total

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

        tb = self._disk_usage()
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
            "config": {"segment_minutes": SEGMENT_MINUTES,
                       "retention_days": RETENTION_DAYS,
                       "clip_retention_days": CLIP_RETENTION_DAYS,
                       "events_only_record_segments": EVENTS_ONLY_RECORD_SEGMENTS,
                       "events_only_buffer_hours": EVENTS_ONLY_BUFFER_HOURS,
                       "min_free_gb": MIN_FREE_GB if MIN_FREE_GB > 0 else None,
                       "recordings_free_gb": free_gb,
                       "source": "go2rtc_relay" if GO2RTC_RTSP_URL else "direct_rtsp",
                       "stagger_seconds": STAGGER_DELAY,
                       "shelve_after": MAX_CRASHES, "shelve_retry_min": SHELVE_RETRY_MIN},
        }


engine = None