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
  const online = cameras.filter(c => health[c.name.replace('-main', '-sub')] === true).length
  const total  = cameras.length

  return (
    <div className="mb-1">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-1.5 text-left hover:bg-gray-800 rounded-lg transition-colors"
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
                    .split(' — ').pop()}
                </span>
                {cam.recording_enabled && (
                  <span className="ml-auto w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" title="Recording" />
                )}
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
  const canLive = user?.role === 'admin' || user?.can_view_live !== false
  const canRec  = user?.role === 'admin' || user?.can_view_recordings !== false
  const navigate              = useNavigate()
  const [cameras, setCameras] = useState([])
  const [health, setHealth]   = useState({})
  const [open, setOpen]       = useState({})

  useEffect(() => {
    if (!canLive) {
      setCameras([])
      return
    }
    camerasApi.list()
      .then(all => {
        const mains = all.filter(c => c.active && c.is_main)
        setCameras(mains)
        const groups = {}
        mains.forEach(c => { groups[c.nvr_id ?? 'standalone'] = true })
        setOpen(groups)
      })
      .catch(console.error)
  }, [canLive])

  useEffect(() => {
    if (!canLive) {
      setHealth({})
      return
    }
    function fetchHealth() {
      healthApi.streams().then(setHealth).catch(() => {})
    }
    fetchHealth()
    const interval = setInterval(fetchHealth, HEALTH_POLL_MS)
    return () => clearInterval(interval)
  }, [canLive])

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  function toggleGroup(key) {
    setOpen(prev => ({ ...prev, [key]: !prev[key] }))
  }

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
        {canLive && (
          <div className="mt-1 text-xs text-gray-500">
            {onlineCount}/{cameras.length} cameras online
          </div>
        )}
      </div>

      {/* All Cameras + per-NVR list (live view) */}
      {canLive && (
        <>
          <div className="px-3 pt-3">
            <NavLink
              to="/" end
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`
              }
            >
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
              </svg>
              All Cameras
            </NavLink>
          </div>
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
        </>
      )}

      {!canLive && canRec && <div className="flex-1" />}

      {/* Recordings — any user with recording permission */}
      {canRec && (
        <div className={`px-3 ${canLive ? 'py-2' : 'pt-3'} border-t border-gray-800`}>
          <NavLink
            to="/recordings"
            className={({ isActive }) =>
              `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`
            }
          >
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h1.5C5.496 19.5 6 18.996 6 18.375m-3.75.125v-5.25A2.25 2.25 0 014.5 11.25h15A2.25 2.25 0 0121.75 13.5v3.75m-18.375 2.25c0 .621.504 1.125 1.125 1.125h15.75c.621 0 1.125-.504 1.125-1.125M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Recordings
          </NavLink>
        </div>
      )}

      {/* Admin links */}
      {user?.role === 'admin' && (
        <div className="px-3 py-3 border-t border-gray-800 space-y-0.5">
          {[
            { to: '/discovery',  label: 'Discovery',  icon: <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5M3.75 3.75l6.75 6.75m10.5-6.75v4.5m0-4.5h-4.5m4.5 0l-6.75 6.75M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0l6.75-6.75m10.5 6.75v-4.5m0 4.5h-4.5m4.5 0l-6.75-6.75" /> },
            { to: '/devices',    label: 'Devices',    icon: <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z" /> },
            { to: '/users',      label: 'Users',      icon: <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" /> },
          ].map(({ to, label, icon }) => (
            <NavLink key={to} to={to}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                  isActive ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`
              }
            >
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                {icon}
              </svg>
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
        <button onClick={handleLogout}
          className="text-xs text-gray-500 hover:text-red-400 transition-colors">
          Logout
        </button>
      </div>
    </aside>
  )
}