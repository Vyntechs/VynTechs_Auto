import { describe, it, expect } from 'vitest'
import type { Flow, WizardState } from '@/lib/flows/types'
import { advance, back, isTerminal, currentStep, synthesizeHandoffFromFinding } from '@/lib/wizard-state'

const flow: Flow = {
  startStepId: 's1',
  steps: {
    s1: {
      kind: 'question',
      n: 1,
      of: 2,
      title: 'Pull DTCs',
      question: 'Any codes?',
      answers: [
        { id: 'a1', label: 'Yes — P2291', next: 's2' },
        { id: 'a2', label: 'No codes', finding: { verdict: 'Move on to fuel side', action: 'Test fuel pressure', severity: 'next-system' } },
      ],
    },
    s2: {
      kind: 'question',
      n: 2,
      of: 2,
      title: 'ICP live',
      question: 'ICP reaches 500 psi?',
      answers: [
        { id: 'a3', label: 'No, plateaus < 500 psi', finding: { verdict: 'HPO leak', action: 'Air test', severity: 'fixable' } },
      ],
    },
  },
}

const initial = (flowVersionId = 'fv-1'): WizardState => ({
  flowVersionId,
  stepId: flow.startStepId,
  history: [],
  finding: null,
})

describe('advance', () => {
  it('advances to the next step on an answer with .next', () => {
    const s = advance(initial(), flow, 'a1')
    expect(s.stepId).toBe('s2')
    expect(s.history).toEqual([{ stepId: 's1', answerId: 'a1', label: 'Yes — P2291', title: 'Pull DTCs' }])
    expect(s.finding).toBeNull()
  })

  it('terminates with a finding on a terminal answer', () => {
    const s = advance(initial(), flow, 'a2')
    expect(s.stepId).toBe('s1') // step does not change; the finding is what terminates
    expect(s.history).toHaveLength(1)
    expect(s.finding).not.toBeNull()
    expect(s.finding?.verdict).toBe('Move on to fuel side')
  })

  it('throws on unknown answer id', () => {
    expect(() => advance(initial(), flow, 'nope')).toThrow()
  })

  it('throws when state is already terminal', () => {
    const terminal = advance(initial(), flow, 'a2')
    expect(() => advance(terminal, flow, 'a1')).toThrow(/terminal/i)
  })
})

describe('back', () => {
  it('pops the latest history entry and restores stepId', () => {
    const after = advance(initial(), flow, 'a1')
    const popped = back(after, flow)
    expect(popped.stepId).toBe('s1')
    expect(popped.history).toEqual([])
    expect(popped.finding).toBeNull()
  })

  it('clears finding when popping from a terminal state', () => {
    const terminal = advance(initial(), flow, 'a2')
    const popped = back(terminal, flow)
    expect(popped.finding).toBeNull()
    expect(popped.stepId).toBe('s1')
    expect(popped.history).toEqual([])
  })

  it('no-ops when history is empty', () => {
    const s = initial()
    expect(back(s, flow)).toEqual(s)
  })
})

describe('isTerminal + currentStep', () => {
  it('isTerminal reflects finding presence', () => {
    expect(isTerminal(initial())).toBe(false)
    const t = advance(initial(), flow, 'a2')
    expect(isTerminal(t)).toBe(true)
  })

  it('currentStep returns the step object', () => {
    expect(currentStep(initial(), flow)?.title).toBe('Pull DTCs')
  })
})

// ---------------------------------------------------------------------------
// procedure step branch of advance
// ---------------------------------------------------------------------------

const procFlow: Flow = {
  startStepId: 'p1',
  steps: {
    p1: {
      kind: 'procedure',
      n: 1,
      of: 2,
      title: 'Set up the air test',
      instructions: 'Cap the rail and pressurize.',
      next: 'q1',
    },
    q1: {
      kind: 'question',
      n: 2,
      of: 2,
      title: 'Leak?',
      question: 'Hear a leak?',
      answers: [
        { id: 'y', label: 'Yes', finding: { verdict: 'HPO leak', action: 'Repair', severity: 'fixable' } },
      ],
    },
  },
}

const initialProc = (flowVersionId = 'fv-proc'): WizardState => ({
  flowVersionId,
  stepId: procFlow.startStepId,
  history: [],
  finding: null,
})

describe('advance — procedure step', () => {
  it('advances to step.next and records a synthetic _proc history entry', () => {
    // answerId is intentionally ignored for procedure steps
    const s = advance(initialProc(), procFlow, 'ignored')
    expect(s.stepId).toBe('q1')
    expect(s.finding).toBeNull()
    expect(s.history).toEqual([
      { stepId: 'p1', answerId: '_proc', label: 'Continue', title: 'Set up the air test' },
    ])
  })
})

// ---------------------------------------------------------------------------
// synthesizeHandoffFromFinding
// ---------------------------------------------------------------------------

describe('synthesizeHandoffFromFinding', () => {
  it('full finding — maps all fields correctly and diagnosisLockedAt is a valid ISO timestamp', () => {
    const finding = {
      verdict: 'HPO leak',
      action: 'Air test the high-pressure oil system',
      expectedSignal: 'Pressure stabilizes above 500 psi',
      severity: 'fixable' as const,
      confidence: 0.8,
    }
    const result = synthesizeHandoffFromFinding({ finding })

    expect(result.phase).toBe('repairing')
    expect(result.rootCauseSummary).toBe(finding.verdict)
    expect(result.proposedAction.description).toBe(finding.action)
    expect(result.proposedAction.confidence).toBe(0.8)
    expect(result.proposedAction.expectedSignal).toBe(finding.expectedSignal)
    // diagnosisLockedAt must be a valid ISO string
    expect(!Number.isNaN(Date.parse(result.diagnosisLockedAt))).toBe(true)
    expect(new Date(result.diagnosisLockedAt).toISOString()).toBe(result.diagnosisLockedAt)
  })

  it('no confidence — defaults to 1.0', () => {
    const finding = {
      verdict: 'Injector O-ring failure',
      action: 'Replace O-rings',
      severity: 'fixable' as const,
    }
    const result = synthesizeHandoffFromFinding({ finding })
    expect(result.proposedAction.confidence).toBe(1.0)
  })

  it('no expectedSignal — proposedAction.expectedSignal is undefined', () => {
    const finding = {
      verdict: 'Fuel pressure drop',
      action: 'Check HFCM',
      severity: 'next-system' as const,
    }
    const result = synthesizeHandoffFromFinding({ finding })
    expect(result.proposedAction.expectedSignal).toBeUndefined()
  })
})
