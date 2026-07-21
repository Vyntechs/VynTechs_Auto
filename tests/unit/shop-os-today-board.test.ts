import { describe, expect, it } from 'vitest'
import {
  createTodayJobOverride,
  parseAssignmentEnvelope,
  parseTodayJobsResponse,
  placeTodayJob,
  projectTodayBoard,
} from '@/lib/shop-os/today-board'
import type { TodayTicketJob } from '@/lib/tickets'

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
  approvalState: 'pending_quote',
  canClaim: true,
  assignmentState: 'unassigned',
  assignedTechName: null,
  createdByMe: false,
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
        ignoredPrivateField: 'never merge me',
      },
    }, { ticketId: 'ticket-1', jobId: 'job-1' })).toEqual({
      ticketId: 'ticket-1',
      jobId: 'job-1',
      workStatus: 'in_progress',
      state: 'team',
      assignedTechName: 'Avery Tech',
    })
  })

  it.each([
    null,
    {},
    { assignment: null },
    { assignment: { ticketId: 'wrong', jobId: 'job-1', workStatus: 'open', state: 'mine', assignedTechName: null } },
    { assignment: { ticketId: 'ticket-1', jobId: 'wrong', workStatus: 'open', state: 'mine', assignedTechName: null } },
    { assignment: { ticketId: 'ticket-1', jobId: 'job-1', workStatus: 'closed', state: 'mine', assignedTechName: null } },
    { assignment: { ticketId: 'ticket-1', jobId: 'job-1', workStatus: 'open', state: 'foreign', assignedTechName: null } },
    { assignment: { ticketId: 'ticket-1', jobId: 'job-1', workStatus: 'open', state: 'team', assignedTechName: 42 } },
    { assignment: { ticketId: 'ticket-1', jobId: 'job-1', workStatus: 'open', state: 'team', assignedTechName: 'x'.repeat(121) } },
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
    approvalState: 'approved',
    canClaim: true,
    assignmentState: 'unassigned',
    assignedTechName: null,
    createdByMe: false,
  }

  it('accepts only a bounded Today projection before replacing the mounted board', () => {
    expect(parseTodayJobsResponse({
      todayJobs: {
        myJobs: [], openJobs: [liveJob], createdJobs: [], teamJobs: [], partsJobs: [],
        linkedSessionIds: [], hasMore: false,
      },
    })).toMatchObject({ openJobs: [liveJob] })
  })

  it('fails closed for an unknown field or malformed identity in the live response', () => {
    expect(parseTodayJobsResponse({
      todayJobs: {
        myJobs: [], openJobs: [{ ...liveJob, id: 'not-a-uuid' }], createdJobs: [], teamJobs: [], partsJobs: [],
        linkedSessionIds: [],
      },
    })).toBeNull()
    expect(parseTodayJobsResponse({
      todayJobs: {
        myJobs: [], openJobs: [liveJob], createdJobs: [], teamJobs: [], partsJobs: [],
        linkedSessionIds: [], privateField: 'do not merge',
      },
    })).toBeNull()
  })
})
