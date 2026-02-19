import { useState, useEffect, useRef } from 'react'
import { camerasApi } from '../api/cameras'

const GRID_SIZES = [3, 4, 6]
const SUB_THRESHOLD = 3  // all grid sizes use sub streams

function CameraTile({ cam, streamName, onFullscreen }) {
  const iframeRef = useRef(null)

  // Destroy stream on unmount so go2rtc drops the RTSP connection
  useEffect(() => {
    return () => {
      if (iframeRef.current) iframeRef.current.src = ''
    }
  }, [])

  // Swap src when streamName changes (grid size change)
  useEffect(() => {
    if (iframeRef.current) {
      iframeRef.current.src = `/go2rtc/stream.html?src=${streamName}&mode=mse`
    }
  }, [streamName])

  return (
    <div className="bg-black overflow-hidden relative group">
      {/* Label overlay */}
      <div className="absolute top-0 left-0 right-0 z-20 px-3 py-2 flex justify-between items-center
                      bg-gradient-to-b from-black/75 to-transparent
                      opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        <span className="text-white text-sm font-medium drop-shadow">{cam.display_name.replace(' — ', ' ').replace(' Main', '')}</span>
        <span className="text-gray-300 text-xs">{cam.nvr_name || ''}</span>
      </div>

      {/* Fullscreen button */}
      <button
        onClick={() => onFullscreen(cam)}
        className="absolute top-2 right-2 z-30 opacity-0 group-hover:opacity-100 transition-opacity
                   bg-black/60 hover:bg-black/90 text-white border border-gray-600
                   rounded px-2 py-0.5 text-xs"
      >
        ⛶
      </button>

      {/* Click shield */}
      <div className="absolute inset-0 z-10" />

      {/* Stream */}
      <div className="relative" style={{ paddingBottom: '56.25%' }}>
        <iframe
          ref={iframeRef}
          src={`/go2rtc/stream.html?src=${streamName}&mode=mse`}
          allow="autoplay"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
        />
      </div>
    </div>
  )
}

function FullscreenOverlay({ cam, onClose }) {
  const iframeRef = useRef(null)

  useEffect(() => {
    return () => { if (iframeRef.current) iframeRef.current.src = '' }
  }, [])

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 bg-gray-900 border-b border-gray-800 shrink-0">
        <span className="text-white font-medium">{cam.display_name.replace(' — ', ' ').replace(' Main', '')}</span>
        <button onClick={onClose} className="text-gray-400 hover:text-white text-sm px-3 py-1 border border-gray-700 rounded">
          ✕ Close
        </button>
      </div>
      <div className="flex-1 relative">
        <iframe
          ref={iframeRef}
          src={`/go2rtc/stream.html?src=${cam.name}&mode=mse`}
          allow="autoplay"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
        />
      </div>
    </div>
  )
}

export default function Dashboard() {
  const [cameras, setCameras]       = useState([])
  const [loading, setLoading]       = useState(true)
  const [cols, setCols]             = useState(3)
  const [page, setPage]             = useState(0)
  const [fullscreen, setFullscreen] = useState(null)

  useEffect(() => {
    camerasApi.list()
      .then(all => setCameras(all.filter(c => c.active && c.is_main)))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const perPage  = cols * cols
  const pages    = Math.max(1, Math.ceil(cameras.length / perPage))
  const slice    = cameras.slice(page * perPage, (page + 1) * perPage)

  function handleSetCols(newCols) {
    setCols(newCols)
    setPage(0)
  }

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">Loading cameras...</div>
  }

  return (
    <>
      {/* Toolbar */}
      <div className="px-6 py-3 flex items-center justify-between border-b border-gray-800 bg-gray-900 shrink-0">
        <h2 className="text-base font-semibold text-white">Live View</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs px-2 py-1 rounded font-medium bg-yellow-900/60 text-yellow-300 border border-yellow-800">
            Sub stream
          </span>
          {/* Grid buttons */}
          <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-1">
            {GRID_SIZES.map(s => (
              <button
                key={s}
                onClick={() => handleSetCols(s)}
                className={`px-3 py-1.5 rounded text-sm transition-colors ${
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
              className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-300 rounded text-sm"
            >‹</button>
            <span className="text-sm text-gray-400 px-2">{page + 1} / {pages}</span>
            <button
              onClick={() => setPage(p => Math.min(pages - 1, p + 1))}
              disabled={page >= pages - 1}
              className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-300 rounded text-sm"
            >›</button>
          </div>
        </div>
      </div>

      {/* Camera grid - full width */}
      {cameras.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-500 gap-3">
          <span className="text-5xl">📷</span>
          <p className="text-gray-400">No active cameras</p>
          <a href="/cameras" className="text-indigo-400 text-sm hover:underline">Add a camera</a>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gap: '4px',
          }}
        >
          {slice.map(cam => {
            const subName = cam.name.replace('-main', '-sub')
            return (
              <CameraTile
                key={cam.id}
                cam={cam}
                streamName={subName}
                onFullscreen={setFullscreen}
              />
            )
          })}
        </div>
      )}

      {/* Fullscreen overlay */}
      {fullscreen && (
        <FullscreenOverlay cam={fullscreen} onClose={() => setFullscreen(null)} />
      )}
    </>
  )
}