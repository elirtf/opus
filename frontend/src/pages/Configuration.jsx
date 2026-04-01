import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { healthApi } from '../api/health'
import { camerasApi } from '../api/cameras'
import { api } from '../api/client'
import { go2rtcApi } from '../api/go2rtc'
import { authApi } from '../api/auth'
import Modal from '../components/Modal'
import Spinner from '../components/Spinner'
import { useToast, ToastList } from '../components/Toast'
import { compareByChannelThenName, naturalCompare } from '../utils/naturalCompare'

const TAB_IDS = ['system', 'streaming', 'maintenance', 'cameras']

function TabButton({ active, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
        active ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'
      }`}
    >
      {children}
    </button>
  )
}

function SystemPanel({ about, loading, error }) {
  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="w-6 h-6" />
      </div>
    )
  }
  if (error) {
    return <p className="text-red-400 text-sm">{error}</p>
  }
  const disk = about?.host?.recordings_disk
  return (
    <div className="space-y-6">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-3">Opus</h3>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-gray-500">Version</dt>
            <dd className="text-gray-200 font-mono">{about?.opus_version ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Timezone (TZ)</dt>
            <dd className="text-gray-200 font-mono">{about?.timezone || '—'}</dd>
          </div>
        </dl>
        <p className="text-xs text-gray-500 mt-4">
          Set <code className="text-gray-400">TZ</code> in Docker Compose or <code className="text-gray-400">.env</code> so segment filenames and logs match your region.
          Optional: set <code className="text-gray-400">OPUS_VERSION</code> on the opus service to show a release tag in this panel.
        </p>
      </div>
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-3">Host</h3>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-gray-500">OS</dt>
            <dd className="text-gray-200">
              {about?.host?.platform_system} {about?.host?.platform_release} ({about?.host?.platform_machine})
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Python</dt>
            <dd className="text-gray-200 font-mono">{about?.host?.python_version ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-gray-500">CPUs (logical)</dt>
            <dd className="text-gray-200">{about?.host?.cpu_count_logical ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Recordings dir</dt>
            <dd className="text-gray-200 font-mono text-xs break-all">{about?.host?.recordings_dir ?? '—'}</dd>
          </div>
        </dl>
        {disk && (
          <p className="text-xs text-gray-400 mt-3">
            Volume: {disk.used_gb} / {disk.total_gb} GiB used ({disk.free_gb} GiB free)
          </p>
        )}
      </div>
    </div>
  )
}

function StreamingPanel({ isOriginalAdmin, onSuccess, onError }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [candidatesText, setCandidatesText] = useState('')
  const [allowArbitrary, setAllowArbitrary] = useState(false)
  const [allowExecMod, setAllowExecMod] = useState(false)
  const [envLocked, setEnvLocked] = useState(false)
  const [configPath, setConfigPath] = useState('')
  const [restartHint, setRestartHint] = useState('')

  useEffect(() => {
    if (!isOriginalAdmin) {
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    go2rtcApi
      .getSettings()
      .then((d) => {
        if (!alive) return
        setCandidatesText((d.webrtc_candidates || []).join('\n'))
        setAllowArbitrary(!!d.allow_arbitrary_exec)
        setAllowExecMod(!!d.allow_exec_module)
        setEnvLocked(!!d.arbitrary_exec_env_locked)
        setConfigPath(d.config_path || '')
        setRestartHint(d.restart_hint || '')
      })
      .catch((e) => onError(e.message || 'Failed to load streaming settings'))
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [isOriginalAdmin])

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const lines = candidatesText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
      await go2rtcApi.updateSettings({
        webrtc_candidates: lines.length ? lines : ['stun:8555'],
        allow_arbitrary_exec: allowArbitrary,
        allow_exec_module: allowExecMod,
      })
      onSuccess('Streaming settings saved. Restart the go2rtc container to apply changes to go2rtc.yaml.')
    } catch (ex) {
      onError(ex.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (!isOriginalAdmin) {
    return (
      <p className="text-sm text-gray-500">
        Only the original system administrator can configure go2rtc streaming and security options.
      </p>
    )
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="w-6 h-6" />
      </div>
    )
  }

  const inputCls =
    'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-xs'

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-2">WebRTC ICE candidates</h3>
        <p className="text-sm text-gray-400 mb-3">
          One candidate per line (e.g. <code className="text-gray-300">stun:8555</code>). Written to{' '}
          <code className="text-gray-400 break-all">{configPath || 'go2rtc.yaml'}</code> when you save.
        </p>
        <textarea
          className={`${inputCls} min-h-[120px]`}
          value={candidatesText}
          onChange={(e) => setCandidatesText(e.target.value)}
          placeholder="stun:8555"
        />
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-semibold text-white">Security</h3>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            className="mt-1 rounded border-gray-600"
            checked={allowArbitrary}
            disabled={envLocked}
            onChange={(e) => setAllowArbitrary(e.target.checked)}
          />
          <span>
            <span className="text-sm text-gray-200">Allow arbitrary stream sources (echo:, expr:, exec:)</span>
            <span className="block text-xs text-gray-500 mt-1">
              Off by default — matches go2rtc security guidance. Enable only if you trust every RTSP URL entered in Opus.
            </span>
            {envLocked && (
              <span className="block text-xs text-amber-400 mt-2">
                Overridden by <code className="text-gray-400">GO2RTC_ALLOW_ARBITRARY_EXEC</code> in the environment; remove it to control this from the UI.
              </span>
            )}
          </span>
        </label>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            className="mt-1 rounded border-gray-600"
            checked={allowExecMod}
            onChange={(e) => setAllowExecMod(e.target.checked)}
          />
          <span>
            <span className="text-sm text-gray-200">Enable go2rtc &quot;exec&quot; module</span>
            <span className="block text-xs text-gray-500 mt-1">
              Required only for advanced <code className="text-gray-400">exec:</code> pipelines. When off, the generated config omits the exec module and restricts exec paths when enabled.
            </span>
          </span>
        </label>
      </div>

      {restartHint && <p className="text-xs text-gray-500">{restartHint}</p>}

      <button
        type="submit"
        disabled={saving}
        className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white"
      >
        {saving ? 'Saving…' : 'Save streaming settings'}
      </button>
    </form>
  )
}

function ApiTokenSettings({ onSuccess, onError }) {
  const [busy, setBusy] = useState(false)

  async function generate() {
    setBusy(true)
    try {
      const data = await authApi.createToken()
      const token = data?.token
      if (token) {
        try {
          await navigator.clipboard.writeText(token)
        } catch {
          /* ignore */
        }
        onSuccess(
          'New API token created (copied to clipboard if permitted). Store it securely; you will not see it again. For browser clients on a different origin than Opus, paste it into localStorage key opus_bearer_token or your client config.'
        )
      }
    } catch (e) {
      onError(e.message || 'Could not create token')
    } finally {
      setBusy(false)
    }
  }

  async function revoke() {
    setBusy(true)
    try {
      await authApi.revokeToken()
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('opus_bearer_token')
      }
      onSuccess('API token revoked.')
    } catch (e) {
      onError(e.message || 'Could not revoke token')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mt-6">
      <h3 className="text-sm font-semibold text-white mb-2">API access (Bearer token)</h3>
      <p className="text-sm text-gray-400 mb-4">
        For scripts or extra websites that can’t use normal login cookies, send{' '}
        <code className="text-gray-300">Authorization: Bearer &lt;token&gt;</code>. If that tool runs on a{' '}
        <strong className="text-gray-300">different web address</strong> than Opus, an admin must set{' '}
        <code className="text-gray-300">CORS_ORIGINS</code> on the server — see the <em>Advanced</em> section in{' '}
        <code className="text-gray-400">docs/remote-viewing.md</code>.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={generate}
          className="px-3 py-1.5 rounded-lg text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white"
        >
          Generate new token
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={revoke}
          className="px-3 py-1.5 rounded-lg text-sm border border-gray-600 hover:bg-gray-800 disabled:opacity-50 text-gray-300"
        >
          Revoke token
        </button>
      </div>
    </div>
  )
}

function MaintenancePanel({ diagnostics, engine, loadingDiag, loadingEng, errorDiag, onRefresh }) {
  const [copied, setCopied] = useState(false)

  async function copyDiag() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-2">Upgrades</h3>
        <ul className="text-sm text-gray-400 list-disc list-inside space-y-1">
          <li>Pull new images and recreate containers: <code className="text-gray-300">docker compose pull &amp;&amp; docker compose up -d</code></li>
          <li>Review release notes before upgrading production systems.</li>
        </ul>
      </div>
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-white mb-2">Logs</h3>
        <p className="text-sm text-gray-400">
          Application logs go to the container stdout. Use{' '}
          <code className="text-gray-300">docker logs opus</code> (and{' '}
          <code className="text-gray-300">opus-recorder</code>, <code className="text-gray-300">go2rtc</code>) for troubleshooting.
        </p>
      </div>
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h3 className="text-sm font-semibold text-white">Recorder engine</h3>
          <button
            type="button"
            onClick={onRefresh}
            className="text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-900 hover:border-indigo-700 px-3 py-1 rounded-lg"
          >
            Refresh
          </button>
        </div>
        {loadingEng ? (
          <Spinner className="w-5 h-5" />
        ) : (
          <pre className="text-xs text-gray-400 overflow-x-auto max-h-48 bg-black/40 rounded-lg p-3 border border-gray-800">
            {JSON.stringify(engine, null, 2)}
          </pre>
        )}
        {engine?.disk_pressure && (
          <p className="text-amber-400 text-xs mt-2">
            Disk pressure: free space is below <code className="text-amber-200">RECORDING_MIN_FREE_GB</code>. New
            recorders will not start until space is freed.
          </p>
        )}
      </div>
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h3 className="text-sm font-semibold text-white">Host diagnostics</h3>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onRefresh}
              className="text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-900 hover:border-indigo-700 px-3 py-1 rounded-lg"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={copyDiag}
              disabled={!diagnostics}
              className="text-xs text-gray-300 hover:text-white border border-gray-600 px-3 py-1 rounded-lg disabled:opacity-40"
            >
              {copied ? 'Copied' : 'Copy JSON'}
            </button>
          </div>
        </div>
        {errorDiag && <p className="text-red-400 text-sm mb-2">{errorDiag}</p>}
        {loadingDiag ? (
          <Spinner className="w-5 h-5" />
        ) : (
          <pre className="text-xs text-gray-400 overflow-x-auto max-h-96 bg-black/40 rounded-lg p-3 border border-gray-800">
            {diagnostics != null ? JSON.stringify(diagnostics, null, 2) : '{}'}
          </pre>
        )}
        <p className="text-xs text-gray-500 mt-2">JSON schema is described in the repo file docs/hw-diagnostics-spec.md.</p>
      </div>
    </div>
  )
}

function StreamEditForm({ cameraRow, source, onSubmit, onClose }) {
  const [rtsp, setRtsp] = useState('')
  const [sub, setSub] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (source) {
      setRtsp(source.rtsp_url || '')
      setSub(source.rtsp_substream_url || '')
    }
  }, [source])

  const inputCls =
    'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono text-xs'

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setErr('')
    try {
      await onSubmit({
        rtsp_url: rtsp.trim(),
        rtsp_substream_url: sub.trim() || null,
      })
      onClose()
    } catch (ex) {
      setErr(ex.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {err && <div className="text-sm text-red-300 bg-red-900/40 border border-red-800 rounded-lg px-3 py-2">{err}</div>}
      <p className="text-xs text-gray-500 font-mono break-all">{cameraRow.name}</p>
      <div>
        <label className="block text-xs text-gray-400 mb-1">RTSP URL</label>
        <textarea className={`${inputCls} min-h-[72px]`} value={rtsp} onChange={(e) => setRtsp(e.target.value)} required />
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Substream RTSP (optional)</label>
        <textarea
          className={`${inputCls} min-h-[56px]`}
          value={sub}
          onChange={(e) => setSub(e.target.value)}
          placeholder="Lower-resolution URL for live tiles (recommended if main is 4K/HEVC)"
        />
        <p className="text-xs text-gray-500 mt-1">
          For <span className="font-mono text-gray-400">…-main</span> cameras without a separate{' '}
          <span className="font-mono text-gray-400">…-sub</span> row (e.g. NVR import has two rows), this URL is
          registered in go2rtc as the paired sub stream so the dashboard and full-screen view use it automatically.
        </p>
      </div>
      <p className="text-xs text-gray-500">Credentials stay on the server; list views show masked URLs.</p>
      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white py-2 rounded-lg text-sm font-medium"
        >
          {saving ? 'Saving…' : 'Save & sync stream'}
        </button>
        <button type="button" onClick={onClose} className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 py-2 rounded-lg text-sm">
          Cancel
        </button>
      </div>
    </form>
  )
}

function CamerasPanel({ inventory, loading, onEditStreams }) {
  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner className="w-6 h-6" />
      </div>
    )
  }
  if (!inventory?.length) {
    return <p className="text-gray-500 text-sm">No cameras yet. Use Discovery or Devices to add streams.</p>
  }

  const groups = {}
  for (const row of inventory) {
    const key = row.nvr_id ?? 'standalone'
    const label = row.nvr_name || 'Standalone (direct camera / no site group)'
    if (!groups[key]) groups[key] = { label, rows: [] }
    groups[key].rows.push(row)
  }
  for (const g of Object.values(groups)) {
    g.rows.sort(compareByChannelThenName)
  }

  return (
    <div className="space-y-8">
      <p className="text-sm text-gray-400">
        Per-site stream registry. <strong className="text-gray-300">Online</strong> uses go2rtc producers. Edit RTSP URLs when a camera IP changes; go2rtc is updated automatically.
      </p>
      {Object.entries(groups).sort(([, a], [, b]) => naturalCompare(a.label, b.label)).map(([key, g]) => (
        <div key={key}>
          <h3 className="text-sm font-semibold text-indigo-300 mb-2">{g.label}</h3>
          <div className="overflow-x-auto rounded-xl border border-gray-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-left text-xs text-gray-500 uppercase tracking-wider bg-gray-900/80">
                  <th className="px-3 py-2">Ch</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Stream key</th>
                  <th className="px-3 py-2">Host</th>
                  <th className="px-3 py-2">Connect</th>
                  <th className="px-3 py-2">Protocol</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {g.rows.map((row) => {
                  const online = row.online === true
                  return (
                    <tr key={row.id} className="bg-gray-900/40">
                      <td className="px-3 py-2 text-gray-400 font-mono text-xs">{row.channel ?? '—'}</td>
                      <td className="px-3 py-2 text-white">{row.display_name}</td>
                      <td className="px-3 py-2 text-gray-500 font-mono text-xs max-w-[140px] truncate" title={row.name}>
                        {row.name}
                      </td>
                      <td className="px-3 py-2 text-gray-400 font-mono text-xs">{row.source_host || '—'}</td>
                      <td className="px-3 py-2">
                        {row.management_url ? (
                          <a
                            href={row.management_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-indigo-400 hover:underline text-xs break-all"
                          >
                            :8000
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-500 text-xs">{row.protocol}</td>
                      <td className="px-3 py-2">
                        <span className={`text-xs font-semibold ${online ? 'text-green-400' : 'text-red-400'}`}>
                          {online ? 'Online' : 'Offline'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onEditStreams(row)}
                          className="text-indigo-400 hover:text-indigo-300 text-xs"
                        >
                          Edit RTSP
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function Configuration() {
  const [searchParams, setSearchParams] = useSearchParams()
  const raw = searchParams.get('tab')
  const tab = TAB_IDS.includes(raw) ? raw : 'system'
  const setTab = useCallback(
    (t) => {
      setSearchParams(t === 'system' ? {} : { tab: t })
    },
    [setSearchParams]
  )

  const { toasts, success, error: toastError } = useToast()

  const [about, setAbout] = useState(null)
  const [aboutLoading, setAboutLoading] = useState(true)
  const [aboutErr, setAboutErr] = useState('')

  const [diagnostics, setDiagnostics] = useState(null)
  const [diagLoading, setDiagLoading] = useState(false)
  const [diagErr, setDiagErr] = useState('')

  const [engine, setEngine] = useState(null)
  const [engLoading, setEngLoading] = useState(false)

  const [inventory, setInventory] = useState([])
  const [invLoading, setInvLoading] = useState(false)

  const [editRow, setEditRow] = useState(null)
  const [editSource, setEditSource] = useState(null)

  const [setupStatus, setSetupStatus] = useState(null)
  useEffect(() => {
    api('/api/recordings/settings/setup-status')
      .then(setSetupStatus)
      .catch(() => {})
  }, [])

  const isOriginalAdmin = setupStatus?.is_original_admin ?? false

  useEffect(() => {
    let alive = true
    setAboutLoading(true)
    healthApi
      .about()
      .then((d) => {
        if (alive) setAbout(d)
      })
      .catch((e) => {
        if (alive) setAboutErr(e.message || 'Failed to load')
      })
      .finally(() => {
        if (alive) setAboutLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const loadMaintenance = useCallback(() => {
    setDiagLoading(true)
    setEngLoading(true)
    setDiagErr('')
    healthApi
      .diagnostics()
      .then(setDiagnostics)
      .catch((e) => setDiagErr(e.message || 'Diagnostics failed'))
      .finally(() => setDiagLoading(false))
    api
      .get('/api/recordings/engine/status')
      .then(setEngine)
      .catch(() => setEngine({ error: 'Could not load engine status' }))
      .finally(() => setEngLoading(false))
  }, [])

  useEffect(() => {
    if (tab !== 'maintenance') return
    loadMaintenance()
  }, [tab, loadMaintenance])

  useEffect(() => {
    if (tab !== 'cameras') return
    let alive = true
    setInvLoading(true)
    camerasApi
      .inventory()
      .then((rows) => {
        if (alive) setInventory(rows)
      })
      .catch((e) => toastError(e.message || 'Inventory failed'))
      .finally(() => {
        if (alive) setInvLoading(false)
      })
    return () => {
      alive = false
    }
  }, [tab, toastError])

  useEffect(() => {
    if (!editRow) {
      setEditSource(null)
      return
    }
    let alive = true
    camerasApi
      .source(editRow.id)
      .then((s) => {
        if (alive) setEditSource(s)
      })
      .catch((e) => toastError(e.message || 'Could not load stream URLs'))
    return () => {
      alive = false
    }
  }, [editRow, toastError])

  async function saveStreams(payload) {
    await camerasApi.update(editRow.id, {
      rtsp_url: payload.rtsp_url,
      rtsp_substream_url: payload.rtsp_substream_url,
    })
    success('Stream URLs updated')
    const rows = await camerasApi.inventory()
    setInventory(rows)
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-6 w-full">
      <ToastList toasts={toasts} />

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-bold text-white">Configuration</h2>
          <p className="text-sm text-gray-500 mt-1">Opus system settings — not your old NVR firmware.</p>
        </div>
        <div className="flex rounded-lg bg-gray-800 p-0.5 self-start flex-wrap">
          <TabButton active={tab === 'system'} onClick={() => setTab('system')}>
            System
          </TabButton>
          <TabButton active={tab === 'streaming'} onClick={() => setTab('streaming')}>
            Streaming
          </TabButton>
          <TabButton active={tab === 'maintenance'} onClick={() => setTab('maintenance')}>
            Maintenance
          </TabButton>
          <TabButton active={tab === 'cameras'} onClick={() => setTab('cameras')}>
            Camera management
          </TabButton>
        </div>
      </div>

      {tab === 'system' && (
        <>
          <SystemPanel about={about} loading={aboutLoading} error={aboutErr} />
          <ApiTokenSettings onSuccess={success} onError={toastError} />
        </>
      )}

      {tab === 'streaming' && (
        <StreamingPanel isOriginalAdmin={isOriginalAdmin} onSuccess={success} onError={toastError} />
      )}

      {tab === 'maintenance' && (
        <MaintenancePanel
          diagnostics={diagnostics}
          engine={engine}
          loadingDiag={diagLoading}
          loadingEng={engLoading}
          errorDiag={diagErr}
          onRefresh={loadMaintenance}
        />
      )}

      {tab === 'cameras' && (
        <CamerasPanel inventory={inventory} loading={invLoading} onEditStreams={setEditRow} />
      )}

      {editRow && (
        <Modal title={`Edit streams — ${editRow.display_name}`} onClose={() => setEditRow(null)}>
          {editSource ? (
            <StreamEditForm
              cameraRow={editRow}
              source={editSource}
              onClose={() => setEditRow(null)}
              onSubmit={saveStreams}
            />
          ) : (
            <div className="flex justify-center py-8">
              <Spinner className="w-6 h-6" />
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}
