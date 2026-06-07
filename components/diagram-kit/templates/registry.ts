import type { StepShape, StepTemplate } from '@/lib/diagnostics/diagram/slot-interface'
import Confirm from './confirm'
import Electrical from './electrical'
import PressureFlow from './pressure-flow'
import SinglePid from './single-pid'
import LookInspect from './look-inspect'
import Locate from './locate'
import Fork from './fork'
import Generic from './generic'

/** Pure map keyed ONLY on the T3-produced StepShape. electrical.tsx serves four shapes:
 *  electrical-probe / continuity-ground / voltage-drop / duty-pwm (sub-type lives in the data).
 *
 *  Typed Record<StepShape, StepTemplate>, so TypeScript enforces that EVERY StepShape in the
 *  frozen C3 union has an entry — adding a v1 shape fails to compile here until it is mapped
 *  (fail-loud, not a silent blank). The runtime `?? Generic` in resolveTemplate covers shapes
 *  outside the static union (genuinely unseen at runtime). */
export const STEP_TEMPLATES: Record<StepShape, StepTemplate> = {
  confirm: Confirm,
  'electrical-probe': Electrical,
  'continuity-ground': Electrical,
  'voltage-drop': Electrical,
  'duty-pwm': Electrical,
  'single-pid': SinglePid,
  'pressure-flow': PressureFlow,
  'look-inspect': LookInspect,
  locate: Locate,
  fork: Fork,
}

/** Resolve a template by shape; an unmapped/unseen shape falls back to the generic template. */
export function resolveTemplate(shape: StepShape): StepTemplate {
  return STEP_TEMPLATES[shape] ?? Generic
}
