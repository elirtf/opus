import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { authApi } from '../api/auth'

export default function Login() {
  const { login }             = useAuth()
  const navigate              = useNavigate()
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    authApi
      .setupStatus()
      .then((data) => {
        if (!cancelled && data.needs_setup) navigate('/setup', { replace: true })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [navigate])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const form = new FormData(e.target)
    try {
      await login(form.get('username'), form.get('password'))
      navigate('/')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
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

        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 mb-4">
            <svg className="w-7 h-7 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9A2.25 2.25 0 0013.5 5.25h-9A2.25 2.25 0 002.25 7.5v9A2.25 2.25 0 004.5 18.75z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Opus NVR</h1>
          <p className="text-gray-400 text-sm mt-1">Sign in to continue</p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 px-4 py-2.5 rounded-lg text-sm bg-red-900/40 text-red-300 border border-red-800 flex items-center gap-2">
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="bg-gray-900 rounded-2xl border border-gray-800 p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Username</label>
            <input
              name="username" type="text" required autoComplete="username" autoFocus
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-base
                         text-white placeholder-gray-500 focus:outline-none focus:ring-2
                         focus:ring-indigo-500 focus:border-transparent transition-colors"
              placeholder="admin"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Password</label>
            <input
              name="password" type="password" required autoComplete="current-password"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-base
                         text-white placeholder-gray-500 focus:outline-none focus:ring-2
                         focus:ring-indigo-500 focus:border-transparent transition-colors"
              placeholder="••••••••"
            />
          </div>
          <button
            type="submit" disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white
                       font-semibold py-2.5 rounded-lg text-sm transition-colors mt-2
                       flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                </svg>
                Signing in...
              </>
            ) : 'Sign In'}
          </button>
        </form>

        <p className="text-center text-xs text-gray-600 mt-6">Opus NVR · Self-hosted</p>
      </div>
    </div>
  )
}
