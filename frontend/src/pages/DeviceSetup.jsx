import { useState, useEffect, useCallback } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { nvrsApi } from '../api/nvrs'
import { camerasApi } from '../api/cameras'
import { healthApi } from '../api/health'
import Modal from '../components/Modal'
import ConfirmModal from '../components/ConfirmModal'
import Spinner from '../components/Spinner'
import { useToast, ToastList } from '../components/Toast'
import { compareCamerasByDisplayName } from '../utils/naturalCompare'

const EMPTY_FORM = { name: '', display_name: '', ip_address: '', username: '', password: '', max_channels: 64, active: true }

function NVRForm({ initial = EMPTY_FORM, onSubmit, onClose, submitLabel }) {
  const [form, setForm]     = useState(initial)
  const [error, setError]   = useState('')
  const [saving, setSaving] = useState(false)

  function set(field, value) { setForm(f => ({ ...f, [field]: value })) }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await onSubmit(form)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const inputCls = "w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
  const isEdit = Boolean(initial?.id)

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && <div className="px-3 py-2 rounded text-sm bg-red-900/60 text-red-300 border border-red-700">{error}</div>}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">Internal Name (slug) *</label>
        <input className={inputCls} value={form.name} onChange={e => set('name', e.target.value)} placeholder="warehouse-nvr" required />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">Display Name *</label>
        <input className={inputCls} value={form.display_name} onChange={e => set('display_name', e.target.value)} placeholder="Warehouse NVR" required />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">IP Address</label>
        <input className={inputCls} value={form.ip_address} onChange={e => set('ip_address', e.target.value)} placeholder="192.168.1.100" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Username</label>
          <input className={inputCls} value={form.username} onChange={e => set('username', e.target.value)} placeholder="admin" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Password</label>
          <input className={inputCls} type="password" value={form.password} onChange={e => set('password', e.target.value)} placeholder={initial.id ? '(unchanged)' : ''} />
        </div>
      </div>
      {!isEdit && (
        <p className="text-xs text-gray-500 leading-relaxed">
          Channels are detected automatically: the server tries each DVR slot (up to 64 by default) and only adds cameras where the{' '}
          <span className="text-gray-400">main</span> RTSP stream responds. Empty slots are skipped. To scan more than 64 slots, add the site then use{' '}
          <strong className="text-gray-400">Edit</strong> and raise the limit.
        </p>
      )}
      {isEdit && (
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Channel probe limit (sync)</label>
          <input
            className={inputCls}
            type="number"
            min="1"
            max="256"
            value={form.max_channels}
            onChange={e => set('max_channels', Math.min(256, Math.max(1, parseInt(e.target.value, 10) || 1)))}
          />
          <p className="text-xs text-gray-600 mt-1">
            On sync/import, try channels <span className="font-mono text-gray-500">1</span> through this number; non-existent channels are omitted after RTSP probe.
          </p>
        </div>
      )}
      {initial.id && (
        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
          <input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)} />
          Active
        </label>
      )}
      <div className="flex gap-2 pt-2">
        <button type="submit" disabled={saving}
          className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white py-2 rounded-lg text-sm font-medium">
          {saving ? 'Saving...' : submitLabel}
        </button>
        <button type="button" onClick={onClose}
          className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 py-2 rounded-lg text-sm">
          Cancel
        </button>
      </div>
    </form>
  )
}

function CameraEditForm({ camera, onSubmit, onClose }) {
  const [displayName, setDisplayName] = useState(camera.display_name || '')
  const [active, setActive] = useState(!!camera.active)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const inputCls = "w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await onSubmit({ display_name: displayName.trim(), active })
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && <div className="px-3 py-2 rounded text-sm bg-red-900/60 text-red-300 border border-red-700">{error}</div>}
      <p className="text-xs text-gray-500 font-mono break-all">{camera.name}</p>
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">Display name</label>
        <input className={inputCls} value={displayName} onChange={e => setDisplayName(e.target.value)} required />
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
        <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
        Active (shown in live view)
      </label>
      <p className="text-xs text-gray-500">
        Recording on/off and policies are managed in <strong className="text-gray-400">Recordings</strong> after setup.
      </p>
      <div className="flex gap-2 pt-2">
        <button type="submit" disabled={saving}
          className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white py-2 rounded-lg text-sm font-medium">
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button type="button" onClick={onClose} className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 py-2 rounded-lg text-sm">Cancel</button>
      </div>
    </form>
  )
}

