import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { authApi } from '../api/auth'
import { useAuth } from '../context/AuthContext'

export default function Setup() {
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    authApi
      .setupStatus()
      .then((data) => {
        if (cancelled) return
        if (!data.needs_setup) navigate('/login', { replace: true })
      })
      .catch(() => {
        if (!cancelled) setError('Could not reach the server.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [navigate])

  useEffect(() => {
    if (!authLoading && user && user !== false) {
      navigate('/', { replace: true })
    }
  }, [authLoading, user, navigate])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    const form = new FormData(e.target)
    const username = String(form.get('username') || '').trim()
    const password = String(form.get('password') || '')
    const confirm = String(form.get('confirm') || '')
    if (password !== confirm) {
      setError('Passwords do not match.')
      setSubmitting(false)
      return
    }
    try {
      await authApi.setup({ username, password })
      window.location.assign('/')
    } catch (err) {
      setError(err.message || 'Setup failed.')
    } finally {
      setSubmitting(false)
    }
  }

  if (authLoading || loading) {
    return (
      <div className="min-h-[100dvh] bg-gray-950 flex items-center justify-center text-gray-500 text-sm">
        Loading…
      </div>
    )
  }

  return (
    <div
      className="min-h-[100dvh] bg-gray-950 flex items-center justify-center px-4 overflow-x-hidden overflow-y-auto box-border"
      style={{
        paddingTop: 'max(1rem, env(safe-area-inset-top))',
        paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))',
      }}
    >
      <div className="w-full max-w-sm py-4">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-white tracking-tight">Welcome to Opus NVR</h1>
          <p className="text-gray-400 text-sm mt-2">Create the administrator account for this installation.</p>
        </div>
        {error && (
          <div className="mb-4 px-4 py-2.5 rounded-lg text-sm bg-red-900/40 text-red-300 border border-red-800">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} className="bg-gray-900 rounded-2xl border border-gray-800 p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Username</label>
            <input
              name="username"
              type="text"
              required
              autoComplete="username"
              autoFocus
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-base text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="admin"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Password</label>
            <input
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-base text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <p className="text-xs text-gray-500 mt-1">At least 8 characters.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Confirm password</label>
            <input
              name="confirm"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-base text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium text-sm"
          >
            {submitting ? 'Creating…' : 'Create administrator'}
          </button>
        </form>
      </div>
    </div>
  )
}
