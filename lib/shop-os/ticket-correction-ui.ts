import { z } from 'zod'
import { parseQuoteBuilderProjection } from '@/lib/shop-os/quote-builder-ui'
import type { QuoteBuilderResult } from '@/lib/shop-os/quotes'
import type { TicketDetail } from '@/lib/tickets'
import type { TicketCorrectionTarget } from '@/lib/shop-os/ticket-correction-draft'

export type TicketCorrectionScope = 'identity' | 'concern' | 'job' | 'job_removed'
export type TicketCorrectionOutcome = 'changed' | 'replayed' | 'unchanged'
export type TicketCorrectionQuoteProjection = Extract<
  QuoteBuilderResult,
  { ok: true }
>['builder']

export type TicketCorrectionBaseline = {
  ticket: TicketDetail
  quote: TicketCorrectionQuoteProjection
  eligibility: TicketCorrectionEligibility
}

export type TicketCorrectionEligibility =
  | { ok: true }
  | {
      ok: false
      reason:
        | 'work_started'
        | 'work_blocked'
        | 'work_not_open'
        | 'session_linked'
        | 'diagnostic_starting'
        | 'diagnostic_ambiguous'
      message: string
    }

export type TicketCorrectionSuccess = {
  outcome: TicketCorrectionOutcome
  changed: boolean
  scope: TicketCorrectionScope
  invalidatedVersionNumber: number | null
  ticket: TicketDetail
}

const uuid = z.uuid().transform((value) => value.toLowerCase())
const date = z.string().datetime({ offset: true }).transform((value) => new Date(value))
const nullableText = (maximum: number) => z.string().max(maximum).nullable()

const assignedTechSchema = z.strictObject({
  id: uuid,
  fullName: nullableText(200),
  role: z.string().min(1).max(100),
  skillTier: z.number().int().min(1).max(3).nullable(),
})

const jobSchema = z.strictObject({
  id: uuid,
  title: z.string().min(1).max(200),
  kind: z.enum(['diagnostic', 'repair', 'maintenance']),
  requiredSkillTier: z.number().int().min(1).max(3),
  assignedTechId: uuid.nullable(),
  assignedTech: assignedTechSchema.nullable(),
  sessionId: uuid.nullable(),
  workStatus: z.enum(['open', 'in_progress', 'blocked', 'done', 'canceled']),
  approvalState: z.enum([
    'pending_quote', 'quote_ready', 'sent', 'approved', 'declined', 'deferred',
  ]),
  customerSuppliedPartsNote: nullableText(500),
  workNotes: nullableText(20_000),
  diagnosticStartState: z.enum(['idle', 'initializing', 'ready', 'failed', 'ambiguous']),
  diagnosticStartErrorCode: nullableText(100),
  createdAt: date,
  updatedAt: date,
}).superRefine((job, context) => {
  if ((job.assignedTechId === null) !== (job.assignedTech === null)) {
    context.addIssue({ code: 'custom', message: 'assignment projection is incomplete' })
  }
  if (job.assignedTech && job.assignedTech.id !== job.assignedTechId) {
    context.addIssue({ code: 'custom', message: 'assignment projection is mismatched' })
  }
})

const activitySchema = z.strictObject({
  id: uuid,
  jobId: uuid.nullable(),
  kind: z.enum([
    'work_paused', 'work_resumed', 'job_blocked', 'job_hold_resolved', 'job_reassigned',
    'job_handed_off', 'ticket_canceled', 'ticket_reopened', 'ticket_corrected',
  ]),
  actorName: nullableText(200),
  summary: z.string().min(1).max(1_000),
  correctionScope: z.enum(['identity', 'concern', 'job', 'job_removed']).nullable(),
  createdAt: date,
}).superRefine((activity, context) => {
  if (activity.kind !== 'ticket_corrected' && activity.correctionScope !== null) {
    context.addIssue({ code: 'custom', message: 'correction scope is inconsistent' })
  }
  if ((activity.correctionScope === 'job' || activity.correctionScope === 'job_removed')
    && activity.jobId === null) {
    context.addIssue({ code: 'custom', message: 'job correction scope is incomplete' })
  }
  if ((activity.correctionScope === 'identity' || activity.correctionScope === 'concern')
    && activity.jobId !== null) {
    context.addIssue({ code: 'custom', message: 'ticket correction scope is mismatched' })
  }
})

