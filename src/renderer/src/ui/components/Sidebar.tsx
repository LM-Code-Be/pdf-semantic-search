import clsx from 'clsx'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import type { IndexingProgress } from '@shared/models'
import { Dialog } from './Dialog'
import { useToasts } from './Toasts'

export function Sidebar(props: {
  tab: 'library' | 'search' | 'indexing' | 'favorites' | 'settings'
  onTab: (t: 'library' | 'search' | 'indexing' | 'favorites' | 'settings') => void
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  progress: IndexingProgress | null
  collectionId: string | null
  onCollectionId: (id: string | null) => void
  className?: string
  showClose?: boolean
  onClose?: () => void
}) {
  const { tab, onTab, theme, onToggleTheme, progress, collectionId, onCollectionId, className, showClose, onClose } = props
  const qc = useQueryClient()
  const { notify } = useToasts()
  const collections = useQuery({ queryKey: ['collections'], queryFn: () => window.api.listCollections() })
  const cols = collections.data ?? []

  const stageLabel = useMemo(() => {
    const map: Record<string, string> = {
      queued: 'En file',
      extract: 'Extraction',
      ocr: 'OCR',
      chunk: 'Chunking',
      embed: 'Embeddings',
      finalize: 'Finalisation'
    }
    return (s: string) => map[s] ?? s
  }, [])

  const progressPct = useMemo(() => {
    if (!progress) return 0
    if (progress.totalPages && (progress.stage === 'extract' || progress.stage === 'ocr')) {
      return Math.round((progress.processedPages / Math.max(1, progress.totalPages)) * 100)
    }
    if (progress.totalChunks && progress.stage === 'embed') {
      return Math.round((progress.processedChunks / Math.max(1, progress.totalChunks)) * 100)
    }
    if (progress.stage === 'finalize') return 100
    return 0
  }, [progress])

  type ColDialog =
    | { type: 'create'; name: string; color: string }
    | { type: 'rename'; id: string; name: string }
    | { type: 'color'; id: string; name: string; color: string }
    | { type: 'delete'; id: string; name: string }
    | null

  const [colDialog, setColDialog] = useState<ColDialog>(null)

  const item = (id: typeof tab, label: string) => (
    <button
      onClick={() => {
        onTab(id)
        onClose?.()
      }}
      className={clsx(
        'w-full text-left px-3 py-2 rounded-lg text-sm transition-colors',
        tab === id
          ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
          : 'text-slate-700 hover:bg-slate-200/70 dark:text-slate-200 dark:hover:bg-white/10'
      )}
    >
      {label}
    </button>
  )

  return (
    <div
      className={clsx(
        'w-72 shrink-0 border-r border-slate-200/60 dark:border-white/10 bg-white/80 dark:bg-black/20 backdrop-blur overflow-auto',
        className
      )}
    >
      <div className="px-4 py-5 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold tracking-wide text-slate-900 dark:text-white">PDF Semantic Search</div>
          <div className="text-xs text-slate-500 dark:text-slate-300 mt-1">Recherche semantique offline</div>
        </div>
        {showClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200/70 dark:border-white/10 px-2 py-1 text-xs hover:bg-slate-100/70 dark:hover:bg-white/10"
          >
            Fermer
          </button>
        )}
      </div>

      <div className="px-3 space-y-1">
        {item('search', 'Recherche')}
        {item('library', 'Bibliotheque')}
        {item('indexing', 'Indexation')}
        {item('favorites', 'Favoris')}
        {item('settings', 'Parametres')}
      </div>

      <div className="px-4 mt-6">
        <button
          onClick={async () => {
            const paths = await window.api.pickPdfFiles()
            const res = await window.api.importPdfFiles(paths)
            for (const id of res.docIds) await window.api.queueIndexingDoc(id)
            await qc.invalidateQueries({ queryKey: ['library'] })
            if (res.imported > 0) notify({ kind: 'success', title: 'Import', message: `${res.imported} PDF(s) importe(s).` })
          }}
          className="w-full rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 text-white px-4 py-2.5 text-sm font-medium hover:opacity-95 transition-opacity"
        >
          Ajouter des PDFs
        </button>
        <button
          onClick={async () => {
            const folder = await window.api.pickFolder()
            if (!folder) return
            const res = await window.api.scanFolder(folder)
            for (const id of res.docIds) await window.api.queueIndexingDoc(id)
            await qc.invalidateQueries({ queryKey: ['library'] })
            if (res.imported > 0) notify({ kind: 'success', title: 'Import', message: `${res.imported} PDF(s) importe(s).` })
          }}
          className="mt-2 w-full rounded-xl border border-slate-200/70 dark:border-white/10 px-4 py-2.5 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100/60 dark:hover:bg-white/10 transition-colors"
        >
          Scanner un dossier...
        </button>
      </div>

      <div className="px-4 mt-6">
        <div className="flex items-center justify-between">
          <div className="text-xs text-slate-500 dark:text-slate-300">Collections</div>
          <button
            className="text-xs text-cyan-700 dark:text-cyan-200 hover:underline"
            onClick={async () => {
              setColDialog({ type: 'create', name: '', color: '#06b6d4' })
            }}
          >
            + Ajouter
          </button>
        </div>
        <div className="mt-2 space-y-1">
          <button
            className={clsx(
              'w-full text-left px-3 py-2 rounded-lg text-sm transition-colors',
              collectionId == null
                ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                : 'text-slate-700 hover:bg-slate-200/70 dark:text-slate-200 dark:hover:bg-white/10'
            )}
            onClick={() => onCollectionId(null)}
          >
            Toutes
          </button>
          {cols.map((c) => (
            <div
              key={c.id}
              className={clsx(
                'group flex items-center rounded-lg transition-colors',
                collectionId === c.id
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                  : 'text-slate-700 hover:bg-slate-200/70 dark:text-slate-200 dark:hover:bg-white/10'
              )}
            >
              <button
                className="flex-1 min-w-0 text-left px-3 py-2 text-sm flex items-center gap-2"
                onClick={() => onCollectionId(c.id)}
              >
                <span
                  className="inline-block size-2 rounded-full"
                  style={{ backgroundColor: c.color ?? (collectionId === c.id ? '#ffffff' : '#06b6d4') }}
                />
                <span className="truncate">{c.name}</span>
              </button>
              <button
                className={clsx(
                  'mr-1 rounded-md px-2 py-1 text-[11px] border transition-colors',
                  collectionId === c.id
                    ? 'border-white/20 hover:bg-white/10 dark:border-slate-900/20 dark:hover:bg-slate-900/10'
                    : 'border-slate-200/70 dark:border-white/10 hover:bg-white/60 dark:hover:bg-white/10',
                  'opacity-0 group-hover:opacity-100 focus:opacity-100'
                )}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setColDialog({ type: 'rename', id: c.id, name: c.name })
                }}
                title="Renommer"
                aria-label={`Renommer ${c.name}`}
              >
                Nom
              </button>
              <button
                className={clsx(
                  'mr-1 rounded-md px-2 py-1 text-[11px] border transition-colors',
                  collectionId === c.id
                    ? 'border-white/20 hover:bg-white/10 dark:border-slate-900/20 dark:hover:bg-slate-900/10'
                    : 'border-slate-200/70 dark:border-white/10 hover:bg-white/60 dark:hover:bg-white/10',
                  'opacity-0 group-hover:opacity-100 focus:opacity-100'
                )}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setColDialog({ type: 'color', id: c.id, name: c.name, color: c.color ?? '#06b6d4' })
                }}
                title="Couleur"
                aria-label={`Couleur ${c.name}`}
              >
                Color
              </button>
              <button
                className={clsx(
                  'mr-2 rounded-md px-2 py-1 text-[11px] border transition-colors',
                  collectionId === c.id
                    ? 'border-white/20 hover:bg-white/10 dark:border-slate-900/20 dark:hover:bg-slate-900/10'
                    : 'border-rose-200/70 dark:border-rose-400/20 hover:bg-rose-50 dark:hover:bg-rose-400/10',
                  'opacity-0 group-hover:opacity-100 focus:opacity-100'
                )}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setColDialog({ type: 'delete', id: c.id, name: c.name })
                }}
                title="Supprimer"
                aria-label={`Supprimer ${c.name}`}
              >
                Suppr
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="px-4 mt-4">
        <button
          onClick={onToggleTheme}
          className="w-full rounded-xl border border-slate-200/70 dark:border-white/10 px-4 py-2.5 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100/60 dark:hover:bg-white/10 transition-colors"
        >
          Theme: {theme === 'dark' ? 'Sombre' : 'Clair'}
        </button>
      </div>

      {progress && (
        <div className="px-4 mt-6 pb-5">
          <div className="text-xs text-slate-500 dark:text-slate-300">Indexation</div>
          <div className="mt-2 rounded-xl border border-slate-200/70 dark:border-white/10 p-3">
            <div className="text-sm font-medium">{stageLabel(progress.stage)}</div>
            <div className="text-xs text-slate-500 dark:text-slate-300 mt-1">
              Pages: {progress.processedPages}/{progress.totalPages ?? '...'} | Chunks: {progress.processedChunks}/
              {progress.totalChunks ?? '...'}
            </div>
            {progress.message && <div className="text-xs mt-1">{progress.message}</div>}
            <div className="mt-2 h-2 rounded-full bg-slate-200/70 dark:bg-white/10 overflow-hidden">
              <div className="h-full bg-gradient-to-r from-cyan-500 to-emerald-500" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        </div>
      )}

      <Dialog
        open={colDialog?.type === 'create'}
        title="Nouvelle collection"
        description="Creez une collection pour organiser et filtrer vos PDFs."
        onClose={() => setColDialog(null)}
        primary={{
          label: 'Creer',
          disabled: !colDialog || colDialog.type !== 'create' || !colDialog.name.trim(),
          onClick: async () => {
            if (!colDialog || colDialog.type !== 'create') return
            await window.api.createCollection(colDialog.name.trim(), colDialog.color || null)
            setColDialog(null)
            notify({ kind: 'success', title: 'Collections', message: 'Collection creee.' })
            await qc.invalidateQueries({ queryKey: ['collections'] })
            await qc.invalidateQueries({ queryKey: ['library'] })
          }
        }}
      >
        <div className="space-y-3">
          <label className="text-sm block">
            <div className="text-xs text-slate-500 dark:text-slate-300">Nom</div>
            <input
              className="mt-1 w-full rounded-xl border border-slate-200/70 dark:border-white/10 bg-transparent px-3 py-2 text-sm"
              value={colDialog?.type === 'create' ? colDialog.name : ''}
              onChange={(e) => setColDialog((d) => (d && d.type === 'create' ? { ...d, name: e.target.value } : d))}
              autoFocus
            />
          </label>
          <label className="text-sm block">
            <div className="text-xs text-slate-500 dark:text-slate-300">Couleur</div>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="color"
                value={colDialog?.type === 'create' ? colDialog.color : '#06b6d4'}
                onChange={(e) => setColDialog((d) => (d && d.type === 'create' ? { ...d, color: e.target.value } : d))}
              />
              <div className="text-xs text-slate-500 dark:text-slate-300">Optionnel</div>
            </div>
          </label>
        </div>
      </Dialog>

      <Dialog
        open={colDialog?.type === 'rename'}
        title="Renommer"
        onClose={() => setColDialog(null)}
        primary={{
          label: 'Enregistrer',
          disabled: !colDialog || colDialog.type !== 'rename' || !colDialog.name.trim(),
          onClick: async () => {
            if (!colDialog || colDialog.type !== 'rename') return
            await window.api.renameCollection(colDialog.id, colDialog.name.trim())
            setColDialog(null)
            notify({ kind: 'success', title: 'Collections', message: 'Nom mis a jour.' })
            await qc.invalidateQueries({ queryKey: ['collections'] })
            await qc.invalidateQueries({ queryKey: ['library'] })
          }
        }}
      >
        <label className="text-sm block">
          <div className="text-xs text-slate-500 dark:text-slate-300">Nom</div>
          <input
            className="mt-1 w-full rounded-xl border border-slate-200/70 dark:border-white/10 bg-transparent px-3 py-2 text-sm"
            value={colDialog?.type === 'rename' ? colDialog.name : ''}
            onChange={(e) => setColDialog((d) => (d && d.type === 'rename' ? { ...d, name: e.target.value } : d))}
            autoFocus
          />
        </label>
      </Dialog>

      <Dialog
        open={colDialog?.type === 'color'}
        title="Couleur"
        onClose={() => setColDialog(null)}
        primary={{
          label: 'Appliquer',
          onClick: async () => {
            if (!colDialog || colDialog.type !== 'color') return
            await window.api.setCollectionColor(colDialog.id, colDialog.color?.trim() ? colDialog.color.trim() : null)
            setColDialog(null)
            notify({ kind: 'success', title: 'Collections', message: 'Couleur mise a jour.' })
            await qc.invalidateQueries({ queryKey: ['collections'] })
            await qc.invalidateQueries({ queryKey: ['library'] })
          }
        }}
        secondary={{
          label: 'Retirer la couleur',
          onClick: async () => {
            if (!colDialog || colDialog.type !== 'color') return
            await window.api.setCollectionColor(colDialog.id, null)
            setColDialog(null)
            await qc.invalidateQueries({ queryKey: ['collections'] })
            await qc.invalidateQueries({ queryKey: ['library'] })
          }
        }}
      >
        <label className="text-sm block">
          <div className="text-xs text-slate-500 dark:text-slate-300">Couleur</div>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="color"
              value={colDialog?.type === 'color' ? colDialog.color : '#06b6d4'}
              onChange={(e) => setColDialog((d) => (d && d.type === 'color' ? { ...d, color: e.target.value } : d))}
              autoFocus
            />
            <div className="text-sm">{colDialog?.type === 'color' ? colDialog.name : ''}</div>
          </div>
        </label>
      </Dialog>

      <Dialog
        open={colDialog?.type === 'delete'}
        title="Supprimer la collection ?"
        description={colDialog?.type === 'delete' ? `Supprimer "${colDialog.name}" ? Les PDFs ne seront pas supprimes.` : undefined}
        onClose={() => setColDialog(null)}
        primary={{
          label: 'Supprimer',
          onClick: async () => {
            if (!colDialog || colDialog.type !== 'delete') return
            await window.api.deleteCollection(colDialog.id)
            if (collectionId === colDialog.id) onCollectionId(null)
            setColDialog(null)
            notify({ kind: 'success', title: 'Collections', message: 'Collection supprimee.' })
            await qc.invalidateQueries({ queryKey: ['collections'] })
            await qc.invalidateQueries({ queryKey: ['library'] })
          }
        }}
      >
        <div className="text-sm text-slate-600 dark:text-slate-300">
          Cette action est reversible en recreant la collection, mais les associations seront perdues.
        </div>
      </Dialog>
    </div>
  )
}
