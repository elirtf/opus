<p align="center">
  <img src="docs/logo.png" width="180" alt="Opus Logo"/>
</p>

<h1 align="center">Opus NVR</h1>

<p align="center">
  A lightweight, self-hosted **IP camera recorder and viewer**. For new installs, cameras send **RTSP directly to Opus** (live + continuous recording + timeline playback). A vendor NVR is <strong>optional</strong>—the UI still supports importing channels from an existing recorder for <strong>migration</strong> only.

  Deploy with <strong>Docker Compose</strong> on Linux (Ubuntu Server is the documented standard).
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

Sites (legacy NVR import), camera list, and **Configuration** (system info, **Settings** / go2rtc + recording options, diagnostics, per-site stream table with RTSP edit).
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
      # GO2RTC_CONFIG_PATH=/config/go2rtc.yaml (Default — Opus writes this from Configuration → Settings)
      # GO2RTC_RTSP_URL=rtsp://go2rtc:8554 (Default)
      # GO2RTC_ALLOW_ARBITRARY_EXEC=false (Optional — overrides UI “allow exec sources” when set)
      # SECRET_KEY=secret-key
      # Optional: comma-separated browser origins for split-host UIs (enables flask-cors)
      # CORS_ORIGINS=https://app.example.com,http://localhost:5173

