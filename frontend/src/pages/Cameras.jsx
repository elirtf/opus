import { useEffect, useState } from "react";
import { camerasApi } from "../api/cameras";
import Spinner from "../components/Spinner";
import CameraTile from "../components/CameraTile";

export default function Cameras() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  // Optional: stats overlay support
  const [statsEnabled] = useState(false);
  const [statsMap, setStatsMap] = useState({}); // { [name]: stats }

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);
        const cams = await camerasApi.summary();
        if (!alive) return;
        setItems(cams);
        setErr(null);
      } catch (e) {
        if (!alive) return;
        setErr(e.message || "Failed to load cameras");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  // Optional stats fetch (keep off unless you need it)
  useEffect(() => {
    if (!statsEnabled || items.length === 0) return;

    let alive = true;

    (async () => {
      const next = {};
      for (const cam of items) {
        try {
          next[cam.name] = await camerasApi.stats(cam.name);
        } catch {
          // ignore stats failures
        }
      }
      if (!alive) return;
      setStatsMap(next);
    })();

    return () => {
      alive = false;
    };
  }, [items, statsEnabled]);

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
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-xl font-semibold text-white">Cameras</h1>
        <div className="text-xs text-gray-400">{items.length} total</div>
      </div>

      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {items.map((cam) => (
          <CameraTile
            key={cam.id}
            camera={cam}
            showStats={statsEnabled}
            stats={statsMap[cam.name]}
          />
        ))}
      </div>
    </div>
  );
}