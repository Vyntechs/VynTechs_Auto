import { describe, it, expect } from 'vitest'
import { ALL_STEP_SHAPES } from '@/lib/diagnostics/diagram/slot-interface'
import {
  selectStepShape,
  computeShowBudget,
  OBSERVATION_METHODS,
} from '@/lib/diagnostics/diagram/show-rule'

describe('selectStepShape (Task 3)', () => {
  it('maps every observationMethod value to a known shape (no unmapped arm)', () => {
    // 4 instrument methods + the look/inspect family (real R10 slugs + legacy).
    expect(OBSERVATION_METHODS).toHaveLength(12)
    for (const m of OBSERVATION_METHODS) {
      const shape = selectStepShape(m, null, null, false)
      expect(ALL_STEP_SHAPES).toContain(shape)
    }
  })

  it('electrical_measurement_at_pin splits by meterMode', () => {
    const m = 'electrical_measurement_at_pin'
    expect(selectStepShape(m, 'volts', null, false)).toBe('electrical-probe')
    expect(selectStepShape(m, 'ohms', null, false)).toBe('continuity-ground')
    expect(selectStepShape(m, 'drop', null, false)).toBe('voltage-drop')
    expect(selectStepShape(m, 'duty', null, false)).toBe('duty-pwm')
    expect(selectStepShape(m, 'amps', null, false)).toBe('electrical-probe')
    // null meterMode → the generic electrical probe, never a crash.
    expect(selectStepShape(m, null, null, false)).toBe('electrical-probe')
  })

  it('pressure_test_with_gauge → pressure-flow', () => {
    expect(selectStepShape('pressure_test_with_gauge', 'pressure', null, false)).toBe(
      'pressure-flow',
    )
  })

  it('scan_tool_pid → single-pid', () => {
    expect(selectStepShape('scan_tool_pid', 'pid', null, false)).toBe('single-pid')
  })

  it('visual / audible / touch / smell / mechanical → look-inspect', () => {
    expect(selectStepShape('direct_visual_inspection', null, null, false)).toBe('look-inspect')
    expect(selectStepShape('audible_check', null, null, false)).toBe('look-inspect')
    expect(selectStepShape('tactile_touch_check', null, null, false)).toBe('look-inspect')
    expect(selectStepShape('smell_check', null, null, false)).toBe('look-inspect')
    expect(selectStepShape('mechanical_actuation_check', null, null, false)).toBe('look-inspect')
  })

  it('stepKind=locate/orient/find overrides to locate (any observationMethod)', () => {
    expect(selectStepShape('scan_tool_pid', 'pid', 'locate', false)).toBe('locate')
    expect(selectStepShape('direct_visual_inspection', null, 'orient', false)).toBe('locate')
    expect(selectStepShape('electrical_measurement_at_pin', 'volts', 'find', false)).toBe('locate')
  })

  it('stepKind=confirm overrides to confirm (even over hasBranches)', () => {
    expect(selectStepShape('scan_tool_pid', 'pid', 'confirm', false)).toBe('confirm')
    expect(selectStepShape('direct_visual_inspection', null, 'confirm', true)).toBe('confirm')
  })

  it('a branchy reading is NOT a fork — it keeps its reading shape (branches route the next step)', () => {
    // Fork is now an explicit stepKind decision. A PID/visual/pressure reading with
    // pass/fail branches renders as the reading itself; the branches drive
    // resolveFork for the NEXT step, not a bare routing arm in place of the view.
    expect(selectStepShape('scan_tool_pid', 'pid', null, true)).toBe('single-pid')
    expect(selectStepShape('direct_visual_external', null, null, true)).toBe('look-inspect')
    expect(selectStepShape('pressure_test_with_gauge', 'pressure', null, true)).toBe('pressure-flow')
    expect(selectStepShape('electrical_measurement_at_pin', 'volts', null, true)).toBe(
      'electrical-probe',
    )
  })

  it('stepKind=fork is the ONLY route to a fork shape', () => {
    expect(selectStepShape('scan_tool_pid', 'pid', 'fork', false)).toBe('fork')
    expect(selectStepShape('direct_visual_external', null, 'fork', true)).toBe('fork')
  })

  it('the REAL curated look/inspect slugs (R10) resolve to look-inspect', () => {
    expect(selectStepShape('direct_visual_external', null, null, false)).toBe('look-inspect')
    expect(selectStepShape('direct_visual_internal', null, null, false)).toBe('look-inspect')
    expect(selectStepShape('smell', null, null, false)).toBe('look-inspect')
  })

  it('waveform_capture degrades to a neutral single-pid (no reference trace in v1)', () => {
    expect(selectStepShape('waveform_capture', null, null, false)).toBe('single-pid')
  })

  it('an UNSEEN observationMethod falls back to single-pid (never throws)', () => {
    expect(selectStepShape('telepathic_resonance_scan', null, null, false)).toBe('single-pid')
    expect(selectStepShape('tachyon_scan', 'volts', null, false)).toBe('single-pid')
  })
})

describe('computeShowBudget (Task 4 — the terminals leak-lock by shape)', () => {
  it('pinsAllowed=true ONLY for the 4 electrical shapes', () => {
    expect(computeShowBudget('electrical-probe').pinsAllowed).toBe(true)
    expect(computeShowBudget('continuity-ground').pinsAllowed).toBe(true)
    expect(computeShowBudget('voltage-drop').pinsAllowed).toBe(true)
    expect(computeShowBudget('duty-pwm').pinsAllowed).toBe(true)
  })

  it('pinsAllowed=false for every non-electrical shape', () => {
    for (const shape of [
      'pressure-flow',
      'single-pid',
      'look-inspect',
      'locate',
      'confirm',
      'fork',
    ] as const) {
      expect(computeShowBudget(shape).pinsAllowed).toBe(false)
    }
  })

  it('covers all 10 shapes (no unmapped arm)', () => {
    for (const shape of ALL_STEP_SHAPES) {
      expect(typeof computeShowBudget(shape).pinsAllowed).toBe('boolean')
    }
  })
})
