import http from 'node:http'
import https from 'node:https'
import { URL } from 'node:url'

export type JsonRequestOptions = {
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: unknown
  timeoutMs?: number
}

export async function requestJson<T>(url: string, opts?: JsonRequestOptions): Promise<T> {
  const u = new URL(url)
  const lib = u.protocol === 'https:' ? https : http
  const method = opts?.method ?? 'GET'
  const timeoutMs = opts?.timeoutMs ?? 5000
  const headers: Record<string, string> = { ...(opts?.headers ?? {}) }

  let body: string | null = null
  if (opts?.body !== undefined) {
    body = JSON.stringify(opts.body)
    headers['Content-Type'] ??= 'application/json'
    headers['Content-Length'] = Buffer.byteLength(body).toString()
  }

  return await new Promise<T>((resolve, reject) => {
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port,
        path: `${u.pathname}${u.search}`,
        method,
        headers
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)))
        res.on('end', () => {
          const status = res.statusCode ?? 0
          const text = Buffer.concat(chunks).toString('utf8')
          if (status < 200 || status >= 300) {
            reject(new Error(`${status} ${res.statusMessage ?? ''}`.trim() + (text ? `: ${text.slice(0, 400)}` : '')))
            return
          }
          try {
            resolve(JSON.parse(text) as T)
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)))
          }
        })
      }
    )

    req.on('error', (err) => reject(err))
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Request timeout')))
    if (body != null) req.write(body)
    req.end()
  })
}

