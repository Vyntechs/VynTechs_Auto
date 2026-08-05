import { describe, expect, it } from 'vitest'
import {
  decodeSimpleWorkDraft,
  encodeSimpleWorkDraft,
  legacySimpleWorkDraftStorageKey,
  simpleWorkDraftStorageKey,
} from '@/lib/shop-os/simple-work-draft'

const actorProfileId = '00000000-0000-4000-8000-000000000001'
const ticketId = '00000000-0000-4000-8000-000000000002'
const jobId = '00000000-0000-4000-8000-000000000003'

const scope = {
  actorProfileId,
  ticketId,
  jobId,
  workStatus: 'in_progress' as const,
  authorization: 'approved' as const,
  savedDetailBaseline: 'Saved before this draft.',
}

const values = {
  detail: 'Measured front-left torque.',
  detailOpen: true,
  concern: 'Rear brake squeal after road test',
  tier: '2' as const,
  parts: {
    description: 'Front pad hardware kit',
    preference: 'Motorcraft',
    quantity: '1',
    requestKey: '00000000-0000-4000-8000-000000000004',
  },
  hold: { kind: 'parts' as const, note: 'Waiting on the hardware kit.' },
}

describe('simple-work local draft codec v2', () => {
  it('round-trips detail and auxiliary drafts without binding them to clock timestamps', () => {
    const encoded = encodeSimpleWorkDraft(scope, values)

    expect(encoded).not.toBeNull()
    expect(decodeSimpleWorkDraft(encoded, scope)).toEqual({
      kind: 'recovered',
      source: 'v2',
      values,
    })
    expect(simpleWorkDraftStorageKey(scope)).toContain(
      `v2:${actorProfileId}:${ticketId}:${jobId}`,
    )
    expect(encoded).not.toContain('workspaceUpdatedAt')
  })

  it('returns both local and current server detail when the saved baseline changed', () => {
    const encoded = encodeSimpleWorkDraft(scope, values)

    expect(decodeSimpleWorkDraft(encoded, {
      ...scope,
      savedDetailBaseline: 'Saved elsewhere after this draft.',
    })).toEqual({
      kind: 'conflict',
      source: 'v2',
      values,
      savedDetailBaseline: 'Saved before this draft.',
      currentSavedDetail: 'Saved elsewhere after this draft.',
    })
  })

  it('migrates only the exact compatible v1 key and maps note to optional detail', () => {
    const legacyRaw = JSON.stringify({
      version: 1,
      scope: {
        actorProfileId,
        ticketId,
        jobId,
        workspaceUpdatedAt: '2026-07-21T18:00:00.000Z',
        workStatus: 'in_progress',
        authorization: 'approved',
      },
      values: {
        note: values.detail,
        concern: values.concern,
        tier: values.tier,
        parts: values.parts,
        hold: values.hold,
      },
    })

    expect(decodeSimpleWorkDraft(null, scope, legacyRaw)).toEqual({
      kind: 'recovered',
      source: 'v1',
      values,
    })
    expect(legacySimpleWorkDraftStorageKey(scope)).toContain(
      `v1:${actorProfileId}:${ticketId}:${jobId}`,
    )
  })

  it.each([
    ['another technician', { ...scope, actorProfileId: '00000000-0000-4000-8000-000000000005' }],
    ['another repair order', { ...scope, ticketId: '00000000-0000-4000-8000-000000000006' }],
    ['another job', { ...scope, jobId: '00000000-0000-4000-8000-000000000007' }],
    ['terminal work', { ...scope, workStatus: 'done' as const }],
    ['unapproved work', { ...scope, authorization: 'awaiting_approval' as const }],
  ])('fails closed for %s', (_label, mismatchedScope) => {
    const encoded = encodeSimpleWorkDraft(scope, values)
    expect(decodeSimpleWorkDraft(encoded, mismatchedScope)).toEqual({ kind: 'invalid' })
  })

  it('distinguishes clean storage from malformed, oversized, and wrong-version data', () => {
    expect(decodeSimpleWorkDraft(null, scope)).toEqual({ kind: 'clean' })
    expect(decodeSimpleWorkDraft('{oops', scope)).toEqual({ kind: 'invalid' })
    expect(decodeSimpleWorkDraft(JSON.stringify({ version: 9 }), scope))
      .toEqual({ kind: 'invalid' })
    expect(encodeSimpleWorkDraft(scope, {
      ...values,
      detail: 'x'.repeat(2_001),
    })).toBeNull()
  })
})
