import { useState, useEffect } from 'react'
import { camerasApi } from '../api/cameras'
import { nvrsApi } from '../api/nvrs'
import Modal from '../components/Modal'

const EMPTY_FORM = { name: '', display_name: '', rtsp_url: '', nvr_id: '', active: true }

function CameraForm({ initial = EMPTY_FORM, nvrs, onSubmit, onClose, submitLabel }) {
  const [form, setForm]     = useState(initial)
  const [error, setError]   = useState('')
  const [saving, setSaving] = useState(false)

  function set(field, value) { setForm(f => ({ ...f, [field]: value })) }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await onSubmit({ ...form, nvr_id: form.nvr_id || null })
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const inputCls = "w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && <div className="px-3 py-2 rounded text-sm bg-red-900/60 text-red-300 border border-red-700">{error}</div>}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">Stream Name (slug) *</label>
        <input className={inputCls} value={form.name} onChange={e => set('name', e.target.value)} placeholder="front-door" required />
        <p className="text-xs text-gray-500 mt-1">Used as the go2rtc stream key. No spaces.</p>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">Display Name *</label>
        <input className={inputCls} value={form.display_name} onChange={e => set('display_name', e.target.value)} placeholder="Front Door" required />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">RTSP URL *</label>
        <input className={`${inputCls} font-mono text-xs`} value={form.rtsp_url} onChange={e => set('rtsp_url', e.target.value)} placeholder="rtsp://user:pass@192.168.1.100:554/stream1" required />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">NVR (optional)</label>
        <select className={inputCls} value={form.nvr_id} onChange={e => set('nvr_id', e.target.value)}>
          <option value="">— Standalone —</option>
          {nvrs.map(nvr => <option key={nvr.id} value={nvr.id}>{nvr.display_name}</option>)}
        </select>
      </div>
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

export default function Cameras() {
  const [cameras, setCameras] = useState([])
  const [nvrs, setNvrs]       = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal]     = useState(null)
  const [toast, setToast]     = useState('')

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  useEffect(() => {
    Promise.all([camerasApi.list(), nvrsApi.list()])
      .then(([cams, nvrs]) => { setCameras(cams); setNvrs(nvrs) })
      .finally(() => setLoading(false))
  }, [])

  async function handleAdd(form) {
    const created = await camerasApi.create(form)
    setCameras(prev => [...prev, created])
    showToast(`"${created.display_name}" added`)
  }

  async function handleEdit(form) {
    const updated = await camerasApi.update(modal.id, form)
    setCameras(prev => prev.map(c => c.id === updated.id ? updated : c))
    showToast(`"${updated.display_name}" updated`)
  }

  async function handleDelete(cam) {
    if (!confirm(`Delete "${cam.display_name}"?`)) return
    await camerasApi.delete(cam.id)
    setCameras(prev => prev.filter(c => c.id !== cam.id))
    showToast(`"${cam.display_name}" deleted`)
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-6 w-full">
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-green-900/90 text-green-300 border border-green-700 px-4 py-2 rounded-lg text-sm shadow-lg">
          {toast}
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-white">Camera Management</h2>
        <button onClick={() => setModal('add')}
          className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
          + Add Camera
        </button>
      </div>

      {loading ? (
        <div className="text-gray-500 text-sm">Loading...</div>
      ) : cameras.length === 0 ? (
        <div className="text-center py-20 text-gray-500">
          <div className="text-4xl mb-3">📷</div>
          <p className="text-gray-400">No cameras added yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {cameras.map(cam => (
            <div key={cam.id} className="bg-gray-900 border border-gray-800 rounded-xl px-5 py-4 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-white">{cam.display_name}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${cam.active ? 'bg-green-900/60 text-green-400' : 'bg-gray-700 text-gray-400'}`}>
                    {cam.active ? 'active' : 'disabled'}
                  </span>
                  <span className={`text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400`}>
                    {cam.is_main ? 'main' : cam.is_sub ? 'sub' : 'custom'}
                  </span>
                </div>
                <div className="text-xs text-gray-500 mt-0.5 font-mono truncate max-w-xl">{cam.rtsp_url}</div>
                {cam.nvr_name && <div className="text-xs text-gray-500 mt-0.5">{cam.nvr_name}</div>}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setModal(cam)}
                  className="text-sm text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg transition-colors">
                  Edit
                </button>
                <button onClick={() => handleDelete(cam)}
                  className="text-sm text-red-400 hover:text-red-300 border border-red-900 hover:border-red-700 px-3 py-1.5 rounded-lg transition-colors">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal === 'add' && (
        <Modal title="Add Camera" onClose={() => setModal(null)}>
          <CameraForm nvrs={nvrs} onSubmit={handleAdd} onClose={() => setModal(null)} submitLabel="Add Camera" />
        </Modal>
      )}
      {modal && modal !== 'add' && (
        <Modal title="Edit Camera" onClose={() => setModal(null)}>
          <CameraForm
            initial={{ ...modal, nvr_id: modal.nvr_id || '' }}
            nvrs={nvrs}
            onSubmit={handleEdit}
            onClose={() => setModal(null)}
            submitLabel="Save Changes"
          />
        </Modal>
      )}
    </div>
  )
}
