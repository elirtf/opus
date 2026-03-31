import { useMemo, useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { withOrigin } from "../../api/client";

/**
 * Prefer HLS when:
 *  - Touch/tablet device (Safari plays native HLS; hls.js uses MSE elsewhere)
 *  - Safari on any platform — Safari's MSE path frequently produces green/corrupt
 *    frames for common H.264 profiles and H.265 streams. Native HLS is rock-solid.
 *  - Narrow viewport (< 1024px)
 */
const isSafari = (() => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /^((?!chrome|android).)*safari/i.test(ua);
})();

export function shouldPreferHlsForDevice() {
  if (typeof window === "undefined") return false;
  if (isSafari) return true;
  if (window.matchMedia("(pointer: coarse)").matches) return true;
  if (window.matchMedia("(max-width: 1024px)").matches) return true;
  return false;
}

function resolveMode(playbackMode) {
  if (playbackMode === "auto") {
    return shouldPreferHlsForDevice() ? "hls" : "mse";
  }
  return playbackMode;
}

/**
 * LivePlayer
 * - `cameraName`: stream name in go2rtc (e.g. "FrontDoor-main")
 * - `enabled`: when false, player stays idle (used for lazy-loading in grids)
 * - `nativeVideoControls`: HLS path only — false hides Safari/Chrome’s big play + timeline on small tiles.
 *
 * Uses go2rtc `stream.html` in an iframe for mse/webrtc, or HLS (native video + hls.js).
 * HLS URL: `/go2rtc/api/stream.m3u8?src=...` (proxied like stream.html).
 */
export default function LivePlayer({
  cameraName,
  /** Optional go2rtc stream key from API (`live_view_stream_name`); overrides name/sub heuristic. */
  streamName: streamNameProp,
  enabled = true,
  className = "",
  /** Use -sub for *-main when `streamName` is not provided (lower bitrate). */
  preferSubStream = true,
  /** `auto` picks HLS on coarse pointer / narrow viewports; `mse` for tiles on desktop. */
  playbackMode = "auto",
  /** Show browser default &lt;video&gt; controls (timeline, play). Prefer false on dashboard tiles. */
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

  return (
    <div className={`relative w-full h-full bg-black ${className}`}>
      {mode === "hls" && hlsUrl ? (
        <HlsVideo
          src={hlsUrl}
          cameraName={cameraName}
          nativeControls={nativeVideoControls}
        />
      ) : iframeSrc ? (
        <iframe
          src={iframeSrc}
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

function HlsVideo({ src, cameraName, nativeControls = true }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    setErr(null);
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

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
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
        if (data.fatal) {
          setErr(data.type === "networkError" ? "Network error" : "Playback error");
        }
      });
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (cancelled) return;
        video.play().catch(() => {});
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      video.addEventListener(
        "loadedmetadata",
        () => {
          if (cancelled) return;
          video.play().catch(() => {});
        },
        { once: true },
      );
    } else {
      setErr("HLS not supported in this browser");
    }

    return () => {
      cancelled = true;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.removeAttribute("src");
      video.load();
    };
  }, [src, nativeControls]);

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
