import { describe, expect, it } from 'vitest'
import type {
  AdaptiveCoverage,
  AdaptiveDiagnosticState,
  CoverageState,
} from '@/lib/diagnostics/adaptive/contracts'
import {
  changeDiagnosticMode,
  initialAdaptiveState,
  selectCurrentAdaptiveTest,
} from '@/lib/diagnostics/adaptive/state'
import type { TopologyTestAction } from '@/lib/diagnostics/load-system-topology'

const FIRST_TEST_ID = '11111111-1111-4111-8111-111111111111'
const SECOND_TEST_ID = '22222222-2222-4222-8222-222222222222'
const UNKNOWN_TEST_ID = '33333333-3333-4333-8333-333333333333'

function coverage(
  state: CoverageState,
  technicianInstructionsAvailable: boolean,
): AdaptiveCoverage {
  return {
    state,
    system: 'fuel',
    symptomSlug: 'p0087',
    reasons: [],
    technicianInstructionsAvailable,
    instructionProof: technicianInstructionsAvailable
      ? {
          componentIds: ['44444444-4444-4444-8444-444444444444'],
          testActionIds: [FIRST_TEST_ID],
          branchLogicIds: [],
          verifiedAxes: ['fuel-system'],
        }
      : null,
  }
}

function action(
  id: string,
  slug: string,
): TopologyTestAction {
  return {
    id,
    slug,
    description: slug,
    scenarioRequired: 'key-on-engine-off',
    observationMethod: 'pressure_test_with_gauge',
    expectedObservation: 'Within specification',
    invasiveness: 1,
    implicatedByCurrentSymptom: true,
    branches: [],
  }
}

describe('adaptive diagnostic state', () => {
  it.each(['exact', 'verified_equivalent'] as const)(
    'starts guided for proof-closed %s coverage',
    (coverageState) => {
      expect(initialAdaptiveState(coverage(coverageState, true))).toEqual({
        schemaVersion: 1,
        mode: 'guided',
        coverage: coverage(coverageState, true),
        currentTestActionId: null,
        finding: null,
      })
    },
  )

  it.each(['exact', 'verified_equivalent'] as const)(
    'starts manual for proof-open %s coverage',
    (coverageState) => {
      expect(initialAdaptiveState(coverage(coverageState, false)).mode).toBe('manual')
    },
  )

  it.each(['partial', 'draft', 'unsupported'] as const)(
    'starts manual for %s coverage',
    (coverageState) => {
      expect(initialAdaptiveState(coverage(coverageState, false)).mode).toBe('manual')
    },
  )

  it('changes mode without replacing diagnostic progress', () => {
    const original: AdaptiveDiagnosticState = {
      schemaVersion: 1,
      mode: 'guided',
      coverage: coverage('exact', true),
      currentTestActionId: SECOND_TEST_ID,
      finding: {
        verdict: 'Fuel pressure is below specification',
        recommendation: 'Inspect the supply side',
        severity: 'investigate',
        confidence: 0.8,
        sourceEventIds: [],
        sourceArtifactIds: [],
        unresolvedGaps: [],
      },
    }

    const changed = changeDiagnosticMode(original, 'manual')

    expect(changed).not.toBe(original)
    expect(changed).toEqual({ ...original, mode: 'manual' })
    expect(original.mode).toBe('guided')
    expect(changed.coverage).toBe(original.coverage)
    expect(changed.finding).toBe(original.finding)
  })

  it('selects the current test by adaptive database ID rather than legacy slug', () => {
    const steps = [
      action(FIRST_TEST_ID, SECOND_TEST_ID),
      action(SECOND_TEST_ID, 'inspect-supply'),
    ]
    const state = {
      ...initialAdaptiveState(coverage('exact', true)),
      currentTestActionId: SECOND_TEST_ID,
    }

    expect(selectCurrentAdaptiveTest(state, steps)).toBe(steps[1])
  })

  it('falls back to the first adaptive test for an unknown current ID without mutating state', () => {
    const steps = [
      action(FIRST_TEST_ID, 'measure-pressure'),
      action(SECOND_TEST_ID, 'inspect-supply'),
    ]
    const state = {
      ...initialAdaptiveState(coverage('exact', true)),
      currentTestActionId: UNKNOWN_TEST_ID,
    }
    const snapshot = structuredClone(state)

    expect(selectCurrentAdaptiveTest(state, steps)).toBe(steps[0])
    expect(state).toEqual(snapshot)
    expect(selectCurrentAdaptiveTest(state, [])).toBeNull()
  })
})
