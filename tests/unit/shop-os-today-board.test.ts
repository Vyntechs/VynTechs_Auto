import { describe, expect, it } from 'vitest'
import {
  createTodayJobOverride,
  parseAssignmentEnvelope,
  parseTodayJobsResponse,
  placeTodayJob,
  projectReadyToCollect,
  projectTodayBoard,
} from '@/lib/shop-os/today-board'
import type { ReadyToCollectTicket } from '@/lib/shop-os/ready-to-collect'
import type { TodayTicketJob } from '@/lib/tickets'

const NOW = '2026-07-26T15:04:05.000Z'

const liveCard: ReadyToCollectTicket = {
  ticketId: '00000000-0000-4000-8000-000000000003',
  ticketNumber: 12,
  concern: 'Brake pedal pulses at highway speed.',
  customerName: 'Morgan Lee',
  vehicle: { year: 2024, make: 'Ford', model: 'F-350' },
  attentionAt: '2026-07-26T14:00:00.000Z',
  ringOut: {
    ticketId: '00000000-0000-4000-8000-000000000003',
    status: 'open',
    owed: {
      subtotalCents: 10_000,
      taxCents: 800,
      totalCents: 10_800,
      jobs: [{
        jobId: '00000000-0000-4000-8000-000000000004',
        title: 'Replace brake pads',
        subtotalCents: 10_000,
      }],
    },
    paidCents: 0,
    balanceCents: 10_800,
    payments: [],
    canRecordPayment: true,
    canClose: false,
    closedAt: null,
  },
}

const secondCard: ReadyToCollectTicket = {
  ...liveCard,
  ticketId: '00000000-0000-4000-8000-000000000005',
  ticketNumber: 13,
  ringOut: { ...liveCard.ringOut, ticketId: '00000000-0000-4000-8000-000000000005' },
}

const baseJob: TodayTicketJob = {
  id: 'job-1',
  ticketId: 'ticket-1',
  ticketNumber: 1,
  concern: 'Customer reports a coolant smell after driving.',
  customerName: 'Morgan Lee',
  vehicle: { year: 2024, make: 'Ford', model: 'F-350' },
  title: 'Inspect coolant leak',
  kind: 'repair',
  requiredSkillTier: 2,
  sessionId: null,
  workStatus: 'open',
  clockedOnSince: null,
  approvalState: 'pending_quote',
  canClaim: true,
  assignmentState: 'unassigned',
  assignedTechName: null,
  createdByMe: false,
  attentionAt: '2026-07-26T14:00:00.000Z',
}

describe('Today board projection', () => {
  it.each([
    [{ assignmentState: 'mine' as const }, false, 'mine'],
    [{ assignmentState: 'unassigned' as const }, false, 'open'],
    [{ assignmentState: 'team' as const }, true, 'team'],
    [{ assignmentState: 'team' as const, createdByMe: true }, false, 'created'],
    [{ assignmentState: 'team' as const, createdByMe: false }, false, 'hidden'],
    [{ assignmentState: 'unassigned' as const, workStatus: 'blocked' as const, createdByMe: true }, false, 'created'],
    [{ assignmentState: 'unassigned' as const, workStatus: 'blocked' as const, createdByMe: false }, false, 'hidden'],
  ])('places actor-relative work without duplicating it: %o', (patch, canDispatchWork, lane) => {
    expect(placeTodayJob({ ...baseJob, ...patch }, canDispatchWork)).toBe(lane)
  })

  it('deduplicates server lanes into one keyed model before deriving lanes', () => {
    const board = projectTodayBoard({
      myJobs: [],
      openJobs: [baseJob],
      teamJobs: [{ ...baseJob }],
      createdJobs: [{ ...baseJob }],
      canDispatchWork: true,
      overrides: new Map(),
    })

    expect(board.open).toEqual([baseJob])
    expect(board.mine).toEqual([])
    expect(board.team).toEqual([])
    expect(board.created).toEqual([])
  })

  it('keeps a completed local claim over stale props, then yields to newer server truth', () => {
    const claimed = {
      ...baseJob,
      assignmentState: 'mine' as const,
      assignedTechName: 'Taylor Tech',
      canClaim: false,
    }
    const overrides = new Map([
      [baseJob.id, createTodayJobOverride(baseJob, claimed)],
    ])

    const staleBoard = projectTodayBoard({
      myJobs: [],
      openJobs: [baseJob],
      teamJobs: [],
      createdJobs: [],
      canDispatchWork: false,
      overrides,
    })
    expect(staleBoard.mine).toEqual([claimed])
    expect(staleBoard.open).toEqual([])

    const newerServerJob = {
      ...claimed,
      assignmentState: 'team' as const,
      assignedTechName: 'Avery Tech',
    }
    const currentBoard = projectTodayBoard({
      myJobs: [],
      openJobs: [],
      teamJobs: [],
      createdJobs: [{ ...newerServerJob, createdByMe: true }],
      canDispatchWork: false,
      overrides,
    })
    expect(currentBoard.created).toEqual([{ ...newerServerJob, createdByMe: true }])
    expect(currentBoard.mine).toEqual([])
  })

  it('keeps confirmed running-clock truth over stale props until newer server truth arrives', () => {
    const beforeRunning = {
      ...baseJob,
      assignmentState: 'mine' as const,
      canClaim: false,
      workStatus: 'in_progress' as const,
    }
    const running = {
      ...beforeRunning,
      clockedOnSince: '2026-08-04T20:00:00.000Z',
    }
    const board = projectTodayBoard({
      myJobs: [beforeRunning],
      openJobs: [], teamJobs: [], createdJobs: [], partsJobs: [],
      canDispatchWork: false,
      overrides: new Map([[baseJob.id, createTodayJobOverride(beforeRunning, running)]]),
    })

    expect(board.mine).toEqual([running])
  })

  it('moves a losing race to the team, creator recovery, or hidden lane by capability', () => {
    const lostRace = {
      ...baseJob,
      assignmentState: 'team' as const,
      assignedTechName: 'Winner Tech',
      canClaim: false,
    }
    const overrides = new Map([
      [baseJob.id, createTodayJobOverride(baseJob, lostRace)],
    ])

    const dispatch = projectTodayBoard({
      myJobs: [], openJobs: [baseJob], teamJobs: [], createdJobs: [],
      canDispatchWork: true, overrides,
    })
    expect(dispatch.team).toEqual([lostRace])

    const creatorBase = { ...baseJob, createdByMe: true }
    const creator = projectTodayBoard({
      myJobs: [], openJobs: [creatorBase], teamJobs: [], createdJobs: [],
      canDispatchWork: false,
      overrides: new Map([[creatorBase.id, createTodayJobOverride(creatorBase, {
        ...lostRace,
        createdByMe: true,
      })]]),
    })
    expect(creator.created).toHaveLength(1)

    const technician = projectTodayBoard({
      myJobs: [], openJobs: [baseJob], teamJobs: [], createdJobs: [],
      canDispatchWork: false, overrides,
    })
    expect(technician).toEqual({ mine: [], open: [], team: [], created: [], parts: [] })
  })
})

