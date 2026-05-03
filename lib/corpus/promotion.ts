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

/** Insert a new corpus entry derived from a closed session. Returns the new id. */
export async function promoteSessionToCorpus(
  db: AppDb,
  input: CorpusPromotionInput,
): Promise<string | null> {
  const summary = [
    input.intake.vehicleYear,
    input.intake.vehicleMake,
    input.intake.vehicleModel,
    input.intake.vehicleEngine ?? '',
  ]
    .filter(Boolean)
    .join(' ')
    .trim()
    + `: ${input.outcome.rootCause}`

  const embeddingTarget = [
    summary,
    `DTCs: ${(input.extractedDtcs ?? []).join(' ')}`,
    `Tags: ${(input.extractedSymptomTags ?? []).join(' ')}`,
    `Customer: ${input.intake.customerComplaint}`,
  ]
    .filter(Boolean)
    .join('. ')

  const vector = await embed(embeddingTarget)
  const vecLiteral = `[${vector.join(',')}]`

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
