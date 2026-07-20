import { describe, expect, it, vi } from 'vitest'
import {
  activeDurationSeconds,
  formatDurationSeconds,
  parseEscalationResponse,
  parseInlineSimpleWorkResponse,
  parseSimpleWorkMutationResponse,
  parseSimpleWorkWorkspaceResponse,
  retainEscalationAttempt,
} from '@/lib/shop-os/simple-work-ui'

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

const workspace = {
  id: uuid(1), title: 'Install lift kit', kind: 'repair', workStatus: 'in_progress',
  workNotes: 'Started', startedAt: '2026-07-11T11:30:00.000Z', completedAt: null,
  clockedOnSince: '2026-07-11T11:30:00.000Z', activeSeconds: 0,
  updatedAt: '2026-07-11T12:00:00.000Z', authorization: 'approved',
}

describe('Shop OS simple-work UI contract', () => {
  it('strictly parses bounded text-only workspace, mutation, and escalation responses', () => {
    expect(parseSimpleWorkWorkspaceResponse({ workspace })).toEqual(workspace)
    expect(parseSimpleWorkMutationResponse({
      changed: true, work: { status: 'done', workNotes: 'Done', startedAt: '2026-07-11T11:30:00.000Z', completedAt: '2026-07-11T12:02:00.000Z', clockedOnSince: null, activeSeconds: 1920, updatedAt: '2026-07-11T12:02:00.000Z' },
    })).toMatchObject({ changed: true, work: { status: 'done' } })
    expect(parseEscalationResponse({
      changed: true,
      job: { id: uuid(3), title: 'Found: steering clunk', kind: 'repair', requiredSkillTier: 2, assignedTechId: null, workStatus: 'open', approvalState: 'pending_quote', sessionId: null },
    })).toMatchObject({ changed: true, job: { assignedTechId: null, sessionId: null } })
  })

  it('strictly parses the inline work envelope with text-only part requests', () => {
    const request = {
      id: uuid(4), jobId: workspace.id, description: 'Water pump', preference: null,
      quantity: 1, status: 'requested', requestedAt: '2026-07-11T12:01:00.000Z', resolvedAt: null,
    }
    expect(parseInlineSimpleWorkResponse({ workspace, partRequests: [request] })).toEqual({
      workspace,
      partRequests: [request],
    })
    expect(parseInlineSimpleWorkResponse({ workspace, partRequests: [request], privateActor: uuid(9) })).toBeNull()
    expect(parseInlineSimpleWorkResponse({ workspace, partRequests: [{ ...request, priceCents: 100 }] })).toBeNull()
  })

  it('fails closed on extra private fields or malformed persisted values', () => {
    expect(parseSimpleWorkWorkspaceResponse({ workspace: { ...workspace, shopId: uuid(9) } })).toBeNull()
    expect(parseSimpleWorkWorkspaceResponse({ workspace: { ...workspace, attachments: [] } })).toBeNull()
    expect(parseSimpleWorkWorkspaceResponse({ workspace: { ...workspace, hasCompletionProof: false } })).toBeNull()
    expect(parseEscalationResponse({ changed: true, job: { id: 'bad' } })).toBeNull()
  })

  it('formats banked time on the job plainly', () => {
    expect(formatDurationSeconds(8_100)).toBe('2h 15m')
    expect(formatDurationSeconds(7_200)).toBe('2h')
    expect(formatDurationSeconds(2_700)).toBe('45m')
    expect(formatDurationSeconds(20)).toBe('under a minute')
    expect(formatDurationSeconds(0)).toBe('under a minute')
  })

  it('totals actual seconds, adding the open interval only while clocked on', () => {
    const since = '2026-07-11T09:14:00.000Z'
    const now = new Date('2026-07-11T09:44:00.000Z').getTime() // 30 min later
    // Clocked on: banked + the live open interval.
    expect(activeDurationSeconds(600, since, now)).toBe(600 + 1_800)
    // Clocked off (no open interval): just the banked seconds.
    expect(activeDurationSeconds(600, null, now)).toBe(600)
    // A future/again-clock-on with no elapsed time adds nothing.
    expect(activeDurationSeconds(600, since, new Date(since).getTime())).toBe(600)
  })

  it('retains concern identity only for the exact normalized concern and tier', () => {
    const key = vi.fn().mockReturnValueOnce(uuid(20)).mockReturnValueOnce(uuid(21)).mockReturnValueOnce(uuid(22))
    const first = retainEscalationAttempt(null, '  Steering clunk  ', 2, key)
    expect(retainEscalationAttempt(first, 'Steering clunk', 2, key)).toBe(first)
    expect(retainEscalationAttempt(first, 'Steering clunk', 3, key).requestKey).toBe(uuid(21))
    expect(retainEscalationAttempt(first, 'Steering knock', 2, key).requestKey).toBe(uuid(22))
  })
})
