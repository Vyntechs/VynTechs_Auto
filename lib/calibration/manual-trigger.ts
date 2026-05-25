// Curator-only "run analysis now" handler. Same engine as the weekly cron;
// the curator console invokes this when they want a fresh drift_alerts pass
// without waiting for Monday 6am UTC. The role gate is the only thing that
// distinguishes this from the cron — both delegate to runCalibrationAnalysis.
import { eq } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/queries'
import { profiles } from '@/lib/db/schema'
import { canCurate } from '@/lib/curator/can-curate'
import {
  runCalibrationAnalysis,
  type CalibrationAnalysisResult,
} from './run-weekly'

export type TriggerResult =
  | { ok: true; result: CalibrationAnalysisResult }
  | { ok: false; status: 401 | 403; error: string }

export async function triggerCalibrationAnalysis(input: {
  db: AppDb
  userId: string | null
  userEmail: string | null
}): Promise<TriggerResult> {
  if (!input.userId) {
    return { ok: false, status: 401, error: 'unauthorized' }
  }
  const [profile] = await input.db
    .select()
    .from(profiles)
    .where(eq(profiles.userId, input.userId))
    .limit(1)
  if (!canCurate(profile?.isCurator, input.userEmail)) {
    return { ok: false, status: 403, error: 'forbidden' }
  }
  const result = await runCalibrationAnalysis(input.db)
  return { ok: true, result }
}
