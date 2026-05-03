import { sql } from 'drizzle-orm'
import { embed } from '@/lib/ai/embeddings'
import type { AppDb } from '@/lib/db/queries'
import type { IntakePayload, OutcomePayload } from '@/lib/types'

export type CorpusPromotionInput = {
  sessionId: string
  shopId: string
  curatedByUserId?: string
  intake: IntakePayload
  outcome: OutcomePayload
  extractedDtcs?: string[]
  extractedSymptomTags?: string[]
  freezeFramePattern?: Record<string, string | number>
}

/**
 * Build the canonical embedding-target text. Used both at promote-time
 * (when storing the new entry's vector) AND at confirm-time (so the
 * cosine-distance comparison against the stored vector is meaningful).
 * Without a shared fingerprint, K6's 0.15-cosine threshold compares
 * different feature spaces and rarely matches anything.
 */
function buildEmbeddingTarget(input: CorpusPromotionInput): string {
  const summary = makeSummary(input)
  return [
    summary,
    `DTCs: ${(input.extractedDtcs ?? []).join(' ')}`,
    `Tags: ${(input.extractedSymptomTags ?? []).join(' ')}`,
    `Customer: ${input.intake.customerComplaint}`,
  ]
    .filter(Boolean)
    .join('. ')
}

function makeSummary(input: CorpusPromotionInput): string {
  const head = [
    input.intake.vehicleYear,
    input.intake.vehicleMake,
    input.intake.vehicleModel,
    input.intake.vehicleEngine ?? '',
  ]
    .filter(Boolean)
    .join(' ')
    .trim()
  return `${head}: ${input.outcome.rootCause}`
}

/**
 * Insert a new corpus entry derived from a closed session, OR — if a
 * very similar entry already exists in the same vehicle window — bump
 * its success_confirm_count instead and return null.
 *
 * Returns the inserted entry's id, or null when an existing entry was
 * confirmed (no INSERT occurred).
 */
export async function promoteSessionToCorpus(
  db: AppDb,
  input: CorpusPromotionInput,
): Promise<string | null> {
  const target = buildEmbeddingTarget(input)
  const vector = await embed(target)
  const vecLiteral = `[${vector.join(',')}]`

  const { confirmed } = await confirmWithVec(db, vecLiteral, input)
  if (confirmed > 0) {
    // An existing entry covered this outcome; its confidence has been
    // bumped. No new entry needed.
    return null
  }

  const summary = makeSummary(input)
  const rows = (await db.execute(sql`
    INSERT INTO corpus_entries (
      vehicle_year, vehicle_make, vehicle_model, vehicle_engine,
      symptom_tags, dtcs, freeze_frame_pattern,
      root_cause, summary, action_type, part_info, verification,
      source_shop_id, source_session_id, curated_by_user_id,
      success_confirm_count, comeback_recorded_count, confidence_score,
      is_curator_entry, embedding
    ) VALUES (
      ${input.intake.vehicleYear},
      ${input.intake.vehicleMake},
      ${input.intake.vehicleModel},
      ${input.intake.vehicleEngine ?? null},
      ${input.extractedSymptomTags ?? []}::text[],
      ${input.extractedDtcs ?? []}::text[],
      ${JSON.stringify(input.freezeFramePattern ?? null)}::jsonb,
      ${input.outcome.rootCause},
      ${summary},
      ${input.outcome.actionType},
      ${JSON.stringify(input.outcome.partInfo ?? null)}::jsonb,
      ${JSON.stringify(input.outcome.verification)}::jsonb,
      ${input.shopId},
      ${input.sessionId},
      ${input.curatedByUserId ?? null},
      1, 0, 0.5,
      ${input.curatedByUserId ? true : false},
      ${vecLiteral}::vector
    )
    RETURNING id
  `)) as unknown as Array<{ id: string }>

  return rows[0]?.id ?? null
}

/**
 * Bump success_confirm_count and recompute confidence_score on any
 * non-retired corpus entry within the same vehicle window (year ±2)
 * whose stored embedding is within cosine distance 0.15 of the new
 * outcome's fingerprint. Returns the count of rows updated.
 *
 * The threshold is intentionally tight (0.15) so casual re-occurrences
 * of vaguely-related outcomes don't inflate confidence. K7's decay
 * uses the same threshold so confirms and comebacks operate on the
 * same neighborhood.
 */
export async function confirmSimilarCorpusEntries(
  db: AppDb,
  input: CorpusPromotionInput,
): Promise<{ confirmed: number }> {
  const target = buildEmbeddingTarget(input)
  const vector = await embed(target)
  const vecLiteral = `[${vector.join(',')}]`
  return confirmWithVec(db, vecLiteral, input)
}

async function confirmWithVec(
  db: AppDb,
  vecLiteral: string,
  input: CorpusPromotionInput,
): Promise<{ confirmed: number }> {
  const updated = (await db.execute(sql`
    UPDATE corpus_entries
    SET
      success_confirm_count = success_confirm_count + 1,
      confidence_score = LEAST(0.99, (success_confirm_count + 1)::float / GREATEST(1, success_confirm_count + comeback_recorded_count + 1)),
      updated_at = NOW()
    WHERE
      is_retired = false
      AND vehicle_make = ${input.intake.vehicleMake}
      AND vehicle_model = ${input.intake.vehicleModel}
      AND ABS(vehicle_year - ${input.intake.vehicleYear}) <= 2
      AND (embedding <=> ${vecLiteral}::vector) < 0.15
    RETURNING id
  `)) as unknown as Array<{ id: string }>
  return { confirmed: updated.length }
}

/**
 * Heuristic mapping from a free-text customer complaint to coarse symptom tags
 * that match the corpus_entries.symptom_tags GIN index. Phase Q's calibration
 * engine refines tagging over time; this is the bootstrap classifier.
 */
export function inferSymptomTags(complaint: string): string[] {
  const tags: string[] = []
  const text = complaint.toLowerCase()
  if (/power|stall|hesit|sluggish/.test(text)) tags.push('power_loss')
  if (/start|crank|no.?start|won.?t start/.test(text)) tags.push('starting_issue')
  if (/misfire|rough|stumble/.test(text)) tags.push('misfire')
  if (/check.?engine|cel|wrench|warning|light/.test(text)) tags.push('warning_light')
  if (/overheat|coolant|temp/.test(text)) tags.push('overheat')
  if (/leak/.test(text)) tags.push('leak')
  if (/noise|knock|squeal|whine|tick/.test(text)) tags.push('abnormal_noise')
  if (/brake/.test(text)) tags.push('brake')
  return tags
}
