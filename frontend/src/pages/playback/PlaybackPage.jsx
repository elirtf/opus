import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../api/client'
import { camerasApi } from '../../api/cameras'
import { playbackApi, playbackStreamUrl } from '../../api/playback'
import { compareCamerasByDisplayName } from '../../utils/naturalCompare'
import TimelineScrubber from './components/TimelineScrubber'
import CameraClipGrid from './components/CameraClipGrid'
import PlaybackHlsPlayer from './components/PlaybackHlsPlayer'
import { registerPlaybackSeekHandler } from './playbackSeekBridge'

const DAY_MS = 24 * 60 * 60 * 1000

function parseEndMs(seg, windowEndMs) {
  if (seg.end_time) {
    const t = Date.parse(seg.end_time)
    if (!Number.isNaN(t)) return t
  }
  const d = Number(seg.duration_seconds)
  if (Number.isFinite(d) && d > 0) {
    return Date.parse(seg.start_time) + d * 1000
  }
  return windowEndMs
}

function pickSegmentAt(segments, tMs, windowEndMs) {
  if (!segments?.length) return null
  for (const s of segments) {
    const a = Date.parse(s.start_time)
    if (Number.isNaN(a)) continue
    const b = parseEndMs(s, windowEndMs)
    if (tMs >= a && tMs < b) return { recordingId: s.id, offsetSec: Math.max(0, (tMs - a) / 1000) }
  }
  let best = null
  let bestDist = Infinity
  for (const s of segments) {
    const a = Date.parse(s.start_time)
    if (Number.isNaN(a)) continue
    const dist = Math.abs(tMs - a)
    if (dist < bestDist) {
      bestDist = dist
      best = { recordingId: s.id, offsetSec: Math.max(0, (tMs - a) / 1000) }
    }
  }
  return best
}

