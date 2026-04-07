import {
  useMemo,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import Hls from "hls.js";
import { withOrigin } from "../../api/client";
import {
  isFirefox,
  PLAYBACK_FAIL_HEVC_HINT,
  shouldPreferHlsForDevice,
  recordPlaybackMetric,
} from "../../utils/streamPlayback";

export { isFirefox, shouldPreferHlsForDevice } from "../../utils/streamPlayback";

/**
 * Live playback strategy: go2rtc `stream.html` iframe for MSE/WebRTC,
 * with hls.js fallback.  Auto mode now defaults to MSE on desktop
 * (no ICE setup needed, reliable across browsers) and HLS on
 * touch/narrow viewports.  A full fallback chain (e.g. mse -> hls,
 * or webrtc -> mse -> hls) ensures the user sees video even when
 * the first mode fails.
 */
function resolveMode(playbackMode) {
  if (playbackMode === "auto") {
    if (shouldPreferHlsForDevice()) return "hls";
    return "mse";
  }
  return playbackMode;
}

const FALLBACK_CHAINS = {
  webrtc: ["webrtc", "mse", "hls"],
  mse: ["mse", "hls"],
  hls: ["hls", "mse"],
};

const MAX_HLS_RETRIES = 1;
const RETRY_DELAY_MS = 3000;
const IFRAME_LOAD_TIMEOUT_MS = 20000;

/**
 * LivePlayer
 * - Uses go2rtc `stream.html` iframe for MSE/WebRTC (desktop).
 * - Falls back to HLS (<video> + hls.js / native) on touch/narrow devices.
 * - Automatic fallback chain when a mode fails (e.g. mse -> hls).
 */
export default function LivePlayer({
  cameraName,
  streamName: streamNameProp,
  enabled = true,
  className = "",
  preferSubStream = true,
  playbackMode = "auto",
  nativeVideoControls = true,
}) {
  const resolvedMode = resolveMode(playbackMode);
  const [failedModes, setFailedModes] = useState(new Set());

  useEffect(() => {
    setFailedModes(new Set());
  }, [cameraName, streamNameProp, playbackMode]);

  const mode = useMemo(() => {
    const chain = FALLBACK_CHAINS[resolvedMode] || [resolvedMode];
    return chain.find((m) => !failedModes.has(m)) || chain[chain.length - 1];
  }, [resolvedMode, failedModes]);

  const handleModeFailed = useCallback((failedMode) => {
    setFailedModes((prev) => {
      if (prev.has(failedMode)) return prev;
      const next = new Set(prev);
      next.add(failedMode);
      return next;
    });
  }, []);

  const streamKey = useMemo(() => {
    if (!cameraName || !enabled) return null;
    return (
      streamNameProp ||
      (preferSubStream && cameraName.endsWith("-main")
        ? cameraName.replace(/-main$/, "-sub")
        : cameraName)
    );
  }, [cameraName, streamNameProp, enabled, preferSubStream]);

  const iframeSrc = useMemo(() => {
    if (!streamKey || mode === "hls") return null;
    const m = mode === "webrtc" ? "webrtc" : "mse";
    const path = `/go2rtc/stream.html?src=${encodeURIComponent(streamKey)}&mode=${encodeURIComponent(m)}`;
    return withOrigin(path);
  }, [streamKey, mode]);

  const hlsUrl = useMemo(() => {
    if (!streamKey || mode !== "hls") return null;
    const path = `/go2rtc/api/stream.m3u8?src=${encodeURIComponent(streamKey)}`;
    return withOrigin(path);
  }, [streamKey, mode]);

  const gatedOff = Boolean(cameraName) && !enabled;

  if (!streamKey) {
    if (gatedOff) {
      return (
        <div
          className={`relative w-full h-full bg-black ${className}`}
          aria-hidden
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

  return (
    <div className={`relative w-full h-full bg-black ${className}`}>
      {mode === "hls" && hlsUrl ? (
        <HlsVideo
          src={hlsUrl}
          cameraName={cameraName}
          nativeControls={nativeVideoControls}
          isFallback={mode !== resolvedMode}
          onFailed={() => handleModeFailed("hls")}
        />
      ) : iframeSrc ? (
        <Go2rtcIframe
          src={iframeSrc}
          title={cameraName || "Live"}
          cameraName={cameraName}
          currentMode={mode}
          onTimeout={() => handleModeFailed(mode)}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">
          Loading...
        </div>
      )}
    </div>
  );
}

function Go2rtcIframe({ src, title, cameraName, currentMode, onTimeout }) {
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const [nonce, setNonce] = useState(0);
  const timerRef = useRef(null);
  const mountedAt = useRef(Date.now());

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
      });
      if (onTimeout) onTimeout();
    }, IFRAME_LOAD_TIMEOUT_MS);
    return () => clearTimer();
  }, [src, nonce, clearTimer, cameraName, title, currentMode, onTimeout]);

  const handleLoad = useCallback(() => {
    setLoadTimedOut(false);
    clearTimer();
    recordPlaybackMetric({
      camera: cameraName || title,
      mode: currentMode || "iframe",
      success: true,
      ttffMs: Date.now() - mountedAt.current,
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
            If you saw a go2rtc error like &quot;codecs not matched: video:H265&quot;, the
            camera is sending H.265 but the browser cannot negotiate that codec over WebRTC.
            Use an H.264 stream, or FFmpeg transcoding in go2rtc. Also check ICE (Configuration
            &rarr; Streaming). {PLAYBACK_FAIL_HEVC_HINT}
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

function HlsVideo({ src, cameraName, nativeControls = true, isFallback = false, onFailed }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const retryCount = useRef(0);
  const retryTimer = useRef(null);
  const [err, setErr] = useState(null);
  const mountedAt = useRef(Date.now());
  const ttffRecorded = useRef(false);

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
      if (onFailed) onFailed();
    }

    function startHlsJs() {
      cleanup();
      if (cancelled) return;

      const hls = new Hls({
        enableWorker: !isFirefox(),
        lowLatencyMode: true,
        liveSyncDurationCount: 1,
        liveMaxLatencyDurationCount: 3,
        maxBufferLength: 4,
        maxMaxBufferLength: 8,
        backBufferLength: 0,
      });
      hlsRef.current = hls;
      hls.loadSource(src);
      hls.attachMedia(video);

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (cancelled) return;
        if (!data.fatal) return;

        hls.destroy();
        hlsRef.current = null;

        if (retryCount.current < MAX_HLS_RETRIES) {
          retryCount.current++;
          retryTimer.current = setTimeout(() => {
            if (!cancelled) startHlsJs();
          }, RETRY_DELAY_MS);
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

        if (retryCount.current < MAX_HLS_RETRIES) {
          retryCount.current++;
          retryTimer.current = setTimeout(() => {
            if (!cancelled) startNativeHls();
          }, RETRY_DELAY_MS);
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
      if (onFailed) onFailed();
    }

    return () => {
      cancelled = true;
      video.removeEventListener("playing", onFirstPlay);
      cleanup();
      video.removeAttribute("src");
      video.load();
    };
  }, [src, nativeControls, cleanup, cameraName, isFallback, onFailed]);

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
