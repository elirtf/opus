import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate, Link, useSearchParams } from 'react-router-dom'
import { camerasApi } from '../api/cameras'
import { healthApi } from '../api/health'
import Spinner from '../components/Spinner'
import LivePlayer from '../components/player/LivePlayer'
import { useAuth } from '../context/AuthContext'
import { compareCamerasByDisplayName } from '../utils/naturalCompare'

const FIXED_COLS = [3, 4, 6]
const HEALTH_POLL_MS = 30000
const LABEL_BAR_H = 30
const GRID_GAP = 2
/** Tile width threshold: above this, use main stream for higher quality. */
const MAIN_STREAM_MIN_WIDTH = 640

const VIEW_MODES = [
  { id: 'all', label: 'All' },
  { id: 'problems', label: 'Problems' },
  { id: 'offlineFirst', label: 'Offline first' },
]

function liveStreamName(cam, useMain) {
  if (useMain) return cam.name
  return cam.live_view_stream_name || cam.name.replace('-main', '-sub')
}

function isProblemCamera(health, cam) {
  const sub = cam.live_view_stream_name || cam.name.replace('-main', '-sub')
  return health[sub] !== true
}

function siteHeadingFromCameras(cams) {
  if (!cams.length) return 'Site'
  const withName = cams.find((c) => c.nvr_name && String(c.nvr_name).trim())
  if (withName) return String(withName.nvr_name).trim()
  const id = cams[0].nvr_id
  if (id != null && id !== '') return `Site #${id}`
  return 'Standalone'
}

/**
 * Given a container size and camera count, find the optimal column count
 * so all cameras fit without scrolling, maximising tile size.
 */
function calcFillCols(containerW, containerH, count) {
  if (count <= 0 || containerW <= 0 || containerH <= 0) return 1
  let best = count
  for (let c = 1; c <= count; c++) {
    const tileW = (containerW - (c - 1) * GRID_GAP) / c
    const tileH = tileW * 9 / 16 + LABEL_BAR_H
    const rows = Math.ceil(count / c)
    const totalH = rows * tileH + (rows - 1) * GRID_GAP
    if (totalH <= containerH) {
      best = c
      break
    }
  }
  return Math.max(1, Math.min(best, count))
}

