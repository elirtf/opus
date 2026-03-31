/** Collator so numeric parts order as numbers (1, 2, 10 — not 1, 10, 2). */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function naturalCompare(a, b) {
  return collator.compare(String(a ?? ''), String(b ?? ''))
}

/** Cameras / streams: display name, then stream key. */
export function compareCamerasByDisplayName(a, b) {
  const d = naturalCompare(a.display_name, b.display_name)
  if (d !== 0) return d
  return naturalCompare(a.name, b.name)
}

/**
 * NVR-style rows with a channel index: sort by channel naturally, then name.
 * Rows without channel fall back to name order.
 */
export function compareByChannelThenName(a, b) {
  const c = naturalCompare(a.channel ?? '', b.channel ?? '')
  if (c !== 0) return c
  return compareCamerasByDisplayName(a, b)
}
