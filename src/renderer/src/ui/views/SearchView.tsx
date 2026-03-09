import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PdfDocument, SearchAnswerBullet, SearchResult } from '@shared/models'
import type { AssistantAnswerResponse } from '@shared/ipc'
import clsx from 'clsx'
import { useToasts } from '../components/Toasts'

function tokensFromNeedle(needle: string) {
  return Array.from(
    new Set(
      needle
        .trim()
        .slice(0, 240)
        .split(/\s+/g)
        .map((t) => t.trim())
        .filter((t) => t.length >= 3)
    )
  ).slice(0, 10)
}

function HighlightedText(props: { text: string; needle: string }) {
  const tokens = tokensFromNeedle(props.needle)
  const raw = props.text ?? ''
  if (!tokens.length || !raw) return <>{raw}</>

  const sorted = [...tokens].sort((a, b) => b.length - a.length)
  const re = new RegExp(`(${sorted.map((t) => t.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')).join('|')})`, 'ig')
  const parts = raw.split(re)
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="bg-yellow-200/80 dark:bg-yellow-400/30 rounded px-0.5">
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  )
}

export function SearchView(props: {
  onOpenResult: (doc: PdfDocument, result: SearchResult, query: string, items?: SearchResult[], index?: number) => void
  collectionId: string | null
}) {
  const qc = useQueryClient()
  const { notify } = useToasts()
  const lib = useQuery({ queryKey: ['library'], queryFn: () => window.api.listLibrary() })
  const cfgQ = useQuery({ queryKey: ['config'], queryFn: () => window.api.getConfig() })
  const history = useQuery({ queryKey: ['history'], queryFn: () => window.api.listHistory() })
  const favorites = useQuery({ queryKey: ['favorites'], queryFn: () => window.api.listFavorites() })
  const tagsQ = useQuery({ queryKey: ['tags'], queryFn: () => window.api.listTags() })

  const docs = useMemo(() => lib.data ?? [], [lib.data])
  const cfg = cfgQ.data
  const historyItems = history.data ?? []
  const favoriteSet = useMemo(() => new Set((favorites.data ?? []).map((f) => f.chunkId)), [favorites.data])
  const allTags = tagsQ.data ?? []

  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<SearchResult[]>([])
  const [answerBullets, setAnswerBullets] = useState<SearchAnswerBullet[]>([])
  const [assistant, setAssistant] = useState<AssistantAnswerResponse | null>(null)
  const [assistantLoading, setAssistantLoading] = useState(false)
  const [onlyIndexed, setOnlyIndexed] = useState(true)
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([])
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement | null>(null)

  const docsById = useMemo(() => new Map(docs.map((d) => [d.id, d])), [docs])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toLowerCase().includes('mac')
      if ((isMac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const runSearch = async (override?: string) => {
    const q = (override ?? query).trim()
    if (!q) return
    setSearching(true)
    setAssistant(null)
    try {
      const docIds = selectedDocIds.length ? selectedDocIds : undefined
      const res = await window.api.search(q, docIds, props.collectionId ?? undefined, selectedTags.length ? selectedTags : undefined)
      setResults(res.results)
      setAnswerBullets(res.answerBullets)
      await qc.invalidateQueries({ queryKey: ['library'] })
      await qc.invalidateQueries({ queryKey: ['history'] })
      await qc.invalidateQueries({ queryKey: ['favorites'] })
      if (res.results.length === 0) {
        notify({ kind: 'info', title: 'Aucun resultat', message: 'Essayez des mots-cles plus precis ou reindexez la bibliotheque.' })
      }
    } catch (err) {
      notify({ kind: 'error', title: 'Recherche impossible', message: err instanceof Error ? err.message : String(err) })
    } finally {
      setSearching(false)
    }
  }

  const runAssistant = async () => {
    const q = query.trim()
    if (!q) return
    setAssistantLoading(true)
    try {
      const docIds = selectedDocIds.length ? selectedDocIds : undefined
      const res = await window.api.assistantAnswer(q, docIds, props.collectionId ?? undefined, selectedTags.length ? selectedTags : undefined)
      setAssistant(res)
    } catch (err) {
      notify({ kind: 'error', title: 'Assistant', message: err instanceof Error ? err.message : String(err) })
    } finally {
      setAssistantLoading(false)
    }
  }

  const docsInCollection =
    props.collectionId == null
      ? docs
      : docs.filter((d) => (d.collections ?? []).some((c) => c.id === props.collectionId))

  const visibleDocs = onlyIndexed ? docsInCollection.filter((d) => d.indexingStatus === 'indexed') : docsInCollection
  const indexedCount = docsInCollection.filter((d) => d.indexingStatus === 'indexed').length

  return (
    <div
      className="h-full flex flex-col min-h-0"
      onDragOver={(e) => e.preventDefault()}
      onDrop={async (e) => {
        e.preventDefault()
        const paths = Array.from(e.dataTransfer.files)
          .map((f) => (f as unknown as { path?: string }).path ?? '')
          .filter(Boolean)
        const res = await window.api.importPdfFiles(paths)
        for (const id of res.docIds) await window.api.queueIndexingDoc(id)
        await qc.invalidateQueries({ queryKey: ['library'] })
      }}
    >
      <div className="p-4 sm:p-6">
        <div className="rounded-2xl bg-white dark:bg-app-darkCard border border-slate-200/60 dark:border-white/10 px-4 py-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void runSearch()
              }}
              ref={inputRef}
              placeholder="Posez une question... (ex: Explique la TVA)"
              className="flex-1 bg-transparent outline-none text-base"
              aria-label="Question de recherche"
            />
            <div className="flex items-center gap-2">
              {query.trim() && (
                <button
                  onClick={() => {
                    setQuery('')
                    setResults([])
                    setAnswerBullets([])
                    inputRef.current?.focus()
                  }}
                  className="rounded-xl border border-slate-200/70 dark:border-white/10 px-3 py-2 text-sm hover:bg-slate-100/70 dark:hover:bg-white/10 transition-colors"
                  title="Effacer"
                >
                  Effacer
                </button>
              )}
              <button
                onClick={() => void runSearch()}
                className={clsx(
                  'rounded-xl px-4 py-2.5 text-sm font-medium transition-colors',
                  searching
                    ? 'bg-slate-200 text-slate-600 dark:bg-white/10 dark:text-slate-200'
                    : 'bg-gradient-to-r from-cyan-500 to-emerald-500 text-white hover:opacity-95'
                )}
                disabled={searching}
              >
                {searching ? 'Recherche...' : 'Rechercher'}
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-start gap-3">
            <div className="text-[11px] text-slate-500 dark:text-slate-300 mr-auto">
              Astuce: <span className="font-medium">Ctrl/Cmd + K</span> pour focus la recherche.
            </div>

            <label className="text-xs text-slate-600 dark:text-slate-300 flex items-center gap-2">
              <input type="checkbox" checked={onlyIndexed} onChange={(e) => setOnlyIndexed(e.target.checked)} />
              Documents indexes uniquement
            </label>

            <details className="text-xs">
              <summary className="cursor-pointer text-slate-600 dark:text-slate-300 select-none">Tags ({selectedTags.length || 'tous'})</summary>
              <div className="mt-2 rounded-xl border border-slate-200/60 dark:border-white/10 bg-white dark:bg-black/20 p-2 max-h-60 overflow-auto w-[min(92vw,22rem)]">
                <div className="flex items-center justify-end px-2 py-1">
                  <button
                    className="text-xs text-slate-600 dark:text-slate-300"
                    onClick={(e) => {
                      e.preventDefault()
                      setSelectedTags([])
                    }}
                  >
                    Effacer
                  </button>
                </div>
                <div className="mt-1 space-y-1">
                  {allTags.map((t) => (
                    <label key={t} className="flex items-center gap-2 px-2 py-1 hover:bg-slate-50 dark:hover:bg-white/5 rounded-lg">
                      <input
                        type="checkbox"
                        checked={selectedTags.includes(t)}
                        onChange={(e) => {
                          const next = new Set(selectedTags)
                          if (e.target.checked) next.add(t)
                          else next.delete(t)
                          setSelectedTags(Array.from(next))
                        }}
                      />
                      <span className="truncate">{t}</span>
                    </label>
                  ))}
                  {allTags.length === 0 && <div className="px-2 py-2 text-xs text-slate-500 dark:text-slate-300">Aucun tag.</div>}
                </div>
              </div>
            </details>

            <details className="text-xs">
              <summary className="cursor-pointer text-slate-600 dark:text-slate-300 select-none">
                Filtre documents ({selectedDocIds.length || 'tous'})
              </summary>
              <div className="mt-2 rounded-xl border border-slate-200/60 dark:border-white/10 bg-white dark:bg-black/20 p-2 max-h-60 overflow-auto w-[min(92vw,32rem)]">
                <div className="flex items-center justify-between px-2 py-1 gap-3">
                  <button
                    className="text-xs text-cyan-700 dark:text-cyan-200"
                    onClick={(e) => {
                      e.preventDefault()
                      setSelectedDocIds(visibleDocs.map((d) => d.id))
                    }}
                  >
                    Tout selectionner
                  </button>
                  <button
                    className="text-xs text-slate-600 dark:text-slate-300"
                    onClick={(e) => {
                      e.preventDefault()
                      setSelectedDocIds([])
                    }}
                  >
                    Effacer
                  </button>
                </div>
                <div className="mt-1">
                  {visibleDocs.map((d) => (
                    <label key={d.id} className="flex items-center gap-2 px-2 py-1 hover:bg-slate-50 dark:hover:bg-white/5 rounded-lg">
                      <input
                        type="checkbox"
                        checked={selectedDocIds.includes(d.id)}
                        onChange={(e) => {
                          const next = new Set(selectedDocIds)
                          if (e.target.checked) next.add(d.id)
                          else next.delete(d.id)
                          setSelectedDocIds(Array.from(next))
                        }}
                      />
                      <span className="truncate">{d.fileName}</span>
                    </label>
                  ))}
                  {visibleDocs.length === 0 && <div className="px-2 py-2 text-xs text-slate-500 dark:text-slate-300">Aucun document indexe.</div>}
                </div>
              </div>
            </details>
          </div>

          {historyItems.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-2">
                {historyItems.slice(0, 8).map((h) => (
                  <button
                    key={h.id}
                    onClick={() => {
                      setQuery(h.query)
                      void runSearch(h.query)
                    }}
                    className="text-[11px] px-2 py-1 rounded-lg border border-slate-200/70 dark:border-white/10 text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-white/5 hover:bg-slate-100/70 dark:hover:bg-white/10 transition-colors"
                  >
                    {h.query}
                  </button>
                ))}
              </div>
              <button
                onClick={async () => {
                  await window.api.clearHistory()
                  await qc.invalidateQueries({ queryKey: ['history'] })
                }}
                className="text-xs text-slate-600 dark:text-slate-300 hover:underline"
              >
                Effacer historique
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-4 sm:px-6 pb-6">
        {results.length === 0 ? (
          <div className="text-sm text-slate-500 dark:text-slate-300 mt-10 text-center">
            {docsInCollection.length === 0 ? (
              'Importez des PDFs, laissez indexer, puis recherchez.'
            ) : onlyIndexed && indexedCount === 0 ? (
              <div className="space-y-3">
                <div>Aucun document indexe pour le moment.</div>
                <button
                  onClick={async () => {
                    await window.api.queueIndexingAll()
                    notify({ kind: 'info', title: 'Indexation', message: 'Indexation demarree.' })
                    await qc.invalidateQueries({ queryKey: ['library'] })
                  }}
                  className="rounded-xl bg-slate-900 text-white dark:bg-white dark:text-slate-900 px-4 py-2 text-sm hover:opacity-95 transition-opacity"
                >
                  Indexer maintenant
                </button>
              </div>
            ) : (
              'Lancez une recherche pour afficher des resultats.'
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {cfg?.assistant?.enableInSearch && (
              <div className="rounded-2xl border border-slate-200/60 dark:border-white/10 bg-white dark:bg-app-darkCard p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">Assistant (offline)</div>
                    <div className="text-xs text-slate-500 dark:text-slate-300 mt-1">
                      Reponse synthetique avec citations. Optionnel: LLM local via Ollama.
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={clsx(
                        'text-[11px] px-2 py-1 rounded-lg border',
                        (assistant?.provider ?? cfg.assistant.provider) === 'ollama'
                          ? 'border-emerald-300/60 bg-emerald-50 text-emerald-900 dark:bg-emerald-400/10 dark:text-emerald-200 dark:border-emerald-400/20'
                          : 'border-slate-200/70 bg-slate-50 text-slate-700 dark:bg-white/5 dark:text-slate-200 dark:border-white/10'
                      )}
                      title={assistant?.model ?? undefined}
                    >
                      {(assistant?.provider ?? cfg.assistant.provider) === 'ollama' ? 'LLM local (Ollama)' : 'Extractif'}
                    </span>
                    <button
                      onClick={() => void runAssistant()}
                      disabled={assistantLoading || searching}
                      className="rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 text-white px-3 py-2 text-sm hover:opacity-95 transition-opacity disabled:opacity-50"
                    >
                      {assistantLoading ? 'Generation...' : assistant ? 'Regenerer' : 'Generer'}
                    </button>
                  </div>
                </div>

                {assistant?.keywords?.length ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {assistant.keywords.slice(0, 10).map((k) => (
                      <span
                        key={k}
                        className="text-[11px] px-2 py-0.5 rounded-full border border-cyan-200/70 dark:border-cyan-400/20 text-cyan-800 dark:text-cyan-200 bg-cyan-50 dark:bg-cyan-400/10"
                      >
                        {k}
                      </span>
                    ))}
                  </div>
                ) : null}

                {assistant && (
                  <div className="mt-3 space-y-2">
                    {assistant.bullets.map((b, i) => (
                      <div key={i} className="rounded-xl border border-slate-200/70 dark:border-white/10 bg-white dark:bg-black/20 px-3 py-2">
                        <div className="text-sm text-slate-800 dark:text-slate-100 leading-relaxed">{b.text}</div>
                        {b.citations.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {b.citations.slice(0, 4).map((c) => (
                              <button
                                key={`${c.chunkId}:${c.sourceId}`}
                                className="text-[11px] px-2 py-0.5 rounded-full border border-slate-200/70 dark:border-white/10 text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-white/5 hover:bg-slate-100/70 dark:hover:bg-white/10 transition-colors"
                                title={c.docName}
                                onClick={() => {
                                  const doc = docsById.get(c.docId)
                                  if (!doc) return
                                  const asResult: SearchResult = {
                                    chunkId: c.chunkId,
                                    docId: c.docId,
                                    docName: c.docName,
                                    pageStart: c.pageStart,
                                    pageEnd: c.pageEnd,
                                    score: 1,
                                    scoreVector: null,
                                    scoreKeyword: null,
                                    excerpt: ''
                                  }
                                  props.onOpenResult(doc, asResult, query)
                                }}
                              >
                                {c.docName.length > 22 ? `${c.docName.slice(0, 22)}...` : c.docName} | p.{c.pageStart}
                                {c.pageEnd !== c.pageStart ? `-${c.pageEnd}` : ''}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {!assistant && (
                  <div className="mt-3 text-sm text-slate-500 dark:text-slate-300">
                    Cliquez sur <span className="font-medium">Generer</span> pour obtenir une reponse synthetique.
                  </div>
                )}
              </div>
            )}

            {answerBullets.length > 0 && (
              <div className="rounded-2xl border border-slate-200/60 dark:border-white/10 bg-white dark:bg-app-darkCard p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">Reponse (extraction offline)</div>
                    <div className="text-xs text-slate-500 dark:text-slate-300 mt-1">
                      Synthese extractive basee sur les meilleurs passages, avec citations cliquables.
                    </div>
                  </div>
                  <span className="text-[11px] px-2 py-1 rounded-lg border border-cyan-200/70 dark:border-cyan-400/20 text-cyan-800 dark:text-cyan-200 bg-cyan-50 dark:bg-cyan-400/10">
                    beta
                  </span>
                </div>
                <div className="mt-3 space-y-2">
                  {answerBullets.map((b) => (
                    <button
                      key={`${b.chunkId}:${b.text.slice(0, 24)}`}
                      className="w-full text-left rounded-xl border border-slate-200/70 dark:border-white/10 px-3 py-2 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
                      onClick={() => {
                        const doc = docsById.get(b.docId)
                        if (!doc) return
                        const asResult: SearchResult = {
                          chunkId: b.chunkId,
                          docId: b.docId,
                          docName: b.docName,
                          pageStart: b.pageStart,
                          pageEnd: b.pageEnd,
                          score: b.score,
                          scoreVector: null,
                          scoreKeyword: null,
                          excerpt: b.text
                        }
                        props.onOpenResult(doc, asResult, query, results, 0)
                      }}
                    >
                      <div className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                        <HighlightedText text={b.text} needle={query} />
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-300">
                        {b.docName} | p.{b.pageStart}
                        {b.pageEnd !== b.pageStart ? `-${b.pageEnd}` : ''}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-slate-500 dark:text-slate-300">{results.length} resultat(s)</div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={async () => {
                    const saved = await window.api.exportResults('md', query, results)
                    if (saved) notify({ kind: 'success', title: 'Export Markdown', message: `Enregistre: ${saved}` })
                  }}
                  className="rounded-xl border border-slate-200/70 dark:border-white/10 px-3 py-2 text-sm hover:bg-slate-100/70 dark:hover:bg-white/10 transition-colors"
                >
                  Export MD
                </button>
                <button
                  onClick={async () => {
                    const saved = await window.api.exportResults('csv', query, results)
                    if (saved) notify({ kind: 'success', title: 'Export CSV', message: `Enregistre: ${saved}` })
                  }}
                  className="rounded-xl border border-slate-200/70 dark:border-white/10 px-3 py-2 text-sm hover:bg-slate-100/70 dark:hover:bg-white/10 transition-colors"
                >
                  Export CSV
                </button>
                <button
                  onClick={async () => {
                    const saved = await window.api.exportResults('json', query, results)
                    if (saved) notify({ kind: 'success', title: 'Export JSON', message: `Enregistre: ${saved}` })
                  }}
                  className="rounded-xl border border-slate-200/70 dark:border-white/10 px-3 py-2 text-sm hover:bg-slate-100/70 dark:hover:bg-white/10 transition-colors"
                >
                  Export JSON
                </button>
              </div>
            </div>

            {results.map((r, idx) => {
              const doc = docsById.get(r.docId)
              return (
                <button
                  key={r.chunkId}
                  onClick={() => doc && props.onOpenResult(doc, r, query, results, idx)}
                  className="w-full text-left rounded-2xl border border-slate-200/60 dark:border-white/10 bg-white dark:bg-app-darkCard p-4 hover:shadow-sm transition-shadow"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="font-semibold truncate max-w-full">{r.docName}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-300">
                      p.{r.pageStart}
                      {r.pageEnd !== r.pageStart ? `-${r.pageEnd}` : ''} | score {r.score.toFixed(3)}
                    </div>
                  </div>
                  <div className="text-sm text-slate-700 dark:text-slate-200 mt-2 line-clamp-3">
                    <HighlightedText text={r.excerpt} needle={query} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 items-center">
                    {r.scoreVector != null && (
                      <span className="text-[11px] px-2 py-1 rounded-lg border border-cyan-200/70 dark:border-cyan-400/20 text-cyan-800 dark:text-cyan-200 bg-cyan-50 dark:bg-cyan-400/10">
                        vect {r.scoreVector.toFixed(3)}
                      </span>
                    )}
                    {r.scoreKeyword != null && (
                      <span className="text-[11px] px-2 py-1 rounded-lg border border-slate-200/80 dark:border-white/10 text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-white/5">
                        kw {r.scoreKeyword.toFixed(3)}
                      </span>
                    )}
                    <button
                      onClick={async (e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        if (favoriteSet.has(r.chunkId)) await window.api.removeFavorite(r.chunkId)
                        else await window.api.addFavorite(r.chunkId)
                        await qc.invalidateQueries({ queryKey: ['favorites'] })
                      }}
                      className={clsx(
                        'ml-auto text-[11px] px-2 py-1 rounded-lg border transition-colors',
                        favoriteSet.has(r.chunkId)
                          ? 'border-amber-300/70 bg-amber-50 text-amber-900 dark:bg-amber-400/10 dark:text-amber-200 dark:border-amber-400/20'
                          : 'border-slate-200/80 bg-slate-50 text-slate-700 dark:bg-white/5 dark:text-slate-200 dark:border-white/10'
                      )}
                      aria-label={favoriteSet.has(r.chunkId) ? 'Retirer des favoris' : 'Ajouter aux favoris'}
                    >
                      {favoriteSet.has(r.chunkId) ? 'Favori' : 'Ajouter favori'}
                    </button>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