# 3. Build and start
docker compose up --build
```

The app will be available at **http://localhost**.

You do **not** need Node.js or `npm` on your PC for this — the Docker build installs frontend dependencies and produces the UI inside the image. Run `npm install` / `npm run dev` in `frontend` only when you are **developing or testing the web UI yourself** (especially **mobile**: layout, PWA, live view on a phone). See [docs/DEV_WORKFLOW.md](docs/DEV_WORKFLOW.md) for that optional workflow.

### Remote access (v1.0)

**Off-site / phones:** [docs/remote-access-v1.md](docs/remote-access-v1.md) (tunnel + HTTPS). Extras: [docs/remote-viewing.md](docs/remote-viewing.md). Pre-release: [docs/MOBILE_QA_v1.md](docs/MOBILE_QA_v1.md) on cellular.

### Default Login

| Username | Password | Role |
|---|---|---|
| admin | admin | admin |

> **Change this immediately** after first login. Until you change it in the app, it stays **`admin` / `admin`** (your data is in `./instance`, not wiped by rebuilds). If you see the login page again after an update, your session simply expired — sign in with the same credentials.

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

Opus can record **continuously** (full timeline retention) or in **Events** mode (motion-triggered clips). For Events mode:

- Run the **`processor`** service from Docker Compose (`app.processing_service`). By default it samples the **sub** stream for motion when one exists (lower CPU); **clips** are still captured from **main** (`-c:v copy`). Set **`MOTION_RTSP_MODE=main`** on the processor to force full-res motion sampling. Clips live under `RECORDINGS_DIR/clips/`. Use the **Recordings → Events** tab (playback). **Live view** also prefers **sub** when configured — see [docs/mainstream-substream.md](docs/mainstream-substream.md).
- Choose the mode per camera under **Recordings → Settings → Camera Recording**: **Off**, **Continuous**, or **Events (motion)**. You can also set `recording_policy` to `events_only` or `continuous` via `PATCH /api/cameras/<id>`.
- **By default, Events mode does not run 24/7 segment recording** (no always-on FFmpeg writer for those cameras), so the **Playback** timeline stays empty for them — footage lives under **Events** as motion clips. Opus does **not** read camera/NVR “motion only” flags; it decides motion in software using the processor. If you want a **rolling segment buffer** on disk for pre-roll (like a traditional NVR), set **`EVENTS_ONLY_RECORD_SEGMENTS=1`** (or `true` / `yes` / `on`) on the **`recorder`** service — any other value leaves Events as **clip-only** (see [docker-compose.yml](docker-compose.yml) and [docs/hardware-sizing.md](docs/hardware-sizing.md)).
- Tune behavior with environment variables on the `processor` (and shared retention settings): see [docs/hardware-sizing.md](docs/hardware-sizing.md) for `PROCESSING_POLL_SECONDS`, `CLIP_SECONDS`, `MOTION_COOLDOWN_SECONDS`, `MOTION_RTSP_MODE`, `EVENTS_ONLY_BUFFER_HOURS`, `CLIP_RETENTION_DAYS`, and related notes.
- If you record through the **go2rtc RTSP relay** (`GO2RTC_RTSP_URL`), use the **same** URL on both the **`recorder`** and **`processor`** services so segments, motion sampling, and clips refer to the same paths (details in [docker-compose.yml](docker-compose.yml)).
- **Clip timing:** Under **Recordings → Settings**, configure **core** capture length, optional **post-roll** (extra seconds after the trigger), **pre-roll** (up to 15s from the latest completed segment file when segment files exist), poll interval, and cooldown. The same values can be set via environment variables on the **`processor`** service (`CLIP_SECONDS`, `CLIP_PRE_SECONDS`, `CLIP_POST_SECONDS`, etc.); DB settings override env when set in the UI. True “seconds before motion” without any buffer is not possible from live RTSP alone — pre-roll uses recorded segments when available.

---

## Documentation

| Doc | Topic |
|-----|--------|
| [docs/certified-cameras.md](docs/certified-cameras.md) | Minimal certified list + short regression checklist |
| [docs/hardware-sizing.md](docs/hardware-sizing.md) | Bitrate → storage, tiers, filesystems, retention env vars |
| [docs/streaming-playback.md](docs/streaming-playback.md) | HLS/DASH/WebRTC vs go2rtc + MP4, browser notes |
| [docs/deployment-profiles.md](docs/deployment-profiles.md) | Pi / NUC / workstation / hosted env defaults |
| [docs/hw-diagnostics-spec.md](docs/hw-diagnostics-spec.md) | Admin `GET /api/health/diagnostics` JSON schema |
| [docs/nvr-replacement-lab.md](docs/nvr-replacement-lab.md) | Lab tracks and migration validation |
| [docs/DEV_WORKFLOW.md](docs/DEV_WORKFLOW.md) | Local dev: Windows vs WSL/Linux, Compose vs split loop, Makefile |
| [docs/mainstream-substream.md](docs/mainstream-substream.md) | Main vs sub streams: recording, motion, live view |
| [docs/operations.md](docs/operations.md) | Webhook alerts, backup/restore, DR notes |
| [docs/remote-access-v1.md](docs/remote-access-v1.md) | Remote access v1.0: tunnel + HTTPS |
| [docs/remote-viewing.md](docs/remote-viewing.md) | Remote viewing + advanced (VPN, port forward) |
| [docs/MOBILE_QA_v1.md](docs/MOBILE_QA_v1.md) | Mobile QA before release |
| [mobile/README.md](mobile/README.md) | Optional **App Store / Play** wrapper (**post-1.0** for most teams) |

---

## Development

Step-by-step commands (PowerShell, env vars, Makefile on WSL): **[docs/DEV_WORKFLOW.md](docs/DEV_WORKFLOW.md)**.

**After `git pull`:** run `docker compose up --build -d` so Opus rebuilds from your repo (`docker compose pull` alone only updates pre-built images like nginx/go2rtc, not your app code). The `opus` container syncs the fresh React build into the `static_files` volume on every start so the UI updates without pruning volumes. Do not rely on `docker prune` for routine updates.

**Typical fast loop** (optional — for **developing the frontend**, including **mobile**; not required if you only use full Docker): run **go2rtc** with Docker (`docker compose up go2rtc`), run **Flask** (`python run.py`), and run the **Vite** dev server (`cd frontend && npm install && npm run dev`). Set `GO2RTC_URL=http://127.0.0.1:1984` for local Flask so it talks to the published go2rtc port. The frontend proxies `/api` to `localhost:5000` and `/go2rtc` to go2rtc on `localhost:1984` (see `frontend/vite.config.js`). Optional: copy `compose.override.yml.example` to `compose.override.yml` for local compose tweaks (file is gitignored).

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
