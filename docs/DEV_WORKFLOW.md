# Local Development Workflows

Short reference for working on Opus on **Windows** (PowerShell) or **WSL/Linux**. Use whichever path matches how you like to run things.

## Pick a Workflow

### A — Full Docker Compose (one command)

**Prerequisites:** Docker Desktop (Windows/macOS) or Docker Engine + Compose (Linux), a `.env` in the repo root with at least `SECRET_KEY`.

```bash
docker compose up --build
```

Open **http://localhost** (nginx on port 80). Default login: `admin` / `admin` (change after first login).

**Stop:**

```bash
docker compose down
```

### B — Split “fast loop” (UI / API work)

Run **go2rtc** in Docker, **Flask** and **Vite** on the host. The frontend proxies `/api` to Flask and `/go2rtc` to go2rtc’s API (see `frontend/vite.config.js`).

**1. Start go2rtc**

```bash
docker compose up go2rtc
```

Leave this terminal running (or add `-d` for detached).

**2. Backend**

Create a venv once, install deps, set `SECRET_KEY`, run Flask.

**Windows (PowerShell):**

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:SECRET_KEY = "dev"
$env:GO2RTC_URL = "http://127.0.0.1:1984"
python run.py
```

**WSL / Linux / macOS:**

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export SECRET_KEY=dev
export GO2RTC_URL=http://127.0.0.1:1984
python run.py
```

`GO2RTC_URL` points at the go2rtc container published on the host (Compose exposes go2rtc’s ports by default for the `go2rtc` image).

**3. Frontend**

```bash
cd frontend
npm install
npm run dev
```

Open the URL Vite prints (usually **http://localhost:5173**). Log in and use live tiles; `/go2rtc/stream.html` is proxied like in production nginx.

**Optional:** copy `compose.override.yml.example` to `compose.override.yml` for local Compose tweaks (gitignored).

---

## Environment file (`.env`)

For **Compose workflow A**, create `.env` in the repo root. Minimum:

```env
SECRET_KEY=your-secret-here
```

Compose sets other defaults (see `docker-compose.yml` and [README.md](../README.md) Getting Started).

For **split workflow B**, Flask reads the environment of your shell (`SECRET_KEY`, `GO2RTC_URL`) more than `.env` unless you use a tool that loads it; the commands above set the important vars explicitly.

---

## Makefile (WSL / Linux only)

`make` needs a Unix shell. On **Windows** without WSL, use the commands in sections A and B instead of Make.

The [Makefile](../Makefile) assumes you run it from **your clone** of the repo. It uses `PROJECT_DIR` (default: current directory when you invoke `make`). Override if needed:

```bash
make up PROJECT_DIR=/path/to/opus
```

| Target | What it does |
|--------|----------------|
| `up` / `compose-up` | Ensure `.env` exists (minimal dev defaults), then `docker compose up --build -d` |
| `down` | `docker compose down` |
| `rebuild` | Down, then up with build |
| `logs` | Follow Compose logs |
| `go2rtc` | Start only the `go2rtc` service (detached) |
| `prune` | Prompts, then aggressive Docker prune (optional cleanup) |

**Sudo:** if your user is not in the `docker` group, run:

```bash
make DOCKER="sudo docker" up
```

**Dangerous / rare:** `clean-wipe` deletes `PROJECT_DIR` on disk. It **refuses** to run if `PROJECT_DIR` is the same as the directory you invoked `make` from, so you cannot accidentally delete your active clone. Use only for disposable paths after explicitly setting `PROJECT_DIR`.

---

## Troubleshooting

| Issue | Things to check |
|--------|------------------|
| Login / sessions weird | `SECRET_KEY` must be set for Flask. |
| Live tiles blank in split dev | go2rtc running? `GO2RTC_URL` reachable from host (`http://127.0.0.1:1984`)? |
| Port 80 in use | Full stack needs port 80 for nginx; stop the other app or adjust Compose ports in an override. |
| Port 5000 in use | Another Flask or service; stop it or change `run.py` / proxy target for experiments. |

---

## Quick smoke check

Log in, open a dashboard live tile, try Discovery, open Recordings. Full stack behavior (recorder status, etc.) needs the `recorder` service and `RECORDER_INTERNAL_STATUS_URL` as in [docker-compose.yml](../docker-compose.yml).
