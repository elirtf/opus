# Host diagnostics API

## Purpose

Read-only snapshot of **host/container** capabilities for support and sizing: CPU topology, memory, GPU/VAAPI presence, FFmpeg hwaccel list, and recordings mount free space.

**Security:** **Admin-only.** Same session rules as other admin API routes (`login_required_api` + `admin_required`).

## Endpoint


| Method | Path                      | Auth                |
| ------ | ------------------------- | ------------------- |
| `GET`  | `/api/health/diagnostics` | Logged-in **admin** |


**Success:** `200` with JSON body (see schema).  
**Forbidden:** `403` if not admin.  
**Unauthorized:** `401` if not logged in.

## Response schema (v1)

All fields are **best-effort**; missing data is omitted or set to `null` rather than failing the whole request.


| Field                   | Type          | Description                                                             |
| ----------------------- | ------------- | ----------------------------------------------------------------------- |
| `schema_version`        | string        | e.g. `"1"`                                                              |
| `platform_system`       | string        | `platform.system()`                                                     |
| `platform_machine`      | string        | `platform.machine()` (e.g. `x86_64`, `aarch64`)                         |
| `platform_release`      | string        | OS release string when available                                        |
| `python_version`        | string        | Interpreter version                                                     |
| `cpu_count_logical`     | int           | `os.cpu_count()`                                                        |
| `mem_total_kb`          | int | null    | Linux `/proc/meminfo` MemTotal                                          |
| `dev_dri_present`       | bool          | `os.path.isdir("/dev/dri")`                                             |
| `nvidia_device_present` | bool          | Heuristic: `/dev/nvidia0` exists                                        |
| `ffmpeg_hwaccels`       | string[]      | Parsed from `ffmpeg -hide_banner -hwaccels`                             |
| `ffmpeg_hwaccels_error` | string | null | If probe failed                                                         |
| `env_ffmpeg_hwaccel`    | string        | Value of `FFMPEG_HWACCEL` seen by process                               |
| `recordings_dir`        | string        | `RECORDINGS_DIR` env or default                                         |
| `recordings_disk`       | object | null | `shutil.disk_usage(recordings_dir)` as `{ total_gb, used_gb, free_gb }` |
| `recordings_disk_error` | string | null | If disk query failed                                                    |


### Example payload

```json
{
  "schema_version": "1",
  "platform_system": "Linux",
  "platform_machine": "x86_64",
  "platform_release": "6.1.0",
  "python_version": "3.11.6",
  "cpu_count_logical": 8,
  "mem_total_kb": 65902284,
  "dev_dri_present": true,
  "nvidia_device_present": false,
  "ffmpeg_hwaccels": ["cuda", "vaapi", "vdpau"],
  "ffmpeg_hwaccels_error": null,
  "env_ffmpeg_hwaccel": "none",
  "recordings_dir": "/recordings",
  "recordings_disk": {
    "total_gb": 931.5,
    "used_gb": 120.2,
    "free_gb": 811.3
  },
  "recordings_disk_error": null
}
```

## Client usage

- Call after login; attach session cookie or equivalent auth used by the SPA.
- **Do not** expose this route to anonymous users (PII-free but infrastructure signal).

## Future extensions

- `ffmpeg_version` string  
- `go2rtc_reachable` bool (optional HTTP ping from app)  
- Per-container cgroup memory limit (if detectable)

Implementation: `[app/services/host_diagnostics.py](../app/services/host_diagnostics.py)`, route in `[app/routes/api/health.py](../app/routes/api/health.py)`.