export default function PlaybackPage() {
  const [cameras, setCameras] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [segments, setSegments] = useState([])
  const [latestById, setLatestById] = useState({})
  const [windowEndMs, setWindowEndMs] = useState(() => Date.now())
  const [playback, setPlayback] = useState({ mode: 'live', recordingId: null, offsetSec: 0 })
  const [loadErr, setLoadErr] = useState(null)

  const windowStartMs = windowEndMs - DAY_MS

  useEffect(() => {
    camerasApi
      .list()
      .then((rows) => {
        const mains = (rows || []).filter((c) => c.active && c.is_main)
        mains.sort(compareCamerasByDisplayName)
        setCameras(mains)
        setSelectedId((cur) => cur ?? mains[0]?.id ?? null)
      })
      .catch((e) => setLoadErr(String(e.message || e)))
  }, [])

  useEffect(() => {
    if (!cameras.length) return
    let cancelled = false
    ;(async () => {
      const next = {}
      await Promise.all(
        cameras.map(async (c) => {
          try {
            const data = await api.get(
              `/api/recordings/?camera=${encodeURIComponent(c.name)}&limit=1&order=desc`,
            )
            const r = data.recordings?.[0]
            if (r) next[c.id] = { started_at: r.started_at, filename: r.filename }
          } catch {
            /* ignore per-camera */
          }
        }),
      )
      if (!cancelled) setLatestById(next)
    })()
    return () => {
      cancelled = true
    }
  }, [cameras])

  useEffect(() => {
    if (!selectedId) {
      setSegments([])
      return
    }
    let cancelled = false
    const startIso = new Date(windowStartMs).toISOString()
    const endIso = new Date(windowEndMs).toISOString()
    playbackApi
      .segments(selectedId, startIso, endIso)
      .then((data) => {
        if (!cancelled) setSegments(data.segments || [])
      })
      .catch(() => {
        if (!cancelled) setSegments([])
      })
    return () => {
      cancelled = true
    }
  }, [selectedId, windowStartMs, windowEndMs])

  const selectedCam = useMemo(
    () => cameras.find((c) => c.id === selectedId) || null,
    [cameras, selectedId],
  )

  const streamSrc = useMemo(() => {
    if (!selectedId) return ''
    if (playback.mode === 'vod' && playback.recordingId != null) {
      return playbackStreamUrl(selectedId, { recordingId: playback.recordingId })
    }
    return playbackStreamUrl(selectedId, {})
  }, [selectedId, playback])

  const handleTimelineSeek = useCallback(
    (iso) => {
      const t = Date.parse(iso)
      if (Number.isNaN(t) || !selectedId) return
      const pick = pickSegmentAt(segments, t, windowEndMs)
      if (pick) {
        setPlayback({ mode: 'vod', recordingId: pick.recordingId, offsetSec: pick.offsetSec })
        return
      }
      if (t > Date.now() - 90_000) setPlayback({ mode: 'live', recordingId: null, offsetSec: 0 })
    },
    [segments, selectedId, windowEndMs],
  )

  const handleSeekEvent = useCallback(
    async ({ cameraId, isoTimestamp }) => {
      const t = Date.parse(isoTimestamp)
      if (Number.isNaN(t)) return
      setSelectedId(cameraId)
      setWindowEndMs(Date.now())
      const startIso = new Date(t - DAY_MS).toISOString()
      const endIso = new Date(t + DAY_MS).toISOString()
      try {
        const data = await playbackApi.segments(cameraId, startIso, endIso)
        const segs = data.segments || []
        const pick = pickSegmentAt(segs, t, Date.now())
        if (pick) setPlayback({ mode: 'vod', recordingId: pick.recordingId, offsetSec: pick.offsetSec })
        else setPlayback({ mode: 'live', recordingId: null, offsetSec: 0 })
      } catch {
        setPlayback({ mode: 'live', recordingId: null, offsetSec: 0 })
      }
    },
    [],
  )

  useEffect(() => {
    registerPlaybackSeekHandler(handleSeekEvent)
    return () => registerPlaybackSeekHandler(null)
  }, [handleSeekEvent])

  const onSelectCamera = useCallback((id) => {
    setSelectedId(id)
    setPlayback({ mode: 'live', recordingId: null, offsetSec: 0 })
  }, [])

  return (
    <div className="flex flex-col gap-4 p-4 max-w-7xl mx-auto w-full min-h-0">
      <div>
        <h1 className="text-xl font-semibold text-white tracking-tight">Playback</h1>
        <p className="text-sm text-gray-500 mt-1">
          Timeline and HLS preview — player stays paused until you press play.
        </p>
      </div>
      {loadErr && (
        <div className="text-sm text-red-400 border border-red-900/50 rounded-lg px-3 py-2">{loadErr}</div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 min-h-0">
        <div className="xl:col-span-2 space-y-3 min-w-0">
          {selectedCam ? (
            <>
              <PlaybackHlsPlayer
                key={`${streamSrc}-${playback.recordingId ?? 'live'}`}
                src={streamSrc}
                isLive={playback.mode === 'live'}
                startOffsetSeconds={playback.mode === 'vod' ? playback.offsetSec : 0}
                title={selectedCam.display_name}
              />
              <TimelineScrubber
                windowStartMs={windowStartMs}
                windowEndMs={windowEndMs}
                segments={segments}
                onSeek={handleTimelineSeek}
              />
              <div className="flex flex-wrap gap-2 text-xs text-gray-500">
                <span>
                  Mode:{' '}
                  <span className="text-gray-300">{playback.mode === 'live' ? 'Live (go2rtc)' : 'Recorded segment'}</span>
                </span>
                {playback.mode === 'vod' && (
                  <span className="text-gray-400">Offset {playback.offsetSec.toFixed(1)}s into segment</span>
                )}
              </div>
            </>
          ) : (
            <div className="text-gray-500 text-sm">No cameras available.</div>
          )}
        </div>
        <div className="min-w-0 space-y-2">
          <h2 className="text-sm font-medium text-gray-300">Cameras</h2>
          <CameraClipGrid
            cameras={cameras}
            latestById={latestById}
            selectedId={selectedId}
            onSelectCamera={onSelectCamera}
          />
        </div>
      </div>
    </div>
  )
}
