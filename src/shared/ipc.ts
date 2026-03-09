import { z } from 'zod'
import { zIndexingJobInfo, zIndexingProgress, zPdfDocument, zSearchAnswerBullet, zSearchResult } from './models'

export const IPC = {
  libraryPickFiles: 'library:pickFiles',
  libraryPickFolder: 'library:pickFolder',
  libraryImportFiles: 'library:importFiles',
  libraryScanFolder: 'library:scanFolder',
  libraryList: 'library:list',
  libraryRemove: 'library:remove',
  indexingQueueAll: 'indexing:queueAll',
  indexingReindexAll: 'indexing:reindexAll',
  indexingQueueDoc: 'indexing:queueDoc',
  indexingPause: 'indexing:pause',
  indexingResume: 'indexing:resume',
  indexingCancelDoc: 'indexing:cancelDoc',
  indexingCancelAll: 'indexing:cancelAll',
  indexingListJobs: 'indexing:listJobs',
  assistantAnswer: 'assistant:answer',
  assistantDocAnswer: 'assistant:docAnswer',
  searchQuery: 'search:query',
  exportResults: 'export:results',
  historyList: 'history:list',
  historyClear: 'history:clear',
  collectionsList: 'collections:list',
  collectionsCreate: 'collections:create',
  collectionsRename: 'collections:rename',
  collectionsSetColor: 'collections:setColor',
  collectionsDelete: 'collections:delete',
  collectionsSetForDoc: 'collections:setForDoc',
  tagsSetForDoc: 'tags:setForDoc',
  tagsList: 'tags:list',
  favoritesAdd: 'favorites:add',
  favoritesRemove: 'favorites:remove',
  favoritesList: 'favorites:list',
  chunkGetContext: 'chunk:getContext',
  appGetConfig: 'app:getConfig',
  appSetConfig: 'app:setConfig',
  indexingProgress: 'indexing:progress'
} as const

export const zAssistantConfig = z.object({
  provider: z.enum(['extractive', 'ollama']).default('extractive'),
  ollamaHost: z.string().default('http://127.0.0.1:11434'),
  ollamaModel: z.string().default('llama3.2:3b-instruct'),
  enableInSearch: z.boolean().default(true)
})
export type AssistantConfig = z.infer<typeof zAssistantConfig>

export const zAppConfig = z.object({
  library: z.object({
    watchFolders: z.array(z.string()),
    autoIndexNewFiles: z.boolean()
  }),
  assistant: zAssistantConfig.optional().default({ provider: 'extractive', ollamaHost: 'http://127.0.0.1:11434', ollamaModel: 'llama3.2:3b-instruct', enableInSearch: true }),
  embeddings: z.object({
    provider: z.enum(['python']),
    pythonPort: z.number(),
    model: z.string(),
    modelPath: z.string().nullable()
  }),
  chunking: z.object({
    targetChars: z.number(),
    overlapChars: z.number()
  }),
  search: z.object({
    topK: z.number(),
    weightVector: z.number(),
    weightKeyword: z.number()
  }),
  ocr: z.object({
    enabled: z.boolean(),
    language: z.string()
  }),
  logging: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error'])
  })
})
export type AppConfig = z.infer<typeof zAppConfig>

export const zPickFilesResponse = z.object({
  paths: z.array(z.string())
})

export const zPickFolderResponse = z.object({
  path: z.string().nullable()
})

export const zImportFilesRequest = z.object({
  paths: z.array(z.string())
})
export const zImportFilesResponse = z.object({
  imported: z.number(),
  docIds: z.array(z.string())
})

export const zScanFolderRequest = z.object({
  path: z.string()
})

export const zListLibraryResponse = z.object({
  documents: z.array(zPdfDocument)
})

export const zRemoveRequest = z.object({
  docId: z.string()
})

export const zSearchRequest = z.object({
  query: z.string(),
  docIds: z.array(z.string()).optional(),
  collectionId: z.string().optional(),
  tags: z.array(z.string()).optional()
})
export const zSearchResponse = z.object({
  results: z.array(zSearchResult),
  answerBullets: z.array(zSearchAnswerBullet)
})

export const zAssistantCitation = z.object({
  sourceId: z.number(),
  chunkId: z.number(),
  docId: z.string(),
  docName: z.string(),
  pageStart: z.number(),
  pageEnd: z.number()
})

export const zAssistantBullet = z.object({
  text: z.string(),
  citations: z.array(zAssistantCitation)
})

export const zAssistantAnswerRequest = z.object({
  query: z.string(),
  docIds: z.array(z.string()).optional(),
  collectionId: z.string().optional(),
  tags: z.array(z.string()).optional()
})
export type AssistantAnswerRequest = z.infer<typeof zAssistantAnswerRequest>

export const zAssistantDocAnswerRequest = z.object({
  docId: z.string(),
  question: z.string()
})
export type AssistantDocAnswerRequest = z.infer<typeof zAssistantDocAnswerRequest>

export const zAssistantAnswerResponse = z.object({
  provider: z.enum(['extractive', 'ollama']),
  model: z.string().nullable(),
  keywords: z.array(z.string()),
  bullets: z.array(zAssistantBullet)
})
export type AssistantAnswerResponse = z.infer<typeof zAssistantAnswerResponse>

export const zExportResultsRequest = z.object({
  format: z.enum(['csv', 'json', 'md']),
  query: z.string(),
  results: z.array(zSearchResult)
})
export const zExportResultsResponse = z.object({
  savedPath: z.string().nullable()
})

export const zHistoryListResponse = z.object({
  items: z.array(
    z.object({
      id: z.number(),
      query: z.string(),
      createdAt: z.number()
    })
  )
})

export const zCollectionsListResponse = z.object({
  collections: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      color: z.string().nullable(),
      createdAt: z.number()
    })
  )
})

export const zCollectionsCreateRequest = z.object({
  name: z.string().min(1),
  color: z.string().nullable().optional()
})

export const zCollectionsRenameRequest = z.object({
  id: z.string(),
  name: z.string().min(1)
})

export const zCollectionsDeleteRequest = z.object({
  id: z.string()
})

export const zCollectionsSetColorRequest = z.object({
  id: z.string(),
  color: z.string().nullable()
})

export const zCollectionsSetForDocRequest = z.object({
  docId: z.string(),
  collectionIds: z.array(z.string())
})

export const zTagsSetForDocRequest = z.object({
  docId: z.string(),
  tags: z.array(z.string())
})

export const zTagsListResponse = z.object({
  tags: z.array(z.string())
})

export const zFavoritesAddRequest = z.object({
  chunkId: z.number()
})

export const zFavoritesRemoveRequest = z.object({
  chunkId: z.number()
})

export const zFavoritesListResponse = z.object({
  results: z.array(
    z.object({
      chunkId: z.number(),
      createdAt: z.number(),
      docId: z.string(),
      docName: z.string(),
      pageStart: z.number(),
      pageEnd: z.number(),
      excerpt: z.string()
    })
  )
})

export const zChunkContextRequest = z.object({
  chunkId: z.number()
})

export const zChunkContextResponse = z.object({
  chunkId: z.number(),
  docId: z.string(),
  docName: z.string(),
  pageStart: z.number(),
  pageEnd: z.number(),
  before: z.string(),
  content: z.string(),
  after: z.string()
})

export const zIndexingQueueDocRequest = z.object({
  docId: z.string()
})

export const zIndexingCancelDocRequest = z.object({
  docId: z.string()
})

export const zIndexingListJobsResponse = z.object({
  jobs: z.array(zIndexingJobInfo)
})

export const zIndexingProgressEvent = zIndexingProgress
