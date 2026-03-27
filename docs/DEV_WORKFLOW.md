# Development Workflows

Steps for **Windows (PowerShell)**, **WSL**, and **Linux**. Copy the block that matches your machine.

---

## Development Updates:

**Goal:** Get the latest code and run the **new** version in Docker.


| Step | What it does                                                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------------- |
| 1    | `git pull` — downloads the latest commits into project folder.                                            |
| 2    | `docker compose up --build -d` — **rebuilds** the Opus images from updated files and restarts containers. |

**`docker compose pull`** only updates **pre-built** images (e.g. go2rtc, nginx). Opus uses **`build: .`** — new code needs **`--build`**, not prune.

**Old UI after a rebuild (root cause and fix):** The React app is served from a **named volume** (`static_files`) shared by `opus` and `nginx`. That volume sits on top of the files in the image, so once it was created it could keep **stale** JS until the volume was deleted (people often deleted it indirectly via **prune**). Current images run a **startup copy** from the fresh build into that volume so **`git pull` + `docker compose up --build -d`** is enough. **Do not use prune** as your normal update step.

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

1. Pull this fix, rebuild, and restart (creates a new image with the entrypoint):

```bash
git pull
docker compose up --build --force-recreate -d
```

2. Hard-refresh the browser (Ctrl+F5) so the browser is not caching `index.html`.

3. **Only on an old deploy** without the entrypoint: remove the **static** volume once — **not** a full prune — then bring the stack back:

```bash
docker compose down
docker volume ls   # find `<project>_static_files`, often opus_static_files
docker volume rm opus_static_files
docker compose up --build -d
```

Never remove the **`recordings`** volume unless you mean to delete footage.

---

## Login and password after updates

**Seeing the login screen again after `git pull` / rebuild is normal** if your `.env` **`SECRET_KEY`** changed: old browser sessions no longer count, so you must sign in again.

**`admin` / `admin` only applies on a brand‑new database** (no users yet). Your data folder `./instance` is **reused** across rebuilds, so:

- If you already changed the admin password, **`admin` / `admin` will not work** — use the password you set.
- Rebuilding Docker **does not** reset passwords and **does not** wipe users.

**Locked out or need to go back to a known password** (stack must be running):

**PowerShell / WSL / Linux** (in the project folder):

```bash
docker compose exec opus python scripts/reset_admin_password.py
```

Defaults reset user `admin` to password `admin`. To pick another password:

```bash
docker compose exec opus python scripts/reset_admin_password.py --username admin --password "your-new-password"
```

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
| Old UI after update            | Ensure you have the entrypoint fix, then `docker compose up --build --force-recreate -d`. Ctrl+F5. If still stuck (legacy volume), `docker volume rm <project>_static_files` only — not prune. |
| Old API / Python not updating  | `docker compose up --build --force-recreate -d` (API code is in the image; not blocked by `static_files`). |
| `git pull` fails               | Commit or `git stash`, then pull again                       |
| Login / sessions odd           | Set `SECRET_KEY` in `.env`. After it **changes**, you must log in again; default **`admin` / `admin`** only exists on first install — see [Login and password after updates](#login-and-password-after-updates). |
| Live tiles blank (split dev)   | go2rtc running? `GO2RTC_URL=http://127.0.0.1:1984`?          |
| Port 80 or 5000 in use         | Stop the other program or change ports in a Compose override |


---

## Motion / event recording (Compose)

- `processor` must run for motion clips on **Events** cameras. Full `docker compose up` starts it with the rest.
- `EVENTS_ONLY_RECORD_SEGMENTS` on **recorder** (see [README.md](../README.md)): default off — Events cameras do not keep 24/7 segment files unless you enable it.
- Same `GO2RTC_RTSP_URL` on **recorder** and **processor** if you use go2rtc relay for FFmpeg.

