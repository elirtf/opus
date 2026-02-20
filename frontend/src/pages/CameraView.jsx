import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { camerasApi } from '../api/cameras'
import { healthApi } from '../api/health'

const HEALTH_POLL_MS = 30000

export default function CameraView() {
  const { name }              = useParams()
  const navigate              = useNavigate()
  const iframeRef             = useRef(null)
  const [cam, setCam]         = useState(null)
  const [online, setOnline]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  // Find camera by name
  useEffect(() => {
    camerasApi.list()
      .then(all => {
        const found = all.find(c => c.name === name)
        if (!found) { setNotFound(true); return }
        setCam(found)
      })
      .finally(() => setLoading(false))
  }, [name])

  // Health polling
  useEffect(() => {
    function fetchHealth() {
      healthApi.streams()
        .then(h => {
          // Check both main and sub stream status
          const subName = name.replace('-main', '-sub')
          setOnline(h[subName] ?? h[name] ?? null)
        })
        .catch(() => {})
    }
    fetchHealth()
    const interval = setInterval(fetchHealth, HEALTH_POLL_MS)
    return () => clearInterval(interval)
  }, [name])

  // Cleanup iframe on unmount
  useEffect(() => {
    return () => { if (iframeRef.current) iframeRef.current.src = '' }
  }, [])

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">Loading...</div>
  }

  if (notFound) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 text-gray-500">
        <span className="text-4xl">📷</span>
        <p>Camera not found.</p>
        <button onClick={() => navigate('/')} className="text-indigo-400 text-sm hover:underline">
          ← Back to Live View
        </button>
      </div>
    )
  }

  const label = cam.display_name
    .replace(' — ', ' ')
    .replace(' Main', '')

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-2.5 bg-gray-900 border-b border-gray-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="text-gray-400 hover:text-white text-sm transition-colors"
          >
            ← Back
          </button>
          <div className="w-px h-4 bg-gray-700" />
          <div>
            <span className="text-white font-semibold">{label}</span>
            {cam.nvr_name && (
              <span className="ml-2 text-gray-400 text-sm">{cam.nvr_name}</span>
            )}
          </div>
          {/* Status badge */}
          <span className={`flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border ${
            online === true  ? 'bg-green-900/40 text-green-400 border-green-800' :
            online === false ? 'bg-red-900/40 text-red-400 border-red-800' :
                               'bg-gray-800 text-gray-500 border-gray-700'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${
              online === true  ? 'bg-green-400' :
              online === false ? 'bg-red-500'   :
              'bg-gray-600'
            }`} />
            {online === true ? 'Online' : online === false ? 'Offline' : 'Unknown'}
          </span>
        </div>

        {/* Stream toggle - main vs sub */}
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span>Stream:</span>
          <span className="px-2 py-0.5 bg-indigo-600/30 text-indigo-300 border border-indigo-700 rounded">
            Main
          </span>
        </div>
      </div>

      {/* Main stream — fills remaining space */}
      <div className="flex-1 bg-black relative">
        {online === false && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 pointer-events-none">
            <span className="text-red-400 text-lg font-medium">Camera Offline</span>
            <span className="text-gray-500 text-sm">{label}</span>
          </div>
        )}
        <iframe
          ref={iframeRef}
          src={`/go2rtc/stream.html?src=${cam.name}&mode=mse`}
          allow="autoplay"
          style={{ width: '100%', height: '100%', border: 0 }}
        />
      </div>
    </div>
  )
}