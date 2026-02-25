import { useState, useCallback } from 'react'

export function useToast(durationMs = 3500) {
  const [toasts, setToasts] = useState([])

  const show = useCallback((message, type = 'success') => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), durationMs)
  }, [durationMs])

  const success = useCallback((msg) => show(msg, 'success'), [show])
  const error   = useCallback((msg) => show(msg, 'error'),   [show])

  return { toasts, success, error }
}

export function ToastList({ toasts }) {
  if (!toasts.length) return null
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 items-end">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-sm shadow-lg border transition-all ${
            t.type === 'error'
              ? 'bg-red-900/90 text-red-200 border-red-700'
              : 'bg-gray-800 text-gray-100 border-gray-700'
          }`}
        >
          {t.type === 'error' ? (
            <svg className="w-4 h-4 shrink-0 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          ) : (
            <svg className="w-4 h-4 shrink-0 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          )}
          {t.message}
        </div>
      ))}
    </div>
  )
}
