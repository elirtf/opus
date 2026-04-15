/**
 * Alert / motion integration: call seekToEvent(cameraId, isoTimestamp) to focus playback.
 * PlaybackPage registers the implementation; before navigation this is a no-op.
 */
let seekImpl = null

export function registerPlaybackSeekHandler(fn) {
  seekImpl = typeof fn === 'function' ? fn : null
}

/**
 * @param {number} cameraId - Camera.id from /api/cameras
 * @param {string} isoTimestamp - ISO 8601 wall time to jump to
 */
export function seekToEvent(cameraId, isoTimestamp) {
  if (seekImpl) seekImpl({ cameraId, isoTimestamp })
}
