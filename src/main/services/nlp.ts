const STOPWORDS = new Set([
  'a',
  'à',
  'au',
  'aux',
  'avec',
  'ce',
  'ces',
  'cet',
  'cette',
  'comme',
  'dans',
  'de',
  'des',
  'du',
  'elle',
  'elles',
  'en',
  'entre',
  'est',
  'et',
  'eu',
  'fait',
  'font',
  'il',
  'ils',
  'je',
  'la',
  'le',
  'les',
  'leur',
  'leurs',
  'mais',
  'me',
  'mes',
  'moi',
  'mon',
  'ne',
  'nos',
  'notre',
  'nous',
  'on',
  'ou',
  'où',
  'par',
  'pas',
  'plus',
  'pour',
  'qu',
  'que',
  'quel',
  'quelle',
  'quelles',
  'quels',
  'qui',
  'sa',
  'sans',
  'se',
  'ses',
  'si',
  'son',
  'sont',
  'sur',
  'ta',
  'te',
  'tes',
  'toi',
  'ton',
  'tous',
  'tout',
  'tres',
  'très',
  'tu',
  'un',
  'une',
  'vos',
  'votre',
  'vous',
  'and',
  'are',
  'but',
  'can',
  'for',
  'from',
  'has',
  'have',
  'how',
  'into',
  'its',
  'not',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'was',
  'were',
  'what',
  'when',
  'which',
  'who',
  'why',
  'will',
  'with',
  'would',
  'your'
])

export function stripDiacritics(text: string) {
  return text.normalize('NFKD').replace(/\p{M}+/gu, '')
}

export function normalizeForSearch(text: string) {
  return stripDiacritics(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function tokenizeForSearch(
  text: string,
  opts: { limit?: number; minLen?: number; keepStopwords?: boolean; dedupe?: boolean } = {}
) {
  const limit = opts.limit ?? 24
  const minLen = opts.minLen ?? 3
  const dedupe = opts.dedupe ?? true

  const out: string[] = []
  const seen = new Set<string>()
  for (const token of normalizeForSearch(text).split(' ')) {
    if (!token || token.length < minLen) continue
    if (!opts.keepStopwords && STOPWORDS.has(token)) continue
    if (dedupe) {
      if (seen.has(token)) continue
      seen.add(token)
    }
    out.push(token)
    if (out.length >= limit) break
  }
  return out
}

export function buildFtsQuery(text: string) {
  const tokens = tokenizeForSearch(text, { limit: 8, minLen: 2 })
  if (tokens.length === 0) return ''
  return tokens.map((token) => `${token}*`).join(' OR ')
}

export function splitSentences(text: string) {
  const cleaned = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return []

  const parts = cleaned
    .split(/(?<=[.!?;:])\s+(?=[A-ZÀ-ÖØ-Þ0-9"“«(])/g)
    .map((part) => part.trim())
    .filter(Boolean)

  if (parts.length <= 1) return [cleaned]
  return parts
}

export function queryCoverageScore(text: string, queryTokens: string[]) {
  if (queryTokens.length === 0) return 0
  const normalized = normalizeForSearch(text)
  let hits = 0
  let exactBoost = 0
  for (const token of queryTokens) {
    if (normalized.includes(token)) {
      hits++
      if (normalized.includes(` ${token} `) || normalized.startsWith(`${token} `) || normalized.endsWith(` ${token}`)) {
        exactBoost += 0.1
      }
    }
  }
  return hits / queryTokens.length + exactBoost
}

export function compactWhitespace(text: string) {
  return String(text ?? '').replace(/\s+/g, ' ').trim()
}
