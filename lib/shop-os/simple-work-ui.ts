import { z } from 'zod'
import { parsePartRequestListResponse, type PartRequestView } from './part-requests-ui'

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
  clockedOnSince: timestamp.nullable(),
  activeSeconds: z.number().int().min(0),
  updatedAt: timestamp,
  authorization: z.enum(['approved', 'declined', 'awaiting_approval']),
})
const work = z.strictObject({
  status: z.enum(['open', 'in_progress', 'done']),
  workNotes: z.string().max(2_000).nullable(),
  startedAt: timestamp.nullable(),
  completedAt: timestamp.nullable(),
  clockedOnSince: timestamp.nullable(),
  activeSeconds: z.number().int().min(0),
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

export function parseInlineSimpleWorkResponse(value: unknown): {
  workspace: SimpleWorkWorkspaceView
  partRequests: PartRequestView[]
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const keys = Object.keys(value).sort()
  if (keys.length !== 2 || keys[0] !== 'partRequests' || keys[1] !== 'workspace') return null
  const envelope = value as { workspace?: unknown; partRequests?: unknown }
  const parsedWorkspace = parseSimpleWorkWorkspaceResponse({ workspace: envelope.workspace })
  const partRequests = parsePartRequestListResponse({ requests: envelope.partRequests })
  return parsedWorkspace && partRequests ? { workspace: parsedWorkspace, partRequests } : null
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

// Total actual seconds a tech has clocked on this job: the seconds already
// banked from finished on/off intervals, plus the currently-open interval
// (now - clockedOnSince) when the tech is clocked on right now. `nowMs` is
// passed in so the value is deterministic in tests and can tick live in the UI.
export function activeDurationSeconds(
  activeSeconds: number,
  clockedOnSince: string | null,
  nowMs: number,
): number {
  const banked = Number.isFinite(activeSeconds) ? Math.max(0, activeSeconds) : 0
  if (!clockedOnSince) return banked
  const openMs = nowMs - new Date(clockedOnSince).getTime()
  if (!Number.isFinite(openMs) || openMs <= 0) return banked
  return banked + Math.floor(openMs / 1_000)
}

// Render a number of seconds as plain time on the job (e.g. "2h 15m", "45m",
// "under a minute"). Zero and sub-minute both read as "under a minute".
export function formatDurationSeconds(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 60) return 'under a minute'
  const totalMinutes = Math.floor(totalSeconds / 60)
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
