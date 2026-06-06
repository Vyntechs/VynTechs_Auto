import type {
  TopologyScenario,
  TopologyWireState,
} from '@/lib/diagnostics/load-system-topology'

export type { TopologyWireState } from '@/lib/diagnostics/load-system-topology'

export type ElectricalRole =
  | 'signal'
  | '5v-ref'
  | 'low-ref'
  | 'pwm'
  | '12v'
  | 'ground'

/** Spec §4.4 — all 13 wire-state classes, in display order. */
export const WIRE_STATE_CLASSES: TopologyWireState[] = [
  'off',
  'steady-12v', 'steady-5v', 'steady-gnd',
  'signal-rest', 'signal-low', 'signal-med', 'signal-high', 'signal-pegged',
  'pwm-low', 'pwm-med', 'pwm-high', 'pwm-max',
]

type WireClassNameInput = {
  role: ElectricalRole
  state?: TopologyWireState
  isActive?: boolean
  isDim?: boolean
}

/**
 * Builds the CSS class string for a wire SVG path.
 *
 *   wire wire--<role> <state> [is-active|dim]
 *
 * Spec §4.4 — role + state are the visual contract. is-active wins over dim
 * when both are set (the selected pin's own wire is never dimmed).
 */
export function wireClassName({
  role,
  state = 'off',
  isActive = false,
  isDim = false,
}: WireClassNameInput): string {
  const parts = ['wire', `wire--${role}`, state]
  if (isActive) parts.push('is-active')
  else if (isDim) parts.push('dim')
  return parts.join(' ')
}

/**
 * Picks the scenario slug to activate on page load.
 *
 *   1. lastScenarioSlug (from sessions.last_scenario_slug) if it points to a
 *      real scenario for this (platform, system)
 *   2. the scenario marked isDefault — D17 mandates exactly one per slice
 *   3. the first scenario in the array (graceful fallback if data is mid-seed)
 *   4. null if there are no scenarios (no-scenarios fallback per spec §9.A)
 */
export function defaultScenarioSlug(
  scenarios: TopologyScenario[],
  lastScenarioSlug: string | null,
): string | null {
  if (scenarios.length === 0) return null
  if (lastScenarioSlug) {
    const matched = scenarios.find((s) => s.slug === lastScenarioSlug)
    if (matched) return matched.slug
  }
  const isDefault = scenarios.find((s) => s.isDefault)
  if (isDefault) return isDefault.slug
  return scenarios[0]!.slug
}
