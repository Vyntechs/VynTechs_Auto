import { eq, sql } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/queries'
import {
  corpusEntries,
  founderNotesQueue,
  type FounderNotesQueueRow,
  type NewFounderNotesQueueRow,
} from '@/lib/db/schema'
import type { CuratorCorpusInput } from '@/lib/curator/corpus-actions'
import type { FounderStructureResult } from './structure-note'

/** Initial confidence for founder-authored entries. Matches the destructive
 *  threshold floor (SPEC_8_3_FALLBACK.destructive = 0.95) so a founder-grounded
 *  proposal clears every gating tier on day one. The decay engine will revise
 *  this if comebacks ever land against the entry. See lib/corpus/decay.ts. */
export const FOUNDER_INITIAL_CONFIDENCE = 0.95

export async function enqueueFounderNote(
  db: AppDb,
  input: {
    rawText: string
    createdByUserId: string
    structureResult: FounderStructureResult
  },
): Promise<{ kind: 'ok'; id: string }> {
  const row: NewFounderNotesQueueRow = {
    rawText: input.rawText,
    structuredDraft:
      Object.keys(input.structureResult.draft).length > 0
        ? (input.structureResult.draft as Record<string, unknown>)
        : null,
    parseStatus: input.structureResult.status,
    missingFields: input.structureResult.missingFields,
    llmNotes: input.structureResult.llmNotes ?? null,
    createdByUserId: input.createdByUserId,
  }
  const [inserted] = await db.insert(founderNotesQueue).values(row).returning()
  return { kind: 'ok', id: inserted.id }
}

export async function dismissFounderNote(
  db: AppDb,
  id: string,
  reviewerProfileId: string,
  note: string | null,
): Promise<{ kind: 'ok' }> {
  await db
    .update(founderNotesQueue)
    .set({
      reviewedAt: sql`now()`,
      reviewedDecision: 'dismissed',
      reviewedByUserId: reviewerProfileId,
      reviewedNote: note,
    })
    .where(eq(founderNotesQueue.id, id))
  return { kind: 'ok' }
}

export type PromoteResult =
  | { kind: 'ok'; corpusEntryId: string }
  | { kind: 'already_reviewed' }
  | { kind: 'not_found' }

/**
 * Promote a founder note to a corpus entry. Inserts a row in corpus_entries
 * with entry_source='founder' and confidence_score=FOUNDER_INITIAL_CONFIDENCE,
 * then closes out the queue row with reviewed_decision='promoted' and a back
 * reference to the new corpus_entries.id.
 *
 * Refuses to act if the queue row was already reviewed (idempotency under
 * double-submit). Caller passes the final structured input — the review UI
 * may have edited fields after the LLM's draft, so we don't trust
 * structured_draft as the source of truth.
 */
export async function promoteFounderNote(
  db: AppDb,
  id: string,
  reviewerProfileId: string,
  input: CuratorCorpusInput,
): Promise<PromoteResult> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(founderNotesQueue)
      .where(eq(founderNotesQueue.id, id))
      .limit(1)

    if (!existing) return { kind: 'not_found' as const }
    if (existing.reviewedAt !== null) return { kind: 'already_reviewed' as const }

    const [entry] = await tx
      .insert(corpusEntries)
      .values({
        vehicleYear: input.vehicleYear,
        vehicleMake: input.vehicleMake,
        vehicleModel: input.vehicleModel,
        vehicleEngine: input.vehicleEngine,
        symptomTags: input.symptomTags,
        dtcs: input.dtcs,
        summary: input.summary,
        freezeFramePattern: input.freezeFramePattern,
        rootCause: input.rootCause,
        actionType: input.actionType,
        partInfo: input.partInfo,
        verification: input.verification,
        isCuratorEntry: true,
        entrySource: 'founder',
        confidenceScore: FOUNDER_INITIAL_CONFIDENCE,
        sourceSessionId: null,
        sourceShopId: null,
        curatedByUserId: reviewerProfileId,
      })
      .returning()

    await tx
      .update(founderNotesQueue)
      .set({
        reviewedAt: sql`now()`,
        reviewedDecision: 'promoted',
        reviewedByUserId: reviewerProfileId,
        resultingCorpusEntryId: entry.id,
      })
      .where(eq(founderNotesQueue.id, id))

    return { kind: 'ok' as const, corpusEntryId: entry.id }
  })
}

export type { FounderNotesQueueRow }
