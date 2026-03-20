import { useMemo } from "react";

/**
 * LivePlayer
 * - `cameraName`: stream name in go2rtc (e.g. "FrontDoor-main")
 * - `enabled`: when false, player stays idle (used for lazy-loading in grids)
 *
 * This version uses go2rtc's built-in `stream.html` player inside an iframe.
 * go2rtc handles WebRTC/MSE/HLS negotiation and reconnection logic.
 */
export default function LivePlayer({
  cameraName,
  enabled = true,
  className = "",
  /** Use -sub stream for *-main keys so fullscreen/single view matches the dashboard grid (often more browser-friendly). */
  preferSubStream = true,
}) {
  const src = useMemo(() => {
    if (!cameraName || !enabled) return null;
    const streamKey =
      preferSubStream && cameraName.endsWith("-main")
        ? cameraName.replace(/-main$/, "-sub")
        : cameraName;
    return `/go2rtc/stream.html?src=${encodeURIComponent(streamKey)}&mode=mse`;
  }, [cameraName, enabled, preferSubStream]);

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