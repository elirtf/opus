import { NavLink, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { camerasApi } from '../api/cameras'
import { healthApi } from '../api/health'

const HEALTH_POLL_MS = 30000

function StatusDot({ online }) {
  return (
    <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
      online === true  ? 'bg-green-400' :
      online === false ? 'bg-red-500'   :
      'bg-gray-600'
    }`} />
  )
}

function NVRGroup({ name, cameras, health, isOpen, onToggle }) {
  const online  = cameras.filter(c => health[c.name.replace('-main', '-sub')] === true).length
  const total   = cameras.length

  return (
    <div className="mb-1">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-1.5 text-left hover:bg-gray-800 rounded-lg transition-colors group"
      >
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider truncate">
          {name}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-gray-500">{online}/{total}</span>
          <span className={`text-gray-500 text-xs transition-transform ${isOpen ? 'rotate-90' : ''}`}>›</span>
        </div>
      </button>

      {isOpen && (
        <div className="mt-0.5 space-y-0.5">
          {cameras.map(cam => {
            const subName = cam.name.replace('-main', '-sub')
            return (
              <NavLink
                key={cam.id}
                to={`/camera/${cam.name}`}
                className={({ isActive }) =>
                  `flex items-center gap-2 pl-4 pr-3 py-1.5 rounded-lg text-sm transition-colors truncate ${
                    isActive
                      ? 'bg-gray-700 text-white'
                      : 'text-gray-400 hover:text-white hover:bg-gray-800'
                  }`
                }
              >
                <StatusDot online={health[subName]} />
                <span className="truncate">
                  {cam.display_name
                    .replace(' — ', ' ')
                    .replace(' Main', '')
                    .replace(/^.*? — /, '')}
                </span>
              </NavLink>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function Sidebar() {
  const { user, logout }      = useAuth()
  const navigate              = useNavigate()
  const [cameras, setCameras] = useState([])
  const [health, setHealth]   = useState({})
  const [open, setOpen]       = useState({})  // nvr group open state

  useEffect(() => {
    camerasApi.list()
      .then(all => {
        const mains = all.filter(c => c.active && c.is_main)
        setCameras(mains)
        // Default all groups to open
        const groups = {}
        mains.forEach(c => { groups[c.nvr_id ?? 'standalone'] = true })
        setOpen(groups)
      })
      .catch(console.error)
  }, [])

  useEffect(() => {
    function fetchHealth() {
      healthApi.streams().then(setHealth).catch(() => {})
    }
    fetchHealth()
    const interval = setInterval(fetchHealth, HEALTH_POLL_MS)
    return () => clearInterval(interval)
  }, [])

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  function toggleGroup(key) {
    setOpen(prev => ({ ...prev, [key]: !prev[key] }))
  }

  // Group cameras by NVR
  const groups = {}
  cameras.forEach(cam => {
    const key   = cam.nvr_id ?? 'standalone'
    const label = cam.nvr_name ?? 'Standalone'
    if (!groups[key]) groups[key] = { label, cameras: [] }
    groups[key].cameras.push(cam)
  })

  const onlineCount = cameras.filter(c => health[c.name.replace('-main', '-sub')] === true).length

  return (
    <aside className="w-56 bg-gray-900 border-r border-gray-800 flex flex-col h-screen shrink-0">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-gray-800">
        <NavLink to="/" className="flex items-center gap-2">
          <span className="text-xl">🎥</span>
          <span className="font-bold text-white tracking-wide">Opus NVR</span>
        </NavLink>
        <div className="mt-1 text-xs text-gray-500">
          {onlineCount}/{cameras.length} cameras online
        </div>
      </div>

      {/* Live View link */}
      <div className="px-3 pt-3">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              isActive ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'
            }`
          }
        >
          <span>⊞</span> All Cameras
        </NavLink>
      </div>

      {/* Camera groups */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
        {Object.entries(groups).map(([key, group]) => (
          <NVRGroup
            key={key}
            name={group.label}
            cameras={group.cameras}
            health={health}
            isOpen={open[key] ?? true}
            onToggle={() => toggleGroup(key)}
          />
        ))}
      </div>

      {/* Admin links */}
      {user?.role === 'admin' && (
        <div className="px-3 py-3 border-t border-gray-800 space-y-0.5">
          {[
            { to: '/cameras', label: '📷 Cameras' },
            { to: '/nvrs',    label: '🖥️ NVRs' },
            { to: '/users',   label: '👤 Users' },
          ].map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `block px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  isActive ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </div>
      )}

      {/* User / logout */}
      <div className="px-4 py-3 border-t border-gray-800 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-white">{user?.username}</div>
          <div className="text-xs text-gray-500">{user?.role}</div>
        </div>
        <button
          onClick={handleLogout}
          className="text-xs text-gray-500 hover:text-red-400 transition-colors"
        >
          Logout
        </button>
      </div>
    </aside>
  )
}