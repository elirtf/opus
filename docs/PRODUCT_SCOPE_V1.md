# Opus — Product Scope (v1.0)

This document is the **sales and support contract** for v1.0: Opus as a **recorder and control plane**.

## Goal

For supported deployments, **IP cameras send video directly to Opus** (live view + continuous recording + timeline playback + users). A **vendor NVR is not required** for new installs. Importing streams from an existing NVR remains a **migration** path only.

## Target customer

- Small commercial sites: roughly **4–32 channels** per machine (larger counts only after v1 is proven).
- **Ubuntu Server** + **Docker Compose** as the standard deployment (other hosts may work but are not v1-certified).
- Customers accept either a **short certified camera list** or supplying a **known-good RTSP URL**.
- **Web-first:** browser for live and playback; native mobile apps are **out of v1**.

## v1 — included

- Live viewing via go2rtc (browser).
- Continuous recording to disk and date/timeline playback.
- Adding cameras: manual RTSP URL; ONVIF discovery where environment allows (see `docker-compose.yml` network notes).
- Users: admin vs viewer; NVR/site grouping and optional per-user camera scoping.
- Operational visibility: per-stream health and admin host diagnostics (`/api/health`, `/api/health/diagnostics`).
- Upgrades: **pull new images / redeploy** (documented); application logs via **container stdout** unless a future release adds a log viewer.

## explicitly NOT included

- **Remote control of vendor NVR firmware** (proprietary HTTP/API/SDK).
- **Full Configuration-tab parity** of in-place existing NVRs.
- **Universal camera compatibility** — only listed or validated URLs are supported for commercial commitments.
- **Enterprise features**: LDAP, multi-tenant SaaS control plane, geo-redundant recorders, advanced VMS maps (unless separately funded).
- **In-app** upgrade of Opus containers from inside the UI (v1 uses external deploy tooling).

## Support stance

Commercial support should reference **[certified-cameras.md](certified-cameras.md)** and **[nvr-replacement-lab.md](nvr-replacement-lab.md)**. Anything outside documented environments is **best effort**.