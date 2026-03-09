import { createLogger } from '../logger'
import { requestJson } from './http-json'

const log = createLogger('embeddings-client')

export type EmbedBatchResponse = {
  model: string
  dim: number
  embeddings: number[][]
}

export class EmbeddingsClient {
  constructor(private baseUrl: string) {}

  setBaseUrl(next: string) {
    this.baseUrl = next
  }

  async health(timeoutMs = 1500): Promise<{ ok: boolean; model_loaded: boolean; model?: string; model_path?: string | null }> {
    return await requestJson(`${this.baseUrl}/health`, { timeoutMs })
  }

  async embedTexts(texts: string[]): Promise<{ model: string; dim: number; vectors: Float32Array[] }> {
    if (texts.length === 0) return { model: 'unknown', dim: 0, vectors: [] }
    const url = `${this.baseUrl}/embed`
    let data: EmbedBatchResponse
    try {
      data = await requestJson<EmbedBatchResponse>(url, {
        method: 'POST',
        body: { texts },
        timeoutMs: 120_000
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const transient =
        msg.includes('ECONNRESET') ||
        msg.includes('ECONNREFUSED') ||
        msg.includes('ETIMEDOUT') ||
        msg.toLowerCase().includes('socket hang up')
      if (!transient) {
        log.warn({ err }, 'embed failed')
        throw err
      }

      log.warn({ err }, 'embed transient failure, retrying once')
      await new Promise((r) => setTimeout(r, 350))
      data = await requestJson<EmbedBatchResponse>(url, {
        method: 'POST',
        body: { texts },
        timeoutMs: 120_000
      })
    }
    const vectors = data.embeddings.map((arr) => Float32Array.from(arr))
    return { model: data.model, dim: data.dim, vectors }
  }
}
