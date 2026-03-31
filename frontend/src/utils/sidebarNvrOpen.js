const LS_KEY = 'opus.sidebar.nvrSectionsOpen'

/** @returns {Record<string, boolean>|null} */
export function readSavedNvrOpen() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return null
    const o = JSON.parse(raw)
    return typeof o === 'object' && o !== null && !Array.isArray(o) ? o : null
  } catch {
    return null
  }
}

export function writeSavedNvrOpen(map) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(map))
  } catch {
    /* private / full */
  }
}

/**
 * Merge persisted open/closed with current site keys. New keys default open.
 * @param {Record<string, boolean>|null} saved
 * @param {string[]} groupKeys
 */
export function mergeNvrOpenState(saved, groupKeys) {
  const out = {}
  for (const key of groupKeys) {
    const k = String(key)
    if (saved && typeof saved[k] === 'boolean') {
      out[k] = saved[k]
    } else {
      out[k] = true
    }
  }
  return out
}
