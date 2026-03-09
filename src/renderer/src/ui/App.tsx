import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import type { IndexingProgress, PdfDocument, SearchResult } from '@shared/models'
import { useQueryClient } from '@tanstack/react-query'
import { Sidebar } from './components/Sidebar'
import { LibraryView } from './views/LibraryView'
import { SearchView } from './views/SearchView'
import { IndexingView } from './views/IndexingView'
import { PdfViewerModal } from './components/PdfViewerModal'
import { FavoritesView } from './views/FavoritesView'
import { SettingsView } from './views/SettingsView'

type Tab = 'library' | 'search' | 'indexing' | 'favorites' | 'settings'

export function App() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('search')
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = window.localStorage.getItem('ui-theme')
    return saved === 'light' ? 'light' : 'dark'
  })
  const [compactNav, setCompactNav] = useState(false)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [selectedDoc, setSelectedDoc] = useState<PdfDocument | null>(null)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [viewerPage, setViewerPage] = useState<number>(1)
  const [viewerHighlight, setViewerHighlight] = useState<string>('')
  const [viewerNeedle, setViewerNeedle] = useState<string>('')
  const [viewerBefore, setViewerBefore] = useState<string>('')
  const [viewerAfter, setViewerAfter] = useState<string>('')
  const [nav, setNav] = useState<{ query: string; items: SearchResult[]; index: number } | null>(null)
  const [progress, setProgress] = useState<IndexingProgress | null>(null)
  const [collectionId, setCollectionId] = useState<string | null>(null)
  const lastInvalidateAt = useRef(0)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    window.localStorage.setItem('ui-theme', theme)
  }, [theme])

  useEffect(() => {
    return window.api.onIndexingProgress((p) => {
      setProgress(p)
      const now = Date.now()
      if (p.stage === 'finalize' || now - lastInvalidateAt.current > 750) {
        lastInvalidateAt.current = now
        void qc.invalidateQueries({ queryKey: ['library'] })
      }
    })
  }, [qc])

  useEffect(() => {
    const onResize = () => {
      const compact = window.innerWidth < 1100
      setCompactNav(compact)
      if (!compact) setMobileSidebarOpen(false)
    }
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const headerTitle = useMemo(() => {
    if (tab === 'library') return 'Bibliotheque'
    if (tab === 'indexing') return 'Indexation'
    if (tab === 'favorites') return 'Favoris'
    if (tab === 'settings') return 'Parametres'
    return 'Recherche'
  }, [tab])

  const openResult = (doc: PdfDocument, result: SearchResult, query: string, items?: SearchResult[], index?: number) => {
    setSelectedDoc(doc)
    setViewerPage(result.pageStart)
    setViewerHighlight('Chargement...')
    setViewerNeedle(query)
    setViewerBefore('')
    setViewerAfter('')
    setViewerOpen(true)
    if (items && typeof index === 'number') setNav({ query, items, index })
    else setNav(null)
    void window.api
      .getChunkContext(result.chunkId)
      .then((ctx) => {
        setViewerBefore(ctx.before)
        setViewerHighlight(ctx.content)
        setViewerAfter(ctx.after)
      })
      .catch(() => {
        setViewerHighlight(result.excerpt)
      })
  }

  const openChunkInViewer = (chunkId: number, needle?: string) => {
    if (!selectedDoc) return
    if (needle) setViewerNeedle(needle)
    setViewerHighlight('Chargement...')
    setViewerBefore('')
    setViewerAfter('')
    void window.api
      .getChunkContext(chunkId)
      .then((ctx) => {
        setViewerPage(ctx.pageStart)
        setViewerBefore(ctx.before)
        setViewerHighlight(ctx.content)
        setViewerAfter(ctx.after)
      })
      .catch(() => {
        // On laisse tomber si le contexte n'est plus disponible.
      })
  }

  const navigateResult = (delta: -1 | 1) => {
    if (!nav) return
    const nextIndex = nav.index + delta
    const next = nav.items[nextIndex]
    if (!next) return
    void window.api.listLibrary().then((docs) => {
      const d = docs.find((x) => x.id === next.docId)
      if (!d) return
      openResult(d, next, nav.query, nav.items, nextIndex)
    })
  }

  return (
    <div className="h-full bg-app-lightBg dark:bg-app-darkBg">
      <div className="h-full flex">
        {!compactNav && (
          <Sidebar
            tab={tab}
            onTab={setTab}
            theme={theme}
            onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            progress={progress}
            collectionId={collectionId}
            onCollectionId={setCollectionId}
            className="h-full"
          />
        )}

        {compactNav && (
          <div
            className={clsx('fixed inset-0 z-40 lg:hidden', mobileSidebarOpen ? '' : 'pointer-events-none')}
            aria-hidden={!mobileSidebarOpen}
          >
            <div
              className={clsx('absolute inset-0 bg-black/35 transition-opacity', mobileSidebarOpen ? 'opacity-100' : 'opacity-0')}
              onClick={() => setMobileSidebarOpen(false)}
            />
            <Sidebar
              tab={tab}
              onTab={setTab}
              theme={theme}
              onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
              progress={progress}
              collectionId={collectionId}
              onCollectionId={setCollectionId}
              showClose
              onClose={() => setMobileSidebarOpen(false)}
              className={clsx(
                'absolute left-0 top-0 h-full w-[min(22rem,88vw)] shadow-2xl transition-transform duration-200',
                mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
              )}
            />
          </div>
        )}

        <div className="flex-1 flex flex-col min-w-0">
          <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-slate-200/50 dark:border-white/10 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              {compactNav && (
                <button
                  type="button"
                  aria-label="Ouvrir le menu"
                  onClick={() => setMobileSidebarOpen(true)}
                  className="rounded-lg border border-slate-200/80 dark:border-white/10 px-3 py-1.5 text-sm hover:bg-slate-100/70 dark:hover:bg-white/10"
                >
                  Menu
                </button>
              )}
              <div className="text-lg sm:text-xl font-semibold tracking-tight truncate">{headerTitle}</div>
            </div>
            <div className={clsx('text-xs text-slate-500 dark:text-slate-300 hidden sm:block')}>Local-first | Offline | SQLite</div>
          </div>

          <div className="flex-1 min-h-0">
            {tab === 'library' && (
              <LibraryView
                collectionId={collectionId}
                onOpenPdf={(doc) => {
                  setSelectedDoc(doc)
                  setViewerPage(1)
                  setViewerHighlight('')
                  setViewerNeedle('')
                  setViewerBefore('')
                  setViewerAfter('')
                  setViewerOpen(true)
                }}
              />
            )}
            {tab === 'search' && <SearchView collectionId={collectionId} onOpenResult={openResult} />}
            {tab === 'indexing' && <IndexingView progress={progress} />}
            {tab === 'favorites' && <FavoritesView collectionId={collectionId} onOpenResult={openResult} />}
            {tab === 'settings' && <SettingsView />}
          </div>
        </div>
      </div>

      <PdfViewerModal
        open={viewerOpen}
        onClose={() => setViewerOpen(false)}
        doc={selectedDoc}
        initialPage={viewerPage}
        highlightText={viewerHighlight}
        highlightNeedle={viewerNeedle}
        contextBefore={viewerBefore}
        contextAfter={viewerAfter}
        onOpenChunk={openChunkInViewer}
        canPrev={!!nav && nav.index > 0}
        canNext={!!nav && nav.index < nav.items.length - 1}
        onPrev={() => navigateResult(-1)}
        onNext={() => navigateResult(1)}
      />
    </div>
  )
}
