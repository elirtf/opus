import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { compareCamerasByDisplayName, naturalCompare } from "../utils/naturalCompare";
import { apiFetch, withOrigin } from "../api/client";
import { useToast, ToastList } from "../components/Toast";

// ── API helpers ──────────────────────────────────────────────────────────────
const api = (url, opts = {}) => apiFetch(url, opts);

// ── Constants & formatters ───────────────────────────────────────────────────
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const SPEEDS = [
  { rate: 0.125, label: "⅛×" },
  { rate: 0.25,  label: "¼×" },
  { rate: 0.5,   label: "½×" },
  { rate: 1,     label: "1×" },
  { rate: 1.5,  label: "1.5×" },
  { rate: 2,     label: "2×" },
  { rate: 3,     label: "3×" },
  { rate: 4,     label: "4×" },
  { rate: 8,     label: "8×" },
  { rate: 16,    label: "16×" },
];

/** Fine-tuning for local NVR playback (browser only). */
const PB_LS = {
  speed: "opus.playback.speed",
  autoAdvance: "opus.playback.autoAdvance",
  frameStepFps: "opus.playback.frameStepFps",
  preload: "opus.playback.preload",
};

function readPlaybackSpeed() {
  try {
    const v = parseFloat(localStorage.getItem(PB_LS.speed) || "");
    if (SPEEDS.some((s) => s.rate === v)) return v;
    if (Number.isFinite(v) && v >= 0.0625 && v <= 16) return v;
  } catch {
    /* ignore */
  }
  return 1;
}

function readPlaybackAutoAdvance() {
  try {
    return localStorage.getItem(PB_LS.autoAdvance) !== "0";
  } catch {
    return true;
  }
}

function readFrameStepFps() {
  try {
    const v = parseInt(localStorage.getItem(PB_LS.frameStepFps) || "30", 10);
    if ([24, 25, 30, 50, 60].includes(v)) return v;
  } catch {
    /* ignore */
  }
  return 30;
}

function readPreload() {
  try {
    const p = localStorage.getItem(PB_LS.preload);
    if (p === "auto" || p === "metadata" || p === "none") return p;
  } catch {
    /* ignore */
  }
  return "metadata";
}
const fmtSize = (bytes) => {
  if (!bytes) return "0 B";
  if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(1) + " GB";
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + " MB";
  return (bytes / 1024).toFixed(0) + " KB";
};
const fmtDur = (s) => {
  if (!s) return "—";
  const m = Math.floor(s / 60), sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
};
const pad2 = (n) => String(n).padStart(2, "0");
const toDateStr = (d) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** Human-readable site name for one NVR bucket (avoid every group showing "Standalone"). */
function siteLabelForCameras(cameras) {
  if (!cameras.length) return "Standalone";
  const withName = cameras.find((c) => c.nvr_name && String(c.nvr_name).trim());
  if (withName) return String(withName.nvr_name).trim();
  const id = cameras[0].nvr_id;
  if (id != null && id !== "") return `Site #${id}`;
  return "Standalone";
}

