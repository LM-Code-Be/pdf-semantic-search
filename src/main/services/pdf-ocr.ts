import fs from 'node:fs'
import { createCanvas } from '@napi-rs/canvas'
import { createLogger } from '../logger'
import { loadPdfJs } from './pdfjs'

const log = createLogger('pdf-ocr')

export async function renderPdfPagesToPng(pdfPath: string, pageNumbers: number[], scale = 2) {
  const pdfjs = await loadPdfJs()

  const data = new Uint8Array(fs.readFileSync(pdfPath))
  const doc = await pdfjs.getDocument({ data }).promise

  const out: { pageNumber: number; png: Buffer }[] = []
  for (const pageNumber of pageNumbers) {
    const page = await doc.getPage(pageNumber)
    const viewport = page.getViewport({ scale })
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
    const ctx = canvas.getContext('2d')
    await page.render({ canvasContext: ctx as any, canvas: canvas as any, viewport }).promise
    out.push({ pageNumber, png: canvas.toBuffer('image/png') })
  }

  try {
    await doc.destroy()
  } catch (err) {
    log.debug({ err }, 'doc.destroy failed')
  }
  return out
}
