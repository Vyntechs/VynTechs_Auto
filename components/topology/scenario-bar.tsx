'use client'

import type { TopologyScenario } from '@/lib/diagnostics/load-system-topology'

type CompoundState = {
  keyPosition: 'off' | 'on'
  engineState: 'off' | 'running'
  loadLevel: 'idle' | 'light' | 'medium' | 'heavy'
}

type Props = {
  scenarios: TopologyScenario[]
  activeSlug: string | null
  onScenarioChange: (slug: string) => void
}

const LOAD_LEVELS: CompoundState['loadLevel'][] = [
  'idle',
  'light',
  'medium',
  'heavy',
]

/**
 * Compositional picker (spec D13 + §4.8 + §5.1).
 *
 * Four control groups mirror physical truck controls:
 *
 *   - Ignition (Off | On)                            always visible
 *   - Engine state (Off | Running)                   visible when ignition = On
 *   - Load level (Idle | Light | Medium | Heavy)     visible when engine = Running
 *   - Pretend-fault buttons (always visible)
 *
 * Slug derivation is data-driven: when the user toggles a control we recompute
 * the new compound state and look up the matching scenario slug from
 * scenarios[].keyPosition / engineState / loadLevel. No hardcoded mapping.
 *
 * Fault buttons override the operation controls — engaging a fault swaps the
 * active scenario to that fault. Re-engaging any operation control returns
 * to that operation state (the fault is cleared by picking a real state).
 */
