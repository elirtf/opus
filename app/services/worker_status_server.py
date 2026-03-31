"""Generic HTTP /status server for worker processes (recorder, processor)."""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer


def start_worker_status_server(
    engine,
    *,
    port: int,
    worker_name: str,
    default_payload: dict | None = None,
    host: str = "0.0.0.0",
) -> HTTPServer:
    """
    Spin up a tiny HTTP server on *port* that responds to ``GET /status``
    with the engine's ``get_status()`` dict (plus ``reported_by``).

    *default_payload* is returned when the engine ref is None or not yet
    initialised — each worker can supply its own shape so callers get a
    predictable JSON schema even during startup.
    """
    eng = engine
    fallback = default_payload or {"engine_running": False, "message": "Engine not initialized"}

    class _Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            path = self.path.split("?")[0].rstrip("/")
            if path != "/status":
                self.send_response(404)
                self.end_headers()
                return
            try:
                payload = eng.get_status() if eng else dict(fallback)
                payload = dict(payload)
                payload["reported_by"] = f"{worker_name}_process"
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
    thread = threading.Thread(
        target=httpd.serve_forever,
        daemon=True,
        name=f"{worker_name}-status-http",
    )
    thread.start()
    return httpd
