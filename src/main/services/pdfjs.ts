import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

let configured = false

export async function loadPdfJs() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  if (!configured) {
    const require = createRequire(import.meta.url)
    const workerPath = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')
    // On passe ici par l'API PDF.js non typée.
    ;(pdfjs as any).GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href
    configured = true
  }
  return pdfjs
}