/** Group active main-stream cameras by NVR for settings and playback sidebar. */
function groupMainCamerasByNvr(camList) {
  const groups = {};
  for (const cam of camList) {
    if (!cam.active || !cam.name.endsWith("-main")) continue;
    const hasNvr = cam.nvr_id != null && cam.nvr_id !== "";
    const key = hasNvr ? String(cam.nvr_id) : "standalone";
    if (!groups[key]) groups[key] = { key, cameras: [] };
    groups[key].cameras.push(cam);
  }
  for (const g of Object.values(groups)) {
    g.cameras.sort(compareCamerasByDisplayName);
    g.label = siteLabelForCameras(g.cameras);
  }
  return Object.values(groups).sort((a, b) => naturalCompare(a.label, b.label));
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════
export default function RecordingsPage() {
  const location = useLocation();
  const { user } = useAuth();
  const showSettingsTab = user?.role === "admin";
  const [tab, setTab] = useState("playback");
  const [cameras, setCameras] = useState([]);
  const [selectedCam, setSelectedCam] = useState(null);
  const [date, setDate] = useState(toDateStr(new Date()));
  const [timeline, setTimeline] = useState([]);
  const [segments, setSegments] = useState([]);
  const [playing, setPlaying] = useState(null);
  const [engineStatus, setEngineStatus] = useState(null);
  const [storageStats, setStorageStats] = useState(null);
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [setupStatus, setSetupStatus] = useState(null);
  const [setupDir, setSetupDir] = useState("/recordings");
  const [setupSaving, setSetupSaving] = useState(false);
  const [speed, setSpeed] = useState(readPlaybackSpeed);
  const [autoAdvance, setAutoAdvance] = useState(readPlaybackAutoAdvance);
  const [frameStepFps, setFrameStepFps] = useState(readFrameStepFps);
  const [preloadMode, setPreloadMode] = useState(readPreload);
  const videoRef = useRef(null);
  const [pollError, setPollError] = useState(null);
  /** When set, bulk apply is running for this NVR group key (`standalone` or nvr id string). */
  const [bulkApplyingKey, setBulkApplyingKey] = useState(null);

  const showToast = useCallback((msg, ok = true) => {
    if (ok) toast.success(msg);
    else toast.error(msg);
  }, [toast]);

  const isOriginalAdmin = setupStatus?.is_original_admin ?? false;

  // ── Initialize from URL query (camera & date) ──────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const camParam = params.get("camera");
    const dateParam = params.get("date");

    if (camParam) {
      setSelectedCam(camParam);
      // Auto-switch tab based on recording policy once cameras are loaded
      const cam = cameras.find((c) => c.name === camParam);
      if (cam && tab !== "settings") {
        const wantsEvents =
          cam.recording_enabled && cam.recording_policy === "events_only";
        setTab(wantsEvents ? "events" : "playback");
      }
    }
    if (dateParam) {
      setDate(dateParam);
    }
  }, [location.search, cameras, tab]);

  // ── Check setup status on mount ─────────────────────────────────────────
  useEffect(() => {
    api("/api/recordings/settings/setup-status")
      .then(setSetupStatus)
      .catch(() => {});
  }, []);

  // ── Load cameras ────────────────────────────────────────────────────────
  useEffect(() => {
    api("/api/cameras/").then(setCameras).catch(() => {});
  }, []);

  // ── Load engine status periodically ─────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      const [r1, r2] = await Promise.allSettled([
        api("/api/recordings/engine/status"),
        api("/api/recordings/storage"),
      ]);
      const authFail = (r) =>
        r.status === "rejected" && (r.reason?.status === 401 || r.reason?.status === 403);
      if (authFail(r1) || authFail(r2)) {
        const st = r1.status === "rejected" ? r1.reason?.status : r2.reason?.status;
        setPollError(
          st === 401
            ? "Session expired or not signed in — log in, then refresh this page."
            : "You do not have permission to view recording status."
        );
        setEngineStatus(null);
        setStorageStats(null);
        return;
      }
      setPollError(null);
      if (r1.status === "fulfilled") setEngineStatus(r1.value);
      if (r2.status === "fulfilled") setStorageStats(r2.value);
    };
    load();
    const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, []);

  // ── Load timeline when camera/date / tab changes ─────────────────────────
  useEffect(() => {
    if (!selectedCam || (tab !== "playback" && tab !== "events")) {
      setTimeline([]);
      setSegments([]);
      return;
    }
    const path =
      tab === "events"
        ? `/api/events/timeline?camera=${encodeURIComponent(selectedCam)}&date=${date}`
        : `/api/recordings/timeline?camera=${encodeURIComponent(selectedCam)}&date=${date}`;
    api(path)
      .then((d) => {
        const segs = d.cameras?.[selectedCam] || [];
        setTimeline(segs);
        setSegments(segs);
      })
      .catch(() => {
        setTimeline([]);
        setSegments([]);
      });
  }, [selectedCam, date, tab]);

  useEffect(() => {
    setPlaying(null);
  }, [tab]);

  useEffect(() => {
    try {
      localStorage.setItem(PB_LS.speed, String(speed));
    } catch {
      /* ignore */
    }
  }, [speed]);

  useEffect(() => {
    try {
      localStorage.setItem(PB_LS.autoAdvance, autoAdvance ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [autoAdvance]);

  useEffect(() => {
    try {
      localStorage.setItem(PB_LS.frameStepFps, String(frameStepFps));
    } catch {
      /* ignore */
    }
  }, [frameStepFps]);

  useEffect(() => {
    try {
      localStorage.setItem(PB_LS.preload, preloadMode);
    } catch {
      /* ignore */
    }
  }, [preloadMode]);

  useEffect(() => {
    if (videoRef.current && playing?.url) {
      videoRef.current.playbackRate = speed;
    }
  }, [playing?.url, speed]);

  // ── Load settings ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!showSettingsTab && tab === "settings") setTab("playback");
  }, [showSettingsTab, tab]);

  useEffect(() => {
    if (tab === "settings") {
      api("/api/recordings/settings/").then(setSettings).catch(() => {});
    }
  }, [tab]);

  // ── Recording mode per camera (original admin only): PATCH recording_policy ─
  const updateCameraRecordingPolicy = async (cam, policy) => {
    try {
      const updated = await api(`/api/cameras/${cam.id}`, {
        method: "PATCH",
        body: JSON.stringify({ recording_policy: policy }),
      });
      setCameras((prev) =>
        prev.map((c) => (c.id === cam.id ? { ...c, ...updated } : c))
      );
      const label =
        policy === "off"
          ? "Off"
          : policy === "events_only"
            ? "Events (motion)"
            : "Continuous";
      showToast(`${cam.display_name}: ${label}`);
    } catch (e) {
      showToast(e.message, false);
    }
  };

  const applyRecordingPolicyToCameras = async (cams, policy, groupKey) => {
    if (!cams.length) return;
    setBulkApplyingKey(groupKey);
    try {
      const results = await Promise.allSettled(
        cams.map((cam) =>
          api(`/api/cameras/${cam.id}`, {
            method: "PATCH",
            body: JSON.stringify({ recording_policy: policy }),
          })
        )
      );
      const updates = {};
      let ok = 0;
      let fail = 0;
      results.forEach((r, i) => {
        if (r.status === "fulfilled") {
          ok++;
          updates[cams[i].id] = r.value;
        } else {
          fail++;
        }
      });
      setCameras((prev) =>
        prev.map((c) => (updates[c.id] ? { ...c, ...updates[c.id] } : c))
      );
      const polLabel =
        policy === "off"
          ? "Off"
          : policy === "events_only"
            ? "Events (motion)"
            : "Continuous";
      if (fail === 0) {
        showToast(`All ${ok} camera(s) in group set to ${polLabel}.`);
      } else {
        showToast(
          `Updated ${ok}, failed ${fail}. Check permissions or connectivity.`,
          ok > 0
        );
      }
    } catch (e) {
      showToast(e.message, false);
    } finally {
      setBulkApplyingKey(null);
    }
  };

  const recordingPolicySelectValue = (cam) =>
    !cam.recording_enabled || cam.recording_policy === "off"
      ? "off"
      : cam.recording_policy;

  // ── Save settings ──────────────────────────────────────────────────────
  const saveSettings = async () => {
    setSaving(true);
    try {
      await api("/api/recordings/settings/", {
        method: "PUT",
        body: JSON.stringify(settings),
      });
      showToast(
        "Settings saved. Segment length updates within ~10s (FFmpeg restarts automatically)."
      );
    } catch (e) {
      showToast(e.message, false);
    }
    setSaving(false);
  };

  // ── Restart engine ─────────────────────────────────────────────────────
  const restartEngine = async () => {
    try {
      await api("/api/recordings/settings/engine/restart", { method: "POST" });
      showToast("Engine restarting...");
    } catch (e) {
      showToast(e.message, false);
    }
  };

  const reconcileStorage = async () => {
    if (!isOriginalAdmin) return;
    try {
      const data = await api("/api/recordings/reconcile-storage", { method: "POST" });
      showToast(
        `Removed ${data.removed_segments ?? 0} stale segment(s), ${data.removed_events ?? 0} event(s) from the database.`
      );
      api("/api/recordings/storage").then(setStorageStats).catch(() => {});
    } catch (e) {
      showToast(e.message, false);
    }
  };

  // ── Complete first-run setup ───────────────────────────────────────────
  const completeSetup = async () => {
    setSetupSaving(true);
    try {
      await api("/api/recordings/settings/setup", {
        method: "POST",
        body: JSON.stringify({ recordings_dir: setupDir }),
      });
      setSetupStatus((s) => ({ ...s, setup_complete: true }));
      showToast("Recording setup complete!");
    } catch (e) {
      showToast(e.message, false);
    }
    setSetupSaving(false);
  };

  // ── Play a segment or event clip ─────────────────────────────────────────
  const playSeg = (seg) => {
    const base =
      tab === "events" ? "/api/events/" : "/api/recordings/";
    const path = `${base}${encodeURIComponent(selectedCam)}/${seg.filename}`;
    const url = withOrigin(path);
    setPlaying({ ...seg, url });
    if (videoRef.current) {
      videoRef.current.src = url;
      videoRef.current.playbackRate = speed;
      videoRef.current.play().catch(() => {});
    }
  };

  const changeSpeed = (newSpeed) => {
    setSpeed(newSpeed);
    if (videoRef.current) videoRef.current.playbackRate = newSpeed;
  };

  const stepFrame = (direction) => {
    if (!videoRef.current) return;
    videoRef.current.pause();
    videoRef.current.currentTime += direction * (1 / frameStepFps);
  };

  const onVideoEnded = () => {
    if (!autoAdvance || !playing || !segments.length) return;
    const idx = segments.findIndex((s) => s.filename === playing.filename);
    if (idx >= 0 && idx < segments.length - 1) playSeg(segments[idx + 1]);
  };

  // ── Filter cameras (main streams only) ─────────────────────────────────
  const filtered = cameras.filter(
    (c) =>
      c.active &&
      c.name.endsWith("-main") &&
      (c.display_name.toLowerCase().includes(search.toLowerCase()) ||
        c.name.toLowerCase().includes(search.toLowerCase()))
  );
  const recordingCams = filtered.filter((c) => c.recording_enabled);
  const availableCams = filtered.filter((c) => !c.recording_enabled);

  const settingsCameraGroups = groupMainCamerasByNvr(cameras);
  const recordingByNvr = groupMainCamerasByNvr(recordingCams);
  const availableByNvr = groupMainCamerasByNvr(availableCams);

  const continuousRecCount = cameras.filter(
    (c) =>
      c.active &&
      c.name.endsWith("-main") &&
      c.recording_enabled &&
      (c.recording_policy === "continuous" || !c.recording_policy)
  ).length;
  const motionOnlyCount = cameras.filter(
    (c) =>
      c.active &&
      c.name.endsWith("-main") &&
      c.recording_enabled &&
      c.recording_policy === "events_only"
  ).length;

  /** Pick a camera; auto-switch to Event clips if it's motion-only, Playback otherwise. */
  const selectCamera = useCallback(
    (cam) => {
      setSelectedCam(cam.name);
      if (tab === "settings") return;
      const wantsEvents =
        cam.recording_enabled && cam.recording_policy === "events_only";
      setTab(wantsEvents ? "events" : "playback");
    },
    [tab],
  );

  const shiftDate = (days) => {
    const d = new Date(date + "T00:00:00");
    d.setDate(d.getDate() + days);
    setDate(toDateStr(d));
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // FIRST-RUN SETUP SCREEN
  // ═══════════════════════════════════════════════════════════════════════════
  if (setupStatus && !setupStatus.setup_complete) {
    if (!isOriginalAdmin) {
      return (
        <div style={S.page}>
          <div style={S.setupWrap}>
            <div style={S.setupCard}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2">
                <path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <h2 style={S.setupTitle}>Recording Setup Required</h2>
              <p style={S.setupDesc}>
                The original system administrator needs to complete the initial
                recording configuration before recordings are available.
              </p>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div style={S.page}>
        <div style={S.setupWrap}>
          <div style={S.setupCard}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <circle cx="12" cy="12" r="3" fill="#f43f5e" />
            </svg>
            <h2 style={S.setupTitle}>Recording Setup</h2>
            <p style={S.setupDesc}>
              Welcome! Configure where recording files are stored (absolute path
              inside the server/container). Recording stays off until you enable
              it per camera under Recordings → Settings after setup.
            </p>
            <label style={S.label}>
              Recordings Storage Path
              <input
                type="text"
                value={setupDir}
                onChange={(e) => setSetupDir(e.target.value)}
                style={S.input}
                placeholder="/recordings"
              />
              <span style={S.hint}>
                Absolute path inside the container (must be a mounted volume for persistence)
              </span>
            </label>
            <div style={{ ...S.setupInfo, marginTop: 12 }}>
              <div style={S.setupInfoRow}>
                <span style={{ color: "#94a3b8" }}>Segment duration</span>
                <span style={{ color: "#e2e8f0" }}>15 minutes</span>
              </div>
              <div style={S.setupInfoRow}>
                <span style={{ color: "#94a3b8" }}>Retention</span>
                <span style={{ color: "#e2e8f0" }}>90 days</span>
              </div>
              <div style={S.setupInfoRow}>
                <span style={{ color: "#94a3b8" }}>Main streams</span>
                <span style={{ color: "#e2e8f0" }}>
                  {cameras.filter((c) => c.active && c.name.endsWith("-main")).length} (enable recording per camera after setup)
                </span>
              </div>
            </div>
            <button
              style={{ ...S.btnPrimary, marginTop: 16, width: "100%", padding: "12px 20px" }}
              onClick={completeSetup}
              disabled={setupSaving || !setupDir.startsWith("/")}
            >
              {setupSaving ? "Saving..." : "Complete setup"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN UI
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div style={S.page}>
      <ToastList toasts={toast.toasts} onDismiss={toast.dismiss} />
      {pollError && (
        <div
          style={{
            ...S.permBanner,
            margin: "0 20px 0",
            borderRadius: 8,
            justifyContent: "center",
            color: "#fecaca",
            borderColor: "rgba(248,113,113,0.35)",
          }}
        >
          {pollError}
        </div>
      )}

      {/* ── Header ── */}
      <div style={S.header}>
        <div style={S.headerLeft}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="12" r="3" fill="#f43f5e" />
          </svg>
          <h1 style={S.title}>Recordings</h1>
          {engineStatus && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{
                ...S.badge,
                background: engineStatus.engine_running ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)",
                color: engineStatus.engine_running ? "#10b981" : "#ef4444",
              }}>
                {engineStatus.active_recordings || 0} segment{engineStatus.active_recordings === 1 ? "" : "s"}
              </span>
              {continuousRecCount > 0 && (
                <span style={{
                  ...S.badge,
                  background: "rgba(16,185,129,0.12)",
                  color: "#6ee7b7",
                }}>
                  {continuousRecCount} continuous
                </span>
              )}
              {motionOnlyCount > 0 && (
                <span style={{
                  ...S.badge,
                  background: "rgba(34,211,238,0.12)",
                  color: "#22d3ee",
                }}>
                  {motionOnlyCount} motion
                </span>
              )}
            </div>
          )}
        </div>
        <div style={S.tabs}>
          {[
            { id: "playback", label: "Playback" },
            { id: "events", label: "Event clips" },
            ...(showSettingsTab ? [{ id: "settings", label: "Settings" }] : []),
          ].map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              style={{ ...S.tab, ...(tab === id ? S.tabActive : {}) }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "playback" || tab === "events" ? (
        // ═════════════════════════════════════════════════════════════════════
        // PLAYBACK TAB
        // ═════════════════════════════════════════════════════════════════════
        <div style={S.body}>
          {/* ── Sidebar ── */}
          <div style={S.sidebar}>
            <input
              style={S.search}
              placeholder="Search cameras..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {recordingCams.length > 0 && (
              <>
                <div style={S.sideLabel}>Recording ({recordingCams.length})</div>
                {recordingByNvr.map((g) => (
                  <div key={`rec-${g.key}`}>
                    <div style={S.sideNvrLabel}>{g.label} · {g.cameras.length}</div>
                    {g.cameras.map((c) => (
                      <CamItem
                        key={c.id} cam={c}
                        selected={selectedCam === c.name}
                        onSelect={() => selectCamera(c)}
                        engineStatus={engineStatus}
                      />
                    ))}
                  </div>
                ))}
              </>
            )}
            {availableCams.length > 0 && (
              <>
                <div style={{ ...S.sideLabel, marginTop: 16 }}>
                  Not Recording ({availableCams.length})
                </div>
                {availableByNvr.map((g) => (
                  <div key={`avail-${g.key}`}>
                    <div style={S.sideNvrLabel}>{g.label} · {g.cameras.length}</div>
                    {g.cameras.map((c) => (
                      <CamItem
                        key={c.id} cam={c}
                        selected={selectedCam === c.name}
                        onSelect={() => selectCamera(c)}
                        engineStatus={engineStatus}
                      />
                    ))}
                  </div>
                ))}
              </>
            )}
          </div>

          {/* ── Main content ── */}
          <div style={S.main}>
            {!selectedCam ? (
              <div style={S.empty}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="1.5">
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <path d="M7 15l3-3 2 2 4-4 4 4" />
                </svg>
                <p style={{ color: "#94a3b8", marginTop: 12, textAlign: "center", maxWidth: 280, lineHeight: 1.5 }}>
                  Pick a camera from the list on the left. Use search to filter by name. Only cameras with recording enabled show under Recording.
                </p>
              </div>
            ) : (
              <>
                {/* Video player */}
                <div style={S.playerWrap}>
                  {playing ? (
                    <video
                      ref={videoRef}
                      controls
                      autoPlay
                      playsInline
                      preload={preloadMode}
                      onEnded={onVideoEnded}
                      style={S.video}
                    >
                      <source src={playing.url} type="video/mp4" />
                    </video>
                  ) : (
                    <div style={S.playerPlaceholder}>
                      <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="1.5">
                        <polygon points="5,3 19,12 5,21" fill="#334155" />
                      </svg>
                      <p style={{ color: "#64748b", marginTop: 8 }}>Click a segment on the timeline to play</p>
                    </div>
                  )}
                </div>

                {/* Playback speed controls */}
                {playing && (
                  <>
                    <div style={S.speedBar}>
                      <button
                        type="button"
                        onClick={() => stepFrame(-1)}
                        style={S.speedFrameBtn}
                        title={`Step back 1 frame (~${frameStepFps} fps)`}
                      >
                        ◀▮
                      </button>
                      {SPEEDS.map((s) => (
                        <button
                          type="button"
                          key={s.rate}
                          onClick={() => changeSpeed(s.rate)}
                          style={{
                            ...S.speedBtn,
                            ...(speed === s.rate ? S.speedBtnActive : {}),
                          }}
                        >
                          {s.label}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => stepFrame(1)}
                        style={S.speedFrameBtn}
                        title={`Step forward 1 frame (~${frameStepFps} fps)`}
                      >
                        ▮▶
                      </button>
                    </div>
                    <div style={S.playbackPrefs}>
                      <label style={S.playbackPrefItem}>
                        <span style={S.playbackPrefLabel}>Frame step</span>
                        <select
                          value={frameStepFps}
                          onChange={(e) => setFrameStepFps(parseInt(e.target.value, 10))}
                          style={S.playbackSelect}
                        >
                          {[24, 25, 30, 50, 60].map((fps) => (
                            <option key={fps} value={fps}>
                              {fps} fps
                            </option>
                          ))}
                        </select>
                      </label>
                      <label style={S.playbackPrefItem}>
                        <input
                          type="checkbox"
                          checked={autoAdvance}
                          onChange={(e) => setAutoAdvance(e.target.checked)}
                        />
                        <span style={{ color: "#cbd5e1", fontSize: 11 }}>Auto-next segment</span>
                      </label>
                      <label style={S.playbackPrefItem}>
                        <span style={S.playbackPrefLabel}>Buffer</span>
                        <select
                          value={preloadMode}
                          onChange={(e) => setPreloadMode(e.target.value)}
                          style={S.playbackSelect}
                          title="Metadata = less bandwidth until play; Auto = start buffering earlier"
                        >
                          <option value="none">None</option>
                          <option value="metadata">Metadata</option>
                          <option value="auto">Auto</option>
                        </select>
                      </label>
                    </div>
                  </>
                )}

                {/* Date nav */}
                <div style={S.dateNav}>
                  <button style={S.dateBtn} onClick={() => shiftDate(-1)}>◀</button>
                  <input
                    type="date" value={date}
                    onChange={(e) => setDate(e.target.value)}
                    style={S.dateInput}
                  />
                  <button style={S.dateBtn} onClick={() => shiftDate(1)}>▶</button>
                  <button style={S.dateBtn} onClick={() => setDate(toDateStr(new Date()))}>Today</button>
                  <span style={S.segCount}>
                    {segments.length} segment{segments.length !== 1 ? "s" : ""}
                  </span>
                </div>

                {/* Timeline */}
                <Timeline segments={timeline} playing={playing} onPlay={playSeg} date={date} />

                {/* Segment list */}
                <div style={S.segList}>
                  {segments.length === 0 ? (
                    <div style={{ padding: 20, textAlign: "center", color: "#64748b" }}>
                      No recordings for this date
                    </div>
                  ) : (
                    segments.map((seg) => (
                      <button
                        key={seg.filename}
                        onClick={() => playSeg(seg)}
                        style={{ ...S.segItem, ...(playing?.filename === seg.filename ? S.segActive : {}) }}
                      >
                        <span style={S.segTime}>{seg.start || "—"}</span>
                        <span style={S.segDur}>{fmtDur(seg.duration)}</span>
                        <span style={S.segSize}>{fmtSize((seg.size_mb || 0) * 1048576)}</span>
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        // ═════════════════════════════════════════════════════════════════════
        // SETTINGS TAB
        // ═════════════════════════════════════════════════════════════════════
        <div style={S.settingsBody}>
          {!isOriginalAdmin && (
            <div style={S.permBanner}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0110 0v4" />
              </svg>
              <span>Recording settings can only be changed by the original system administrator.</span>
            </div>
          )}

          <div style={S.settingsGrid}>
            {/* ── Recording Config (original admin only) ── */}
            <div style={S.card}>
              <h3 style={S.cardTitle}>Recording Configuration</h3>
              {settings ? (
                <div style={S.form}>
                  <label style={S.label}>
                    Segment Duration (minutes)
                    <input
                      type="number" min="1" max="60"
                      value={settings.segment_minutes || 15}
                      onChange={(e) => setSettings({ ...settings, segment_minutes: parseInt(e.target.value) || 15 })}
                      style={S.input}
                      disabled={!isOriginalAdmin}
                    />
                  </label>
                  <label style={S.label}>
                    Retention (days)
                    <input
                      type="number" min="1" max="3650"
                      value={settings.retention_days || 90}
                      onChange={(e) => setSettings({ ...settings, retention_days: parseInt(e.target.value) || 90 })}
                      style={S.input}
                      disabled={!isOriginalAdmin}
                    />
                  </label>
                  <label style={S.label}>
                    Max Storage (GB)
                    <input
                      type="number" min="0" step="10"
                      value={settings.max_storage_gb || 0}
                      onChange={(e) => setSettings({ ...settings, max_storage_gb: parseFloat(e.target.value) || 0 })}
                      style={S.input}
                      disabled={!isOriginalAdmin}
                    />
                    <span style={S.hint}>0 = unlimited</span>
                  </label>
                  <label style={S.label}>
                    Recordings Directory
                    <input
                      type="text"
                      value={settings.recordings_dir || "/recordings"}
                      onChange={(e) => setSettings({ ...settings, recordings_dir: e.target.value })}
                      style={S.input}
                      disabled={!isOriginalAdmin}
                    />
                  </label>
                  <label style={S.label}>
                    Stagger Delay (seconds)
                    <input
                      type="number" min="0" max="30"
                      value={settings.stagger_seconds || 2}
                      onChange={(e) => setSettings({ ...settings, stagger_seconds: parseInt(e.target.value) || 0 })}
                      style={S.input}
                      disabled={!isOriginalAdmin}
                    />
                  </label>
                  {isOriginalAdmin && (
                    <div style={S.btnRow}>
                      <button style={S.btnPrimary} onClick={saveSettings} disabled={saving}>
                        {saving ? "Saving..." : "Save Settings"}
                      </button>
                      <button style={S.btnSecondary} onClick={restartEngine}>
                        Restart Engine
                      </button>
                      <button style={S.btnSecondary} onClick={reconcileStorage} title="After deleting recording files or volumes, purge DB rows that point to missing files">
                        Purge stale DB rows
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <p style={{ color: "#64748b" }}>Loading settings...</p>
              )}
            </div>

            {/* ── Camera Recording (original admin only can toggle) ── */}
            <div style={S.card}>
              <h3 style={S.cardTitle}>Camera Recording</h3>
              <div style={S.camToggleList}>
                {settingsCameraGroups.length === 0 ? (
                  <p style={{ color: "#64748b", fontSize: 12, margin: 0 }}>No active main-stream cameras.</p>
                ) : (
                  settingsCameraGroups.map((g) => (
                    <div key={g.key} style={S.nvrGroupSection}>
                      <div style={S.nvrSiteBar}>
                        <div style={S.nvrGroupHeader}>
                          <div style={S.nvrSiteTitleRow}>
                            <span style={S.nvrSiteBadge}>Site</span>
                            <span style={S.nvrSiteName} title={g.label}>
                              {g.label}
                            </span>
                            <span style={S.nvrSiteMeta}>
                              {g.cameras.length} main {g.cameras.length === 1 ? "stream" : "streams"}
                            </span>
                          </div>
                          {isOriginalAdmin && (
                          <div style={S.nvrBulkBtnRow}>
                            <button
                              type="button"
                              style={{
                                ...S.nvrBulkBtn,
                                ...(bulkApplyingKey != null
                                  ? { opacity: 0.45, cursor: "not-allowed" }
                                  : {}),
                              }}
                              disabled={bulkApplyingKey != null}
                              onClick={() =>
                                applyRecordingPolicyToCameras(g.cameras, "events_only", g.key)
                              }
                              title="Set all cameras in this site to Events (motion)"
                            >
                              Motion
                            </button>
                            <button
                              type="button"
                              style={{
                                ...S.nvrBulkBtn,
                                ...(bulkApplyingKey != null
                                  ? { opacity: 0.45, cursor: "not-allowed" }
                                  : {}),
                              }}
                              disabled={bulkApplyingKey != null}
                              onClick={() =>
                                applyRecordingPolicyToCameras(g.cameras, "continuous", g.key)
                              }
                              title="Set all cameras in this site to Continuous"
                            >
                              Continuous
                            </button>
                            <button
                              type="button"
                              style={{
                                ...S.nvrBulkBtn,
                                ...(bulkApplyingKey != null
                                  ? { opacity: 0.45, cursor: "not-allowed" }
                                  : {}),
                              }}
                              disabled={bulkApplyingKey != null}
                              onClick={() => applyRecordingPolicyToCameras(g.cameras, "off", g.key)}
                              title="Turn off recording for all cameras in this site"
                            >
                              Off
                            </button>
                          </div>
                          )}
                        </div>
                      </div>
                      {g.cameras.map((cam) => (
                        <div key={cam.id} style={S.camToggleRow}>
                          <div>
                            <div style={{ color: "#e2e8f0", fontSize: 13 }}>{cam.display_name}</div>
                            <div style={{ color: "#64748b", fontSize: 11 }}>{cam.name}</div>
                          </div>
                          {isOriginalAdmin ? (
                            <select
                              value={recordingPolicySelectValue(cam)}
                              onChange={(e) =>
                                updateCameraRecordingPolicy(cam, e.target.value)
                              }
                              style={S.recordingPolicySelect}
                              aria-label={`Recording mode for ${cam.display_name}`}
                            >
                              <option value="off">Off</option>
                              <option value="continuous">Continuous</option>
                              <option value="events_only">Events (motion)</option>
                            </select>
                          ) : (
                            <span style={{
                              fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 10,
                              background: cam.recording_enabled ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)",
                              color: cam.recording_enabled ? "#10b981" : "#ef4444",
                            }}>
                              {!cam.recording_enabled || cam.recording_policy === "off"
                                ? "Off"
                                : cam.recording_policy === "events_only"
                                  ? "Events"
                                  : "Continuous"}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* ── Storage Stats (visible to all) ── */}
            <div style={S.card}>
              <h3 style={S.cardTitle}>Storage</h3>
              <p style={{ ...S.hint, marginBottom: 10 }}>
                Counts include continuous and motion clips under{" "}
                <span style={{ fontFamily: "monospace", color: "#94a3b8" }}>clips/</span>. Path:{" "}
                <span style={{ fontFamily: "monospace", color: "#94a3b8", wordBreak: "break-all" }}>
                  {storageStats?.recordings_dir || "—"}
                </span>
              </p>
              {storageStats ? (
                <>
                  {storageStats.disk && (
                    <div style={S.storageBar}>
                      <div style={S.storageBarTrack}>
                        <div style={{
                          ...S.storageBarFill,
                          width: `${Math.min(storageStats.disk.percent_used, 100)}%`,
                          background:
                            storageStats.disk.percent_used > 90 ? "#ef4444"
                              : storageStats.disk.percent_used > 70 ? "#f59e0b" : "#10b981",
                        }} />
                      </div>
                      <div style={S.storageLabels}>
                        <span>{storageStats.total_gb} GB recordings</span>
                        <span>{storageStats.disk.free_gb} GB free / {storageStats.disk.total_gb} GB total</span>
                      </div>
                    </div>
                  )}
                  <div style={{ marginTop: 12 }}>
                    <div style={S.statRow}>
                      <span style={S.statLabel}>Segment files (continuous)</span>
                      <span style={S.statVal}>{storageStats.total_segments?.toLocaleString() ?? 0}</span>
                    </div>
                    <div style={S.statRow}>
                      <span style={S.statLabel}>Motion clip files</span>
                      <span style={S.statVal}>{storageStats.total_clips?.toLocaleString() ?? 0}</span>
                    </div>
                    <div style={S.statRow}>
                      <span style={S.statLabel}>Total MP4 files</span>
                      <span style={S.statVal}>{storageStats.total_files?.toLocaleString() ?? 0}</span>
                    </div>
                    <div style={S.statRow}>
                      <span style={S.statLabel}>Cameras with stored media</span>
                      <span style={S.statVal}>{storageStats.cameras?.length || 0}</span>
                    </div>
                    <div style={S.statRow}>
                      <span style={S.statLabel}>Continuous recording</span>
                      <span style={S.statVal}>{continuousRecCount}</span>
                    </div>
                    <div style={S.statRow}>
                      <span style={S.statLabel}>Motion / events only</span>
                      <span style={S.statVal}>{motionOnlyCount}</span>
                    </div>
                  </div>
                  {storageStats.cameras?.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ ...S.hint, marginBottom: 6 }}>Per Camera</div>
                      {storageStats.cameras.map((c) => (
                        <div key={c.camera_name} style={S.cameraStat}>
                          <span style={{ color: "#cbd5e1", fontSize: 12 }}>{c.camera_name}</span>
                          <span style={{ color: "#94a3b8", fontSize: 12 }}>
                            {c.segment_count || 0} seg · {c.clip_count || 0} clips · {c.total_gb} GB
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : pollError ? (
                <p style={{ color: "#f87171", fontSize: 12 }}>Could not load (see notice above).</p>
              ) : (
                <p style={{ color: "#64748b" }}>Loading storage stats...</p>
              )}
            </div>

            {/* ── Engine Status (visible to all) ── */}
            <div style={S.card}>
              <h3 style={S.cardTitle}>Engine Status</h3>
              {engineStatus ? (
                <>
                  {engineStatus.message && (
                    <p style={{ color: "#94a3b8", fontSize: 12, marginBottom: 10, lineHeight: 1.45 }}>
                      {engineStatus.message}
                    </p>
                  )}
                  {engineStatus.setup_complete_gate === false && (
                    <p style={{ color: "#f59e0b", fontSize: 12, marginBottom: 10 }}>
                      Complete recording setup before the engine will write segments.
                    </p>
                  )}
                  <div style={S.statRow}>
                    <span style={S.statLabel}>Status</span>
                    <span style={{
                      ...S.statVal,
                      color: engineStatus.engine_running ? "#10b981" : "#ef4444",
                    }}>
                      {engineStatus.engine_running ? "Running" : "Stopped"}
                    </span>
                  </div>
                  <div style={S.statRow}>
                    <span style={S.statLabel}>Active Processes</span>
                    <span style={S.statVal}>{engineStatus.active_recordings}</span>
                  </div>
                  <div style={S.statRow}>
                    <span style={S.statLabel}>Total Tracked</span>
                    <span style={S.statVal}>{engineStatus.total_processes}</span>
                  </div>
                  {engineStatus.config && (
                    <>
                      <div style={S.statRow}>
                        <span style={S.statLabel}>Source</span>
                        <span style={S.statVal}>{engineStatus.config.source}</span>
                      </div>
                      <div style={S.statRow}>
                        <span style={S.statLabel}>Segment Length</span>
                        <span style={S.statVal}>{engineStatus.config.segment_minutes} min</span>
                      </div>
                    </>
                  )}
                  {engineStatus.processes && Object.keys(engineStatus.processes).length > 0 && (
                    <div style={{ marginTop: 12, maxHeight: 200, overflowY: "auto" }}>
                      <div style={{ ...S.hint, marginBottom: 6 }}>Processes</div>
                      {Object.entries(engineStatus.processes).map(([name, p]) => (
                        <div key={name} style={S.processRow}>
                          <span style={{
                            width: 6, height: 6, borderRadius: 3,
                            background: p.running ? "#10b981" : "#ef4444",
                            flexShrink: 0,
                          }} />
                          <span style={{
                            color: "#cbd5e1", fontSize: 11, flex: 1,
                            overflow: "hidden", textOverflow: "ellipsis",
                          }}>
                            {name}
                          </span>
                          <span style={{ color: "#64748b", fontSize: 11 }}>
                            {p.running ? `${Math.floor(p.uptime_seconds / 60)}m` : `exit ${p.exit_code}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : pollError ? (
                <p style={{ color: "#f87171", fontSize: 12 }}>Could not load (see notice above).</p>
              ) : (
                <p style={{ color: "#64748b" }}>Loading...</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIMELINE
// ═══════════════════════════════════════════════════════════════════════════════
function Timeline({ segments, playing, onPlay, date }) {
  const ref = useRef(null);
  const segRects = segments.map((seg) => {
    const [h, m] = (seg.start || "00:00:00").split(":").map(Number);
    return { ...seg, startMin: h * 60 + m, dur: seg.duration || 60 };
  });

  const handleClick = (e) => {
    if (!ref.current || !segments.length) return;
    const rect = ref.current.getBoundingClientRect();
    const clickMin = ((e.clientX - rect.left) / rect.width) * 1440;
    let best = null, bestDist = Infinity;
    for (const seg of segRects) {
      const dist = Math.abs(clickMin - (seg.startMin + seg.dur / 120));
      if (dist < bestDist) { bestDist = dist; best = seg; }
    }
    if (best && bestDist < 30) onPlay(best);
  };

  return (
    <div style={S.timeline}>
      <div style={S.hourLabels}>
        {HOURS.map((h) => (
          <span key={h} style={S.hourLabel}>
            {h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`}
          </span>
        ))}
      </div>
      <div ref={ref} style={S.timelineTrack} onClick={handleClick}>
        {HOURS.map((h) => (
          <div key={h} style={{
            position: "absolute", left: `${(h / 24) * 100}%`,
            top: 0, bottom: 0, width: 1, background: "rgba(100,116,139,0.2)",
          }} />
        ))}
        {segRects.map((seg) => {
          const left = (seg.startMin / 1440) * 100;
          const width = Math.max((seg.dur / 86400) * 100, 0.15);
          const isActive = playing?.filename === seg.filename;
          return (
            <div key={seg.filename} title={`${seg.start} — ${fmtDur(seg.duration)}`} style={{
              position: "absolute", left: `${left}%`, width: `${width}%`,
              top: 2, bottom: 2, background: isActive ? "#f43f5e" : "#3b82f6",
              borderRadius: 2, cursor: "pointer", opacity: isActive ? 1 : 0.7,
            }} />
          );
        })}
        {date === toDateStr(new Date()) && (
          <div style={{
            position: "absolute",
            left: `${((new Date().getHours() * 60 + new Date().getMinutes()) / 1440) * 100}%`,
            top: 0, bottom: 0, width: 2, background: "#f43f5e", zIndex: 2,
          }} />
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CAMERA SIDEBAR ITEM
// ═══════════════════════════════════════════════════════════════════════════════
function CamItem({ cam, selected, onSelect, engineStatus }) {
  const proc = engineStatus?.processes?.[cam.name];
  const running = proc?.running;
  const isMotion =
    cam.recording_enabled && cam.recording_policy === "events_only";
  let dot = "#475569";
  if (running) dot = "#10b981";
  else if (isMotion) dot = "#22d3ee";
  else if (cam.recording_enabled) dot = "#f59e0b";

  return (
    <button
      onClick={onSelect}
      style={{ ...S.camItem, ...(selected ? S.camItemActive : {}) }}
    >
      <span style={{
        width: 7, height: 7, borderRadius: 4,
        background: dot,
        flexShrink: 0,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={S.camName}>{cam.display_name}</div>
        {isMotion && (
          <div style={{ fontSize: 10, color: "#67e8f9" }}>Motion</div>
        )}
        {running && proc?.uptime_seconds > 0 && (
          <div style={{ fontSize: 10, color: "#64748b" }}>
            {Math.floor(proc.uptime_seconds / 60)}m segment
          </div>
        )}
      </div>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════════════════════
const S = {
  page: {
    minHeight: "100vh", background: "#0f172a", color: "#e2e8f0",
    fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace",
  },
  header: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "14px 20px", borderBottom: "1px solid #1e293b",
    background: "#0f172a", position: "sticky", top: 0, zIndex: 20,
  },
  headerLeft: { display: "flex", alignItems: "center", gap: 10 },
  title: { fontSize: 18, fontWeight: 700, margin: 0, color: "#f8fafc" },
  badge: { fontSize: 11, padding: "3px 8px", borderRadius: 12, fontWeight: 600 },
  tabs: { display: "flex", gap: 2 },
  tab: {
    padding: "6px 16px", borderRadius: 6, border: "none",
    background: "transparent", color: "#94a3b8", cursor: "pointer",
    fontSize: 13, fontWeight: 500, fontFamily: "inherit",
  },
  tabActive: { background: "#1e293b", color: "#f8fafc" },
  // (toast styling is now handled by the shared ToastList component)

  // Setup
  setupWrap: {
    display: "flex", alignItems: "center", justifyContent: "center",
    minHeight: "100vh", padding: 20,
  },
  setupCard: {
    background: "#1e293b", borderRadius: 12, padding: 32,
    border: "1px solid #334155", maxWidth: 480, width: "100%",
    display: "flex", flexDirection: "column", alignItems: "center",
    textAlign: "center",
  },
  setupTitle: { fontSize: 20, fontWeight: 700, margin: "16px 0 8px", color: "#f8fafc" },
  setupDesc: { fontSize: 13, color: "#94a3b8", lineHeight: 1.6, margin: "0 0 20px" },
  setupInfo: { width: "100%", background: "#0f172a", borderRadius: 8, padding: 12 },
  setupInfoRow: {
    display: "flex", justifyContent: "space-between", padding: "4px 0",
    fontSize: 12,
  },

  // Permission banner
  permBanner: {
    display: "flex", alignItems: "center", gap: 8, padding: "10px 16px",
    background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)",
    borderRadius: 8, marginBottom: 16, fontSize: 12, color: "#fbbf24",
  },

  // Layout
  body: { display: "flex", height: "calc(100vh - 53px)" },
  sidebar: {
    width: 240, borderRight: "1px solid #1e293b", overflowY: "auto",
    padding: "8px 0", flexShrink: 0, background: "#0b1120",
  },
  main: { flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" },
  empty: {
    flex: 1, display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center",
  },

  // Search & sidebar
  search: {
    width: "calc(100% - 16px)", margin: "4px 8px 8px", padding: "7px 10px",
    background: "#1e293b", border: "1px solid #334155", borderRadius: 6,
    color: "#e2e8f0", fontSize: 12, outline: "none", fontFamily: "inherit",
  },
  sideLabel: {
    padding: "6px 12px", fontSize: 10, fontWeight: 700,
    color: "#64748b", textTransform: "uppercase", letterSpacing: 0.8,
  },
  sideNvrLabel: {
    padding: "4px 12px 2px",
    fontSize: 10,
    fontWeight: 600,
    color: "#475569",
    letterSpacing: 0.3,
  },
  camItem: {
    width: "100%", display: "flex", alignItems: "center", gap: 8,
    padding: "8px 12px", border: "none", background: "transparent",
    cursor: "pointer", textAlign: "left", fontFamily: "inherit",
  },
  camItemActive: { background: "#1e293b" },
  camName: {
    fontSize: 12, color: "#cbd5e1", whiteSpace: "nowrap",
    overflow: "hidden", textOverflow: "ellipsis",
  },

  // Player
  playerWrap: {
    background: "#000", aspectRatio: "16/9", maxHeight: "55vh",
    display: "flex", alignItems: "center", justifyContent: "center",
    position: "relative", flexShrink: 0,
  },
  video: { width: "100%", height: "100%", background: "#000" },
  playerPlaceholder: { display: "flex", flexDirection: "column", alignItems: "center" },

  // Speed controls
  speedBar: {
    display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
    padding: "6px 16px", background: "#0b1120", borderBottom: "1px solid #1e293b",
  },
  speedBtn: {
    padding: "4px 10px", borderRadius: 4, border: "1px solid #334155",
    background: "#1e293b", color: "#94a3b8", cursor: "pointer",
    fontSize: 12, fontWeight: 600, fontFamily: "inherit", transition: "all 0.1s",
    minWidth: 36, textAlign: "center",
  },
  speedBtnActive: {
    background: "#3b82f6", borderColor: "#3b82f6", color: "#fff",
  },
  speedFrameBtn: {
    padding: "4px 8px", borderRadius: 4, border: "1px solid #334155",
    background: "#1e293b", color: "#64748b", cursor: "pointer",
    fontSize: 10, fontFamily: "inherit", letterSpacing: -1,
  },
  playbackPrefs: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "12px 16px",
    padding: "8px 16px 10px",
    background: "#0b1120",
    borderBottom: "1px solid #1e293b",
    fontSize: 11,
    color: "#94a3b8",
  },
  playbackPrefItem: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    cursor: "pointer",
    userSelect: "none",
  },
  playbackPrefLabel: { color: "#64748b", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4 },
  playbackSelect: {
    padding: "3px 6px",
    borderRadius: 4,
    border: "1px solid #334155",
    background: "#1e293b",
    color: "#e2e8f0",
    fontSize: 11,
    fontFamily: "inherit",
    cursor: "pointer",
  },

  // Date nav
  dateNav: {
    display: "flex", alignItems: "center", gap: 8, padding: "10px 16px",
    borderBottom: "1px solid #1e293b",
  },
  dateBtn: {
    padding: "5px 10px", background: "#1e293b", border: "1px solid #334155",
    borderRadius: 5, color: "#94a3b8", cursor: "pointer", fontSize: 12, fontFamily: "inherit",
  },
  dateInput: {
    padding: "5px 10px", background: "#1e293b", border: "1px solid #334155",
    borderRadius: 5, color: "#e2e8f0", fontSize: 12, fontFamily: "inherit", colorScheme: "dark",
  },
  segCount: { marginLeft: "auto", color: "#64748b", fontSize: 12 },

  // Timeline
  timeline: { padding: "8px 16px 4px", borderBottom: "1px solid #1e293b" },
  hourLabels: { display: "flex", justifyContent: "space-between", marginBottom: 2 },
  hourLabel: { fontSize: 9, color: "#475569", width: `${100 / 24}%`, textAlign: "center" },
  timelineTrack: {
    position: "relative", height: 28, background: "#1e293b",
    borderRadius: 4, overflow: "hidden", cursor: "pointer",
  },

  // Segment list
  segList: { flex: 1, overflowY: "auto", padding: "0 16px 16px" },
  segItem: {
    width: "100%", display: "flex", alignItems: "center", gap: 12,
    padding: "8px 12px", border: "none", borderBottom: "1px solid #1e293b",
    background: "transparent", cursor: "pointer", fontFamily: "inherit", textAlign: "left",
  },
  segActive: { background: "rgba(244,63,94,0.1)" },
  segTime: { color: "#e2e8f0", fontSize: 13, fontWeight: 600, width: 80 },
  segDur: { color: "#94a3b8", fontSize: 12, width: 50 },
  segSize: { color: "#64748b", fontSize: 12 },

  // Settings
  settingsBody: { padding: 20, overflowY: "auto", height: "calc(100vh - 53px)" },
  settingsGrid: {
    display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))",
    gap: 16, maxWidth: 1200,
  },
  card: {
    background: "#1e293b", borderRadius: 10, padding: 20,
    border: "1px solid #334155",
  },
  cardTitle: { fontSize: 15, fontWeight: 700, margin: "0 0 14px", color: "#f8fafc" },
  form: { display: "flex", flexDirection: "column", gap: 14 },
  label: {
    display: "flex", flexDirection: "column", gap: 4,
    fontSize: 12, color: "#94a3b8", fontWeight: 600,
  },
  input: {
    padding: "8px 10px", background: "#0f172a", border: "1px solid #334155",
    borderRadius: 6, color: "#e2e8f0", fontSize: 13, fontFamily: "inherit", outline: "none",
  },
  hint: { fontSize: 11, color: "#475569", fontWeight: 400 },
  btnRow: { display: "flex", gap: 10, marginTop: 4 },
  btnPrimary: {
    padding: "8px 20px", background: "#3b82f6", border: "none",
    borderRadius: 6, color: "#fff", fontSize: 13, fontWeight: 600,
    cursor: "pointer", fontFamily: "inherit",
  },
  btnSecondary: {
    padding: "8px 20px", background: "#334155", border: "1px solid #475569",
    borderRadius: 6, color: "#e2e8f0", fontSize: 13, fontWeight: 600,
    cursor: "pointer", fontFamily: "inherit",
  },

  // Camera toggles
  camToggleList: { maxHeight: 480, overflowY: "auto", marginTop: 4 },
  nvrGroupSection: {
    marginBottom: 16,
    paddingBottom: 4,
    borderBottom: "1px solid rgba(51,65,85,0.5)",
  },
  nvrSiteBar: {
    background: "#0f172a",
    borderLeft: "4px solid #3b82f6",
    borderRadius: 6,
    padding: "10px 12px",
    marginBottom: 10,
    border: "1px solid #334155",
  },
  nvrGroupHeader: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: 12,
    rowGap: 10,
  },
  nvrSiteTitleRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flex: "1 1 0",
    minWidth: 0,
    maxWidth: "100%",
  },
  nvrSiteBadge: {
    fontSize: 9,
    fontWeight: 700,
    color: "#94a3b8",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    background: "#1e293b",
    padding: "3px 7px",
    borderRadius: 4,
    flexShrink: 0,
    border: "1px solid #334155",
  },
  nvrSiteName: {
    fontSize: 14,
    fontWeight: 700,
    color: "#f1f5f9",
    minWidth: 0,
    flex: "1 1 0",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  nvrSiteMeta: {
    fontSize: 11,
    color: "#64748b",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  /** Full-width row so Motion / Continuous / Off never collide with long site names. */
  nvrBulkBtnRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    flexShrink: 0,
    justifyContent: "flex-end",
    flexBasis: "100%",
  },
  nvrBulkBtn: {
    padding: "4px 10px",
    fontSize: 11,
    fontWeight: 600,
    fontFamily: "inherit",
    borderRadius: 5,
    border: "1px solid #475569",
    background: "#0f172a",
    color: "#cbd5e1",
    cursor: "pointer",
  },
  camToggleRow: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    gap: 12,
    padding: "8px 0", borderBottom: "1px solid rgba(51,65,85,0.5)",
  },
  recordingPolicySelect: {
    minWidth: 168,
    maxWidth: "55%",
    padding: "6px 8px",
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: 6,
    color: "#e2e8f0",
    fontSize: 12,
    fontFamily: "inherit",
    cursor: "pointer",
    flexShrink: 0,
  },
  toggle: {
    width: 40, height: 22, borderRadius: 11, border: "none",
    cursor: "pointer", position: "relative", transition: "background 0.2s", flexShrink: 0,
  },
  toggleDot: {
    width: 18, height: 18, borderRadius: 9, background: "#fff",
    position: "absolute", top: 2, transition: "transform 0.2s",
  },

  // Storage
  storageBar: { marginBottom: 8 },
  storageBarTrack: { height: 10, background: "#0f172a", borderRadius: 5, overflow: "hidden", marginBottom: 4 },
  storageBarFill: { height: "100%", borderRadius: 5, transition: "width 0.3s" },
  storageLabels: { display: "flex", justifyContent: "space-between", fontSize: 11, color: "#64748b" },
  statRow: {
    display: "flex", justifyContent: "space-between",
    padding: "5px 0", borderBottom: "1px solid rgba(51,65,85,0.3)",
  },
  statLabel: { fontSize: 12, color: "#94a3b8" },
  statVal: { fontSize: 12, color: "#e2e8f0", fontWeight: 600 },
  cameraStat: {
    display: "flex", justifyContent: "space-between",
    padding: "4px 0", borderBottom: "1px solid rgba(51,65,85,0.2)",
  },
  processRow: { display: "flex", alignItems: "center", gap: 6, padding: "3px 0" },
};