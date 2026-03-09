import { createLogger } from '../logger'

const log = createLogger('ocr')

type TesseractWorker = {
  load: () => Promise<void>
  loadLanguage: (lang: string) => Promise<void>
  initialize: (lang: string) => Promise<void>
  recognize: (image: Buffer | Uint8Array) => Promise<{ data: { text: string } }>
  terminate: () => Promise<void>
}

export class OcrService {
  private worker: TesseractWorker | null = null
  private lang: string | null = null
  private creating: Promise<TesseractWorker> | null = null

  private async createWorker(): Promise<TesseractWorker> {
    const tesseract = await import('tesseract.js')
    // On isole l'appel dynamique ici.
    const w = (tesseract as any).createWorker({
      logger: (m: any) => {
        if (m?.status && typeof m?.progress === 'number') {
          log.debug({ status: m.status, progress: m.progress }, 'tesseract')
        }
      }
    }) as TesseractWorker
    await w.load()
    return w
  }

  private async ensureWorker(lang: string) {
    if (!this.worker) {
      if (!this.creating) this.creating = this.createWorker()
      this.worker = await this.creating
      this.creating = null
    }
    if (this.lang !== lang) {
      await this.worker.loadLanguage(lang)
      await this.worker.initialize(lang)
      this.lang = lang
    }
    return this.worker
  }

  async recognizeImage(image: Buffer, lang: string) {
    const worker = await this.ensureWorker(lang)
    const res = await worker.recognize(image)
    return res.data.text ?? ''
  }

  async dispose() {
    if (this.worker) {
      try {
        await this.worker.terminate()
      } catch {
        // On ignore la fermeture ratée.
      }
    }
    this.worker = null
    this.lang = null
    this.creating = null
  }
}
