# Deployment profiles by hardware tier

Reference **defaults** for `.env` and `docker-compose` overrides. Tune for **your** bitrates and camera count; see [hardware-sizing.md](hardware-sizing.md).

**v1 scope and plan** (what we promise vs defer): [PRODUCT_SCOPE_V1.md](PRODUCT_SCOPE_V1.md).

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
| Updates          | Controlled rollouts; see [hosted-ops-outline.md](hosted-ops-outline.md) |
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

## Related

- [hw-diagnostics-spec.md](hw-diagnostics-spec.md) — host capability JSON (admin API).
- [streaming-playback.md](streaming-playback.md) — why go2rtc + MP4.

