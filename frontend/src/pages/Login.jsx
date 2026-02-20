import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import logo from '../assets/logo-black.png'

export default function Login() {
  const { login }           = useAuth()
  const navigate            = useNavigate()
  const [error, setError]   = useState('')
  const [loading, setLoading] = useState(false)

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
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-4xl mb-2">
              <imc src={logo} alt="Opus NVR" className="h-10 w-10 object-cover" />
          </div>
          <h1 className="text-2xl font-bold text-white">Opus NVR</h1>
          <p className="text-gray-400 text-sm mt-1">Sign in to continue</p>
        </div>

        {error && (
          <div className="mb-4 px-4 py-2 rounded text-sm bg-red-900/60 text-red-300 border border-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Username</label>
            <input
              name="username" type="text" required autoComplete="username" autoFocus
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm
                         text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Password</label>
            <input
              name="password" type="password" required autoComplete="current-password"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm
                         text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <button
            type="submit" disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white
                       font-semibold py-2 rounded-lg text-sm transition-colors mt-2"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}