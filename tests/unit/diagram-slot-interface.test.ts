import { describe, it, expect, expectTypeOf } from 'vitest'
import type {
  SlotName,
  StepShape,
  ResolvedScene,
  ResolvedElement,
  VerdictSignal,
  AssembleScene,
  StepTemplate,
} from '@/lib/diagnostics/diagram/slot-interface'
import {
  ALL_SLOT_NAMES,
  ALL_STEP_SHAPES,
  SHAPE_SLOT_RULES,
} from '@/lib/diagnostics/diagram/slot-interface'
import type { TopologyScenario } from '@/lib/diagnostics/load-system-topology'
import type { ReactNode } from 'react'

describe('C3 slot-interface closed unions', () => {
  it('SlotName is the 11-member closed union', () => {
    const expected: SlotName[] = [
      'source', 'device-under-test', 'ground', 'downstream-anchor', 'overlay',
      'gauge', 'good-vs-bad', 'route', 'location', 'detail', 'quiet-field',
    ]
    expect([...ALL_SLOT_NAMES].sort()).toEqual([...expected].sort())
  })

  it('StepShape is the 10-member v1 closed union', () => {
    const expected: StepShape[] = [
      'confirm', 'electrical-probe', 'continuity-ground', 'single-pid',
      'pressure-flow', 'look-inspect', 'locate', 'fork', 'duty-pwm', 'voltage-drop',
    ]
    expect([...ALL_STEP_SHAPES].sort()).toEqual([...expected].sort())
  })
})

const ELECTRICAL_SHAPES = [
  'electrical-probe', 'continuity-ground', 'voltage-drop', 'duty-pwm',
] as const

describe('SHAPE_SLOT_RULES leak-lock', () => {
  it('every StepShape has a rule entry', () => {
    for (const shape of ALL_STEP_SHAPES) {
      expect(SHAPE_SLOT_RULES[shape]).toBeDefined()
    }
  })

  it('required/optional/forbidden are mutually exclusive per shape', () => {
    for (const shape of ALL_STEP_SHAPES) {
      const r = SHAPE_SLOT_RULES[shape]
      const seen = new Set<string>()
      for (const s of [...r.required, ...r.optional, ...r.forbidden]) {
        expect(seen.has(s)).toBe(false)
        seen.add(s)
      }
    }
  })

  it('every non-electrical shape forbids the source AND ground electrical slots', () => {
    for (const shape of ALL_STEP_SHAPES) {
      if ((ELECTRICAL_SHAPES as readonly string[]).includes(shape)) continue
      const r = SHAPE_SLOT_RULES[shape]
      expect(r.forbidden).toContain('source')
      expect(r.forbidden).toContain('ground')
    }
  })

  it('pressure-flow forbids all electrical slots', () => {
    const r = SHAPE_SLOT_RULES['pressure-flow']
    expect(r.forbidden).toContain('source')
    expect(r.forbidden).toContain('ground')
  })

  it('locate suppresses the gauge', () => {
    expect(SHAPE_SLOT_RULES['locate'].forbidden).toContain('gauge')
  })

  it('fork has exactly one route slot and forbids the system backdrop', () => {
    const r = SHAPE_SLOT_RULES['fork']
    expect(r.required).toContain('route')
    expect(r.forbidden).toContain('quiet-field')
  })
})

describe('C3 reconciliation invariants (R3/R7/R8/R10)', () => {
  it('ResolvedScene carries a top-level verdict: VerdictSignal (R7)', () => {
    expectTypeOf<ResolvedScene>().toHaveProperty('verdict')
    expectTypeOf<ResolvedScene['verdict']>().toEqualTypeOf<VerdictSignal>()
  })

  it('ResolvedElement discriminates on elementKind (R3)', () => {
    expectTypeOf<ResolvedElement>().toHaveProperty('elementKind')
  })

  it('AssembleScene third param is TopologyScenario | null (R10)', () => {
    expectTypeOf<Parameters<AssembleScene>[2]>()
      .toEqualTypeOf<TopologyScenario | null>()
  })

  it('StepTemplate takes {scene,onInspect?,selectedPartId?} and returns ReactNode (R8)', () => {
    expectTypeOf<StepTemplate>().parameter(0).toHaveProperty('onInspect')
    expectTypeOf<StepTemplate>().parameter(0).toHaveProperty('selectedPartId')
    expectTypeOf<ReturnType<StepTemplate>>().toEqualTypeOf<ReactNode>()
  })
})
