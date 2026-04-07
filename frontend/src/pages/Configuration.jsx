import { useCallback, useEffect, useMemo, useState } from 'react'
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

const TAB_IDS = ['system', 'cameras', 'streaming', 'maintenance']

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

      <SectionCard title="What to do next" subtitle="Use this as your simple operational checklist.">
        <ul className="space-y-2 text-sm text-gray-300">
          <li>
            {setupComplete ? 'OK' : 'Todo'} - Confirm recording storage setup in Recordings.
          </li>
          <li>Todo - Validate camera stream URLs after install or IP changes.</li>
          <li>Todo - Review retention and storage policy before go-live.</li>
          <li>Todo - Run one live-view and playback smoke test after updates.</li>
        </ul>
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

function StreamingPanel({ isOriginalAdmin, onSuccess, onError }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [candidatesText, setCandidatesText] = useState('')
  const [allowArbitrary, setAllowArbitrary] = useState(false)
  const [allowExecMod, setAllowExecMod] = useState(false)
  const [envLocked, setEnvLocked] = useState(false)
  const [configPath, setConfigPath] = useState('')
  const [restartHint, setRestartHint] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [perf, setPerf] = useState({
    ffmpeg_hwaccel: 'none',
    ffmpeg_hwaccel_device: '',
    motion_max_concurrent: 4,
    motion_analysis_max_width: 320,
    motion_rtsp_mode: 'auto',
  })

  useEffect(() => {
    if (!isOriginalAdmin) {
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    Promise.all([go2rtcApi.getSettings(), api.get('/api/recordings/settings/')])
      .then(([d, rs]) => {
        if (!alive) return
        setCandidatesText((d.webrtc_candidates || []).join('\n'))
        setAllowArbitrary(!!d.allow_arbitrary_exec)
        setAllowExecMod(!!d.allow_exec_module)
        setEnvLocked(!!d.arbitrary_exec_env_locked)
        setConfigPath(d.config_path || '')
        setRestartHint(d.restart_hint || '')
        setPerf({
          ffmpeg_hwaccel: rs.ffmpeg_hwaccel || 'none',
          ffmpeg_hwaccel_device: rs.ffmpeg_hwaccel_device || '',
          motion_max_concurrent: Number(rs.motion_max_concurrent ?? 4),
          motion_analysis_max_width: Number(rs.motion_analysis_max_width ?? 320),
          motion_rtsp_mode: rs.motion_rtsp_mode || 'auto',
        })
      })
      .catch((e) => onError(e.message || 'Failed to load streaming settings'))
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [isOriginalAdmin])

  function validateIceCandidates(text) {
    const lines = text.split('\n').map((s) => s.trim()).filter(Boolean)
    for (const ln of lines) {
      if (!/^(stun|turn):/i.test(ln)) {
        return `Each ICE line must start with stun: or turn:. Invalid: ${ln.slice(0, 96)}`
      }
    }
    return null
  }

  async function handleSave(e) {
    e.preventDefault()
    const iceErr = validateIceCandidates(candidatesText)
    if (iceErr) {
      onError(iceErr)
      return
    }
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
      await api.put('/api/recordings/settings/', {
        ffmpeg_hwaccel: perf.ffmpeg_hwaccel,
        ffmpeg_hwaccel_device: perf.ffmpeg_hwaccel_device || '',
        motion_max_concurrent: Number(perf.motion_max_concurrent || 4),
        motion_analysis_max_width: Number(perf.motion_analysis_max_width || 320),
        motion_rtsp_mode: perf.motion_rtsp_mode,
      })
      onSuccess('Streaming/performance settings saved. Restart go2rtc and recorder/processor containers to fully apply hardware/performance changes.')
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
      <SectionCard title="Streaming basics" subtitle="Most installs only need ICE candidates and a save/restart.">
        <p className="text-sm text-gray-400 mb-3">
          One <strong className="text-gray-300">WebRTC ICE</strong> candidate per line. Each line must start with{' '}
          <code className="text-gray-300">stun:</code> or <code className="text-gray-300">turn:</code> (go2rtc
          format). Saved into <code className="text-gray-400 break-all">{configPath || 'go2rtc.yaml'}</code>.
          For remote access, HTTPS, and when to use TURN, see the project doc{' '}
          <code className="text-gray-500">docs/remote-viewing.md</code> (section &quot;WebRTC ICE&quot;).
        </p>
        <p className="text-xs text-gray-500 mb-2 font-mono leading-relaxed">
          Examples: <span className="text-gray-400">stun:8555</span> ·{' '}
          <span className="text-gray-400">stun:stun.l.google.com:19302</span> ·{' '}
          <span className="text-gray-400">turn:user:pass@relay.example.com:3478?transport=udp</span>
        </p>
        <textarea
          className={`${inputCls} min-h-[120px]`}
          value={candidatesText}
          onChange={(e) => setCandidatesText(e.target.value)}
          placeholder={'stun:8555\nstun:stun.l.google.com:19302'}
        />
      </SectionCard>

      <SectionCard
        title="Advanced streaming controls"
        subtitle="Only needed for custom exec-based stream pipelines."
        actions={
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-900 hover:border-indigo-700 px-3 py-1 rounded-lg"
          >
            {showAdvanced ? 'Hide advanced' : 'Show advanced'}
          </button>
        }
      >
        {showAdvanced ? (
          <div className="space-y-4">
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
                  Enable only if you trust every source URL managed in Opus.
                </span>
                {envLocked && (
                  <span className="block text-xs text-amber-400 mt-2">
                    Locked by <code className="text-gray-400">GO2RTC_ALLOW_ARBITRARY_EXEC</code> environment variable.
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
                  Keep off unless you run advanced <code className="text-gray-400">exec:</code> pipelines.
                </span>
              </span>
            </label>
          </div>
        ) : (
          <p className="text-sm text-gray-500">Advanced options are hidden by default to keep setup simple.</p>
        )}
      </SectionCard>

      <SectionCard
        title="Performance and decode"
        subtitle="Tune hardware acceleration and motion decode pressure from the UI."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="text-xs text-gray-400">
            FFmpeg hardware acceleration
            <select
              className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
              value={perf.ffmpeg_hwaccel}
              onChange={(e) => setPerf((p) => ({ ...p, ffmpeg_hwaccel: e.target.value }))}
            >
              {['none', 'cuda', 'qsv', 'vaapi', 'videotoolbox', 'dxva2', 'd3d11va'].map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-gray-400">
            HW accel device (optional)
            <input
              className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
              value={perf.ffmpeg_hwaccel_device}
              onChange={(e) => setPerf((p) => ({ ...p, ffmpeg_hwaccel_device: e.target.value }))}
              placeholder="e.g. 0"
            />
          </label>
          <label className="text-xs text-gray-400">
            Motion max concurrent
            <input
              type="number"
              min={1}
              max={64}
              className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
              value={perf.motion_max_concurrent}
              onChange={(e) => setPerf((p) => ({ ...p, motion_max_concurrent: Number(e.target.value || 4) }))}
            />
          </label>
          <label className="text-xs text-gray-400">
            Motion analysis width (0 = full)
            <input
              type="number"
              min={0}
              max={1920}
              className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
              value={perf.motion_analysis_max_width}
              onChange={(e) => setPerf((p) => ({ ...p, motion_analysis_max_width: Number(e.target.value || 320) }))}
            />
          </label>
          <label className="text-xs text-gray-400 md:col-span-2">
            Motion RTSP mode
            <select
              className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
              value={perf.motion_rtsp_mode}
              onChange={(e) => setPerf((p) => ({ ...p, motion_rtsp_mode: e.target.value }))}
            >
              <option value="auto">auto (prefer sub)</option>
              <option value="sub">sub only (fallback main)</option>
              <option value="main">main only</option>
            </select>
          </label>
        </div>
      </SectionCard>

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
  const [open, setOpen] = useState(false)

  async function generate() {
    setBusy(true)
    try {
      const data = await authApi.createToken()
      const token = data?.token
      if (token) {
        try {
          await navigator.clipboard.writeText(token)
        } catch (_e) {}
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
    <SectionCard
      title="API access (advanced)"
      subtitle="Use this only for scripts or external apps that cannot use normal login sessions."
      actions={
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-900 hover:border-indigo-700 px-3 py-1 rounded-lg"
        >
          {open ? 'Hide' : 'Show'}
        </button>
      }
    >
      {open ? (
        <>
          <p className="text-sm text-gray-400 mb-4">
            Send <code className="text-gray-300">Authorization: Bearer &lt;token&gt;</code>. For different origins, set{' '}
            <code className="text-gray-300">CORS_ORIGINS</code> on the server (see <code className="text-gray-400">docs/remote-viewing.md</code>).
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
        </>
      ) : (
        <p className="text-sm text-gray-500">Hidden to reduce noise during normal configuration.</p>
      )}
    </SectionCard>
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
          For <span className="font-mono text-gray-400">…-main</span> cameras without a separate{' '}
          <span className="font-mono text-gray-400">…-sub</span> row, this URL is paired automatically for live view.
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
          <TabButton active={tab === 'streaming'} onClick={() => setTab('streaming')}>
            Streaming
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