describe('assignment envelope parsing', () => {
  it('accepts only bounded actor-relative truth for the exact row', () => {
    expect(parseAssignmentEnvelope({
      assignment: {
        ticketId: 'ticket-1',
        jobId: 'job-1',
        workStatus: 'in_progress',
        state: 'team',
        assignedTechName: '  Avery Tech  ',
        approvalState: 'approved',
        ignoredPrivateField: 'never merge me',
      },
    }, { ticketId: 'ticket-1', jobId: 'job-1' })).toEqual({
      ticketId: 'ticket-1',
      jobId: 'job-1',
      workStatus: 'in_progress',
      state: 'team',
      assignedTechName: 'Avery Tech',
      approvalState: 'approved',
    })
  })

  it.each([
    null,
    {},
    { assignment: null },
    { assignment: { ticketId: 'wrong', jobId: 'job-1', workStatus: 'open', state: 'mine', assignedTechName: null, approvalState: 'approved' } },
    { assignment: { ticketId: 'ticket-1', jobId: 'wrong', workStatus: 'open', state: 'mine', assignedTechName: null, approvalState: 'approved' } },
    { assignment: { ticketId: 'ticket-1', jobId: 'job-1', workStatus: 'closed', state: 'mine', assignedTechName: null, approvalState: 'approved' } },
    { assignment: { ticketId: 'ticket-1', jobId: 'job-1', workStatus: 'open', state: 'foreign', assignedTechName: null, approvalState: 'approved' } },
    { assignment: { ticketId: 'ticket-1', jobId: 'job-1', workStatus: 'open', state: 'team', assignedTechName: 42, approvalState: 'approved' } },
    { assignment: { ticketId: 'ticket-1', jobId: 'job-1', workStatus: 'open', state: 'team', assignedTechName: 'x'.repeat(121), approvalState: 'approved' } },
    { assignment: { ticketId: 'ticket-1', jobId: 'job-1', workStatus: 'open', state: 'mine', assignedTechName: null } },
    { assignment: { ticketId: 'ticket-1', jobId: 'job-1', workStatus: 'open', state: 'mine', assignedTechName: null, approvalState: 'unknown' } },
  ])('fails closed for malformed or mismatched payload %#', (body) => {
    expect(parseAssignmentEnvelope(body, { ticketId: 'ticket-1', jobId: 'job-1' })).toBeNull()
  })
})

