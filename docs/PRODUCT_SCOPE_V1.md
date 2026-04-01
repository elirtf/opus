#  Opus — Project Scope and Plan (v1.0)

This page is the **single place** to read what Opus v1.0 is meant to do and how we plan to ship and support it. It doubles as a **reference for sales and support**: if something is written here, we stand behind it for supported setups; if it is listed as out of scope, we do not promise it in v1.0.

**Who this is for**

- **Anyone new to the project** — you do not need a networking or programming background to follow the big ideas below.
- **People installing or selling Opus** — what to promise customers and what to set as an expectation for “later” or “best effort.”
- **Developers** — the same boundaries, with pointers to technical detail in the other documentations.

---

## What is Opus?

Opus is a software that runs on a **computer you control** (usually a small server or workstation at a site). **Security cameras on the network** send their video to Opus. Users use a **normal web browser** to watch live video, scroll through past recordings on a timeline, and manage who can see which cameras.

For **new installations**, the usual setup is: cameras talk **directly to Opus**. You do **not** need a separate box from a camera vendor (often called an **NVR**) just to get recording and viewing working. If someone already has an old recorder, Opus can still **pull video from it during a move to Opus** — that path is a **migration** helper, not the main long-term design.

---

## Glossary


| Term               | Simple meaning                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IP camera**      | A network security camera that can send video over the network.                                                                                                                 |
| **Channel**        | One camera feed — like one “line” on a recorder.                                                                                                                                |
| **RTSP**           | A standard way cameras send video over the network. Opus needs a working RTSP address (URL) for each camera, or a model from our certified list.                                |
| **ONVIF**          | Enables IP-based security products from different manufacturers to communicate and work together seamlessly.                                                                    |
| **NVR**            | “Network video recorder” — often a small box from the same company as the cameras. Opus can replace it for new installs; we do not remote-control vendor NVR menus or firmware. |
| **Docker Compose** | A standard way to install and run Opus and its helper programs as a packaged set. The documented setup uses **Ubuntu Server** Linux plus this packaging.                        |
| **Web-first**      | You use a website in the browser; there is **no native phone app in v1**.                                                                                                       |


---

## Scope

- **Live viewing** in the browser (via go2rtc).
- **Continuous recording** to disk and **date/timeline playback**.
- **Adding cameras** with a hand-entered RTSP URL; **ONVIF discovery** where the network setup allows (notes in `docker-compose.yml`).
- **Users:** admin vs viewer; grouping by site/NVR; optional **per-user** limits on which cameras they see.
- **Operational visibility:** health per stream and host diagnostics for admins (`/api/health`, `/api/health/diagnostics`).
- **Upgrades:** pull new images and redeploy using the documented process; logs go to **container output** until we add a future release with a log viewer in the UI.

**Sizing and deployment**

- **Typical sites:** about **4–32 camera channels** per machine; larger counts wait until v2.0.
- **Standard platform:** **Ubuntu Server** with **Docker Compose**. Other systems may work but are **not certified** for v1.0 commercial commitments.
- **Cameras:** customers either use our **short certified list** or supply direct access to their cameras for testing for compatibility.

---

## Plan — Ship, Validate, and Support

### Phase: v1.0

Deliver the scope above as a **recorder and control plane**: direct camera → Opus, browser UI, users, diagnostics, documented Compose deployment.

- **Certified cameras:** see **[certified-cameras.md](certified-cameras.md)** for the minimal list and a short regression checklist before rollouts.
- **Migration and lab validation:** see **[nvr-replacement-lab.md](nvr-replacement-lab.md)** for tracks that prove stability without breaking production NVRs during testing.
- Anything **outside** those documented environments is **best effort** — we may still help, but we do not treat it as a guaranteed commitment.

### Releases/Upgrades

- Ship updates as **container images**; admins **redeploy** using project documentation.
---

## Documentation Map


| Document                                         | What you will find                                                                |
| ------------------------------------------------ | --------------------------------------------------------------------------------- |
| [certified-cameras.md](certified-cameras.md)     | Which camera models we commit to for v1 and a quick pre-release checklist.        |
| [nvr-replacement-lab.md](nvr-replacement-lab.md) | How to validate Opus beside or instead of an existing recorder, safely.           |
| [hardware-sizing.md](hardware-sizing.md)         | Storage math, retention settings, rough camera counts per hardware tier.          |
| [deployment-profiles.md](deployment-profiles.md) | Suggested settings for small devices (e.g. Pi), PCs, or hosted appliances.        |
| [streaming-playback.md](streaming-playback.md)   | How live and recorded video reach the browser (plain-language + technical notes). |
| [hw-diagnostics-spec.md](hw-diagnostics-spec.md) | What the admin diagnostics API returns (for tooling and support).                 |
| [DEV_WORKFLOW.md](DEV_WORKFLOW.md)               | How developers run and update the project locally.                                |

The **[README](../README.md)** in the repo root has setup commands and a compact feature overview.
