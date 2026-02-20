import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const navItems = [
  { to: '/',         label: 'Live View' },
]

const adminItems = [
  { to: '/users', label: 'Users' },
  { to: '/cameras',  label: 'Cameras' },
  { to: '/nvrs',     label: 'NVRs' },
]

export default function Layout({ children }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-950">
      <nav className="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-6">
          <span className="font-bold text-lg tracking-wide text-white">🎥 Opus</span>
          {navItems.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `text-sm transition-colors ${isActive ? 'text-white font-medium' : 'text-gray-400 hover:text-white'}`
              }
            >
              {label}
            </NavLink>
          ))}
          {user?.role === 'admin' && adminItems.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `text-sm transition-colors ${isActive ? 'text-white font-medium' : 'text-gray-400 hover:text-white'}`
              }
            >
              {label}
            </NavLink>
          ))}
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-400">
          <span>
            {user?.username}
            <span className={`ml-2 px-1.5 py-0.5 rounded text-xs font-medium ${
              user?.role === 'admin'
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-700 text-gray-300'
            }`}>
              {user?.role}
            </span>
          </span>
          <button onClick={handleLogout} className="hover:text-red-400 transition-colors">
            Logout
          </button>
        </div>
      </nav>
      <main className="flex-1 flex flex-col">
        {children}
      </main>
    </div>
  )
}