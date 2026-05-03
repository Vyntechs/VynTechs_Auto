import { sql } from 'drizzle-orm'
import { embed } from '@/lib/ai/embeddings'
import type { AppDb } from '@/lib/db/queries'

export type CorpusComebackInput = {
  vehicleYear: number
  vehicleMake: string
  vehicleModel: string
  rootCause: string
  dtcs?: string[]
}

/**
 * Record a comeback against any corpus entries that match the rebooked
 * vehicle and root cause. Each match has comeback_recorded_count
 * incremented and confidence_score recomputed (now treating the new
 * comeback in the denominator).
 *
 * Auto-retires any entry where comebacks have accumulated AND start to
 * dominate (comebacks >= 3 AND comebacks > successes). Retired entries
 * are excluded from K3 retrieval and from K6 confirmation.
 *
 * Note: this function intentionally uses a smaller fingerprint
 * (rootCause + dtcs) than promote/confirm (which include vehicle +
 * complaint + tags). The 0.15 cosine threshold is consequently looser
 * here in feature-space terms, on purpose: a comeback may surface with
 * different complaint phrasing than the original repair, but the
 * rootCause-and-DTC vector is what we want to penalize.
 */
export async function recordCorpusComeback(
  db: AppDb,
  input: CorpusComebackInput,
): Promise<{ decayed: number; retired: number }> {
  const target = `${input.rootCause} ${(input.dtcs ?? []).join(' ')}`.trim()
  const vector = await embed(target)
  const vecLiteral = `[${vector.join(',')}]`

  const decayed = (await db.execute(sql`
    UPDATE corpus_entries
    SET
      comeback_recorded_count = comeback_recorded_count + 1,
      confidence_score = LEAST(0.99, (success_confirm_count)::float / GREATEST(1, success_confirm_count + comeback_recorded_count + 1)),
      updated_at = NOW()
    WHERE
      is_retired = false
      AND vehicle_make = ${input.vehicleMake}
      AND vehicle_model = ${input.vehicleModel}
      AND ABS(vehicle_year - ${input.vehicleYear}) <= 2
      AND (embedding <=> ${vecLiteral}::vector) < 0.15
    RETURNING id, comeback_recorded_count AS "comebackRecordedCount", success_confirm_count AS "successConfirmCount"
  `)) as unknown as Array<{
    id: string
    comebackRecordedCount: number
    successConfirmCount: number
  }>

  // After increment, check the post-increment counts. The RETURNING reflects
  // the UPDATEd row, so comebackRecordedCount is already the new value.
  const toRetire = decayed.filter(
    (r) => r.comebackRecordedCount >= 3 && r.comebackRecordedCount > r.successConfirmCount,
  )

  if (toRetire.length > 0) {
    const ids = toRetire.map((r) => r.id)
    await db.execute(sql`
      UPDATE corpus_entries
      SET is_retired = true, updated_at = NOW()
      WHERE id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
    `)
  }

  return { decayed: decayed.length, retired: toRetire.length }
}
