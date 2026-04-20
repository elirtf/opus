import { useState, useCallback, useEffect, useRef } from 'react'

export function useToast(durationMs = 3500) {
  const [toasts, setToasts] = useState([])

  const show = useCallback((message, type = 'success') => {
    const id = Date.now() + Math.random()
    setToasts(prev => [...prev, { id, message, type, entering: true }])
    // Mark as entered after a frame so the CSS transition triggers
    requestAnimationFrame(() => {
      setToasts(prev =>
        prev.map(t => (t.id === id ? { ...t, entering: false } : t))
      )
    })
    setTimeout(() => {
      // Mark as exiting first for slide-out animation
      setToasts(prev =>
        prev.map(t => (t.id === id ? { ...t, exiting: true } : t))
      )
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 300)
    }, durationMs)
  }, [durationMs])

  const dismiss = useCallback((id) => {
    setToasts(prev =>
      prev.map(t => (t.id === id ? { ...t, exiting: true } : t))
    )
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 300)
  }, [])

  const success = useCallback((msg) => show(msg, 'success'), [show])
  const error   = useCallback((msg) => show(msg, 'error'),   [show])
  const info    = useCallback((msg) => show(msg, 'info'),     [show])

  return { toasts, show, success, error, info, dismiss }
}

const ICONS = {
  success: (
    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  ),
  error: (
    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
    </svg>
  ),
  info: (
    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
    </svg>
  ),
}

const TYPE_STYLES = {
  success: 'bg-emerald-900/90 text-emerald-100 border-emerald-700/60',
  error:   'bg-red-900/90 text-red-100 border-red-700/60',
  info:    'bg-slate-800/95 text-slate-100 border-slate-600/60',
}

const ICON_STYLES = {
  success: 'text-emerald-400',
  error:   'text-red-400',
  info:    'text-blue-400',
}

export function ToastList({ toasts, onDismiss }) {
  if (!toasts.length) return null
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2.5 items-end pointer-events-none">
      {toasts.map(t => {
        const hidden = t.entering || t.exiting
        return (
          <div
            key={t.id}
            role="alert"
            style={{
              transform: hidden ? 'translateX(120%)' : 'translateX(0)',
              opacity: hidden ? 0 : 1,
              transition: 'transform 300ms cubic-bezier(.4,0,.2,1), opacity 300ms ease',
            }}
            className={`pointer-events-auto flex items-center gap-2.5 pl-3.5 pr-2 py-2.5 rounded-xl text-sm font-medium shadow-xl border backdrop-blur-sm max-w-sm ${
              TYPE_STYLES[t.type] || TYPE_STYLES.info
            }`}
          >
            <span className={ICON_STYLES[t.type] || ICON_STYLES.info}>
              {ICONS[t.type] || ICONS.info}
            </span>
            <span className="flex-1 min-w-0 break-words">{t.message}</span>
            {onDismiss && (
              <button
                onClick={() => onDismiss(t.id)}
                className="shrink-0 ml-1 p-0.5 rounded hover:bg-white/10 text-current opacity-60 hover:opacity-100 transition-opacity"
                aria-label="Dismiss"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
