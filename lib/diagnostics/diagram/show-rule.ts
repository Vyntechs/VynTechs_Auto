/**
 * show-rule — the deterministic show-rule for the diagram (owner T3).
 *
 * Pure functions; NO React/DOM/network/AI. Keys ONLY on the building-block
 * vocabulary (observationMethod, meterMode, stepKind, hasBranches). Zero
 * per-system / per-case branching. Unseen values degrade to a generic shape
 * (never a blank, never a crash).
 */
import type { MeterMode, StepShape } from '@/lib/diagnostics/diagram/slot-interface'

/**
 * The 9 observationMethod values the data speaks. Authored here as the closed
 * set the exhaustiveness test asserts against; an UNSEEN value still maps via
 * the generic fallback in selectStepShape (never a blank, never a crash).
 */
export const OBSERVATION_METHODS = [
  'electrical_measurement_at_pin',
  'pressure_test_with_gauge',
  'scan_tool_pid',
  'direct_visual_inspection',
  'audible_check',
  'tactile_touch_check',
  'smell_check',
  'waveform_capture',
  'mechanical_actuation_check',
] as const

/** Methods that resolve to a no-meter look/inspect shape. */
const LOOK_METHODS: readonly string[] = [
  'direct_visual_inspection',
  'audible_check',
  'tactile_touch_check',
  'smell_check',
  'mechanical_actuation_check',
]

/** stepKind hints that force a placement (locate) step regardless of method. */
const LOCATE_STEP_KINDS: readonly string[] = ['locate', 'orient', 'find']

/** The four metering shapes that own the source/DUT/ground arrangement. */
const ELECTRICAL_SHAPES: readonly StepShape[] = [
  'electrical-probe',
  'continuity-ground',
  'voltage-drop',
  'duty-pwm',
]

/** The electrical sub-shape, keyed on meterMode (generic probe is the default). */
function electricalSplit(meterMode: MeterMode | null): StepShape {
  switch (meterMode) {
    case 'ohms':
      return 'continuity-ground'
    case 'drop':
      return 'voltage-drop'
    case 'duty':
      return 'duty-pwm'
    case 'volts':
    case 'amps':
    case 'pressure': // a pressure meterMode on an electrical method still probes
    case 'pid':
    case null:
    default:
      return 'electrical-probe'
  }
}

/**
 * Map the building-block vocabulary to one of the 10 step shapes. Keys ONLY on
 * (observationMethod, meterMode, stepKind, hasBranches). No per-system logic.
 */
export const selectStepShape = (
  observationMethod: string,
  meterMode: MeterMode | null,
  stepKind: string | null,
  hasBranches: boolean,
): StepShape => {
  // stepKind=locate/orient/find overrides any method — it is a placement step.
  if (stepKind !== null && LOCATE_STEP_KINDS.includes(stepKind)) {
    return 'locate'
  }

  // stepKind=confirm overrides any method (even hasBranches) — it is a
  // confirm/orient framing step the curator marks via stepKind.
  if (stepKind === 'confirm') {
    return 'confirm'
  }

  // The base shape from the KIND OF TEST.
  let base: StepShape
  if (observationMethod === 'electrical_measurement_at_pin') {
    base = electricalSplit(meterMode)
  } else if (observationMethod === 'pressure_test_with_gauge') {
    base = 'pressure-flow'
  } else if (observationMethod === 'scan_tool_pid') {
    base = 'single-pid'
  } else if (LOOK_METHODS.includes(observationMethod)) {
    base = 'look-inspect'
  } else if (observationMethod === 'waveform_capture') {
    // No reference trace in v1 → degrade to a neutral single reading.
    base = 'single-pid'
  } else {
    // Generic fallback for any UNSEEN method — a neutral single reading.
    base = 'single-pid'
  }

  // A branchy NON-electrical reading is a fork (the electrical shapes already
  // own the source/DUT/ground arrangement; branches there route via the Meter).
  if (hasBranches && !ELECTRICAL_SHAPES.includes(base)) {
    return 'fork'
  }

  return base
}

export type ShowBudget = { pinsAllowed: boolean }

/**
 * The terminals leak-lock, as a pure function of step shape: pins/terminals may
 * render ONLY on an electrical metering shape. Everything else is false — a
 * pressure step never shows 12V/GND terminals.
 */
export const computeShowBudget = (shape: StepShape): ShowBudget => ({
  pinsAllowed: ELECTRICAL_SHAPES.includes(shape),
})
