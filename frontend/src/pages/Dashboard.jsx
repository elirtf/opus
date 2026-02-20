import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { camerasApi } from '../api/cameras'
import { healthApi } from '../api/health'
import logo from '../assets/logo-black.png'

const GRID_SIZES = [3, 4, 6]
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
    <div className="bg-black overflow-hidden relative flex flex-col cursor-pointer group"
         onClick={onClick}>

      {/* Offline overlay */}
      {online === false && (
        <div className="absolute inset-0 z-20 bg-black/70 flex items-center justify-center pointer-events-none">
          <span className="text-red-400 text-xs font-medium tracking-wide uppercase">Offline</span>
        </div>
      )}

      {/* Click shield — prevents iframe stealing clicks */}
      <div className="absolute inset-0 z-10" />

      {/* Stream */}
      <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
        <iframe
          ref={iframeRef}
          allow="autoplay"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
        />
      </div>

      {/* Always-visible label bar */}
      <div className="bg-gray-900/95 px-2.5 py-1.5 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <StatusDot online={online} />
          <span className="text-xs text-gray-200 font-medium truncate">{label}</span>
        </div>
        {cam.nvr_name && (
          <span className="text-xs text-gray-500 shrink-0 truncate max-w-[6rem]">{cam.nvr_name}</span>
        )}
      </div>
    </div>
  )
}

export default function Dashboard() {
  const navigate              = useNavigate()
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

  const perPage = cols * cols
  const pages   = Math.max(1, Math.ceil(cameras.length / perPage))
  const slice   = cameras.slice(page * perPage, (page + 1) * perPage)

  function handleSetCols(newCols) {
    setCols(newCols)
    setPage(0)
  }

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">Loading cameras...</div>
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="px-4 py-2.5 flex items-center justify-between border-b border-gray-800 bg-gray-900 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-white">Live View</span>
          <span className="text-xs px-2 py-0.5 rounded font-medium bg-yellow-900/60 text-yellow-300 border border-yellow-800">
            Sub stream
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Grid size */}
          <div className="flex items-center bg-gray-800 rounded-lg p-0.5">
            {GRID_SIZES.map(s => (
              <button
                key={s}
                onClick={() => handleSetCols(s)}
                className={`px-2.5 py-1 rounded text-xs transition-colors ${
                  cols === s ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                {s}×{s}
              </button>
            ))}
          </div>
          {/* Pagination */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-300 rounded text-sm"
            >‹</button>
            <span className="text-xs text-gray-400 px-1">{page + 1}/{pages}</span>
            <button
              onClick={() => setPage(p => Math.min(pages - 1, p + 1))}
              disabled={page >= pages - 1}
              className="px-2.5 py-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-300 rounded text-sm"
            >›</button>
          </div>
        </div>
      </div>

      {/* Grid */}
      {cameras.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-500 gap-3">
          <span className="text-5xl">📷</span>
          <p className="text-gray-400">No active cameras</p>
        </div>
      ) : (
        <div
          className="flex-1"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gridAutoRows: 'min-content',
            gap: '2px',
            backgroundColor: '#111',
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