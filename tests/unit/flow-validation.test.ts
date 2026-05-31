import { describe, it, expect } from 'vitest'
import type { Flow } from '@/lib/flows/types'
import { validateFlowForPublish, validateFlowSlugs } from '@/lib/curator/flow-validation'

const minimal = (overrides: Partial<Flow> = {}): Flow => ({
  startStepId: 'step-1',
  steps: {
    'step-1': {
      kind: 'question',
      n: 1,
      of: 1,
      title: 'Test',
      question: 'Yes?',
      citations: [],
      conflicts: [],
      answers: [
        {
          id: 'a1',
          label: 'Yes',
          finding: { verdict: 'OK', action: 'Done', severity: 'fixable' },
        },
      ],
    },
  },
  ...overrides,
})

describe('validateFlowForPublish', () => {
  it('passes on a minimal one-step flow with terminal answer', () => {
    expect(validateFlowForPublish(minimal())).toEqual({ ok: true })
  })

  it('fails when startStepId references a non-existent step', () => {
    const r = validateFlowForPublish(minimal({ startStepId: 'nope' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toContain('startStepId "nope" not found in steps')
  })

  it('fails when an answer.next points to a non-existent step', () => {
    const f = minimal({
      steps: {
        'step-1': {
          kind: 'question', n: 1, of: 1, title: 't', question: 'q',
          answers: [{ id: 'a1', label: 'x', next: 'ghost' }],
        },
      },
    })
    const r = validateFlowForPublish(f)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some((e) => e.includes('"ghost"'))).toBe(true)
  })

  it('fails when a question step has zero answers', () => {
    const f = minimal({
      steps: { 'step-1': { kind: 'question', n: 1, of: 1, title: 't', question: 'q', answers: [] } },
    })
    expect(validateFlowForPublish(f).ok).toBe(false)
  })

  it('fails on unreachable steps', () => {
    const f: Flow = {
      startStepId: 'step-1',
      steps: {
        'step-1': { kind: 'question', n: 1, of: 1, title: 't', question: 'q', answers: [{ id: 'a1', label: 'x', finding: { verdict: 'v', action: 'a', severity: 'fixable' } }] },
        orphan: { kind: 'question', n: 1, of: 1, title: 't', question: 'q', answers: [{ id: 'a2', label: 'x', finding: { verdict: 'v', action: 'a', severity: 'fixable' } }] },
      },
    }
    const r = validateFlowForPublish(f)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some((e) => e.toLowerCase().includes('unreachable'))).toBe(true)
  })

  it('fails when a citation has an empty excerpt (anti-fabrication gate per agent-06 / #98)', () => {
    const f = minimal({
      steps: {
        'step-1': {
          kind: 'question', n: 1, of: 1, title: 't', question: 'q',
          citations: [{ sourceUrl: 'https://example.com', title: 'Example', fetchedAt: '2026-05-26T00:00:00Z', excerpt: '', evidenceGrade: 'confirmed' }],
          answers: [{ id: 'a1', label: 'x', finding: { verdict: 'v', action: 'a', severity: 'fixable' } }],
        },
      },
    })
    const r = validateFlowForPublish(f)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some((e) => e.toLowerCase().includes('excerpt'))).toBe(true)
  })

  it('allows a citation with grade=unverified to skip the excerpt requirement', () => {
    const f = minimal({
      steps: {
        'step-1': {
          kind: 'question', n: 1, of: 1, title: 't', question: 'q',
          citations: [{ sourceUrl: 'https://example.com', title: 'Example', fetchedAt: '2026-05-26T00:00:00Z', excerpt: '', evidenceGrade: 'unverified' }],
          answers: [{ id: 'a1', label: 'x', finding: { verdict: 'v', action: 'a', severity: 'fixable' } }],
        },
      },
    })
    expect(validateFlowForPublish(f)).toEqual({ ok: true })
  })
})

describe('validateFlowSlugs', () => {
  it('passes when both slugs are in the catalog', () => {
    expect(validateFlowSlugs('ford-super-duty-3rd-gen-60-psd', 'cranks-no-start')).toEqual({ ok: true })
  })
  it('fails on an unknown platform slug', () => {
    const r = validateFlowSlugs('made-up', 'cranks-no-start')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some((e) => e.toLowerCase().includes('platform'))).toBe(true)
  })
  it('fails on an unknown symptom slug', () => {
    const r = validateFlowSlugs('ford-super-duty-3rd-gen-60-psd', 'made-up')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.some((e) => e.toLowerCase().includes('symptom'))).toBe(true)
  })
})
