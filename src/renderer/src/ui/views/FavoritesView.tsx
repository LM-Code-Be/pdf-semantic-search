import { useQuery } from '@tanstack/react-query'
import type { PdfDocument, SearchResult } from '@shared/models'

export function FavoritesView(props: {
  collectionId: string | null
  onOpenResult: (doc: PdfDocument, result: SearchResult, query: string, items?: SearchResult[], index?: number) => void
}) {
  const lib = useQuery({ queryKey: ['library'], queryFn: () => window.api.listLibrary() })
  const fav = useQuery({ queryKey: ['favorites'], queryFn: () => window.api.listFavorites() })

  const docs = lib.data ?? []
  const byId = new Map(docs.map((d) => [d.id, d]))
  const favorites = fav.data ?? []

  const filtered =
    props.collectionId == null
      ? favorites
      : favorites.filter((f) => {
          const doc = byId.get(f.docId)
          return doc ? (doc.collections ?? []).some((c) => c.id === props.collectionId) : false
        })

  return (
    <div className="h-full overflow-auto p-4 sm:p-6">
      <div className="text-sm text-slate-600 dark:text-slate-300">{filtered.length} favori(s)</div>
      <div className="mt-4 space-y-3">
        {filtered.map((f, idx) => {
          const doc = byId.get(f.docId)
          const asResult: SearchResult = {
            chunkId: f.chunkId,
            docId: f.docId,
            docName: f.docName,
            pageStart: f.pageStart,
            pageEnd: f.pageEnd,
            score: 1,
            scoreVector: null,
            scoreKeyword: null,
            excerpt: f.excerpt
          }
          return (
            <button
              key={f.chunkId}
              onClick={() => {
                if (!doc) return
                const items = filtered.map((x) => ({
                  chunkId: x.chunkId,
                  docId: x.docId,
                  docName: x.docName,
                  pageStart: x.pageStart,
                  pageEnd: x.pageEnd,
                  score: 1,
                  scoreVector: null,
                  scoreKeyword: null,
                  excerpt: x.excerpt
                })) as SearchResult[]
                props.onOpenResult(doc, asResult, '', items, idx)
              }}
              className="w-full text-left rounded-2xl border border-slate-200/60 dark:border-white/10 bg-white dark:bg-app-darkCard p-4 hover:shadow-sm transition-shadow"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="font-semibold truncate">{f.docName}</div>
                <div className="text-xs text-slate-500 dark:text-slate-300">
                  p.{f.pageStart}
                  {f.pageEnd !== f.pageStart ? `-${f.pageEnd}` : ''}
                </div>
              </div>
              <div className="text-sm text-slate-700 dark:text-slate-200 mt-2 line-clamp-3">{f.excerpt}</div>
            </button>
          )
        })}
        {filtered.length === 0 && <div className="text-sm text-slate-500 dark:text-slate-300 mt-10 text-center">Aucun favori.</div>}
      </div>
    </div>
  )
}
