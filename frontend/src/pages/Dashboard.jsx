import { useState, useEffect, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { camerasApi } from '../api/cameras'
import { healthApi } from '../api/health'
import Spinner from '../components/Spinner'
import { useAuth } from '../context/AuthContext'

const GRID_OPTIONS = [
  { cols: 1, label: '1×1', icon: (
    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="currentColor">
      <rect x="2" y="2" width="12" height="12" rx="1"/>
    </svg>
  )},
  { cols: 2, label: '2×2', icon: (
    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="currentColor">
      <rect x="2" y="2" width="5.5" height="5.5" rx="0.75"/><rect x="8.5" y="2" width="5.5" height="5.5" rx="0.75"/>
      <rect x="2" y="8.5" width="5.5" height="5.5" rx="0.75"/><rect x="8.5" y="8.5" width="5.5" height="5.5" rx="0.75"/>
    </svg>
  )},
  { cols: 3, label: '3×3', icon: (
    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="currentColor">
      <rect x="1" y="1" width="4" height="4" rx="0.5"/><rect x="6" y="1" width="4" height="4" rx="0.5"/><rect x="11" y="1" width="4" height="4" rx="0.5"/>
      <rect x="1" y="6" width="4" height="4" rx="0.5"/><rect x="6" y="6" width="4" height="4" rx="0.5"/><rect x="11" y="6" width="4" height="4" rx="0.5"/>
      <rect x="1" y="11" width="4" height="4" rx="0.5"/><rect x="6" y="11" width="4" height="4" rx="0.5"/><rect x="11" y="11" width="4" height="4" rx="0.5"/>
    </svg>
  )},
  { cols: 4, label: '4×4', icon: (
    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="currentColor">
      <rect x="1" y="1" width="3" height="3" rx="0.4"/><rect x="5" y="1" width="3" height="3" rx="0.4"/><rect x="9" y="1" width="3" height="3" rx="0.4"/><rect x="13" y="1" width="3" height="3" rx="0.4"/>
      <rect x="1" y="5" width="3" height="3" rx="0.4"/><rect x="5" y="5" width="3" height="3" rx="0.4"/><rect x="9" y="5" width="3" height="3" rx="0.4"/><rect x="13" y="5" width="3" height="3" rx="0.4"/>
      <rect x="1" y="9" width="3" height="3" rx="0.4"/><rect x="5" y="9" width="3" height="3" rx="0.4"/><rect x="9" y="9" width="3" height="3" rx="0.4"/><rect x="13" y="9" width="3" height="3" rx="0.4"/>
      <rect x="1" y="13" width="3" height="3" rx="0.4"/><rect x="5" y="13" width="3" height="3" rx="0.4"/><rect x="9" y="13" width="3" height="3" rx="0.4"/><rect x="13" y="13" width="3" height="3" rx="0.4"/>
    </svg>
  )},
  { cols: 6, label: '6×6', icon: (
    <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="currentColor">
      {[0,1,2,3,4,5].map(r => [0,1,2,3,4,5].map(c => (
        <rect key={`${r}-${c}`} x={c*2.5+0.5} y={r*2.5+0.5} width="1.8" height="1.8" rx="0.2"/>
      )))}
    </svg>
  )},
]

const HEALTH_POLL_MS = 30000

function StatusDot({ online }) {
  return (
    <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${
      online === true  ? 'bg-green-400' :
      online === false ? 'bg-red-500'   :
      'bg-gray-600'
    }`} />
  )
}

function CameraTile({ cam, streamName, online, onClick }) {
  const iframeRef = useRef(null)

  useEffect(() => {
    return () => { if (iframeRef.current) iframeRef.current.src = '' }
  }, [])

  useEffect(() => {
    if (iframeRef.current) {
      iframeRef.current.src = `/go2rtc/stream.html?src=${streamName}&mode=mse`
    }
  }, [streamName])

  const label = cam.display_name
    .replace(' — ', ' ')
    .replace(' Main', '')
    .split(' — ').pop()

  return (
    <div
      className="bg-black overflow-hidden relative flex flex-col cursor-pointer group"
      onClick={onClick}
    >
      {/* Offline overlay */}
      {online === false && (
        <div className="absolute inset-0 z-20 bg-black/75 flex flex-col items-center justify-center gap-1.5 pointer-events-none">
          <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M12 9v3.75m0 3.75h.008v.008H12v-.008zM9.75 21h4.5a2.25 2.25 0 002.25-2.25v-9A2.25 2.25 0 0014.25 7.5H3.75A2.25 2.25 0 001.5 9.75v9A2.25 2.25 0 003.75 21h4.5z" />
          </svg>
          <span className="text-red-400 text-xs font-medium tracking-wide uppercase">Offline</span>
        </div>
      )}

      {/* Hover expand hint */}
      <div className="absolute inset-0 z-10 group-hover:bg-black/20 transition-colors duration-150 flex items-center justify-center">
        <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          <svg className="w-8 h-8 text-white/70 drop-shadow-lg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
          </svg>
        </div>
      </div>

      {/* Stream */}
      <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
        <iframe
          ref={iframeRef}
          allow="autoplay"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
        />
      </div>

      {/* Label bar */}
      <div className="bg-gray-900/95 px-2.5 py-1.5 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <StatusDot online={online} />
          <span className="text-xs text-gray-200 font-medium truncate">{label}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {cam.recording_enabled && (
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" title="Recording" />
          )}
          {cam.nvr_name && (
            <span className="text-xs text-gray-500 truncate max-w-[6rem]">{cam.nvr_name}</span>
          )}
        </div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const navigate              = useNavigate()
  const { user }              = useAuth()
  const [cameras, setCameras] = useState([])
  const [health, setHealth]   = useState({})
  const [loading, setLoading] = useState(true)
  const [cols, setCols]       = useState(3)
  const [page, setPage]       = useState(0)

  useEffect(() => {
    camerasApi.list()
      .then(all => setCameras(all.filter(c => c.active && c.is_main)))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    function fetchHealth() {
      healthApi.streams().then(setHealth).catch(() => {})
    }
    fetchHealth()
    const interval = setInterval(fetchHealth, HEALTH_POLL_MS)
    return () => clearInterval(interval)
  }, [])

  const perPage   = cols * cols
  const pages     = Math.max(1, Math.ceil(cameras.length / perPage))
  const slice     = cameras.slice(page * perPage, (page + 1) * perPage)
  const onlineCount = cameras.filter(c => health[c.name.replace('-main', '-sub')] === true).length

  function handleSetCols(newCols) {
    setCols(newCols)
    setPage(0)
  }

  if (loading) {
    return <div className="flex-1 flex items-center justify-center"><Spinner className="w-6 h-6" /></div>
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="px-4 py-2 flex items-center justify-between border-b border-gray-800 bg-gray-900 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-white">Live View</span>
          {cameras.length > 0 && (
            <span className="text-xs text-gray-500">
              <span className="text-gray-300">{onlineCount}</span>/{cameras.length} online
            </span>
          )}
          <span className="text-xs px-1.5 py-0.5 rounded text-gray-500 border border-gray-700">
            Sub
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Grid size switcher */}
          <div className="flex items-center bg-gray-800 rounded-lg p-0.5">
            {GRID_OPTIONS.map(({ cols: c, label, icon }) => (
              <button
                key={c}
                onClick={() => handleSetCols(c)}
                title={label}
                className={`p-1.5 rounded transition-colors ${
                  cols === c
                    ? 'bg-gray-600 text-white'
                    : 'text-gray-500 hover:text-gray-200'
                }`}
              >
                {icon}
              </button>
            ))}
          </div>

          {/* Pagination — only shown when needed */}
          {pages > 1 && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-2 py-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-300 rounded text-sm transition-colors"
              >‹</button>
              <span className="text-xs text-gray-400 px-1 tabular-nums">
                {page + 1} / {pages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(pages - 1, p + 1))}
                disabled={page >= pages - 1}
                className="px-2 py-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-300 rounded text-sm transition-colors"
              >›</button>
            </div>
          )}
        </div>
      </div>

      {/* Grid or empty state */}
      {cameras.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-500 gap-4">
          <div className="w-16 h-16 rounded-2xl bg-gray-800 flex items-center justify-center">
            <svg className="w-8 h-8 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9A2.25 2.25 0 0013.5 5.25h-9A2.25 2.25 0 002.25 7.5v9A2.25 2.25 0 004.5 18.75z" />
            </svg>
          </div>
          <div className="text-center">
            <p className="text-gray-300 font-medium">No cameras yet</p>
            <p className="text-gray-500 text-sm mt-1">Add an NVR or camera to get started</p>
          </div>
          {user?.role === 'admin' && (
            <div className="flex gap-2">
              <Link to="/nvrs"
                className="text-sm px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors">
                + Add NVR
              </Link>
              <Link to="/cameras"
                className="text-sm px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors">
                + Add Camera
              </Link>
            </div>
          )}
        </div>
      ) : (
        <div
          className="flex-1 overflow-hidden"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gridAutoRows: cols === 1 ? '100%' : 'min-content',
            gap: '2px',
            backgroundColor: '#111827',
          }}
        >
          {slice.map(cam => {
            const subName = cam.name.replace('-main', '-sub')
            return (
              <CameraTile
                key={cam.id}
                cam={cam}
                streamName={subName}
                online={health[subName]}
                onClick={() => navigate(`/camera/${cam.name}`)}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
