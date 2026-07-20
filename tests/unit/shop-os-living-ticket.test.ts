import { describe, expect, it } from 'vitest'
import { projectLivingTicketCommands } from '@/lib/shop-os/living-ticket'

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
    }).primary).toMatchObject({ kind: 'work', label: 'Start work' })

    expect(project({
      jobs: [job({ kind: 'diagnostic', assignedTechId: PROFILE, approvalState: 'approved' })],
    }).primary).toMatchObject({ kind: 'work', label: 'Start work' })

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
      .toMatchObject({ kind: 'quote' })
  })

  it('lets every supported role build while only advisor and owner receive approval wording', () => {
    for (const role of ['tech', 'parts']) {
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
    }).primary).toMatchObject({ kind: 'ring_out', label: 'Collect & close' })

    expect(project({
      role: 'owner',
      jobs: done,
      ringOut: { balanceCents: 0, canClose: true },
    }).primary).toMatchObject({ kind: 'close', label: 'Close repair order' })

    expect(project({
      role: 'tech',
      jobs: done,
      ringOut: { balanceCents: 0, canClose: true },
    }).primary).toBeNull()
  })

  it('does not invent commands for unsupported roles, blocked work, or missing identity', () => {
    expect(project({ role: 'curator' })).toEqual({ primary: null, secondary: [] })
    expect(project({ profileId: null })).toEqual({ primary: null, secondary: [] })
    expect(project({
      jobs: [job({ workStatus: 'blocked', assignedTechId: PROFILE, approvalState: 'approved' })],
    }).primary).toBeNull()
  })
})
