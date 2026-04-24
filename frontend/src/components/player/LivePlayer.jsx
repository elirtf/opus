import {
  useMemo,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import Hls from "hls.js";
import { withOrigin } from "../../api/client";
import { camerasApi } from "../../api/cameras";
import {
  isFirefox,
  PLAYBACK_FAIL_HEVC_HINT,
  shouldPreferHlsForDevice,
  recordPlaybackMetric,
} from "../../utils/streamPlayback";

export { isFirefox, shouldPreferHlsForDevice } from "../../utils/streamPlayback";

/** Ordered go2rtc keys to try: preferred (often *-sub), then *-main when different. */
function buildLiveStreamKeyChain(cameraName, streamNameProp, preferSubStream, enabled) {
  if (!cameraName || !enabled) return [];
  const mainName = cameraName.endsWith("-main") ? cameraName : null;
  const derivedSub =
    preferSubStream && mainName ? mainName.replace(/-main$/, "-sub") : null;
  const trimmedProp =
    streamNameProp && String(streamNameProp).trim()
      ? String(streamNameProp).trim()
      : null;
  const preferred = trimmedProp || derivedSub || cameraName;
  const keys = [];
  if (preferred) keys.push(preferred);
  if (mainName && preferred !== mainName) keys.push(mainName);
  return [...new Set(keys)];
}

/**
 * Live playback strategy: go2rtc `stream.html` iframe for MSE, with hls.js
 * fallback. Auto mode defaults to MSE on desktop and HLS on touch viewports.
 * A fallback chain (mse -> hls) ensures the user sees video even
 * when the first mode fails.
 */
function resolveMode(playbackMode) {
  if (playbackMode === "auto") {
    if (shouldPreferHlsForDevice()) return "hls";
    return "mse";
  }
  return playbackMode;
}

const FALLBACK_CHAINS = {
  mse: ["mse", "hls"],
  hls: ["hls", "mse"],
};

/** Extra HLS rebuild attempts after a fatal error (each path retries up to this many rebuilds). */
const MAX_HLS_RETRIES_FULL = 2;
const MAX_HLS_RETRIES_TILE = 2;
const RETRY_DELAY_MS = 3000;
const RETRY_BACKOFF_CAP_MS = 8000;
const IFRAME_LOAD_TIMEOUT_MS = 20000;

const PRODUCER_POLL_MS = 2000;
const PRODUCER_WAIT_MAX_MS = 60000;

/**
 * LivePlayer
 * - Uses go2rtc `stream.html` iframe for MSE (desktop).
 * - Falls back to HLS (<video> + hls.js / native) on touch devices.
 * - Automatic fallback chain when a mode fails (mse -> hls).
 * @param {boolean} [compactLiveTile] — Gentler HLS buffering for dashboard tiles.
 * @param {boolean} [pollForProducer] — Wait for camera stats `online` before starting (single-camera page).
 */
export default function LivePlayer({
  cameraName,
  streamName: streamNameProp,
  enabled = true,
  className = "",
  preferSubStream = true,
  playbackMode = "auto",
  nativeVideoControls = true,
  compactLiveTile = false,
  pollForProducer = false,
}) {
  const resolvedMode = resolveMode(playbackMode);
  const [modeFailuresByStreamKey, setModeFailuresByStreamKey] = useState({});
  const [producerReady, setProducerReady] = useState(!pollForProducer);

  const streamKeys = useMemo(
    () => buildLiveStreamKeyChain(cameraName, streamNameProp, preferSubStream, enabled),
    [cameraName, streamNameProp, preferSubStream, enabled],
  );

  const keyIndexRef = useRef(0);
  const [keyIndex, setKeyIndex] = useState(0);

  useEffect(() => {
    keyIndexRef.current = 0;
    setKeyIndex(0);
    setModeFailuresByStreamKey({});
  }, [cameraName, streamNameProp, playbackMode, streamKeys.join("|")]);

  useEffect(() => {
    if (!pollForProducer || !enabled || !cameraName) {
      setProducerReady(true);
      return undefined;
    }

    setProducerReady(false);
    let cancelled = false;
    const started = Date.now();

    async function probe() {
      try {
        const st = await camerasApi.stats(cameraName);
        if (cancelled) return;
        if (st && st.online === true) {
          setProducerReady(true);
          return true;
        }
      } catch {
        /* ignore until timeout */
      }
      if (cancelled) return false;
      if (Date.now() - started >= PRODUCER_WAIT_MAX_MS) {
        setProducerReady(true);
        return true;
      }
      return false;
    }

    let intervalId;
    (async function run() {
      const ok = await probe();
      if (cancelled || ok) return;
      intervalId = setInterval(async () => {
        const done = await probe();
        if (done && intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
      }, PRODUCER_POLL_MS);
    })();

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [pollForProducer, enabled, cameraName]);

  const tryAdvanceStreamKey = useCallback(() => {
    const max = streamKeys.length;
    if (max <= 0) return false;
    const k = keyIndexRef.current;
    if (k < max - 1) {
      const next = k + 1;
      keyIndexRef.current = next;
      setKeyIndex(next);
      return true;
    }
    return false;
  }, [streamKeys]);

  const streamKey = streamKeys[keyIndex] ?? null;

  const chain = useMemo(
    () => FALLBACK_CHAINS[resolvedMode] || [resolvedMode],
    [resolvedMode],
  );

  const mode = useMemo(() => {
    if (!streamKey) return null;
    const failedSet = new Set(modeFailuresByStreamKey[streamKey] || []);
    return chain.find((m) => !failedSet.has(m)) ?? null;
  }, [chain, streamKey, modeFailuresByStreamKey]);

  const chainExhausted = useMemo(() => {
    if (!streamKey) return false;
    const failedSet = new Set(modeFailuresByStreamKey[streamKey] || []);
    return chain.length > 0 && chain.every((m) => failedSet.has(m));
  }, [chain, streamKey, modeFailuresByStreamKey]);

  const handleModeFailed = useCallback((failedMode) => {
    const sk = streamKeys[keyIndexRef.current];
    if (!sk) return;
    setModeFailuresByStreamKey((prev) => {
      const cur = new Set(prev[sk] || []);
      if (cur.has(failedMode)) return prev;
      cur.add(failedMode);
      return { ...prev, [sk]: [...cur] };
    });
  }, [streamKeys]);

  const resetPlayback = useCallback(() => {
    keyIndexRef.current = 0;
    setKeyIndex(0);
    setModeFailuresByStreamKey({});
  }, []);

  const onIframeTimeout = useCallback(
    (failedMode) => {
      if (tryAdvanceStreamKey()) return;
      handleModeFailed(failedMode || "mse");
    },
    [handleModeFailed, tryAdvanceStreamKey],
  );

  const onHlsFailed = useCallback(() => {
    if (tryAdvanceStreamKey()) return;
    handleModeFailed("hls");
  }, [handleModeFailed, tryAdvanceStreamKey]);

  const iframeSrc = useMemo(() => {
    if (!streamKey || mode === "hls") return null;
    const path = `/go2rtc/stream.html?src=${encodeURIComponent(streamKey)}&mode=mse`;
    return withOrigin(path);
  }, [streamKey, mode]);

  const hlsUrl = useMemo(() => {
    if (!streamKey || mode !== "hls") return null;
    const path = `/go2rtc/api/stream.m3u8?src=${encodeURIComponent(streamKey)}`;
    return withOrigin(path);
  }, [streamKey, mode]);

  const gatedOff = Boolean(cameraName) && !enabled;
  const waitingProducer = enabled && pollForProducer && !producerReady;

  if (!streamKey) {
    if (gatedOff) {
      return (
        <div
          className={`relative w-full h-full bg-black ${className}`}
          aria-label="Live view paused"
        />
      );
    }
    return (
      <div
        className={`relative w-full h-full bg-black flex items-center justify-center text-gray-500 text-sm ${className}`}
      >
        Loading...
      </div>
    );
  }

  if (waitingProducer) {
    return (
      <div
        className={`relative w-full h-full bg-black flex flex-col items-center justify-center text-gray-400 text-sm gap-2 px-4 text-center ${className}`}
      >
        <p>Connecting to camera feed…</p>
        <p className="text-gray-600 text-xs max-w-xs">
          Waiting until the stream server reports this camera online (or timeout), then starting live view.
        </p>
      </div>
    );
  }

  if (chainExhausted) {
    return (
      <div
        className={`relative w-full h-full bg-black flex flex-col items-center justify-center gap-4 text-center px-4 text-amber-100 text-xs ${className}`}
      >
        <p className="text-gray-200 text-sm max-w-sm">
          Live view could not start in either embedded mode or HTTP live streaming mode for this stream.
        </p>
        <p className="text-gray-500 max-w-sm">{PLAYBACK_FAIL_HEVC_HINT}</p>
        <button
          type="button"
          onClick={resetPlayback}
          className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm"
        >
          Retry live view
        </button>
      </div>
    );
  }

  return (
    <div className={`relative w-full h-full bg-black ${className}`}>
      {mode === "hls" && hlsUrl ? (
        <HlsVideo
          src={hlsUrl}
          cameraName={cameraName}
          nativeControls={nativeVideoControls}
          isFallback={mode !== resolvedMode}
          compactLiveTile={compactLiveTile}
          maxHlsRetries={compactLiveTile ? MAX_HLS_RETRIES_TILE : MAX_HLS_RETRIES_FULL}
          onFailed={onHlsFailed}
        />
      ) : iframeSrc ? (
        <Go2rtcIframe
          key={`${streamKey}-${keyIndex}`}
          src={iframeSrc}
          title={cameraName || "Live"}
          cameraName={cameraName}
          currentMode={mode}
          streamKey={streamKey}
          onTimeout={onIframeTimeout}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">
          Loading...
        </div>
      )}
    </div>
  );
}

function Go2rtcIframe({ src, title, cameraName, currentMode, streamKey, onTimeout }) {
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const [nonce, setNonce] = useState(0);
  const timerRef = useRef(null);
  const mountedAt = useRef(Date.now());
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;
  const currentModeRef = useRef(currentMode);
  currentModeRef.current = currentMode;

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedAt.current = Date.now();
    setLoadTimedOut(false);
    clearTimer();
    timerRef.current = setTimeout(() => {
      setLoadTimedOut(true);
      timerRef.current = null;
      recordPlaybackMetric({
        camera: cameraName || title,
        mode: currentMode || "iframe",
        success: false,
        ttffMs: Date.now() - mountedAt.current,
        fallbackReason: "iframe_timeout",
        streamKey: streamKey || "",
      });
      onTimeoutRef.current?.(currentModeRef.current || "mse");
    }, IFRAME_LOAD_TIMEOUT_MS);
    return () => clearTimer();
  }, [src, nonce, clearTimer, cameraName, title, currentMode, streamKey]);

  const handleLoad = useCallback(() => {
    setLoadTimedOut(false);
    clearTimer();
    recordPlaybackMetric({
      camera: cameraName || title,
      mode: currentMode || "iframe",
      success: false,
      ttffMs: Date.now() - mountedAt.current,
      milestone: "embed_dom_ready",
    });
  }, [clearTimer, cameraName, title, currentMode]);

  const handleRetry = useCallback(() => {
    setLoadTimedOut(false);
    setNonce((n) => n + 1);
  }, []);

  return (
    <>
      <iframe
        key={`${src}-${nonce}`}
        src={src}
        title={title}
        className="w-full h-full"
        frameBorder="0"
        allow="autoplay; fullscreen"
        onLoad={handleLoad}
      />
      {loadTimedOut && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/85 text-amber-100 text-xs px-4 text-center z-10">
          <p>Stream not responding (embedded player timed out).</p>
          <p className="text-gray-400 max-w-sm">
            {PLAYBACK_FAIL_HEVC_HINT}
          </p>
          <button
            type="button"
            onClick={handleRetry}
            className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm"
          >
            Retry
          </button>
        </div>
      )}
    </>
  );
}

