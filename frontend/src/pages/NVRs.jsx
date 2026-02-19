import { useState, useEffect } from 'react'
import { nvrsApi } from '../api/nvrs'
import Modal from '../components/Modal'

const EMPTY_FORM = { name: '', display_name: '', ip_address: '', username: '', password: '', max_channels: 50, active: true }

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
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">Max Channels</label>
        <input className={inputCls} type="number" min="1" value={form.max_channels} onChange={e => set('max_channels', parseInt(e.target.value))} />
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

export default function NVRs() {
  const [nvrs, setNvrs]       = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal]     = useState(null) // null | 'add' | nvr object
  const [syncing, setSyncing] = useState(null)
  const [toast, setToast]     = useState('')

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  useEffect(() => {
    nvrsApi.list().then(setNvrs).finally(() => setLoading(false))
  }, [])

  async function handleAdd(form) {
    const created = await nvrsApi.create(form)
    setNvrs(prev => [...prev, created])
    showToast(`"${created.display_name}" added — ${created.imported} streams imported`)
  }

  async function handleEdit(form) {
    const updated = await nvrsApi.update(modal.id, form)
    setNvrs(prev => prev.map(n => n.id === updated.id ? updated : n))
    showToast(`"${updated.display_name}" updated`)
  }

  async function handleDelete(nvr) {
    if (!confirm(`Delete "${nvr.display_name}" and all its cameras?`)) return
    await nvrsApi.delete(nvr.id)
    setNvrs(prev => prev.filter(n => n.id !== nvr.id))
    showToast(`"${nvr.display_name}" deleted`)
  }

  async function handleSync(nvr) {
    setSyncing(nvr.id)
    try {
      const res = await nvrsApi.sync(nvr.id)
      showToast(`Sync complete: ${res.created} new, ${res.skipped} existed`)
      nvrsApi.list().then(setNvrs)
    } finally {
      setSyncing(null)
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-6 w-full">
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-green-900/90 text-green-300 border border-green-700 px-4 py-2 rounded-lg text-sm shadow-lg">
          {toast}
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-white">NVR Management</h2>
        <button onClick={() => setModal('add')}
          className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
          + Add NVR
        </button>
      </div>

      {loading ? (
        <div className="text-gray-500 text-sm">Loading...</div>
      ) : nvrs.length === 0 ? (
        <div className="text-center py-20 text-gray-500">
          <div className="text-4xl mb-3">🖥️</div>
          <p className="text-gray-400">No NVRs added yet.</p>
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
                  <span>max {nvr.max_channels} ch</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => handleSync(nvr)} disabled={syncing === nvr.id}
                  className="text-sm text-indigo-400 hover:text-indigo-300 border border-indigo-900 hover:border-indigo-700 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                  {syncing === nvr.id ? 'Syncing...' : '↻ Sync'}
                </button>
                <button onClick={() => setModal(nvr)}
                  className="text-sm text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg transition-colors">
                  Edit
                </button>
                <button onClick={() => handleDelete(nvr)}
                  className="text-sm text-red-400 hover:text-red-300 border border-red-900 hover:border-red-700 px-3 py-1.5 rounded-lg transition-colors">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal === 'add' && (
        <Modal title="Add NVR" onClose={() => setModal(null)}>
          <NVRForm onSubmit={handleAdd} onClose={() => setModal(null)} submitLabel="Add NVR" />
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
    </div>
  )
}