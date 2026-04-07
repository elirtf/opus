# Deployment profiles by hardware tier

Reference **defaults** for `.env` and `docker-compose` overrides. Tune for **your** bitrates and camera count; see [hardware-sizing.md](hardware-sizing.md).

## Principles

1. **Safe defaults** beat peak performance on unsupported hardware.
2. **Validate** `FFMPEG_HWACCEL` on the **actual** host (drivers, `/dev/dri`, Docker device passthrough).
3. **Pi / ARM:** Prefer **substream** for live; motion worker is CPU-heavy—`MOTION_DETECTOR=stub` or scale back concurrency.

---

## Edge-lite (Raspberry Pi 4/5, low-power ARM)

**Goal:** Few cameras, stable live, optional light recording.


| Area                        | Recommendation                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------------- |
| `FFMPEG_HWACCEL`            | `none` (typical in Docker on Pi for arbitrary RTSP)                                                      |
| `RECORDING_STAGGER_SECONDS` | `3`–`5`                                                                                                  |
| `RECORDING_SCAN_SECONDS`    | `45`–`60`                                                                                                |
| `RECORDING_POLL_SECONDS`    | `15`–`20`                                                                                                |
| Processor service           | **Optional**; if enabled use `MOTION_DETECTOR=stub` or very few `events_only` cameras                    |
| `GO2RTC_RTSP_URL`           | Set to `rtsp://go2rtc:8554` when recording **via relay** (uncomment in compose for recorder + processor) |
| Compose                     | Avoid pinning unrealistic CPU limits; ensure **recordings** volume is **USB3 SSD** if possible           |


**Compose notes:** Do not enable NVIDIA devices; `/dev/dri` on Pi is platform-specific—verify VideoCore/V4L2 outside Docker before assuming hwaccel.

---

## Edge-x86 (Intel NUC, small desktop, iGPU)

**Goal:** Moderate camera count; Intel **QSV** or **VAAPI** when validated.


| Area                        | Recommendation                                                                                      |
| --------------------------- | --------------------------------------------------------------------------------------------------- |
| `FFMPEG_HWACCEL`            | Start `none`; try `qsv` (Intel) or `vaapi` after `ffmpeg -hwaccels` on host                         |
| `FFMPEG_HWACCEL_DEVICE`     | Set if multi-GPU (e.g. `0`)                                                                         |
| `RECORDING_STAGGER_SECONDS` | `2` (default)                                                                                       |
| Processor                   | Enable; `MOTION_DETECTOR=opencv` for typical loads                                                  |
| Docker                      | Pass `/dev/dri` into **recorder** and **processor** when using VAAPI (see compose comments in repo) |


---

## Workstation (many-core, 32–64 GB+)

**Goal:** Many streams, parallel FFmpeg, faster scans.


| Area                        | Recommendation                                         |
| --------------------------- | ------------------------------------------------------ |
| `FFMPEG_HWACCEL`            | Match GPU (CUDA, QSV, VAAPI)—validate matrix           |
| `RECORDING_STAGGER_SECONDS` | `1`–`2` if disk/network proven                         |
| `RECORDING_SCAN_SECONDS`    | `20`–`30` if DB large                                  |
| Processor                   | Full OpenCV; tune `PROCESSING_POLL_SECONDS` vs latency |
| Monitoring                  | Watch disk **write MB/s** and go2rtc CPU first         |


---

## Hosted (rented appliance, fixed SKU)

**Goal:** One **golden** image, pinned kernel + drivers, predictable SKU.


| Area             | Recommendation                                                          |
| ---------------- | ----------------------------------------------------------------------- |
| Config           | Single `.env.example` per SKU copied to customer appliance              |
| `FFMPEG_HWACCEL` | Pin per SKU after QA (often `none` or one validated path)               |
| Updates          | Controlled rollouts; pin image tags, canary then fleet; [operations.md](operations.md) for backups before upgrades |
| Secrets          | Rotate `SECRET_KEY` per tenant; never ship defaults                     |


---

## Shared compose snippets

**Recorder + processor via go2rtc relay** (recommended when cameras allow a single RTSP consumer or NVR fans out):

Uncomment in `docker-compose.yml` for **opus**, **recorder**, and **processor**:

```yaml
- GO2RTC_RTSP_URL=rtsp://go2rtc:8554
```

**Disable processor** (compose scale or remove service): use when Edge-lite cannot sustain motion analysis.

**Internal recorder status** (dashboard): `RECORDER_INTERNAL_STATUS_URL` on the **opus** service points at the recorder sidecar (already set in default compose).

---

## Capacity presets (publishable defaults)

Use these as product-facing presets after validation in your environment.

### Performance preset (larger host)

| Item | Default |
| ---- | ------- |
| Live substream profile | H.264, 10-15 FPS, 640x360-704x480, keyframe 1s |
| Main recording profile | Keep camera main quality (recording path) |
| Playback mode policy | Auto, with per-browser override from camera page benchmark |
| `FFMPEG_HWACCEL` | Host-validated mode (`cuda`/`qsv`/`vaapi`), else `none` |
| `MOTION_MAX_CONCURRENT` | 8-16 (start 8, raise with CPU headroom) |
| `MOTION_ANALYSIS_MAX_WIDTH` | 320-480 |
| Success gate | 10+ min single-camera fullscreen without buffering and stable browser CPU |

### Cost-efficient preset (smaller host)

| Item | Default |
| ---- | ------- |
| Live substream profile | H.264, 8-12 FPS, 640x360, keyframe 1s |
| Main recording profile | Keep recording on main; reduce main bitrate if retention pressure |
| Playback mode policy | Prefer least-CPU mode from benchmark; avoid unnecessary retries |
| `FFMPEG_HWACCEL` | `none` unless validated and stable on target SKU |
| `MOTION_MAX_CONCURRENT` | 2-4 |
| `MOTION_ANALYSIS_MAX_WIDTH` | 320 |
| Success gate | Stable multi-tile live with defined camera cap and no sustained CPU runaway |

### Benchmark checklist (per preset)

1. Pick one representative camera.
2. Test fullscreen live for 3-5 minutes each in `webrtc`, `mse`, and `hls`.
3. Record browser CPU, dropped frames, and buffering events.
4. Select the smoothest mode as the browser default policy.
5. Validate dashboard tile count limits and publish max stable count.

## Related

- [hw-diagnostics-spec.md](hw-diagnostics-spec.md) — host capability JSON (admin API).
- [streaming-playback.md](streaming-playback.md) — why go2rtc + MP4.