const ticketSchema = z.strictObject({
  id: uuid,
  ticketNumber: z.number().int().min(1).max(2_147_483_647),
  source: z.enum(['counter', 'tech_quick', 'quick_quote', 'legacy_repair_order']),
  status: z.enum(['open', 'closed', 'canceled']),
  concern: z.string().min(1).max(5_000),
  whenStarted: nullableText(500),
  howOften: nullableText(500),
  diagnosticAuthorizedCents: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
  diagnosticAuthorizationNote: nullableText(1_000),
  customer: z.strictObject({
    id: uuid,
    name: z.string().min(1).max(200),
    phone: z.string().min(1).max(100),
    email: z.string().email().max(320).nullable(),
  }).nullable(),
  vehicle: z.strictObject({
    id: uuid,
    year: z.number().int().min(1886).max(new Date().getFullYear() + 1),
    make: z.string().min(1).max(100),
    model: z.string().min(1).max(100),
    engine: nullableText(200),
    vin: z.string().length(17).nullable(),
    mileage: z.number().int().min(0).max(2_147_483_647).nullable(),
    plate: nullableText(32),
  }).nullable(),
  jobs: z.array(jobSchema).max(500),
  activities: z.array(activitySchema).max(20),
  correctedRemovedJobIds: z.array(uuid).max(500).optional(),
  createdAt: date,
  updatedAt: date,
}).superRefine((ticket, context) => {
  const jobIds = ticket.jobs.map((job) => job.id)
  if (new Set(jobIds).size !== jobIds.length) {
    context.addIssue({ code: 'custom', message: 'duplicate job IDs' })
  }
  if (ticket.activities.some((activity) => (
    activity.jobId !== null && !jobIds.includes(activity.jobId)
  ))) context.addIssue({ code: 'custom', message: 'activity job is not on this ticket' })
  if (ticket.correctedRemovedJobIds
    && (new Set(ticket.correctedRemovedJobIds).size !== ticket.correctedRemovedJobIds.length
      || ticket.correctedRemovedJobIds.some((jobId) => !jobIds.includes(jobId)))) {
    context.addIssue({ code: 'custom', message: 'removed correction job is not unique on this ticket' })
  }
})

export function parseTicketCorrectionBaseline(
  value: unknown,
  expected: { ticketId: string; target: TicketCorrectionTarget },
): TicketCorrectionBaseline | null {
  if (!isExactRecord(value, ['ticket', 'quote'])) return null
  const ticket = parseTicket(value.ticket)
  const quote = parseQuoteBuilderProjection(value.quote)
  if (!ticket || !quote || !truthMatches(ticket, quote, expected.ticketId, expected.target)) {
    return null
  }
  return { ticket, quote, eligibility: correctionEligibility(ticket, expected.target) }
}

export function parseTicketCorrectionQuoteResponse(
  value: unknown,
  ticketId: string,
): TicketCorrectionQuoteProjection | null {
  if (!isExactRecord(value, ['builder'])) return null
  const quote = parseQuoteBuilderProjection(value.builder)
  return quote && quote.ticket.id === ticketId.toLowerCase() ? quote : null
}

export function quoteMatchesTicket(
  ticket: TicketDetail,
  quote: TicketCorrectionQuoteProjection,
): boolean {
  const quoteVisibleJobs = ticket.jobs.filter((job) => (
    job.workStatus === 'open'
      || job.workStatus === 'in_progress'
      || job.workStatus === 'blocked'
  ))
  const jobs = new Map(quoteVisibleJobs.map((job) => [job.id, job]))
  return quote.ticket.id === ticket.id
    && quote.jobs.length === quoteVisibleJobs.length
    && quote.jobs.every((quoteJob) => {
      const ticketJob = jobs.get(quoteJob.id)
      return ticketJob !== undefined
        && quoteJob.title === ticketJob.title
        && quoteJob.kind === ticketJob.kind
        && (quoteJob.customerSuppliedPartsNote ?? null)
          === (ticketJob.customerSuppliedPartsNote ?? null)
        && quoteJob.workStatus === ticketJob.workStatus
        && quoteJob.approval.state === ticketJob.approvalState
    })
}

