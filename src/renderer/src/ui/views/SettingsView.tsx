import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Dialog } from '../components/Dialog'

export function SettingsView() {
  const qc = useQueryClient()
  const cfgQ = useQuery({ queryKey: ['config'], queryFn: () => window.api.getConfig() })
  const collectionsQ = useQuery({ queryKey: ['collections'], queryFn: () => window.api.listCollections() })
  const cfg = cfgQ.data
  const cols = collectionsQ.data ?? []

  const [newWatch, setNewWatch] = useState('')
  const [colDialog, setColDialog] = useState<null | { type: 'rename' | 'delete'; id: string; name: string }> (null)
  const [renameValue, setRenameValue] = useState('')

  const watchFolders = useMemo(() => cfg?.library.watchFolders ?? [], [cfg])

  if (!cfg) return <div className="p-6">Chargement...</div>

  return (
    <div className="h-full overflow-auto p-4 sm:p-6 space-y-6">
      <div className="rounded-2xl bg-white dark:bg-app-darkCard border border-slate-200/60 dark:border-white/10 p-5">
        <div className="text-base font-semibold">Embeddings</div>
        <div className="mt-3 grid grid-cols-1 gap-3">
          <label className="text-sm">
            <div className="text-xs text-slate-500 dark:text-slate-300">Port Python</div>
            <input
              type="number"
              className="mt-1 w-full rounded-xl border border-slate-200/70 dark:border-white/10 bg-transparent px-3 py-2 text-sm"
              value={cfg.embeddings.pythonPort}
              onChange={(e) =>
                void window.api
                  .setConfig({ embeddings: { ...cfg.embeddings, pythonPort: Number(e.target.value) || cfg.embeddings.pythonPort } })
                  .then(() => qc.invalidateQueries({ queryKey: ['config'] }))
              }
            />
          </label>
          <label className="text-sm">
            <div className="text-xs text-slate-500 dark:text-slate-300">Modele</div>
            <input
              className="mt-1 w-full rounded-xl border border-slate-200/70 dark:border-white/10 bg-transparent px-3 py-2 text-sm"
              value={cfg.embeddings.model}
              onChange={(e) =>
                void window.api
                  .setConfig({ embeddings: { ...cfg.embeddings, model: e.target.value } })
                  .then(() => qc.invalidateQueries({ queryKey: ['config'] }))
              }
            />
            <div className="text-[11px] text-slate-500 dark:text-slate-300 mt-1">Changer le modele necessite une reindexation.</div>
          </label>
          <label className="text-sm">
            <div className="text-xs text-slate-500 dark:text-slate-300">Chemin du modele (optionnel)</div>
            <input
              className="mt-1 w-full rounded-xl border border-slate-200/70 dark:border-white/10 bg-transparent px-3 py-2 text-sm"
              placeholder="Ex: D:\\models\\all-MiniLM-L6-v2"
              value={cfg.embeddings.modelPath ?? ''}
              onChange={(e) =>
                void window.api
                  .setConfig({ embeddings: { ...cfg.embeddings, modelPath: e.target.value.trim() ? e.target.value.trim() : null } })
                  .then(() => qc.invalidateQueries({ queryKey: ['config'] }))
              }
            />
            <div className="text-[11px] text-slate-500 dark:text-slate-300 mt-1">Si renseigne, le service Python charge le modele depuis ce dossier.</div>
          </label>
        </div>
      </div>

      <div className="rounded-2xl bg-white dark:bg-app-darkCard border border-slate-200/60 dark:border-white/10 p-5">
        <div className="text-base font-semibold">Assistant (offline)</div>
        <div className="mt-3 grid grid-cols-1 gap-3">
          <label className="text-sm">
            <div className="text-xs text-slate-500 dark:text-slate-300">Fournisseur</div>
            <select
              className="mt-1 w-full rounded-xl border border-slate-200/70 dark:border-white/10 bg-transparent px-3 py-2 text-sm"
              value={cfg.assistant.provider}
              onChange={(e) => {
                const provider = e.target.value as 'extractive' | 'ollama'
                void window.api.setConfig({ assistant: { ...cfg.assistant, provider } }).then(() => qc.invalidateQueries({ queryKey: ['config'] }))
              }}
            >
              <option value="extractive">Extractif (par defaut)</option>
              <option value="ollama">Ollama (LLM local)</option>
            </select>
            <div className="text-[11px] text-slate-500 dark:text-slate-300 mt-1">
              Extractif = rapide et 100% sans dependance. Ollama = reponses plus intelligentes (necessite Ollama installe).
            </div>
          </label>

          {cfg.assistant.provider === 'ollama' && (
            <>
              <label className="text-sm">
                <div className="text-xs text-slate-500 dark:text-slate-300">Hote Ollama</div>
                <input
                  className="mt-1 w-full rounded-xl border border-slate-200/70 dark:border-white/10 bg-transparent px-3 py-2 text-sm"
                  value={cfg.assistant.ollamaHost}
                  onChange={(e) =>
                    void window.api
                      .setConfig({ assistant: { ...cfg.assistant, ollamaHost: e.target.value } })
                      .then(() => qc.invalidateQueries({ queryKey: ['config'] }))
                  }
                />
              </label>
              <label className="text-sm">
                <div className="text-xs text-slate-500 dark:text-slate-300">Modele Ollama</div>
                <input
                  className="mt-1 w-full rounded-xl border border-slate-200/70 dark:border-white/10 bg-transparent px-3 py-2 text-sm"
                  value={cfg.assistant.ollamaModel}
                  onChange={(e) =>
                    void window.api
                      .setConfig({ assistant: { ...cfg.assistant, ollamaModel: e.target.value } })
                      .then(() => qc.invalidateQueries({ queryKey: ['config'] }))
                  }
                />
                <div className="text-[11px] text-slate-500 dark:text-slate-300 mt-1">
                  Exemple: <span className="font-medium">llama3.2:3b-instruct</span>. Assurez-vous de l'avoir tire via <span className="font-medium">ollama pull</span>.
                </div>
              </label>
            </>
          )}

          <label className="text-sm text-slate-600 dark:text-slate-300 flex items-center gap-2">
            <input
              type="checkbox"
              checked={cfg.assistant.enableInSearch}
              onChange={async (e) => {
                await window.api.setConfig({ assistant: { ...cfg.assistant, enableInSearch: e.target.checked } })
                await qc.invalidateQueries({ queryKey: ['config'] })
              }}
            />
            Activer l'assistant dans la recherche
          </label>
        </div>
      </div>

      <div className="rounded-2xl bg-white dark:bg-app-darkCard border border-slate-200/60 dark:border-white/10 p-5">
        <div className="text-base font-semibold">Chunking</div>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="text-sm">
            <div className="text-xs text-slate-500 dark:text-slate-300">Taille cible (chars)</div>
            <input
              type="number"
              className="mt-1 w-full rounded-xl border border-slate-200/70 dark:border-white/10 bg-transparent px-3 py-2 text-sm"
              value={cfg.chunking.targetChars}
              onChange={(e) =>
                void window.api
                  .setConfig({ chunking: { ...cfg.chunking, targetChars: Number(e.target.value) || cfg.chunking.targetChars } })
                  .then(() => qc.invalidateQueries({ queryKey: ['config'] }))
              }
            />
          </label>
          <label className="text-sm">
            <div className="text-xs text-slate-500 dark:text-slate-300">Overlap (chars)</div>
            <input
              type="number"
              className="mt-1 w-full rounded-xl border border-slate-200/70 dark:border-white/10 bg-transparent px-3 py-2 text-sm"
              value={cfg.chunking.overlapChars}
              onChange={(e) =>
                void window.api
                  .setConfig({ chunking: { ...cfg.chunking, overlapChars: Number(e.target.value) || cfg.chunking.overlapChars } })
                  .then(() => qc.invalidateQueries({ queryKey: ['config'] }))
              }
            />
          </label>
        </div>
      </div>

      <div className="rounded-2xl bg-white dark:bg-app-darkCard border border-slate-200/60 dark:border-white/10 p-5">
        <div className="text-base font-semibold">Recherche</div>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="text-sm">
            <div className="text-xs text-slate-500 dark:text-slate-300">Top K</div>
            <input
              type="number"
              className="mt-1 w-full rounded-xl border border-slate-200/70 dark:border-white/10 bg-transparent px-3 py-2 text-sm"
              value={cfg.search.topK}
              onChange={(e) =>
                void window.api
                  .setConfig({ search: { ...cfg.search, topK: Math.max(1, Number(e.target.value) || cfg.search.topK) } })
                  .then(() => qc.invalidateQueries({ queryKey: ['config'] }))
              }
            />
          </label>
          <label className="text-sm">
            <div className="text-xs text-slate-500 dark:text-slate-300">Poids vecteur</div>
            <input
              type="number"
              step="0.05"
              className="mt-1 w-full rounded-xl border border-slate-200/70 dark:border-white/10 bg-transparent px-3 py-2 text-sm"
              value={cfg.search.weightVector}
              onChange={(e) =>
                void window.api
                  .setConfig({ search: { ...cfg.search, weightVector: Number(e.target.value) || cfg.search.weightVector } })
                  .then(() => qc.invalidateQueries({ queryKey: ['config'] }))
              }
            />
          </label>
          <label className="text-sm">
            <div className="text-xs text-slate-500 dark:text-slate-300">Poids mots-cles</div>
            <input
              type="number"
              step="0.05"
              className="mt-1 w-full rounded-xl border border-slate-200/70 dark:border-white/10 bg-transparent px-3 py-2 text-sm"
              value={cfg.search.weightKeyword}
              onChange={(e) =>
                void window.api
                  .setConfig({ search: { ...cfg.search, weightKeyword: Number(e.target.value) || cfg.search.weightKeyword } })
                  .then(() => qc.invalidateQueries({ queryKey: ['config'] }))
              }
            />
          </label>
        </div>
        <div className="text-[11px] text-slate-500 dark:text-slate-300 mt-2">
          Astuce: augmentez "Poids mots-cles" pour des resultats plus litteraux; augmentez "Poids vecteur" pour plus de semantique.
        </div>
      </div>

      <div className="rounded-2xl bg-white dark:bg-app-darkCard border border-slate-200/60 dark:border-white/10 p-5">
        <div className="text-base font-semibold">Logs</div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="text-sm text-slate-600 dark:text-slate-300">Niveau</div>
          <select
            className="rounded-xl border border-slate-200/70 dark:border-white/10 bg-transparent px-3 py-2 text-sm"
            value={cfg.logging.level}
            onChange={(e) => {
              const level = e.target.value as 'debug' | 'info' | 'warn' | 'error'
              void window.api.setConfig({ logging: { ...cfg.logging, level } }).then(() => qc.invalidateQueries({ queryKey: ['config'] }))
            }}
          >
            <option value="debug">debug</option>
            <option value="info">info</option>
            <option value="warn">warn</option>
            <option value="error">error</option>
          </select>
        </div>
      </div>

      <div className="rounded-2xl bg-white dark:bg-app-darkCard border border-slate-200/60 dark:border-white/10 p-5">
        <div className="text-base font-semibold">Bibliotheque</div>
        <div className="mt-3">
          <div className="text-xs text-slate-500 dark:text-slate-300">Dossiers surveilles</div>
          <div className="mt-2 space-y-2">
            {watchFolders.map((f) => (
              <div key={f} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/70 dark:border-white/10 px-3 py-2">
                <div className="text-sm truncate">{f}</div>
                <button
                  className="text-sm text-rose-700 dark:text-rose-200 hover:underline"
                  onClick={async () => {
                    const next = watchFolders.filter((x) => x !== f)
                    await window.api.setConfig({ library: { ...cfg.library, watchFolders: next } })
                    await qc.invalidateQueries({ queryKey: ['config'] })
                  }}
                >
                  Retirer
                </button>
              </div>
            ))}
            {watchFolders.length === 0 && <div className="text-sm text-slate-500 dark:text-slate-300">Aucun.</div>}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="rounded-xl border border-slate-200/70 dark:border-white/10 px-3 py-2 text-sm hover:bg-slate-100/70 dark:hover:bg-white/10 transition-colors"
              onClick={async () => {
                const p = await window.api.pickFolder()
                if (!p) return
                const next = Array.from(new Set([...watchFolders, p]))
                await window.api.setConfig({ library: { ...cfg.library, watchFolders: next } })
                await qc.invalidateQueries({ queryKey: ['config'] })
              }}
            >
              Ajouter dossier...
            </button>
            <button
              className="rounded-xl border border-slate-200/70 dark:border-white/10 px-3 py-2 text-sm hover:bg-slate-100/70 dark:hover:bg-white/10 transition-colors"
              onClick={async () => {
                const p = await window.api.pickFolder()
                if (!p) return
                const res = await window.api.scanFolder(p)
                for (const id of res.docIds) await window.api.queueIndexingDoc(id)
                await qc.invalidateQueries({ queryKey: ['library'] })
              }}
            >
              Scanner dossier...
            </button>
            <input
              placeholder="Ou coller un chemin..."
              value={newWatch}
              onChange={(e) => setNewWatch(e.target.value)}
              className="flex-1 min-w-[16rem] rounded-xl border border-slate-200/70 dark:border-white/10 bg-transparent px-3 py-2 text-sm"
            />
            <button
              className="rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-900 px-3 py-2 text-sm hover:opacity-95 transition-opacity"
              onClick={async () => {
                const p = newWatch.trim()
                if (!p) return
                const next = Array.from(new Set([...watchFolders, p]))
                await window.api.setConfig({ library: { ...cfg.library, watchFolders: next } })
                setNewWatch('')
                await qc.invalidateQueries({ queryKey: ['config'] })
              }}
            >
              Ajouter
            </button>
          </div>

          <label className="mt-3 text-sm text-slate-600 dark:text-slate-300 flex items-center gap-2">
            <input
              type="checkbox"
              checked={cfg.library.autoIndexNewFiles}
              onChange={async (e) => {
                await window.api.setConfig({ library: { ...cfg.library, autoIndexNewFiles: e.target.checked } })
                await qc.invalidateQueries({ queryKey: ['config'] })
              }}
            />
            Indexer automatiquement les nouveaux PDFs
          </label>
        </div>
      </div>

      <div className="rounded-2xl bg-white dark:bg-app-darkCard border border-slate-200/60 dark:border-white/10 p-5">
        <div className="text-base font-semibold">OCR (optionnel)</div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <label className="text-sm text-slate-600 dark:text-slate-300 flex items-center gap-2">
            <input
              type="checkbox"
              checked={cfg.ocr.enabled}
              onChange={async (e) => {
                await window.api.setConfig({ ocr: { ...cfg.ocr, enabled: e.target.checked } })
                await qc.invalidateQueries({ queryKey: ['config'] })
              }}
            />
            Activer OCR sur PDFs scannes
          </label>
          <input
            className="w-28 rounded-xl border border-slate-200/70 dark:border-white/10 bg-transparent px-3 py-2 text-sm"
            value={cfg.ocr.language}
            onChange={async (e) => {
              await window.api.setConfig({ ocr: { ...cfg.ocr, language: e.target.value } })
              await qc.invalidateQueries({ queryKey: ['config'] })
            }}
          />
        </div>
        <div className="text-[11px] text-slate-500 dark:text-slate-300 mt-2">
          OCR utilise Tesseract en local. Aucune donnee PDF n'est envoyee sur internet.
        </div>
      </div>

      <div className="rounded-2xl bg-white dark:bg-app-darkCard border border-slate-200/60 dark:border-white/10 p-5">
        <div className="text-base font-semibold">Collections</div>
        <div className="mt-3 space-y-2">
          {cols.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/70 dark:border-white/10 px-3 py-2">
              <div className="text-sm truncate">{c.name}</div>
              <div className="flex gap-2">
                <button
                  className="text-sm text-slate-600 dark:text-slate-300 hover:underline"
                  onClick={() => {
                    setRenameValue(c.name)
                    setColDialog({ type: 'rename', id: c.id, name: c.name })
                  }}
                >
                  Renommer
                </button>
                <button
                  className="text-sm text-rose-700 dark:text-rose-200 hover:underline"
                  onClick={() => setColDialog({ type: 'delete', id: c.id, name: c.name })}
                >
                  Supprimer
                </button>
              </div>
            </div>
          ))}
          {cols.length === 0 && <div className="text-sm text-slate-500 dark:text-slate-300">Aucune.</div>}
        </div>
      </div>

      <Dialog
        open={colDialog?.type === 'rename'}
        title="Renommer la collection"
        onClose={() => setColDialog(null)}
        primary={{
          label: 'Enregistrer',
          disabled: !renameValue.trim(),
          onClick: async () => {
            if (!colDialog || colDialog.type !== 'rename') return
            await window.api.renameCollection(colDialog.id, renameValue.trim())
            setColDialog(null)
            setRenameValue('')
            await qc.invalidateQueries({ queryKey: ['collections'] })
            await qc.invalidateQueries({ queryKey: ['library'] })
          }
        }}
      >
        <label className="text-sm block">
          <div className="text-xs text-slate-500 dark:text-slate-300">Nom</div>
          <input
            className="mt-1 w-full rounded-xl border border-slate-200/70 dark:border-white/10 bg-transparent px-3 py-2 text-sm"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            autoFocus
          />
        </label>
      </Dialog>

      <Dialog
        open={colDialog?.type === 'delete'}
        title="Supprimer la collection ?"
        description={colDialog?.type === 'delete' ? `Supprimer "${colDialog.name}" ?` : undefined}
        onClose={() => setColDialog(null)}
        primary={{
          label: 'Supprimer',
          onClick: async () => {
            if (!colDialog || colDialog.type !== 'delete') return
            await window.api.deleteCollection(colDialog.id)
            setColDialog(null)
            await qc.invalidateQueries({ queryKey: ['collections'] })
            await qc.invalidateQueries({ queryKey: ['library'] })
          }
        }}
      >
        <div className="text-sm text-slate-600 dark:text-slate-300">Les liens entre documents et cette collection seront retires.</div>
      </Dialog>
    </div>
  )
}
