import { useState, useEffect } from 'react'
import { usersApi } from '../api/users'
import { useAuth } from '../context/AuthContext'
import Modal from '../components/Modal'

const EMPTY_FORM = { username: '', password: '', role: 'viewer' }

function UserForm({ initial = EMPTY_FORM, onSubmit, onClose, submitLabel }) {
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
        <label className="block text-xs font-medium text-gray-400 mb-1">Username *</label>
        <input className={inputCls} value={form.username} onChange={e => set('username', e.target.value)} autoComplete="off" required />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">
          {initial.id ? 'New Password (leave blank to keep current)' : 'Password *'}
        </label>
        <input
          className={inputCls} type="password" value={form.password}
          onChange={e => set('password', e.target.value)}
          required={!initial.id}
          autoComplete="new-password"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">Role</label>
        <select className={inputCls} value={form.role} onChange={e => set('role', e.target.value)}>
          <option value="viewer">Viewer — live view only</option>
          <option value="admin">Admin — full access</option>
        </select>
      </div>
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

export default function Users() {
  const { user: currentUser }  = useAuth()
  const [users, setUsers]      = useState([])
  const [loading, setLoading]  = useState(true)
  const [modal, setModal]      = useState(null)
  const [toast, setToast]      = useState('')

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  useEffect(() => {
    usersApi.list().then(setUsers).finally(() => setLoading(false))
  }, [])

  async function handleAdd(form) {
    const created = await usersApi.create(form)
    setUsers(prev => [...prev, created])
    showToast(`User "${created.username}" created`)
  }

  async function handleEdit(form) {
    const updated = await usersApi.update(modal.id, form)
    setUsers(prev => prev.map(u => u.id === updated.id ? updated : u))
    showToast(`User "${updated.username}" updated`)
  }

  async function handleDelete(user) {
    if (!confirm(`Delete user "${user.username}"?`)) return
    await usersApi.delete(user.id)
    setUsers(prev => prev.filter(u => u.id !== user.id))
    showToast(`User "${user.username}" deleted`)
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-6 w-full">
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-green-900/90 text-green-300 border border-green-700 px-4 py-2 rounded-lg text-sm shadow-lg">
          {toast}
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-white">User Management</h2>
        <button onClick={() => setModal('add')}
          className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
          + Add User
        </button>
      </div>

      {loading ? (
        <div className="text-gray-500 text-sm">Loading...</div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left text-xs text-gray-500 uppercase tracking-wider">
                <th className="px-5 py-3">Username</th>
                <th className="px-5 py-3">Role</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {users.map(user => (
                <tr key={user.id} className="hover:bg-gray-800/40 transition-colors">
                  <td className="px-5 py-3 font-medium text-white">
                    {user.username}
                    {user.id === currentUser?.id && <span className="ml-2 text-xs text-gray-500">(you)</span>}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      user.role === 'admin'
                        ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-700'
                        : 'bg-gray-700 text-gray-300 border border-gray-600'
                    }`}>
                      {user.role}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => setModal(user)}
                        className="text-sm text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg transition-colors">
                        Edit
                      </button>
                      {user.id !== currentUser?.id && (
                        <button onClick={() => handleDelete(user)}
                          className="text-sm text-red-400 hover:text-red-300 border border-red-900 hover:border-red-700 px-3 py-1.5 rounded-lg transition-colors">
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal === 'add' && (
        <Modal title="Add User" onClose={() => setModal(null)}>
          <UserForm onSubmit={handleAdd} onClose={() => setModal(null)} submitLabel="Create User" />
        </Modal>
      )}
      {modal && modal !== 'add' && (
        <Modal title="Edit User" onClose={() => setModal(null)}>
          <UserForm
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