export function parseTicketCorrectionSuccess(
  value: unknown,
  expected: {
    ticketId: string
    expectedScope: TicketCorrectionScope
    target: TicketCorrectionTarget
  },
): TicketCorrectionSuccess | null {
  if (!isExactRecord(value, [
    'outcome', 'changed', 'scope', 'invalidatedVersionNumber', 'ticket',
  ])) return null
  const envelope = z.strictObject({
    outcome: z.enum(['changed', 'replayed', 'unchanged']),
    changed: z.boolean(),
    scope: z.enum(['identity', 'concern', 'job', 'job_removed']),
    invalidatedVersionNumber: z.number().int().min(1).max(2_147_483_647).nullable(),
    ticket: z.unknown(),
  }).safeParse(value)
  if (!envelope.success) return null
  const ticket = parseTicket(envelope.data.ticket)
  if (!ticket
    || ticket.id !== expected.ticketId.toLowerCase()
    || ticket.status !== 'open'
    || envelope.data.scope !== expected.expectedScope
    || (envelope.data.outcome === 'changed') !== envelope.data.changed
    || (envelope.data.outcome === 'unchanged'
      && envelope.data.invalidatedVersionNumber !== null)
    || !successMatchesTarget(ticket, envelope.data.scope, expected.target)) return null
  return { ...envelope.data, ticket }
}

function successMatchesTarget(
  ticket: TicketDetail,
  scope: TicketCorrectionScope,
  target: TicketCorrectionTarget,
): boolean {
  if (scope === 'identity') return target.kind === 'identity'
  if (scope === 'concern') return target.kind === 'concern'
  if (target.kind !== 'job') return false
  const job = ticket.jobs.find((candidate) => candidate.id === target.jobId.toLowerCase())
  if (!job) return false
  return scope === 'job_removed' ? job.workStatus === 'canceled' : job.workStatus !== 'canceled'
}

export function correctionAnnouncementFor(input: {
  outcome: TicketCorrectionOutcome
  scope: TicketCorrectionScope
  ticket: Pick<TicketDetail, 'jobs'> | { jobs: Array<{ id: string; title: string }> }
  targetJobId: string | null
}): string {
  if (input.outcome === 'unchanged') return 'No change needed'
  if (input.outcome === 'replayed') return 'Already saved. The repair order is current.'
  if (input.scope === 'identity') return 'Customer or vehicle corrected.'
  if (input.scope === 'concern') return 'Concern corrected.'
  if (input.scope === 'job_removed') return 'Removed from active work. It remains in History.'
  const title = input.ticket.jobs.find((job) => job.id === input.targetJobId)?.title
  return title ? `${title} corrected.` : 'Job corrected.'
}

function parseTicket(value: unknown): TicketDetail | null {
  const parsed = ticketSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

function truthMatches(
  ticket: TicketDetail,
  quote: TicketCorrectionQuoteProjection,
  expectedTicketId: string,
  target: TicketCorrectionTarget,
): boolean {
  const ticketId = expectedTicketId.toLowerCase()
  if (ticket.id !== ticketId || quote.ticket.id !== ticketId || ticket.status !== 'open') return false
  if (!quoteMatchesTicket(ticket, quote)) return false
  if (target.kind !== 'job') return true
  return ticket.jobs.some((job) => job.id === target.jobId.toLowerCase())
}

function correctionEligibility(
  ticket: TicketDetail,
  target: TicketCorrectionTarget,
): TicketCorrectionEligibility {
  const jobs = target.kind === 'job'
    ? ticket.jobs.filter((job) => job.id === target.jobId.toLowerCase())
    : ticket.jobs.filter((job) => job.workStatus !== 'canceled')
  for (const job of jobs) {
    const prefix = `${job.title}: `
    if (job.workStatus === 'in_progress') {
      return {
        ok: false,
        reason: 'work_started',
        message: `${prefix}Finish or cancel that work before correcting repair-order truth.`,
      }
    }
    if (job.workStatus === 'blocked') {
      return {
        ok: false,
        reason: 'work_blocked',
        message: `${prefix}Resolve or cancel that work before correcting repair-order truth.`,
      }
    }
    if (job.workStatus !== 'open') {
      return {
        ok: false,
        reason: 'work_not_open',
        message: `${prefix}This work is no longer open. Use current repair-order history instead.`,
      }
    }
    if (job.sessionId !== null) {
      return {
        ok: false,
        reason: 'session_linked',
        message: `${prefix}Finish or cancel that diagnostic before correcting repair-order truth.`,
      }
    }
    if (job.kind === 'diagnostic' && job.diagnosticStartState === 'initializing') {
      return {
        ok: false,
        reason: 'diagnostic_starting',
        message: `${prefix}Wait for startup to finish, then check current truth again.`,
      }
    }
    if (job.kind === 'diagnostic' && job.diagnosticStartState === 'ambiguous') {
      return {
        ok: false,
        reason: 'diagnostic_ambiguous',
        message: `${prefix}Resolve that diagnostic start before correcting repair-order truth.`,
      }
    }
  }
  return { ok: true }
}

function isExactRecord<const T extends readonly string[]>(
  value: unknown,
  keys: T,
): value is Record<T[number], unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => actual.includes(key))
}
