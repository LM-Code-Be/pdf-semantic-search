import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'

export function Dialog(props: {
  open: boolean
  title: string
  description?: string
  children: React.ReactNode
  primary?: { label: string; onClick: () => void; disabled?: boolean }
  secondary?: { label: string; onClick: () => void }
  onClose: () => void
}) {
  const { open, onClose } = props

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute inset-0 flex items-center justify-center p-4 sm:p-6">
        <div
          role="dialog"
          aria-modal="true"
          className="w-full max-w-lg rounded-2xl bg-white dark:bg-app-darkCard border border-slate-200/60 dark:border-white/10 shadow-xl overflow-hidden"
        >
          <div className="px-5 py-4 border-b border-slate-200/60 dark:border-white/10">
            <div className="text-base font-semibold">{props.title}</div>
            {props.description && (
              <div className="text-sm text-slate-600 dark:text-slate-300 mt-1">{props.description}</div>
            )}
          </div>
          <div className="px-5 py-4">{props.children}</div>
          <div className="px-5 py-4 border-t border-slate-200/60 dark:border-white/10 flex items-center gap-2 justify-end">
            <button
              className="rounded-xl border border-slate-200/70 dark:border-white/10 px-3 py-2 text-sm hover:bg-slate-100/70 dark:hover:bg-white/10 transition-colors"
              onClick={props.secondary?.onClick ?? onClose}
            >
              {props.secondary?.label ?? 'Annuler'}
            </button>
            {props.primary && (
              <button
                className={clsx(
                  'rounded-xl px-3 py-2 text-sm font-medium transition-colors',
                  props.primary.disabled
                    ? 'bg-slate-200 text-slate-600 dark:bg-white/10 dark:text-slate-200'
                    : 'bg-gradient-to-r from-indigo-500 to-violet-600 text-white hover:opacity-95'
                )}
                disabled={props.primary.disabled}
                onClick={props.primary.onClick}
              >
                {props.primary.label}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
