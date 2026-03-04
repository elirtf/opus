import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import LivePlayer from "./player/LivePlayer";

/**
 * CameraTile
 * - Lazy loads the stream when visible.
 * - Keeps rerenders cheap.
 */
export default function CameraTile({ camera, showStats = false, stats = null }) {
  const containerRef = useRef(null);
  const [visible, setVisible] = useState(false);

  const label = useMemo(() => {
    const raw = camera?.display_name || camera?.name || "Camera";
    return raw.replace(" — ", " ").replace(" Main", "");
  }, [camera]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const obs = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { root: null, threshold: 0.15 }
    );

    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className="rounded-xl overflow-hidden border border-gray-800 bg-gray-950"
    >
      <Link to={`/cameras/${encodeURIComponent(camera.name)}`} className="block">
        <div className="aspect-video bg-black relative">
          <LivePlayer cameraName={camera.name} enabled={visible} />
          <div className="absolute left-2 top-2 flex items-center gap-2">
            <span className="text-xs px-2 py-1 rounded bg-black/50 text-gray-200 border border-gray-700">
              {label}
            </span>

            {camera.online === false && (
              <span className="text-xs px-2 py-1 rounded bg-red-900/40 text-red-300 border border-red-800">
                Offline
              </span>
            )}
          </div>

          {showStats && stats && (
            <div className="absolute right-2 top-2 text-xs px-2 py-1 rounded bg-black/50 text-gray-200 border border-gray-700">
              {stats.resolution ? `${stats.resolution} • ` : ""}
              {typeof stats.fps === "number" ? `${stats.fps}fps • ` : ""}
              {typeof stats.bitrate_kbps === "number" ? `${stats.bitrate_kbps}kbps` : ""}
            </div>
          )}
        </div>
      </Link>
    </div>
  );
}