export default function DeviceSetup() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get('tab') === 'cameras' ? 'cameras' : 'nvrs'

  const setTab = useCallback((t) => {
    if (t === 'nvrs') setSearchParams({})
    else setSearchParams({ tab: t })
  }, [setSearchParams])

  const [nvrs, setNvrs]         = useState([])
  const [nvrLoading, setNvrLoading] = useState(true)
  const [modal, setModal]       = useState(null)
  const [syncing, setSyncing]   = useState(null)
  const [confirm, setConfirm]   = useState(null)
  const { toasts, success, error: toastError } = useToast()

  const [cameras, setCameras]   = useState([])
  const [camLoading, setCamLoading] = useState(false)
  const [health, setHealth]     = useState({})
  const [camEdit, setCamEdit]   = useState(null)

  useEffect(() => {
    nvrsApi.list().then(setNvrs).finally(() => setNvrLoading(false))
  }, [])

  useEffect(() => {
    if (tab !== 'cameras') return
    let alive = true
    setCamLoading(true)
    camerasApi.summary()
      .then((c) => { if (alive) setCameras(c) })
      .finally(() => { if (alive) setCamLoading(false) })
    healthApi.streams().then((h) => { if (alive) setHealth(h) }).catch(() => {})
    return () => { alive = false }
  }, [tab])

  async function handleAdd(form) {
    const { max_channels: _omit, ...payload } = form
    const created = await nvrsApi.create(payload)
    setNvrs(prev => [...prev, created])
    const unreachable = created.unreachable_channels
    const extra =
      unreachable != null && unreachable > 0
        ? ` (${unreachable} empty slot(s) skipped)`
        : ''
    success(`"${created.display_name}" added — ${created.imported} streams imported${extra}`)
  }

  async function handleEdit(form) {
    const updated = await nvrsApi.update(modal.id, form)
    setNvrs(prev => prev.map(n => n.id === updated.id ? updated : n))
    success(`"${updated.display_name}" updated`)
  }

  async function handleDelete(nvr) {
    await nvrsApi.delete(nvr.id)
    setNvrs(prev => prev.filter(n => n.id !== nvr.id))
    success(`"${nvr.display_name}" deleted`)
    setConfirm(null)
  }

  async function handleSync(nvr) {
    setSyncing(nvr.id)
    try {
      const res = await nvrsApi.sync(nvr.id)
      const u = res.unreachable_channels
      success(
        `Sync complete: ${res.created} new, ${res.skipped_existing ?? res.skipped ?? 0} existed` +
          (u != null && u > 0 ? `, ${u} empty slot(s)` : '')
      )
      nvrsApi.list().then(setNvrs)
      if (tab === 'cameras') {
        camerasApi.summary().then(setCameras)
      }
    } catch {
      toastError('Sync failed — check NVR connectivity')
    } finally {
      setSyncing(null)
    }
  }

  async function saveCameraPatch(cam, payload) {
    await camerasApi.update(cam.id, payload)
    setCameras(prev => prev.map(c => (c.id === cam.id ? { ...c, ...payload } : c)))
    success(`Updated ${cam.display_name}`)
  }

  const mains = cameras.filter(c => c.active && c.is_main).sort(compareCamerasByDisplayName)

  return (
    <div className="max-w-5xl mx-auto px-6 py-6 w-full">
      <ToastList toasts={toasts} />

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-bold text-white">Devices</h2>
          <p className="text-sm text-gray-500 mt-1 max-w-xl">
            <strong className="text-gray-400">Recommended:</strong> add cameras with a direct RTSP URL (Discovery or manual). Use{' '}
            <strong className="text-gray-400">Sites &amp; migration</strong> only when pulling channels from an existing NVR during transition.
          </p>
        </div>
        <div className="flex rounded-lg bg-gray-800 p-0.5 self-start">
          <button
            type="button"
            onClick={() => setTab('nvrs')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === 'nvrs' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Sites &amp; migration
          </button>
          <button
            type="button"
            onClick={() => setTab('cameras')}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === 'cameras' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Cameras
          </button>
        </div>
      </div>

      {tab === 'nvrs' && (
        <>
          <div className="flex items-center justify-end mb-4">
            <button onClick={() => setModal('add')}
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
              + Add site (NVR import)
            </button>
          </div>

          {nvrLoading ? (
            <div className="flex justify-center py-20"><Spinner className="w-6 h-6" /></div>
          ) : nvrs.length === 0 ? (
            <div className="text-center py-20 text-gray-500">
              <div className="text-4xl mb-3">🖥️</div>
              <p className="text-gray-400">No legacy NVR / site groups yet.</p>
              <p className="text-sm text-gray-500 mt-2">For new installs, add cameras via Discovery first. Use this tab only to import channels from an existing recorder.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {nvrs.map(nvr => (
                <div key={nvr.id} className="bg-gray-900 border border-gray-800 rounded-xl px-5 py-4 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-white">{nvr.display_name}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${nvr.active ? 'bg-green-900/60 text-green-400' : 'bg-gray-700 text-gray-400'}`}>
                        {nvr.active ? 'active' : 'disabled'}
                      </span>
                    </div>
                    <div className="text-sm text-gray-400 mt-0.5 flex gap-3">
                      <span>{nvr.ip_address || '—'}</span>
                      <span>·</span>
                      <span>{nvr.camera_count} cameras</span>
                      <span>·</span>
                      <span>probe limit {nvr.max_channels}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => handleSync(nvr)} disabled={syncing === nvr.id}
                      className="text-sm text-indigo-400 hover:text-indigo-300 border border-indigo-900 hover:border-indigo-700 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                      {syncing === nvr.id ? 'Syncing...' : '↻ Sync'}
                    </button>
                    <button onClick={() => setModal(nvr)}
                      className="text-sm text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg transition-colors">
                      Edit
                    </button>
                    <button onClick={() => setConfirm(nvr)}
                      className="text-sm text-red-400 hover:text-red-300 border border-red-900 hover:border-red-700 px-3 py-1.5 rounded-lg transition-colors">
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'cameras' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-400">
            Main streams only (sub streams stay paired for live preview). Use <Link to="/discovery" className="text-indigo-400 hover:underline">Discovery</Link> to add new devices.
          </p>
          {camLoading ? (
            <div className="flex justify-center py-16"><Spinner className="w-6 h-6" /></div>
          ) : mains.length === 0 ? (
            <div className="text-center py-16 text-gray-500 text-sm">No main-stream cameras yet. Run Discovery or add a site import.</div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 text-left text-xs text-gray-500 uppercase tracking-wider bg-gray-900/80">
                    <th className="px-4 py-3">Camera</th>
                    <th className="px-4 py-3">Stream</th>
                    <th className="px-4 py-3">NVR</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Recording</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {mains.map(cam => {
                    const subName = cam.name.replace(/-main$/, '-sub')
                    const online = health[subName] === true
                    return (
                      <tr key={cam.id} className="bg-gray-900/40 hover:bg-gray-900/80">
                        <td className="px-4 py-3 text-white font-medium">{cam.display_name}</td>
                        <td className="px-4 py-3 text-gray-500 font-mono text-xs">{cam.name}</td>
                        <td className="px-4 py-3 text-gray-400">{cam.nvr_name || '—'}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-semibold ${online ? 'text-green-400' : 'text-red-400'}`}>
                            {online ? 'Online' : 'Offline'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs ${cam.recording_enabled ? 'text-red-400' : 'text-gray-500'}`}>
                            {!cam.recording_enabled || cam.recording_policy === 'off'
                              ? 'Off'
                              : cam.recording_policy === 'events_only'
                                ? 'Events'
                                : 'Continuous'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <Link to={`/camera/${encodeURIComponent(cam.name)}`}
                            className="text-indigo-400 hover:text-indigo-300 text-xs mr-3">Live</Link>
                          <button type="button" onClick={() => setCamEdit(cam)}
                            className="text-gray-400 hover:text-white text-xs">Edit</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {modal === 'add' && (
        <Modal title="Add site (NVR import)" onClose={() => setModal(null)}>
          <NVRForm onSubmit={handleAdd} onClose={() => setModal(null)} submitLabel="Add and import channels" />
        </Modal>
      )}

      {modal && modal !== 'add' && (
        <Modal title="Edit NVR" onClose={() => setModal(null)}>
          <NVRForm
            initial={{ ...modal, password: '' }}
            onSubmit={handleEdit}
            onClose={() => setModal(null)}
            submitLabel="Save Changes"
          />
        </Modal>
      )}

      {confirm && (
        <ConfirmModal
          title="Delete NVR"
          message={`Delete "${confirm.display_name}" and all its cameras? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => handleDelete(confirm)}
          onClose={() => setConfirm(null)}
        />
      )}

      {camEdit && (
        <Modal title="Edit camera" onClose={() => setCamEdit(null)}>
          <CameraEditForm
            camera={camEdit}
            onClose={() => setCamEdit(null)}
            onSubmit={(payload) => saveCameraPatch(camEdit, payload)}
          />
        </Modal>
      )}
    </div>
  )
}
