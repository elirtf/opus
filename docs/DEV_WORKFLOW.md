# Development Workflows

Steps for **Windows (PowerShell)**, **WSL**, and **Linux**. Copy the block that matches your machine.

---

## Development Updates:

**Goal:** Get the latest code and run the **new** version in Docker.


| Step | What it does                                                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------------- |
| 1    | `git pull` — downloads the latest commits into project folder.                                            |
| 2    | `docker compose up --build -d` — **rebuilds** the Opus images from updated files and restarts containers. |


---

### Windows — PowerShell

In your project folder:

```powershell
git pull
docker compose up --build -d
```

If Git says you have local edits you don’t want to lose:

```powershell
git stash
git pull
git stash pop
```

---

### WSL or Linux — Bash

In your project folder:

```bash
git pull
docker compose up --build -d
```

Stash if needed:

```bash
git stash
git pull
git stash pop
```

---

### Still seeing the old app?

Try recreating containers once:

**PowerShell / Bash:**

```bash
docker compose up --build --force-recreate -d
```

Only if something is really stuck, use prune **carefully** (dev machine, disk cleanup). For production servers, prefer `--build` and only prune when you understand what will be removed.

---

## Run the full stack (first time or after a reboot)

**PowerShell / WSL / Linux** (project root, `.env` with `SECRET_KEY`):

```bash
docker compose up --build -d
```

Open **[http://localhost](http://localhost)** — login `admin` / `admin` (change after first login).

**Stop:**

```bash
docker compose down
```

---

## Split dev (UI / API — faster iteration)

Use Docker only for **go2rtc**, run **Flask** and **Vite** on the host.

**1. go2rtc**

```bash
docker compose up go2rtc -d
```

**2. Backend**

PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:SECRET_KEY = "dev"
$env:GO2RTC_URL = "http://127.0.0.1:1984"
python run.py
```

WSL / Linux:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export SECRET_KEY=dev
export GO2RTC_URL=http://127.0.0.1:1984
python run.py
```

**3. Frontend**

```bash
cd frontend
npm install
npm run dev
```

Open the URL Vite prints (often **[http://localhost:5173](http://localhost:5173)**).

---

## Environment file (`.env`)

For Docker Compose, put a `.env` next to `docker-compose.yml` with at least:

```env
SECRET_KEY=your-secret-here
```

See [README.md](../README.md) for more options.

---

## Makefile (WSL / Linux only)

From the repo: `make up` runs `docker compose up --build -d`.  
`make DOCKER="sudo docker" up` if Docker needs sudo.


| Target              | Action                       |
| ------------------- | ---------------------------- |
| `up` / `compose-up` | Build and start stack        |
| `down`              | Stop stack                   |
| `rebuild`           | Down, then build and up      |
| `logs`              | Follow logs                  |
| `go2rtc`            | Start only go2rtc (detached) |


`clean-wipe` is rare and only for a disposable clone path (see Makefile).

---

## Troubleshooting


| Problem                        | Try                                                          |
| ------------------------------ | ------------------------------------------------------------ |
| Old UI or old API after update | `docker compose up --build --force-recreate -d`              |
| `git pull` fails               | Commit or `git stash`, then pull again                       |
| Login / sessions odd           | Set `SECRET_KEY` in `.env`                                   |
| Live tiles blank (split dev)   | go2rtc running? `GO2RTC_URL=http://127.0.0.1:1984`?          |
| Port 80 or 5000 in use         | Stop the other program or change ports in a Compose override |


---

## Motion / event recording (Compose)

- `processor` must run for motion clips on **Events** cameras. Full `docker compose up` starts it with the rest.
- `EVENTS_ONLY_RECORD_SEGMENTS` on **recorder** (see [README.md](../README.md)): default off — Events cameras do not keep 24/7 segment files unless you enable it.
- Same `GO2RTC_RTSP_URL` on **recorder** and **processor** if you use go2rtc relay for FFmpeg.

