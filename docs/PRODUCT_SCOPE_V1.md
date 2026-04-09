#  Opus — Project Scope and Plan (v1.0)

---

## What is Opus?

Opus is a software in which security cameras on the network send their video to Opus. Users use a normal web browser to watch live video, scroll through past recordings on a timeline, and manage who can see which cameras.

---

## Glossary

| Term | Meaning |
| ---- | ------- |
| **IP Camera** | A network security camera that can send video over the network. |
| **RTSP** | Standard camera video URL that sends video over the network. |
| **ONVIF** | Enables IP-based security products from different manufacturers. |
| **NVR** | Network Video Recorder - Vendor recorder box; Opus can replace it for new installs. |
| **Docker Compose** | Standard installation method. |

## Scope

**Core**

- **Live viewing** in the browser (go2rtc).
- **Continuous recording** and **timeline playback** from disk.
- **Cameras:** manual RTSP URL; **ONVIF discovery** where the network allows.
- **Users:** admin vs viewer; sites/NVR grouping; optional **per-user camera** limits.
- **Operational visibility:** stream health and admin diagnostics.
- **Upgrades:** new container images + documented **redeploy**.

**Remote Viewing**

- **Secure access** to the same web interface and streams **from outside the local network**.

**Push Notifications**

- **Operational Alerts** (ex. low disk, recorder/processor issues, camera offline/online) via optional **webhook** and/or **SMTP email** (no extra apps — users get mail notifications on phones they already use).

**Sizing / Platform**

- **~4–32 channels** per machine typical; larger counts for the future.
- **Ubuntu Server + Docker Compose** for certified commitments.
- **Cameras:** certified list or validated RTSP.

---

## Documentation Map

| Doc | Topic |
| --- | ----- |
| [certified-cameras.md](certified-cameras.md) | Certified models + regression checklist |
| [nvr-replacement-lab.md](nvr-replacement-lab.md) | Migration / lab validation |
| [remote-viewing.md](remote-viewing.md) | Remote Viewing |
| [hardware-sizing.md](hardware-sizing.md) | Storage, retention, tiers |
| [MOBILE_QA_v1.md](MOBILE_QA_v1.md) | Mobile QA |
| [DEV_WORKFLOW.md](DEV_WORKFLOW.md) | Local development |
| [README](../README.md) | Quick start |
