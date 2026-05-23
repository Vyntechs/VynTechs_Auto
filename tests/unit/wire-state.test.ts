import { describe, it, expect } from 'vitest'
import {
  wireClassName,
  defaultScenarioSlug,
  WIRE_STATE_CLASSES,
} from '@/components/topology/wire-state'
import type { TopologyScenario } from '@/lib/diagnostics/load-system-topology'

const baseScenario = (
  overrides: Partial<TopologyScenario>,
): TopologyScenario => ({
  id: 'x',
  slug: 'x',
  label: 'x',
  sub: 'x',
  kind: 'operation',
  keyPosition: 'on',
  engineState: 'running',
  loadLevel: 'idle',
  isDefault: false,
  displayOrder: 0,
  pinStates: {},
  pinReadings: {},
  ...overrides,
})

describe('wireClassName', () => {
  it('composes role + state classes', () => {
    expect(
      wireClassName({ role: 'signal', state: 'signal-med' }),
    ).toBe('wire wire--signal signal-med')
  })

  it('appends is-active when flagged', () => {
    expect(
      wireClassName({ role: 'pwm', state: 'pwm-high', isActive: true }),
    ).toBe('wire wire--pwm pwm-high is-active')
  })

  it('appends dim when flagged', () => {
    expect(
      wireClassName({ role: '5v-ref', state: 'steady-5v', isDim: true }),
    ).toBe('wire wire--5v-ref steady-5v dim')
  })

  it('does not append both is-active and dim (is-active wins)', () => {
    expect(
      wireClassName({
        role: 'ground',
        state: 'steady-gnd',
        isActive: true,
        isDim: true,
      }),
    ).toBe('wire wire--ground steady-gnd is-active')
  })

  it('uses off when state is not provided', () => {
    expect(wireClassName({ role: '12v' })).toBe('wire wire--12v off')
  })
})

describe('defaultScenarioSlug', () => {
  const scenarios: TopologyScenario[] = [
    baseScenario({ id: 'a', slug: 'key-off', isDefault: false }),
    baseScenario({ id: 'b', slug: 'idle', isDefault: true }),
    baseScenario({ id: 'c', slug: 'heavy-load', isDefault: false }),
  ]

  it('returns lastScenarioSlug when it matches a real scenario', () => {
    expect(defaultScenarioSlug(scenarios, 'heavy-load')).toBe('heavy-load')
  })

  it('falls back to isDefault when lastScenarioSlug is null', () => {
    expect(defaultScenarioSlug(scenarios, null)).toBe('idle')
  })

  it('falls back to isDefault when lastScenarioSlug points to a missing scenario', () => {
    expect(defaultScenarioSlug(scenarios, 'fault-from-deleted-platform')).toBe(
      'idle',
    )
  })

  it('falls back to first scenario when nothing is marked default', () => {
    const noDefault = scenarios.map((s) => ({ ...s, isDefault: false }))
    expect(defaultScenarioSlug(noDefault, null)).toBe('key-off')
  })

  it('returns null when no scenarios at all (graceful no-scenarios fallback)', () => {
    expect(defaultScenarioSlug([], null)).toBeNull()
  })
})

describe('WIRE_STATE_CLASSES', () => {
  it('contains all 13 states from spec §4.4', () => {
    expect(WIRE_STATE_CLASSES).toEqual([
      'off',
      'steady-12v', 'steady-5v', 'steady-gnd',
      'signal-rest', 'signal-low', 'signal-med', 'signal-high', 'signal-pegged',
      'pwm-low', 'pwm-med', 'pwm-high', 'pwm-max',
    ])
  })
})
