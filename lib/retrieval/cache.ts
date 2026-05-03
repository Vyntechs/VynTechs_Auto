import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { retrievalCache } from '@/lib/db/schema'
import type { RetrievalContext, RetrievalResult } from './types'

const TTL_MS = 7 * 24 * 60 * 60 * 1000

export function cacheKeyFor(ctx: RetrievalContext, source: string): string {
  const parts = [
    source,
    ctx.vehicleYear,
    ctx.vehicleMake.toLowerCase(),
    ctx.vehicleModel.toLowerCase(),
    ctx.vehicleEngine ?? '',
    (ctx.dtcs ?? []).slice().sort().join(','),
    (ctx.symptomTags ?? []).slice().sort().join(','),
  ].join('|')
  return createHash('sha256').update(parts).digest('hex')
}

export async function getCachedResults(cacheKey: string): Promise<RetrievalResult[] | null> {
  const row = await db.query.retrievalCache.findFirst({
    where: eq(retrievalCache.cacheKey, cacheKey),
  })
  if (!row) return null
  if (new Date(row.expiresAt).getTime() < Date.now()) return null
  return row.results as RetrievalResult[]
}

export async function setCachedResults(
  cacheKey: string,
  source: string,
  results: RetrievalResult[],
): Promise<void> {
  await db
    .insert(retrievalCache)
    .values({
      cacheKey,
      source,
      results,
      expiresAt: new Date(Date.now() + TTL_MS),
    })
    .onConflictDoUpdate({
      target: retrievalCache.cacheKey,
      set: { results, expiresAt: new Date(Date.now() + TTL_MS) },
    })
    .returning({ id: retrievalCache.id })
}
