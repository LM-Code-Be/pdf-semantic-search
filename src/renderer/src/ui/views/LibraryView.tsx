import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { PdfDocument } from '@shared/models'
import clsx from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import { fr } from 'date-fns/locale'
import { useState } from 'react'
import { Dialog } from '../components/Dialog'
import { useToasts } from '../components/Toasts'

export function LibraryView(props: { onOpenPdf: (doc: PdfDocument) => void; collectionId: string | null }) {
  const qc = useQueryClient()
  const { notify } = useToasts()
  const [deleteDoc, setDeleteDoc] = useState<PdfDocument | null>(null)

  const q = useQuery({
    queryKey: ['library'],
    queryFn: async () => window.api.listLibrary()
  })
  const cfgQ = useQuery({ queryKey: ['config'], queryFn: () => window.api.getConfig() })
  const collections = useQuery({ queryKey: ['collections'], queryFn: () => window.api.listCollections() })
  const cols = collections.data ?? []
  const currentModel = cfgQ.data?.embeddings.model ?? null

  const allDocs = q.data ?? []
  const docs =
    props.collectionId == null
      ? allDocs
      : allDocs.filter((d) => (d.collections ?? []).some((c) => c.id === props.collectionId))

  const statusLabel: Record<PdfDocument['indexingStatus'], string> = {
    not_indexed: 'Non indexe',
    queued: 'En file',
    indexing: 'Indexation...',
    indexed: 'Indexe',
    failed: 'Erreur'
  }

  return (
    <div
      className="h-full overflow-auto p-4 sm:p-6"
      onDragOver={(e) => e.preventDefault()}
      onDrop={async (e) => {
        e.preventDefault()
        const paths = Array.from(e.dataTransfer.files)
          .map((f) => (f as unknown as { path?: string }).path ?? '')
          .filter(Boolean)
        const res = await window.api.importPdfFiles(paths)
        for (const id of res.docIds) await window.api.queueIndexingDoc(id)
        if (res.imported > 0) notify({ kind: 'success', title: 'Import', message: `${res.imported} PDF(s) importe(s).` })
        await qc.invalidateQueries({ queryKey: ['library'] })
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-slate-600 dark:text-slate-300">{docs.length} PDF(s)</div>
        <button
          onClick={async () => {
            await window.api.reindexAll()
            notify({ kind: 'info', title: 'Indexation', message: 'Reindexation de toute la bibliotheque en cours.' })
            await qc.invalidateQueries({ queryKey: ['library'] })
          }}
          className="rounded-xl border border-slate-200/70 dark:border-white/10 px-3 py-2 text-sm hover:bg-slate-100/70 dark:hover:bg-white/10 transition-colors"
        >
          Reindexer tout
        </button>
      </div>

      <div className="mt-4 grid grid-cols-1 xl:grid-cols-2 gap-3">
        {docs.map((d) => (
          <div
            key={d.id}
            className="rounded-2xl border border-slate-200/60 dark:border-white/10 bg-white dark:bg-app-darkCard p-4 hover:shadow-sm transition-shadow"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold truncate">{d.fileName}</div>
                <div className="text-xs text-slate-500 dark:text-slate-300 mt-1">
                  {Math.round(d.fileSize / 1024)} KB
                  {d.pageCount ? ` | ${d.pageCount} page${d.pageCount > 1 ? 's' : ''}` : ''}
                  {' | '}
                  Ajoute {formatDistanceToNow(d.addedAt, { addSuffix: true, locale: fr })}
                </div>
              </div>
              <div
                className={clsx(
                  'text-xs px-2 py-1 rounded-lg border',
                  d.indexingStatus === 'indexed'
                    ? 'border-emerald-300/60 bg-emerald-50 text-emerald-900 dark:bg-emerald-400/10 dark:text-emerald-200 dark:border-emerald-400/20'
                    : d.indexingStatus === 'failed'
                      ? 'border-rose-300/60 bg-rose-50 text-rose-900 dark:bg-rose-400/10 dark:text-rose-200 dark:border-rose-400/20'
                      : d.indexingStatus === 'indexing'
                        ? 'border-cyan-300/60 bg-cyan-50 text-cyan-900 dark:bg-cyan-400/10 dark:text-cyan-200 dark:border-cyan-400/20'
                        : 'border-slate-200/80 bg-slate-50 text-slate-700 dark:bg-white/5 dark:text-slate-200 dark:border-white/10'
                )}
              >
                {statusLabel[d.indexingStatus]}
              </div>
            </div>

            {d.indexingStatus === 'indexed' && currentModel && d.embeddingModel && d.embeddingModel !== currentModel && (
              <div className="mt-2 text-xs text-amber-700 dark:text-amber-200">Modele change, reindexation recommandee.</div>
            )}

            {d.indexingStatus === 'indexed' && (
              <div className="mt-2 flex flex-wrap gap-2">
                {d.usedOcr && (
                  <span className="text-[11px] px-2 py-1 rounded-lg border border-cyan-200/70 dark:border-cyan-400/20 text-cyan-800 dark:text-cyan-200 bg-cyan-50 dark:bg-cyan-400/10">
                    OCR utilise
                  </span>
                )}
                {typeof d.textQuality === 'number' && (
                  <span className="text-[11px] px-2 py-1 rounded-lg border border-slate-200/80 dark:border-white/10 text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-white/5">
                    Qualite texte {Math.round(d.textQuality * 100)}%
                  </span>
                )}
              </div>
            )}

            {d.indexingStatus === 'indexed' && !d.usedOcr && (d.textQuality ?? 1) < 0.05 && (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-slate-600 dark:text-slate-300">Texte pauvre (PDF scanne ?), activer OCR peut aider.</div>
                <button
                  onClick={async () => {
                    const cfg = await window.api.getConfig()
                    if (!cfg.ocr.enabled) await window.api.setConfig({ ocr: { ...cfg.ocr, enabled: true } })
                    await window.api.queueIndexingDoc(d.id)
                    await qc.invalidateQueries({ queryKey: ['config'] })
                    await qc.invalidateQueries({ queryKey: ['library'] })
                  }}
                  className="rounded-xl border border-amber-200/70 dark:border-amber-400/20 px-3 py-1.5 text-xs text-amber-800 dark:text-amber-200 hover:bg-amber-50 dark:hover:bg-amber-400/10 transition-colors"
                >
                  OCR + reindexer
                </button>
              </div>
            )}

            {d.lastError && d.indexingStatus === 'failed' && <div className="text-xs text-rose-700 dark:text-rose-200 mt-2">{d.lastError}</div>}

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={() => props.onOpenPdf(d)}
                className="rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-900 px-3 py-2 text-sm hover:opacity-95 transition-opacity"
              >
                Ouvrir
              </button>
              <button
                onClick={async () => {
                  await window.api.queueIndexingDoc(d.id)
                  notify({ kind: 'info', title: 'Indexation', message: `Reindexation en file: ${d.fileName}` })
                  await qc.invalidateQueries({ queryKey: ['library'] })
                }}
                className="rounded-xl border border-slate-200/70 dark:border-white/10 px-3 py-2 text-sm hover:bg-slate-100/70 dark:hover:bg-white/10 transition-colors"
              >
                Reindexer
              </button>

              <details className="relative">
                <summary className="list-none cursor-pointer rounded-xl border border-slate-200/70 dark:border-white/10 px-3 py-2 text-sm hover:bg-slate-100/70 dark:hover:bg-white/10 transition-colors">
                  Organiser
                </summary>
                <div className="absolute z-10 right-0 sm:right-auto mt-2 w-[min(90vw,26rem)] rounded-2xl border border-slate-200/60 dark:border-white/10 bg-white dark:bg-app-darkCard p-4 shadow-lg">
                  <div className="text-xs text-slate-500 dark:text-slate-300">Collections</div>
                  <div className="mt-2 max-h-40 overflow-auto space-y-1">
                    {cols.map((c) => {
                      const checked = (d.collections ?? []).some((x) => x.id === c.id)
                      return (
                        <label key={c.id} className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-slate-50 dark:hover:bg-white/5">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={async (e) => {
                              const set = new Set((d.collections ?? []).map((x) => x.id))
                              if (e.target.checked) set.add(c.id)
                              else set.delete(c.id)
                              await window.api.setCollectionsForDoc(d.id, Array.from(set))
                              await qc.invalidateQueries({ queryKey: ['library'] })
                            }}
                          />
                          <span className="truncate">{c.name}</span>
                        </label>
                      )
                    })}
                    {cols.length === 0 && <div className="text-xs text-slate-500 dark:text-slate-300">Aucune collection.</div>}
                  </div>

                  <div className="mt-4 text-xs text-slate-500 dark:text-slate-300">Tags (separes par virgules)</div>
                  <input
                    className="mt-2 w-full rounded-xl border border-slate-200/70 dark:border-white/10 bg-transparent px-3 py-2 text-sm"
                    defaultValue={(d.tags ?? []).join(', ')}
                    onBlur={async (e) => {
                      const next = e.target.value
                        .split(',')
                        .map((t) => t.trim())
                        .filter(Boolean)
                      await window.api.setTagsForDoc(d.id, next)
                      await qc.invalidateQueries({ queryKey: ['library'] })
                    }}
                  />
                </div>
              </details>

              {(d.indexingStatus === 'queued' || d.indexingStatus === 'indexing') && (
                <button
                  onClick={async () => {
                    await window.api.cancelIndexingDoc(d.id)
                    notify({ kind: 'info', title: 'Indexation', message: `Annulation demandee: ${d.fileName}` })
                    await qc.invalidateQueries({ queryKey: ['library'] })
                  }}
                  className="rounded-xl border border-rose-200/70 dark:border-rose-400/20 px-3 py-2 text-sm text-rose-700 dark:text-rose-200 hover:bg-rose-50 dark:hover:bg-rose-400/10 transition-colors"
                >
                  Annuler
                </button>
              )}

              <button
                onClick={() => setDeleteDoc(d)}
                className="ml-auto rounded-xl border border-rose-200/70 dark:border-rose-400/20 px-3 py-2 text-sm text-rose-700 dark:text-rose-200 hover:bg-rose-50 dark:hover:bg-rose-400/10 transition-colors"
              >
                Supprimer
              </button>
            </div>
          </div>
        ))}
      </div>

      <Dialog
        open={!!deleteDoc}
        title="Supprimer le document ?"
        description={deleteDoc ? `Supprimer "${deleteDoc.fileName}" de la bibliotheque ?` : undefined}
        onClose={() => setDeleteDoc(null)}
        primary={{
          label: 'Supprimer',
          onClick: async () => {
            if (!deleteDoc) return
            await window.api.removeDocument(deleteDoc.id)
            notify({ kind: 'success', title: 'Suppression', message: 'Document supprime.' })
            setDeleteDoc(null)
            await qc.invalidateQueries({ queryKey: ['library'] })
          }
        }}
      >
        <div className="text-sm text-slate-600 dark:text-slate-300">Les donnees indexees associees seront retirees.</div>
      </Dialog>
    </div>
  )
}
