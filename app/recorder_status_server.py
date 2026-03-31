"""Tiny HTTP JSON /status for the recorder process."""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer


def start_recorder_status_server(engine, host: str = "0.0.0.0", port: int = 5055):
    eng = engine

    class _Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            path = self.path.split("?")[0].rstrip("/")
            if path != "/status":
                self.send_response(404)
                self.end_headers()
                return
            try:
                payload = eng.get_status() if eng else {
                    "engine_running": False,
                    "active_recordings": 0,
                    "total_processes": 0,
                    "processes": {},
                    "message": "Engine not initialized",
                }
                payload = dict(payload)
                payload["reported_by"] = "recorder_process"
                body = json.dumps(payload).encode("utf-8")
            except Exception as exc:
                body = json.dumps({"engine_running": False, "error": str(exc)}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    httpd = HTTPServer((host, port), _Handler, bind_and_activate=True)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True, name="recorder-status-http")
    thread.start()
    return httpd
