import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { camerasApi } from '../api/cameras'
import { healthApi } from '../api/health'
import { recordingsApi } from '../api/recordings'
import { useAuth } from '../context/AuthContext'
import Spinner from '../components/Spinner'

const HEALTH_POLL_MS = 30000

export default function CameraView() {
  const { name }                  = useParams()
  const navigate                  = useNavigate()
  const { user }                  = useAuth()
  const iframeRef                 = useRef(null)
  const streamSrc                 = useRef('')
  const [cam, setCam]             = useState(null)
  const [online, setOnline]       = useState(null)
  const [loading, setLoading]     = useState(true)
  const [notFound, setNotFound]   = useState(false)
  const [toggling, setToggling]   = useState(false)
  const [paused, setPaused]       = useState(false)

  useEffect(() => {
    camerasApi.list()
      .then(all => {
        const found = all.find(c => c.name === name)
        if (!found) { setNotFound(true); return }
        setCam(found)
      })
      .finally(() => setLoading(false))
  }, [name])

  useEffect(() => {
    function fetchHealth() {
      healthApi.streams()
        .then(h => {
          const subName = name.replace('-main', '-sub')
          setOnline(h[subName] ?? h[name] ?? null)
        })
        .catch(() => {})
    }
    fetchHealth()
    const interval = setInterval(fetchHealth, HEALTH_POLL_MS)
    return () => clearInterval(interval)
  }, [name])

  useEffect(() => {
    if (cam) {
      streamSrc.current = `/go2rtc/stream.html?src=${cam.name}&mode=mse`
      if (iframeRef.current) iframeRef.current.src = streamSrc.current
    }
  }, [cam])

  useEffect(() => {
    return () => { if (iframeRef.current) iframeRef.current.src = '' }
  }, [])

  function togglePause() {
    if (!iframeRef.current) return
    if (paused) {
      iframeRef.current.src = streamSrc.current
      setPaused(false)
    } else {
      iframeRef.current.src = ''
      setPaused(true)
    }
  }

  async function handleRecordingToggle() {
    if (!cam) return
    setToggling(true)
    try {
      const res = await recordingsApi.toggleRecording(cam.id, !cam.recording_enabled)
      setCam(prev => ({ ...prev, recording_enabled: res.recording_enabled }))
    } catch (err) {
      console.error(err)
    } finally {
      setToggling(false)
    }
  }

  if (loading) {
    return <div className="flex-1 flex items-center justify-center"><Spinner className="w-6 h-6" /></div>
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

  const label = cam.display_name.replace(' — ', ' ').replace(' Main', '')

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-2.5 bg-gray-900 border-b border-gray-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)}
            className="text-gray-400 hover:text-white text-sm transition-colors">
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

        {/* Right side controls */}
        <div className="flex items-center gap-3">
          {/* Recording toggle — admin only */}
          {user?.role === 'admin' && (
            <button
              onClick={handleRecordingToggle}
              disabled={toggling}
              className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50 ${
                cam.recording_enabled
                  ? 'bg-red-900/40 text-red-400 border-red-800 hover:bg-red-900/60'
                  : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-white hover:border-gray-500'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${cam.recording_enabled ? 'bg-red-500 animate-pulse' : 'bg-gray-600'}`} />
              {toggling ? 'Updating...' : cam.recording_enabled ? 'Recording' : 'Record'}
            </button>
          )}
          <span className="text-xs px-2 py-0.5 bg-indigo-600/30 text-indigo-300 border border-indigo-700 rounded">
            Main stream
          </span>
        </div>
      </div>

      {/* Stream */}
      <div className="flex-1 bg-black relative group">

        {/* Offline overlay */}
        {online === false && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 pointer-events-none">
            <span className="text-red-400 text-lg font-medium">Camera Offline</span>
            <span className="text-gray-500 text-sm">{label}</span>
          </div>
        )}

        {/* Pause / play click overlay */}
        <div
          className="absolute inset-0 z-10 cursor-pointer"
          onClick={togglePause}
        >
          {/* Show icon on hover or when paused */}
          <div className={`absolute inset-0 flex items-center justify-center transition-opacity duration-150 ${
            paused ? 'opacity-100 bg-black/40' : 'opacity-0 group-hover:opacity-100'
          }`}>
            <div className="bg-black/60 rounded-full p-4">
              {paused ? (
                <svg className="w-10 h-10 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              ) : (
                <svg className="w-10 h-10 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                </svg>
              )}
            </div>
          </div>
        </div>

        <iframe
          ref={iframeRef}
          allow="autoplay"
          scrolling="no"
          style={{ width: '100%', height: '100%', border: 0, overflow: 'hidden' }}
        />
      </div>
    </div>
  )
}