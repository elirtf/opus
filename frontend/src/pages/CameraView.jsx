import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import LivePlayer from "../components/player/LivePlayer";
import Spinner from "../components/Spinner";
import { camerasApi } from "../api/cameras";

export default function CameraView() {
  const { name } = useParams();
  const navigate = useNavigate();

  const [cam, setCam] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);

        // Prefer summary because it includes nvr_name, recording_enabled, online, etc.
        const all = await camerasApi.summary();
        if (!alive) return;

        const found = all.find((c) => c.name === name);
        if (found) {
          setCam(found);
          setErr(null);
          return;
        }

        // Fallback: status endpoint if not in summary for any reason
        const st = await camerasApi.status(name);
        if (!alive) return;

        setCam({
          id: null,
          name: st.name,
          display_name: st.display_name,
          nvr_name: null,
          recording_enabled: st.recording_enabled,
          online: st.online,
        });

        setErr(null);
      } catch (e) {
        if (!alive) return;
        setErr(e.message || "Failed to load camera");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [name]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Spinner className="w-6 h-6" />
      </div>
    );
  }

  if (err) {
    return (
      <div className="p-6 text-gray-300">
        <div className="text-red-400 mb-2">Error</div>
        <div className="text-sm">{err}</div>
        <button
          onClick={() => navigate(-1)}
          className="mt-4 text-indigo-300 hover:underline text-sm"
        >
          ← Back
        </button>
      </div>
    );
  }

  const label = (cam?.display_name || cam?.name || "Camera")
    .replace(" — ", " ")
    .replace(" Main", "");

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-2.5 bg-gray-900 border-b border-gray-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="text-gray-400 hover:text-white text-sm transition-colors"
          >
            ← Back
          </button>

          <div className="w-px h-4 bg-gray-700" />

          <div className="text-white font-semibold">{label}</div>

          {cam?.online === false && (
            <span className="text-xs px-2 py-0.5 rounded-full border bg-red-900/40 text-red-300 border-red-800">
              Offline
            </span>
          )}
        </div>

        {cam && (
          <button
            onClick={() => {
              const today = new Date();
              const yyyy = today.getFullYear();
              const mm = String(today.getMonth() + 1).padStart(2, "0");
              const dd = String(today.getDate()).padStart(2, "0");
              const dateStr = `${yyyy}-${mm}-${dd}`;

              // Navigate to recordings page with this camera and date pre-selected
              navigate(
                `/recordings?camera=${encodeURIComponent(
                  cam.name
                )}&date=${dateStr}`
              );
            }}
            className="text-xs px-3 py-1.5 rounded border border-indigo-500 text-indigo-200 hover:bg-indigo-500/10 transition-colors"
          >
            View recordings
          </button>
        )}
      </div>

      <div className="flex-1 bg-black min-h-0">
        {/*
          MSE over HTTP works through nginx; WebRTC often hits ICE failures behind Docker/NAT
          unless go2rtc advertises reachable candidates or TURN is configured.
          Substream live preview matches the dashboard (lower bitrate).
        */}
        <LivePlayer cameraName={cam.name} enabled={true} />
      </div>
    </div>
  );
}