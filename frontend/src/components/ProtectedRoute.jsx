import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function ProtectedRoute({
  children,
  adminOnly = false,
  requireLiveView = false,
  requireRecordingsView = false,
}) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-950">
        <div className="text-gray-500 text-sm">Loading...</div>
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  if (adminOnly && user.role !== 'admin') return <Navigate to="/" replace />

  if (
    requireLiveView &&
    user.role !== 'admin' &&
    user.can_view_live === false
  ) {
    if (user.can_view_recordings === false) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-gray-950 text-gray-400 text-sm px-6 text-center max-w-md">
          This account has no live view or recording access. Contact an administrator.
        </div>
      )
    }
    return <Navigate to="/recordings" replace />
  }

  if (
    requireRecordingsView &&
    user.role !== 'admin' &&
    user.can_view_recordings === false
  ) {
    return <Navigate to="/" replace />
  }

  return children
}