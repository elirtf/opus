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
} from "../../utils/streamPlayback";

export { isFirefox, shouldPreferHlsForDevice } from "../../utils/streamPlayback";

/**
 * Live playback strategy: keep go2rtc’s `stream.html` inside an iframe (MSE/WebRTC handled
 * by go2rtc) instead of embedding RTCPeerConnection/MediaSource in React — fewer deps and
 * faster iteration. We add load-timeout + retry UX around the iframe; a future native
 * player could swap in here without changing dashboard/camera call sites.
 *
 * Prefer HLS on touch / narrow viewports and on Firefox (go2rtc MSE iframe is unreliable
 * there for many streams). Safari desktop stays on MSE iframe — Safari's MSE works fine
 * for H.264 and avoids the go2rtc HLS endpoint which creates one server-side FFmpeg
 * process per consumer. Forcing all Safari to HLS caused runaway process creation when
 * segments failed and the native HLS player retried aggressively.
 */
function resolveMode(playbackMode) {
  if (playbackMode === "auto") {
    return shouldPreferHlsForDevice() ? "hls" : "mse";
  }
  return playbackMode;
}

const MAX_HLS_RETRIES = 2;
const RETRY_DELAY_MS = 3000;
/** go2rtc stream.html can hang on ICE/MSE errors without surfacing to the parent; treat long non-load as failure. */
const IFRAME_LOAD_TIMEOUT_MS = 30000;

/**
 * LivePlayer
 * - Uses go2rtc `stream.html` iframe for MSE/WebRTC (desktop).
 * - Falls back to HLS (<video> + hls.js / native) on touch/narrow devices.
 * - `nativeVideoControls` (HLS path only): false hides browser play/timeline chrome.
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
  const mode = resolveMode(playbackMode);
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

  const gatedOff =
    Boolean(cameraName) && !enabled;

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
        />
      ) : iframeSrc ? (
        <Go2rtcIframe
          src={iframeSrc}
          title={cameraName || "Live"}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">
          Loading...
        </div>
      )}
    </div>
  );
}

function Go2rtcIframe({ src, title }) {
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const [nonce, setNonce] = useState(0);
  const timerRef = useRef(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    setLoadTimedOut(false);
    clearTimer();
    timerRef.current = setTimeout(() => {
      setLoadTimedOut(true);
      timerRef.current = null;
    }, IFRAME_LOAD_TIMEOUT_MS);
    return () => clearTimer();
  }, [src, nonce, clearTimer]);

  const handleLoad = useCallback(() => {
    setLoadTimedOut(false);
    clearTimer();
  }, [clearTimer]);

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
            → Streaming). {PLAYBACK_FAIL_HEVC_HINT}
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

function HlsVideo({ src, cameraName, nativeControls = true }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const retryCount = useRef(0);
  const retryTimer = useRef(null);
  const [err, setErr] = useState(null);

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

    function startHlsJs() {
      cleanup();
      if (cancelled) return;

      const hls = new Hls({
        // Firefox: MSE + worker has caused hard-to-reproduce stalls; main thread demux is safer.
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
          setErr(`Stream unavailable. ${PLAYBACK_FAIL_HEVC_HINT}`);
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
          setErr(`Stream unavailable. ${PLAYBACK_FAIL_HEVC_HINT}`);
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
    }

    return () => {
      cancelled = true;
      cleanup();
      video.removeAttribute("src");
      video.load();
    };
  }, [src, nativeControls, cleanup]);

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
