# Mainstream vs Substream

This matches typical NVR/DVR behavior and how streams are wired in Opus.

## Definitions

**Mainstream (main stream)**  
The **primary** video feed: highest quality. This is what a DVR/NVR uses when saving footage to its **internal HDD**. Mainstream settings (resolution, bitrate, codec) control **recording file size** and how long you can retain video on disk.

**Substream**  
The **secondary** feed: lower quality and usually lower bitrate. It is meant for **live or remote viewing** on PCs, phones, or tablets so you do not waste bandwidth on full main-stream quality when a smaller picture is enough.

## Application


| Role                                                   | Stream used                                                                                                                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Continuous segment recording** (FFmpeg rolling MP4s) | **Main** — `rtsp_url` on each `*-main` camera row; same path as a traditional NVR HDD recording.                                                                                                       |
| **Motion sampling** (processor, OpenCV)                | **Sub when available** (default `MOTION_RTSP_MODE=auto`) — paired `…-sub` row, or `rtsp_substream_url`, or go2rtc `…-sub`. Lower decode cost; set `MOTION_RTSP_MODE=main` to force full-res detection. |
| **Event clips** (FFmpeg after motion)                  | **Main** — same quality as HDD recording (`-c:v copy`).                                                                                                                                              |
| **Live view** (dashboard, camera page, sidebar)        | **Sub** when available — paired `…-sub` camera row, or `rtsp_substream_url` on the main row registered in go2rtc as the `…-sub` name (Devices in the app). Otherwise **main** so playback still works. |


Clips from **Events (motion)** mode are stored under `RECORDINGS_DIR/clips/<camera_name>/`. **Storage** statistics include both segment files and these clip files.

