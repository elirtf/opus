import { useMemo } from "react";

/**
 * LivePlayer
 * - `cameraName`: stream name in go2rtc (e.g. "FrontDoor-main")
 * - `enabled`: when false, player stays idle (used for lazy-loading in grids)
 *
 * Uses go2rtc `stream.html` in an iframe. Default `mse` + substream mirrors the dashboard and
 * avoids WebRTC ICE issues behind nginx/Docker. For HEVC in MSE, transcode in go2rtc
 * (go2rtc/README-HEVC.md); `playbackMode="webrtc"` needs reachable ICE candidates or TURN.
 */
export default function LivePlayer({
  cameraName,
  enabled = true,
  className = "",
  /** Use -sub for *-main in grids (lower bitrate). */
  preferSubStream = true,
  /** `mse` for tiles; `webrtc` often better for HEVC / dedicated camera page. */
  playbackMode = "mse",
}) {
  const src = useMemo(() => {
    if (!cameraName || !enabled) return null;
    const streamKey =
      preferSubStream && cameraName.endsWith("-main")
        ? cameraName.replace(/-main$/, "-sub")
        : cameraName;
    const mode = playbackMode === "webrtc" ? "webrtc" : "mse";
    return `/go2rtc/stream.html?src=${encodeURIComponent(streamKey)}&mode=${encodeURIComponent(mode)}`;
  }, [cameraName, enabled, preferSubStream, playbackMode]);

  return (
    <div className={`relative w-full h-full bg-black ${className}`}>
      {src ? (
        <iframe
          src={src}
          title={cameraName}
          className="w-full h-full"
          frameBorder="0"
          allow="autoplay; fullscreen"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">
          Loading...
        </div>
      )}
    </div>
  );
}