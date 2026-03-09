export function normalizeExtractedText(text: string) {
  return (
    text
      // On unifie l'Unicode.
      .normalize('NFKC')
      // On supprime les césures fantômes.
      .replace(/\u00ad/g, '')
      // On recolle les mots coupés en fin de ligne.
      .replace(/(\p{L}|\p{N})-\s*\n\s*(\p{L}|\p{N})/gu, '$1$2')
      // On nettoie les retours sans casser les paragraphes.
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      // On compacte les espaces.
      .replace(/[ \t]{2,}/g, ' ')
      .trim()
  )
}
