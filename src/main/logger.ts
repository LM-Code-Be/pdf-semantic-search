import pino from 'pino'

const loggers = new Set<pino.Logger>()
let globalLevel: string | null = null

export function setLogLevel(level: 'debug' | 'info' | 'warn' | 'error') {
  globalLevel = level
  for (const l of loggers) l.level = level
}

export function createLogger(scope: string) {
  const level = globalLevel ?? process.env.LOG_LEVEL ?? 'info'
  const logger = pino({
    level,
    base: { scope }
  })
  loggers.add(logger)
  return logger
}
