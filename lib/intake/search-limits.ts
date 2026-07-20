export const INTAKE_SEARCH_LIMITS = Object.freeze({
  maxCharacters: 256,
  maxTokens: 8,
  maxTokenCharacters: 64,
})

const LIKE_ESCAPE = '!'

/** Escapes user text for a SQL LIKE/ILIKE pattern using `ESCAPE '!'`. */
export function literalLikeToken(token: string): string {
  return token
    .replaceAll(LIKE_ESCAPE, `${LIKE_ESCAPE}${LIKE_ESCAPE}`)
    .replaceAll('%', `${LIKE_ESCAPE}%`)
    .replaceAll('_', `${LIKE_ESCAPE}_`)
}

function rawSearchTokens(q: string): string[] {
  return q.trim().split(/\s+/).filter((token) => token !== '')
}

export function isIntakeSearchQueryWithinLimits(q: string): boolean {
  if (q.length > INTAKE_SEARCH_LIMITS.maxCharacters) return false
  const tokens = rawSearchTokens(q)
  return tokens.length <= INTAKE_SEARCH_LIMITS.maxTokens
    && tokens.every((token) => token.length <= INTAKE_SEARCH_LIMITS.maxTokenCharacters)
}

/** Defense in depth for direct callers that do not pass through the route. */
export function boundedSearchTokens(q: string): string[] {
  return rawSearchTokens(q)
    .slice(0, INTAKE_SEARCH_LIMITS.maxTokens)
    .map((token) => token.slice(0, INTAKE_SEARCH_LIMITS.maxTokenCharacters))
}
