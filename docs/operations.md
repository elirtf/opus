# Operations: metrics, alerts, backup, and DR

## Prometheus-style metrics

Opus exposes the [Prometheus text exposition format](https://prometheus.io/docs/instrumenting/exposition_formats/) on **three** HTTP endpoints (one per process — each has its own metric registry):

| Endpoint | Process | Examples |
| -------- | ------- | -------- |
| `GET http://opus:5000/metrics` | API (Flask) | `opus_nvr_channel_probe_failures_total` |
| `GET http://recorder:5055/metrics` | Recorder | `opus_recordings_segments_registered_total`, `opus_recorder_ffmpeg_*`, `opus_recordings_disk_free_gigabytes` |
| `GET http://processor:5056/metrics` | Processor | `opus_processor_clips_*`, `opus_processor_last_tick_unixtime` |

Outside Docker, use your hostnames/ports (e.g. `http://127.0.0.1:5000/metrics`).

**Optional auth:** set `METRICS_TOKEN` on the API container. Then `GET /metrics` requires `Authorization: Bearer <token>` or `?token=<token>`.

**Example Prometheus `scrape_configs`:**

```yaml
scrape_configs:
  - job_name: opus-api
    static_configs:
      - targets: ["opus:5000"]
    metrics_path: /metrics
  - job_name: opus-recorder
    static_configs:
      - targets: ["recorder:5055"]
    metrics_path: /metrics
  - job_name: opus-processor
    static_configs:
      - targets: ["processor:5056"]
    metrics_path: /metrics
```

Use metric names (e.g. `rate(opus_recordings_segments_registered_total[5m])`) in Grafana or Alertmanager rules to replace rough “tier table” sizing with data from **your** cameras and host.

---

## Webhook alerting (API process)

When `ALERT_WEBHOOK_URL` is set on the **opus** (API) container, a background thread periodically checks:

1. **Disk** — free space or used % on the filesystem that hosts `RECORDINGS_DIR` (same path the app uses).
2. **Recorder shelved** — `RECORDER_INTERNAL_STATUS_URL` returns `shelved_count > 0` (FFmpeg writers stopped after repeated crashes).
3. **Processor stuck** — `PROCESSOR_INTERNAL_STATUS_URL` shows `engine_running` but no tick for longer than `ALERT_PROCESSOR_STUCK_SECONDS` (default scales with poll interval).

Each alert is sent as **JSON POST** to `ALERT_WEBHOOK_URL`. Payload shape:

```json
{
  "source": "opus",
  "alert": "disk_low | recorder_shelved | processor_stuck",
  "severity": "warning | critical",
  "detail": { }
}
```

**Environment variables (API):**

| Variable | Role |
| -------- | ---- |
| `ALERT_WEBHOOK_URL` | If empty, alerting is disabled. |
| `ALERT_CHECK_INTERVAL_SECONDS` | Default `60`. |
| `ALERT_COOLDOWN_SECONDS` | Minimum time between two alerts of the **same** type (default `3600`). |
| `ALERT_DISK_FREE_GB_THRESHOLD` | Alert when free GiB is **below** this; `0` = ignore. |
| `ALERT_DISK_PERCENT_USED_THRESHOLD` | Alert when used % is **≥** this; `0` = ignore. |
| `RECORDER_INTERNAL_STATUS_URL` | e.g. `http://recorder:5055/status`. |
| `PROCESSOR_INTERNAL_STATUS_URL` | e.g. `http://processor:5056/status`. |
| `ALERT_PROCESSOR_STUCK_SECONDS` | Override default stuck detection window. |

Email/SMTP is **not** built in; point `ALERT_WEBHOOK_URL` at a bridge (e.g. Apprise, n8n, or your own forwarder) if you need mail or Slack.

---

## Backup and disaster recovery

### What to protect

1. **Database** — SQLite path from `DATABASE_PATH` (default `/app/instance/opus.db` in Docker) or Postgres `DATABASE_URL`. Holds users, cameras, NVRs, recording **metadata**, settings, events.
2. **Recordings volume** — `RECORDINGS_DIR` (default `/recordings`): MP4 segments, motion clips under `clips/`, and any files the DB references by path.
3. **Configuration files** — `go2rtc` config under `./go2rtc` (mounted in compose), `.env` (secrets; not in git).

### Backup order (recommended)

1. **Quiesce or accept best-effort:** For SQLite, a file copy while the API is running is usually OK for small DBs; for stricter consistency, stop the `opus` container briefly or use SQLite backup API / Litestream later.
2. **Copy the database file(s)** from `instance/` (or dump Postgres).
3. **Snapshot or sync the recordings volume** (block snapshot or `rsync`/`robocopy` of the volume contents).
4. **Copy `go2rtc` config** and store **`.env` or secret references** in a secure vault (not plain email).

### Restore order

1. Restore **database** first (empty app can start; recordings without DB rows show as orphan files until reconciled).
2. Restore **recordings** to the same `RECORDINGS_DIR` path the containers expect.
3. Restore **go2rtc** config and **restart** `go2rtc`, then `recorder` / `processor` / `opus` so stream registration and FFmpeg processes align.
4. Run **“Purge stale DB rows”** or startup reconcile (if configured) if paths changed and files are missing.

### DR notes

- **RPO/RTO** depend entirely on backup frequency and how you snapshot the volume.
- **Postgres:** use your standard PG backup/restore; migrations must be applied before pointing a new API at a restored DB.
- **Testing:** periodically restore to a **staging** host and verify login, camera list, and a sample playback URL.

---

## Future (not v1): cloud-saved configuration

A common next step is **encrypted, authenticated export** of non-secret configuration (camera list, display names, recording policies) and **references** to secrets (not raw passwords) to object storage or a vendor cloud — plus optional **restore** into a fresh appliance. That requires a clear threat model (who holds keys, GDPR/retention) and is intentionally **out of scope for v1**; this doc leaves a placeholder so product planning can attach designs later.
