# H.265 / HEVC with go2rtc and Opus

## Recordings (FFmpeg)

Segment recording uses **stream copy** (`-c:v copy`) when possible, so **H.265 on the wire is stored as H.265 in MP4**. Desktop players that support HEVC will play these files; others may need transcoding outside Opus.

## Live view (browser)

Many browsers **do not** support HEVC inside **MSE** (`mode=mse` in `stream.html`). Firefox often shows errors like “No video with supported format or MIME type found.”

### “codecs not matched: video:H265 => …” (WebRTC)

go2rtc may log or show something like:

`webrtc/offer: streams: codecs not matched: video:H265 => video:VP8, video:VP9, video:H264, video:AV1, …`

**Meaning:** The RTSP stream is **H.265 (HEVC)**. **WebRTC** in the browser only negotiates certain codecs (typically **H.264**, **VP8**, **VP9**, **AV1** — not H.265 in this path). go2rtc cannot map the camera’s H.265 track to what the browser offers, so setup fails.

**What to do:** Use a stream that is **H.264** for live view (often the camera **sub stream**), or configure go2rtc **FFmpeg** transcoding to H.264. Opus may show a warning on the single-camera page when go2rtc reports HEVC on the live preview stream.

### WebRTC and reverse proxies

`mode=webrtc` in go2rtc’s player negotiates UDP/WebRTC to the go2rtc host. Behind **Docker + nginx**, the browser often cannot reach those ICE candidates, which produces **“WebRTC: ICE failed”** in devtools. Fixing that usually means **reachable ICE candidates** (see **Configuration → Streaming** in Opus), **STUN/TURN**, or **host networking** for go2rtc. See [docs/remote-viewing.md](../docs/remote-viewing.md) for remote access and ICE.

**How Opus uses this:**

- **Single-camera page** (`/camera/...`): On **desktop / fine pointer** viewports, the UI requests **`mode=webrtc`** for lower latency. On **touch or narrow** viewports it uses the same **auto** path as the dashboard (**HLS** on small screens, **MSE** iframe elsewhere) for reliability and to avoid runaway HLS retries on some Safari builds.
- **Dashboard tiles**: **MSE** (desktop) or **HLS** (mobile/narrow) via `playbackMode="auto"` — not WebRTC — so many simultaneous tiles are less likely to overwhelm ICE.

**Mitigations:**

1. **ICE candidates** — Set **stun:** / **turn:** lines under **Configuration → Streaming** (saved into `go2rtc.yaml`); restart the **go2rtc** container. Example public STUN: `stun:stun.l.google.com:19302`.

2. **Substream H.264** — Configure the camera or NVR so the **sub stream** is H.264; the dashboard uses the sub stream for `*-main` tiles.

3. **Transcode in go2rtc** — Point the stream at an FFmpeg pipeline that outputs H.264. See the [go2rtc documentation](https://github.com/AlexxIT/go2rtc) for `ffmpeg:` sources and hardware acceleration.

Example idea (adjust for your RTSP URL and hardware):

```yaml
streams:
  mycam:
    - ffmpeg:rtsp://user:pass@192.168.1.50/stream#video=h264#hardware
```

Validate with the go2rtc UI and your GPU/driver before enabling in production.
