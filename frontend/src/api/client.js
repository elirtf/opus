/**
 * Optional remote origin (Capacitor shell, split UI/API hosts).
 * - Build-time: `VITE_OPUS_ORIGIN=https://recorder.example`
 * - Runtime: `window.__OPUS_ORIGIN__ = 'https://...'` before the app bundle loads
 */
export function getOpusOrigin() {
  if (typeof window !== 'undefined' && window.__OPUS_ORIGIN__) {
    return String(window.__OPUS_ORIGIN__).replace(/\/$/, '')
  }
  const v = import.meta.env.VITE_OPUS_ORIGIN
  if (v) return String(v).replace(/\/$/, '')
  return ''
}

/** Prefix relative paths with configured origin; pass absolute URLs through unchanged. */
export function withOrigin(path) {
  if (path == null || path === '') return path
  if (path.startsWith('http://') || path.startsWith('https://')) return path
  const o = getOpusOrigin()
  if (!o) return path
  const p = path.startsWith('/') ? path : `/${path}`
  return `${o}${p}`
}

/**
 * Low-level fetch with JSON handling, cookies, optional Bearer token (localStorage `opus_bearer_token`).
 */
export async function apiFetch(path, opts = {}) {
  const url = withOrigin(path)
  const headers = { ...opts.headers }
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('opus_bearer_token') : null
  if (token) headers['Authorization'] = `Bearer ${token}`

  if (opts.body !== undefined && headers['Content-Type'] === undefined) {
    headers['Content-Type'] = 'application/json'
  }

  const res = await fetch(url, {
    credentials: 'include',
    ...opts,
    headers,
  })

  let json = {}
  try {
    const text = await res.text()
    if (text) json = JSON.parse(text)
  } catch {
    json = {}
  }

  if (!res.ok) {
    const err = new Error(json.error || `Request failed (${res.status})`)
    err.status = res.status
    throw err
  }

  return json.data !== undefined ? json.data : json
}

async function jsonRequest(method, path, body) {
  return apiFetch(path, {
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

export const api = {
  get:    (path)        => apiFetch(path, { method: 'GET' }),
  post:   (path, body)  => jsonRequest('POST', path, body),
  patch:  (path, body)  => jsonRequest('PATCH', path, body),
  delete: (path)        => apiFetch(path, { method: 'DELETE' }),
}
