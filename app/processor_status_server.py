"""Tiny HTTP /status + Prometheus /metrics for the processor worker process."""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from app.ops_metrics import prometheus_response_body


def start_processor_status_server(engine, host: str = "0.0.0.0", port: int = 5056):
    eng = engine

    class _Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            path = self.path.split("?")[0].rstrip("/")
            if path == "/metrics":
                try:
                    body, ctype = prometheus_response_body()
                except Exception as exc:
                    body = ("# error %s\n" % exc).encode("utf-8")
                    ctype = "text/plain; charset=utf-8"
                self.send_response(200)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            if path != "/status":
                self.send_response(404)
                self.end_headers()
                return
            try:
                payload = eng.get_status() if eng else {
                    "engine_running": False,
                    "message": "Engine not initialized",
                }
                payload = dict(payload)
                payload["reported_by"] = "processor_process"
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
    thread = threading.Thread(target=httpd.serve_forever, daemon=True, name="processor-status-http")
    thread.start()
    return httpd
