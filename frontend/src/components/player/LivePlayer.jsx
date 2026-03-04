import { useEffect, useMemo, useRef, useState } from "react";

/**
 * LivePlayer
 * - `cameraName`: stream name in go2rtc (e.g. "FrontDoor-main")
 * - `enabled`: when false, player stays idle (used for lazy-loading in grids)
 * - `showControls`: show/hide native video controls
 */
export default function LivePlayer({
  cameraName,
  enabled = true,
  showControls = false,
  className = "",
}) {
  const videoRef = useRef(null);

  // Used to cancel async retries when component unmounts or camera changes
  const tokenRef = useRef(0);
  const retryTimerRef = useRef(null);

  const [mode, setMode] = useState("idle"); // idle | webrtc | mse | hls | error
  const [error, setError] = useState(null);

  const candidates = useMemo(() => {
    if (!cameraName) return [];
    return [
      { type: "webrtc", url: `/go2rtc/api/webrtc?src=${encodeURIComponent(cameraName)}` },
      { type: "mse",   url: `/go2rtc/stream.mse?src=${encodeURIComponent(cameraName)}` },
      { type: "hls",   url: `/go2rtc/stream.m3u8?src=${encodeURIComponent(cameraName)}` },
    ];
  }, [cameraName]);

  function cleanupVideo() {
    const video = videoRef.current;
    if (!video) return;

    // Stop playback and release resource
    try { video.pause(); } catch {}
    // Reset source to break any internal pipeline
    video.removeAttribute("src");
    try { video.load(); } catch {}
  }

  function clearRetry() {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }

  async function tryStart(index, token) {
    const video = videoRef.current;
    if (!video) return;

    if (!enabled) return;

    if (index >= candidates.length) {
      setMode("error");
      setError("Unable to start stream");
      return;
    }

    const { type, url } = candidates[index];
    setMode(type);
    setError(null);

    // Set source and attempt playback
    video.src = url;

    try {
      await video.play();
      // If token changed, we were cancelled; stop immediately
      if (tokenRef.current !== token) {
        cleanupVideo();
      }
    } catch (e) {
      // Try next candidate quickly
      if (tokenRef.current !== token) return;
      tryStart(index + 1, token);
    }
  }

  function scheduleReconnect(delayMs = 1500) {
    clearRetry();
    const token = tokenRef.current;
    retryTimerRef.current = setTimeout(() => {
      if (tokenRef.current !== token) return;
      cleanupVideo();
      tryStart(0, tokenRef.current);
    }, delayMs);
  }

  useEffect(() => {
    tokenRef.current += 1;
    const token = tokenRef.current;

    clearRetry();
    cleanupVideo();

    if (!cameraName || !enabled) {
      setMode("idle");
      setError(null);
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    const onError = () => {
      if (tokenRef.current !== token) return;
      // Attempt reconnect on errors (camera drop, network blip, etc.)
      scheduleReconnect(1500);
    };

    const onStalled = () => {
      if (tokenRef.current !== token) return;
      scheduleReconnect(1500);
    };

    video.addEventListener("error", onError);
    video.addEventListener("stalled", onStalled);

    // Start immediately
    tryStart(0, token);

    return () => {
      video.removeEventListener("error", onError);
      video.removeEventListener("stalled", onStalled);
      clearRetry();
      cleanupVideo();
    };
  }, [cameraName, enabled, candidates]);

  // Helpful overlay for idle/error states
  const overlay =
    !enabled ? null : mode === "error" ? (
      <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm">
        {error || "Stream error"}
      </div>
    ) : mode === "idle" ? (
      <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">
        Loading...
      </div>
    ) : null;

  return (
    <div className={`relative w-full h-full bg-black ${className}`}>
      {overlay}
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        controls={showControls}
        className="w-full h-full object-contain"
      />
    </div>
  );
}