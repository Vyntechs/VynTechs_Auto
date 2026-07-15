import { z } from 'zod'

const uuid = z.uuid().transform((value) => value.toLowerCase())
const timestamp = z.string().datetime({ offset: true })
const workspace = z.strictObject({
  id: uuid,
  title: z.string().min(1).max(500),
  kind: z.enum(['repair', 'maintenance']),
  workStatus: z.enum(['open', 'in_progress', 'done']),
  workNotes: z.string().max(2_000).nullable(),
  updatedAt: timestamp,
  authorization: z.enum(['approved', 'declined', 'awaiting_approval']),
})
const work = z.strictObject({
  status: z.enum(['open', 'in_progress', 'done']),
  workNotes: z.string().max(2_000).nullable(),
  updatedAt: timestamp,
})
const escalationJob = z.strictObject({
  id: uuid,
  title: z.string().min(1).max(520),
  kind: z.literal('diagnostic'),
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
