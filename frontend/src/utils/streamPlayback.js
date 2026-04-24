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
 * and adaptive bitrate helps. Desktop defaults to MSE (lower latency, avoids
 * the per-consumer server-side FFmpeg that go2rtc HLS spins up).
 */
export function shouldPreferHlsForDevice() {
  if (typeof window === "undefined") return false;
  const override = getPlaybackModeOverride();
  if (override === "hls") return true;
  if (override === "mse") return false;
  if (window.matchMedia("(pointer: coarse)").matches) return true;
  return false;
}

/** HEVC decode support varies by browser (Firefox: no, Chrome: needs hw, Safari/Edge: yes). */
export const HEVC_LIVE_WARNING_CODE = "HEVC_LIVE";

/**
 * Single-camera page playback mode. Defaults to MSE on desktop (lower latency,
 * no server-side FFmpeg). Falls back to "auto" on touch (-> HLS). Users can
 * override via localStorage.
 */
export function cameraPagePlaybackMode(streamStats) {
  const override = getPlaybackModeOverride();
  if (override && override !== "auto") return override;
  if (shouldPreferHlsForDevice()) return "auto";
  return "mse";
}

const PLAYBACK_MODE_KEY = "opus_live_playback_mode";
const PLAYBACK_MODES = new Set(["auto", "hls", "mse"]);

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
 * @param {{ camera: string, mode: string, success: boolean, ttffMs?: number, fallbackReason?: string, milestone?: string }} entry
 * `milestone: "embed_dom_ready"` — iframe document loaded; not time-to-first-frame (see go2rtc embed).
 */
export function recordPlaybackMetric(entry) {
  const record = { ...entry, ts: Date.now() };
  _metricsLog.push(record);
  if (_metricsLog.length > _MAX_METRICS) {
    _metricsLog.splice(0, _metricsLog.length - _MAX_METRICS);
  }
  const tag =
    record.milestone === "embed_dom_ready"
      ? "embed"
      : record.success
        ? "ok"
        : "fail";
  const timingLabel = record.milestone === "embed_dom_ready" ? "embed-ready-ms" : "ttff-ms";
  console.debug(
    `[playback:${tag}] ${record.camera} mode=${record.mode} ${timingLabel}=${record.ttffMs ?? "\u2014"}` +
      (record.fallbackReason ? ` reason=${record.fallbackReason}` : "") +
      (record.milestone ? ` milestone=${record.milestone}` : "")
  );
}

/** Read the in-memory playback metrics log (current session only). */
export function getPlaybackMetrics() {
  return [..._metricsLog];
}
