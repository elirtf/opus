# Streaming, playback, and browser behavior

How **live** and **recorded** video flow in Opus today, and how that compares to common NVR/streaming patterns.

## Phones and tablets (short version)

- Opus is a **website**: use Safari, Chrome, or another mobile browser the same way you would on a desktop (after you can reach the server from outside the building; see [remote-viewing.md](remote-viewing.md)).
- For **live** view on **small screens**, the UI often uses **HLS** (standard HTTP video). That tends to behave better on phones and on slower links than some low-level browser paths.
- **Recorded** footage plays as normal **MP4** files through the same site.
- **iOS** is picky about autoplay and codecs; **H.264** is the safest choice for the widest phone support.
- An **optional store app** still shows this same site inside a shell — see [mobile/README](../mobile/README.md).

The sections below are the technical detail for installers and developers.

## Current Opus stack (anchor)


| Path           | Mechanism                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------- |
| **Live**       | Browser → **nginx** `/go2rtc/` → **go2rtc** (MSE, WebRTC-related paths, etc. per go2rtc config) |
| **Live (HLS)** | Same proxy — **go2rtc** playlist at `/go2rtc/api/stream.m3u8?src=<stream>` (native Safari; **hls.js** elsewhere). The React UI uses this on coarse-pointer / narrow viewports by default. |
| **Recordings** | **FFmpeg** segment writer → **MP4** on disk; UI/API serves files (Flask) for playback           |


nginx proxies go2rtc under `[/go2rtc/](../nginx/nginx.conf)`. Hardware decode/encode hints for FFmpeg live in `[app/ffmpeg_config.py](../app/ffmpeg_config.py)` via `FFMPEG_HWACCEL`.

**Product note:** Unified timeline scrubbing like a commercial NVR often implies **packaged HLS**, **LL-HLS**, or **range-served progressive MP4**—not required for the current live + file playback model.

## Protocol comparison (high level)


| Approach             | Role                                | NVR live / archive trade-off                  | Browser notes                                        |
| -------------------- | ----------------------------------- | --------------------------------------------- | ---------------------------------------------------- |
| **WebRTC**           | Low-latency live                    | Excellent live; not a segment archive format  | Chrome/Firefox strong; Safari improving with quirks  |
| **HLS / LL-HLS**     | Adaptive, CDN-friendly              | Good replay at scale; segment latency vs RTSP | Safari **native** HLS; others often **hls.js** (MSE) |
| **MPEG-DASH / CMAF** | Similar bucket to HLS for many apps | Packaging complexity                          | Needs **MSE** where not native                       |
| **RTMP**             | Legacy ingest                       | Rarely ideal for browser playback             | Flash-era; ingest still seen upstream                |
| **Opus today**       | go2rtc → browser; MP4 files for VOD | Live-first; recordings as **files** + HTTP    | Aligns with “relay + files” patterns                 |


## MSE vs native playback (summary)


| Environment                  | Typical live                                   | Typical file (MP4)                                |
| ---------------------------- | ---------------------------------------------- | ------------------------------------------------- |
| **Chrome / Edge (Chromium)** | MSE paths where go2rtc exposes them            | `<video src=...>` or blob/range                   |
| **Firefox**                  | MSE where supported                            | Similar to Chromium                               |
| **Desktop Safari**           | May use native or MSE depending on go2rtc mode | MP4/H.264 widely supported                        |
| **iOS Safari**               | Autoplay/user-gesture policies stricter        | HLS is first-class **natively**; other paths vary |


### Safari gotchas (operational)

- **Autoplay:** Often requires user gesture or muted playback; affects auto-starting live tiles.
- **HLS:** Safari plays **native HLS** without MSE; if you add HLS later, test **native** vs **hls.js** paths separately.
- **Codecs:** **H.264** is the safe baseline for broad browser support; **HEVC** support is **not** uniform across browsers/OS builds.

## When to add HLS/DASH

- **CDN edge** or **many concurrent viewers** on the same live stream.
- **Adaptive bitrate** for poor mobile links.
- **Unified scrub** UI over long archives without loading full MP4 files.

Until then, keeping **go2rtc + MP4** avoids packaging latency and operational complexity.

## Related docs

- [hardware-sizing.md](hardware-sizing.md) — disk and tier guidance.
- [deployment-profiles.md](deployment-profiles.md) — env defaults by hardware tier.

