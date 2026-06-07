import { describe, it, expect } from 'vitest'
import {
  SHAPE_SLOT_RULES,
  ALL_STEP_SHAPES,
  type StepShape,
  type SlotName,
} from '@/lib/diagnostics/diagram/slot-interface'
import type { SlotSet } from '@/components/diagram-kit/templates/template-local-types'
import { ELECTRICAL_SLOTS } from '@/components/diagram-kit/templates/electrical'
import { PRESSURE_SLOTS } from '@/components/diagram-kit/templates/pressure-flow'
import { SINGLE_PID_SLOTS } from '@/components/diagram-kit/templates/single-pid'
import { LOOK_SLOTS } from '@/components/diagram-kit/templates/look-inspect'
import { LOCATE_SLOTS } from '@/components/diagram-kit/templates/locate'
import { FORK_SLOTS } from '@/components/diagram-kit/templates/fork'
import { CONFIRM_SLOTS } from '@/components/diagram-kit/templates/confirm'

/**
 * The definitive structural conformance test: every template's declared slot set
 * must honor the FROZEN SHAPE_SLOT_RULES (C3). This is the cross-check that would
 * have caught a missing required slot (e.g. 'detail') or a forbidden slot leaking
 * into a template (e.g. pressure-flow carrying 'source').
 *
 * Mirrors the registry: the 4 electrical shapes share ELECTRICAL_SLOTS; the rest
 * map to their own const. (electrical.tsx serves four shapes with ONE slot set, so
 * that set must satisfy all four — 'source' is required for 3 and optional for
 * continuity-ground, so keeping it in ELECTRICAL_SLOTS is conformant.)
 */
const SLOT_SETS: Record<StepShape, SlotSet> = {
  'electrical-probe': ELECTRICAL_SLOTS,
  'continuity-ground': ELECTRICAL_SLOTS,
  'voltage-drop': ELECTRICAL_SLOTS,
  'duty-pwm': ELECTRICAL_SLOTS,
  'pressure-flow': PRESSURE_SLOTS,
  'single-pid': SINGLE_PID_SLOTS,
  'look-inspect': LOOK_SLOTS,
  locate: LOCATE_SLOTS,
  fork: FORK_SLOTS,
  confirm: CONFIRM_SLOTS,
}

describe('template slot sets conform to the frozen SHAPE_SLOT_RULES (C3)', () => {
  for (const shape of ALL_STEP_SHAPES) {
    const rule = SHAPE_SLOT_RULES[shape]
    const slotSet = SLOT_SETS[shape]
    const keys = Object.keys(slotSet) as SlotName[]

    it(`${shape}: declares every REQUIRED slot`, () => {
      for (const required of rule.required) {
        expect(keys).toContain(required)
      }
    })

    it(`${shape}: declares NO FORBIDDEN slot`, () => {
      for (const forbidden of rule.forbidden) {
        expect(keys).not.toContain(forbidden)
      }
    })

    it(`${shape}: every declared key is in required ∪ optional`, () => {
      const allowed = new Set<SlotName>([...rule.required, ...rule.optional])
      for (const key of keys) {
        expect(allowed.has(key)).toBe(true)
      }
    })
  }
})
