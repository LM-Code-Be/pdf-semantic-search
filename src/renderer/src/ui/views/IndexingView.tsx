import type { IndexingProgress } from '@shared/models'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { useToasts } from '../components/Toasts'

export function IndexingView(props: { progress: IndexingProgress | null }) {
  const qc = useQueryClient()
  const { notify } = useToasts()
  const jobsQ = useQuery({
    queryKey: ['indexingJobs'],
    queryFn: () => window.api.listIndexingJobs(),
    refetchInterval: 1000
  })
  const jobs = jobsQ.data ?? []

  const statusLabel: Record<string, string> = {
    queued: 'En file',
    running: 'En cours',
    done: 'Termine',
    failed: 'Echec',
    canceled: 'Annule'
  }
  const statusClass: Record<string, string> = {
    running:
      'border-cyan-300/60 bg-cyan-50 text-cyan-900 dark:bg-cyan-400/10 dark:text-cyan-200 dark:border-cyan-400/20',
    queued:
      'border-slate-200/80 bg-slate-50 text-slate-700 dark:bg-white/5 dark:text-slate-200 dark:border-white/10',
    done:
      'border-emerald-300/60 bg-emerald-50 text-emerald-900 dark:bg-emerald-400/10 dark:text-emerald-200 dark:border-emerald-400/20',
    failed:
      'border-rose-300/60 bg-rose-50 text-rose-900 dark:bg-rose-400/10 dark:text-rose-200 dark:border-rose-400/20',
    canceled:
      'border-amber-300/60 bg-amber-50 text-amber-900 dark:bg-amber-400/10 dark:text-amber-200 dark:border-amber-400/20'
  }

  return (
    <div className="h-full overflow-auto p-4 sm:p-6">
      <div className="rounded-2xl bg-white dark:bg-app-darkCard border border-slate-200/60 dark:border-white/10 p-5">
        <div className="text-base font-semibold">File d'attente</div>
        <div className="text-sm text-slate-600 dark:text-slate-300 mt-2">
          L'indexation se fait en arriere-plan, 1 document a la fois. Vous pouvez mettre en pause, reprendre ou annuler.
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={async () => {
              await window.api.pauseIndexing()
              notify({ kind: 'info', title: 'Indexation', message: 'Pause demandee.' })
              await qc.invalidateQueries({ queryKey: ['indexingJobs'] })
            }}
            className="rounded-xl border border-slate-200/70 dark:border-white/10 px-3 py-2 text-sm hover:bg-slate-100/70 dark:hover:bg-white/10 transition-colors"
          >
            Pause
          </button>
          <button
            onClick={async () => {
              await window.api.resumeIndexing()
              notify({ kind: 'info', title: 'Indexation', message: 'Reprise.' })
              await qc.invalidateQueries({ queryKey: ['indexingJobs'] })
            }}
            className="rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-900 px-3 py-2 text-sm hover:opacity-95 transition-opacity"
          >
            Reprendre
          </button>
          <button
            onClick={async () => {
              await window.api.cancelIndexingAll()
              notify({ kind: 'info', title: 'Indexation', message: 'Annulation de toute la file demandee.' })
              await qc.invalidateQueries({ queryKey: ['indexingJobs'] })
              await qc.invalidateQueries({ queryKey: ['library'] })
            }}
            className="rounded-xl border border-rose-200/70 dark:border-rose-400/20 px-3 py-2 text-sm text-rose-700 dark:text-rose-200 hover:bg-rose-50 dark:hover:bg-rose-400/10 transition-colors"
          >
            Annuler tout
          </button>
          <button
            onClick={async () => {
              await window.api.queueIndexingAll()
              notify({ kind: 'info', title: 'Indexation', message: 'Indexation des documents non indexes en cours.' })
              await qc.invalidateQueries({ queryKey: ['indexingJobs'] })
              await qc.invalidateQueries({ queryKey: ['library'] })
            }}
            className="sm:ml-auto rounded-xl border border-slate-200/70 dark:border-white/10 px-3 py-2 text-sm hover:bg-slate-100/70 dark:hover:bg-white/10 transition-colors"
          >
            Indexer tout
          </button>
        </div>

        {props.progress ? (
          <div className="mt-6">
            <div className="text-sm font-medium">En cours</div>
            <div className="text-xs text-slate-500 dark:text-slate-300 mt-1">
              {props.progress.stage} | Pages {props.progress.processedPages}/{props.progress.totalPages ?? '...'} | Chunks{' '}
              {props.progress.processedChunks}/{props.progress.totalChunks ?? '...'}
            </div>
            {props.progress.message && <div className="text-xs mt-2">{props.progress.message}</div>}
          </div>
        ) : (
          <div className="text-sm text-slate-500 dark:text-slate-300 mt-6">Aucune indexation en cours.</div>
        )}
      </div>

      <div className="mt-4 rounded-2xl bg-white dark:bg-app-darkCard border border-slate-200/60 dark:border-white/10 p-5">
        <div className="flex items-center justify-between">
          <div className="text-base font-semibold">Jobs</div>
          <div className="text-xs text-slate-500 dark:text-slate-300">{jobs.length} element(s)</div>
        </div>

        <div className="mt-3 space-y-2">
          {jobs.map((j) => (
            <div key={j.id} className="rounded-2xl border border-slate-200/60 dark:border-white/10 bg-white/60 dark:bg-black/10 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium truncate">{j.docName}</div>
                  {j.error && j.status === 'failed' && <div className="mt-1 text-xs text-rose-700 dark:text-rose-200 line-clamp-2">{j.error}</div>}
                </div>
                <div className="flex items-center gap-2">
                  <span className={clsx('text-xs px-2 py-1 rounded-lg border', statusClass[j.status] ?? statusClass.queued)}>
                    {statusLabel[j.status] ?? j.status}
                  </span>
                  {(j.status === 'queued' || j.status === 'running') && (
                    <button
                      onClick={async () => {
                        await window.api.cancelIndexingDoc(j.docId)
                        notify({ kind: 'info', title: 'Indexation', message: `Annulation demandee: ${j.docName}` })
                        await qc.invalidateQueries({ queryKey: ['indexingJobs'] })
                        await qc.invalidateQueries({ queryKey: ['library'] })
                      }}
                      className="rounded-xl border border-rose-200/70 dark:border-rose-400/20 px-3 py-1.5 text-xs text-rose-700 dark:text-rose-200 hover:bg-rose-50 dark:hover:bg-rose-400/10 transition-colors"
                    >
                      Annuler
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}

          {jobs.length === 0 && <div className="text-sm text-slate-500 dark:text-slate-300 mt-4 text-center">Aucun job.</div>}
        </div>
      </div>
    </div>
  )
}
