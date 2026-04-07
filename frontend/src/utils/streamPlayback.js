/**
 * True when the browser is Mozilla Firefox (desktop or mobile).
 * Used to pick playback paths that work reliably with go2rtc + Opus.
 */
export function isFirefox() {
  if (typeof navigator === "undefined") return false;
  return /Firefox\//.test(navigator.userAgent || "");
}

/**
 * Prefer HLS over go2rtc’s MSE iframe when:
 * - touch or narrow viewport, or
 * - Firefox: go2rtc `stream.html` + MSE is often flaky (codec/MSE); HLS via hls.js matches
 *   fMP4 segments more predictably (same trade-off as Safari vs HLS server load).
 */
export function shouldPreferHlsForDevice() {
  if (typeof window === "undefined") return false;
  const override = getPlaybackModeOverride();
  if (override === "hls") return true;
  if (override === "mse" || override === "webrtc") return false;
  if (isFirefox()) return true;
  if (window.matchMedia("(pointer: coarse)").matches) return true;
  return false;
}

/** go2rtc / browser: WebRTC cannot negotiate H.265 from the camera with typical browsers. */
export const HEVC_WEBRTC_WARNING_CODE = "HEVC_WEBRTC";

/**
 * Single-camera page: prefer WebRTC on Chromium/Safari desktop unless stats say HEVC (then MSE).
 * Firefox always uses `auto` → HLS for compatibility (see shouldPreferHlsForDevice).
 */
export function cameraPagePlaybackMode(streamStats) {
  const override = getPlaybackModeOverride();
  if (override && override !== "auto") return override;
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
    `[playback:${tag}] ${record.camera} mode=${record.mode} ttff=${record.ttffMs ?? "—"}ms` +
      (record.fallbackReason ? ` reason=${record.fallbackReason}` : "")
  );
}

/** Read the in-memory playback metrics log (current session only). */
export function getPlaybackMetrics() {
  return [..._metricsLog];
}