export function ScenarioBar({
  scenarios,
  activeSlug,
  onScenarioChange,
}: Props) {
  const activeScenario =
    scenarios.find((s) => s.slug === activeSlug) ?? null
  const isFaultActive = activeScenario?.kind === 'fault'
  const operationScenarios = scenarios.filter((s) => s.kind === 'operation')
  const faultScenarios = scenarios.filter((s) => s.kind === 'fault')

  const compound = deriveCompound(activeScenario)

  const handleIgnition = (keyPosition: 'off' | 'on') => {
    const slug = findOperationSlug(operationScenarios, {
      ...compound,
      keyPosition,
    })
    if (slug) onScenarioChange(slug)
  }
  const handleEngine = (engineState: 'off' | 'running') => {
    const slug = findOperationSlug(operationScenarios, {
      ...compound,
      engineState,
    })
    if (slug) onScenarioChange(slug)
  }
  const handleLoad = (loadLevel: CompoundState['loadLevel']) => {
    const slug = findOperationSlug(operationScenarios, {
      ...compound,
      loadLevel,
    })
    if (slug) onScenarioChange(slug)
  }

  return (
    <div
      className="topo-scenario-bar"
      role="group"
      aria-label="Scenario simulator"
    >
      <div className="topo-scenario-bar__group">
        <span className="topo-scenario-bar__label">Ignition</span>
        <button
          type="button"
          aria-pressed={!isFaultActive && compound.keyPosition === 'off'}
          aria-label="Ignition off"
          className={`topo-scenario-bar__pill${
            !isFaultActive && compound.keyPosition === 'off' ? ' is-active' : ''
          }`}
          onClick={() => handleIgnition('off')}
        >
          Off
        </button>
        <button
          type="button"
          aria-pressed={!isFaultActive && compound.keyPosition === 'on'}
          aria-label="Ignition on"
          className={`topo-scenario-bar__pill${
            !isFaultActive && compound.keyPosition === 'on' ? ' is-active' : ''
          }`}
          onClick={() => handleIgnition('on')}
        >
          On
        </button>
      </div>

      {compound.keyPosition === 'on' && (
        <div className="topo-scenario-bar__group">
          <span className="topo-scenario-bar__label">Engine</span>
          {(['off', 'running'] as const).map((state) => (
            <button
              key={state}
              type="button"
              aria-pressed={!isFaultActive && compound.engineState === state}
              aria-label={`Engine ${state}`}
              className={`topo-scenario-bar__pill${
                !isFaultActive && compound.engineState === state
                  ? ' is-active'
                  : ''
              }`}
              onClick={() => handleEngine(state)}
            >
              {state === 'off' ? 'Off' : 'Running'}
            </button>
          ))}
        </div>
      )}

      {compound.keyPosition === 'on' && compound.engineState === 'running' && (
        <div className="topo-scenario-bar__group">
          <span className="topo-scenario-bar__label">Load</span>
          {LOAD_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              aria-pressed={!isFaultActive && compound.loadLevel === level}
              aria-label={level}
              className={`topo-scenario-bar__pill${
                !isFaultActive && compound.loadLevel === level
                  ? ' is-active'
                  : ''
              }`}
              onClick={() => handleLoad(level)}
            >
              {level.charAt(0).toUpperCase() + level.slice(1)}
            </button>
          ))}
        </div>
      )}

      {faultScenarios.length > 0 && (
        <div className="topo-scenario-bar__group topo-scenario-bar__group--fault">
          <span className="topo-scenario-bar__label">Pretend fault</span>
          {faultScenarios.map((s) => (
            <button
              key={s.slug}
              type="button"
              aria-pressed={activeSlug === s.slug}
              aria-label={s.label}
              className={`topo-scenario-bar__pill topo-scenario-bar__pill--fault${
                activeSlug === s.slug ? ' is-active' : ''
              }`}
              onClick={() => onScenarioChange(s.slug)}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Looks up the operation scenario matching a requested compound state.
 *
 * Falls back gracefully:
 *   1. exact match on keyPosition + engineState + loadLevel
 *   2. key-on + engine-off (no load level applies)
 *   3. key-off (no engine or load)
 *   4. anything in the same key position
 *
 * Returns null only if no scenarios match the key position at all.
 */
function findOperationSlug(
  operations: TopologyScenario[],
  target: CompoundState,
): string | null {
  const exact = operations.find(
    (s) =>
      s.keyPosition === target.keyPosition &&
      s.engineState === target.engineState &&
      s.loadLevel === target.loadLevel,
  )
  if (exact) return exact.slug

  if (target.keyPosition === 'on' && target.engineState === 'off') {
    const c = operations.find(
      (s) => s.keyPosition === 'on' && s.engineState === 'off',
    )
    if (c) return c.slug
  }

  if (target.keyPosition === 'off') {
    const c = operations.find((s) => s.keyPosition === 'off')
    if (c) return c.slug
  }

  const sameKey = operations.find((s) => s.keyPosition === target.keyPosition)
  return sameKey?.slug ?? null
}

/**
 * Pulls compound UI state out of the active scenario, respecting the natural
 * truck-state hierarchy: when the key is off the engine can't run; when the
 * engine is off the load level is meaningless. Filling missing fields with
 * the lowest-friction default in each branch makes "flip ignition on from
 * key-off" land at key-on (engine off) instead of jumping past key-on to
 * idle.
 *
 * For a fault scenario (no keyPosition/engineState/loadLevel), assume the
 * truck was at idle when the fault was simulated — keeps the operation
 * controls in a sensible resume position when the tech taps any operation
 * pill to clear the fault.
 */
function deriveCompound(active: TopologyScenario | null): CompoundState {
  if (!active || active.kind === 'fault') {
    return { keyPosition: 'on', engineState: 'running', loadLevel: 'idle' }
  }
  const keyPosition = active.keyPosition ?? 'on'
  if (keyPosition === 'off') {
    return { keyPosition: 'off', engineState: 'off', loadLevel: 'idle' }
  }
  const engineState = active.engineState ?? 'running'
  if (engineState === 'off') {
    return { keyPosition: 'on', engineState: 'off', loadLevel: 'idle' }
  }
  return {
    keyPosition: 'on',
    engineState: 'running',
    loadLevel: active.loadLevel ?? 'idle',
  }
}
