import { requestJson } from './http-json'

export type OllamaChatResponse = {
  model?: string
  message?: { role?: string; content?: string }
}

export class OllamaClient {
  constructor(private host: string) {}

  setHost(next: string) {
    this.host = next
  }

  async version(timeoutMs = 1200): Promise<{ version: string }> {
    return await requestJson(`${this.host.replace(/\/+$/g, '')}/api/version`, { timeoutMs })
  }

  async chatJson(
    model: string,
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    timeoutMs = 90_000
  ): Promise<unknown> {
    const res = await requestJson<OllamaChatResponse>(`${this.host.replace(/\/+$/g, '')}/api/chat`, {
      method: 'POST',
      body: {
        model,
        stream: false,
        format: 'json',
        options: { temperature: 0 },
        messages
      },
      timeoutMs
    })

    const content = res.message?.content ?? ''
    const trimmed = content.trim()
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start === -1 || end === -1 || end <= start) throw new Error('Ollama returned non-JSON content')
    const jsonText = trimmed.slice(start, end + 1)
    return JSON.parse(jsonText) as unknown
  }
}

