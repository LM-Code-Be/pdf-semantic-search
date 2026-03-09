import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import clsx from 'clsx'
import { nanoid } from 'nanoid'

type ToastKind = 'info' | 'success' | 'error'
type Toast = { id: string; kind: ToastKind; title?: string; message: string }

type ToastApi = {
  notify(input: { kind: ToastKind; title?: string; message: string; timeoutMs?: number }): void
}

const ToastContext = createContext<ToastApi | null>(null)

export function useToasts() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToasts must be used within <ToastProvider>')
  return ctx
}

export function ToastProvider(props: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const remove = useCallback((id: string) => {
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])

  const notify = useCallback(
    (input: { kind: ToastKind; title?: string; message: string; timeoutMs?: number }) => {
      const id = nanoid()
      const toast: Toast = { id, kind: input.kind, title: input.title, message: input.message }
      setToasts((t) => [toast, ...t].slice(0, 6))
      const timeout = input.timeoutMs ?? 4500
      window.setTimeout(() => remove(id), timeout)
    },
    [remove]
  )

  const api = useMemo<ToastApi>(() => ({ notify }), [notify])

  return (
    <ToastContext.Provider value={api}>
      {props.children}
      <div
        className="fixed bottom-4 right-4 z-[70] w-[420px] max-w-[calc(100vw-2rem)] space-y-2"
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={clsx(
              'rounded-2xl border shadow-lg backdrop-blur px-4 py-3',
              'bg-white/95 dark:bg-app-darkCard/95',
              t.kind === 'success'
                ? 'border-emerald-200/70 dark:border-emerald-400/20'
                : t.kind === 'error'
                  ? 'border-rose-200/70 dark:border-rose-400/20'
                  : 'border-slate-200/70 dark:border-white/10'
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {t.title && <div className="text-sm font-semibold truncate">{t.title}</div>}
                <div className="text-sm text-slate-700 dark:text-slate-200">{t.message}</div>
              </div>
              <button
                className="text-xs text-slate-500 dark:text-slate-300 hover:underline"
                onClick={() => remove(t.id)}
              >
                Fermer
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
