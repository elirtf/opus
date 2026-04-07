/**
 * True when the browser is Mozilla Firefox (desktop or mobile).
 * Used to pick playback paths that work reliably with go2rtc + Opus.
 */
export function isFirefox() {
  if (typeof navigator === "undefined") return false;
  return /Firefox\//.test(navigator.userAgent || "");
}

/**
 * Prefer HLS on touch / narrow viewports where decode pressure is higher
 * and adaptive bitrate helps.  Desktop browsers (including Firefox) now
 * default to MSE which is more reliable than WebRTC (no ICE required) and
 * avoids the server-side FFmpeg that go2rtc HLS spins up per consumer.
 */
export function shouldPreferHlsForDevice() {
  if (typeof window === "undefined") return false;
  const override = getPlaybackModeOverride();
  if (override === "hls") return true;
  if (override === "mse" || override === "webrtc") return false;
  if (window.matchMedia("(pointer: coarse)").matches) return true;
  return false;
}

/** go2rtc / browser: WebRTC cannot negotiate H.265 from the camera with typical browsers. */
export const HEVC_WEBRTC_WARNING_CODE = "HEVC_WEBRTC";

/**
 * Single-camera page playback mode.  Defaults to MSE on desktop (most
 * reliable -- no ICE setup, no server-side FFmpeg).  Falls back to "auto"
 * on touch devices (-> HLS).  Users can override via localStorage.
 */
export function cameraPagePlaybackMode(streamStats) {
  const override = getPlaybackModeOverride();
  if (override && override !== "auto") return override;
  if (shouldPreferHlsForDevice()) return "auto";
  return "mse";
}

const PLAYBACK_MODE_KEY = "opus_live_playback_mode";
const PLAYBACK_MODES = new Set(["auto", "hls", "mse", "webrtc"]);

export function getPlaybackModeOverride() {
  if (typeof localStorage === "undefined") return "auto";
  const raw = (localStorage.getItem(PLAYBACK_MODE_KEY) || "auto").trim().toLowerCase();
  return PLAYBACK_MODES.has(raw) ? raw : "auto";
}

export function setPlaybackModeOverride(mode) {
  const v = PLAYBACK_MODES.has(mode) ? mode : "auto";
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(PLAYBACK_MODE_KEY, v);
  }
  return v;
}

/** User-facing copy when HLS/MSE fails and HEVC is a likely cause (short for overlays). */
export const PLAYBACK_FAIL_HEVC_HINT =
  "If this stream is H.265/HEVC, set the sub stream to H.264 or add FFmpeg transcoding in go2rtc.";

// ── Playback startup metrics ─────────────────────────────────────────────────
// Bounded in-memory log of startup events (TTFF, failures, fallbacks).
// Readable via getPlaybackMetrics() for debugging or future API export.

const _metricsLog = [];
const _MAX_METRICS = 200;

/**
 * Record a playback startup event (success or failure).
 * @param {{ camera: string, mode: string, success: boolean, ttffMs?: number, fallbackReason?: string }} entry
 */
export function recordPlaybackMetric(entry) {
  const record = { ...entry, ts: Date.now() };
  _metricsLog.push(record);
  if (_metricsLog.length > _MAX_METRICS) {
    _metricsLog.splice(0, _metricsLog.length - _MAX_METRICS);
  }
  const tag = record.success ? "ok" : "fail";
  console.debug(
    `[playback:${tag}] ${record.camera} mode=${record.mode} ttff=${record.ttffMs ?? "\u2014"}ms` +
      (record.fallbackReason ? ` reason=${record.fallbackReason}` : "")
  );
}

/** Read the in-memory playback metrics log (current session only). */
export function getPlaybackMetrics() {
  return [..._metricsLog];
}
