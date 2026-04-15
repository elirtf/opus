import { api } from './client'

export const playbackApi = {
  segments(cameraId, startIso, endIso) {
    const q = new URLSearchParams({
      camera_id: String(cameraId),
      start: startIso,
      end: endIso,
    })
    return api.get(`/api/segments?${q}`)
  },
}

/** Relative URL (pass through withOrigin if needed). */
export function playbackStreamUrl(cameraId, { recordingId, at } = {}) {
  const q = new URLSearchParams()
  if (recordingId != null) q.set('recording_id', String(recordingId))
  if (at) q.set('at', at)
  const qs = q.toString()
  return `/api/stream/${cameraId}/index.m3u8${qs ? `?${qs}` : ''}`
}
