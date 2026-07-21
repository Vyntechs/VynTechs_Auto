import { describe, expect, it } from 'vitest'
import {
  decodeSimpleWorkDraft,
  encodeSimpleWorkDraft,
  simpleWorkDraftStorageKey,
} from '@/lib/shop-os/simple-work-draft'

const actorProfileId = '00000000-0000-4000-8000-000000000001'
const ticketId = '00000000-0000-4000-8000-000000000002'
const jobId = '00000000-0000-4000-8000-000000000003'
const updatedAt = '2026-07-21T18:00:00.000Z'

const scope = {
  actorProfileId,
  ticketId,
  jobId,
  workspaceUpdatedAt: updatedAt,
  workStatus: 'in_progress' as const,
  authorization: 'approved' as const,
}

describe('simple-work local draft codec', () => {
  it('round-trips a bounded technician draft only for its exact active workspace', () => {
    const encoded = encodeSimpleWorkDraft(scope, {
      note: 'Measured front-left torque.',
      concern: 'Rear brake squeal after road test',
      tier: '2',
      parts: {
        description: 'Front pad hardware kit',
        preference: 'Motorcraft',
        quantity: '1',
        requestKey: '00000000-0000-4000-8000-000000000004',
      },
      hold: { kind: 'parts', note: 'Waiting on the hardware kit.' },
    })

    expect(encoded).not.toBeNull()
    expect(decodeSimpleWorkDraft(encoded, scope)).toEqual({
      note: 'Measured front-left torque.',
      concern: 'Rear brake squeal after road test',
      tier: '2',
      parts: {
        description: 'Front pad hardware kit',
        preference: 'Motorcraft',
        quantity: '1',
        requestKey: '00000000-0000-4000-8000-000000000004',
      },
      hold: { kind: 'parts', note: 'Waiting on the hardware kit.' },
    })
    expect(simpleWorkDraftStorageKey(scope)).toContain(`${actorProfileId}:${ticketId}:${jobId}`)
  })

  it.each([
    ['another technician', { ...scope, actorProfileId: '00000000-0000-4000-8000-000000000005' }],
    ['another repair order', { ...scope, ticketId: '00000000-0000-4000-8000-000000000006' }],
    ['another job', { ...scope, jobId: '00000000-0000-4000-8000-000000000007' }],
    ['a newer server workspace', { ...scope, workspaceUpdatedAt: '2026-07-21T18:01:00.000Z' }],
    ['terminal work', { ...scope, workStatus: 'done' as const }],
    ['unapproved work', { ...scope, authorization: 'awaiting_approval' as const }],
  ])('refuses a draft from %s', (_label, mismatchedScope) => {
    const encoded = encodeSimpleWorkDraft(scope, {
      note: 'Unsaved technician note', concern: '', tier: '',
      parts: { description: '', preference: '', quantity: '1', requestKey: null },
      hold: { kind: '', note: '' },
    })
    expect(decodeSimpleWorkDraft(encoded, mismatchedScope)).toBeNull()
  })

  it('refuses malformed, oversized, and wrong-version data', () => {
    expect(decodeSimpleWorkDraft('{oops', scope)).toBeNull()
    expect(decodeSimpleWorkDraft(JSON.stringify({ version: 9 }), scope)).toBeNull()
    expect(encodeSimpleWorkDraft(scope, {
      note: 'x'.repeat(2_001), concern: '', tier: '',
      parts: { description: '', preference: '', quantity: '1', requestKey: null },
      hold: { kind: '', note: '' },
    })).toBeNull()
  })
})
