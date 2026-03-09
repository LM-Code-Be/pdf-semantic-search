import { createLogger } from '../logger'
import { normalizeExtractedText } from './text-normalize'
import fs from 'node:fs'
import { loadPdfJs } from './pdfjs'

const log = createLogger('pdf-extract')

export type ExtractedPage = { pageNumber: number; text: string }

type TextItemLike = {
  str?: string
  transform?: number[]
  width?: number
  height?: number
  hasEOL?: boolean
}

function asTextItems(items: unknown[]): Array<Required<Pick<TextItemLike, 'str'>> & { x: number; y: number; width: number; height: number; hasEOL: boolean }> {
  const out: Array<Required<Pick<TextItemLike, 'str'>> & { x: number; y: number; width: number; height: number; hasEOL: boolean }> = []
  for (const raw of items) {
    const item = raw as TextItemLike
    if (typeof item?.str !== 'string' || !item.str.trim()) continue
    const transform = Array.isArray(item.transform) ? item.transform : []
    out.push({
      str: item.str,
      x: typeof transform[4] === 'number' ? transform[4] : 0,
      y: typeof transform[5] === 'number' ? transform[5] : 0,
      width: typeof item.width === 'number' ? item.width : 0,
      height: typeof item.height === 'number' ? item.height : Math.abs(typeof transform[3] === 'number' ? transform[3] : 0),
      hasEOL: item.hasEOL === true
    })
  }
  return out
}

function buildLineText(items: ReturnType<typeof asTextItems>) {
  if (items.length === 0) return ''
  const ordered = [...items].sort((a, b) => a.x - b.x)
  let out = ''
  let prev: (typeof ordered)[number] | null = null
  for (const item of ordered) {
    const text = item.str.trim()
    if (!text) continue
    if (!prev) {
      out += text
      prev = item
      continue
    }

    const prevRight = prev.x + prev.width
    const gap = item.x - prevRight
    const lineHeight = Math.max(prev.height || 0, item.height || 0, 8)
    const needsSpace =
      gap > lineHeight * 0.18 &&
      !/[(/-]$/.test(out) &&
      !/^[,.;:!?%)\]]/.test(text)

    out += needsSpace ? ` ${text}` : text
    prev = item
  }
  return out.trim()
}

function buildPageText(items: ReturnType<typeof asTextItems>) {
  if (items.length === 0) return ''

  const lines: Array<{ y: number; height: number; items: ReturnType<typeof asTextItems> }> = []
  let current: { y: number; height: number; items: ReturnType<typeof asTextItems> } | null = null

  for (const item of items) {
    const tolerance = Math.max(2.5, (item.height || 10) * 0.45)
    if (!current || Math.abs(current.y - item.y) > tolerance) {
      current = { y: item.y, height: item.height || 10, items: [item] }
      lines.push(current)
    } else {
      current.items.push(item)
      current.y = (current.y + item.y) / 2
      current.height = Math.max(current.height, item.height || 0)
    }

    if (item.hasEOL) current = null
  }

  const paragraphs: string[] = []
  let currentParagraph = ''
  let prevLine: { y: number; height: number } | null = null

  for (const line of lines) {
    const text = buildLineText(line.items)
    if (!text) continue

    const verticalGap = prevLine ? Math.abs(prevLine.y - line.y) : 0
    const paragraphBreak =
      !prevLine ||
      verticalGap > Math.max(prevLine.height, line.height) * 1.5 ||
      /^([-\u2022*]|\d+[.)])\s/.test(text)

    if (paragraphBreak) {
      if (currentParagraph.trim()) paragraphs.push(currentParagraph.trim())
      currentParagraph = text
    } else if (currentParagraph.endsWith('-')) {
      currentParagraph = currentParagraph.slice(0, -1) + text
    } else {
      currentParagraph += ` ${text}`
    }
    prevLine = { y: line.y, height: line.height }
  }

  if (currentParagraph.trim()) paragraphs.push(currentParagraph.trim())
  return paragraphs.join('\n\n')
}

export class PdfTextExtractor {
  async extractPages(pdfPath: string, onProgress?: (done: number, total: number) => void): Promise<{
    pages: ExtractedPage[]
    pageCount: number
  }> {
    const pdfjs = await loadPdfJs()

    const data = new Uint8Array(fs.readFileSync(pdfPath))
    const doc = await pdfjs.getDocument({ data }).promise
    const pageCount = doc.numPages
    const pages: ExtractedPage[] = []

    for (let i = 1; i <= pageCount; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      const textItems = asTextItems(content.items as unknown[])
      const raw = buildPageText(textItems)
      const text = normalizeExtractedText(raw)
      pages.push({ pageNumber: i, text })
      onProgress?.(i, pageCount)
    }

    try {
      await doc.destroy()
    } catch (err) {
      log.debug({ err }, 'doc.destroy failed')
    }

    return { pages, pageCount }
  }
}
