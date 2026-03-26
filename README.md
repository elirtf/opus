<p align="center">
  <img src="docs/logo.png" width="180" alt="Opus Logo"/>
</p>

<h1 align="center">Opus NVR</h1>

<p align="center">
  A lightweight, self-hosted **IP camera recorder and viewer**. For new installs, cameras send **RTSP directly to Opus** (live + continuous recording + timeline playback). A vendor NVR is <strong>optional</strong>—the UI still supports importing channels from an existing recorder for <strong>migration</strong> only.

  Deploy with <strong>Docker Compose</strong> on Linux (Ubuntu Server is the documented standard). Scope and non-goals for v1: <a href="docs/PRODUCT_SCOPE_V1.md">docs/PRODUCT_SCOPE_V1.md</a>.
</p>

<p align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![Docker](https://img.shields.io/badge/docker-ready-blue)
![Python](https://img.shields.io/badge/python-3.11+-blue)
![Status](https://img.shields.io/badge/status-active-success)
![Repo Size](https://img.shields.io/github/repo-size/elirtf/opus)

</p>

---

# Features

### Live Viewing
### Streaming
### Devices & Configuration

Sites (legacy NVR import), camera list, and **Configuration** (system info, diagnostics, per-site stream table with RTSP edit).
### Authentication & Access Control

---

# Tech Stack

| Layer | Technology |
|------|-------------|
| Backend | [Flask](https://flask.palletsprojects.com/) |
| Authentication | Flask-Login |
| Database | SQLite via Peewee (migrations in `app/migrations/`) |
| Stream Server | [go2rtc](https://github.com/AlexxIT/go2rtc) |
| Reverse Proxy | nginx |
| Frontend | React + Tailwind CSS |
| Containerization | Docker + Docker Compose |

---

## Getting Started

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows/macOS) or Docker Engine + Compose (Linux)
- Git

### Setup

```bash
# 1. Clone the repo
git clone https://github.com/elirtf/opus.git
cd opus

# 2. Create your environment file
# Edit .env and set SECRET_KEY, and optionally GO2RTC_URL
      # GO2RTC_URL=http://go2rtc:1984 (Default)
      # GO2RTC_RTSP_URL=rtsp://go2rtc:8554 (Default)
      # SECRET_KEY=secret-key

# 3. Build and start
docker compose up --build
```

The app will be available at **http://localhost**.

### Default Login

| Username | Password | Role |
|---|---|---|
| admin | admin | admin |

> **Change this immediately** after first login.

---

## Stream Architecture

```
IP Camera (RTSP)
      │
      ├──────────────────────────────┐
      ▼                              ▼
 go2rtc (:1984)                 Recorder + FFmpeg
 (live / MSE in browser)         (MP4 segments on disk)
      │                              │
      └────────── nginx (:80) ───────┘
                      │
                 Opus API + React UI
```

**Recommended path:** one RTSP URL per camera (main for recording; optional substream for live tiles). **Migration path:** import channels from an existing NVR under Devices → Sites & migration.

### Motion and event-based recording

Opus can record **continuously** (full timeline retention) or in **Events** mode (motion-triggered clips plus a short rolling buffer of segments). For Events mode:

- Run the **`processor`** service from Docker Compose (`app.processing_service`). It samples each camera stream (prefer the optional **substream** URL on the camera for lower CPU), detects motion, and writes clips under `RECORDINGS_DIR/clips/`.
- Choose the mode per camera under **Recordings → Settings → Camera Recording**: **Off**, **Continuous**, or **Events (motion)**. You can also set `recording_policy` to `events_only` or `continuous` via `PATCH /api/cameras/<id>`.
- Tune behavior with environment variables on the `processor` (and shared retention settings): see [docs/hardware-sizing.md](docs/hardware-sizing.md) for `PROCESSING_POLL_SECONDS`, `CLIP_SECONDS`, `MOTION_COOLDOWN_SECONDS`, `EVENTS_ONLY_BUFFER_HOURS`, `CLIP_RETENTION_DAYS`, and related notes.
- If you record through the **go2rtc RTSP relay** (`GO2RTC_RTSP_URL`), use the **same** URL on both the **`recorder`** and **`processor`** services so segments, motion sampling, and clips refer to the same paths (details in [docker-compose.yml](docker-compose.yml)).

---

## Documentation

| Doc | Topic |
|-----|--------|
| [docs/PRODUCT_SCOPE_V1.md](docs/PRODUCT_SCOPE_V1.md) | v1 features, deployment assumptions, explicit non-goals |
| [docs/certified-cameras.md](docs/certified-cameras.md) | Minimal certified list + short regression checklist |
| [docs/hardware-sizing.md](docs/hardware-sizing.md) | Bitrate → storage, tiers, filesystems, retention env vars |
| [docs/streaming-playback.md](docs/streaming-playback.md) | HLS/DASH/WebRTC vs go2rtc + MP4, browser notes |
| [docs/deployment-profiles.md](docs/deployment-profiles.md) | Pi / NUC / workstation / hosted env defaults |
| [docs/hw-diagnostics-spec.md](docs/hw-diagnostics-spec.md) | Admin `GET /api/health/diagnostics` JSON schema |
| [docs/nvr-replacement-lab.md](docs/nvr-replacement-lab.md) | Lab tracks and migration validation |
| [docs/hosted-ops-outline.md](docs/hosted-ops-outline.md) | Rented-appliance ops outline |
| [docs/DEV_WORKFLOW.md](docs/DEV_WORKFLOW.md) | Local dev: Windows vs WSL/Linux, Compose vs split loop, Makefile |

---

## Development

Step-by-step commands (PowerShell, env vars, Makefile on WSL): **[docs/DEV_WORKFLOW.md](docs/DEV_WORKFLOW.md)**.

**Typical fast loop:** run **go2rtc** with Docker (`docker compose up go2rtc`), run **Flask** (`python run.py`), and run the **Vite** dev server (`cd frontend && npm install && npm run dev`). Set `GO2RTC_URL=http://127.0.0.1:1984` for local Flask so it talks to the published go2rtc port. The frontend proxies `/api` to `localhost:5000` and `/go2rtc` to go2rtc on `localhost:1984` (see `frontend/vite.config.js`). Optional: copy `compose.override.yml.example` to `compose.override.yml` for local compose tweaks (file is gitignored).

To run the backend alone:

```bash
# Create a virtual environment
python -m venv .venv
.venv\Scripts\activate       # Windows
source .venv/bin/activate    # macOS/Linux

# Install dependencies
pip install -r requirements.txt

# Set env vars
set SECRET_KEY=dev            # Windows
export SECRET_KEY=dev         # macOS/Linux

# Run
python run.py
```

> You'll still need go2rtc running separately (or skip it — the app works without it, streams just won't load).

**Quick smoke check:** log in, open dashboard live tile, run Discovery (subnet scan uses background job + polling), open Recordings and confirm engine status loads when the recorder service and `RECORDER_INTERNAL_STATUS_URL` are set.

---

## Contributing

1. Fork the repo and create a feature branch (`git checkout -b feature/my-thing`)
2. Make your changes, test with `docker compose up --build`
3. Open a pull request with a clear description of what changed and why

Please keep PRs focused — one feature or fix per PR makes review much easier.

---

## License

See LICENSE file.
