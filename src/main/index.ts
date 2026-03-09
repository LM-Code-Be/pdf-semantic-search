import { app, BrowserWindow, dialog, ipcMain, protocol } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { Readable } from 'node:stream'
import {
  IPC,
  zAppConfig,
  zAssistantAnswerRequest,
  zAssistantDocAnswerRequest,
  zExportResultsRequest,
  zCollectionsCreateRequest,
  zCollectionsDeleteRequest,
  zCollectionsRenameRequest,
  zCollectionsSetColorRequest,
  zCollectionsSetForDocRequest,
  zFavoritesAddRequest,
  zFavoritesRemoveRequest,
  zImportFilesRequest,
  zScanFolderRequest,
  zIndexingQueueDocRequest,
  zIndexingCancelDocRequest,
  zRemoveRequest,
  zSearchRequest,
  zTagsSetForDocRequest,
  zChunkContextRequest
} from '@shared/ipc'
import { createLogger, setLogLevel } from './logger'
import { AppStore } from './store'
import { Db } from './db/db'
import { LibraryService } from './services/library'
import { IndexingOrchestrator } from './services/indexing-orchestrator'
import { SearchService } from './services/search'
import { AssistantService } from './services/assistant'
import { CollectionsService } from './services/collections'
import { TagsService } from './services/tags'
import { FolderWatcher } from './services/folder-watcher'

const log = createLogger('main')

let mainWindow: BrowserWindow | null = null

