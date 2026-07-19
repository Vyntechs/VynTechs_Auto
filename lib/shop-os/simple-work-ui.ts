import { z } from 'zod'

const uuid = z.uuid().transform((value) => value.toLowerCase())
const timestamp = z.string().datetime({ offset: true })
const workspace = z.strictObject({
  id: uuid,
  title: z.string().min(1).max(500),
  kind: z.enum(['repair', 'maintenance']),
  workStatus: z.enum(['open', 'in_progress', 'done']),
  workNotes: z.string().max(2_000).nullable(),
  startedAt: timestamp.nullable(),
  completedAt: timestamp.nullable(),
  updatedAt: timestamp,
  authorization: z.enum(['approved', 'declined', 'awaiting_approval']),
})
const work = z.strictObject({
  status: z.enum(['open', 'in_progress', 'done']),
  workNotes: z.string().max(2_000).nullable(),
  startedAt: timestamp.nullable(),
  completedAt: timestamp.nullable(),
  updatedAt: timestamp,
})
const escalationJob = z.strictObject({
  id: uuid,
  title: z.string().min(1).max(520),
  kind: z.literal('repair'),
  requiredSkillTier: z.number().int().min(1).max(3),
  assignedTechId: z.null(),
  workStatus: z.literal('open'),
  approvalState: z.literal('pending_quote'),
  sessionId: z.null(),
})

export type SimpleWorkWorkspaceView = z.infer<typeof workspace>
export type SimpleWorkProjectionView = z.infer<typeof work>
export type SimpleWorkEscalationView = z.infer<typeof escalationJob>

export function parseSimpleWorkWorkspaceResponse(value: unknown): SimpleWorkWorkspaceView | null {
  const parsed = z.strictObject({ workspace }).safeParse(value)
  return parsed.success ? parsed.data.workspace : null
}

export function parseSimpleWorkMutationResponse(
  value: unknown,
): { changed: boolean; work: SimpleWorkProjectionView } | null {
  const parsed = z.strictObject({ changed: z.boolean(), work }).safeParse(value)
  return parsed.success ? parsed.data : null
}

export function parseEscalationResponse(
  value: unknown,
): { changed: boolean; job: SimpleWorkEscalationView } | null {
  const parsed = z.strictObject({ changed: z.boolean(), job: escalationJob }).safeParse(value)
  return parsed.success ? parsed.data : null
}

// Wall-clock time the job spent between "start work" and "complete work",
// rendered plainly for a tech (e.g. "2h 15m", "45m", "under a minute").
// Returns null when there is no finished span to measure yet — either the job
// never started (a pre-clock job) or it is still running.
export function formatWorkDuration(
  startedAt: string | null,
  completedAt: string | null,
): string | null {
  if (!startedAt || !completedAt) return null
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime()
  if (!Number.isFinite(ms)) return null
  const totalMinutes = Math.max(0, Math.round(ms / 60_000))
  if (totalMinutes === 0) return 'under a minute'
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes}m`
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`
}

export type EscalationAttempt = {
  signature: string
  requestKey: string
}

export function retainEscalationAttempt(
  current: EscalationAttempt | null,
  concern: string,
  requiredSkillTier: number,
  createKey: () => string = () => crypto.randomUUID(),
): EscalationAttempt {
  const signature = JSON.stringify([concern.trim(), requiredSkillTier])
  return current?.signature === signature
    ? current
    : { signature, requestKey: createKey() }
}
