import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { createLogger } from '../logger'
import type { AppStore } from '../store'
import { EmbeddingsClient } from './embeddings-client'

const log = createLogger('embeddings-python')

export class EmbeddingsPythonManager {
  private child: ChildProcess | null = null
  private client: EmbeddingsClient
  private starting: Promise<void> | null = null
  private lastStderr: string = ''
  private runningPort: number | null = null
  private runningModelKey: string | null = null
  private shuttingDown = false
  private restartTimer: NodeJS.Timeout | null = null

  constructor(private pythonDir: string, private store: AppStore) {
    const { pythonPort } = this.store.getConfig().embeddings
    this.client = new EmbeddingsClient(`http://127.0.0.1:${pythonPort}`)
  }

  getClient() {
    return this.client
  }

  async ensureStarted() {
    const cfg = this.store.getConfig().embeddings
    const modelKey = `${cfg.model}::${cfg.modelPath ?? ''}`

    // On redémarre si la config a changé.
    if (this.child && (this.runningPort !== cfg.pythonPort || this.runningModelKey !== modelKey)) {
      this.dispose()
    }

    this.client.setBaseUrl(`http://127.0.0.1:${cfg.pythonPort}`)

    // Si le service répond déjà, on le réutilise.
    try {
      const h = await this.client.health(1500)
      if (h.ok) return
    } catch {
      // On continue simplement.
    }

    if (this.starting) {
      try {
        await this.starting
        return
      } catch {
        // On autorise un nouveau départ.
      }
    }

    this.starting = this.start().catch((err) => {
      // On garde la main pour retenter plus tard.
      this.starting = null
      throw err
    })
    return this.starting
  }

  private async start() {
    this.shuttingDown = false
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }

    const cfg = this.store.getConfig().embeddings
    const serverPath = path.join(this.pythonDir, 'server.py')
    const { pythonExe, pythonArgsPrefix } = this.resolvePython()
    const env = {
      ...process.env,
      EMBEDDINGS_PORT: String(cfg.pythonPort),
      EMBEDDINGS_MODEL: cfg.model,
      EMBEDDINGS_MODEL_PATH: cfg.modelPath ?? ''
    }

    // En dev, on réutilise un service déjà vivant.
    try {
      const h = await this.client.health(1500)
      if (h.ok) {
        const desired = `${cfg.model}::${cfg.modelPath ?? ''}`
        const reported = `${h.model ?? ''}::${h.model_path ?? ''}`
        if (h.model && reported !== desired) {
          log.warn({ desired, reported }, 'embeddings server already running with different config; reusing')
        }
        log.info({ port: cfg.pythonPort, model_loaded: h.model_loaded }, 'embeddings service already running')
        this.runningPort = cfg.pythonPort
        this.runningModelKey = `${cfg.model}::${cfg.modelPath ?? ''}`
        return
      }
    } catch {
      // On lance un nouveau process.
    }

    log.info({ pythonExe, serverPath, port: cfg.pythonPort }, 'starting embeddings service')
    const stderrTail: string[] = []
    const stdoutTail: string[] = []

    this.client.setBaseUrl(`http://127.0.0.1:${cfg.pythonPort}`)
    this.runningPort = cfg.pythonPort
    this.runningModelKey = `${cfg.model}::${cfg.modelPath ?? ''}`

    this.child = spawn(pythonExe, [...pythonArgsPrefix, serverPath], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })

    this.child.stdout?.on('data', (d) => {
      const s = d.toString()
      stdoutTail.push(...s.split(/\r?\n/g))
      while (stdoutTail.length > 40) stdoutTail.shift()
      log.debug({ out: s.trim() }, 'py')
    })
    this.child.stderr?.on('data', (d) => {
      const s = d.toString()
      stderrTail.push(...s.split(/\r?\n/g))
      while (stderrTail.length > 40) stderrTail.shift()
      log.info({ pyerr: s.trim() }, 'py-stderr')
    })
    this.child.on?.('exit', (code) => {
      const unexpected = !this.shuttingDown
      log.warn({ code }, 'embeddings service exited')
      this.lastStderr = stderrTail.filter(Boolean).slice(-20).join('\n')
      this.child = null
      this.runningPort = null
      this.runningModelKey = null
      this.starting = null

      if (unexpected && !this.restartTimer) {
        this.restartTimer = setTimeout(() => {
          this.restartTimer = null
          void this.ensureStarted().catch((err) => {
            log.warn({ err }, 'embeddings auto-restart failed')
          })
        }, 1200)
      }
    })

    // On attend que /health réponde.
    const deadline = Date.now() + 180_000
    let lastErr: unknown = null
    let lastLogAt = 0
    while (Date.now() < deadline) {
      if (!this.child) break
      try {
        const h = await this.client.health(2500)
        if (h.ok) {
          log.info({ model_loaded: h.model_loaded }, 'embeddings service ready')
          return
        }
      } catch (err) {
        lastErr = err
      }

      const now = Date.now()
      if (now - lastLogAt > 5000) {
        lastLogAt = now
        log.info({ port: cfg.pythonPort }, 'waiting for embeddings service...')
      }
      await new Promise((r) => setTimeout(r, 500))
    }

    // Même si le process tombe, le port peut déjà répondre.
    try {
      const h = await this.client.health(2500)
      if (h.ok) {
        log.info({ port: cfg.pythonPort, model_loaded: h.model_loaded }, 'embeddings service reachable after spawn failure')
        this.runningPort = cfg.pythonPort
        this.runningModelKey = `${cfg.model}::${cfg.modelPath ?? ''}`
        return
      }
    } catch {
      // On ignore ce cas.
    }

    const stderr = this.lastStderr ? `\nPython stderr (tail):\n${this.lastStderr}` : ''
    throw new Error(`Embeddings service did not start. Last error: ${String(lastErr)}${stderr}`)
  }

  private resolvePython(): { pythonExe: string; pythonArgsPrefix: string[] } {
    const envExe = (process.env.PYTHON ?? '').trim()
    if (envExe) return { pythonExe: envExe, pythonArgsPrefix: [] }

    const venvWin = path.join(this.pythonDir, '.venv', 'Scripts', 'python.exe')
    const venvPosix = path.join(this.pythonDir, '.venv', 'bin', 'python3')
    const venvPosixAlt = path.join(this.pythonDir, '.venv', 'bin', 'python')
    const candidates = [venvWin, venvPosix, venvPosixAlt]
    for (const c of candidates) {
      if (fs.existsSync(c)) return { pythonExe: c, pythonArgsPrefix: [] }
    }

    if (process.platform === 'win32') return { pythonExe: 'py', pythonArgsPrefix: ['-3'] }
    return { pythonExe: 'python3', pythonArgsPrefix: [] }
  }

  dispose() {
    this.shuttingDown = true
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    if (this.child && !this.child.killed) {
      try {
        this.child.kill()
      } catch {
        // On ignore cet arrêt.
      }
    }
    this.child = null
    this.runningPort = null
    this.runningModelKey = null
    this.starting = null
  }
}