function resolvePreloadPath() {
  const preloadDir = path.join(__dirname, '../preload')
  const candidates = ['index.mjs', 'index.js', 'index.cjs'].map((name) => path.join(preloadDir, name))
  const found = candidates.find((candidate) => fs.existsSync(candidate))
  return found ?? path.join(preloadDir, 'index.mjs')
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'pdfdoc',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
  }
])

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#0B1020',
    webPreferences: {
      preload: resolvePreloadPath(),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

async function main() {
  await app.whenReady()

  const store = new AppStore()
  const config = store.getConfig()
  const parsed = zAppConfig.safeParse(config)
  if (!parsed.success) {
    log.warn({ err: parsed.error }, 'invalid config, resetting to defaults')
    store.resetToDefaults()
  }
  setLogLevel(store.getConfig().logging.level)

  const appRootPath = app.getAppPath()
  const db = new Db(app.getPath('userData'), appRootPath)
  db.migrate()

  const library = new LibraryService(db)
  const collections = new CollectionsService(db)
  const tags = new TagsService(db)
  const pythonDir = app.isPackaged ? path.join(process.resourcesPath, 'python') : path.join(appRootPath, 'python')
  const indexing = new IndexingOrchestrator(db, store, (progress) => {
    mainWindow?.webContents.send(IPC.indexingProgress, progress)
  }, pythonDir)
  const search = new SearchService(db, store, indexing.getEmbeddingsClient(), () => indexing.ensureEmbeddingsReady())
  const assistant = new AssistantService(db, store, search)
  const watcher = new FolderWatcher(store, library, indexing)

  createWindow()
  watcher.start()
  indexing.kick()

  protocol.handle('pdfdoc', async (request) => {
    const url = new URL(request.url)
    const pathParts = url.pathname.split('/').filter(Boolean)
    const docId =
      url.hostname === 'doc'
        ? decodeURIComponent(pathParts[0] ?? '')
        : decodeURIComponent(url.hostname || pathParts[0] || '')
    const p = library.getDocumentPath(docId)
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
      'Access-Control-Allow-Headers': 'Range,Content-Type',
      'Cross-Origin-Resource-Policy': 'cross-origin'
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    if (!p) {
      log.warn({ docId }, 'pdfdoc not found in library')
      return new Response('Not found', { status: 404, headers: corsHeaders })
    }
    const stat = await fs.promises.stat(p).catch(() => null)
    if (!stat) return new Response('Not found', { status: 404, headers: corsHeaders })

    const baseHeaders = {
      ...corsHeaders,
      'Content-Type': 'application/pdf',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store'
    }

    const range = request.headers.get('range')
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/i.exec(range.trim())
      if (!m) {
        return new Response('Invalid range', {
          status: 416,
          headers: { ...baseHeaders, 'Content-Range': `bytes */${stat.size}` }
        })
      }
      const startRaw = m[1] ? Number(m[1]) : 0
      const endRaw = m[2] ? Number(m[2]) : stat.size - 1
      const start = Number.isFinite(startRaw) ? Math.max(0, startRaw) : 0
      const end = Number.isFinite(endRaw) ? Math.min(stat.size - 1, endRaw) : stat.size - 1
      if (start > end || start >= stat.size) {
        return new Response('Range not satisfiable', {
          status: 416,
          headers: { ...baseHeaders, 'Content-Range': `bytes */${stat.size}` }
        })
      }

      const stream = Readable.toWeb(fs.createReadStream(p, { start, end }))
      return new Response(stream as any, {
        status: 206,
        headers: {
          ...baseHeaders,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${stat.size}`
        }
      })
    }

    const stream = Readable.toWeb(fs.createReadStream(p))
    return new Response(stream as any, {
      headers: {
        ...baseHeaders,
        'Content-Length': String(stat.size)
      }
    })
  })

  ipcMain.handle(IPC.libraryPickFiles, async () => {
    if (!mainWindow) return { paths: [] }
    const res = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    return { paths: res.canceled ? [] : res.filePaths }
  })

  ipcMain.handle(IPC.libraryPickFolder, async () => {
    if (!mainWindow) return { path: null }
    const res = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    })
    return { path: res.canceled ? null : res.filePaths[0] ?? null }
  })

  ipcMain.handle(IPC.libraryImportFiles, async (_e, req) => {
    const parsedReq = zImportFilesRequest.parse(req)
    const res = library.importFiles(parsedReq.paths)
    return res
  })

  ipcMain.handle(IPC.libraryScanFolder, async (_e, req) => {
    const parsed = zScanFolderRequest.parse(req)
    return library.importFolderRecursive(parsed.path)
  })

  ipcMain.handle(IPC.libraryList, async () => {
    return { documents: library.listDocuments() }
  })

  ipcMain.handle(IPC.libraryRemove, async (_e, req) => {
    const parsedReq = zRemoveRequest.parse(req)
    // On annule au mieux pour éviter un travail inutile.
    indexing.cancelDoc(parsedReq.docId)
    try {
      db.connection.prepare(`DELETE FROM indexing_jobs WHERE doc_id=? AND status IN ('queued','running')`).run(parsedReq.docId)
    } catch {
      // On ignore cette erreur locale.
    }
    library.removeDocument(parsedReq.docId)
  })

  ipcMain.handle(IPC.indexingQueueAll, async () => {
    indexing.queueAllNotIndexed()
    indexing.kick()
  })
  ipcMain.handle(IPC.indexingReindexAll, async () => {
    indexing.queueAll(true)
    indexing.kick()
  })

  ipcMain.handle(IPC.indexingQueueDoc, async (_e, req) => {
    const parsedReq = zIndexingQueueDocRequest.parse(req)
    indexing.queueDoc(parsedReq.docId)
    indexing.kick()
  })

  ipcMain.handle(IPC.indexingPause, async () => {
    indexing.pause()
  })
  ipcMain.handle(IPC.indexingResume, async () => {
    indexing.resume()
    indexing.kick()
  })
  ipcMain.handle(IPC.indexingCancelDoc, async (_e, req) => {
    const parsed = zIndexingCancelDocRequest.parse(req)
    indexing.cancelDoc(parsed.docId)
  })
  ipcMain.handle(IPC.indexingCancelAll, async () => {
    indexing.cancelAll()
  })
  ipcMain.handle(IPC.indexingListJobs, async () => {
    const rows = db.connection
      .prepare(
        `SELECT j.id as id, j.doc_id as docId, d.file_name as docName, j.status as status,
                j.created_at as createdAt, j.updated_at as updatedAt, j.error as error
         FROM indexing_jobs j
         JOIN documents d ON d.id = j.doc_id
         ORDER BY
           CASE j.status
             WHEN 'running' THEN 0
             WHEN 'queued' THEN 1
             WHEN 'failed' THEN 2
             WHEN 'done' THEN 3
             WHEN 'canceled' THEN 4
             ELSE 5
           END,
           j.created_at DESC
         LIMIT 200`
      )
      .all() as any[]
    return {
      jobs: rows.map((r) => ({
        id: String(r.id),
        docId: String(r.docId),
        docName: String(r.docName),
        status: String(r.status),
        createdAt: Number(r.createdAt),
        updatedAt: Number(r.updatedAt),
        error: r.error == null ? null : String(r.error)
      }))
    }
  })

  ipcMain.handle(IPC.searchQuery, async (_e, req) => {
    const parsedReq = zSearchRequest.parse(req)
    const { results, answerBullets } = await search.search(parsedReq.query, parsedReq.docIds, parsedReq.collectionId, parsedReq.tags)
    return { results, answerBullets }
  })

  ipcMain.handle(IPC.assistantAnswer, async (_e, req) => {
    const parsed = zAssistantAnswerRequest.parse(req)
    return await assistant.answer(parsed.query, parsed.docIds, parsed.collectionId, parsed.tags)
  })
  ipcMain.handle(IPC.assistantDocAnswer, async (_e, req) => {
    const parsed = zAssistantDocAnswerRequest.parse(req)
    return await assistant.docAnswer(parsed.docId, parsed.question)
  })

  ipcMain.handle(IPC.historyList, async () => {
    const rows = db.connection
      .prepare(`SELECT id, query, created_at as createdAt FROM search_history ORDER BY created_at DESC LIMIT 20`)
      .all() as any[]
    return { items: rows.map((r) => ({ id: Number(r.id), query: String(r.query), createdAt: Number(r.createdAt) })) }
  })

  ipcMain.handle(IPC.historyClear, async () => {
    db.connection.prepare(`DELETE FROM search_history`).run()
  })

  ipcMain.handle(IPC.collectionsList, async () => {
    return { collections: collections.list() }
  })
  ipcMain.handle(IPC.collectionsCreate, async (_e, req) => {
    const parsed = zCollectionsCreateRequest.parse(req)
    collections.create(parsed.name, parsed.color ?? null)
  })
  ipcMain.handle(IPC.collectionsRename, async (_e, req) => {
    const parsed = zCollectionsRenameRequest.parse(req)
    collections.rename(parsed.id, parsed.name)
  })
  ipcMain.handle(IPC.collectionsSetColor, async (_e, req) => {
    const parsed = zCollectionsSetColorRequest.parse(req)
    collections.setColor(parsed.id, parsed.color ?? null)
  })
  ipcMain.handle(IPC.collectionsDelete, async (_e, req) => {
    const parsed = zCollectionsDeleteRequest.parse(req)
    collections.delete(parsed.id)
  })
  ipcMain.handle(IPC.collectionsSetForDoc, async (_e, req) => {
    const parsed = zCollectionsSetForDocRequest.parse(req)
    collections.setForDoc(parsed.docId, parsed.collectionIds)
  })

  ipcMain.handle(IPC.tagsSetForDoc, async (_e, req) => {
    const parsed = zTagsSetForDocRequest.parse(req)
    tags.setForDoc(parsed.docId, parsed.tags)
  })
  ipcMain.handle(IPC.tagsList, async () => {
    return { tags: tags.listAll() }
  })

  ipcMain.handle(IPC.favoritesAdd, async (_e, req) => {
    const parsed = zFavoritesAddRequest.parse(req)
    db.connection
      .prepare(`INSERT OR IGNORE INTO favorite_chunks(chunk_id, created_at) VALUES (?, ?)`)
      .run(parsed.chunkId, Date.now())
  })
  ipcMain.handle(IPC.favoritesRemove, async (_e, req) => {
    const parsed = zFavoritesRemoveRequest.parse(req)
    db.connection.prepare(`DELETE FROM favorite_chunks WHERE chunk_id=?`).run(parsed.chunkId)
  })
  ipcMain.handle(IPC.favoritesList, async () => {
    const rows = db.connection
      .prepare(
        `SELECT f.chunk_id as chunkId, f.created_at as createdAt,
                c.doc_id as docId, d.file_name as docName, c.page_start as pageStart, c.page_end as pageEnd, c.content as content
         FROM favorite_chunks f
         JOIN chunks c ON c.id = f.chunk_id
         JOIN documents d ON d.id = c.doc_id
         ORDER BY f.created_at DESC
         LIMIT 200`
      )
      .all() as any[]
    return {
      results: rows.map((r) => ({
        chunkId: Number(r.chunkId),
        createdAt: Number(r.createdAt),
        docId: String(r.docId),
        docName: String(r.docName),
        pageStart: Number(r.pageStart),
        pageEnd: Number(r.pageEnd),
        excerpt: String(r.content).length > 420 ? String(r.content).slice(0, 420) + '…' : String(r.content)
      }))
    }
  })

  ipcMain.handle(IPC.chunkGetContext, async (_e, req) => {
    const parsed = zChunkContextRequest.parse(req)
    const row = db.connection
      .prepare(
        `SELECT c.id as chunkId, c.doc_id as docId, d.file_name as docName, c.page_start as pageStart, c.page_end as pageEnd,
                c.chunk_index as chunkIndex, c.content as content
         FROM chunks c
         JOIN documents d ON d.id = c.doc_id
         WHERE c.id = ?`
      )
      .get(parsed.chunkId) as any
    if (!row) throw new Error('Chunk not found')

    const beforeRow = db.connection
      .prepare(`SELECT content FROM chunks WHERE doc_id=? AND chunk_index=?`)
      .get(row.docId, Number(row.chunkIndex) - 1) as any
    const afterRow = db.connection
      .prepare(`SELECT content FROM chunks WHERE doc_id=? AND chunk_index=?`)
      .get(row.docId, Number(row.chunkIndex) + 1) as any

    return {
      chunkId: Number(row.chunkId),
      docId: String(row.docId),
      docName: String(row.docName),
      pageStart: Number(row.pageStart),
      pageEnd: Number(row.pageEnd),
      before: beforeRow?.content ? String(beforeRow.content) : '',
      content: String(row.content),
      after: afterRow?.content ? String(afterRow.content) : ''
    }
  })

  ipcMain.handle(IPC.exportResults, async (_e, req) => {
    const parsed = zExportResultsRequest.parse(req)
    if (!mainWindow) return { savedPath: null }
    const defaultName = `pdf-search-${Date.now()}.${parsed.format}`
    const save = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultName,
      filters: [{ name: parsed.format.toUpperCase(), extensions: [parsed.format] }]
    })
    if (save.canceled || !save.filePath) return { savedPath: null }

    const fp = save.filePath
    if (parsed.format === 'json') {
      const payload = { query: parsed.query, exportedAt: Date.now(), results: parsed.results }
      await fs.promises.writeFile(fp, JSON.stringify(payload, null, 2), 'utf8')
    } else if (parsed.format === 'csv') {
      const esc = (s: string) => `"${s.replaceAll('"', '""')}"`
      const lines = [
        ['score', 'doc', 'page_start', 'page_end', 'excerpt'].join(','),
        ...parsed.results.map((r) =>
          [String(r.score), esc(r.docName), String(r.pageStart), String(r.pageEnd), esc(r.excerpt)].join(',')
        )
      ]
      await fs.promises.writeFile(fp, lines.join('\n'), 'utf8')
    } else {
      const lines = [
        `# PDF Semantic Search — Export`,
        ``,
        `Query: ${parsed.query}`,
        ``,
        ...parsed.results.map(
          (r, i) =>
            `## ${i + 1}. ${r.docName} — p.${r.pageStart}${r.pageEnd !== r.pageStart ? `–${r.pageEnd}` : ''}\n\n> ${r.excerpt.replaceAll('\n', ' ')}\n`
        )
      ]
      await fs.promises.writeFile(fp, lines.join('\n'), 'utf8')
    }
    return { savedPath: fp }
  })

  ipcMain.handle(IPC.appGetConfig, async () => store.getConfig())
  ipcMain.handle(IPC.appSetConfig, async (_e, patch) => {
    const before = store.getConfig()
    const after = store.setConfigPatch(patch)
    if (before.logging.level !== after.logging.level) {
      setLogLevel(after.logging.level)
    }
    if (before.library.watchFolders.join('|') !== after.library.watchFolders.join('|')) {
      watcher.restart(after.library.watchFolders)
    }
    return after
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  app.on('before-quit', () => {
    watcher.dispose()
    indexing.dispose()
    db.close()
  })
}

void main().catch((err) => {
  log.error({ err }, 'fatal')
  app.quit()
})
