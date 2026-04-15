import { useEffect, useRef, useState, useCallback } from 'react'
import Hls from 'hls.js'
import { withOrigin } from '../../../api/client'
import { isFirefox } from '../../../components/player/LivePlayer'

/**
 * hls.js only (no native fallback) — Vite already depends on hls.js.
 * Never auto-plays: manifest ready leaves video paused until the user presses play.
 */
export default function PlaybackHlsPlayer({
  src,
  isLive,
  startOffsetSeconds = 0,
  title = 'Playback',
}) {
  const videoRef = useRef(null)
  const hlsRef = useRef(null)
  const [err, setErr] = useState(null)
  const offsetRef = useRef(startOffsetSeconds)
  offsetRef.current = startOffsetSeconds

  const cleanup = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !src) return

    setErr(null)
    cleanup()

    const abs = withOrigin(src)
    video.controls = true
    video.playsInline = true
    video.setAttribute('playsinline', '')
    video.setAttribute('webkit-playsinline', '')
    video.preload = 'metadata'
    video.pause()

    let cancelled = false
    let seekOnce = () => {}

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: !isFirefox(),
        lowLatencyMode: Boolean(isLive),
        liveSyncDurationCount: isLive ? 2 : undefined,
        liveMaxLatencyDurationCount: isLive ? 6 : undefined,
        xhrSetup(xhr, url) {
          // Master playlist hits Flask (/api/stream/...) with session auth.
          if (typeof url === 'string' && url.includes('/api/')) {
            xhr.withCredentials = true
          }
        },
      })
      hlsRef.current = hls
      hls.loadSource(abs)
      hls.attachMedia(video)

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (cancelled || !data.fatal) return
        setErr(data.type === 'mediaError' ? 'Media error during playback.' : 'Stream failed to load.')
        cleanup()
      })

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (cancelled) return
        video.pause()
      })

      seekOnce = () => {
        if (cancelled) return
        const off = offsetRef.current
        if (!isLive && off > 0.05 && Number.isFinite(video.duration)) {
          try {
            const cap = Math.max(0, video.duration - 0.25)
            video.currentTime = Math.min(off, cap)
          } catch {
            /* ignore */
          }
        }
        video.pause()
      }
      video.addEventListener('loadedmetadata', seekOnce, { once: true })
    } else {
      setErr('HLS.js is not supported in this browser.')
    }

    return () => {
      cancelled = true
      video.removeEventListener('loadedmetadata', seekOnce)
      cleanup()
      video.removeAttribute('src')
      video.load()
    }
  }, [src, isLive, cleanup])

  return (
    <div className="relative w-full aspect-video bg-black rounded-xl border border-gray-800 overflow-hidden">
      <video
        ref={videoRef}
        className="w-full h-full object-contain"
        title={title}
        muted={false}
      />
      {err && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/85 text-amber-200 text-sm px-4 text-center">
          {err}
        </div>
      )}
    </div>
  )
}
