/**
 * Base fetch wrapper.
 * - Always sends/receives JSON
 * - Throws a plain Error with message from the server on non-2xx responses
 * - Returns the parsed `data` field from successful responses
 */
async function request(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin', // send session cookie
  }
  if (body !== undefined) {
    opts.body = JSON.stringify(body)
  }

  const res = await fetch(path, opts)
  const json = await res.json().catch(() => ({}))

  if (!res.ok) {
    throw new Error(json.error || `Request failed (${res.status})`)
  }

  return json.data !== undefined ? json.data : json
}

export const api = {
  get:    (path)        => request('GET',    path),
  post:   (path, body)  => request('POST',   path, body),
  patch:  (path, body)  => request('PATCH',  path, body),
  delete: (path)        => request('DELETE', path),
}