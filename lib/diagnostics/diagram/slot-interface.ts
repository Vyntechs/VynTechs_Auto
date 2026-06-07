/**
 * C3 — slot-interface (type-only contract module, owner T3).
 *
 * The frozen vocabulary every diagram track builds against. Pure types +
 * const arrays/tables; NO React/DOM/network/AI runtime. Templates (T4), mobile
 * (T5), the screen (T6), and INTEGRATION import from here and never re-declare.
 */
import type { ReactNode } from 'react'
import type {
  PartKind,
  PartRoleSpecial,
  WireRole,
  PartTier,
  PartProvenance,
  Terminal,
  PartReading,
} from '@/components/diagram-kit/part-api'

// --- C1 building-block types this engine keys on (re-import, never re-declare) ---
import type {
  SystemTopology,
  TopologyComponent,
  TopologyTestAction,
  TopologyScenario,
  MeterMode,
} from '@/lib/diagnostics/load-system-topology'

// MeterMode's single source is C1; re-export so engine modules (show-rule.ts)
// can import it from here without re-declaring the union.
export type { MeterMode }

// --- Slot names (spec §5; 'detail' = why/see-source/Operational-Theory prose,
//     'quiet-field' = the confirm-shape whole-spine backdrop) ---
export type SlotName =
  | 'source'
  | 'device-under-test'
  | 'ground'
  | 'downstream-anchor'
  | 'overlay'
  | 'gauge'
  | 'good-vs-bad'
  | 'route'
  | 'location'
  | 'detail'
  | 'quiet-field'

export const ALL_SLOT_NAMES = [
  'source',
  'device-under-test',
  'ground',
  'downstream-anchor',
  'overlay',
  'gauge',
  'good-vs-bad',
  'route',
  'location',
  'detail',
  'quiet-field',
] as const satisfies readonly SlotName[]

// --- Step shapes (10 v1; templates key off the KIND OF TEST, never a system) ---
export type StepShape =
  | 'confirm'
  | 'electrical-probe'
  | 'continuity-ground'
  | 'single-pid'
  | 'pressure-flow'
  | 'look-inspect'
  | 'locate'
  | 'fork'
  | 'duty-pwm'
  | 'voltage-drop'

export const ALL_STEP_SHAPES = [
  'confirm',
  'electrical-probe',
  'continuity-ground',
  'single-pid',
  'pressure-flow',
  'look-inspect',
  'locate',
  'fork',
  'duty-pwm',
  'voltage-drop',
] as const satisfies readonly StepShape[]

// --- selectStepShape SIGNATURE (body in show-rule.ts; keys ONLY on these 4) ---
export type SelectStepShape = (
  observationMethod: string,
  meterMode: MeterMode | null,
  stepKind: string | null,
  hasBranches: boolean,
) => StepShape

// --- The single overlay primitive (the meter hookup; exactly one per scene) ---
export type OverlayKind =
  | 'probe-lead'
  | 'voltage-drop-bracket'
  | 'amp-clamp'
  | 'pressure-gauge-tee'
  | 'test-point'
  | 'scope-clip'

export type OverlaySpec = {
  kind: OverlayKind
  /** Component the hookup attaches to (the device-under-test). */
  attachPartId: string
  /** Terminal/pin id the lead lands on, when electrical; null otherwise. */
  attachTerminalId: string | null
}

// --- Verdict signal (PURE DATA — the Meter renders it; T3 does not color red twice) ---
export type VerdictSignal = 'out-of-range' | 'branch-fail' | 'neutral'

export type GaugeSpec = {
  reading: PartReading
  verdict: VerdictSignal
}

// --- A part placed into a slot (C2 ref + the props the part needs) ---
export type PartSlotFill = {
  fillKind: 'part'
  partId: string
  kind: PartKind
  roleSpecial: PartRoleSpecial | null
  tier: PartTier
  provenance: PartProvenance
  terminals: Terminal[]
  selected: boolean
}

// --- A set of active wires (by role) for a slot ---
export type WireSlotFill = {
  fillKind: 'wire-set'
  wireIds: string[]
  roles: WireRole[]
}

// --- The 'detail' prose payload (probe/why/secondary/theory from C1 prose) ---
export type DetailSlotFill = {
  fillKind: 'detail'
  probe: string | null
  why: string | null
  secondary: string | null
  theori: string | null
}

// --- A degraded text-only fork arm (when routesToTestActionId is null) ---
export type RouteSlotFill = {
  fillKind: 'route'
  /** Resolved next-step id, or null when only words-only nextAction exists. */
  routesToTestActionId: string | null
  /** Honest words-only fallback (branch.nextAction). */
  nextActionText: string | null
}

export type OverlaySlotFill = { fillKind: 'overlay'; overlay: OverlaySpec }
export type GaugeSlotFill = { fillKind: 'gauge'; gauge: GaugeSpec }

