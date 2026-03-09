import crypto from 'node:crypto'

export type PageText = { pageNumber: number; text: string }

export type Chunk = {
  pageStart: number
  pageEnd: number
  chunkIndex: number
  content: string
  contentHash: string
}

export type ChunkingOptions = {
  targetChars: number
  overlapChars: number
}

type ChunkSegment = {
  pageNumber: number
  text: string
}

function splitLargeSegment(segment: ChunkSegment, targetChars: number): ChunkSegment[] {
  const text = segment.text.trim()
  if (!text) return []
  if (text.length <= targetChars) return [segment]

  const sentences = text
    .split(/(?<=[.!?;:])\s+/g)
    .map((part) => part.trim())
    .filter(Boolean)

  if (sentences.length <= 1) {
    const out: ChunkSegment[] = []
    for (let start = 0; start < text.length; start += targetChars) {
      out.push({ pageNumber: segment.pageNumber, text: text.slice(start, start + targetChars).trim() })
    }
    return out
  }

  const out: ChunkSegment[] = []
  let buffer = ''
  for (const sentence of sentences) {
    if (!buffer) {
      buffer = sentence
      continue
    }
    if ((buffer + ' ' + sentence).length <= targetChars) {
      buffer += ' ' + sentence
      continue
    }
    out.push({ pageNumber: segment.pageNumber, text: buffer.trim() })
    buffer = sentence
  }
  if (buffer.trim()) out.push({ pageNumber: segment.pageNumber, text: buffer.trim() })
  return out
}

function buildSegments(pages: PageText[], targetChars: number) {
  const segments: ChunkSegment[] = []
  for (const page of pages) {
    const parts = page.text
      .split(/\n{2,}/g)
      .map((part) => part.trim())
      .filter(Boolean)

    if (parts.length === 0) continue
    for (const part of parts) {
      segments.push(...splitLargeSegment({ pageNumber: page.pageNumber, text: part }, targetChars))
    }
  }
  return segments
}

function joinSegments(segments: ChunkSegment[]) {
  return segments.map((segment) => segment.text.trim()).filter(Boolean).join('\n\n').trim()
}

function overlapSegments(segments: ChunkSegment[], overlapChars: number) {
  if (overlapChars <= 0 || segments.length === 0) return []

  const reversed: ChunkSegment[] = []
  let total = 0
  for (let i = segments.length - 1; i >= 0 && total < overlapChars; i--) {
    const seg = segments[i]!
    const remaining = overlapChars - total
    if (seg.text.length <= remaining) {
      reversed.push(seg)
      total += seg.text.length
      continue
    }
    reversed.push({ pageNumber: seg.pageNumber, text: seg.text.slice(seg.text.length - remaining).trim() })
    total = overlapChars
  }
  return reversed.reverse().filter((segment) => segment.text.length > 0)
}

export function chunkPages(pages: PageText[], opts: ChunkingOptions): Chunk[] {
  const targetChars = Math.max(300, opts.targetChars)
  const overlapChars = Math.max(0, Math.min(opts.overlapChars, Math.floor(targetChars * 0.5)))
  const chunks: Chunk[] = []
  let chunkIndex = 0

  let bufferSegments: ChunkSegment[] = []

  const flush = () => {
    const content = joinSegments(bufferSegments)
    if (!content) return
    const contentHash = crypto.createHash('sha256').update(content, 'utf8').digest('hex')
    const pageNumbers = bufferSegments.map((segment) => segment.pageNumber)
    chunks.push({
      pageStart: Math.min(...pageNumbers),
      pageEnd: Math.max(...pageNumbers),
      chunkIndex,
      content,
      contentHash
    })
    chunkIndex++
    bufferSegments = overlapSegments(bufferSegments, overlapChars)
  }

  for (const segment of buildSegments(pages, targetChars)) {
    const currentLength = joinSegments(bufferSegments).length
    const nextLength = currentLength === 0 ? segment.text.length : currentLength + 2 + segment.text.length
    if (bufferSegments.length > 0 && nextLength > targetChars) {
      flush()
    }

    bufferSegments.push(segment)
    if (joinSegments(bufferSegments).length >= targetChars) {
      flush()
    }
  }

  flush()
  return chunks
}
