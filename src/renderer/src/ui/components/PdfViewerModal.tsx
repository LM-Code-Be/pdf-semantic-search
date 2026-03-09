import { useEffect, useMemo, useState } from 'react'
import type { PdfDocument } from '@shared/models'
import type { AssistantAnswerResponse } from '@shared/ipc'
import clsx from 'clsx'
import { Document, Page, pdfjs } from 'react-pdf'
import { useToasts } from './Toasts'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'react-pdf/node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

function escapeHtml(s: string) {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function tokensFromNeedle(needle: string) {
  return Array.from(
    new Set(
      needle
        .trim()
        .slice(0, 200)
        .split(/\s+/g)
        .map((t) => t.trim())
        .filter((t) => t.length >= 3)
    )
  ).slice(0, 10)
}

function highlightHtml(content: string, needle: string) {
  const tokens = tokensFromNeedle(needle)
  if (!tokens.length) return escapeHtml(content)
  let out = escapeHtml(content)
  for (const t of tokens) {
    const re = new RegExp(`(${t.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')})`, 'ig')
    out = out.replace(re, '<mark class="bg-yellow-200/80 dark:bg-yellow-400/30">$1</mark>')
  }
  return out
}

export function PdfViewerModal(props: {
  open: boolean
  onClose: () => void
  doc: PdfDocument | null
  initialPage: number
  highlightText: string
  highlightNeedle: string
  contextBefore: string
  contextAfter: string
  onOpenChunk: (chunkId: number, needle?: string) => void
  canPrev: boolean
  canNext: boolean
  onPrev: () => void
  onNext: () => void
}) {
  const { open, onClose, onPrev, onNext, highlightNeedle } = props
  const { notify } = useToasts()
  const [page, setPage] = useState(1)
  const [numPages, setNumPages] = useState<number | null>(null)
  const [outline, setOutline] = useState<any[]>([])
  const [rightTab, setRightTab] = useState<'excerpt' | 'outline' | 'assistant'>('excerpt')
  const [pdfDoc, setPdfDoc] = useState<any | null>(null)
  const [pageWidth, setPageWidth] = useState(860)
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [pageInput, setPageInput] = useState('1')
  const [assistantQuestion, setAssistantQuestion] = useState('De quoi parle ce document ?')
  const [assistant, setAssistant] = useState<AssistantAnswerResponse | null>(null)
  const [assistantLoading, setAssistantLoading] = useState(false)
  const [assistantError, setAssistantError] = useState<string | null>(null)
  const [compactLayout, setCompactLayout] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setPage(Math.max(1, props.initialPage))
      setPageInput(String(Math.max(1, props.initialPage)))
      setLoadError(null)
    }
  }, [open, props.initialPage])

  useEffect(() => {
    if (!open) return
    setAssistant(null)
    setAssistantError(null)
    setAssistantLoading(false)
    setAssistantQuestion('De quoi parle ce document ?')
    setZoom(1)
    setRotation(0)
    setPdfDoc(null)
    setOutline([])
    setLoadError(null)
  }, [open, props.doc?.id])

  useEffect(() => {
    setPageInput(String(page))
  }, [page])

  useEffect(() => {
    if (!open) return
    const onResize = () => {
      const compact = window.innerWidth < 1280
      setCompactLayout(compact)
      const reservedPanel = detailsOpen && !compact ? 440 : 40
      const horizontalPadding = window.innerWidth < 640 ? 32 : 76
      const width = window.innerWidth - reservedPanel - horizontalPadding
      setPageWidth(Math.min(980, Math.max(compact ? 260 : 380, width)))
    }
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [open, detailsOpen])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') setPage((p) => Math.max(1, p - 1))
      if (e.key === 'ArrowRight') setPage((p) => (numPages ? Math.min(numPages, p + 1) : p + 1))
      if (e.altKey && e.key === 'ArrowUp') onPrev()
      if (e.altKey && e.key === 'ArrowDown') onNext()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, onPrev, onNext, numPages])

  const url = useMemo(() => {
    if (!props.doc) return null
    return `pdfdoc://doc/${encodeURIComponent(props.doc.id)}/file.pdf`
  }, [props.doc])

  const runAssistant = async (override?: string) => {
    if (!props.doc) return
    const q = (override ?? assistantQuestion).trim() || 'De quoi parle ce document ?'
    setAssistantQuestion(q)
    setAssistantLoading(true)
    setAssistantError(null)
    try {
      const res = await window.api.assistantDocAnswer(props.doc.id, q)
      setAssistant(res)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setAssistantError(msg)
      notify({ kind: 'error', title: 'Assistant', message: msg })
    } finally {
      setAssistantLoading(false)
    }
  }

  if (!open) return null

  const panelVisible = detailsOpen || compactLayout

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/45" onClick={props.onClose} />
      <div className="absolute inset-2 sm:inset-4 lg:inset-6 rounded-2xl bg-white dark:bg-app-darkCard border border-slate-200/60 dark:border-white/10 overflow-hidden flex flex-col xl:flex-row">
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="px-3 sm:px-4 py-3 border-b border-slate-200/60 dark:border-white/10 flex flex-wrap items-center gap-2">
            <div className="font-semibold truncate max-w-full">{props.doc?.fileName ?? 'PDF'}</div>
            <div className="text-xs text-slate-500 dark:text-slate-300 hidden xl:block">Page: gauche/droite | Resultats: Alt+haut/Alt+bas | Fermer: Esc</div>

            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                className="rounded-lg border border-slate-200/70 dark:border-white/10 px-2 py-1 text-sm hover:bg-slate-100/70 dark:hover:bg-white/10 transition-colors disabled:opacity-50"
                onClick={props.onPrev}
                disabled={!props.canPrev}
                title="Resultat precedent"
                aria-label="Resultat precedent"
              >
                Prev
              </button>
              <button
                type="button"
                className="rounded-lg border border-slate-200/70 dark:border-white/10 px-2 py-1 text-sm hover:bg-slate-100/70 dark:hover:bg-white/10 transition-colors disabled:opacity-50"
                onClick={props.onNext}
                disabled={!props.canNext}
                title="Resultat suivant"
                aria-label="Resultat suivant"
              >
                Next
              </button>
              <button
                type="button"
                className="rounded-lg border border-slate-200/70 dark:border-white/10 px-2 py-1 text-sm hover:bg-slate-100/70 dark:hover:bg-white/10 transition-colors"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                aria-label="Page precedente"
              >
                {'<'}
              </button>
              <div className="text-xs text-slate-500 dark:text-slate-300">
                {page}/{numPages ?? '...'}
              </div>
              <button
                type="button"
                className="rounded-lg border border-slate-200/70 dark:border-white/10 px-2 py-1 text-sm hover:bg-slate-100/70 dark:hover:bg-white/10 transition-colors"
                onClick={() => setPage((p) => (numPages ? Math.min(numPages, p + 1) : p + 1))}
                aria-label="Page suivante"
              >
                {'>'}
              </button>
              <input
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value.replace(/[^\d]/g, ''))}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  const next = Number(pageInput)
                  if (!Number.isFinite(next) || next <= 0) return
                  setPage(numPages ? Math.min(numPages, next) : next)
                }}
                className="w-16 rounded-lg border border-slate-200/70 dark:border-white/10 bg-transparent px-2 py-1 text-xs text-center"
                aria-label="Aller a la page"
              />
              <button
                type="button"
                className="rounded-lg border border-slate-200/70 dark:border-white/10 px-2 py-1 text-sm hover:bg-slate-100/70 dark:hover:bg-white/10 transition-colors"
                onClick={() => setZoom((z) => Math.max(0.6, Number((z - 0.1).toFixed(2))))}
                aria-label="Zoom arriere"
              >
                -
              </button>
              <div className="text-xs text-slate-500 dark:text-slate-300">{Math.round(zoom * 100)}%</div>
              <button
                type="button"
                className="rounded-lg border border-slate-200/70 dark:border-white/10 px-2 py-1 text-sm hover:bg-slate-100/70 dark:hover:bg-white/10 transition-colors"
                onClick={() => setZoom((z) => Math.min(2.4, Number((z + 0.1).toFixed(2))))}
                aria-label="Zoom avant"
              >
                +
              </button>
              <button
                type="button"
                className="rounded-lg border border-slate-200/70 dark:border-white/10 px-2 py-1 text-sm hover:bg-slate-100/70 dark:hover:bg-white/10 transition-colors"
                onClick={() => {
                  setZoom(1)
                  setRotation(0)
                }}
              >
                Reset
              </button>
              <button
                type="button"
                className="rounded-lg border border-slate-200/70 dark:border-white/10 px-2 py-1 text-sm hover:bg-slate-100/70 dark:hover:bg-white/10 transition-colors"
                onClick={() => setRotation((r) => (r + 90) % 360)}
              >
                Rotation
              </button>
              {!compactLayout && (
                <button
                  type="button"
                  className="rounded-lg border border-slate-200/70 dark:border-white/10 px-3 py-1.5 text-sm hover:bg-slate-100/70 dark:hover:bg-white/10 transition-colors"
                  onClick={() => setDetailsOpen((x) => !x)}
                >
                  {detailsOpen ? 'Masquer details' : 'Afficher details'}
                </button>
              )}
              <button
                type="button"
                className="rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900 px-3 py-1.5 text-sm hover:opacity-95 transition-opacity"
                onClick={props.onClose}
              >
                Fermer
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-auto p-3 sm:p-4 flex justify-center">
            {loadError ? (
              <div className="max-w-xl rounded-2xl border border-rose-200/70 dark:border-rose-400/20 bg-rose-50 dark:bg-rose-400/10 p-4 text-sm text-rose-800 dark:text-rose-100">
                <div className="font-semibold">Ouverture du PDF impossible</div>
                <div className="mt-2">{loadError}</div>
              </div>
            ) : (
              url && (
              <Document
                file={url}
                onPassword={(callback) => {
                  const value = window.prompt('Ce PDF est protege. Entrez le mot de passe pour l’ouvrir.')
                  if (value == null) {
                    setLoadError('Ouverture annulee: mot de passe requis.')
                    return
                  }
                  callback(value)
                }}
                onLoadSuccess={async (pdf) => {
                  setLoadError(null)
                  setNumPages(pdf.numPages)
                  setPdfDoc(pdf)
                  if (page > pdf.numPages) setPage(pdf.numPages)
                  try {
                    const ol = await pdf.getOutline()
                    setOutline(Array.isArray(ol) ? ol : [])
                  } catch {
                    setOutline([])
                  }
                }}
                onLoadError={(err) => {
                  const msg = err instanceof Error ? err.message : String(err)
                  setLoadError(msg)
                  notify({ kind: 'error', title: 'PDF', message: msg })
                }}
                onSourceError={(err) => {
                  const msg = err instanceof Error ? err.message : String(err)
                  setLoadError(msg)
                }}
                loading={<div>Chargement...</div>}
              >
                <Page
                  pageNumber={page}
                  width={Math.round(pageWidth * zoom)}
                  rotate={rotation}
                  renderTextLayer
                  renderAnnotationLayer={false}
                  customTextRenderer={({ str }) => highlightHtml(str, highlightNeedle)}
                  loading={<div>Page...</div>}
                />
              </Document>
              )
            )}
          </div>
        </div>

        {panelVisible && (
          <div
            className={clsx(
              'border-slate-200/60 dark:border-white/10 p-4 overflow-auto',
              compactLayout
                ? 'w-full border-t max-h-[36%] min-h-[14rem]'
                : 'w-[420px] shrink-0 border-l'
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">Details</div>
              <div className="flex gap-2">
                <button
                  onClick={() => setRightTab('excerpt')}
                  className={clsx(
                    'text-xs px-2 py-1 rounded-lg border transition-colors',
                    rightTab === 'excerpt'
                      ? 'border-slate-900 bg-slate-900 text-white dark:bg-white dark:text-slate-900 dark:border-white'
                      : 'border-slate-200/70 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5'
                  )}
                >
                  Extrait
                </button>
                <button
                  onClick={() => setRightTab('outline')}
                  className={clsx(
                    'text-xs px-2 py-1 rounded-lg border transition-colors',
                    rightTab === 'outline'
                      ? 'border-slate-900 bg-slate-900 text-white dark:bg-white dark:text-slate-900 dark:border-white'
                      : 'border-slate-200/70 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5'
                  )}
                >
                  Plan
                </button>
                <button
                  onClick={() => setRightTab('assistant')}
                  className={clsx(
                    'text-xs px-2 py-1 rounded-lg border transition-colors',
                    rightTab === 'assistant'
                      ? 'border-slate-900 bg-slate-900 text-white dark:bg-white dark:text-slate-900 dark:border-white'
                      : 'border-slate-200/70 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5'
                  )}
                >
                  Assistant
                </button>
              </div>
            </div>

            {rightTab === 'excerpt' ? (
              <>
                <div className="mt-2 text-xs text-slate-500 dark:text-slate-300">Contexte</div>
                {props.contextBefore && <div className="mt-2 text-xs text-slate-500 dark:text-slate-300 line-clamp-4">{props.contextBefore}</div>}
                <div
                  className="mt-3 text-sm leading-relaxed text-slate-700 dark:text-slate-200"
                  dangerouslySetInnerHTML={{ __html: highlightHtml(props.highlightText || '', props.highlightNeedle || '') }}
                />
                {props.contextAfter && <div className="mt-3 text-xs text-slate-500 dark:text-slate-300 line-clamp-4">{props.contextAfter}</div>}
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={async () => {
                      const text = `${props.doc?.fileName ?? 'PDF'}, page ${page}\n\n${props.highlightText}`
                      await navigator.clipboard.writeText(text)
                      notify({ kind: 'success', title: 'Copie', message: 'Citation copiee dans le presse-papiers.' })
                    }}
                    className="rounded-xl border border-slate-200/70 dark:border-white/10 px-3 py-2 text-sm hover:bg-slate-100/70 dark:hover:bg-white/10 transition-colors"
                  >
                    Copier citation
                  </button>
                </div>
              </>
            ) : rightTab === 'outline' ? (
              <div className="mt-3 space-y-2">
                {outline.length === 0 ? (
                  <div className="text-sm text-slate-500 dark:text-slate-300">Aucun plan detecte.</div>
                ) : (
                  (function flatten(items: any[], depth = 0): any[] {
                    const out: any[] = []
                    for (const it of items) {
                      out.push({ it, depth })
                      if (it.items?.length) out.push(...flatten(it.items, depth + 1))
                    }
                    return out
                  })(outline).map(({ it, depth }, idx: number) => (
                    <button
                      key={idx}
                      className="w-full text-left rounded-xl border border-slate-200/70 dark:border-white/10 px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
                      onClick={async () => {
                        try {
                          if (!pdfDoc) return
                          const dest = typeof it.dest === 'string' ? await pdfDoc.getDestination(it.dest) : it.dest
                          const ref = Array.isArray(dest) ? dest[0] : null
                          if (!ref) return
                          const pageIndex = await pdfDoc.getPageIndex(ref)
                          setPage(pageIndex + 1)
                        } catch {
                          // On ignore si le plan PDF est incomplet.
                        }
                      }}
                      style={{ paddingLeft: 12 + depth * 12 }}
                    >
                      {it.title ?? '-'}
                    </button>
                  ))
                )}
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                <div className="text-xs text-slate-500 dark:text-slate-300">
                  Posez une question sur ce PDF (offline). Les reponses incluent des citations cliquables.
                </div>

                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={() => void runAssistant('De quoi parle ce document ?')}
                    className="rounded-xl border border-slate-200/70 dark:border-white/10 px-3 py-2 text-sm hover:bg-slate-100/70 dark:hover:bg-white/10 transition-colors"
                    disabled={assistantLoading || !props.doc}
                  >
                    Resume
                  </button>
                  <button
                    onClick={() => void runAssistant()}
                    className="rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 text-white px-3 py-2 text-sm hover:opacity-95 transition-opacity disabled:opacity-50"
                    disabled={assistantLoading || !props.doc}
                  >
                    {assistantLoading ? 'Analyse...' : 'Analyser'}
                  </button>
                </div>

                <input
                  value={assistantQuestion}
                  onChange={(e) => setAssistantQuestion(e.target.value)}
                  className="w-full rounded-xl border border-slate-200/70 dark:border-white/10 bg-transparent px-3 py-2 text-sm"
                  placeholder="Ex: Quels sont les points cles ?"
                />

                {assistantError && (
                  <div className="text-sm text-rose-700 dark:text-rose-200 rounded-xl border border-rose-200/70 dark:border-rose-400/20 bg-rose-50 dark:bg-rose-400/10 px-3 py-2">
                    {assistantError}
                  </div>
                )}

                {assistant && (
                  <div className="rounded-2xl border border-slate-200/60 dark:border-white/10 bg-white/60 dark:bg-black/20 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold">Reponse</div>
                      <span
                        className={clsx(
                          'text-[11px] px-2 py-1 rounded-lg border',
                          assistant.provider === 'ollama'
                            ? 'border-emerald-300/60 bg-emerald-50 text-emerald-900 dark:bg-emerald-400/10 dark:text-emerald-200 dark:border-emerald-400/20'
                            : 'border-slate-200/70 bg-slate-50 text-slate-700 dark:bg-white/5 dark:text-slate-200 dark:border-white/10'
                        )}
                        title={assistant.model ?? undefined}
                      >
                        {assistant.provider === 'ollama' ? 'LLM local (Ollama)' : 'Extractif'}
                      </span>
                    </div>

                    {assistant.keywords.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {assistant.keywords.slice(0, 10).map((k) => (
                          <span
                            key={k}
                            className="text-[11px] px-2 py-0.5 rounded-full border border-cyan-200/70 dark:border-cyan-400/20 text-cyan-800 dark:text-cyan-200 bg-cyan-50 dark:bg-cyan-400/10"
                          >
                            {k}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="mt-3 space-y-2">
                      {assistant.bullets.map((b, idx) => (
                        <div
                          key={idx}
                          className="rounded-xl border border-slate-200/70 dark:border-white/10 bg-white dark:bg-app-darkCard px-3 py-2"
                        >
                          <div className="text-sm text-slate-800 dark:text-slate-100 leading-relaxed">{b.text}</div>
                          {b.citations.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {b.citations.slice(0, 4).map((c) => (
                                <button
                                  key={`${c.chunkId}:${c.sourceId}`}
                                  onClick={() => {
                                    props.onOpenChunk(c.chunkId, assistantQuestion.trim() || props.highlightNeedle)
                                    setRightTab('excerpt')
                                  }}
                                  className="text-[11px] px-2 py-0.5 rounded-full border border-slate-200/70 dark:border-white/10 text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-white/5 hover:bg-slate-100/70 dark:hover:bg-white/10 transition-colors"
                                  title={c.docName}
                                >
                                  p.{c.pageStart}
                                  {c.pageEnd !== c.pageStart ? `-${c.pageEnd}` : ''}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                      {assistant.bullets.length === 0 && <div className="text-sm text-slate-500 dark:text-slate-300">Aucune reponse.</div>}
                    </div>
                  </div>
                )}

                {!assistant && !assistantLoading && (
                  <div className="text-sm text-slate-500 dark:text-slate-300">Astuce: commencez par <span className="font-medium">"Resume"</span>.</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
