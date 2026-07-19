export const INTAKE_SEARCH_LIMITS = Object.freeze({
  maxCharacters: 256,
  maxTokens: 8,
  maxTokenCharacters: 64,
})

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
