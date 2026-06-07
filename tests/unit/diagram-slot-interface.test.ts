import { describe, it, expect, expectTypeOf } from 'vitest'
import type {
  SlotName,
  StepShape,
  SlotFill,
  PartSlotFill,
  ResolvedScene,
  ResolvedElement,
  VerdictSignal,
  OverlayKind,
  AssembleScene,
  StepTemplate,
} from '@/lib/diagnostics/diagram/slot-interface'
import {
  ALL_SLOT_NAMES,
  ALL_STEP_SHAPES,
  ALL_OVERLAY_KINDS,
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

  it('OverlayKind is the 6-member union with the canonical spellings (R4)', () => {
    const expected: OverlayKind[] = [
      'probe-lead', 'voltage-drop-bracket', 'amp-clamp',
      'pressure-gauge-tee', 'test-point', 'scope-clip',
    ]
    expect([...ALL_OVERLAY_KINDS].sort()).toEqual([...expected].sort())
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

  it('pressure-flow forbids electrical source/ground but REQUIRES the overlay (gauge-tee)', () => {
    const r = SHAPE_SLOT_RULES['pressure-flow']
    expect(r.forbidden).toContain('source')
    expect(r.forbidden).toContain('ground')
    // pressure-flow is the one non-electrical shape that uses the generic overlay
    // primitive (the gauge-tee hookup) — it MUST require it, never forbid it.
    expect(r.required).toContain('overlay')
    expect(r.forbidden).not.toContain('overlay')
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

describe('SlotFill discriminant freeze (R2 — the highest-coupling break)', () => {
  // The fillKind arms a template's slot-box switches on. Locking the literal set
  // here means a regression that re-introduces a 'text' arm fails to compile.
  type FillKind = NonNullable<SlotFill>['fillKind']
  const ARMS: Record<FillKind, true> = {
    part: true,
    'wire-set': true,
    overlay: true,
    gauge: true,
    detail: true,
    route: true,
  }

  it('SlotFill arms are exactly part/wire-set/overlay/gauge/detail/route (NO text arm)', () => {
    expect(Object.keys(ARMS).sort()).toEqual(
      ['part', 'wire-set', 'overlay', 'gauge', 'detail', 'route'].sort(),
    )
    // @ts-expect-error — 'text' is NOT a SlotFill arm (R2 removed it).
    const _noText: FillKind = 'text'
    expect(_noText).toBe('text') // value exists at runtime; the type line above must error
  })

  it('the part arm is FLAT and carries everything DiagramPartProps needs (incl. name + active)', () => {
    // A template renders a part from the scene ALONE (no topology access), so the
    // flat part arm must supply name + active (C-1) — not a nested {part,props}.
    const fill: PartSlotFill = {
      fillKind: 'part',
      partId: 'hp',
      kind: 'pump',
      name: 'High-Pressure Pump',
      roleSpecial: null,
      tier: 'focus',
      provenance: 'drafted',
      terminals: [],
      active: true,
      selected: false,
    }
    expect(fill.name).toBe('High-Pressure Pump')
    expect(fill.active).toBe(true)
    expectTypeOf<PartSlotFill['name']>().toEqualTypeOf<string>()
    expectTypeOf<PartSlotFill['active']>().toEqualTypeOf<boolean>()
    // it is assignable into SlotFill (a valid arm of the union)
    const asFill: SlotFill = fill
    expect(asFill).not.toBeNull()
  })
})

describe('VerdictSignal closed union (R6)', () => {
  it('has exactly out-of-range / branch-fail / neutral (no stray fail)', () => {
    // Exhaustive keyed map — adding/removing a member breaks compilation.
    const ALL: Record<VerdictSignal, true> = {
      'out-of-range': true,
      'branch-fail': true,
      neutral: true,
    }
    expect(Object.keys(ALL).sort()).toEqual(
      ['out-of-range', 'branch-fail', 'neutral'].sort(),
    )
  })
})
