import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import LivePlayer from "../components/player/LivePlayer";
import Spinner from "../components/Spinner";
import { camerasApi } from "../api/cameras";
import { cameraPagePlaybackMode, getPlaybackModeOverride, setPlaybackModeOverride } from "../utils/streamPlayback";

export default function CameraView() {
  const { name } = useParams();
  const navigate = useNavigate();

  const [cam, setCam] = useState(null);
  const [streamStats, setStreamStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [modeOverride, setModeOverride] = useState(getPlaybackModeOverride());

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);

        const [all, st] = await Promise.all([
          camerasApi.summary(),
          camerasApi.stats(name).catch(() => null),
        ]);
        if (!alive) return;

        setStreamStats(st);

        const found = all.find((c) => c.name === name);
        if (found) {
          setCam(found);
          setErr(null);
          return;
        }

        const status = await camerasApi.status(name);
        if (!alive) return;

        setCam({
          id: null,
          name: status.name,
          display_name: status.display_name,
          nvr_name: null,
          recording_enabled: status.recording_enabled,
          online: status.online,
          live_view_stream_name: status.live_view_stream_name,
          live_view_selection_reason: status.live_view_selection_reason,
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

  const liveWarnings = streamStats?.live_view_warnings;
  const playbackMode = modeOverride === "auto" ? cameraPagePlaybackMode(streamStats) : modeOverride;

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

        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-400">Mode</label>
          <select
            value={modeOverride}
            onChange={(e) => {
              const v = setPlaybackModeOverride(e.target.value);
              setModeOverride(v);
            }}
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200"
            title="Saved in this browser (opus_live_playback_mode). Applies to dashboard tiles too. Auto picks MSE on desktop and HLS on touch; override if one mode misbehaves on your device."
          >
            <option value="auto">Auto</option>
            <option value="mse">MSE</option>
            <option value="hls">HLS</option>
          </select>
          {cam && (
            <button
              onClick={() => {
                const today = new Date();
                const yyyy = today.getFullYear();
                const mm = String(today.getMonth() + 1).padStart(2, "0");
                const dd = String(today.getDate()).padStart(2, "0");
                const dateStr = `${yyyy}-${mm}-${dd}`;

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
      </div>

      {Array.isArray(liveWarnings) && liveWarnings.length > 0 && (
        <div className="shrink-0 px-4 py-2.5 bg-amber-950/50 border-b border-amber-900/80 text-amber-100 text-xs leading-relaxed space-y-1">
          {liveWarnings.map((w) => (
            <p key={w.code}>{w.message}</p>
          ))}
        </div>
      )}
      {streamStats && (
        <div className="shrink-0 px-4 py-2 bg-gray-900/70 border-b border-gray-800 text-[11px] text-gray-400 flex flex-wrap gap-x-4 gap-y-1">
          <span>mode: {playbackMode}</span>
          <span>codec: {streamStats.codec || "unknown"}</span>
          <span>fps: {streamStats.fps ?? "—"}</span>
          <span>source: {streamStats.producer_type || "unknown"}</span>
          {streamStats.is_transcoded_live && <span className="text-amber-300">transcoding detected</span>}
        </div>
      )}

      <div className="flex-1 bg-black min-h-0">
        {/*
          Desktop: MSE (lower latency than HLS, no per-consumer server-side FFmpeg).
          Touch / narrow: HLS (adaptive bitrate, less decode pressure). Substream matches dashboard.
        */}
        <LivePlayer
          cameraName={cam.name}
          streamName={cam.live_view_stream_name}
          enabled={true}
          playbackMode={playbackMode}
        />
      </div>
    </div>
  );
}
