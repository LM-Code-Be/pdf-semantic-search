import { describe, expect, it } from 'vitest'
import { chunkPages } from './chunking'

describe('chunkPages', () => {
  it('creates chunks with overlap and page ranges', () => {
    const pages = [
      { pageNumber: 1, text: 'A'.repeat(600) },
      { pageNumber: 2, text: 'B'.repeat(700) }
    ]
    const chunks = chunkPages(pages, { targetChars: 800, overlapChars: 100 })
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    expect(chunks[0]!.pageStart).toBe(1)
    expect(chunks[0]!.pageEnd).toBeGreaterThanOrEqual(1)
    expect(chunks[1]!.content.length).toBeGreaterThan(0)
  })
})