export type SlotFill =
  | PartSlotFill
  | WireSlotFill
  | OverlaySlotFill
  | GaugeSlotFill
  | DetailSlotFill
  | RouteSlotFill
  | null

// --- The flat enumerable rendered set (the leak test asserts on this) ---
export type ResolvedElement =
  | { elementKind: 'part'; partId: string; kind: PartKind }
  | { elementKind: 'wire'; wireId: string; role: WireRole | null }
  | { elementKind: 'terminal'; terminalId: string; partId: string }
  | { elementKind: 'overlay'; overlay: OverlayKind }

export type ResolvedScene = {
  shape: StepShape
  slots: Record<SlotName, SlotFill>
  activeWireIds: string[]
  overlay: OverlaySpec | null
  gaugeSpec: GaugeSpec | null
  forkRoute: RouteSlotFill | null
  focus: { selectedPartId: string }
  pinsAllowed: boolean
  /** The ONE scene-level verdict, computed for EVERY shape (even gauge-less
   *  look/locate/confirm/fork). gaugeSpec.verdict mirrors this. */
  verdict: VerdictSignal
  /** Flat enumerable set — parts + wires + terminals + overlay. */
  elements: ResolvedElement[]
}

// --- The assembler + template function types ---
export type AssembleScene = (
  topology: SystemTopology,
  step: TopologyTestAction,
  activeScenario: TopologyScenario | null,
) => ResolvedScene

/**
 * Per-shape layout template. `onInspect`/`selectedPartId` are the typed channel
 * for the KEEP-tap-to-inspect override (T4 threads onInspect onto each placed
 * part; T6 mounts <Template scene onInspect selectedPartId />).
 */
export type StepTemplate = (props: {
  scene: ResolvedScene
  onInspect?: (partId: string) => void
  selectedPartId?: string | null
}) => ReactNode

// --- Per-shape required/optional/FORBIDDEN slot table (encodes the leak-lock) ---
export type ShapeSlotRule = {
  required: readonly SlotName[]
  optional: readonly SlotName[]
  forbidden: readonly SlotName[]
}

// Helper type kept exported so T4 can resolve a focus component without
// re-importing C1 in two ways.
export type FocusComponent = TopologyComponent

export const SHAPE_SLOT_RULES: Record<StepShape, ShapeSlotRule> = {
  'electrical-probe': {
    required: ['source', 'device-under-test', 'ground', 'overlay', 'detail'],
    optional: ['downstream-anchor', 'gauge'],
    forbidden: ['good-vs-bad', 'route', 'location', 'quiet-field'],
  },
  'continuity-ground': {
    required: ['device-under-test', 'ground', 'overlay', 'detail'],
    optional: ['source', 'downstream-anchor', 'gauge'],
    forbidden: ['good-vs-bad', 'route', 'location', 'quiet-field'],
  },
  'voltage-drop': {
    required: ['source', 'device-under-test', 'ground', 'overlay', 'detail'],
    optional: ['downstream-anchor', 'gauge'],
    forbidden: ['good-vs-bad', 'route', 'location', 'quiet-field'],
  },
  'duty-pwm': {
    required: ['source', 'device-under-test', 'ground', 'overlay', 'detail'],
    optional: ['downstream-anchor', 'gauge'],
    forbidden: ['good-vs-bad', 'route', 'location', 'quiet-field'],
  },
  'pressure-flow': {
    required: ['device-under-test', 'gauge', 'overlay', 'detail'],
    optional: ['downstream-anchor'],
    // pressure forbids ALL electrical slots — the leak-lock.
    forbidden: ['source', 'ground', 'good-vs-bad', 'route', 'location', 'quiet-field'],
  },
  'single-pid': {
    required: ['device-under-test', 'gauge', 'detail'],
    optional: [],
    forbidden: ['source', 'ground', 'overlay', 'good-vs-bad', 'route', 'location', 'quiet-field', 'downstream-anchor'],
  },
  'look-inspect': {
    required: ['device-under-test', 'good-vs-bad', 'detail'],
    optional: [],
    // no wires/pins/overlay/gauge on a look step.
    forbidden: ['source', 'ground', 'overlay', 'gauge', 'route', 'location', 'quiet-field', 'downstream-anchor'],
  },
  locate: {
    required: ['device-under-test', 'location', 'detail'],
    optional: [],
    // locate suppresses the gauge.
    forbidden: ['source', 'ground', 'overlay', 'gauge', 'good-vs-bad', 'route', 'quiet-field', 'downstream-anchor'],
  },
  fork: {
    required: ['device-under-test', 'route', 'detail'],
    optional: ['gauge'],
    forbidden: ['source', 'ground', 'overlay', 'good-vs-bad', 'location', 'quiet-field', 'downstream-anchor'],
  },
  confirm: {
    required: ['device-under-test', 'quiet-field', 'detail'],
    optional: [],
    forbidden: ['source', 'ground', 'overlay', 'gauge', 'good-vs-bad', 'route', 'location', 'downstream-anchor'],
  },
}
