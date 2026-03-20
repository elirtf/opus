# NVR replacement — validation 

Aggregator/recorder **without** destabilizing production NVRs.

## Objectives

- Live view stable for **N** hours through go2rtc  
- Continuous or selective recording produces **valid MP4** segments  
- Playback in UI (or direct file) matches wall clock within acceptable skew  
- No camera/NVR lockout (some devices limit **concurrent RTSP** clients)

## Track A — Secondary RTSP URL (dual stream / substream)

**Setup**

1. On camera or NVR, configure a **second** RTSP URL (substream or duplicate main) pointing only at Opus/go2rtc.
2. Add stream in go2rtc config; register camera in Opus with that URL.
3. Leave production path unchanged.

**Checklist**

- Substream bitrate documented (for [hardware-sizing.md](hardware-sizing.md))  
- 24h soak: no go2rtc producer drops in logs  
- Recorder segment files present every `RECORDING_SEGMENT_MINUTES`  
- Retention job runs (`RECORDING_RETENTION_DAYS` / `RECORDING_MAX_STORAGE_GB` behavior spot-checked)

## Track B — Isolated VLAN / lab switch

**Setup**

1. Cameras + Opus host (+ DHCP) on **isolated** L2 segment.
2. No route to production NVR for those cameras.

**Checklist**

- ONVIF/discovery path documented (host network vs bridge—see `docker-compose.yml` header)  
- Time sync (NTP) on cameras and host  
- Full stack: discovery → add device → live → record → playback

## Track C — Synthetic load (no extra hardware)

**Goal:** Scale **stream count** without buying cameras.

**Example: FFmpeg test pattern into RTSP server**

You need a local RTSP publisher (e.g. **MediaMTX**, **rtsp-simple-server**, or **go2rtc** `ffmpeg` source). Example pattern (adjust for your toolchain):

```bash
# Illustrative only — use the RTSP URL your lab server exposes.
ffmpeg -re -f lavfi -i testsrc=size=1280x720:rate=15 \
  -c:v libx264 -preset ultrafast -tune zerolatency -f rtsp rtsp://127.0.0.1:8554/synth1
```

**Checklist**

- Document exact command and server version for regression  
- Ramp **N** synthetic streams until CPU or disk saturates; record **N** and CPU%  
- Confirm recorder stagger (`RECORDING_STAGGER_SECONDS`) prevents thundering herd

## Regression bundle (attach to tickets)


| Item                        | Value    |
| --------------------------- | -------- |
| Opus git commit / image tag |          |
| docker-compose overrides    |          |
| Camera firmware / NVR model |          |
| `GO2RTC_RTSP_URL` used?     | yes / no |
| `FFMPEG_HWACCEL`            |          |
| Soak duration               |          |
| Failures (if any)           |          |


## Product decision (document separately)

- **Parallel** to NVR until trust is earned, vs **primary** recorder only.  
- Failover expectations (who owns time sync, DNS, certificates).

## Related

- [deployment-profiles.md](deployment-profiles.md)  
- [hardware-sizing.md](hardware-sizing.md)

