import { withOrigin } from '../../../api/client'

function mainStreamKey(cam) {
  if (cam?.name?.endsWith('-main')) return cam.name
  if (cam?.paired_stream_name?.endsWith('-main')) return cam.paired_stream_name
  return cam?.name
}

function thumbUrl(cam) {
  const src = mainStreamKey(cam)
  if (!src) return null
  return withOrigin(`/go2rtc/api/frame.jpeg?src=${encodeURIComponent(src)}`)
}

/**
 * One tile per camera: snapshot (or placeholder) plus latest segment summary.
 */
export default function CameraClipGrid({ cameras, latestById, onSelectCamera, selectedId }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {cameras.map((cam) => {
        const latest = latestById[cam.id]
        const active = selectedId === cam.id
        const tu = thumbUrl(cam)
        return (
          <button
            key={cam.id}
            type="button"
            onClick={() => onSelectCamera(cam.id)}
            className={`text-left rounded-xl border overflow-hidden transition-colors ${
              active ? 'border-indigo-500 ring-1 ring-indigo-500/40' : 'border-gray-800 hover:border-gray-600'
            } bg-gray-900/60`}
          >
            <div className="aspect-video bg-black relative">
              {tu ? (
                <img
                  src={tu}
                  alt=""
                  className="w-full h-full object-cover"
                  loading="lazy"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none'
                  }}
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-gray-600 text-xs">
                  No preview
                </div>
              )}
            </div>
            <div className="p-3 space-y-1">
              <div className="text-sm font-medium text-white truncate">{cam.display_name}</div>
              <div className="text-xs text-gray-500 truncate">{cam.name}</div>
              <div className="text-xs text-gray-400">
                {latest?.started_at
                  ? `Latest: ${new Date(latest.started_at).toLocaleString()}`
                  : 'No segments in index'}
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
