import { eq, sql } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/queries'
import { corpusEntries, novelPatternQueue } from '@/lib/db/schema'

export type CuratorCorpusInput = {
  vehicleYear: number
  vehicleMake: string
  vehicleModel: string
  // schema column is nullable, but new curator-authored entries are stricter:
  // engine info is required for retrieval quality. Don't propagate this into the
  // corpus_entries schema column itself — historical entries may legitimately lack it.
  vehicleEngine: string
  symptomTags: string[]
  dtcs: string[]
  summary: string  // notNull text — the case narrative
  freezeFramePattern: Record<string, string | number>  // typed jsonb
  rootCause: string  // notNull text
  actionType: 'part_replacement' | 'repair' | 'adjustment' | 'cleaning' | 'no_fix' | 'referred'  // notNull enum
  partInfo: { name?: string; oemNumber?: string; cost?: number } | null  // nullable jsonb
  verification: { codesCleared: boolean; testDrive: boolean; symptomsResolved: 'yes' | 'no' | 'partial' }  // notNull jsonb, strict shape
}

export async function createCuratorCorpusEntry(
  db: AppDb,
  curatorProfileId: string,
  input: CuratorCorpusInput,
  options: { fromQueueEntryId?: string } = {},
): Promise<{ kind: 'ok'; id: string }> {
  return db.transaction(async (tx) => {
    const [entry] = await tx.insert(corpusEntries).values({
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
      sourceSessionId: null,
      sourceShopId: null,
      curatedByUserId: curatorProfileId,
    }).returning()

    if (options.fromQueueEntryId) {
      await tx.update(novelPatternQueue).set({
        reviewedAt: sql`now()`,
        reviewedDecision: 'corpus',
        reviewedByUserId: curatorProfileId,
      }).where(eq(novelPatternQueue.id, options.fromQueueEntryId))
    }

    return { kind: 'ok' as const, id: entry.id }
  })
}
