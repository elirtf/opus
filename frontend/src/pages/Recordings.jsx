import { useState, useEffect, useRef, useCallback } from "react";

// ── API helpers ──────────────────────────────────────────────────────────────
const api = async (url, opts = {}) => {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...opts.headers },
    ...opts,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json.data ?? json;
};

// ── Constants ────────────────────────────────────────────────────────────────
const HOURS = Array.from({ length: 24 }, (_, i) => i);

// ── Formatters ───────────────────────────────────────────────────────────────
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

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════
export default function RecordingsPage() {
  const [tab, setTab] = useState("playback"); // playback | settings
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
  const [toast, setToast] = useState(null);
  const [search, setSearch] = useState("");
  const videoRef = useRef(null);

  const showToast = useCallback((msg, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // ── Load cameras ────────────────────────────────────────────────────────
  useEffect(() => {
    api("/api/cameras/").then(setCameras).catch(() => {});
  }, []);

  // ── Load engine status ──────────────────────────────────────────────────
  useEffect(() => {
    const load = () => {
      api("/api/recordings/engine/status").then(setEngineStatus).catch(() => {});
      api("/api/recordings/storage").then(setStorageStats).catch(() => {});
    };
    load();
    const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, []);

  // ── Load timeline when camera/date changes ─────────────────────────────
  useEffect(() => {
    if (!selectedCam) { setTimeline([]); setSegments([]); return; }
    api(`/api/recordings/timeline?camera=${encodeURIComponent(selectedCam)}&date=${date}`)
      .then((d) => {
        const segs = d.cameras?.[selectedCam] || [];
        setTimeline(segs);
        setSegments(segs);
      })
      .catch(() => { setTimeline([]); setSegments([]); });
  }, [selectedCam, date]);

  // ── Load settings ───────────────────────────────────────────────────────
  useEffect(() => {
    if (tab === "settings") {
      api("/api/recordings/settings/").then(setSettings).catch(() => {});
    }
  }, [tab]);

  // ── Toggle recording on a camera ───────────────────────────────────────
  const toggleRecording = async (cam) => {
    try {
      await api(`/api/cameras/${cam.id}/recording`, {
        method: "POST",
        body: JSON.stringify({ enabled: !cam.recording_enabled }),
      });
      setCameras((prev) =>
        prev.map((c) =>
          c.id === cam.id ? { ...c, recording_enabled: !c.recording_enabled } : c
        )
      );
      showToast(`Recording ${!cam.recording_enabled ? "enabled" : "disabled"} for ${cam.display_name}`);
    } catch (e) {
      showToast(e.message, false);
    }
  };

  // ── Save settings ──────────────────────────────────────────────────────
  const saveSettings = async () => {
    setSaving(true);
    try {
      await api("/api/recordings/settings/", {
        method: "PUT",
        body: JSON.stringify(settings),
      });
      showToast("Settings saved");
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

  // ── Play a segment ─────────────────────────────────────────────────────
  const playSeg = (seg) => {
    const url = `/api/recordings/${encodeURIComponent(selectedCam)}/${seg.filename}`;
    setPlaying({ ...seg, url });
    if (videoRef.current) {
      videoRef.current.src = url;
      videoRef.current.play().catch(() => {});
    }
  };

  // ── Auto-advance to next segment ──────────────────────────────────────
  const onVideoEnded = () => {
    if (!playing || !segments.length) return;
    const idx = segments.findIndex((s) => s.filename === playing.filename);
    if (idx >= 0 && idx < segments.length - 1) {
      playSeg(segments[idx + 1]);
    }
  };

  // ── Filter cameras ─────────────────────────────────────────────────────
  const filtered = cameras.filter(
    (c) =>
      c.active &&
      (c.display_name.toLowerCase().includes(search.toLowerCase()) ||
        c.name.toLowerCase().includes(search.toLowerCase()))
  );
  const recordingCams = filtered.filter((c) => c.recording_enabled);
  const availableCams = filtered.filter((c) => !c.recording_enabled);

  // ── Date navigation ────────────────────────────────────────────────────
  const shiftDate = (days) => {
    const d = new Date(date + "T00:00:00");
    d.setDate(d.getDate() + days);
    setDate(toDateStr(d));
  };

  return (
    <div style={S.page}>
      {/* ── Toast ── */}
      {toast && (
        <div style={{ ...S.toast, background: toast.ok ? "#059669" : "#dc2626" }}>
          {toast.msg}
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
            <span style={{
              ...S.badge,
              background: engineStatus.engine_running ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)",
              color: engineStatus.engine_running ? "#10b981" : "#ef4444",
            }}>
              {engineStatus.active_recordings || 0} recording
            </span>
          )}
        </div>
        <div style={S.tabs}>
          {["playback", "settings"].map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                ...S.tab,
                ...(tab === t ? S.tabActive : {}),
              }}
            >
              {t === "playback" ? "Playback" : "Settings"}
            </button>
          ))}
        </div>
      </div>

      {tab === "playback" ? (
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
                {recordingCams.map((c) => (
                  <CamItem
                    key={c.id}
                    cam={c}
                    selected={selectedCam === c.name}
                    onSelect={() => setSelectedCam(c.name)}
                    engineStatus={engineStatus}
                  />
                ))}
              </>
            )}

            {availableCams.length > 0 && (
              <>
                <div style={{ ...S.sideLabel, marginTop: 16 }}>
                  Not Recording ({availableCams.length})
                </div>
                {availableCams.slice(0, 10).map((c) => (
                  <CamItem
                    key={c.id}
                    cam={c}
                    selected={selectedCam === c.name}
                    onSelect={() => setSelectedCam(c.name)}
                    engineStatus={engineStatus}
                  />
                ))}
                {availableCams.length > 10 && (
                  <div style={S.moreLabel}>+{availableCams.length - 10} more</div>
                )}
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
                <p style={{ color: "#94a3b8", marginTop: 12 }}>Select a camera to view recordings</p>
              </div>
            ) : (
              <>
                {/* ── Video player ── */}
                <div style={S.playerWrap}>
                  {playing ? (
                    <video
                      ref={videoRef}
                      controls
                      autoPlay
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
                      <p style={{ color: "#64748b", marginTop: 8 }}>
                        Click a segment on the timeline to play
                      </p>
                    </div>
                  )}
                </div>

                {/* ── Date nav ── */}
                <div style={S.dateNav}>
                  <button style={S.dateBtn} onClick={() => shiftDate(-1)}>◀</button>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    style={S.dateInput}
                  />
                  <button style={S.dateBtn} onClick={() => shiftDate(1)}>▶</button>
                  <button
                    style={S.dateBtn}
                    onClick={() => setDate(toDateStr(new Date()))}
                  >
                    Today
                  </button>
                  <span style={S.segCount}>
                    {segments.length} segment{segments.length !== 1 ? "s" : ""}
                  </span>
                </div>

                {/* ── Timeline ── */}
                <Timeline
                  segments={timeline}
                  playing={playing}
                  onPlay={playSeg}
                  date={date}
                />

                {/* ── Segment list ── */}
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
                        style={{
                          ...S.segItem,
                          ...(playing?.filename === seg.filename ? S.segActive : {}),
                        }}
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
        // ═══════════════════════════════════════════════════════════════════════
        // SETTINGS TAB
        // ═══════════════════════════════════════════════════════════════════════
        <div style={S.settingsBody}>
          <div style={S.settingsGrid}>
            {/* ── Recording Config ── */}
            <div style={S.card}>
              <h3 style={S.cardTitle}>Recording Configuration</h3>
              {settings ? (
                <div style={S.form}>
                  <label style={S.label}>
                    Segment Duration (minutes)
                    <input
                      type="number" min="1" max="60"
                      value={settings.segment_minutes || 1}
                      onChange={(e) => setSettings({ ...settings, segment_minutes: parseInt(e.target.value) || 1 })}
                      style={S.input}
                    />
                    <span style={S.hint}>How long each recording file will be</span>
                  </label>
                  <label style={S.label}>
                    Retention (days)
                    <input
                      type="number" min="1" max="3650"
                      value={settings.retention_days || 90}
                      onChange={(e) => setSettings({ ...settings, retention_days: parseInt(e.target.value) || 90 })}
                      style={S.input}
                    />
                    <span style={S.hint}>Auto-delete recordings older than this</span>
                  </label>
                  <label style={S.label}>
                    Max Storage (GB)
                    <input
                      type="number" min="0" step="10"
                      value={settings.max_storage_gb || 0}
                      onChange={(e) => setSettings({ ...settings, max_storage_gb: parseFloat(e.target.value) || 0 })}
                      style={S.input}
                    />
                    <span style={S.hint}>0 = unlimited. Oldest recordings deleted first when exceeded</span>
                  </label>
                  <label style={S.label}>
                    Recordings Directory
                    <input
                      type="text"
                      value={settings.recordings_dir || "/recordings"}
                      onChange={(e) => setSettings({ ...settings, recordings_dir: e.target.value })}
                      style={S.input}
                    />
                    <span style={S.hint}>Absolute path inside the container where recordings are stored</span>
                  </label>
                  <label style={S.label}>
                    Stagger Delay (seconds)
                    <input
                      type="number" min="0" max="30"
                      value={settings.stagger_seconds || 2}
                      onChange={(e) => setSettings({ ...settings, stagger_seconds: parseInt(e.target.value) || 0 })}
                      style={S.input}
                    />
                    <span style={S.hint}>Delay between starting each camera's FFmpeg process</span>
                  </label>
                  <div style={S.btnRow}>
                    <button style={S.btnPrimary} onClick={saveSettings} disabled={saving}>
                      {saving ? "Saving..." : "Save Settings"}
                    </button>
                    <button style={S.btnSecondary} onClick={restartEngine}>
                      Restart Engine
                    </button>
                  </div>
                </div>
              ) : (
                <p style={{ color: "#64748b" }}>Loading settings...</p>
              )}
            </div>

            {/* ── Camera Recording Toggles ── */}
            <div style={S.card}>
              <h3 style={S.cardTitle}>Camera Recording</h3>
              <p style={S.hint}>Toggle which cameras should record continuously</p>
              <div style={S.camToggleList}>
                {cameras
                  .filter((c) => c.active)
                  .sort((a, b) => a.display_name.localeCompare(b.display_name))
                  .map((cam) => (
                    <div key={cam.id} style={S.camToggleRow}>
                      <div>
                        <div style={{ color: "#e2e8f0", fontSize: 13 }}>{cam.display_name}</div>
                        <div style={{ color: "#64748b", fontSize: 11 }}>{cam.name}</div>
                      </div>
                      <button
                        onClick={() => toggleRecording(cam)}
                        style={{
                          ...S.toggle,
                          background: cam.recording_enabled ? "#059669" : "#334155",
                        }}
                      >
                        <div
                          style={{
                            ...S.toggleDot,
                            transform: cam.recording_enabled
                              ? "translateX(18px)"
                              : "translateX(2px)",
                          }}
                        />
                      </button>
                    </div>
                  ))}
              </div>
            </div>

            {/* ── Storage Stats ── */}
            <div style={S.card}>
              <h3 style={S.cardTitle}>Storage</h3>
              {storageStats ? (
                <>
                  {storageStats.disk && (
                    <div style={S.storageBar}>
                      <div style={S.storageBarTrack}>
                        <div
                          style={{
                            ...S.storageBarFill,
                            width: `${Math.min(storageStats.disk.percent_used, 100)}%`,
                            background:
                              storageStats.disk.percent_used > 90
                                ? "#ef4444"
                                : storageStats.disk.percent_used > 70
                                ? "#f59e0b"
                                : "#10b981",
                          }}
                        />
                      </div>
                      <div style={S.storageLabels}>
                        <span>{storageStats.total_gb} GB recordings</span>
                        <span>
                          {storageStats.disk.free_gb} GB free / {storageStats.disk.total_gb} GB total
                        </span>
                      </div>
                    </div>
                  )}
                  <div style={{ marginTop: 12 }}>
                    <div style={S.statRow}>
                      <span style={S.statLabel}>Total Segments</span>
                      <span style={S.statVal}>{storageStats.total_segments?.toLocaleString()}</span>
                    </div>
                    <div style={S.statRow}>
                      <span style={S.statLabel}>Cameras Recording</span>
                      <span style={S.statVal}>{storageStats.cameras?.length || 0}</span>
                    </div>
                  </div>
                  {storageStats.cameras?.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ ...S.hint, marginBottom: 6 }}>Per Camera</div>
                      {storageStats.cameras.map((c) => (
                        <div key={c.camera_name} style={S.cameraStat}>
                          <span style={{ color: "#cbd5e1", fontSize: 12 }}>{c.camera_name}</span>
                          <span style={{ color: "#94a3b8", fontSize: 12 }}>
                            {c.segment_count} segs · {c.total_gb} GB
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p style={{ color: "#64748b" }}>Loading storage stats...</p>
              )}
            </div>

            {/* ── Engine Status ── */}
            <div style={S.card}>
              <h3 style={S.cardTitle}>Engine Status</h3>
              {engineStatus ? (
                <>
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
                          <span style={{ color: "#cbd5e1", fontSize: 11, flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
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
// TIMELINE COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
function Timeline({ segments, playing, onPlay, date }) {
  const ref = useRef(null);

  // Map segments to pixel positions
  const segRects = segments.map((seg) => {
    const [h, m] = (seg.start || "00:00:00").split(":").map(Number);
    const startMin = h * 60 + m;
    const dur = seg.duration || 60;
    return { ...seg, startMin, dur };
  });

  const handleClick = (e) => {
    if (!ref.current || !segments.length) return;
    const rect = ref.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const totalMin = 1440;
    const clickMin = (x / rect.width) * totalMin;

    // Find the segment closest to where we clicked
    let best = null, bestDist = Infinity;
    for (const seg of segRects) {
      const segMid = seg.startMin + seg.dur / 120;
      const dist = Math.abs(clickMin - segMid);
      if (dist < bestDist) { bestDist = dist; best = seg; }
    }
    if (best && bestDist < 30) onPlay(best);
  };

  return (
    <div style={S.timeline}>
      {/* Hour labels */}
      <div style={S.hourLabels}>
        {HOURS.map((h) => (
          <span key={h} style={S.hourLabel}>
            {h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`}
          </span>
        ))}
      </div>
      {/* Track */}
      <div ref={ref} style={S.timelineTrack} onClick={handleClick}>
        {/* Hour gridlines */}
        {HOURS.map((h) => (
          <div
            key={h}
            style={{
              position: "absolute",
              left: `${(h / 24) * 100}%`,
              top: 0, bottom: 0, width: 1,
              background: "rgba(100,116,139,0.2)",
            }}
          />
        ))}
        {/* Segments */}
        {segRects.map((seg) => {
          const left = (seg.startMin / 1440) * 100;
          const width = Math.max((seg.dur / 86400) * 100, 0.15);
          const isActive = playing?.filename === seg.filename;
          return (
            <div
              key={seg.filename}
              title={`${seg.start} — ${fmtDur(seg.duration)}`}
              style={{
                position: "absolute",
                left: `${left}%`,
                width: `${width}%`,
                top: 2, bottom: 2,
                background: isActive ? "#f43f5e" : "#3b82f6",
                borderRadius: 2,
                cursor: "pointer",
                opacity: isActive ? 1 : 0.7,
                transition: "opacity 0.15s",
              }}
            />
          );
        })}
        {/* Now indicator */}
        {date === toDateStr(new Date()) && (
          <div
            style={{
              position: "absolute",
              left: `${((new Date().getHours() * 60 + new Date().getMinutes()) / 1440) * 100}%`,
              top: 0, bottom: 0, width: 2,
              background: "#f43f5e",
              zIndex: 2,
            }}
          />
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

  return (
    <button
      onClick={onSelect}
      style={{
        ...S.camItem,
        ...(selected ? S.camItemActive : {}),
      }}
    >
      <span style={{
        width: 7, height: 7, borderRadius: 4,
        background: running ? "#10b981" : cam.recording_enabled ? "#f59e0b" : "#475569",
        flexShrink: 0,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={S.camName}>{cam.display_name}</div>
        {running && proc?.uptime_seconds > 0 && (
          <div style={{ fontSize: 10, color: "#64748b" }}>
            {Math.floor(proc.uptime_seconds / 60)}m uptime
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
    minHeight: "100vh",
    background: "#0f172a",
    color: "#e2e8f0",
    fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 20px",
    borderBottom: "1px solid #1e293b",
    background: "#0f172a",
    position: "sticky",
    top: 0,
    zIndex: 20,
  },
  headerLeft: { display: "flex", alignItems: "center", gap: 10 },
  title: { fontSize: 18, fontWeight: 700, margin: 0, color: "#f8fafc" },
  badge: {
    fontSize: 11, padding: "3px 8px", borderRadius: 12,
    fontWeight: 600, letterSpacing: 0.3,
  },
  tabs: { display: "flex", gap: 2 },
  tab: {
    padding: "6px 16px", borderRadius: 6, border: "none",
    background: "transparent", color: "#94a3b8", cursor: "pointer",
    fontSize: 13, fontWeight: 500, fontFamily: "inherit",
    transition: "all 0.15s",
  },
  tabActive: { background: "#1e293b", color: "#f8fafc" },
  toast: {
    position: "fixed", top: 16, right: 16, zIndex: 999,
    padding: "10px 18px", borderRadius: 8, color: "#fff",
    fontSize: 13, fontWeight: 500, boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
    fontFamily: "'JetBrains Mono', monospace",
  },

  // ── Layout ──
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

  // ── Search ──
  search: {
    width: "calc(100% - 16px)", margin: "4px 8px 8px", padding: "7px 10px",
    background: "#1e293b", border: "1px solid #334155", borderRadius: 6,
    color: "#e2e8f0", fontSize: 12, outline: "none", fontFamily: "inherit",
  },
  sideLabel: {
    padding: "6px 12px", fontSize: 10, fontWeight: 700,
    color: "#64748b", textTransform: "uppercase", letterSpacing: 0.8,
  },
  moreLabel: {
    padding: "4px 12px", fontSize: 11, color: "#475569", fontStyle: "italic",
  },

  // ── Camera item ──
  camItem: {
    width: "100%", display: "flex", alignItems: "center", gap: 8,
    padding: "8px 12px", border: "none", background: "transparent",
    cursor: "pointer", textAlign: "left", fontFamily: "inherit",
    transition: "background 0.1s",
  },
  camItemActive: { background: "#1e293b" },
  camName: {
    fontSize: 12, color: "#cbd5e1", whiteSpace: "nowrap",
    overflow: "hidden", textOverflow: "ellipsis",
  },

  // ── Player ──
  playerWrap: {
    background: "#000", aspectRatio: "16/9", maxHeight: "55vh",
    display: "flex", alignItems: "center", justifyContent: "center",
    position: "relative", flexShrink: 0,
  },
  video: { width: "100%", height: "100%", background: "#000" },
  playerPlaceholder: {
    display: "flex", flexDirection: "column", alignItems: "center",
  },

  // ── Date nav ──
  dateNav: {
    display: "flex", alignItems: "center", gap: 8, padding: "10px 16px",
    borderBottom: "1px solid #1e293b",
  },
  dateBtn: {
    padding: "5px 10px", background: "#1e293b", border: "1px solid #334155",
    borderRadius: 5, color: "#94a3b8", cursor: "pointer", fontSize: 12,
    fontFamily: "inherit",
  },
  dateInput: {
    padding: "5px 10px", background: "#1e293b", border: "1px solid #334155",
    borderRadius: 5, color: "#e2e8f0", fontSize: 12, fontFamily: "inherit",
    colorScheme: "dark",
  },
  segCount: { marginLeft: "auto", color: "#64748b", fontSize: 12 },

  // ── Timeline ──
  timeline: { padding: "8px 16px 4px", borderBottom: "1px solid #1e293b" },
  hourLabels: {
    display: "flex", justifyContent: "space-between", marginBottom: 2,
  },
  hourLabel: { fontSize: 9, color: "#475569", width: `${100 / 24}%`, textAlign: "center" },
  timelineTrack: {
    position: "relative", height: 28, background: "#1e293b",
    borderRadius: 4, overflow: "hidden", cursor: "pointer",
  },

  // ── Segment list ──
  segList: { flex: 1, overflowY: "auto", padding: "0 16px 16px" },
  segItem: {
    width: "100%", display: "flex", alignItems: "center", gap: 12,
    padding: "8px 12px", border: "none", borderBottom: "1px solid #1e293b",
    background: "transparent", cursor: "pointer", fontFamily: "inherit",
    textAlign: "left", transition: "background 0.1s",
  },
  segActive: { background: "rgba(244,63,94,0.1)" },
  segTime: { color: "#e2e8f0", fontSize: 13, fontWeight: 600, width: 80 },
  segDur: { color: "#94a3b8", fontSize: 12, width: 50 },
  segSize: { color: "#64748b", fontSize: 12 },

  // ── Settings ──
  settingsBody: { padding: 20, overflowY: "auto", height: "calc(100vh - 53px)" },
  settingsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))",
    gap: 16,
    maxWidth: 1200,
  },
  card: {
    background: "#1e293b", borderRadius: 10, padding: 20,
    border: "1px solid #334155",
  },
  cardTitle: {
    fontSize: 15, fontWeight: 700, margin: "0 0 14px",
    color: "#f8fafc",
  },
  form: { display: "flex", flexDirection: "column", gap: 14 },
  label: {
    display: "flex", flexDirection: "column", gap: 4,
    fontSize: 12, color: "#94a3b8", fontWeight: 600,
  },
  input: {
    padding: "8px 10px", background: "#0f172a", border: "1px solid #334155",
    borderRadius: 6, color: "#e2e8f0", fontSize: 13, fontFamily: "inherit",
    outline: "none",
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

  // ── Camera toggle list ──
  camToggleList: { maxHeight: 360, overflowY: "auto", marginTop: 8 },
  camToggleRow: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "8px 0", borderBottom: "1px solid rgba(51,65,85,0.5)",
  },
  toggle: {
    width: 40, height: 22, borderRadius: 11, border: "none",
    cursor: "pointer", position: "relative", transition: "background 0.2s",
    flexShrink: 0,
  },
  toggleDot: {
    width: 18, height: 18, borderRadius: 9, background: "#fff",
    position: "absolute", top: 2, transition: "transform 0.2s",
  },

  // ── Storage ──
  storageBar: { marginBottom: 8 },
  storageBarTrack: {
    height: 10, background: "#0f172a", borderRadius: 5,
    overflow: "hidden", marginBottom: 4,
  },
  storageBarFill: { height: "100%", borderRadius: 5, transition: "width 0.3s" },
  storageLabels: {
    display: "flex", justifyContent: "space-between",
    fontSize: 11, color: "#64748b",
  },
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
  processRow: {
    display: "flex", alignItems: "center", gap: 6,
    padding: "3px 0",
  },
};