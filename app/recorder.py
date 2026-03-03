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

logger = logging.getLogger("opus.recorder")

RECORDINGS_DIR       = os.environ.get("RECORDINGS_DIR", "/recordings")
SEGMENT_MINUTES      = int(os.environ.get("RECORDING_SEGMENT_MINUTES", "15"))
RETENTION_DAYS       = int(os.environ.get("RECORDING_RETENTION_DAYS", "90"))
MAX_STORAGE_GB       = float(os.environ.get("RECORDING_MAX_STORAGE_GB", "0"))
POLL_INTERVAL        = int(os.environ.get("RECORDING_POLL_SECONDS", "10"))
SCAN_INTERVAL        = int(os.environ.get("RECORDING_SCAN_SECONDS", "30"))
RETENTION_INTERVAL   = int(os.environ.get("RECORDING_RETENTION_SECONDS", "300"))
FFMPEG_RESTART_DELAY = int(os.environ.get("FFMPEG_RESTART_DELAY_SECONDS", "5"))
GO2RTC_RTSP_URL      = os.environ.get("GO2RTC_RTSP_URL", "")
RECORDING_MODE       = os.environ.get("RECORDING_MODE", "all")
MAX_CRASHES          = int(os.environ.get("RECORDING_MAX_CRASHES", "3"))
SHELVE_RETRY_MIN     = int(os.environ.get("RECORDING_SHELVE_RETRY_MINUTES", "10"))
STAGGER_DELAY        = float(os.environ.get("RECORDING_STAGGER_SECONDS", "2"))


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
        self._stream_map = {}      # lowercase -> actual go2rtc name
        self._stream_map_time = 0  # when we last fetched it

    def start(self):
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True, name="recorder")
        self._thread.start()
        logger.info(
            "Recording engine started (mode=%s, seg=%smin, relay=%s, stagger=%ss)",
            RECORDING_MODE, SEGMENT_MINUTES, "yes" if GO2RTC_RTSP_URL else "no", STAGGER_DELAY,
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

    def _desired(self):
        from app.models import Camera
        if RECORDING_MODE == "selective":
            qs = Camera.select().where((Camera.recording_enabled == True) & (Camera.active == True))
        else:
            qs = Camera.select().where(Camera.active == True)
        return {c.name: c for c in qs if not c.name.endswith("-sub")}

    def _sync(self):
        desired = self._desired()
        with self._lock:
            for n in list(self._procs):
                if n not in desired:
                    self._kill(n)

            launches = 0
            for name, cam in desired.items():
                p = self._procs.get(name)

                if p is None:
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

    def _resolve_stream(self, camera_name):
        """Map camera name to actual go2rtc stream name (handles case difference)."""
        now = time.time()
        if not self._stream_map or now - self._stream_map_time > 120:
            try:
                import json
                import urllib.request
                go2rtc_http = self.app.config.get("GO2RTC_URL", "http://go2rtc:1984")
                data = urllib.request.urlopen(
                    "%s/api/streams" % go2rtc_http, timeout=5
                ).read()
                streams = json.loads(data)
                self._stream_map = {k.lower(): k for k in streams}
                self._stream_map_time = now
                logger.info("go2rtc streams: %d found", len(self._stream_map))
            except Exception as e:
                logger.warning("go2rtc API query failed: %s", e)
                return camera_name
        return self._stream_map.get(camera_name.lower(), camera_name)

    def _launch(self, camera):
        cam_dir = os.path.join(self.recordings_dir, camera.name)
        os.makedirs(cam_dir, exist_ok=True)

        if GO2RTC_RTSP_URL:
            stream_name = self._resolve_stream(camera.name)
            src = "%s/%s" % (GO2RTC_RTSP_URL, stream_name)
        else:
            src = camera.rtsp_url

        seg = SEGMENT_MINUTES * 60
        pat = os.path.join(cam_dir, "%Y-%m-%d_%H-%M-%S.mp4")

        # Frigate preset-rtsp-generic input + preset-record-generic output
        cmd = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel", "error",
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
            logger.exception("FFmpeg launch failed: %s", camera.name)
            return

        self._procs[camera.name] = {
            "process": proc, "camera_id": camera.id, "source": src,
            "started_at": time.time(), "crashes": 0, "last_error": None,
            "shelved": False, "wait_until": None, "retry_at": None,
        }
        logger.info("Recording: %s PID=%d src=%s", camera.name, proc.pid, src)

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

    def test_rtsp(self, url, timeout=10):
        res = {"url": url, "reachable": False, "error": None,
               "video_codec": None, "resolution": None, "fps": None}
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
            for s in data.get("streams", []):
                if s.get("codec_type") == "video":
                    res["video_codec"] = s.get("codec_name")
                    res["resolution"] = "%sx%s" % (s.get("width"), s.get("height"))
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
        if os.path.exists(self.recordings_dir):
            du = shutil.disk_usage(self.recordings_dir)
            disk = {"total_gb": round(du.total / 1024**3, 2),
                    "free_gb": round(du.free / 1024**3, 2),
                    "percent_used": round(du.used / du.total * 100, 1)}

        return {
            "engine_running": self._running,
            "recording_mode": RECORDING_MODE,
            "active_recordings": sum(1 for v in active.values() if v["running"]),
            "total_processes": len(active),
            "shelved_count": len(shelved_list),
            "processes": active,
            "shelved": shelved_list,
            "storage": {"recordings_gb": round(tb / 1024**3, 2),
                        "max_storage_gb": MAX_STORAGE_GB or None, "disk": disk},
            "config": {"mode": RECORDING_MODE, "segment_minutes": SEGMENT_MINUTES,
                       "retention_days": RETENTION_DAYS,
                       "source": "go2rtc_relay" if GO2RTC_RTSP_URL else "direct_rtsp",
                       "stagger_seconds": STAGGER_DELAY,
                       "shelve_after": MAX_CRASHES, "shelve_retry_min": SHELVE_RETRY_MIN},
        }


engine = None