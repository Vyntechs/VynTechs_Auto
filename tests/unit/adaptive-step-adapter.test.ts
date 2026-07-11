import { describe, expect, it } from 'vitest'
import type { TopologyTestAction } from '@/lib/diagnostics/load-system-topology'
import {
  adaptiveStepId,
  resolveAdaptiveBranch,
} from '@/lib/diagnostics/adaptive/step-adapter'

function action(overrides: Partial<TopologyTestAction> = {}): TopologyTestAction {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'measure-rail-pressure',
    description: 'Measure rail pressure',
    scenarioRequired: 'key-on-engine-off',
    observationMethod: 'pressure_test_with_gauge',
    expectedObservation: 'At least 5,000 psi',
    invasiveness: 1,
    implicatedByCurrentSymptom: true,
    branches: [],
    ...overrides,
  }
}

describe('adaptive step adapter', () => {
  it('uses the selected database ID instead of the legacy slug', () => {
    expect(adaptiveStepId(action())).toBe('11111111-1111-4111-8111-111111111111')
  })

  it('rejects legacy fixtures that do not carry a database ID', () => {
    const { id: _id, ...legacyStep } = action()

    expect(() => adaptiveStepId(legacyStep as TopologyTestAction)).toThrow(
      /database id/i,
    )
  })

  it('routes to the exact database target for an exact raw verdict match', () => {
    const step = action({
      branches: [
        {
          condition: 'pressure is below specification',
          verdict: 'fail',
          nextAction: 'Inspect pump supply',
          routesToTestActionId: '22222222-2222-4222-8222-222222222222',
        },
      ],
    })
    const target = action({
      id: '22222222-2222-4222-8222-222222222222',
      slug: 'inspect-pump-supply',
    })

    expect(resolveAdaptiveBranch(step, 'fail', [step, target])).toEqual({
      kind: 'route',
      toTestActionId: '22222222-2222-4222-8222-222222222222',
    })
  })

  it('fails closed when the database target is outside the implicated sequence', () => {
    const step = action({
      branches: [
        {
          condition: 'pressure is below specification',
          verdict: 'fail',
          nextAction: 'Inspect pump supply',
          routesToTestActionId: '22222222-2222-4222-8222-222222222222',
        },
      ],
    })

    expect(resolveAdaptiveBranch(step, 'fail', [step])).toEqual({ kind: 'none' })
  })

  it('returns words when an exact match has no database target', () => {
    const step = action({
      branches: [
        {
          condition: 'test cannot be completed',
          verdict: 'impossible',
          nextAction: 'Record the access limitation',
          routesToTestActionId: null,
        },
      ],
    })

    expect(resolveAdaptiveBranch(step, 'impossible', [step])).toEqual({
      kind: 'words',
      nextAction: 'Record the access limitation',
    })
  })

  it('does not normalize or case-fold raw database verdicts', () => {
    const step = action({
      branches: [
        {
          condition: 'authored legacy token',
          verdict: 'FAIL',
          nextAction: 'Do not infer this route',
          routesToTestActionId: '33333333-3333-4333-8333-333333333333',
        },
      ],
    })

    expect(resolveAdaptiveBranch(step, 'fail', [step])).toEqual({ kind: 'none' })
  })
})
