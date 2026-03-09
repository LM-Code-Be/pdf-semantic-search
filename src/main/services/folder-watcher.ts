import chokidar, { type FSWatcher } from 'chokidar'
import { createLogger } from '../logger'
import type { AppStore } from '../store'
import type { LibraryService } from './library'
import type { IndexingOrchestrator } from './indexing-orchestrator'

const log = createLogger('watcher')

export class FolderWatcher {
  private watcher: FSWatcher | null = null

  constructor(private store: AppStore, private library: LibraryService, private indexing: IndexingOrchestrator) {}

  start() {
    const cfg = this.store.getConfig()
    this.restart(cfg.library.watchFolders)
  }

  restart(folders: string[]) {
    this.dispose()
    const paths = folders.filter(Boolean)
    if (!paths.length) return

    this.watcher = chokidar.watch(paths, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 800, pollInterval: 200 }
    })

    this.watcher.on('add', async (p) => {
      if (!p.toLowerCase().endsWith('.pdf')) return
      const cfg = this.store.getConfig()
      log.info({ p }, 'new pdf detected')
      const res = this.library.importFiles([p])
      if (cfg.library.autoIndexNewFiles) {
        for (const id of res.docIds) this.indexing.queueDoc(id)
        this.indexing.kick()
      }
    })

    this.watcher.on('error', (err) => log.warn({ err }, 'watcher error'))
    log.info({ count: paths.length }, 'watcher started')
  }

  dispose() {
    if (this.watcher) {
      void this.watcher.close().catch(() => {})
      this.watcher = null
    }
  }
}

