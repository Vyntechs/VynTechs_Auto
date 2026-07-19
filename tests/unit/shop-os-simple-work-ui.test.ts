import { describe, expect, it, vi } from 'vitest'
import {
  formatWorkDuration,
  parseEscalationResponse,
  parseSimpleWorkMutationResponse,
  parseSimpleWorkWorkspaceResponse,
  retainEscalationAttempt,
} from '@/lib/shop-os/simple-work-ui'

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

const workspace = {
  id: uuid(1), title: 'Install lift kit', kind: 'repair', workStatus: 'in_progress',
  workNotes: 'Started', startedAt: '2026-07-11T11:30:00.000Z', completedAt: null,
  updatedAt: '2026-07-11T12:00:00.000Z', authorization: 'approved',
}

describe('Shop OS simple-work UI contract', () => {
  it('strictly parses bounded text-only workspace, mutation, and escalation responses', () => {
    expect(parseSimpleWorkWorkspaceResponse({ workspace })).toEqual(workspace)
    expect(parseSimpleWorkMutationResponse({
      changed: true, work: { status: 'done', workNotes: 'Done', startedAt: '2026-07-11T11:30:00.000Z', completedAt: '2026-07-11T12:02:00.000Z', updatedAt: '2026-07-11T12:02:00.000Z' },
    })).toMatchObject({ changed: true, work: { status: 'done' } })
    expect(parseEscalationResponse({
      changed: true,
      job: { id: uuid(3), title: 'Diagnose: steering clunk', kind: 'diagnostic', requiredSkillTier: 2, assignedTechId: null, workStatus: 'open', approvalState: 'pending_quote', sessionId: null },
    })).toMatchObject({ changed: true, job: { assignedTechId: null, sessionId: null } })
  })

  it('fails closed on extra private fields or malformed persisted values', () => {
    expect(parseSimpleWorkWorkspaceResponse({ workspace: { ...workspace, shopId: uuid(9) } })).toBeNull()
    expect(parseSimpleWorkWorkspaceResponse({ workspace: { ...workspace, attachments: [] } })).toBeNull()
    expect(parseSimpleWorkWorkspaceResponse({ workspace: { ...workspace, hasCompletionProof: false } })).toBeNull()
    expect(parseEscalationResponse({ changed: true, job: { id: 'bad' } })).toBeNull()
  })

  it('formats the on-the-job clock plainly and only for a finished span', () => {
    const start = '2026-07-11T09:14:00.000Z'
    expect(formatWorkDuration(start, '2026-07-11T11:29:00.000Z')).toBe('2h 15m')
    expect(formatWorkDuration(start, '2026-07-11T11:14:00.000Z')).toBe('2h')
    expect(formatWorkDuration(start, '2026-07-11T09:59:00.000Z')).toBe('45m')
    expect(formatWorkDuration(start, '2026-07-11T09:14:20.000Z')).toBe('under a minute')
    // No finished span yet: still running, or a job that predates the clock.
    expect(formatWorkDuration(start, null)).toBeNull()
    expect(formatWorkDuration(null, '2026-07-11T11:29:00.000Z')).toBeNull()
  })

  it('retains concern identity only for the exact normalized concern and tier', () => {
    const key = vi.fn().mockReturnValueOnce(uuid(20)).mockReturnValueOnce(uuid(21)).mockReturnValueOnce(uuid(22))
    const first = retainEscalationAttempt(null, '  Steering clunk  ', 2, key)
    expect(retainEscalationAttempt(first, 'Steering clunk', 2, key)).toBe(first)
    expect(retainEscalationAttempt(first, 'Steering clunk', 3, key).requestKey).toBe(uuid(21))
    expect(retainEscalationAttempt(first, 'Steering knock', 2, key).requestKey).toBe(uuid(22))
  })
})
