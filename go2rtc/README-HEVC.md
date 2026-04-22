# H.265 / HEVC with go2rtc and Opus

## Recordings (FFmpeg)

Segment recording uses **stream copy** (`-c:v copy`) when possible, so **H.265 on the wire is stored as H.265 in MP4**. Desktop players that support HEVC will play these files; others may need transcoding outside Opus.

## Live view (browser)

Opus live view uses **MSE** (desktop, via `stream.html?mode=mse`) and **HLS** (touch / narrow viewports). HEVC support over these paths depends on the browser:

- **Firefox** — no HEVC in MSE; expect "No video with supported format or MIME type found."
- **Chrome / Edge** — HEVC in MSE only when the host has hardware decode support.
- **Safari / Edge on Apple silicon** — HEVC generally fine.

If a camera's live tile is black on your machine, the camera is almost certainly sending H.265 and your browser can't decode it.

## Mitigations

1. **Substream H.264** — Configure the camera or NVR so the **sub stream** is H.264; the dashboard and camera page prefer the sub stream for `*-main` tiles automatically.

2. **Per-camera transcode** — Set **Transcode** on the camera (Camera configuration UI). Opus will write the stream as `ffmpeg:rtsp://...#video=h264` in `go2rtc.yaml` so go2rtc runs an FFmpeg child process that re-encodes to H.264 for the browser. Note: transcoding is CPU-expensive; enable it only for cameras that need it.

3. **Transcode in go2rtc directly** — Point the stream at an FFmpeg pipeline that outputs H.264. See the [go2rtc documentation](https://github.com/AlexxIT/go2rtc) for `ffmpeg:` sources and hardware acceleration.

Example idea (adjust for your RTSP URL and hardware):

```yaml
streams:
  mycam:
    - ffmpeg:rtsp://user:pass@192.168.1.50/stream#video=h264#hardware
```

Validate with the go2rtc UI and your GPU/driver before enabling in production.