describe('Today live-feed parsing', () => {
  const liveJob = {
    id: '00000000-0000-4000-8000-000000000001',
    ticketId: '00000000-0000-4000-8000-000000000002',
    ticketNumber: 12,
    concern: 'Brake pedal pulses at highway speed.',
    customerName: 'Morgan Lee',
    vehicle: { year: 2024, make: 'Ford', model: 'F-350' },
    title: 'Replace brake pads',
    kind: 'repair',
    requiredSkillTier: 2,
    sessionId: null,
    workStatus: 'open',
    clockedOnSince: null,
    approvalState: 'approved',
    canClaim: true,
    assignmentState: 'unassigned',
    assignedTechName: null,
    createdByMe: false,
    attentionAt: '2026-07-26T14:00:00.000Z',
  }

  it('accepts only a bounded Today projection before replacing the mounted board', () => {
    expect(parseTodayJobsResponse({
      todayJobs: {
        myJobs: [], openJobs: [liveJob], createdJobs: [], teamJobs: [], partsJobs: [],
        readyToCollect: [], linkedSessionIds: [], hasMore: false,
      },
    })).toMatchObject({ openJobs: [liveJob] })
  })

  it('fails closed for an unknown field or malformed identity in the live response', () => {
    expect(parseTodayJobsResponse({
      todayJobs: {
        myJobs: [], openJobs: [{ ...liveJob, id: 'not-a-uuid' }], createdJobs: [], teamJobs: [], partsJobs: [],
        readyToCollect: [], linkedSessionIds: [],
      },
    })).toBeNull()
    const { clockedOnSince: _missingClockedOnSince, ...missingClockedOnSince } = liveJob
    expect(parseTodayJobsResponse({
      todayJobs: {
        myJobs: [], openJobs: [missingClockedOnSince], createdJobs: [], teamJobs: [], partsJobs: [],
        readyToCollect: [], linkedSessionIds: [],
      },
    })).toBeNull()
    expect(parseTodayJobsResponse({
      todayJobs: {
        myJobs: [], openJobs: [{ ...liveJob, clockedOnSince: 'not-a-time' }], createdJobs: [], teamJobs: [], partsJobs: [],
        readyToCollect: [], linkedSessionIds: [],
      },
    })).toBeNull()
    expect(parseTodayJobsResponse({
      todayJobs: {
        myJobs: [], openJobs: [{ ...liveJob, attentionAt: 'yesterday' }], createdJobs: [], teamJobs: [], partsJobs: [],
        readyToCollect: [], linkedSessionIds: [],
      },
    })).toBeNull()
    const { attentionAt: _missingAttentionAt, ...missingAttentionAt } = liveJob
    expect(parseTodayJobsResponse({
      todayJobs: {
        myJobs: [], openJobs: [missingAttentionAt], createdJobs: [], teamJobs: [], partsJobs: [],
        readyToCollect: [], linkedSessionIds: [],
      },
    })).toBeNull()
    expect(parseTodayJobsResponse({
      todayJobs: {
        myJobs: [], openJobs: [liveJob], createdJobs: [], teamJobs: [], partsJobs: [],
        readyToCollect: [], linkedSessionIds: [], privateField: 'do not merge',
      },
    })).toBeNull()
  })

  it('accepts a ready-to-collect card only with a fully-formed ring-out', () => {
    const parsed = parseTodayJobsResponse({
      todayJobs: {
        myJobs: [], openJobs: [], createdJobs: [], teamJobs: [], partsJobs: [],
        readyToCollect: [liveCard], linkedSessionIds: [],
      },
    })
    expect(parsed?.readyToCollect).toEqual([liveCard])

    for (const broken of [
      { ...liveCard, ringOut: { ...liveCard.ringOut, balanceCents: '10800' } },
      { ...liveCard, ringOut: { ...liveCard.ringOut, status: 'refunded' } },
      { ...liveCard, ringOut: { ...liveCard.ringOut, secretMargin: 4_200 } },
      { ...liveCard, ticketNumber: 0 },
    ]) {
      expect(parseTodayJobsResponse({
        todayJobs: {
          myJobs: [], openJobs: [], createdJobs: [], teamJobs: [], partsJobs: [],
          readyToCollect: [broken], linkedSessionIds: [],
        },
      })).toBeNull()
    }
  })
})

describe('Ready to collect lane', () => {
  it('holds a card until the server confirms the repair order left open', () => {
    const cards = [liveCard, secondCard]

    expect(projectReadyToCollect(cards, new Map())).toEqual(cards)

    const closed = projectReadyToCollect(cards, new Map([
      [liveCard.ticketId, { ...liveCard.ringOut, status: 'closed' as const, closedAt: NOW }],
    ]))
    expect(closed).toEqual([secondCard])
  })

  it('shows the exact new balance after a partial payment without dropping the card', () => {
    const partlyPaid = {
      ...liveCard.ringOut,
      paidCents: 5_000,
      balanceCents: 5_800,
      canRecordPayment: true,
      canClose: false,
    }

    const projected = projectReadyToCollect(
      [liveCard],
      new Map([[liveCard.ticketId, partlyPaid]]),
    )

    expect(projected).toHaveLength(1)
    expect(projected[0].ringOut).toEqual(partlyPaid)
    expect(projected[0].ticketNumber).toBe(liveCard.ticketNumber)
  })

  it('drops a card the server itself already reports as no longer open', () => {
    const alreadyClosed = {
      ...liveCard,
      ringOut: { ...liveCard.ringOut, status: 'canceled' as const },
    }
    expect(projectReadyToCollect([alreadyClosed], new Map())).toEqual([])
  })
})
