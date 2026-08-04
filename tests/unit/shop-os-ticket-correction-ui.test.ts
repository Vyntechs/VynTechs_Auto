import { describe, expect, it } from 'vitest'
import {
  correctionAnnouncementFor,
  parseTicketCorrectionBaseline,
  parseTicketCorrectionSuccess,
} from '@/lib/shop-os/ticket-correction-ui'

const IDS = {
  ticket: '00000000-0000-4000-8000-000000000101',
  customer: '00000000-0000-4000-8000-000000000102',
  vehicle: '00000000-0000-4000-8000-000000000103',
  job: '00000000-0000-4000-8000-000000000104',
  activity: '00000000-0000-4000-8000-000000000105',
  version: '00000000-0000-4000-8000-000000000106',
  secondJob: '00000000-0000-4000-8000-000000000107',
} as const
const UPDATED_AT = '2026-08-03T14:00:00.000Z'

function rawTicket() {
  return {
    id: IDS.ticket, ticketNumber: 81, source: 'counter', status: 'open',
    concern: 'Steering wheel shakes under braking.', whenStarted: null, howOften: null,
    diagnosticAuthorizedCents: null, diagnosticAuthorizationNote: null,
    customer: { id: IDS.customer, name: 'Marisol Vega', phone: '214-555-0197', email: null },
    vehicle: {
      id: IDS.vehicle, year: 2019, make: 'Ford', model: 'F-150', engine: '3.5L',
      vin: '1FTFW1E41KFA00001', mileage: 88420, plate: null,
    },
    jobs: [{
      id: IDS.job, title: 'Diagnose brake vibration', kind: 'diagnostic',
      requiredSkillTier: 3, assignedTechId: null, assignedTech: null, sessionId: null,
      workStatus: 'open', approvalState: 'quote_ready', customerSuppliedPartsNote: null,
      workNotes: null, diagnosticStartState: 'idle', diagnosticStartErrorCode: null,
      createdAt: UPDATED_AT, updatedAt: UPDATED_AT,
    }],
    activities: [{
      id: IDS.activity, jobId: IDS.job, kind: 'ticket_corrected', actorName: 'Avery Advisor',
      summary: 'Diagnose brake vibration: Details corrected.', correctionScope: 'job',
      createdAt: UPDATED_AT,
    }],
    createdAt: UPDATED_AT, updatedAt: UPDATED_AT,
  }
}

function rawQuote() {
  return {
    ticket: { id: IDS.ticket, status: 'open', reconciled: false },
    configuration: {
      laborRateCents: 15500, taxRateBps: 825, partsMarkupBps: 2500,
      laborRateConfigured: true, taxRateConfigured: true,
    },
    jobs: [{
      id: IDS.job, title: 'Diagnose brake vibration', kind: 'diagnostic',
      customerSuppliedPartsNote: null, workStatus: 'open',
      story: { content: null, source: null, reviewStatus: null, revision: 0 },
      storyMode: 'authorization_only', decisionEligible: true,
      approval: { state: 'quote_ready', quoteVersionId: null }, lines: [],
    }],
    capabilities: { canRecordCustomerApproval: true, canCreateCustomerApprovalLink: true },
    activeVersion: {
      id: IDS.version, versionNumber: 1, totalCents: 18750,
      contentFingerprint: 'a'.repeat(64),
      jobs: [{ jobId: IDS.job, subtotalCents: 18750 }],
    },
    lastPreparedVersion: {
      id: IDS.version, versionNumber: 1, totalCents: 18750,
      contentFingerprint: 'a'.repeat(64), state: 'current',
    },
    draftCommitment: null,
  }
}

