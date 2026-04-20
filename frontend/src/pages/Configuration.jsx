import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { healthApi } from '../api/health'
import { camerasApi } from '../api/cameras'
import { api } from '../api/client'
import { go2rtcApi } from '../api/go2rtc'
import Modal from '../components/Modal'
import Spinner from '../components/Spinner'
import { useToast, ToastList } from '../components/Toast'
import { compareByChannelThenName, naturalCompare } from '../utils/naturalCompare'

const TAB_IDS = ['system', 'cameras', 'settings', 'maintenance']

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

function SectionCard({ title, subtitle, children, actions = null }) {
  return (
    <section className="bg-gray-900 border border-gray-800 rounded-xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

function StatPill({ label, value, tone = 'neutral' }) {
  const toneClass =
    tone === 'good'
      ? 'text-green-300 border-green-900 bg-green-950/20'
      : tone === 'warn'
      ? 'text-amber-300 border-amber-900 bg-amber-950/20'
      : tone === 'bad'
      ? 'text-red-300 border-red-900 bg-red-950/20'
      : 'text-gray-300 border-gray-700 bg-gray-800/50'
  return (
    <div className={`rounded-lg border px-3 py-2 ${toneClass}`}>
      <p className="text-[11px] uppercase tracking-wide opacity-80">{label}</p>
      <p className="text-sm font-medium mt-0.5">{value}</p>
    </div>
  )
}

const APPLY_POLICIES = {
  hot: { label: 'Applies immediately', cls: 'text-green-400 border-green-800 bg-green-950/30' },
  recorder: { label: 'Recorder restart', cls: 'text-amber-400 border-amber-800 bg-amber-950/30' },
  go2rtc: { label: 'go2rtc restart', cls: 'text-amber-400 border-amber-800 bg-amber-950/30' },
  processor: { label: 'Processor restart', cls: 'text-amber-400 border-amber-800 bg-amber-950/30' },
  app: { label: 'App restart', cls: 'text-red-400 border-red-800 bg-red-950/30' },
}

function ApplyBadge({ policy }) {
  const info = APPLY_POLICIES[policy]
  if (!info) return null
  return (
    <span className={`inline-flex items-center text-[10px] font-medium border rounded-full px-2 py-0.5 whitespace-nowrap ${info.cls}`}>
      {info.label}
    </span>
  )
}

// ── Schema-driven settings ───────────────────────────────────────────────────

const SETTINGS_GROUP_LABELS = {
  recording: 'Recording',
  motion: 'Motion / Events',
  performance: 'Performance',
  streaming: 'Streaming',
}

const SETTINGS_GROUP_SUBTITLES = {
  recording: 'How long to keep recordings, segment size, and disk thresholds.',
  motion: 'Timing for motion-triggered clip capture.',
  streaming: 'WebRTC ICE candidates and go2rtc security options.',
  performance: 'Hardware acceleration and motion analysis tuning.',
}

const GROUP_ORDER = ['recording', 'motion', 'streaming', 'performance']

const INPUT_CLS =
  'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500'

function SettingControl({ entry, value, onChange }) {
  switch (entry.type) {
    case 'int':
      return (
        <div>
          <input
            type="number"
            className={INPUT_CLS}
            value={value ?? ''}
            min={entry.min}
            max={entry.max}
            step={1}
            onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          />
          {(entry.min != null || entry.max != null) && (
            <p className="text-[10px] text-gray-600 mt-1">
              {entry.min != null && entry.max != null
                ? `Range: ${entry.min} – ${entry.max}`
                : entry.min != null
                ? `Min: ${entry.min}`
                : `Max: ${entry.max}`}
            </p>
          )}
        </div>
      )

    case 'float':
      return (
        <div>
          <input
            type="number"
            step="0.1"
            className={INPUT_CLS}
            value={value ?? ''}
            min={entry.min}
            max={entry.max}
            onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          />
          {(entry.min != null || entry.max != null) && (
            <p className="text-[10px] text-gray-600 mt-1">
              {entry.min != null && entry.max != null
                ? `Range: ${entry.min} – ${entry.max}`
                : entry.min != null
                ? `Min: ${entry.min}`
                : `Max: ${entry.max}`}
            </p>
          )}
        </div>
      )

    case 'bool':
      return (
        <button
          type="button"
          role="switch"
          aria-checked={!!value}
          onClick={() => onChange(!value)}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
            value ? 'bg-indigo-600' : 'bg-gray-700'
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
              value ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      )

    case 'enum':
      return (
        <select
          className={INPUT_CLS}
          value={value ?? entry.default ?? ''}
          onChange={(e) => onChange(e.target.value)}
        >
          {(entry.options || []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      )

    case 'string_list':
      return (
        <textarea
          className={`${INPUT_CLS} font-mono text-xs min-h-[100px]`}
          value={Array.isArray(value) ? value.join('\n') : value ?? ''}
          onChange={(e) => {
            const lines = e.target.value
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean)
            onChange(lines)
          }}
          placeholder="One entry per line"
        />
      )

    default:
      return (
        <input
          type="text"
          className={INPUT_CLS}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )
  }
}

function SettingRow({ entry, value, loaded, onChange }) {
  const dirty = JSON.stringify(value) !== JSON.stringify(loaded)
  return (
    <div
      className={`flex flex-col md:flex-row md:items-start gap-2 md:gap-6 py-4 border-b border-gray-800/60 last:border-b-0 ${
        dirty ? 'bg-indigo-950/10 -mx-3 px-3 rounded-lg' : ''
      }`}
    >
      <div className="md:w-1/2 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-gray-200 font-medium">{entry.label}</span>
          <ApplyBadge policy={entry.apply} />
          {dirty && (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo-400" title="Unsaved change" />
          )}
        </div>
        {entry.description && (
          <p className="text-xs text-gray-500 mt-1 leading-relaxed">{entry.description}</p>
        )}
      </div>
      <div className="md:w-1/2 md:max-w-xs">
        <SettingControl entry={entry} value={value} onChange={onChange} />
      </div>
    </div>
  )
}

function SettingsGroupCard({ groupKey, entries, values, loadedValues, onChange, onSave, saving }) {
  const dirty = entries.some(
    (e) => JSON.stringify(values[e.key]) !== JSON.stringify(loadedValues[e.key])
  )

  return (
    <SectionCard
      title={SETTINGS_GROUP_LABELS[groupKey] || groupKey}
      subtitle={SETTINGS_GROUP_SUBTITLES[groupKey]}
      actions={
        <button
          type="button"
          disabled={saving || !dirty}
          onClick={() => onSave(groupKey)}
          className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
            dirty
              ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
              : 'bg-gray-800 text-gray-500 cursor-default'
          } disabled:opacity-50`}
        >
          {saving ? 'Saving\u2026' : dirty ? 'Save changes' : 'No changes'}
        </button>
      }
    >
      <div>
        {entries.map((entry) => (
          <SettingRow
            key={entry.key}
            entry={entry}
            value={values[entry.key]}
            loaded={loadedValues[entry.key]}
            onChange={(v) => onChange(entry.key, v)}
          />
        ))}
      </div>
    </SectionCard>
  )
}

function SettingsPanel({ isOriginalAdmin, onSuccess, onError }) {
  const [schema, setSchema] = useState(null)
  const [values, setValues] = useState({})
  const [loadedValues, setLoadedValues] = useState({})
  const [loading, setLoading] = useState(true)
  const [savingGroup, setSavingGroup] = useState(null)

  useEffect(() => {
    if (!isOriginalAdmin) {
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    api
      .get('/api/config/current')
      .then((data) => {
        if (!alive) return
        setSchema(data)
        const vals = {}
        for (const entry of data) {
          vals[entry.key] = entry.value
        }
        setValues(vals)
        setLoadedValues(vals)
      })
      .catch((e) => onError(e.message || 'Failed to load settings'))
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [isOriginalAdmin, onError])

  const groups = useMemo(() => {
    if (!schema) return []
    const map = {}
    for (const entry of schema) {
      const g = entry.group || 'other'
      if (!map[g]) map[g] = []
      map[g].push(entry)
    }
    return GROUP_ORDER.filter((k) => map[k]).map((k) => ({ key: k, entries: map[k] }))
  }, [schema])

  const handleChange = useCallback((key, value) => {
    setValues((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleSave = useCallback(
    async (groupKey) => {
      setSavingGroup(groupKey)
      try {
        const group = groups.find((g) => g.key === groupKey)
        if (!group) return

        const changed = {}
        for (const entry of group.entries) {
          if (JSON.stringify(values[entry.key]) !== JSON.stringify(loadedValues[entry.key])) {
            changed[entry.key] = values[entry.key]
          }
        }
        if (!Object.keys(changed).length) return

        // Validate ICE candidates before sending
        if (changed.go2rtc_webrtc_candidates) {
          const lines = changed.go2rtc_webrtc_candidates
          for (const ln of lines) {
            if (!/^(stun|turn):/i.test(ln)) {
              onError(`Each ICE line must start with stun: or turn:. Invalid: ${ln.slice(0, 96)}`)
              return
            }
          }
        }

        // Split into go2rtc and recording settings payloads
        const go2rtcPayload = {}
        const recordingPayload = {}

        for (const [key, val] of Object.entries(changed)) {
          if (key === 'go2rtc_webrtc_candidates') {
            go2rtcPayload.webrtc_candidates = val.length ? val : ['stun:8555']
          } else if (key === 'go2rtc_allow_arbitrary_exec') {
            go2rtcPayload.allow_arbitrary_exec = val
          } else if (key === 'go2rtc_allow_exec_module') {
            go2rtcPayload.allow_exec_module = val
          } else {
            recordingPayload[key] = val
          }
        }

        if (Object.keys(go2rtcPayload).length) {
          await go2rtcApi.updateSettings(go2rtcPayload)
        }
        if (Object.keys(recordingPayload).length) {
          await api.put('/api/recordings/settings/', recordingPayload)
        }

        // Update loadedValues to reflect saved state
        setLoadedValues((prev) => {
          const next = { ...prev }
          for (const key of Object.keys(changed)) {
            next[key] = values[key]
          }
          return next
        })

        onSuccess(`${SETTINGS_GROUP_LABELS[groupKey] || groupKey} settings saved.`)
      } catch (ex) {
        onError(ex.message || 'Save failed')
      } finally {
        setSavingGroup(null)
      }
    },
    [groups, values, loadedValues, onSuccess, onError]
  )

  if (!isOriginalAdmin) {
    return (
      <p className="text-sm text-gray-500">
        Only the original system administrator can view and edit settings.
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

  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <SettingsGroupCard
          key={g.key}
          groupKey={g.key}
          entries={g.entries}
          values={values}
          loadedValues={loadedValues}
          onChange={handleChange}
          onSave={handleSave}
          saving={savingGroup === g.key}
        />
      ))}

      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4 text-xs text-gray-500 space-y-1.5">
        <p className="font-medium text-gray-400">When do changes take effect?</p>
        <ul className="list-disc list-inside space-y-0.5">
          <li>
            <span className="text-green-400">Green</span> badges apply immediately after saving.
          </li>
          <li>
            <span className="text-amber-300">Amber</span> badges need a container restart (recorder,
            processor, or go2rtc).
          </li>
          <li>
            <span className="text-red-400">Red</span> badges require a full app restart.
          </li>
        </ul>
      </div>
    </div>
  )
}

// ── Panels (unchanged) ───────────────────────────────────────────────────────

function SystemPanel({ about, loading, error, setupStatus, isOriginalAdmin }) {
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
  const setupComplete = setupStatus?.setup_complete === true
  return (
    <div className="space-y-6">
      <SectionCard title="System at a glance" subtitle="Quick health and setup clarity for day-to-day use.">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <StatPill label="Version" value={about?.opus_version ?? 'unknown'} />
          <StatPill label="Timezone" value={about?.timezone || 'not set'} tone={about?.timezone ? 'good' : 'warn'} />
          <StatPill label="Initial setup" value={setupComplete ? 'Complete' : 'Needs attention'} tone={setupComplete ? 'good' : 'warn'} />
          <StatPill
            label="Settings access"
            value={isOriginalAdmin ? 'Full admin access' : 'Limited admin access'}
            tone={isOriginalAdmin ? 'good' : 'warn'}
          />
        </div>
      </SectionCard>

      <SectionCard title="Host details" subtitle="Helpful for support and capacity checks.">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-gray-500">OS</dt>
            <dd className="text-gray-200">
              {about?.host?.platform_system} {about?.host?.platform_release} ({about?.host?.platform_machine})
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Python</dt>
            <dd className="text-gray-200 font-mono">{about?.host?.python_version ?? '\u2014'}</dd>
          </div>
          <div>
            <dt className="text-gray-500">CPUs (logical)</dt>
            <dd className="text-gray-200">{about?.host?.cpu_count_logical ?? '\u2014'}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Recordings dir</dt>
            <dd className="text-gray-200 font-mono text-xs break-all">{about?.host?.recordings_dir ?? '\u2014'}</dd>
          </div>
        </dl>
        <p className="text-xs text-gray-500 mt-4">
          Set <code className="text-gray-400">TZ</code> and optionally <code className="text-gray-400">OPUS_VERSION</code> in Compose/.env.
        </p>
        {disk && (
          <p className="text-xs text-gray-400 mt-3">
            Volume: {disk.used_gb} / {disk.total_gb} GiB used ({disk.free_gb} GiB free)
          </p>
        )}
      </SectionCard>
    </div>
  )
}

function MaintenancePanel({ diagnostics, engine, loadingDiag, loadingEng, errorDiag, onRefresh }) {
  const [copied, setCopied] = useState(false)
  const [showRawEngine, setShowRawEngine] = useState(false)
  const [showRawDiag, setShowRawDiag] = useState(false)

  async function copyDiag() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (_e) {}
  }

  const engineTone = engine?.engine_running ? 'good' : 'warn'
  const freeGb = engine?.storage?.disk?.free_gb
  const freeTone = freeGb == null ? 'neutral' : freeGb < 5 ? 'warn' : 'good'

  return (
    <div className="space-y-6">
      <SectionCard
        title="Maintenance summary"
        subtitle="Fast readout before diving into diagnostics."
        actions={
          <button
            type="button"
            onClick={onRefresh}
            className="text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-900 hover:border-indigo-700 px-3 py-1 rounded-lg"
          >
            Refresh
          </button>
        }
      >
        {loadingEng ? (
          <Spinner className="w-5 h-5" />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <StatPill label="Recorder engine" value={engine?.engine_running ? 'Running' : 'Not running'} tone={engineTone} />
            <StatPill label="Active recordings" value={String(engine?.active_recordings ?? 0)} />
            <StatPill label="Shelved processes" value={String(engine?.shelved_count ?? 0)} tone={(engine?.shelved_count || 0) > 0 ? 'warn' : 'good'} />
            <StatPill label="Free disk (GiB)" value={freeGb == null ? 'unknown' : String(freeGb)} tone={freeTone} />
          </div>
        )}
        {engine?.disk_pressure && (
          <p className="text-amber-400 text-xs mt-3">
            Disk pressure detected. New recorder processes will wait until free space improves.
          </p>
        )}
      </SectionCard>

      <SectionCard title="Upgrade checklist" subtitle="Use this process for predictable updates.">
        <ul className="text-sm text-gray-400 list-disc list-inside space-y-1">
          <li>Update and recreate services: <code className="text-gray-300">docker compose pull &amp;&amp; docker compose up -d</code></li>
          <li>After updates, test one camera in live view and one playback timeline query.</li>
          <li>Review release notes before production rollouts.</li>
        </ul>
      </SectionCard>

      <SectionCard title="Container logs" subtitle="Primary troubleshooting source.">
        <p className="text-sm text-gray-400">
          Use <code className="text-gray-300">docker logs opus</code>, <code className="text-gray-300">opus-recorder</code>, and <code className="text-gray-300">go2rtc</code>.
        </p>
      </SectionCard>

      <SectionCard
        title="Host diagnostics"
        subtitle="Detailed system JSON for support and deeper troubleshooting."
        actions={
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
            <button
              type="button"
              onClick={() => setShowRawDiag((v) => !v)}
              className="text-xs text-gray-300 hover:text-white border border-gray-600 px-3 py-1 rounded-lg"
            >
              {showRawDiag ? 'Hide raw' : 'Show raw'}
            </button>
          </div>
        }
      >
        {errorDiag && <p className="text-red-400 text-sm mb-2">{errorDiag}</p>}
        {loadingDiag ? (
          <Spinner className="w-5 h-5" />
        ) : showRawDiag ? (
          <pre className="text-xs text-gray-400 overflow-x-auto max-h-96 bg-black/40 rounded-lg p-3 border border-gray-800">
            {diagnostics != null ? JSON.stringify(diagnostics, null, 2) : '{}'}
          </pre>
        ) : (
          <p className="text-sm text-gray-500">Raw diagnostics are hidden by default for readability.</p>
        )}
      </SectionCard>

      <SectionCard
        title="Recorder raw status"
        subtitle="Developer-focused details from the recorder process."
        actions={
          <button
            type="button"
            onClick={() => setShowRawEngine((v) => !v)}
            className="text-xs text-gray-300 hover:text-white border border-gray-600 px-3 py-1 rounded-lg"
          >
            {showRawEngine ? 'Hide raw' : 'Show raw'}
          </button>
        }
      >
        {loadingEng ? (
          <Spinner className="w-5 h-5" />
        ) : showRawEngine ? (
          <pre className="text-xs text-gray-400 overflow-x-auto max-h-48 bg-black/40 rounded-lg p-3 border border-gray-800">
            {JSON.stringify(engine, null, 2)}
          </pre>
        ) : (
          <p className="text-sm text-gray-500">Raw status is hidden by default for day-to-day operations.</p>
        )}
      </SectionCard>
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
          For <span className="font-mono text-gray-400">&hellip;-main</span> cameras without a separate{' '}
          <span className="font-mono text-gray-400">&hellip;-sub</span> row, this URL is paired automatically for live view.
        </p>
      </div>
      <p className="text-xs text-gray-500">Credentials stay on the server; list views show masked URLs.</p>
      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white py-2 rounded-lg text-sm font-medium"
        >
          {saving ? 'Saving\u2026' : 'Save & sync stream'}
        </button>
        <button type="button" onClick={onClose} className="flex-1 bg-gray-800 hover:bg-gray-700 text-gray-300 py-2 rounded-lg text-sm">
          Cancel
        </button>
      </div>
    </form>
  )
}

function CamerasPanel({ inventory, loading, onEditStreams }) {
  const [query, setQuery] = useState('')

  const normalized = query.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!normalized) return inventory
    return inventory.filter((row) => {
      const hay = [row.display_name, row.name, row.nvr_name, row.source_host, String(row.channel ?? '')]
        .join(' ')
        .toLowerCase()
      return hay.includes(normalized)
    })
  }, [inventory, normalized])

  const onlineCount = filtered.filter((row) => row.online === true).length

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
  for (const row of filtered) {
    const key = row.nvr_id ?? 'standalone'
    const label = row.nvr_name || 'Standalone (direct camera / no site group)'
    if (!groups[key]) groups[key] = { label, rows: [] }
    groups[key].rows.push(row)
  }
  for (const g of Object.values(groups)) {
    g.rows.sort(compareByChannelThenName)
  }

  return (
    <div className="space-y-6">
      <SectionCard title="Camera management" subtitle="Update stream URLs and verify camera connectivity quickly.">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full sm:max-w-md bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="Filter by camera name, channel, site, or host"
          />
          <p className="text-xs text-gray-400">
            Showing {filtered.length} / {inventory.length} cameras, {onlineCount} online
          </p>
        </div>
      </SectionCard>

      {!filtered.length && (
        <p className="text-sm text-gray-500">No cameras match your filter.</p>
      )}

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
                      <td className="px-3 py-2 text-gray-400 font-mono text-xs">{row.channel ?? '\u2014'}</td>
                      <td className="px-3 py-2 text-white">{row.display_name}</td>
                      <td className="px-3 py-2 text-gray-500 font-mono text-xs max-w-[140px] truncate" title={row.name}>
                        {row.name}
                      </td>
                      <td className="px-3 py-2 text-gray-400 font-mono text-xs">{row.source_host || '\u2014'}</td>
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
                          '\u2014'
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
  const tab = TAB_IDS.includes(raw) ? raw : raw === 'streaming' ? 'settings' : 'system'
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
    api
      .get('/api/recordings/settings/setup-status')
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
          <p className="text-sm text-gray-500 mt-1">Simple controls first, advanced controls when you need them.</p>
        </div>
        <div className="flex rounded-lg bg-gray-800 p-0.5 self-start flex-wrap">
          <TabButton active={tab === 'system'} onClick={() => setTab('system')}>
            Overview
          </TabButton>
          <TabButton active={tab === 'cameras'} onClick={() => setTab('cameras')}>
            Cameras
          </TabButton>
          <TabButton active={tab === 'settings'} onClick={() => setTab('settings')}>
            Settings
          </TabButton>
          <TabButton active={tab === 'maintenance'} onClick={() => setTab('maintenance')}>
            Maintenance
          </TabButton>
        </div>
      </div>

      {tab === 'system' && (
        <>
          <SystemPanel
            about={about}
            loading={aboutLoading}
            error={aboutErr}
            setupStatus={setupStatus}
            isOriginalAdmin={isOriginalAdmin}
          />
        </>
      )}

      {tab === 'settings' && (
        <SettingsPanel isOriginalAdmin={isOriginalAdmin} onSuccess={success} onError={toastError} />
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
        <Modal title={`Edit streams \u2014 ${editRow.display_name}`} onClose={() => setEditRow(null)}>
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
