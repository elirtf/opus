import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { discoveryApi } from '../api/discovery'

// ── Helpers ────────────────────────────────────────────────────────────────

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function guessStreamType(label) {
  const l = label.toLowerCase()
  if (l.includes('main') || l.includes('primary') || l.includes('high') || l.includes('profile_1')) return 'main'
  if (l.includes('sub') || l.includes('secondary') || l.includes('low') || l.includes('profile_2')) return 'sub'
  return null
}

/**
 * Build default camera entries from a discovered device.
 * Auto-generates slugs and display names from the group name + device index.
 */
function buildDefaultCameras(device, groupSlug, deviceIndex) {
  return device.streams.map((stream, si) => {
    const streamType = guessStreamType(stream.label)
    const suffix     = streamType ?? `stream${si + 1}`
    const slug       = `${groupSlug}-cam${deviceIndex + 1}-${suffix}`
    const display    = `${device.name || `Camera ${deviceIndex + 1}`} — ${stream.label}`

    return {
      _key:         `${device.ip}-${si}`,
      name:         slug,
      display_name: display,
      rtsp_url:     stream.rtsp_url,
      selected:     true,
    }
  })
}


// ── Step components ────────────────────────────────────────────────────────

function Step1({ onDone }) {
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [subnet, setSubnet]     = useState('')
  const [scanning, setScanning] = useState(false)
  const [error, setError]       = useState('')

  async function handleScan(e) {
    e.preventDefault()
    if (!username) { setError('Username is required.'); return }
    setError('')
    setScanning(true)
    try {
      const { job_id: jobId } = await discoveryApi.startScan(username, password, subnet || undefined)
      // Poll until background scan finishes (avoids proxy/upstream timeouts on /24 scans).
      for (;;) {
        const st = await discoveryApi.scanStatus(jobId)
        if (st.status === 'running') {
          await new Promise((r) => setTimeout(r, 1000))
          continue
        }
        if (st.status === 'error') {
          throw new Error(st.error || 'Scan failed')
        }
        if (st.status === 'complete' && st.result) {
          onDone({ result: st.result, username, password })
          return
        }
        throw new Error('Unexpected scan status')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setScanning(false)
    }
  }

  const inputCls = "w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"

  return (
    <div className="max-w-md mx-auto">
      <div className="text-center mb-8">
        <div className="text-4xl mb-3">📡</div>
        <h3 className="text-lg font-semibold text-white">Scan for Cameras</h3>
        <p className="text-gray-400 text-sm mt-1">
          We'll run a multicast WS-Discovery scan first, then optionally scan a subnet range.
        </p>
        <p className="text-amber-200/80 text-xs mt-3 max-w-sm mx-auto leading-relaxed">
          Large subnet scans run in the background; this page polls until they finish (no single long HTTP request).
        </p>
      </div>

      {error && (
        <div className="mb-4 px-4 py-2 rounded text-sm bg-red-900/60 text-red-300 border border-red-700">{error}</div>
      )}

      <form onSubmit={handleScan} className="space-y-4">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">ONVIF Credentials</p>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Username *</label>
            <input className={inputCls} value={username} onChange={e => setUsername(e.target.value)} required />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Password</label>
            <input className={inputCls} type="password" value={password} onChange={e => setPassword(e.target.value)} />
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Subnet Scan (optional)</p>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">CIDR Range</label>
            <input
              className={inputCls}
              value={subnet}
              onChange={e => setSubnet(e.target.value)}
              placeholder="192.168.1.0/24"
            />
            <p className="text-xs text-gray-500 mt-1">
              Leave blank to use multicast only. Add a subnet to catch cameras that don't broadcast.
            </p>
          </div>
        </div>

        <button
          type="submit"
          disabled={scanning}
          className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors"
        >
          {scanning ? (
            <span className="flex items-center justify-center gap-2">
              <span className="animate-spin">⟳</span>
              Scanning… (multicast is quick; full /24 subnets can take several minutes)
            </span>
          ) : '🔍 Scan Network'}
        </button>
      </form>
    </div>
  )
}

function Step2({ scanResult, onDone, onBack }) {
  const { devices, total } = scanResult.result
  const [groupSlug, setGroupSlug]       = useState('')
  const [groupDisplay, setGroupDisplay] = useState('')
  const [cameras, setCameras]           = useState(() => {
    // Build initial camera list from all discovered devices
    return devices.flatMap((device, i) =>
      buildDefaultCameras(device, slugify(groupSlug || 'group'), i)
    )
  })
  const [adding, setAdding]   = useState(false)
  const [error, setError]     = useState('')
  const [expanded, setExpanded] = useState(() => {
    const s = {}
    devices.forEach((d, i) => { s[d.ip] = true })
    return s
  })

  // Rebuild camera slugs when group slug changes
  function handleGroupSlugChange(val) {
    const slug = slugify(val)
    setGroupSlug(slug)
    setCameras(prev => {
      return devices.flatMap((device, i) =>
        buildDefaultCameras(device, slug || 'group', i).map((newCam, j) => {
          const existing = prev.find(p => p._key === newCam._key)
          return existing
            ? { ...existing, name: newCam.name }
            : newCam
        })
      )
    })
  }

  function toggleCamera(key) {
    setCameras(prev => prev.map(c => c._key === key ? { ...c, selected: !c.selected } : c))
  }

  function updateCamera(key, field, value) {
    setCameras(prev => prev.map(c => c._key === key ? { ...c, [field]: value } : c))
  }

  function toggleDevice(ip) {
    const deviceCameras = cameras.filter(c => c._key.startsWith(ip))
    const allSelected   = deviceCameras.every(c => c.selected)
    setCameras(prev => prev.map(c =>
      c._key.startsWith(ip) ? { ...c, selected: !allSelected } : c
    ))
  }

  const selectedCameras = cameras.filter(c => c.selected)

  async function handleAdd() {
    if (!groupSlug)          { setError('Group name (slug) is required.'); return }
    if (!groupDisplay)       { setError('Group display name is required.'); return }
    if (!selectedCameras.length) { setError('Select at least one camera.'); return }
    setError('')
    setAdding(true)
    try {
      const result = await discoveryApi.add(groupSlug, groupDisplay, selectedCameras)
      onDone(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setAdding(false)
    }
  }

  const inputCls = "bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"

  if (total === 0) {
    return (
      <div className="max-w-md mx-auto text-center">
        <div className="text-4xl mb-3">🔇</div>
        <h3 className="text-lg font-semibold text-white">No cameras found</h3>
        <p className="text-gray-400 text-sm mt-2">
          Try adding a subnet range, or check that cameras are on the same network and ONVIF is enabled.
        </p>
        <button onClick={onBack} className="mt-6 text-indigo-400 hover:underline text-sm">
          ← Try again
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-white">
            {total} camera{total !== 1 ? 's' : ''} found
          </h3>
          <p className="text-gray-400 text-sm">Select streams to add and name your group.</p>
        </div>
        <button onClick={onBack} className="text-sm text-gray-400 hover:text-white transition-colors">
          ← Rescan
        </button>
      </div>

      {error && (
        <div className="mb-4 px-4 py-2 rounded text-sm bg-red-900/60 text-red-300 border border-red-700">{error}</div>
      )}

      {/* Group naming */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-4 grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Group Slug *</label>
          <input
            className={`${inputCls} w-full text-sm py-2`}
            value={groupSlug}
            onChange={e => handleGroupSlugChange(e.target.value)}
            placeholder="warehouse-floor"
          />
          <p className="text-xs text-gray-500 mt-1">Used in stream names. No spaces.</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Display Name *</label>
          <input
            className={`${inputCls} w-full text-sm py-2`}
            value={groupDisplay}
            onChange={e => setGroupDisplay(e.target.value)}
            placeholder="Warehouse Floor"
          />
          <p className="text-xs text-gray-500 mt-1">Shown in the sidebar.</p>
        </div>
      </div>

      {/* Device list */}
      <div className="space-y-3 mb-6">
        {devices.map((device, di) => {
          const deviceCams    = cameras.filter(c => c._key.startsWith(device.ip))
          const selectedCount = deviceCams.filter(c => c.selected).length
          const isExpanded    = expanded[device.ip]

          return (
            <div key={device.ip} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              {/* Device header */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800">
                <input
                  type="checkbox"
                  checked={deviceCams.every(c => c.selected)}
                  onChange={() => toggleDevice(device.ip)}
                  className="w-4 h-4 accent-indigo-500"
                />
                <button
                  className="flex-1 flex items-center justify-between text-left"
                  onClick={() => setExpanded(p => ({ ...p, [device.ip]: !p[device.ip] }))}
                >
                  <div>
                    <span className="font-medium text-white">{device.name}</span>
                    <span className="ml-2 text-xs text-gray-500">{device.ip}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">{selectedCount}/{deviceCams.length} selected</span>
                    <span className={`text-gray-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`}>›</span>
                  </div>
                </button>
              </div>

              {/* Stream rows */}
              {isExpanded && (
                <div className="divide-y divide-gray-800">
                  {deviceCams.map(cam => (
                    <div key={cam._key} className="flex items-center gap-3 px-4 py-2.5">
                      <input
                        type="checkbox"
                        checked={cam.selected}
                        onChange={() => toggleCamera(cam._key)}
                        className="w-4 h-4 accent-indigo-500 shrink-0"
                      />
                      <div className="flex-1 grid grid-cols-2 gap-2 min-w-0">
                        <div>
                          <label className="block text-xs text-gray-500 mb-0.5">Stream name</label>
                          <input
                            className={`${inputCls} w-full`}
                            value={cam.name}
                            onChange={e => updateCamera(cam._key, 'name', e.target.value)}
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-0.5">Display name</label>
                          <input
                            className={`${inputCls} w-full`}
                            value={cam.display_name}
                            onChange={e => updateCamera(cam._key, 'display_name', e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-400">
          {selectedCameras.length} stream{selectedCameras.length !== 1 ? 's' : ''} selected
        </span>
        <button
          onClick={handleAdd}
          disabled={adding || !selectedCameras.length}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold px-6 py-2.5 rounded-xl text-sm transition-colors"
        >
          {adding ? 'Adding...' : `Add ${selectedCameras.length} Camera${selectedCameras.length !== 1 ? 's' : ''}`}
        </button>
      </div>
    </div>
  )
}

function Step3({ result, onStartOver }) {
  const navigate = useNavigate()

  return (
    <div className="max-w-md mx-auto text-center">
      <div className="text-5xl mb-4">✅</div>
      <h3 className="text-xl font-semibold text-white mb-2">Cameras Added</h3>
      <p className="text-gray-400 text-sm mb-1">
        <span className="text-white font-medium">{result.created}</span> cameras added
        {result.group_name && (
          <> to group <span className="text-white font-medium">"{result.group_name}"</span></>
        )}
      </p>
      {result.skipped > 0 && (
        <p className="text-yellow-400 text-sm mb-1">{result.skipped} already existed and were skipped.</p>
      )}
      {result.errors?.length > 0 && (
        <p className="text-red-400 text-sm mb-1">{result.errors.length} entries had errors.</p>
      )}

      <div className="flex gap-3 justify-center mt-8">
        <button
          onClick={() => navigate('/')}
          className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-5 py-2 rounded-lg text-sm transition-colors"
        >
          View Live Feed
        </button>
        <button
          onClick={onStartOver}
          className="bg-gray-800 hover:bg-gray-700 text-gray-300 px-5 py-2 rounded-lg text-sm transition-colors"
        >
          Scan Again
        </button>
      </div>
    </div>
  )
}


// ── Main page ──────────────────────────────────────────────────────────────

const STEPS = ['Scan', 'Review', 'Done']

export default function Discovery() {
  const [step, setStep]           = useState(0)
  const [scanResult, setScanResult] = useState(null)
  const [addResult, setAddResult] = useState(null)

  function handleScanDone(data) {
    setScanResult(data)
    setStep(1)
  }

  function handleAddDone(result) {
    setAddResult(result)
    setStep(2)
  }

  function handleStartOver() {
    setScanResult(null)
    setAddResult(null)
    setStep(0)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-800 bg-gray-900 shrink-0">
        <div className="flex items-center justify-between max-w-3xl mx-auto">
          <h2 className="text-lg font-bold text-white">Camera Discovery</h2>
          {/* Step indicator */}
          <div className="flex items-center gap-2">
            {STEPS.map((label, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className={`flex items-center gap-1.5 text-xs font-medium ${
                  i === step ? 'text-white' : i < step ? 'text-green-400' : 'text-gray-600'
                }`}>
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${
                    i === step  ? 'bg-indigo-600 text-white' :
                    i < step    ? 'bg-green-600 text-white' :
                    'bg-gray-800 text-gray-500'
                  }`}>
                    {i < step ? '✓' : i + 1}
                  </span>
                  {label}
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`w-8 h-px ${i < step ? 'bg-green-600' : 'bg-gray-700'}`} />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-8">
        {step === 0 && <Step1 onDone={handleScanDone} />}
        {step === 1 && (
          <Step2
            scanResult={scanResult}
            onDone={handleAddDone}
            onBack={() => setStep(0)}
          />
        )}
        {step === 2 && (
          <Step3 result={addResult} onStartOver={handleStartOver} />
        )}
      </div>
    </div>
  )
}