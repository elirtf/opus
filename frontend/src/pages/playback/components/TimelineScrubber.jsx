import { useMemo, useCallback } from 'react'

function parseBoundary(iso, fallbackMs) {
  if (!iso) return fallbackMs
  const t = Date.parse(iso)
  return Number.isNaN(t) ? fallbackMs : t
}

/**
 * Horizontal availability strip: each segment is a block; click maps x → wall-clock time.
 */
export default function TimelineScrubber({
  windowStartMs,
  windowEndMs,
  segments,
  onSeek,
  className = '',
}) {
  const range = Math.max(1, windowEndMs - windowStartMs)

  const blocks = useMemo(() => {
    if (!segments?.length) return []
    return segments.map((s) => {
      const a = Date.parse(s.start_time)
      const endMs = parseBoundary(
        s.end_time,
        a + (Number(s.duration_seconds) || 0) * 1000,
      )
      const b = Number.isNaN(endMs) ? windowEndMs : endMs
      const left = ((a - windowStartMs) / range) * 100
      const w = ((b - a) / range) * 100
      if (!Number.isFinite(left) || !Number.isFinite(w)) return null
      if (left + w < 0 || left > 100) return null
      return {
        id: s.id,
        left: Math.max(0, left),
        width: Math.min(100 - Math.max(0, left), Math.max(0.15, w)),
      }
    }).filter(Boolean)
  }, [segments, windowStartMs, windowEndMs, range])

  const onClickTrack = useCallback(
    (e) => {
      const rect = e.currentTarget.getBoundingClientRect()
      const x = e.clientX - rect.left
      const frac = rect.width > 0 ? Math.min(1, Math.max(0, x / rect.width)) : 0
      const t = windowStartMs + frac * range
      onSeek(new Date(t).toISOString())
    },
    [onSeek, range, windowStartMs],
  )

  return (
    <div className={`rounded-lg border border-gray-800 bg-gray-900/80 p-2 ${className}`}>
      <div className="flex justify-between text-[10px] uppercase tracking-wide text-gray-500 mb-1">
        <span>{new Date(windowStartMs).toLocaleString()}</span>
        <span>{new Date(windowEndMs).toLocaleString()}</span>
      </div>
      <button
        type="button"
        onClick={onClickTrack}
        className="relative w-full h-8 rounded bg-gray-950 border border-gray-800 overflow-hidden cursor-pointer"
        aria-label="Recording timeline — click to seek"
      >
        <div className="absolute inset-y-0 left-0 right-0 bg-gray-900/40" />
        {blocks.map((b) => (
          <div
            key={b.id}
            className="absolute top-1 bottom-1 rounded-sm bg-indigo-500/80 border border-indigo-400/40 pointer-events-none"
            style={{ left: `${b.left}%`, width: `${b.width}%` }}
            title="Recorded"
          />
        ))}
      </button>
    </div>
  )
}
