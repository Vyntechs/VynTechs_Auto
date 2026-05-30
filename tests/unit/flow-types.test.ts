import { describe, it, expect } from 'vitest'
import type {
  Answer, Citation, Finding, Flow, Step, WizardState,
} from '@/lib/flows/types'

describe('flow types', () => {
  it('Answer is a discriminated union over next | finding', () => {
    // @ts-expect-error - missing BOTH next and finding (the "stuck answer")
    const bad: Answer = { id: 'a1', label: 'Yes' }
    expect(bad).toBeDefined() // silence unused-var

    const goodNext: Answer = { id: 'a1', label: 'Yes', next: 'step-2' }
    expect(goodNext.next).toBe('step-2')

    const goodFinding: Answer = {
      id: 'a2',
      label: 'No',
      finding: { verdict: 'FRP failed', action: 'Replace sensor', severity: 'fixable' },
    }
    expect(goodFinding.finding?.verdict).toBe('FRP failed')
  })

  it('Citation requires a non-empty excerpt (anti-fabrication gate)', () => {
    const c: Citation = {
      sourceUrl: 'https://example.com',
      title: 'Example',
      fetchedAt: '2026-05-26T00:00:00Z',
      excerpt: 'A real excerpt actually returned from the fetched page.',
      evidenceGrade: 'confirmed',
    }
    expect(c.excerpt.length).toBeGreaterThan(0)
  })

  it('Step supports kind="question" and kind="procedure"', () => {
    const q: Step = {
      kind: 'question', n: 1, of: 5, title: 'Test',
      question: 'Lift pump primes?',
      answers: [{ id: 'a1', label: 'Yes', next: 'step-2' }],
    }
    expect(q.kind).toBe('question')

    const p: Step = {
      kind: 'procedure', n: 5, of: 6, title: 'Run air test',
      instructions: 'Pull air cleaner, FICM, degas bottle...',
      next: 'step-6',
    }
    expect(p.kind).toBe('procedure')
  })

  it('Flow body supports citations[]/conflicts[] per node', () => {
    const f: Flow = {
      startStepId: 'step-1',
      steps: {
        'step-1': {
          kind: 'question', n: 1, of: 1, title: 'Test', question: 'Test?',
          citations: [], conflicts: [],
          answers: [{ id: 'a1', label: 'Yes',
            finding: { verdict: 'OK', action: 'Done', severity: 'fixable' } }],
        },
      },
    }
    expect(f.steps['step-1'].citations).toEqual([])
  })

  it('WizardState carries flowVersionId for version-pinning', () => {
    const w: WizardState = {
      flowVersionId: '00000000-0000-0000-0000-000000000001',
      stepId: 'step-1', history: [], finding: null,
    }
    expect(w.flowVersionId).toBeDefined()
  })
})
