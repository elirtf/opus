# Opus NVR

A lightweight, self-hosted **camera streaming and management platform** designed for environments using IP cameras and/or NVRs.

Opus provides a clean web interface for viewing live feeds, managing cameras/NVRs, and controlling user access — all deployable with **Docker in minutes**.

Built with a focus on **simplicity, performance, and extensibility**, Opus aims to be a practical alternative to heavier NVR dashboards while remaining developer-friendly.

---

# Features

### Live Viewing
### Streaming
### Camera & NVR Management
### Authentication & Access Control

---

# Tech Stack

| Layer | Technology |
|------|-------------|
| Backend | [Flask](https://flask.palletsprojects.com/) |
| Authentication | Flask-Login |
| Database | Flask-SQLAlchemy (SQLite) |
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

## Contributing

1. Fork the repo and create a feature branch (`git checkout -b feature/my-thing`)
2. Make your changes, test with `docker compose up --build`
3. Open a pull request with a clear description of what changed and why

Please keep PRs focused — one feature or fix per PR makes review much easier.

---

## License

See LICENSE file.
