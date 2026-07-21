import type { TodayTicketJob } from '@/lib/tickets'
import { z } from 'zod'

export type TodayBoardLane = 'mine' | 'open' | 'team' | 'created' | 'parts' | 'hidden'

export type AssignmentEnvelope = {
  ticketId: string
  jobId: string
  workStatus: TodayTicketJob['workStatus']
  state: TodayTicketJob['assignmentState']
  assignedTechName: string | null
}

const activeWorkStatuses = new Set<TodayTicketJob['workStatus']>([
  'open',
  'in_progress',
  'blocked',
])
const assignmentStates = new Set<TodayTicketJob['assignmentState']>([
  'mine',
  'team',
  'unassigned',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseAssignmentEnvelope(
  body: unknown,
  expected: { ticketId: string; jobId: string },
): AssignmentEnvelope | null {
  if (!isRecord(body) || !isRecord(body.assignment)) return null
  const assignment = body.assignment
  if (
    assignment.ticketId !== expected.ticketId ||
    assignment.jobId !== expected.jobId ||
    typeof assignment.workStatus !== 'string' ||
    !activeWorkStatuses.has(assignment.workStatus as TodayTicketJob['workStatus']) ||
    typeof assignment.state !== 'string' ||
    !assignmentStates.has(assignment.state as TodayTicketJob['assignmentState'])
  ) return null

  let assignedTechName: string | null = null
  if (assignment.assignedTechName !== null) {
    if (typeof assignment.assignedTechName !== 'string') return null
    assignedTechName = assignment.assignedTechName.trim()
    if (assignedTechName.length === 0 || assignedTechName.length > 120) return null
  }
  if (assignment.state === 'unassigned' && assignedTechName !== null) return null

  return {
    ticketId: expected.ticketId,
    jobId: expected.jobId,
    workStatus: assignment.workStatus as TodayTicketJob['workStatus'],
    state: assignment.state as TodayTicketJob['assignmentState'],
    assignedTechName,
  }
}

type AssignmentSnapshot = Pick<
  TodayTicketJob,
  'workStatus' | 'canClaim' | 'assignmentState' | 'assignedTechName'
>

export type TodayJobOverride = {
  before: AssignmentSnapshot
  after: AssignmentSnapshot
}

export type TodayBoardLanes = {
  mine: TodayTicketJob[]
  open: TodayTicketJob[]
  team: TodayTicketJob[]
  created: TodayTicketJob[]
  parts: TodayTicketJob[]
}

const todayJobSchema = z.strictObject({
  id: z.uuid(),
  ticketId: z.uuid(),
  ticketNumber: z.number().int().positive(),
  customerName: z.string().max(500).nullable(),
  vehicle: z.strictObject({
    year: z.number().int().min(1886).max(9999),
    make: z.string().min(1).max(120),
    model: z.string().min(1).max(120),
  }).nullable(),
  title: z.string().min(1).max(500),
  kind: z.enum(['diagnostic', 'repair', 'maintenance']),
  requiredSkillTier: z.number().int().min(1).max(3),
  sessionId: z.uuid().nullable(),
  workStatus: z.enum(['open', 'in_progress', 'blocked']),
  approvalState: z.enum(['pending_quote', 'quote_ready', 'sent', 'approved', 'declined', 'deferred']),
  canClaim: z.boolean(),
  assignmentState: z.enum(['mine', 'team', 'unassigned']),
  assignedTechName: z.string().min(1).max(120).nullable(),
  createdByMe: z.boolean(),
  partRequest: z.strictObject({
    id: z.uuid(),
    description: z.string().min(1).max(200),
    preference: z.string().max(200).nullable(),
    quantity: z.number().int().min(1).max(99),
  }).nullable().optional(),
  diagnosticStartState: z.enum(['idle', 'initializing', 'ready', 'failed', 'ambiguous']).optional(),
  diagnosticStartErrorCode: z.enum([
    'rate_limited',
    'open_session_limit',
    'initializer_outcome_uncertain',
    'lease_expired',
  ]).nullable().optional(),
})

const todayJobsResponseSchema = z.strictObject({
  todayJobs: z.strictObject({
    myJobs: z.array(todayJobSchema).max(200),
    openJobs: z.array(todayJobSchema).max(200),
    createdJobs: z.array(todayJobSchema).max(200),
    teamJobs: z.array(todayJobSchema).max(200),
    partsJobs: z.array(todayJobSchema).max(200),
    linkedSessionIds: z.array(z.uuid()).max(200),
    hasMore: z.boolean().optional(),
  }),
})

/**
 * The Today client consumes a bounded, server-authorized projection. Parse it
 * before replacing what the operator is currently looking at: a malformed
 * response must never turn into a false "live" board.
 */
export function parseTodayJobsResponse(value: unknown): {
  myJobs: TodayTicketJob[]
  openJobs: TodayTicketJob[]
  createdJobs: TodayTicketJob[]
  teamJobs: TodayTicketJob[]
  partsJobs: TodayTicketJob[]
  linkedSessionIds: string[]
  hasMore?: boolean
} | null {
  const parsed = todayJobsResponseSchema.safeParse(value)
  return parsed.success ? parsed.data.todayJobs : null
}

type TodayBoardProjectionInput = {
  myJobs: TodayTicketJob[]
  openJobs: TodayTicketJob[]
  teamJobs: TodayTicketJob[]
  createdJobs: TodayTicketJob[]
  partsJobs?: TodayTicketJob[]
  canDispatchWork: boolean
  overrides: ReadonlyMap<string, TodayJobOverride>
}

function assignmentSnapshot(job: TodayTicketJob): AssignmentSnapshot {
  return {
    workStatus: job.workStatus,
    canClaim: job.canClaim,
    assignmentState: job.assignmentState,
    assignedTechName: job.assignedTechName,
  }
}

function sameAssignment(left: AssignmentSnapshot, right: AssignmentSnapshot) {
  return left.workStatus === right.workStatus &&
    left.canClaim === right.canClaim &&
    left.assignmentState === right.assignmentState &&
    left.assignedTechName === right.assignedTechName
}

export function createTodayJobOverride(
  before: TodayTicketJob,
  after: TodayTicketJob,
): TodayJobOverride {
  return {
    before: assignmentSnapshot(before),
    after: assignmentSnapshot(after),
  }
}

export function placeTodayJob(
  job: TodayTicketJob,
  canDispatchWork: boolean,
  needsParts = false,
): TodayBoardLane {
  if (needsParts) return 'parts'
  if (job.assignmentState === 'mine') return 'mine'
  if (job.assignmentState === 'team') {
    if (canDispatchWork) return 'team'
    return job.createdByMe ? 'created' : 'hidden'
  }
  if (job.assignmentState === 'unassigned' && job.workStatus === 'open') return 'open'
  if (job.createdByMe) return 'created'
  return 'hidden'
}

export function projectTodayBoard(input: TodayBoardProjectionInput): TodayBoardLanes {
  const jobs = new Map<string, TodayTicketJob>()
  for (const job of [
    ...input.myJobs,
    ...input.openJobs,
    ...input.teamJobs,
    ...input.createdJobs,
    ...(input.partsJobs ?? []),
  ]) {
    jobs.set(job.id, job)
  }

  for (const [jobId, override] of input.overrides) {
    const current = jobs.get(jobId)
    if (!current || !sameAssignment(assignmentSnapshot(current), override.before)) continue
    jobs.set(jobId, { ...current, ...override.after })
  }

  const lanes: TodayBoardLanes = { mine: [], open: [], team: [], created: [], parts: [] }
  const partsJobIds = new Set((input.partsJobs ?? []).map((job) => job.id))
  for (const job of jobs.values()) {
    const lane = placeTodayJob(job, input.canDispatchWork, partsJobIds.has(job.id))
    if (lane !== 'hidden') lanes[lane].push(job)
  }
  return lanes
}
