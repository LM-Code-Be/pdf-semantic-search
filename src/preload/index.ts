import { contextBridge, ipcRenderer } from 'electron'
import type { AppConfig, AssistantAnswerResponse } from '@shared/ipc'
import { IPC, zAssistantAnswerResponse } from '@shared/ipc'
import type { IndexingJobInfo, IndexingProgress, PdfDocument, SearchAnswerBullet, SearchResult } from '@shared/models'

export type RendererApi = {
  pickPdfFiles(): Promise<string[]>
  pickFolder(): Promise<string | null>
  importPdfFiles(paths: string[]): Promise<{ imported: number; docIds: string[] }>
  scanFolder(path: string): Promise<{ imported: number; docIds: string[] }>
  listLibrary(): Promise<PdfDocument[]>
  removeDocument(docId: string): Promise<void>
  queueIndexingAll(): Promise<void>
  reindexAll(): Promise<void>
  queueIndexingDoc(docId: string): Promise<void>
  pauseIndexing(): Promise<void>
  resumeIndexing(): Promise<void>
  cancelIndexingDoc(docId: string): Promise<void>
  cancelIndexingAll(): Promise<void>
  listIndexingJobs(): Promise<IndexingJobInfo[]>
  search(
    query: string,
    docIds?: string[],
    collectionId?: string,
    tags?: string[]
  ): Promise<{ results: SearchResult[]; answerBullets: SearchAnswerBullet[] }>
  assistantAnswer(
    query: string,
    docIds?: string[],
    collectionId?: string,
    tags?: string[]
  ): Promise<AssistantAnswerResponse>
  assistantDocAnswer(
    docId: string,
    question: string
  ): Promise<AssistantAnswerResponse>
  exportResults(format: 'csv' | 'json' | 'md', query: string, results: SearchResult[]): Promise<string | null>
  listHistory(): Promise<{ id: number; query: string; createdAt: number }[]>
  clearHistory(): Promise<void>
  listCollections(): Promise<{ id: string; name: string; color: string | null; createdAt: number }[]>
  createCollection(name: string, color?: string | null): Promise<void>
  renameCollection(id: string, name: string): Promise<void>
  setCollectionColor(id: string, color: string | null): Promise<void>
  deleteCollection(id: string): Promise<void>
  setCollectionsForDoc(docId: string, collectionIds: string[]): Promise<void>
  setTagsForDoc(docId: string, tags: string[]): Promise<void>
  listTags(): Promise<string[]>
  addFavorite(chunkId: number): Promise<void>
  removeFavorite(chunkId: number): Promise<void>
  listFavorites(): Promise<
    { chunkId: number; createdAt: number; docId: string; docName: string; pageStart: number; pageEnd: number; excerpt: string }[]
  >
  getChunkContext(chunkId: number): Promise<{
    chunkId: number
    docId: string
    docName: string
    pageStart: number
    pageEnd: number
    before: string
    content: string
    after: string
  }>
  getConfig(): Promise<AppConfig>
  setConfig(patch: Partial<AppConfig>): Promise<AppConfig>
  onIndexingProgress(handler: (progress: IndexingProgress) => void): () => void
}

