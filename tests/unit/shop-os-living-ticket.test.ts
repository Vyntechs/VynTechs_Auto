import { describe, expect, it } from 'vitest'
import {
  projectLivingTicketCommands,
  projectTechnicianJobReadiness,
} from '@/lib/shop-os/living-ticket'

const PROFILE = '00000000-0000-0000-0000-000000000101'

function job(overrides: Partial<{
  id: string
  kind: string
  requiredSkillTier: number
  assignedTechId: string | null
  sessionId: string | null
  workStatus: string
  approvalState: string
}> = {}) {
  return {
    id: '00000000-0000-0000-0000-000000000201',
    kind: 'repair',
    requiredSkillTier: 2,
    assignedTechId: null,
    sessionId: null,
    workStatus: 'open',
    approvalState: 'pending_quote',
    ...overrides,
  }
}

type ProjectInput = Parameters<typeof projectLivingTicketCommands>[0] & {
  diagnosticsEntitled?: boolean
}

function project(overrides: Partial<ProjectInput> = {}) {
  return projectLivingTicketCommands({
    role: 'tech',
    profileId: PROFILE,
    skillTier: 2,
    ticketStatus: 'open',
    jobs: [job()],
    ringOut: null,
    diagnosticsEntitled: false,
    ...overrides,
  } as Parameters<typeof projectLivingTicketCommands>[0])
}

describe('living repair order next-move projection', () => {
  it('keeps terminal repair orders read-only for every role', () => {
    for (const role of ['tech', 'advisor', 'parts', 'owner']) {
      expect(project({ role, ticketStatus: 'closed' })).toEqual({
        primary: null,
        secondary: [],
      })
    }
  })

  it('gives dispatch the unassigned handoff before quote work', () => {
    const result = project({ role: 'advisor', skillTier: null })

    expect(result.primary).toMatchObject({
      kind: 'assign',
      jobId: '00000000-0000-0000-0000-000000000201',
      label: 'Assign work',
    })
    expect(result.secondary).toContainEqual(expect.objectContaining({
      kind: 'quote',
      label: 'Build quote',
    }))
  })

  it('keeps an already-started assigned job as the technician’s one next move', () => {
    const result = project({
      jobs: [job({
        assignedTechId: PROFILE,
        workStatus: 'in_progress',
        approvalState: 'approved',
      })],
    })

    expect(result.primary).toMatchObject({ kind: 'work', label: 'Continue work' })
  })

  it('opens approved assigned simple work, including manual diagnostics only while diagnostics are unavailable', () => {
    expect(project({
      jobs: [job({ assignedTechId: PROFILE, approvalState: 'approved' })],
    }).primary).toMatchObject({ kind: 'work', label: 'Review & clock on' })

    expect(project({
      jobs: [job({ kind: 'diagnostic', assignedTechId: PROFILE, approvalState: 'approved' })],
    }).primary).toMatchObject({ kind: 'work', label: 'Review & clock on' })

    expect(project({
      diagnosticsEntitled: true,
      jobs: [job({ kind: 'diagnostic', assignedTechId: PROFILE, approvalState: 'approved' })],
    }).primary).toBeNull()

    expect(project({
      jobs: [job({
        kind: 'diagnostic',
        sessionId: '00000000-0000-0000-0000-000000000777',
        assignedTechId: PROFILE,
        approvalState: 'approved',
      })],
    }).primary).toBeNull()
  })

  it('offers an eligible technician a self-claim without granting dispatch authority', () => {
    const result = project({
      jobs: [job({ approvalState: 'approved', requiredSkillTier: 2 })],
    })

    expect(result.primary).toMatchObject({ kind: 'claim', label: 'Claim work' })
    expect(result.secondary.some((command) => command.kind === 'assign')).toBe(false)

    expect(project({ skillTier: 1, jobs: [job({ requiredSkillTier: 2 })] }).primary)
      .toBeNull()
  })

  it('keeps price-building with non-technician flows and preserves approval wording', () => {
    for (const role of ['parts']) {
      expect(project({ role, skillTier: null }).primary)
        .toMatchObject({ kind: 'quote', label: 'Build quote' })
      expect(project({
        role,
        skillTier: null,
        jobs: [job({ approvalState: 'quote_ready', assignedTechId: 'other' })],
      }).primary).toMatchObject({ kind: 'quote', label: 'View quote' })
    }

    for (const role of ['advisor', 'owner']) {
      expect(project({
        role,
        skillTier: null,
        jobs: [job({ approvalState: 'quote_ready', assignedTechId: 'other' })],
      }).primary).toMatchObject({ kind: 'quote', label: 'Record approval' })
    }

    expect(project({ role: 'tech', skillTier: 2 }).primary)
      .toMatchObject({ kind: 'claim', label: 'Claim work' })
    expect(project({ role: 'tech', skillTier: 2 }).secondary)
      .not.toContainEqual(expect.objectContaining({ kind: 'quote' }))
    expect(project({
      role: 'tech',
      skillTier: 2,
      jobs: [job({ assignedTechId: PROFILE, approvalState: 'quote_ready' })],
    }).primary).toBeNull()
  })

  it('does not offer a new claim after the customer deferred or declined', () => {
    for (const approvalState of ['deferred', 'declined'] as const) {
      expect(project({ jobs: [job({ approvalState })] })).toEqual({
        primary: null,
        secondary: [],
      })
    }
  })

  it('offers handoff as a secondary command for active teammate work', () => {
    const result = project({
      role: 'owner',
      jobs: [job({ assignedTechId: '00000000-0000-0000-0000-000000000999' })],
    })

    expect(result.secondary).toContainEqual(expect.objectContaining({
      kind: 'handoff',
      label: 'Hand off',
    }))
  })

  it('makes payment or close the next move only after all work is terminal', () => {
    const done = [job({ workStatus: 'done', approvalState: 'approved', assignedTechId: PROFILE })]

    expect(project({
      role: 'advisor',
      jobs: done,
      ringOut: { balanceCents: 12500, canClose: false },
    }).primary).toMatchObject({ kind: 'ring_out', label: 'Take payment' })

    expect(project({
      role: 'owner',
      jobs: done,
      ringOut: { balanceCents: 0, canClose: true },
    }).primary).toMatchObject({ kind: 'close', label: 'Close it out' })

    expect(project({
      role: 'tech',
      jobs: done,
      ringOut: { balanceCents: 0, canClose: true },
    }).primary).toBeNull()
  })

  it('makes a technician’s assigned blocked job the one obvious recovery action', () => {
    expect(project({
      jobs: [job({ workStatus: 'blocked', assignedTechId: PROFILE, approvalState: 'approved' })],
    }).primary).toMatchObject({ kind: 'resolve_hold', label: 'Resolve hold' })

    expect(project({
      role: 'advisor',
      skillTier: null,
      jobs: [job({ workStatus: 'blocked', assignedTechId: '00000000-0000-0000-0000-000000000999' })],
    }).primary).toMatchObject({ kind: 'handoff', label: 'Hand off' })
  })

  it('makes retiring a declined line the counter’s next move and hides it from the floor', () => {
    const declined = [job({ approvalState: 'declined', assignedTechId: PROFILE })]

    for (const role of ['advisor', 'owner']) {
      expect(project({ role, skillTier: null, jobs: declined }).primary).toMatchObject({
        kind: 'cancel_job',
        jobId: '00000000-0000-0000-0000-000000000201',
        label: 'Not doing this one',
      })
    }

    for (const role of ['tech', 'parts']) {
      const result = project({ role, jobs: declined })
      const all = result.primary ? [result.primary, ...result.secondary] : result.secondary
      expect(all.some((command) => command.kind === 'cancel_job')).toBe(false)
    }
  })

  it('does not invent commands for unsupported roles or missing identity', () => {
    expect(project({ role: 'curator' })).toEqual({ primary: null, secondary: [] })
    expect(project({ profileId: null })).toEqual({ primary: null, secondary: [] })
  })
})