function rawQuoteForJob(job: {
  id: string
  title: string
  kind: string
  customerSuppliedPartsNote: string | null
  workStatus: string
  approvalState: string
}) {
  const quote = rawQuote()
  return {
    ...quote,
    jobs: [{
      ...quote.jobs[0],
      id: job.id,
      title: job.title,
      kind: job.kind,
      customerSuppliedPartsNote: job.customerSuppliedPartsNote,
      workStatus: job.workStatus,
      approval: { ...quote.jobs[0].approval, state: job.approvalState },
    }],
  }
}

describe('strict ticket correction client truth', () => {
  it('rehydrates a complete tenant-safe ticket and quote baseline before editing', () => {
    const ticket = { ...rawTicket(), correctedRemovedJobIds: [IDS.job] }
    const parsed = parseTicketCorrectionBaseline(
      { ticket, quote: rawQuote() },
      { ticketId: IDS.ticket, target: { kind: 'job', jobId: IDS.job } },
    )

    expect(parsed?.ticket.updatedAt).toBeInstanceOf(Date)
    expect(parsed?.ticket.jobs[0].updatedAt).toBeInstanceOf(Date)
    expect(parsed?.ticket.activities?.[0].createdAt).toBeInstanceOf(Date)
    expect(parsed?.ticket.activities?.[0].correctionScope).toBe('job')
    expect(parsed?.ticket.correctedRemovedJobIds).toEqual([IDS.job])
    expect(parsed?.quote.activeVersion).toMatchObject({ id: IDS.version, versionNumber: 1 })
  })

  it.each([
    ['an extra top-level key', () => ({ ticket: rawTicket(), quote: rawQuote(), extra: true })],
    ['a malformed ticket id', () => ({ ticket: { ...rawTicket(), id: 'ticket-1' }, quote: rawQuote() })],
    ['a malformed timestamp', () => ({ ticket: { ...rawTicket(), updatedAt: 'today' }, quote: rawQuote() })],
    ['an incomplete job', () => {
      const ticket = rawTicket()
      const { updatedAt: _removed, ...job } = ticket.jobs[0]
      return { ticket: { ...ticket, jobs: [job] }, quote: rawQuote() }
    }],
    ['an incomplete activity', () => {
      const ticket = rawTicket()
      const { summary: _removed, ...activity } = ticket.activities[0]
      return { ticket: { ...ticket, activities: [activity] }, quote: rawQuote() }
    }],
    ['a removed correction for another ticket job', () => ({
      ticket: { ...rawTicket(), correctedRemovedJobIds: [IDS.secondJob] }, quote: rawQuote(),
    })],
    ['duplicate removed correction job IDs', () => ({
      ticket: { ...rawTicket(), correctedRemovedJobIds: [IDS.job, IDS.job] }, quote: rawQuote(),
    })],
    ['an unknown correction scope', () => {
      const ticket = rawTicket()
      return {
        ticket: { ...ticket, activities: [{ ...ticket.activities[0], correctionScope: 'removed' }] },
        quote: rawQuote(),
      }
    }],
    ['a mismatched quote ticket', () => ({
      ticket: rawTicket(),
      quote: { ...rawQuote(), ticket: { ...rawQuote().ticket, id: IDS.customer } },
    })],
    ['a quote job title that does not match ticket truth', () => ({
      ticket: rawTicket(),
      quote: { ...rawQuote(), jobs: [{ ...rawQuote().jobs[0], title: 'Different work' }] },
    })],
    ['a quote job approval that does not match ticket truth', () => ({
      ticket: rawTicket(),
      quote: {
        ...rawQuote(),
        jobs: [{
          ...rawQuote().jobs[0],
          approval: { ...rawQuote().jobs[0].approval, state: 'pending_quote' },
        }],
      },
    })],
    ['a quote missing one quote-visible ticket job', () => {
      const ticket = rawTicket()
      return {
        ticket: {
          ...ticket,
          jobs: [
            ...ticket.jobs,
            { ...ticket.jobs[0], id: IDS.secondJob, title: 'Replace front pads' },
          ],
        },
        quote: rawQuote(),
      }
    }],
  ])('rejects %s before installing local state', (_label, candidate) => {
    expect(parseTicketCorrectionBaseline(candidate(), {
      ticketId: IDS.ticket,
      target: { kind: 'job', jobId: IDS.job },
    })).toBeNull()
  })

  it('rejects a missing or mismatched target job before opening its editor', () => {
    expect(parseTicketCorrectionBaseline(
      { ticket: rawTicket(), quote: rawQuote() },
      { ticketId: IDS.ticket, target: { kind: 'job', jobId: IDS.customer } },
    )).toBeNull()
  })

  it('accepts a safely projected correction activity whose malformed scope was withheld', () => {
    const ticket = rawTicket()
    const parsed = parseTicketCorrectionBaseline({
      ticket: {
        ...ticket,
        activities: [{ ...ticket.activities[0], correctionScope: null }],
      },
      quote: rawQuote(),
    }, {
      ticketId: IDS.ticket,
      target: { kind: 'concern' },
    })

    expect(parsed?.ticket.activities?.[0]).toMatchObject({
      kind: 'ticket_corrected',
      correctionScope: null,
    })
  })

  it.each([
    ['in-progress work', { workStatus: 'in_progress' }, 'work_started', 'Finish or cancel that work before correcting repair-order truth.'],
    ['blocked work', { workStatus: 'blocked' }, 'work_blocked', 'Resolve or cancel that work before correcting repair-order truth.'],
    ['a linked session', { sessionId: IDS.activity }, 'session_linked', 'Finish or cancel that diagnostic before correcting repair-order truth.'],
    ['diagnostic startup', { diagnosticStartState: 'initializing' }, 'diagnostic_starting', 'Wait for startup to finish, then check current truth again.'],
    ['an ambiguous diagnostic start', { diagnosticStartState: 'ambiguous' }, 'diagnostic_ambiguous', 'Resolve that diagnostic start before correcting repair-order truth.'],
  ])('projects a truthful refusal for a fresh job with %s', (_label, overrides, reason, nextAction) => {
    const ticket = rawTicket()
    const targetJob = { ...ticket.jobs[0], ...overrides }
    const parsed = parseTicketCorrectionBaseline({
      ticket: { ...ticket, jobs: [targetJob] },
      quote: rawQuoteForJob(targetJob),
    }, {
      ticketId: IDS.ticket,
      target: { kind: 'job', jobId: IDS.job },
    })

    expect(parsed?.eligibility).toEqual({
      ok: false,
      reason,
      message: `Diagnose brake vibration: ${nextAction}`,
    })
  })

  it.each(['identity', 'concern'] as const)(
    'refuses ticket-wide %s correction when any non-canceled job is ineligible',
    (kind) => {
      const ticket = rawTicket()
      const blocked = {
        ...ticket.jobs[0],
        id: IDS.secondJob,
        title: 'Blocked tire repair',
        kind: 'repair',
        workStatus: 'blocked',
      }
      const quote = rawQuote()
      const blockedQuote = {
        ...quote.jobs[0],
        id: blocked.id,
        title: blocked.title,
        kind: blocked.kind,
        workStatus: blocked.workStatus,
        storyMode: null,
      }
      const parsed = parseTicketCorrectionBaseline({
        ticket: { ...ticket, jobs: [...ticket.jobs, blocked] },
        quote: { ...quote, jobs: [...quote.jobs, blockedQuote] },
      }, {
        ticketId: IDS.ticket,
        target: { kind },
      })

      expect(parsed?.eligibility).toEqual({
        ok: false,
        reason: 'work_blocked',
        message: 'Blocked tire repair: Resolve or cancel that work before correcting repair-order truth.',
      })
    },
  )

  it.each([
    ['changed', true, 'job'],
    ['replayed', false, 'job'],
    ['unchanged', false, 'job'],
  ] as const)('accepts only a coherent %s success envelope', (outcome, changed, scope) => {
    const parsed = parseTicketCorrectionSuccess({
      outcome, changed, scope, invalidatedVersionNumber: outcome === 'changed' ? 1 : null,
      ticket: rawTicket(),
    }, {
      ticketId: IDS.ticket,
      expectedScope: 'job',
      target: { kind: 'job', jobId: IDS.job },
    })

    expect(parsed?.outcome).toBe(outcome)
    expect(parsed?.ticket.updatedAt).toBeInstanceOf(Date)
  })

  it.each([
    { outcome: 'changed', changed: false, scope: 'job' },
    { outcome: 'replayed', changed: true, scope: 'job' },
    { outcome: 'unchanged', changed: false, scope: 'concern' },
    { outcome: 'future', changed: false, scope: 'job' },
  ])('rejects mismatched correction outcomes before confirmation', (candidate) => {
    expect(parseTicketCorrectionSuccess({
      ...candidate, invalidatedVersionNumber: null, ticket: rawTicket(),
    }, {
      ticketId: IDS.ticket,
      expectedScope: 'job',
      target: { kind: 'job', jobId: IDS.job },
    })).toBeNull()
  })

  it('rejects an ordinary job success that does not resolve the exact target job', () => {
    expect(parseTicketCorrectionSuccess({
      outcome: 'changed', changed: true, scope: 'job', invalidatedVersionNumber: null,
      ticket: rawTicket(),
    }, {
      ticketId: IDS.ticket,
      expectedScope: 'job',
      target: { kind: 'job', jobId: IDS.customer },
    })).toBeNull()
  })

  it('rejects a success projection that unexpectedly closes the repair order', () => {
    expect(parseTicketCorrectionSuccess({
      outcome: 'changed', changed: true, scope: 'concern', invalidatedVersionNumber: null,
      ticket: { ...rawTicket(), status: 'closed' },
    }, {
      ticketId: IDS.ticket,
      expectedScope: 'concern',
      target: { kind: 'concern' },
    })).toBeNull()
  })

  it('seats job_removed only when the exact target resolves as canceled', () => {
    const success = {
      outcome: 'changed', changed: true, scope: 'job_removed', invalidatedVersionNumber: 1,
      ticket: rawTicket(),
    }
    const expected = {
      ticketId: IDS.ticket,
      expectedScope: 'job_removed' as const,
      target: { kind: 'job' as const, jobId: IDS.job },
    }

    expect(parseTicketCorrectionSuccess(success, expected)).toBeNull()
    expect(parseTicketCorrectionSuccess({
      ...success,
      ticket: { ...rawTicket(), jobs: [{ ...rawTicket().jobs[0], workStatus: 'canceled' }] },
    }, expected)?.scope).toBe('job_removed')
  })

  it('derives exact local announcements from validated outcomes', () => {
    expect(correctionAnnouncementFor({
      outcome: 'changed', scope: 'identity', ticket: rawTicket(), targetJobId: null,
    })).toBe('Customer or vehicle corrected.')
    expect(correctionAnnouncementFor({
      outcome: 'changed', scope: 'concern', ticket: rawTicket(), targetJobId: null,
    })).toBe('Concern corrected.')
    expect(correctionAnnouncementFor({
      outcome: 'changed', scope: 'job', ticket: rawTicket(), targetJobId: IDS.job,
    })).toBe('Diagnose brake vibration corrected.')
    expect(correctionAnnouncementFor({
      outcome: 'changed', scope: 'job_removed', ticket: rawTicket(), targetJobId: IDS.job,
    })).toBe('Removed from active work. It remains in History.')
    expect(correctionAnnouncementFor({
      outcome: 'replayed', scope: 'job', ticket: rawTicket(), targetJobId: IDS.job,
    })).toBe('Already saved. The repair order is current.')
    expect(correctionAnnouncementFor({
      outcome: 'unchanged', scope: 'job', ticket: rawTicket(), targetJobId: IDS.job,
    })).toBe('No change needed')
  })
})
