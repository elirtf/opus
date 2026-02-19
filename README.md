# Opus NVR

A lightweight, self-hosted camera management and live streaming web application built with Flask and [go2rtc](https://github.com/AlexxIT/go2rtc). 
Designed to manage Hikvision-compatible NVRs, view live camera feeds in a configurable grid, and control user access via role-based authentication.

---

## Features

- **Live View** — Configurable 1×1 / 2×2 / 3×3 / 4×4 camera grid with pagination
- **Smart Stream Quality** — Automatically uses main streams (1×1, 2×2) and switches to sub streams (3×3, 4×4) to reduce bandwidth
- **Lazy Loading** — Only the cameras currently visible on screen are streamed; go2rtc drops idle RTSP connections automatically
- **NVR Management** — Add, edit, and delete NVRs with auto-import of all camera channels on add
- **Camera Management** — Full CRUD for individual cameras; each synced to go2rtc as a named stream
- **User Auth** — Login/logout with admin and viewer roles. Admins can add/edit/delete; viewers can only watch
- **Fullscreen Mode** — Click any camera tile to open it fullscreen in main stream quality

---

## Tech Stack

| Layer | Technology |
|---|---|
| Web framework | [Flask](https://flask.palletsprojects.com/)
| Auth & sessions | Flask-Login |
| Password hashing | Werkzeug |
| Database ORM | Flask-SQLAlchemy (SQLite) |
| Stream server | [go2rtc](https://github.com/AlexxIT/go2rtc) |
| Reverse proxy | nginx (alpine) |
| Frontend | Tailwind CSS (CDN), vanilla JS |
| Container | Docker + Docker Compose |

---

## Project Structure

```
opus/
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
├── run.py                      # Entrypoint — starts Flask on port 5000
│
├── app/
│   ├── __init__.py             # App factory, DB init, seeds default admin
│   ├── models.py               # SQLAlchemy models: User, NVR, Camera
│   │
│   └── routes/
│       ├── auth.py             # /login, /logout
│       ├── main.py             # / — live view dashboard
│       ├── nvrs.py             # /nvrs — NVR CRUD + camera auto-import + sync
│       └── cameras.py          # /cameras — Camera CRUD + go2rtc stream sync
│
├── app/templates/
│   ├── base.html               # Nav, flash messages, Tailwind dark theme
│   ├── login.html
│   ├── dashboard.html          # Live view grid with JS-driven stream management
│   ├── nvrs.html               # NVR list with add/edit modals
│   ├── cameras.html            # Camera list with add/edit modals
│   ├── _nvr_form_fields.html   # Shared partial for NVR forms
│   └── _camera_form_fields.html # Shared partial for camera forms
│
├── nginx/
│   └── nginx.conf              # Proxies Flask (:5000) and go2rtc (:1984)
│
├── go2rtc/                     # Created at runtime — holds go2rtc.yaml config
└── instance/                   # Created at runtime — holds opus.db (SQLite)
```

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
cp .env.example .env
# Edit .env and set SECRET_KEY, and optionally GO2RTC_URL

# 3. Build and start
docker compose up --build
```

The app will be available at **http://localhost**.

### Default Login

| Username | Password | Role |
|---|---|---|
| admin | admin | admin |

> **Change this immediately** after first login via the Users page (coming soon) or directly in the database.

---

## Environment Variables

Create a `.env` file in the project root:

```env
SECRET_KEY=change-me-to-something-long-and-random
GO2RTC_URL=http://go2rtc:1984
```

| Variable | Description | Default |
|---|---|---|
| `SECRET_KEY` | Flask session signing key — keep this secret | `change-me-in-production` |
| `GO2RTC_URL` | Internal URL for go2rtc API | `http://go2rtc:1984` |

---

## Adding an NVR

1. Go to **NVRs → Add NVR**
2. Fill in the NVR's IP address, username, and password
3. Set **Max Channels** to the number of camera channels your NVR has (e.g. 16, 32)
4. Click **Add** — Opus will automatically generate main and sub stream entries for every channel

Cameras are named using the Hikvision RTSP URL pattern:
```
Main: rtsp://user:pass@<ip>:554/Streaming/Channels/<channel * 100 + 1>
Sub:  rtsp://user:pass@<ip>:554/Streaming/Channels/<channel * 100 + 2>
```

So channel 1 = `/Channels/101` (main) and `/Channels/102` (sub), channel 2 = `/201` and `/202`, etc.

Use the **↻ Sync Cameras** button on any NVR to add missing channels (e.g. after increasing Max Channels). It skips cameras that already exist.

---

## Stream Architecture

```
IP Camera (RTSP)
      │
      ▼
  go2rtc (:1984)        ← Manages all RTSP connections, transcodes to MSE
      │
      ▼
  nginx (:80)           ← /go2rtc/* proxied to go2rtc, / proxied to Flask
      │
      ▼
  Browser               ← Receives MSE stream inside an iframe per camera tile
```

**Key behaviour:**
- Iframes are created dynamically in JS — only cameras visible on screen connect to go2rtc
- When you navigate away or change grid layout, iframe `src` is cleared, causing go2rtc to drop the RTSP session
- Stream quality switches automatically: 1×1 and 2×2 use **main streams**, 3×3 and 4×4 use **sub streams**

---

## User Roles

| Action | Viewer | Admin |
|---|---|---|
| Watch live view | ✅ | ✅ |
| Add / edit / delete NVRs | ❌ | ✅ |
| Add / edit / delete cameras | ❌ | ✅ |
| Sync cameras from NVR | ❌ | ✅ |

---

## Development

To run outside Docker for faster local iteration:

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

### Making Changes

- **New routes** → add a file in `app/routes/`, register the blueprint in `app/__init__.py`
- **DB model changes** → edit `app/models.py`. For schema changes in an existing install, delete `instance/opus.db` to recreate it (loses data) or write a migration
- **Frontend** → templates are in `app/templates/`. Tailwind CDN is used — avoid dynamic class names in JS (use inline styles instead)
- **go2rtc config** → edit `go2rtc/go2rtc.yaml`. The go2rtc web UI is available at **http://localhost/go2rtc**

---

## Roadmap / Known Issues

- [ ] User management UI (add/edit/delete users, change passwords)
- [ ] Recording support via go2rtc `record:` output
- [ ] Playback browser for recorded footage
- [ ] Camera health/status indicators (online/offline)
- [ ] Motion detection alerts
- [ ] Buffering on some streams depending on NVR and network conditions

---

## Contributing

1. Fork the repo and create a feature branch (`git checkout -b feature/my-thing`)
2. Make your changes, test with `docker compose up --build`
3. Open a pull request with a clear description of what changed and why

Please keep PRs focused — one feature or fix per PR makes review much easier.

---

## License

MIT
