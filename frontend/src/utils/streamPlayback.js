/** Match LivePlayer “auto” device heuristic (touch / narrow → HLS). */
export function shouldPreferHlsForDevice() {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(pointer: coarse)").matches) return true;
  if (window.matchMedia("(max-width: 1024px)").matches) return true;
  return false;
}

/** go2rtc / browser: WebRTC cannot negotiate H.265 from the camera with typical browsers. */
export const HEVC_WEBRTC_WARNING_CODE = "HEVC_WEBRTC";

/**
 * Single-camera page: prefer WebRTC on desktop unless stats say HEVC (then MSE may work in some browsers).
 */
export function cameraPagePlaybackMode(streamStats) {
  if (shouldPreferHlsForDevice()) return "auto";
  const warns = streamStats?.live_view_warnings;
  if (
    Array.isArray(warns) &&
    warns.some((w) => w && w.code === HEVC_WEBRTC_WARNING_CODE)
  ) {
    return "mse";
  }
  return "webrtc";
}

/** User-facing copy when HLS/MSE fails and HEVC is a likely cause (short for overlays). */
export const PLAYBACK_FAIL_HEVC_HINT =
  "If this stream is H.265/HEVC, set the sub stream to H.264 or add FFmpeg transcoding in go2rtc.";
