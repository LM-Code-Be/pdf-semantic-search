import { z } from 'zod'

export const zCollection = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().nullable(),
  createdAt: z.number()
})
export type Collection = z.infer<typeof zCollection>

export const zPdfDocument = z.object({
  id: z.string(),
  path: z.string(),
  fileName: z.string(),
  fileSize: z.number(),
  addedAt: z.number(),
  pageCount: z.number().nullable(),
  indexingStatus: z.enum(['not_indexed', 'queued', 'indexing', 'indexed', 'failed']),
  lastError: z.string().nullable(),
  indexedAt: z.number().nullable().optional(),
  embeddingModel: z.string().nullable().optional(),
  embeddingDim: z.number().nullable().optional(),
  usedOcr: z.boolean().optional(),
  textQuality: z.number().nullable().optional(),
  collections: z.array(z.object({ id: z.string(), name: z.string(), color: z.string().nullable() })).optional(),
  tags: z.array(z.string()).optional()
})
export type PdfDocument = z.infer<typeof zPdfDocument>

export const zSearchResult = z.object({
  chunkId: z.number(),
  docId: z.string(),
  docName: z.string(),
  pageStart: z.number(),
  pageEnd: z.number(),
  score: z.number(),
  scoreVector: z.number().nullable(),
  scoreKeyword: z.number().nullable(),
  excerpt: z.string()
})
export type SearchResult = z.infer<typeof zSearchResult>

export const zSearchAnswerBullet = z.object({
  text: z.string(),
  chunkId: z.number(),
  docId: z.string(),
  docName: z.string(),
  pageStart: z.number(),
  pageEnd: z.number(),
  score: z.number()
})
export type SearchAnswerBullet = z.infer<typeof zSearchAnswerBullet>

export const zIndexingProgress = z.object({
  jobId: z.string(),
  docId: z.string(),
  stage: z.enum(['queued', 'extract', 'ocr', 'chunk', 'embed', 'finalize']),
  processedPages: z.number(),
  totalPages: z.number().nullable(),
  processedChunks: z.number(),
  totalChunks: z.number().nullable(),
  message: z.string().nullable()
})
export type IndexingProgress = z.infer<typeof zIndexingProgress>

export const zIndexingJobInfo = z.object({
  id: z.string(),
  docId: z.string(),
  docName: z.string(),
  status: z.enum(['queued', 'running', 'done', 'failed', 'canceled']),
  createdAt: z.number(),
  updatedAt: z.number(),
  error: z.string().nullable()
})
export type IndexingJobInfo = z.infer<typeof zIndexingJobInfo>
