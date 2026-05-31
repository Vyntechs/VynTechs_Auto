import { describe, it, expect } from 'vitest'
import type { Flow } from '@/lib/flows/types'
import {
  addStep, removeStep, addAnswer, updateAnswer, removeAnswer, updateStep, setStartStep,
} from '@/lib/curator/flow-mutations'

const seed = (): Flow => ({
  startStepId: 's1',
  steps: {
    s1: { kind: 'question', n: 1, of: 1, title: 'Seed', question: 'Go?', answers: [{ id: 'a1', label: 'Yes', finding: { verdict: 'v', action: 'a', severity: 'fixable' } }] },
  },
})

describe('addStep', () => {
  it('adds a new question step with no answers and leaves the original untouched', () => {
    const f = addStep(seed(), { id: 's2', kind: 'question', title: 'New', question: 'Q?' })
    expect(f.steps.s2).toBeDefined()
    expect(f.steps.s2.kind).toBe('question')
    expect((f.steps.s2 as { answers: unknown[] }).answers).toEqual([])
    expect(f.steps.s1).toEqual(seed().steps.s1)
  })
  it('throws if step id already exists', () => {
    expect(() => addStep(seed(), { id: 's1', kind: 'question', title: 't', question: 'q' })).toThrow()
  })
})

describe('addAnswer', () => {
  it('appends an answer to a question step', () => {
    const f = addAnswer(seed(), 's1', { id: 'a2', label: 'No', finding: { verdict: 'v2', action: 'a2', severity: 'investigate' } })
    expect((f.steps.s1 as { answers: { id: string }[] }).answers).toHaveLength(2)
    expect((f.steps.s1 as { answers: { id: string }[] }).answers[1].id).toBe('a2')
  })
})

describe('updateStep', () => {
  it('shallow-merges fields into a step', () => {
    const f = updateStep(seed(), 's1', { title: 'Renamed' })
    expect(f.steps.s1.title).toBe('Renamed')
    expect((f.steps.s1 as { question: string }).question).toBe('Go?')
  })
})

describe('removeAnswer', () => {
  it('removes an answer by id', () => {
    const f = removeAnswer(seed(), 's1', 'a1')
    expect((f.steps.s1 as { answers: unknown[] }).answers).toEqual([])
  })
})

describe('removeStep', () => {
  it('removes a step; dangling next surfaces in validation, not silently fixed', () => {
    const base: Flow = {
      startStepId: 's1',
      steps: {
        s1: { kind: 'question', n: 1, of: 2, title: 't', question: 'q', answers: [{ id: 'a1', label: 'x', next: 's2' }] },
        s2: { kind: 'question', n: 2, of: 2, title: 't', question: 'q', answers: [{ id: 'a2', label: 'y', finding: { verdict: 'v', action: 'a', severity: 'fixable' } }] },
      },
    }
    const f = removeStep(base, 's2')
    expect(f.steps.s2).toBeUndefined()
    expect((f.steps.s1 as { answers: { next?: string }[] }).answers[0].next).toBe('s2')
  })
  it('throws when removing the start step', () => {
    expect(() => removeStep(seed(), 's1')).toThrow()
  })
})

describe('setStartStep', () => {
  it('sets startStepId to a different existing step', () => {
    const base: Flow = {
      startStepId: 's1',
      steps: {
        s1: { kind: 'question', n: 1, of: 1, title: 't', question: 'q', answers: [{ id: 'a1', label: 'x', finding: { verdict: 'v', action: 'a', severity: 'fixable' } }] },
        s2: { kind: 'question', n: 1, of: 1, title: 't', question: 'q', answers: [{ id: 'a2', label: 'x', finding: { verdict: 'v', action: 'a', severity: 'fixable' } }] },
      },
    }
    expect(setStartStep(base, 's2').startStepId).toBe('s2')
  })
  it('throws if target step does not exist', () => {
    expect(() => setStartStep(seed(), 'nope')).toThrow()
  })
})
