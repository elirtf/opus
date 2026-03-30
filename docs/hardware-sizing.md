# Hardware sizing and storage

Planning guide—not a guarantee. **Camera bitrate settings dominate** real usage; validate on your network with `ffprobe` or camera web UI.

## Bitrate → disk per camera per day

**Formula (theoretical continuous recording):** bitrate is **megabits per second** (Mb/s).

```
bytes/day = (Mbps × 1_000_000 × 86_400) / 8
GiB/day   = bytes/day / 1024³  ≈ Mbps × 10.06
GB/day    = bytes/day / 10⁹      ≈ Mbps × 10.8   (decimal gigabytes)
```


| Approx. video bitrate | ~GiB/day per camera (continuous) | ~decimal GB/day |
| --------------------- | -------------------------------- | --------------- |
| 2 Mbps                | ~20                              | ~22             |
| 4 Mbps                | ~40                              | ~43             |
| 8 Mbps                | ~80                              | ~86             |
| 16 Mbps               | ~161                             | ~173            |


Add **~5–15%** for MP4/moov overhead and filesystem slack. **VBR** cameras dip below peak; **CBR** holds the line above.

### 1080p H.264 (typical ranges)


| Profile               | Bitrate ballpark | ~GiB/day (continuous) |
| --------------------- | ---------------- | --------------------- |
| Efficient sub/main    | 2–4 Mbps         | ~20–40                |
| Typical security main | 4–8 Mbps         | ~40–80                |
| High quality          | 8–12 Mbps        | ~80–120               |


### 4K / higher resolution


| Profile  | Bitrate ballpark | ~GiB/day (continuous) |
| -------- | ---------------- | --------------------- |
| Moderate | 10–16 Mbps       | ~100–160              |
| High     | 16–40 Mbps       | ~160–400+             |


**HEVC (H.265)** often reduces bitrate **for the same subjective quality**—use the **configured bitrate** from the camera/NVR, not the resolution label, for sizing.

### Multi-camera rough total

```
Total_GiB_day ≈ Σ (per_camera_GiB_day)
```

Retention (see below): multiply by effective days stored (capped by `RECORDING_MAX_STORAGE_GB` if set).

## Retention and caps


| Variable                   | Role                                                         |
| -------------------------- | ------------------------------------------------------------ |
| `RECORDING_RETENTION_DAYS` | Age-based deletion of segment rows/files                     |
| `CLIP_RETENTION_DAYS`      | Age-based deletion of motion/event clips                     |
| `RECORDING_MAX_STORAGE_GB` | Cap total segment storage (0 = unlimited)                    |
| `RECORDING_MIN_FREE_GB`    | Do not **start** new recorders when free disk on the recordings volume is below this (0 = off). Existing FFmpeg processes keep running. |
| `EVENTS_ONLY_BUFFER_HOURS` | How long **rolling** segments stay for `events_only` cameras **when** segment recording is enabled |
| `EVENTS_ONLY_RECORD_SEGMENTS` | Rolling segment buffer for `events_only` is **opt-in**: only **`1`**, **`true`**, **`yes`**, or **`on`** enable it (anything else = clip-only). Set on the **`recorder`** service. |
| `MOTION_RTSP_MODE` | On the **`processor`**: **`auto`** (default) = motion sampling uses **sub** when configured (`*-sub` row, `rtsp_substream_url`, or go2rtc sub name); **`main`** = always sample main; **`sub`** = prefer sub, fall back to main with a log warning if missing. Event **clips** always use **main**. |


Segment FFmpeg arguments follow the same copy-record / RTSP input pattern as [Frigate](https://github.com/blakeblackshear/frigate)’s generic presets (see `app/recorder.py` and `app/ffmpeg_config.py`); you do not need to import Frigate’s `ffmpeg_presets.py` into Opus.

Documented in [docker-compose.yml](../docker-compose.yml) comments and recorder code.

### Motion / FFmpeg tuning (recorder + processor)

| Variable | Role |
| -------- | ---- |
| `FFMPEG_RTSP_THREAD_QUEUE_SIZE` | Larger `-thread_queue_size` before `-i` (try `512`–`1024`) if logs show thread message queue blocking under many cameras. |
| `MOTION_MAX_CONCURRENT` | **Processor:** parallel OpenCV/RTSP motion checks per tick (default `4`). Raise on many-core hosts; lower on Pi. |
| `MOTION_ANALYSIS_MAX_WIDTH` | Downscale frames before motion math (default `320`; `0` = full resolution, heavier). |
| `MOTION_SKIP_FRAMES` | Frames to drop after first grab before compare (default `8`). |
| `MOTION_DIFF_THRESHOLD` | Mean absdiff threshold for `MOTION_DETECTOR=opencv` (default `5`). |
| `MOTION_GAUSSIAN_KSIZE` | Odd blur kernel before diff (`5` typical); `0` = off. |
| `MOTION_DETECTOR` | `opencv` (frame diff), `opencv_mog2` (adaptive background — stronger outdoors, higher CPU), or `stub`. |
| `MOTION_MOG2_FG_RATIO` / `MOTION_MOG2_HISTORY` / `MOTION_MOG2_VAR_THRESHOLD` | Tune MOG2 sensitivity (see `app/processing/detectors.py` docstring). |

## Camera count vs hardware tier (order-of-magnitude)

**Not benchmarks**—starting points for design. Measure with `top`, `docker stats`, and recorder status on **your** streams.


| Tier        | Example                                             | Live + go2rtc + copy-record (main streams)       | + OpenCV motion worker (`events_only`)                                                  |
| ----------- | --------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Edge-lite   | Raspberry Pi 4/4GB                                  | ~2–6 mains (substream live strongly recommended) | Often **1–3** concurrent analyses; consider `MOTION_DETECTOR=stub` or disable processor |
| Edge-x86    | Intel NUC, iGPU                                     | ~8–20                                            | ~4–12                                                                                   |
| Workstation | Many-core Xeon, 64GB (e.g. ThinkStation P700 class) | ~50+ (network and disk I/O often limit first)    | Scales with cores; stagger FFmpeg (`RECORDING_STAGGER_SECONDS`)                         |


**Bottlenecks:** (1) **Camera uplink** and NVR RTSP session limits. (2) **Disk write** sustained MB/s. (3) **CPU** for motion/AI decode (copy-mode record is light). (4) **RAM** for go2rtc + many FFmpeg processes.

## Filesystems for MP4 segments


| FS       | Pros                                                | Cons / notes                                                |
| -------- | --------------------------------------------------- | ----------------------------------------------------------- |
| **ext4** | Default on most Linux; simple; good for single disk | No built-in checksums                                       |
| **XFS**  | Strong on large files; common on RHEL-style         | Less common on Pi images                                    |
| **ZFS**  | Checksums, snapshots, RAIDZ                         | Higher RAM expectation; CPU for parity; not ideal on 2GB Pi |


**Recommendation:** **ext4 or XFS** on a dedicated disk/volume for recordings. **ZFS** when you want integrity + snapshots and have **≥8 GB RAM** and admin comfort with ZFS.

## Validation on your lab (optional)

1. Record one camera for 1 hour at known bitrate; measure file size → extrapolate to 24h.
2. `ffprobe -v error -show_entries format=bit_rate -of default=noprint_wrappers=1:nokey=1 <file.mp4>` on a segment.
3. Under load, watch `iostat -x 1` (disk) and CPU per `ffmpeg` PID.

See also [deployment-profiles.md](deployment-profiles.md), [streaming-playback.md](streaming-playback.md), and [operations.md](operations.md) (ops snapshot, webhook alerts, backup/DR).