import type { AppDb } from '@/lib/db/queries'
import type { RetrievalAdapter, RetrievalContext, RetrievalResult, Budget } from './types'
import { DEFAULT_BUDGET } from './types'
import { cacheKeyFor, getCachedResults, setCachedResults } from './cache'

export type RetrievalRun = {
  results: RetrievalResult[]
  queriesUsed: number
  wallClockMs: number
  tokensUsed: number
  cacheHits: string[]
  errors: Array<{ adapterId: string; message: string }>
}

export async function runRetrieval(input: {
  db: AppDb
  adapters: RetrievalAdapter[]
  ctx: RetrievalContext
  budget?: Partial<Budget>
}): Promise<RetrievalRun> {
  const budget: Budget = { ...DEFAULT_BUDGET, ...input.budget }
  const ordered = [...input.adapters].sort((a, b) => b.weight - a.weight)

  const start = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), budget.maxWallClockMs)

  const results: RetrievalResult[] = []
  const cacheHits: string[] = []
  const errors: Array<{ adapterId: string; message: string }> = []
  let queriesUsed = 0
  let tokensUsed = 0

  // Sequential by design — concurrent fan-out would re-introduce the abort race
  // and break per-adapter budget accounting.
  for (const adapter of ordered) {
    if (queriesUsed >= budget.maxQueries) break
    if (Date.now() - start >= budget.maxWallClockMs) break
    if (tokensUsed >= budget.maxTokens) break

    const key = cacheKeyFor(input.ctx, adapter.id)
    const cached = await getCachedResults(input.db, key).catch(() => null)
    if (cached) {
      results.push(...cached)
      cacheHits.push(adapter.id)
      tokensUsed += estimateTokens(cached)
      continue
    }

    queriesUsed++
    try {
      const r = await adapter.query(input.ctx, controller.signal)
      results.push(...r)
      tokensUsed += estimateTokens(r)
      await setCachedResults(input.db, key, adapter.id, r).catch(() => {})
    } catch (err) {
      const aborted =
        controller.signal.aborted ||
        (err instanceof Error && err.name === 'AbortError')
      errors.push({
        adapterId: adapter.id,
        message: aborted
          ? 'wall-clock budget exceeded'
          : err instanceof Error
            ? err.message
            : 'unknown',
      })
    }
  }

  clearTimeout(timeout)
  return { results, queriesUsed, wallClockMs: Date.now() - start, tokensUsed, cacheHits, errors }
}

function estimateTokens(results: RetrievalResult[]): number {
  return Math.ceil(
    results.reduce((s, r) => s + (r.snippet?.length ?? 0) + (r.title?.length ?? 0), 0) / 4,
  )
}
