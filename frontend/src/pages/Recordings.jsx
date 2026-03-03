import { useState, useEffect, useRef, useCallback } from "react";

// ── API helpers ──────────────────────────────────────────────────────────────

const api = async (url, opts = {}) => {
  const res = await fetch(url, { credentials: "include", ...opts });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json.data;
};

const formatBytes = (bytes) => {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const formatDuration = (seconds) => {
  if (!seconds) return "--:--";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
};

const formatTime = (timeStr) => {
  if (!timeStr) return "";
  const [h, m] = timeStr.split(":");
  const hour = parseInt(h);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12}:${m} ${ampm}`;
};

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const currentMonthISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};


// ── Icons (inline SVG to avoid external deps) ───────────────────────────────

const Icon = ({ d, size = 18, className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" className={className}>
    <path d={d} />
  </svg>
);

const Icons = {
  back: "M19 12H5M12 19l-7-7 7-7",
  calendar: "M19 4H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2zM16 2v4M8 2v4M3 10h18",
  play: "M5 3l14 9-14 9V3z",
  pause: "M6 4h4v16H6zM14 4h4v16h-4z",
  download: "M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3",
  chevLeft: "M15 18l-6-6 6-6",
  chevRight: "M9 18l6-6-6-6",
  alert: "M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z",
  refresh: "M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15",
  x: "M18 6L6 18M6 6l12 12",
  server: "M2 2h20v8H2zM2 14h20v8H2zM6 6h.01M6 18h.01",
};


// ── Main Page Component ─────────────────────────────────────────────────────

export default function RecordingsPage() {
  // State
  const [cameras, setCameras] = useState([]);
  const [selectedCamera, setSelectedCamera] = useState(null);
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [currentMonth, setCurrentMonth] = useState(currentMonthISO());
  const [availableDates, setAvailableDates] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [activeSegment, setActiveSegment] = useState(null);
  const [engineStatus, setEngineStatus] = useState(null);
  const [storageStats, setStorageStats] = useState(null);
  const [loading, setLoading] = useState({ cameras: true, timeline: false, dates: false });
  const [error, setError] = useState(null);
  const [showSidebar, setShowSidebar] = useState(true);
  const [showEnginePanel, setShowEnginePanel] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playerTime, setPlayerTime] = useState(0);
  const [playerDuration, setPlayerDuration] = useState(0);
  const videoRef = useRef(null);

  // ── Load cameras ──────────────────────────────────────────────────────

  useEffect(() => {
    api("/api/cameras/")
      .then((cams) => {
        const mainCams = cams.filter(
          (c) => c.active && (c.is_main || (!c.name.endsWith("-sub")))
        );
        setCameras(mainCams);
        if (mainCams.length > 0 && !selectedCamera) {
          setSelectedCamera(mainCams[0].name);
        }
        setLoading((p) => ({ ...p, cameras: false }));
      })
      .catch((e) => {
        setError(`Failed to load cameras: ${e.message}`);
        setLoading((p) => ({ ...p, cameras: false }));
      });
  }, []);

  // ── Load available dates when camera or month changes ─────────────────

  useEffect(() => {
    if (!selectedCamera) return;
    setLoading((p) => ({ ...p, dates: true }));
    api(`/api/recordings/dates?camera=${selectedCamera}&month=${currentMonth}`)
      .then((data) => {
        setAvailableDates(data.dates || []);
        setLoading((p) => ({ ...p, dates: false }));
      })
      .catch(() => {
        setAvailableDates([]);
        setLoading((p) => ({ ...p, dates: false }));
      });
  }, [selectedCamera, currentMonth]);

  // ── Load timeline when camera or date changes ─────────────────────────

  useEffect(() => {
    if (!selectedCamera || !selectedDate) return;
    setLoading((p) => ({ ...p, timeline: true }));
    setActiveSegment(null);

    api(`/api/recordings/timeline?camera=${selectedCamera}&date=${selectedDate}`)
      .then((data) => {
        const segments = data.cameras?.[selectedCamera] || [];
        setTimeline(segments);
        setLoading((p) => ({ ...p, timeline: false }));
      })
      .catch(() => {
        setTimeline([]);
        setLoading((p) => ({ ...p, timeline: false }));
      });
  }, [selectedCamera, selectedDate]);

  // ── Load engine status ────────────────────────────────────────────────

  const loadEngineStatus = useCallback(() => {
    Promise.all([
      api("/api/recordings/engine/status").catch(() => null),
      api("/api/recordings/storage").catch(() => null),
    ]).then(([engine, storage]) => {
      setEngineStatus(engine);
      setStorageStats(storage);
    });
  }, []);

  useEffect(() => {
    loadEngineStatus();
    const interval = setInterval(loadEngineStatus, 15000);
    return () => clearInterval(interval);
  }, [loadEngineStatus]);

  // ── Video player handlers ─────────────────────────────────────────────

  const playSegment = (segment) => {
    setActiveSegment(segment);
    setIsPlaying(true);
  };

  useEffect(() => {
    if (!activeSegment || !videoRef.current) return;
    const url = `/api/recordings/${selectedCamera}/${activeSegment.filename}`;
    videoRef.current.src = url;
    videoRef.current.load();
    videoRef.current.play().catch(() => {});
  }, [activeSegment, selectedCamera]);

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setPlayerTime(videoRef.current.currentTime);
      setPlayerDuration(videoRef.current.duration || 0);
    }
  };

  const handleVideoEnd = () => {
    if (!activeSegment) return;
    const idx = timeline.findIndex((s) => s.filename === activeSegment.filename);
    if (idx >= 0 && idx < timeline.length - 1) {
      playSegment(timeline[idx + 1]);
    } else {
      setIsPlaying(false);
    }
  };

  const togglePlayPause = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  const seekTo = (e) => {
    if (!videoRef.current || !playerDuration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    videoRef.current.currentTime = pct * playerDuration;
  };

  const downloadSegment = (segment) => {
    const a = document.createElement("a");
    a.href = `/api/recordings/${selectedCamera}/${segment.filename}`;
    a.download = `${selectedCamera}_${segment.filename}`;
    a.click();
  };

  // ── Calendar helpers ──────────────────────────────────────────────────

  const [calYear, calMonth] = currentMonth.split("-").map(Number);

  const prevMonth = () => {
    const d = new Date(calYear, calMonth - 2, 1);
    setCurrentMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  const nextMonth = () => {
    const d = new Date(calYear, calMonth, 1);
    setCurrentMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  const daysInMonth = new Date(calYear, calMonth, 0).getDate();
  const firstDow = new Date(calYear, calMonth - 1, 1).getDay();
  const calendarDays = [];
  for (let i = 0; i < firstDow; i++) calendarDays.push(null);
  for (let d = 1; d <= daysInMonth; d++) calendarDays.push(d);

  const monthName = new Date(calYear, calMonth - 1).toLocaleString("default", { month: "long" });

  // ── Timeline visualization ────────────────────────────────────────────

  const hours = Array.from({ length: 24 }, (_, i) => i);

  const getSegmentPosition = (segment) => {
    if (!segment.start) return null;
    const [h, m, s] = segment.start.split(":").map(Number);
    const startMin = h * 60 + m + s / 60;
    let durationMin = (segment.duration || 900) / 60;
    return {
      left: `${(startMin / 1440) * 100}%`,
      width: `${Math.max((durationMin / 1440) * 100, 0.3)}%`,
    };
  };


  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div style={{
      minHeight: "100vh",
      backgroundColor: "#0a0e17",
      color: "#c8cdd8",
      fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
      display: "flex",
      flexDirection: "column",
    }}>

      {/* ── Top Bar ─────────────────────────────────────────────────────── */}
      <header style={{
        height: 52,
        backgroundColor: "#0d1220",
        borderBottom: "1px solid #1a2236",
        display: "flex",
        alignItems: "center",
        padding: "0 16px",
        gap: 12,
        flexShrink: 0,
        zIndex: 20,
      }}>
        <a href="/" style={{
          color: "#64748b",
          textDecoration: "none",
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 13,
          transition: "color 0.15s",
        }}
          onMouseEnter={(e) => e.currentTarget.style.color = "#94a3b8"}
          onMouseLeave={(e) => e.currentTarget.style.color = "#64748b"}
        >
          <Icon d={Icons.back} size={16} />
          <span>Live View</span>
        </a>

        <div style={{ width: 1, height: 24, backgroundColor: "#1a2236" }} />

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 8, height: 8, borderRadius: "50%",
            backgroundColor: engineStatus?.engine_running ? "#22c55e" : "#ef4444",
            boxShadow: engineStatus?.engine_running
              ? "0 0 8px rgba(34,197,94,0.5)"
              : "0 0 8px rgba(239,68,68,0.5)",
          }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0", letterSpacing: "0.02em" }}>
            RECORDINGS
          </span>
        </div>

        <div style={{ flex: 1 }} />

        {engineStatus && (
          <button
            onClick={() => setShowEnginePanel(!showEnginePanel)}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "4px 10px",
              backgroundColor: showEnginePanel ? "#1e293b" : "transparent",
              border: "1px solid #1a2236", borderRadius: 6,
              color: "#94a3b8", fontSize: 11, cursor: "pointer",
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "#1e293b";
              e.currentTarget.style.borderColor = "#2d3a52";
            }}
            onMouseLeave={(e) => {
              if (!showEnginePanel) {
                e.currentTarget.style.backgroundColor = "transparent";
                e.currentTarget.style.borderColor = "#1a2236";
              }
            }}
          >
            <Icon d={Icons.server} size={13} />
            <span>{engineStatus.active_recordings} recording</span>
            {storageStats && (
              <span style={{ color: "#64748b" }}>· {storageStats.total_gb} GB</span>
            )}
          </button>
        )}
      </header>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* ── Sidebar ───────────────────────────────────────────────────── */}
        <aside style={{
          width: showSidebar ? 280 : 0,
          backgroundColor: "#0d1220",
          borderRight: showSidebar ? "1px solid #1a2236" : "none",
          overflow: "hidden",
          transition: "width 0.2s ease",
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
        }}>
          <div style={{ padding: 16, overflowY: "auto", flex: 1 }}>

            {/* Camera selector */}
            <div style={{ marginBottom: 20 }}>
              <label style={{
                fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
                color: "#64748b", textTransform: "uppercase",
                display: "block", marginBottom: 8,
              }}>Camera</label>
              <div style={{
                display: "flex", flexDirection: "column", gap: 2,
                maxHeight: 200, overflowY: "auto",
              }}>
                {loading.cameras ? (
                  <div style={{ color: "#475569", fontSize: 12, padding: 8 }}>Loading cameras...</div>
                ) : cameras.length === 0 ? (
                  <div style={{ color: "#475569", fontSize: 12, padding: 8 }}>No cameras found</div>
                ) : cameras.map((cam) => {
                  const isSelected = cam.name === selectedCamera;
                  const isRecording = engineStatus?.processes?.[cam.name]?.running;
                  return (
                    <button
                      key={cam.id}
                      onClick={() => setSelectedCamera(cam.name)}
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        padding: "8px 10px",
                        backgroundColor: isSelected ? "#1e293b" : "transparent",
                        border: "none", borderRadius: 6,
                        color: isSelected ? "#e2e8f0" : "#94a3b8",
                        fontSize: 12, cursor: "pointer", textAlign: "left",
                        transition: "all 0.1s",
                        borderLeft: isSelected ? "2px solid #3b82f6" : "2px solid transparent",
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected) e.currentTarget.style.backgroundColor = "#111827";
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected) e.currentTarget.style.backgroundColor = "transparent";
                      }}
                    >
                      {isRecording && (
                        <div style={{
                          width: 6, height: 6, borderRadius: "50%",
                          backgroundColor: "#ef4444", flexShrink: 0,
                          animation: "pulse 2s ease-in-out infinite",
                        }} />
                      )}
                      <span style={{
                        overflow: "hidden", textOverflow: "ellipsis",
                        whiteSpace: "nowrap", flex: 1,
                      }}>{cam.display_name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Calendar */}
            <div>
              <label style={{
                fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
                color: "#64748b", textTransform: "uppercase",
                display: "block", marginBottom: 8,
              }}>Date</label>

              <div style={{
                display: "flex", alignItems: "center",
                justifyContent: "space-between", marginBottom: 8,
              }}>
                <button onClick={prevMonth} style={{
                  background: "none", border: "none", color: "#64748b",
                  cursor: "pointer", padding: 4, borderRadius: 4,
                  display: "flex", alignItems: "center",
                }}><Icon d={Icons.chevLeft} size={16} /></button>
                <span style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>
                  {monthName} {calYear}
                </span>
                <button onClick={nextMonth} style={{
                  background: "none", border: "none", color: "#64748b",
                  cursor: "pointer", padding: 4, borderRadius: 4,
                  display: "flex", alignItems: "center",
                }}><Icon d={Icons.chevRight} size={16} /></button>
              </div>

              <div style={{
                display: "grid", gridTemplateColumns: "repeat(7, 1fr)",
                gap: 1, marginBottom: 4,
              }}>
                {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                  <div key={d} style={{
                    textAlign: "center", fontSize: 9, color: "#475569",
                    fontWeight: 600, padding: "4px 0",
                    textTransform: "uppercase", letterSpacing: "0.05em",
                  }}>{d}</div>
                ))}
              </div>

              <div style={{
                display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1,
              }}>
                {calendarDays.map((day, i) => {
                  if (day === null) return <div key={`empty-${i}`} />;
                  const dateStr = `${calYear}-${String(calMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                  const hasRecording = availableDates.includes(dateStr);
                  const isSelected = dateStr === selectedDate;
                  const isToday = dateStr === todayISO();
                  return (
                    <button
                      key={day}
                      onClick={() => hasRecording && setSelectedDate(dateStr)}
                      disabled={!hasRecording}
                      style={{
                        width: "100%", aspectRatio: "1",
                        display: "flex", flexDirection: "column",
                        alignItems: "center", justifyContent: "center",
                        gap: 2, fontSize: 11,
                        fontWeight: isSelected ? 700 : 400,
                        borderRadius: 6,
                        border: isToday ? "1px solid #1e3a5f" : "1px solid transparent",
                        backgroundColor: isSelected ? "#1e40af" : "transparent",
                        color: isSelected ? "#fff" : hasRecording ? "#e2e8f0" : "#2d3748",
                        cursor: hasRecording ? "pointer" : "default",
                        transition: "all 0.1s",
                        position: "relative",
                      }}
                      onMouseEnter={(e) => {
                        if (hasRecording && !isSelected) e.currentTarget.style.backgroundColor = "#1e293b";
                      }}
                      onMouseLeave={(e) => {
                        if (hasRecording && !isSelected) e.currentTarget.style.backgroundColor = "transparent";
                      }}
                    >
                      {day}
                      {hasRecording && !isSelected && (
                        <div style={{
                          width: 4, height: 4, borderRadius: "50%",
                          backgroundColor: "#3b82f6",
                          position: "absolute", bottom: 3,
                        }} />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Storage stats */}
            {storageStats && (
              <div style={{
                marginTop: 20, padding: 12,
                backgroundColor: "#111827", borderRadius: 8,
                border: "1px solid #1a2236",
              }}>
                <div style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
                  color: "#64748b", textTransform: "uppercase", marginBottom: 8,
                }}>Storage</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#e2e8f0", marginBottom: 4 }}>
                  {storageStats.total_gb} <span style={{ fontSize: 12, color: "#64748b" }}>GB</span>
                </div>
                <div style={{ fontSize: 11, color: "#64748b" }}>
                  {storageStats.total_segments} segments · {storageStats.cameras?.length || 0} cameras
                </div>
                {storageStats.disk && (
                  <>
                    <div style={{
                      marginTop: 8, height: 4,
                      backgroundColor: "#1e293b", borderRadius: 2, overflow: "hidden",
                    }}>
                      <div style={{
                        height: "100%",
                        width: `${storageStats.disk.percent_used}%`,
                        backgroundColor: storageStats.disk.percent_used > 90 ? "#ef4444" :
                          storageStats.disk.percent_used > 70 ? "#f59e0b" : "#3b82f6",
                        borderRadius: 2, transition: "width 0.3s ease",
                      }} />
                    </div>
                    <div style={{ fontSize: 10, color: "#475569", marginTop: 4 }}>
                      {storageStats.disk.free_gb} GB free of {storageStats.disk.total_gb} GB
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </aside>

        {/* ── Main content ──────────────────────────────────────────────── */}
        <main style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

          {/* Sidebar toggle */}
          <button
            onClick={() => setShowSidebar(!showSidebar)}
            style={{
              position: "absolute",
              left: showSidebar ? 280 : 0, top: 64, zIndex: 10,
              width: 20, height: 40,
              backgroundColor: "#1e293b",
              border: "1px solid #2d3a52", borderLeft: "none",
              borderRadius: "0 6px 6px 0",
              color: "#64748b", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "left 0.2s ease",
            }}
          >
            <Icon d={showSidebar ? Icons.chevLeft : Icons.chevRight} size={14} />
          </button>

          {/* Error banner */}
          {error && (
            <div style={{
              padding: "10px 16px",
              backgroundColor: "#1c1017",
              borderBottom: "1px solid #3b1520",
              color: "#fca5a5", fontSize: 12,
              display: "flex", alignItems: "center", gap: 8,
            }}>
              <Icon d={Icons.alert} size={14} />
              <span>{error}</span>
              <button onClick={() => setError(null)} style={{
                marginLeft: "auto", background: "none",
                border: "none", color: "#fca5a5", cursor: "pointer",
              }}><Icon d={Icons.x} size={14} /></button>
            </div>
          )}

          {/* Video player area */}
          <div style={{
            flex: 1, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            backgroundColor: "#000", position: "relative", minHeight: 0,
          }}>
            {activeSegment ? (
              <>
                <video
                  ref={videoRef}
                  onTimeUpdate={handleTimeUpdate}
                  onEnded={handleVideoEnd}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onClick={togglePlayPause}
                  style={{
                    maxWidth: "100%", maxHeight: "100%",
                    objectFit: "contain", cursor: "pointer",
                  }}
                />

                {/* Top-left info overlay */}
                <div style={{
                  position: "absolute", top: 12, left: 16,
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "4px 10px",
                  backgroundColor: "rgba(0,0,0,0.7)",
                  borderRadius: 6, backdropFilter: "blur(8px)",
                }}>
                  <div style={{
                    width: 6, height: 6, borderRadius: "50%",
                    backgroundColor: "#3b82f6",
                  }} />
                  <span style={{ fontSize: 11, color: "#e2e8f0" }}>{selectedCamera}</span>
                  <span style={{ fontSize: 11, color: "#64748b" }}>
                    {selectedDate} · {activeSegment.start}
                  </span>
                </div>

                {/* Download button */}
                <button
                  onClick={() => downloadSegment(activeSegment)}
                  style={{
                    position: "absolute", top: 12, right: 16,
                    padding: "6px 12px",
                    backgroundColor: "rgba(0,0,0,0.7)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 6, color: "#94a3b8", fontSize: 11,
                    cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
                    backdropFilter: "blur(8px)", transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = "#e2e8f0";
                    e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = "#94a3b8";
                    e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
                  }}
                >
                  <Icon d={Icons.download} size={13} />
                  Download
                </button>

                {/* Progress bar */}
                <div style={{
                  position: "absolute", bottom: 0, left: 0, right: 0,
                  padding: "8px 16px",
                  background: "linear-gradient(transparent, rgba(0,0,0,0.8))",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <button onClick={togglePlayPause} style={{
                      background: "none", border: "none", color: "#e2e8f0",
                      cursor: "pointer", padding: 4, display: "flex",
                    }}>
                      <Icon d={isPlaying ? Icons.pause : Icons.play} size={18} />
                    </button>

                    <div
                      onClick={seekTo}
                      style={{
                        flex: 1, height: 6,
                        backgroundColor: "rgba(255,255,255,0.15)",
                        borderRadius: 3, cursor: "pointer",
                        position: "relative", overflow: "hidden",
                      }}
                    >
                      <div style={{
                        height: "100%",
                        width: playerDuration ? `${(playerTime / playerDuration) * 100}%` : "0%",
                        backgroundColor: "#3b82f6",
                        borderRadius: 3, transition: "width 0.1s linear",
                      }} />
                    </div>

                    <span style={{ fontSize: 11, color: "#94a3b8", minWidth: 80, textAlign: "right" }}>
                      {Math.floor(playerTime / 60)}:{String(Math.floor(playerTime % 60)).padStart(2, "0")}
                      {" / "}
                      {Math.floor(playerDuration / 60)}:{String(Math.floor(playerDuration % 60)).padStart(2, "0")}
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <div style={{
                display: "flex", flexDirection: "column",
                alignItems: "center", gap: 12, color: "#334155",
              }}>
                <Icon d={Icons.play} size={48} />
                <span style={{ fontSize: 13 }}>
                  {loading.timeline
                    ? "Loading recordings..."
                    : timeline.length > 0
                      ? "Select a segment below to start playback"
                      : selectedCamera
                        ? "No recordings found for this date"
                        : "Select a camera to get started"
                  }
                </span>
              </div>
            )}
          </div>

          {/* ── Timeline bar ──────────────────────────────────────────────── */}
          <div style={{
            backgroundColor: "#0d1220",
            borderTop: "1px solid #1a2236",
            flexShrink: 0,
          }}>
            {/* 24-hour visual timeline */}
            <div style={{ padding: "12px 16px 4px" }}>
              <div style={{ position: "relative", height: 32, marginBottom: 4 }}>
                {/* Hour grid lines */}
                {hours.map((h) => (
                  <div key={h} style={{
                    position: "absolute",
                    left: `${(h / 24) * 100}%`, top: 0, bottom: 0, width: 1,
                    backgroundColor: h % 6 === 0 ? "#1e293b" : "#141c2e",
                  }} />
                ))}

                {/* Recording segments on the timeline */}
                {timeline.map((seg, i) => {
                  const pos = getSegmentPosition(seg);
                  if (!pos) return null;
                  const isActive = activeSegment?.filename === seg.filename;
                  return (
                    <button
                      key={i}
                      onClick={() => playSegment(seg)}
                      title={`${formatTime(seg.start)} — ${formatDuration(seg.duration)}`}
                      style={{
                        position: "absolute", top: 4, bottom: 4,
                        left: pos.left, width: pos.width, minWidth: 4,
                        backgroundColor: isActive ? "#3b82f6" : "#1e40af",
                        borderRadius: 3,
                        border: isActive ? "1px solid #60a5fa" : "1px solid transparent",
                        cursor: "pointer",
                        transition: "background-color 0.15s, border-color 0.15s",
                        zIndex: 1,
                      }}
                      onMouseEnter={(e) => {
                        if (!isActive) e.currentTarget.style.backgroundColor = "#2563eb";
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive) e.currentTarget.style.backgroundColor = "#1e40af";
                      }}
                    />
                  );
                })}

                {/* "Now" marker for today */}
                {selectedDate === todayISO() && (() => {
                  const now = new Date();
                  const pct = ((now.getHours() * 60 + now.getMinutes()) / 1440) * 100;
                  return (
                    <div style={{
                      position: "absolute",
                      left: `${pct}%`, top: 0, bottom: -4,
                      width: 2, backgroundColor: "#ef4444",
                      zIndex: 2, borderRadius: 1,
                    }}>
                      <div style={{
                        position: "absolute", top: -3, left: -3,
                        width: 8, height: 8, borderRadius: "50%",
                        backgroundColor: "#ef4444",
                      }} />
                    </div>
                  );
                })()}
              </div>

              {/* Hour labels */}
              <div style={{ position: "relative", height: 16 }}>
                {hours.filter((h) => h % 3 === 0).map((h) => (
                  <span key={h} style={{
                    position: "absolute",
                    left: `${(h / 24) * 100}%`,
                    transform: "translateX(-50%)",
                    fontSize: 9, color: "#475569", fontWeight: 500,
                  }}>
                    {h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`}
                  </span>
                ))}
              </div>
            </div>

            {/* Segment pill list */}
            {timeline.length > 0 && (
              <div style={{
                display: "flex", gap: 4,
                padding: "4px 16px 12px",
                overflowX: "auto",
              }}>
                {timeline.map((seg, i) => {
                  const isActive = activeSegment?.filename === seg.filename;
                  return (
                    <button
                      key={i}
                      onClick={() => playSegment(seg)}
                      style={{
                        display: "flex", alignItems: "center", gap: 6,
                        padding: "6px 10px",
                        backgroundColor: isActive ? "#1e3a5f" : "#111827",
                        border: isActive ? "1px solid #2563eb" : "1px solid #1a2236",
                        borderRadius: 6,
                        color: isActive ? "#93c5fd" : "#94a3b8",
                        fontSize: 11, cursor: "pointer",
                        whiteSpace: "nowrap", flexShrink: 0,
                        transition: "all 0.1s",
                      }}
                      onMouseEnter={(e) => {
                        if (!isActive) {
                          e.currentTarget.style.backgroundColor = "#1e293b";
                          e.currentTarget.style.borderColor = "#2d3a52";
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isActive) {
                          e.currentTarget.style.backgroundColor = "#111827";
                          e.currentTarget.style.borderColor = "#1a2236";
                        }
                      }}
                    >
                      <Icon d={isActive && isPlaying ? Icons.pause : Icons.play} size={12} />
                      <span>{formatTime(seg.start)}</span>
                      <span style={{ color: "#475569" }}>{formatDuration(seg.duration)}</span>
                      <span style={{ color: "#334155" }}>{seg.size_mb}MB</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </main>

        {/* ── Engine status panel ────────────────────────────────────────── */}
        {showEnginePanel && engineStatus && (
          <aside style={{
            width: 320,
            backgroundColor: "#0d1220",
            borderLeft: "1px solid #1a2236",
            overflowY: "auto", flexShrink: 0,
          }}>
            <div style={{ padding: 16 }}>
              <div style={{
                display: "flex", alignItems: "center",
                justifyContent: "space-between", marginBottom: 16,
              }}>
                <span style={{
                  fontSize: 12, fontWeight: 700, color: "#e2e8f0",
                  letterSpacing: "0.02em",
                }}>ENGINE STATUS</span>
                <button onClick={() => setShowEnginePanel(false)} style={{
                  background: "none", border: "none", color: "#64748b",
                  cursor: "pointer", display: "flex",
                }}><Icon d={Icons.x} size={16} /></button>
              </div>

              {/* Config card */}
              <div style={{
                padding: 12, backgroundColor: "#111827",
                borderRadius: 8, border: "1px solid #1a2236", marginBottom: 12,
              }}>
                <div style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
                  color: "#64748b", textTransform: "uppercase", marginBottom: 8,
                }}>Config</div>
                {[
                  ["Segment length", `${engineStatus.config?.segment_minutes} min`],
                  ["Retention", `${engineStatus.config?.retention_days} days`],
                  ["Storage cap", engineStatus.config?.max_storage_gb ? `${engineStatus.config.max_storage_gb} GB` : "Unlimited"],
                  ["Source", engineStatus.config?.source === "go2rtc_relay" ? "go2rtc relay" : "Direct RTSP"],
                ].map(([label, value]) => (
                  <div key={label} style={{
                    display: "flex", justifyContent: "space-between",
                    fontSize: 11, padding: "3px 0",
                    borderBottom: "1px solid #141c2e",
                  }}>
                    <span style={{ color: "#64748b" }}>{label}</span>
                    <span style={{ color: "#94a3b8" }}>{value}</span>
                  </div>
                ))}
              </div>

              {/* Processes card */}
              <div style={{
                padding: 12, backgroundColor: "#111827",
                borderRadius: 8, border: "1px solid #1a2236", marginBottom: 12,
              }}>
                <div style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
                  color: "#64748b", textTransform: "uppercase", marginBottom: 8,
                }}>
                  Processes ({engineStatus.active_recordings}/{engineStatus.total_processes})
                </div>
                {Object.entries(engineStatus.processes || {}).length === 0 ? (
                  <div style={{ fontSize: 11, color: "#475569" }}>No active recordings</div>
                ) : Object.entries(engineStatus.processes || {}).map(([name, proc]) => (
                  <div key={name} style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "6px 0", borderBottom: "1px solid #141c2e",
                  }}>
                    <div style={{
                      width: 6, height: 6, borderRadius: "50%",
                      backgroundColor: proc.running ? "#22c55e" : "#ef4444",
                      flexShrink: 0,
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 11, color: "#e2e8f0",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>{name}</div>
                      <div style={{ fontSize: 10, color: "#475569" }}>
                        PID {proc.pid}
                        {proc.running && ` · ${formatDuration(proc.uptime_seconds)}`}
                        {!proc.running && ` · exit ${proc.exit_code}`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Storage breakdown */}
              {storageStats?.cameras && (
                <div style={{
                  padding: 12, backgroundColor: "#111827",
                  borderRadius: 8, border: "1px solid #1a2236",
                }}>
                  <div style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
                    color: "#64748b", textTransform: "uppercase", marginBottom: 8,
                  }}>Storage by Camera</div>
                  {storageStats.cameras.map((cam) => (
                    <div key={cam.camera_name} style={{
                      display: "flex", justifyContent: "space-between",
                      alignItems: "center", padding: "5px 0",
                      borderBottom: "1px solid #141c2e",
                    }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{
                          fontSize: 11, color: "#94a3b8",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>{cam.camera_name}</div>
                        <div style={{ fontSize: 10, color: "#475569" }}>
                          {cam.segment_count} segments
                        </div>
                      </div>
                      <span style={{ fontSize: 11, color: "#e2e8f0", fontWeight: 600, flexShrink: 0 }}>
                        {cam.total_gb} GB
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={loadEngineStatus}
                style={{
                  width: "100%", marginTop: 12, padding: "8px 0",
                  backgroundColor: "#111827",
                  border: "1px solid #1a2236", borderRadius: 6,
                  color: "#64748b", fontSize: 11, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                  transition: "all 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "#2d3a52";
                  e.currentTarget.style.color = "#94a3b8";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "#1a2236";
                  e.currentTarget.style.color = "#64748b";
                }}
              >
                <Icon d={Icons.refresh} size={13} />
                Refresh
              </button>
            </div>
          </aside>
        )}
      </div>

      {/* Global styles */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #0a0e17; }
        ::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #2d3a52; }
        * { box-sizing: border-box; }
      `}</style>
    </div>
  );
}