function HlsVideo({
  src,
  cameraName,
  nativeControls = true,
  isFallback = false,
  compactLiveTile = false,
  maxHlsRetries = MAX_HLS_RETRIES_FULL,
  onFailed,
}) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const retryCount = useRef(0);
  const retryTimer = useRef(null);
  const [err, setErr] = useState(null);
  const mountedAt = useRef(Date.now());
  const ttffRecorded = useRef(false);
  const onFailedRef = useRef(onFailed);
  onFailedRef.current = onFailed;

  const cleanup = useCallback(() => {
    clearTimeout(retryTimer.current);
    retryTimer.current = null;
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    setErr(null);
    retryCount.current = 0;
    mountedAt.current = Date.now();
    ttffRecorded.current = false;
    video.controls = nativeControls;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    try {
      video.disablePictureInPicture = !nativeControls;
    } catch {
      /* ignore */
    }
    video.muted = true;

    let cancelled = false;

    function onFirstPlay() {
      if (ttffRecorded.current || cancelled) return;
      ttffRecorded.current = true;
      recordPlaybackMetric({
        camera: cameraName,
        mode: isFallback ? "hls(fallback)" : "hls",
        success: true,
        ttffMs: Date.now() - mountedAt.current,
      });
    }
    video.addEventListener("playing", onFirstPlay);

    function hlsFailed(reason) {
      setErr(`Stream unavailable. ${PLAYBACK_FAIL_HEVC_HINT}`);
      recordPlaybackMetric({
        camera: cameraName,
        mode: isFallback ? "hls(fallback)" : "hls",
        success: false,
        ttffMs: Date.now() - mountedAt.current,
        fallbackReason: reason,
      });
      onFailedRef.current?.();
    }

    const hlsLiveConfig = compactLiveTile
      ? {
          enableWorker: !isFirefox(),
          lowLatencyMode: false,
          liveSyncDurationCount: 2,
          liveMaxLatencyDurationCount: 6,
          maxBufferLength: 8,
          maxMaxBufferLength: 16,
          backBufferLength: 3,
        }
      : {
          enableWorker: !isFirefox(),
          lowLatencyMode: true,
          liveSyncDurationCount: 1,
          liveMaxLatencyDurationCount: 3,
          maxBufferLength: 4,
          maxMaxBufferLength: 8,
          backBufferLength: 0,
        };

    function startHlsJs() {
      cleanup();
      if (cancelled) return;

      const hls = new Hls(hlsLiveConfig);
      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(video);

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (cancelled) return;
        if (!data.fatal) return;

        hls.destroy();
        hlsRef.current = null;

        if (retryCount.current < maxHlsRetries) {
          retryCount.current++;
          const delay = Math.min(
            RETRY_DELAY_MS * retryCount.current,
            RETRY_BACKOFF_CAP_MS,
          );
          retryTimer.current = setTimeout(() => {
            if (!cancelled) startHlsJs();
          }, delay);
        } else {
          hlsFailed("hls_fatal_error");
        }
      });

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (cancelled) return;
        retryCount.current = 0;
        video.play().catch(() => {});
      });
    }

    function startNativeHls() {
      if (cancelled) return;
      video.src = src;

      const onError = () => {
        if (cancelled) return;
        video.removeAttribute("src");
        video.load();

        if (retryCount.current < maxHlsRetries) {
          retryCount.current++;
          const delay = Math.min(
            RETRY_DELAY_MS * retryCount.current,
            RETRY_BACKOFF_CAP_MS,
          );
          retryTimer.current = setTimeout(() => {
            if (!cancelled) startNativeHls();
          }, delay);
        } else {
          hlsFailed("native_hls_error");
        }
      };

      video.addEventListener("error", onError, { once: true });
      video.addEventListener(
        "loadedmetadata",
        () => {
          if (cancelled) return;
          video.removeEventListener("error", onError);
          retryCount.current = 0;
          video.play().catch(() => {});
        },
        { once: true },
      );
    }

    const hlsSupported = Hls.isSupported();
    const nativeM3u8 = !!video.canPlayType("application/vnd.apple.mpegurl");
    if (hlsSupported) {
      startHlsJs();
    } else if (nativeM3u8) {
      startNativeHls();
    } else {
      setErr("HLS not supported in this browser");
      onFailedRef.current?.();
    }

    return () => {
      cancelled = true;
      video.removeEventListener("playing", onFirstPlay);
      cleanup();
      video.removeAttribute("src");
      video.load();
    };
  }, [src, nativeControls, cleanup, cameraName, isFallback, compactLiveTile, maxHlsRetries]);

  return (
    <>
      <video
        ref={videoRef}
        className={`w-full h-full object-contain ${!nativeControls ? "live-tile-video" : ""}`}
        title={cameraName}
        playsInline
        muted
      />
      {err && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-amber-200 text-xs px-4 text-center">
          {err}
        </div>
      )}
    </>
  );
}
