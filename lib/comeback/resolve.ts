import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { followUps, sessions } from '@/lib/db/schema'
import { getProfileByUserId } from '@/lib/db/queries'
import type { AppDb } from '@/lib/db/queries'
import type { CorpusComebackInput } from '@/lib/corpus/decay'

const resolveSchema = z.object({
  comebackRecorded: z.boolean(),
  notes: z.string().max(2000).optional(),
})

export type RecordCorpusComebackFn = (
  db: AppDb,
  input: CorpusComebackInput,
) => Promise<{ decayed: number; retired: number }>

export type ResolveFollowUpResult =
  | { ok: true; comebackRecorded: boolean }
  | { ok: false; status: 400 | 404; error: string }

/**
 * Tech-side resolution of a surfaced follow-up. Sets resolvedAt +
 * comebackRecorded + notes. When comebackRecorded === true, fires
 * recordCorpusComeback (DI'd) to decay matching corpus entries.
 * Decay failures are non-fatal: the resolution sticks regardless.
 */
export async function resolveFollowUp(opts: {
  db: AppDb
  userId: string
  followUpId: string
  body: unknown
  recordCorpusComeback: RecordCorpusComebackFn
}): Promise<ResolveFollowUpResult> {
  const profile = await getProfileByUserId(opts.db, opts.userId)
  if (!profile) return { ok: false, status: 400, error: 'no profile' }

  const [followUp] = await opts.db
    .select()
    .from(followUps)
    .where(eq(followUps.id, opts.followUpId))
    .limit(1)
  if (!followUp || followUp.techId !== profile.id) {
    return { ok: false, status: 404, error: 'not found' }
  }
  if (followUp.resolvedAt) {
    return { ok: false, status: 400, error: 'already resolved' }
  }

  const parsed = resolveSchema.safeParse(opts.body)
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.message }
  }

  await opts.db
    .update(followUps)
    .set({
      resolvedAt: new Date(),
      comebackRecorded: parsed.data.comebackRecorded,
      notes: parsed.data.notes ?? null,
    })
    .where(eq(followUps.id, opts.followUpId))

  if (parsed.data.comebackRecorded) {
    try {
      const [session] = await opts.db
        .select()
        .from(sessions)
        .where(eq(sessions.id, followUp.sessionId))
        .limit(1)
      if (session?.outcome) {
        await opts.recordCorpusComeback(opts.db, {
          vehicleYear: session.intake.vehicleYear,
          vehicleMake: session.intake.vehicleMake,
          vehicleModel: session.intake.vehicleModel,
          rootCause: session.outcome.rootCause,
        })
      }
    } catch (err) {
      console.warn('corpus decay failed (follow-up still resolved):', err)
    }
  }

  return { ok: true, comebackRecorded: parsed.data.comebackRecorded }
}
