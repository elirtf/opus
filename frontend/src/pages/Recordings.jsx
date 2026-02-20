import { useState, useEffect, useRef } from 'react'
import { recordingsApi } from '../api/recordings'
import { camerasApi } from '../api/cameras'
import logo from '../assets/logo-black.png'

function formatBytes(mb) {
  if (mb < 1024) return `${mb} MB`
  return `${(mb / 1024).toFixed(1)} GB`
}

function formatDt(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function VideoPlayer({ recording, onClose }) {
  const videoRef = useRef(null)

  useEffect(() => {
    return () => {
      if (videoRef.current) {
        videoRef.current.pause()
        videoRef.current.src = ''
      }
    }
  }, [])

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="fixed inset-0 bg-black/90 z-50 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 bg-gray-900 border-b border-gray-800 shrink-0">
        <div>
          <span className="text-white font-medium">{recording.camera_name}</span>
          <span className="ml-3 text-gray-400 text-sm">{formatDt(recording.started_at)}</span>
          <span className="ml-3 text-gray-500 text-sm">{formatBytes(recording.size_mb)}</span>
        </div>
        <div className="flex items-center gap-3">
          <a
            href={recording.download_url}
            download={recording.filename}
            className="text-sm text-indigo-400 hover:text-indigo-300 border border-indigo-800 hover:border-indigo-600 px-3 py-1.5 rounded-lg transition-colors"
          >
            ↓ Download
          </a>
          <button onClick={onClose}
            className="text-gray-400 hover:text-white text-sm px-3 py-1.5 border border-gray-700 rounded-lg transition-colors">
            ✕ Close
          </button>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center bg-black">
        <video
          ref={videoRef}
          src={recording.download_url}
          controls
          autoPlay
          className="max-w-full max-h-full"
        />
      </div>
    </div>
  )
}

function RecordingRow({ rec, onPlay }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 hover:bg-gray-800/40 transition-colors border-b border-gray-800 last:border-0">
      <div className="flex items-center gap-4">
        <div className="text-2xl text-gray-600 cursor-pointer hover:text-white transition-colors"
             onClick={() => onPlay(rec)}>
          ▶
        </div>
        <div>
          <div className="text-sm text-white font-medium">{formatDt(rec.started_at)}</div>
          <div className="text-xs text-gray-500">{rec.filename}</div>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <span className="text-xs text-gray-400">{formatBytes(rec.size_mb)}</span>
        <button onClick={() => onPlay(rec)}
          className="text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-900 hover:border-indigo-700 px-3 py-1.5 rounded-lg transition-colors">
          Play
        </button>
        <a
          href={rec.download_url}
          download={rec.filename}
          className="text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg transition-colors"
        >
          ↓ Download
        </a>
      </div>
    </div>
  )
}

export default function Recordings() {
  const [recordings, setRecordings] = useState({})  // { camera_name: [rec, ...] }
  const [cameras, setCameras]       = useState([])
  const [selected, setSelected]     = useState(null) // selected camera filter
  const [loading, setLoading]       = useState(true)
  const [playing, setPlaying]       = useState(null)
  const [open, setOpen]             = useState({})   // which camera groups are expanded

  useEffect(() => {
    camerasApi.list()
      .then(all => setCameras(all.filter(c => c.recording_enabled)))
      .catch(console.error)
  }, [])

  useEffect(() => {
    setLoading(true)
    recordingsApi.list(selected)
      .then(data => {
        setRecordings(data || {})
        // Default all groups open
        const groups = {}
        Object.keys(data || {}).forEach(k => { groups[k] = true })
        setOpen(groups)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [selected])

  function toggleGroup(name) {
    setOpen(prev => ({ ...prev, [name]: !prev[name] }))
  }

  const totalSize = Object.values(recordings)
    .flat()
    .reduce((sum, r) => sum + r.size_mb, 0)

  return (
    <div className="max-w-5xl mx-auto px-6 py-6 w-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-white">Recordings</h2>
          <p className="text-sm text-gray-400 mt-0.5">
            {Object.values(recordings).flat().length} segments · {formatBytes(Math.round(totalSize))} total
          </p>
        </div>

        {/* Camera filter */}
        <select
          value={selected || ''}
          onChange={e => setSelected(e.target.value || null)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All cameras</option>
          {cameras.map(c => (
            <option key={c.id} value={c.name}>{c.display_name}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="text-gray-500 text-sm">Loading recordings...</div>
      ) : Object.keys(recordings).length === 0 ? (
        <div className="text-center py-20">
          <div className="text-4xl mb-3">🎬</div>
          <p className="text-gray-400">No recordings found.</p>
          <p className="text-gray-500 text-sm mt-1">
            Enable recording on a camera to start.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(recordings).map(([camName, recs]) => (
            <div key={camName} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              {/* Group header */}
              <button
                onClick={() => toggleGroup(camName)}
                className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-800/40 transition-colors border-b border-gray-800"
              >
                <div className="flex items-center gap-3">
                  <span className="font-medium text-white">{camName}</span>
                  <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded">
                    {recs.length} segments
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400">
                    {formatBytes(Math.round(recs.reduce((s, r) => s + r.size_mb, 0)))}
                  </span>
                  <span className={`text-gray-500 text-sm transition-transform ${open[camName] ? 'rotate-90' : ''}`}>›</span>
                </div>
              </button>

              {/* Recording list */}
              {open[camName] && (
                <div>
                  {recs.map(rec => (
                    <RecordingRow
                      key={rec.filename}
                      rec={rec}
                      onPlay={setPlaying}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Video player modal */}
      {playing && (
        <VideoPlayer recording={playing} onClose={() => setPlaying(null)} />
      )}
    </div>
  )
}