const api: RendererApi = {
  async pickPdfFiles() {
    const res = (await ipcRenderer.invoke(IPC.libraryPickFiles)) as { paths: string[] }
    return res.paths
  },
  async pickFolder() {
    const res = (await ipcRenderer.invoke(IPC.libraryPickFolder)) as { path: string | null }
    return res.path
  },
  async importPdfFiles(paths) {
    const res = (await ipcRenderer.invoke(IPC.libraryImportFiles, { paths })) as {
      imported: number
      docIds: string[]
    }
    return res
  },
  async scanFolder(path) {
    const res = (await ipcRenderer.invoke(IPC.libraryScanFolder, { path })) as {
      imported: number
      docIds: string[]
    }
    return res
  },
  async listLibrary() {
    const res = (await ipcRenderer.invoke(IPC.libraryList)) as { documents: PdfDocument[] }
    return res.documents
  },
  async removeDocument(docId) {
    await ipcRenderer.invoke(IPC.libraryRemove, { docId })
  },
  async queueIndexingAll() {
    await ipcRenderer.invoke(IPC.indexingQueueAll)
  },
  async reindexAll() {
    await ipcRenderer.invoke(IPC.indexingReindexAll)
  },
  async queueIndexingDoc(docId) {
    await ipcRenderer.invoke(IPC.indexingQueueDoc, { docId })
  },
  async pauseIndexing() {
    await ipcRenderer.invoke(IPC.indexingPause)
  },
  async resumeIndexing() {
    await ipcRenderer.invoke(IPC.indexingResume)
  },
  async cancelIndexingDoc(docId) {
    await ipcRenderer.invoke(IPC.indexingCancelDoc, { docId })
  },
  async cancelIndexingAll() {
    await ipcRenderer.invoke(IPC.indexingCancelAll)
  },
  async listIndexingJobs() {
    const res = (await ipcRenderer.invoke(IPC.indexingListJobs)) as { jobs: IndexingJobInfo[] }
    return res.jobs
  },
  async search(query, docIds, collectionId, tags) {
    const res = (await ipcRenderer.invoke(IPC.searchQuery, { query, docIds, collectionId, tags })) as {
      results: SearchResult[]
      answerBullets: SearchAnswerBullet[]
    }
    return { results: res.results, answerBullets: res.answerBullets ?? [] }
  },
  async assistantAnswer(query, docIds, collectionId, tags) {
    const res = (await ipcRenderer.invoke(IPC.assistantAnswer, { query, docIds, collectionId, tags })) as unknown
    return zAssistantAnswerResponse.parse(res)
  },
  async assistantDocAnswer(docId, question) {
    const res = (await ipcRenderer.invoke(IPC.assistantDocAnswer, { docId, question })) as unknown
    return zAssistantAnswerResponse.parse(res)
  },
  async exportResults(format, query, results) {
    const res = (await ipcRenderer.invoke(IPC.exportResults, { format, query, results })) as { savedPath: string | null }
    return res.savedPath
  },
  async listHistory() {
    const res = (await ipcRenderer.invoke(IPC.historyList)) as {
      items: { id: number; query: string; createdAt: number }[]
    }
    return res.items
  },
  async clearHistory() {
    await ipcRenderer.invoke(IPC.historyClear)
  },
  async listCollections() {
    const res = (await ipcRenderer.invoke(IPC.collectionsList)) as {
      collections: { id: string; name: string; color: string | null; createdAt: number }[]
    }
    return res.collections
  },
  async createCollection(name, color) {
    await ipcRenderer.invoke(IPC.collectionsCreate, { name, color: color ?? null })
  },
  async renameCollection(id, name) {
    await ipcRenderer.invoke(IPC.collectionsRename, { id, name })
  },
  async setCollectionColor(id, color) {
    await ipcRenderer.invoke(IPC.collectionsSetColor, { id, color })
  },
  async deleteCollection(id) {
    await ipcRenderer.invoke(IPC.collectionsDelete, { id })
  },
  async setCollectionsForDoc(docId, collectionIds) {
    await ipcRenderer.invoke(IPC.collectionsSetForDoc, { docId, collectionIds })
  },
  async setTagsForDoc(docId, tags) {
    await ipcRenderer.invoke(IPC.tagsSetForDoc, { docId, tags })
  },
  async listTags() {
    const res = (await ipcRenderer.invoke(IPC.tagsList)) as { tags: string[] }
    return res.tags
  },
  async addFavorite(chunkId) {
    await ipcRenderer.invoke(IPC.favoritesAdd, { chunkId })
  },
  async removeFavorite(chunkId) {
    await ipcRenderer.invoke(IPC.favoritesRemove, { chunkId })
  },
  async listFavorites() {
    const res = (await ipcRenderer.invoke(IPC.favoritesList)) as {
      results: {
        chunkId: number
        createdAt: number
        docId: string
        docName: string
        pageStart: number
        pageEnd: number
        excerpt: string
      }[]
    }
    return res.results
  },
  async getChunkContext(chunkId) {
    const res = (await ipcRenderer.invoke(IPC.chunkGetContext, { chunkId })) as {
      chunkId: number
      docId: string
      docName: string
      pageStart: number
      pageEnd: number
      before: string
      content: string
      after: string
    }
    return res
  },
  async getConfig() {
    return (await ipcRenderer.invoke(IPC.appGetConfig)) as AppConfig
  },
  async setConfig(patch) {
    return (await ipcRenderer.invoke(IPC.appSetConfig, patch)) as AppConfig
  },
  onIndexingProgress(handler) {
    const listener = (_: Electron.IpcRendererEvent, progress: IndexingProgress) => handler(progress)
    ipcRenderer.on(IPC.indexingProgress, listener)
    return () => ipcRenderer.off(IPC.indexingProgress, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)

declare global {
  interface Window {
    api: RendererApi
  }
}