function StatusDot({ online }) {
  return (
    <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${
      online === true  ? 'bg-green-400' :
      online === false ? 'bg-red-500'   :
      'bg-gray-600'
    }`} />
  )
}

function CameraTile({ cam, streamName, online, onClick, useMainStream }) {
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
        <div className="absolute inset-0 z-20 bg-black/75 flex items-center justify-center pointer-events-none">
          <span className="text-red-400 text-xs font-semibold tracking-widest uppercase">Offline</span>
        </div>
      )}

      {/* Hover overlay */}
      <div className="absolute inset-0 z-10 bg-black/0 group-hover:bg-black/30 transition-colors duration-150 motion-reduce:transition-none motion-reduce:duration-0 flex items-center justify-center">
        <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-150 motion-reduce:transition-none motion-reduce:duration-0 bg-black/60 rounded-full p-2">
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
          </svg>
        </div>
      </div>

      {/* Stream */}
      <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
        <div className="absolute inset-0 overflow-hidden">
          <LivePlayer
            cameraName={cam.name}
            streamName={streamName}
            enabled={true}
            playbackMode="auto"
            nativeVideoControls={false}
            preferSubStream={!useMainStream}
            className="h-full"
          />
        </div>
      </div>

      {/* Label bar */}
      <div className="bg-gray-900/95 px-2.5 py-1.5 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <StatusDot online={online} />
          <span className="text-xs text-gray-200 font-medium truncate">{label}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {cam.recording_enabled && (
            <span
              className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse motion-reduce:animate-none"
              title="Recording"
            />
          )}
          {useMainStream && (
            <span className="text-[10px] text-blue-400 font-medium" title="High quality (main stream)">HD</span>
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
  const [searchParams]        = useSearchParams()
  const siteKey               = searchParams.get('site')
  const { user }              = useAuth()
  const [cameras, setCameras] = useState([])
  const [health, setHealth]   = useState({})
  const [loading, setLoading] = useState(true)
  const [gridMode, setGridMode] = useState('fill') // 'fill' | 3 | 4 | 6
  const [page, setPage]       = useState(0)
  const [viewMode, setViewMode] = useState('all')
  const gridRef               = useRef(null)
  const [gridSize, setGridSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    camerasApi.list()
      .then((all) =>
        setCameras(
          all.filter((c) => c.active && c.is_main).sort(compareCamerasByDisplayName)
        )
      )
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

  // Measure grid container for fill mode
  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setGridSize({ w: Math.floor(width), h: Math.floor(height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    setPage(0)
  }, [siteKey, viewMode])

  const filtered = useMemo(() =>
    siteKey == null || siteKey === ''
      ? cameras
      : cameras.filter((c) => String(c.nvr_id ?? 'standalone') === siteKey),
    [cameras, siteKey],
  )

  const siteHeading = siteKey ? siteHeadingFromCameras(filtered) : null

  const gridCameras = useMemo(() => {
    let result = [...filtered]
    if (viewMode === 'problems') {
      result = result.filter((c) => isProblemCamera(health, c))
    }
    if (viewMode === 'offlineFirst') {
      result.sort((a, b) => {
        const subA = a.live_view_stream_name || a.name.replace('-main', '-sub')
        const subB = b.live_view_stream_name || b.name.replace('-main', '-sub')
        const ra = health[subA] === true ? 2 : health[subA] === false ? 0 : 1
        const rb = health[subB] === true ? 2 : health[subB] === false ? 0 : 1
        if (ra !== rb) return ra - rb
        return compareCamerasByDisplayName(a, b)
      })
    } else {
      result.sort(compareCamerasByDisplayName)
    }
    return result
  }, [filtered, health, viewMode])

  const isFillMode = gridMode === 'fill'
  const fillCols = useMemo(
    () => calcFillCols(gridSize.w, gridSize.h, gridCameras.length),
    [gridSize.w, gridSize.h, gridCameras.length],
  )
  const cols = isFillMode ? fillCols : gridMode

  // In fill mode show all cameras; in fixed mode paginate
  const perPage    = isFillMode ? gridCameras.length : cols * cols
  const pages      = isFillMode ? 1 : Math.max(1, Math.ceil(gridCameras.length / perPage))
  const slice      = isFillMode ? gridCameras : gridCameras.slice(page * perPage, (page + 1) * perPage)

  // Tile width for main-stream decision
  const tileWidth = gridSize.w > 0 && cols > 0
    ? (gridSize.w - (cols - 1) * GRID_GAP) / cols
    : 0
  const useMainStream = tileWidth >= MAIN_STREAM_MIN_WIDTH

  const onlineCount = filtered.filter((c) => {
    const sub = c.live_view_stream_name || c.name.replace('-main', '-sub')
    return health[sub] === true
  }).length

  const handleSetCols = useCallback((mode) => {
    setGridMode(mode)
    setPage(0)
  }, [])

  if (loading) {
    return <div className="flex-1 flex items-center justify-center"><Spinner className="w-6 h-6" /></div>
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="px-4 py-2 flex flex-wrap items-center justify-between gap-y-2 border-b border-gray-800 bg-gray-900 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm font-semibold text-white shrink-0">Live View</span>
          {siteHeading && (
            <>
              <span className="text-gray-600 shrink-0" aria-hidden>/</span>
              <span className="text-sm text-gray-300 truncate" title={siteHeading}>{siteHeading}</span>
              <Link
                to="/"
                className="text-xs text-indigo-400 hover:text-indigo-300 shrink-0 whitespace-nowrap"
              >
                All sites
              </Link>
            </>
          )}
          {cameras.length > 0 && (
            <span className="text-xs text-gray-500 shrink-0">
              <span className={onlineCount > 0 ? 'text-green-400' : 'text-gray-500'}>{onlineCount}</span>
              <span className="text-gray-600">/{filtered.length} online</span>
              {viewMode === 'problems' && (
                <span className="text-gray-600"> · {gridCameras.length} in filter</span>
              )}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 justify-end">
          {/* Status filter */}
          <div
            className="flex items-center bg-gray-800 rounded-lg p-0.5"
            role="group"
            aria-label="Filter by stream status"
          >
            {VIEW_MODES.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setViewMode(id)}
                title={
                  id === 'problems'
                    ? 'Show offline or unknown streams only'
                    : id === 'offlineFirst'
                      ? 'Sort with offline first, then unknown, then online'
                      : 'Show all cameras'
                }
                className={`px-2 py-1 rounded text-xs font-medium transition-colors motion-reduce:transition-none ${
                  viewMode === id ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Grid size: Fill + fixed options */}
          <div className="flex items-center bg-gray-800 rounded-lg p-0.5">
            <button
              onClick={() => handleSetCols('fill')}
              title="Auto-fit all cameras without pagination"
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                isFillMode ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              Fill
            </button>
            {FIXED_COLS.map(s => (
              <button
                key={s}
                onClick={() => handleSetCols(s)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  !isFillMode && gridMode === s ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                {s}×
              </button>
            ))}
          </div>

          {/* Stream quality indicator */}
          {useMainStream && (
            <span className="text-[10px] bg-blue-900/50 text-blue-300 border border-blue-700/40 px-1.5 py-0.5 rounded font-medium" title="Tiles are large enough for main stream quality">
              HD
            </span>
          )}

          {/* Pagination — only in fixed-column mode */}
          {!isFillMode && pages > 1 && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-2 py-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-30 text-gray-300 rounded text-sm transition-colors"
              >‹</button>
              <span className="text-xs text-gray-400 px-1 tabular-nums">
                {page + 1} / {pages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(pages - 1, p + 1))}
                disabled={page >= pages - 1}
                className="px-2 py-1 bg-gray-800 hover:bg-gray-700 disabled:opacity-30 text-gray-300 rounded text-sm transition-colors"
              >›</button>
            </div>
          )}
        </div>
      </div>

      {/* Grid or empty state */}
      {siteKey && filtered.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4 text-center">
          <p className="text-gray-300 font-medium">No cameras for this site</p>
          <p className="text-gray-500 text-sm">The link may be outdated or this site has no main streams.</p>
          <Link to="/" className="text-sm text-indigo-400 hover:text-indigo-300">Show all cameras</Link>
        </div>
      ) : viewMode === 'problems' && gridCameras.length === 0 && filtered.length > 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4 text-center">
          <p className="text-gray-300 font-medium">No problem streams</p>
          <p className="text-gray-500 text-sm max-w-sm">
            Every camera in this view is online. Switch to <span className="text-gray-400">All</span> or{' '}
            <span className="text-gray-400">Offline first</span> to see the full grid.
          </p>
          <button
            type="button"
            onClick={() => setViewMode('all')}
            className="text-sm text-indigo-400 hover:text-indigo-300"
          >
            Show all cameras
          </button>
        </div>
      ) : cameras.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
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
            <div className="flex gap-2 mt-1">
              <Link to="/devices"
                className="text-sm px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors">
                Devices
              </Link>
              <Link to="/discovery"
                className="text-sm px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors">
                Discovery
              </Link>
            </div>
          )}
        </div>
      ) : (
        <div
          ref={gridRef}
          className="flex-1 overflow-hidden"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gridAutoRows: 'min-content',
            gap: `${GRID_GAP}px`,
            backgroundColor: '#111827',
            alignContent: 'start',
          }}
        >
          {slice.map((cam) => {
            const sub = cam.live_view_stream_name || cam.name.replace('-main', '-sub')
            const streamName = useMainStream ? cam.name : sub
            return (
              <CameraTile
                key={cam.id}
                cam={cam}
                streamName={streamName}
                online={health[sub]}
                useMainStream={useMainStream}
                onClick={() => navigate(`/camera/${cam.name}`)}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
