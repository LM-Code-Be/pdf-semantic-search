import Store from 'electron-store'
import { zAppConfig, type AppConfig } from '@shared/ipc'

const StoreCtor = ((Store as unknown as { default?: typeof Store }).default ?? Store) as typeof Store

const defaultConfig: AppConfig = {
  library: {
    watchFolders: [],
    autoIndexNewFiles: true
  },
  assistant: {
    provider: 'extractive',
    ollamaHost: 'http://127.0.0.1:11434',
    ollamaModel: 'llama3.2:3b-instruct',
    enableInSearch: true
  },
  embeddings: {
    provider: 'python',
    pythonPort: 17831,
    model: 'sentence-transformers/all-MiniLM-L6-v2',
    modelPath: null
  },
  chunking: {
    targetChars: 1200,
    overlapChars: 200
  },
  search: {
    topK: 12,
    weightVector: 0.7,
    weightKeyword: 0.3
  },
  ocr: {
    enabled: false,
    language: 'fra'
  },
  logging: {
    level: 'info'
  }
}

export class AppStore {
  private store = new StoreCtor<AppConfig>({ name: 'config', defaults: defaultConfig })

  getConfig(): AppConfig {
    const cfg = this.store.store
    const parsed = zAppConfig.safeParse(cfg)
    if (parsed.success) return parsed.data
    return defaultConfig
  }

  setConfigPatch(patch: Partial<AppConfig>): AppConfig {
    const cur = this.getConfig()
    const next: AppConfig = {
      ...cur,
      ...patch,
      library: { ...cur.library, ...(patch as any).library },
      assistant: { ...cur.assistant, ...(patch as any).assistant },
      embeddings: { ...cur.embeddings, ...(patch as any).embeddings },
      chunking: { ...cur.chunking, ...(patch as any).chunking },
      search: { ...cur.search, ...(patch as any).search },
      ocr: { ...cur.ocr, ...(patch as any).ocr },
      logging: { ...cur.logging, ...(patch as any).logging }
    }
    const parsed = zAppConfig.safeParse(next)
    if (!parsed.success) return this.getConfig()
    this.store.store = parsed.data
    return parsed.data
  }

  resetToDefaults() {
    this.store.clear()
    this.store.store = defaultConfig
  }
}