describe('technician job readiness projection', () => {
  const readiness = (overrides: Partial<Parameters<typeof projectTechnicianJobReadiness>[0]> = {}) =>
    projectTechnicianJobReadiness({
      assignmentState: 'mine',
      approvalState: 'approved',
      workStatus: 'open',
      canClaim: false,
      requiredSkillTier: 2,
      clockedOnSince: null,
      ...overrides,
    })

  it.each(['pending_quote', 'quote_ready', 'sent', 'approved'] as const)(
    'offers Claim work for eligible unassigned %s work',
    (approvalState) => {
      expect(readiness({ assignmentState: 'unassigned', approvalState, canClaim: true }))
        .toEqual({ state: 'claimable', label: 'Claim work' })
    },
  )

  it.each([
    ['pending_quote', 'Waiting for quote'],
    ['quote_ready', 'Waiting for advisor'],
    ['sent', 'Waiting for customer'],
  ] as const)('names the exact %s handoff that assigned work awaits', (approvalState, label) => {
    expect(readiness({ approvalState })).toEqual({
      state: approvalState === 'pending_quote'
        ? 'waiting_quote'
        : approvalState === 'quote_ready'
          ? 'waiting_advisor'
          : 'waiting_customer',
      label,
    })
  })

  it('shows customer outcomes before skill fit', () => {
    expect(readiness({ assignmentState: 'unassigned', approvalState: 'deferred' }))
      .toEqual({ state: 'waiting_customer', label: 'Waiting for customer' })
    expect(readiness({ assignmentState: 'unassigned', approvalState: 'declined' }))
      .toEqual({ state: 'declined', label: 'Customer declined' })
  })

  it('explains below-tier work without granting a claim action', () => {
    expect(readiness({ assignmentState: 'unassigned', canClaim: false, requiredSkillTier: 3 }))
      .toEqual({ state: 'below_tier', label: 'Requires A-tech' })
  })

  it('separates approved review, running, paused, and blocked truth', () => {
    expect(readiness()).toEqual({ state: 'review', label: 'Review & clock on' })
    expect(readiness({
      workStatus: 'in_progress',
      clockedOnSince: '2026-08-04T20:00:00.000Z',
    })).toEqual({
      state: 'running',
      label: 'Clock running since',
      clockedOnSince: '2026-08-04T20:00:00.000Z',
    })
    expect(readiness({ workStatus: 'in_progress' }))
      .toEqual({ state: 'paused', label: 'Clock paused' })
    expect(readiness({ workStatus: 'blocked' }))
      .toEqual({ state: 'unavailable', label: 'Review repair order' })
    expect(readiness({ workStatus: 'blocked', approvalState: 'pending_quote' }))
      .toEqual({ state: 'unavailable', label: 'Review repair order' })
    expect(readiness({
      assignmentState: 'unassigned',
      workStatus: 'in_progress',
      canClaim: false,
    })).toEqual({ state: 'unavailable', label: 'Review repair order' })
  })

  it('does not invent a technician action for someone else’s assignment', () => {
    expect(readiness({ assignmentState: 'team' }))
      .toEqual({ state: 'unavailable', label: 'Review repair order' })
  })
})
