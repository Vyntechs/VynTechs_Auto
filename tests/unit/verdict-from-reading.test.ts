import { describe, it, expect } from 'vitest'
import {
  verdictFromReading,
  type ReadingInput,
} from '@/lib/diagnostics/diagram/verdict-from-reading'
import type { TopologyTestAction } from '@/lib/diagnostics/load-system-topology'

function step(over: Partial<TopologyTestAction> = {}): TopologyTestAction {
  return {
    slug: 's',
    description: '',
    scenarioRequired: '',
    observationMethod: '',
    expectedObservation: null,
    invasiveness: 0,
    implicatedByCurrentSymptom: true,
    expectedValue: null,
    expectedUnit: null,
    expectedTolerance: null,
    branches: [],
    ...over,
  } as TopologyTestAction
}

describe('verdictFromReading', () => {
  it('numeric step: within tolerance -> pass', () => {
    const s = step({ expectedValue: 5, expectedTolerance: 0.2 })
    expect(verdictFromReading({ value: 5.1, observedVerdict: null }, s)).toBe('pass')
    expect(verdictFromReading({ value: 4.85, observedVerdict: null }, s)).toBe('pass')
  })

  it('numeric step: outside tolerance -> fail', () => {
    const s = step({ expectedValue: 5, expectedTolerance: 0.2 })
    expect(verdictFromReading({ value: 5.5, observedVerdict: null }, s)).toBe('fail')
  })

  it('prose step (no numeric expected): returns the tech tap', () => {
    expect(verdictFromReading({ value: null, observedVerdict: 'pass' }, step())).toBe('pass')
    expect(verdictFromReading({ value: null, observedVerdict: 'fail' }, step())).toBe('fail')
    expect(verdictFromReading({ value: null, observedVerdict: 'neutral' }, step())).toBe('neutral')
  })

  it('prose step with no tap and no value -> null (do not advance)', () => {
    expect(verdictFromReading({ value: null, observedVerdict: null }, step())).toBeNull()
  })

  it('numeric step but no numeric value entered -> falls back to the tap', () => {
    const s = step({ expectedValue: 5, expectedTolerance: 0.2 })
    expect(verdictFromReading({ value: null, observedVerdict: 'pass' }, s)).toBe('pass')
  })
})
