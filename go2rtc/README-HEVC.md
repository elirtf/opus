# H.265 / HEVC with go2rtc and Opus

## Recordings (FFmpeg)

Segment recording uses **stream copy** (`-c:v copy`) when possible, so **H.265 on the wire is stored as H.265 in MP4**. Desktop players that support HEVC will play these files; others may need transcoding outside Opus.

## Live view (browser)

Many browsers **do not** support HEVC inside **MSE** (`mode=mse` in `stream.html`). Firefox often shows errors like “No video with supported format or MIME type found.”

**Mitigations:**

1. **WebRTC mode** — The single-camera page (`/camera/...`) uses `playbackMode="webrtc"`, which can negotiate codecs differently than MSE. If the stream still fails, use (2) or (3).

2. **Substream H.264** — Configure the camera or NVR so the **sub stream** is H.264; the dashboard uses the sub stream for `*-main` tiles.

3. **Transcode in go2rtc** — Point the stream at an FFmpeg pipeline that outputs H.264. See the [go2rtc documentation](https://github.com/AlexxIT/go2rtc) for `ffmpeg:` sources and hardware acceleration.

Example idea (adjust for your RTSP URL and hardware):

```yaml
streams:
  mycam:
    - ffmpeg:rtsp://user:pass@192.168.1.50/stream#video=h264#hardware
```

Validate with the go2rtc UI and your GPU/driver before enabling in production.
