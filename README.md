# Opus NVR

A lightweight, self-hosted camera streaming and management platform designed for environments with IP cameras and NVRs. 
It provides a clean web interface for viewing live feeds, managing cameras/NVRs, and controlling user access - all deployable with Docker in minutes.

Built with a focus on simplicity, performance, and extensibility, Opus aims to be a practical alternative to heavier NVR dashboards while remaining developer-friendly.

---

## Features

- **Live View** — Dynamic multi-camera grid (1×1 → 4×4 layouts with pagination)
- **Lazy Loading** — Only the cameras currently visible on screen are streamed; go2rtc drops idle RTSP connections automatically
- **Fullscreen Mode** — Click any camera tile to open it fullscreen in main stream quality
- **NVR Management** — Add, edit, and delete NVRs with auto-import of all camera channels on add
- **Camera Management** — Full CRUD for individual cameras; each synced to go2rtc as a named stream
- **User Auth** — Login/logout with admin and viewer roles. Admins can add/edit/delete; viewers can only watch

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | [Flask](https://flask.palletsprojects.com/)
| Authentication | Flask-Login |
| Database ORM | Flask-SQLAlchemy (SQLite) |
| Stream server | [go2rtc](https://github.com/AlexxIT/go2rtc) |
| Reverse proxy | nginx |
| Frontend | Tailwind CSS + JS |
| Containerization | Docker + Docker Compose |

---

## Project Structure

```
opus/
├── app/            # Flask backend
├── frontend/       # React / frontend assets (in progress)
├── nginx/          # Reverse proxy config
├── Dockerfile
├── docker-compose.yml
├── run.py
└── requirements.txt
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

> **Change this immediately** after first login.

---

## Environment Variables

Create a `.env` file in the project root:

```env
SECRET_KEY=change-me
GO2RTC_URL=http://go2rtc:1984
```

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
  Opus UI               ← React
      │
      ▼
  Browser               ← Receives MSE stream inside an iframe per camera tile
```

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

---

## Roadmap / Known Issues

- [ ] Recording + playback support
- [ ] Playback browser for recorded footage
- [ ] Alerting / motion detection alerts
- [ ] Buffering on some streams depending on NVR and network conditions

---

## Contributing

1. Fork the repo and create a feature branch (`git checkout -b feature/my-thing`)
2. Make your changes, test with `docker compose up --build`
3. Open a pull request with a clear description of what changed and why

Please keep PRs focused — one feature or fix per PR makes review much easier.

---

## License

See LICENSE file.
