/**
 * slot-resolver — the AssembleScene body (owner T3).
 *
 * Pure; NO React/DOM/network/AI/@xyflow/dagre. Derives the circuit set by a
 * bounded graph-walk, assigns slots by data-derived role, emits exactly one
 * overlay + the active wire set, computes the single verdict signal, builds the
 * detail prose payload + the fork route arm, and degrades honestly on null
 * roles/pins/scenario. Zero per-system / per-case branching: every decision is a
 * pure function of the building-block vocabulary.
 *
 * NOTE on the C1 imports: these are TYPE-ONLY (`import type`). The runtime
 * `loadSystemTopology` is never imported or called here — the engine operates on
 * an already-loaded SystemTopology handed in by the caller.
 */
import type {
  SystemTopology,
  TopologyComponent,
  TopologyTestAction,
  TopologyScenario,
  TopologyPin,
} from '@/lib/diagnostics/load-system-topology'
import type {
  AssembleScene,
  ResolvedScene,
  ResolvedElement,
  SlotName,
  SlotFill,
  PartSlotFill,
  OverlaySpec,
  OverlayKind,
  StepShape,
  VerdictSignal,
  GaugeSpec,
  DetailSlotFill,
  RouteSlotFill,
} from '@/lib/diagnostics/diagram/slot-interface'
import { SHAPE_SLOT_RULES } from '@/lib/diagnostics/diagram/slot-interface'
import type {
  PartKind,
  PartTier,
  PartProvenance,
  WireRole,
  PartReading,
} from '@/components/diagram-kit/part-api'
import { selectStepShape, computeShowBudget } from '@/lib/diagnostics/diagram/show-rule'

/** Wire roles that count as a "source" feed (power or reference). Role-agnostic
 *  among 12v/5v-ref — a 5v sensor reference is as much a source as a 12v feed. */
const POWER_REF_ROLES: readonly string[] = ['12v', '5v-ref']

/** Shape → the single overlay (meter hookup) kind. Shapes absent from this map
 *  declare no overlay (look/locate/confirm/single-pid/fork). */
const OVERLAY_BY_SHAPE: Partial<Record<StepShape, OverlayKind>> = {
  'electrical-probe': 'probe-lead',
  'continuity-ground': 'probe-lead',
  'voltage-drop': 'voltage-drop-bracket',
  'duty-pwm': 'probe-lead',
  'pressure-flow': 'pressure-gauge-tee',
}

/** The focus component = the component that owns this step's test action. */
function findFocus(
  topology: SystemTopology,
  step: TopologyTestAction,
): TopologyComponent | null {
  return (
    topology.components.find((c) => c.testActions.some((t) => t.slug === step.slug)) ?? null
  )
}

/**
 * Bounded breadth-first walk of the connection graph from the focus component.
 * Returns the focus + every component within `depth` hops. No step→circuit FK
 * exists, so the circuit set IS this walk. Islands (no path to focus) excluded.
 */
export function walkCircuitSet(
  topology: SystemTopology,
  focusId: string,
  depth: number,
): TopologyComponent[] {
  const byId = new Map(topology.components.map((c) => [c.id, c]))
  if (!byId.has(focusId)) return []
  const visited = new Set<string>([focusId])
  let frontier = [focusId]
  for (let d = 0; d < depth; d++) {
    const next: string[] = []
    for (const conn of topology.connections) {
      if (frontier.includes(conn.fromComponentId) && !visited.has(conn.toComponentId)) {
        visited.add(conn.toComponentId)
        next.push(conn.toComponentId)
      }
      if (frontier.includes(conn.toComponentId) && !visited.has(conn.fromComponentId)) {
        visited.add(conn.fromComponentId)
        next.push(conn.fromComponentId)
      }
    }
    frontier = next
    if (frontier.length === 0) break
  }
  return [...visited].map((id) => byId.get(id)).filter((c): c is TopologyComponent => !!c)
}

/** Provenance by data, not a grade: field-verified from sourceProvenance; else
 *  drafted (graphite default). needs-field-check is reserved for label gaps. */
function provenanceOf(c: TopologyComponent): PartProvenance {
  if (c.sourceProvenance === 'FIELD-VERIFIED') return 'field-verified'
  return 'drafted'
}

/**
 * Build a part slot fill from a component.
 *
 * `active` derivation (honest, NEVER fabricated): the focus/device-under-test is
 * always active (it is the subject of the step). A source/ground/downstream part
 * is active ONLY when it sits on a wire we light up AND a scenario is present
 * (energization is a scenario claim) — callers pass `active` accordingly. When
 * there is no scenario, every non-focus part defaults to `active: false`.
 */
function partFill(
  c: TopologyComponent,
  tier: PartTier,
  selected: boolean,
  active: boolean,
): PartSlotFill {
  return {
    fillKind: 'part',
    partId: c.id,
    kind: c.kind as PartKind,
    name: c.name,
    roleSpecial: null,
    tier,
    provenance: provenanceOf(c),
    terminals: [],
    active,
    selected,
  }
}

function emptySlots(): Record<SlotName, SlotFill> {
  return {
    source: null,
    'device-under-test': null,
    ground: null,
    'downstream-anchor': null,
    overlay: null,
    gauge: null,
    'good-vs-bad': null,
    route: null,
    location: null,
    detail: null,
    'quiet-field': null,
  }
}

/** Source = the OTHER endpoint of a power/ref wire touching the focus. */
function deriveSource(
  topology: SystemTopology,
  focusId: string,
): TopologyComponent | null {
  const byId = new Map(topology.components.map((c) => [c.id, c]))
  for (const conn of topology.connections) {
    if (conn.electricalRole == null || !POWER_REF_ROLES.includes(conn.electricalRole)) continue
    if (conn.toComponentId === focusId) return byId.get(conn.fromComponentId) ?? null
    if (conn.fromComponentId === focusId) return byId.get(conn.toComponentId) ?? null
  }
  return null
}

/** Ground = the OTHER endpoint of a ground-role wire touching the focus. */
function deriveGround(
  topology: SystemTopology,
  focusId: string,
): TopologyComponent | null {
  const byId = new Map(topology.components.map((c) => [c.id, c]))
  for (const conn of topology.connections) {
    if (conn.electricalRole !== 'ground') continue
    if (conn.fromComponentId === focusId) return byId.get(conn.toComponentId) ?? null
    if (conn.toComponentId === focusId) return byId.get(conn.fromComponentId) ?? null
  }
  return null
}

/** Downstream-anchor = the outbound fluid-line endpoint from the focus. */
function deriveDownstream(
  topology: SystemTopology,
  focusId: string,
): TopologyComponent | null {
  const byId = new Map(topology.components.map((c) => [c.id, c]))
  for (const conn of topology.connections) {
    if (conn.connectionKind !== 'fluid-line') continue
    if (conn.fromComponentId === focusId) return byId.get(conn.toComponentId) ?? null
  }
  return null
}

/** The wires touching the focus (those we light up + enumerate as active). */
function activeWires(topology: SystemTopology, focusId: string) {
  return topology.connections.filter(
    (c) => c.fromComponentId === focusId || c.toComponentId === focusId,
  )
}

/**
 * The single verdict signal as PURE DATA. Precedence (C1):
 *   isOutOfRange authoritative → branch verdict==='fail' → neutral default.
 * NO prose-number parsing; numeric compare is deferred. The Meter renders this;
 * T3 never decides red twice. A null scenario yields no out-of-range evidence.
 *
 * R14 scope (v1): out-of-range is checked against the FOCUS component's pins
 * ONLY. TODO(R14): widen to ALL walked-scene pins once the walk threads pin
 * ownership through to here.
 */
export function computeVerdict(
  step: TopologyTestAction,
  scenario: TopologyScenario | null,
  focusPins: TopologyPin[],
): VerdictSignal {
  const outMap = scenario?.isOutOfRange
  if (outMap) {
    for (const p of focusPins) {
      if (outMap[p.id] === true) return 'out-of-range'
    }
  }
  if (step.branches.some((b) => b.verdict === 'fail')) return 'branch-fail'
  return 'neutral'
}

/**
 * Thin PartReading handoff — C2 owns the Meter; T3 only passes EXPECT/NOW + the
 * scene verdict. NOW is null (numeric tech_outcomes not loaded into the engine).
 * Field names match the FROZEN C2 PartReading {expect, now, unit, mode, verdict}.
 */
function buildReading(step: TopologyTestAction, verdict: VerdictSignal): PartReading {
  return {
    expect: step.expectedObservation ?? null,
    now: null,
    unit: step.expectedUnit ?? null,
    mode: step.meterMode ?? null,
    verdict,
  }
}

/** The 'detail' prose payload from C1 component fields; null where absent. */
function buildDetail(focus: TopologyComponent | null): DetailSlotFill {
  return {
    fillKind: 'detail',
    probe: focus?.probingTactic ?? null,
    why: focus?.body ?? null,
    secondary: focus?.wireSummary ?? null,
    theori: focus?.electricalContract ?? null,
  }
}

/** The single fork arm: routesToTestActionId when present, else words-only. */
function buildForkRoute(step: TopologyTestAction): RouteSlotFill | null {
  const failing = step.branches.find((b) => b.verdict === 'fail') ?? step.branches[0]
  if (!failing) return null
  return {
    fillKind: 'route',
    routesToTestActionId: failing.routesToTestActionId ?? null,
    nextActionText: failing.nextAction ?? null,
  }
}

export const assembleScene: AssembleScene = (
  topology,
  step,
  activeScenario,
): ResolvedScene => {
  const shape = selectStepShape(
    step.observationMethod,
    step.meterMode ?? null,
    step.stepKind ?? null,
    step.branches.length > 0,
  )
  const budget = computeShowBudget(shape)
  const focus = findFocus(topology, step)
  const rule = SHAPE_SLOT_RULES[shape]
  const allowed = (s: SlotName) => !rule.forbidden.includes(s)
  // A non-focus part is only honestly energized when there IS a scenario.
  const energized = activeScenario != null

  const slots = emptySlots()
  const elements: ResolvedElement[] = []
  let activeWireIds: string[] = []
  let overlay: OverlaySpec | null = null

  // The ONE verdict — computed for EVERY shape (even gauge-less ones).
  const verdict = computeVerdict(step, activeScenario, focus?.pins ?? [])

  if (focus) {
    // device-under-test — always present, always honestly active (the subject).
    slots['device-under-test'] = partFill(focus, 'focus', true, true)
    elements.push({ elementKind: 'part', partId: focus.id, kind: focus.kind as PartKind })

    if (allowed('source')) {
      const src = deriveSource(topology, focus.id)
      if (src) {
        slots['source'] = partFill(src, 'anchor', false, energized)
        elements.push({ elementKind: 'part', partId: src.id, kind: src.kind as PartKind })
      }
    }
    if (allowed('ground')) {
      const grd = deriveGround(topology, focus.id)
      if (grd) {
        slots['ground'] = partFill(grd, 'anchor', false, energized)
        elements.push({ elementKind: 'part', partId: grd.id, kind: grd.kind as PartKind })
      }
    }
    if (allowed('downstream-anchor')) {
      const dn = deriveDownstream(topology, focus.id)
      if (dn) {
        slots['downstream-anchor'] = partFill(dn, 'recede', false, energized)
        elements.push({ elementKind: 'part', partId: dn.id, kind: dn.kind as PartKind })
      }
    }

    // Active wires touching the focus (the set we light up + enumerate).
    const wires = activeWires(topology, focus.id)
    activeWireIds = wires.map((w) => w.id)
    for (const w of wires) {
      elements.push({
        elementKind: 'wire',
        wireId: w.id,
        role: (w.electricalRole as WireRole | null) ?? null,
      })
    }

    // Terminals: ONLY when pinsAllowed (the leak-lock). Never fabricate pins.
    if (budget.pinsAllowed) {
      for (const p of focus.pins) {
        elements.push({ elementKind: 'terminal', terminalId: p.id, partId: focus.id })
      }
    }

    // Exactly one overlay (the meter hookup) — only when the shape declares one.
    const overlayKind = OVERLAY_BY_SHAPE[shape]
    if (overlayKind) {
      const attachTerminalId = budget.pinsAllowed ? (focus.pins[0]?.id ?? null) : null
      overlay = { kind: overlayKind, attachPartId: focus.id, attachTerminalId }
      slots['overlay'] = { fillKind: 'overlay', overlay }
      elements.push({ elementKind: 'overlay', overlay: overlayKind })
    }
  }

  // Gauge for shapes that declare one (gauge not forbidden). verdict MIRRORS the
  // scene verdict (T3 does not compute red twice).
  let gaugeSpec: GaugeSpec | null = null
  if (!rule.forbidden.includes('gauge')) {
    gaugeSpec = { reading: buildReading(step, verdict), verdict }
    slots['gauge'] = { fillKind: 'gauge', gauge: gaugeSpec }
  }

  // 'detail' prose payload is allowed on every shape (the why/probe content).
  slots['detail'] = buildDetail(focus)

  // The fork route arm (one arm; honest words-only degrade).
  let forkRoute: RouteSlotFill | null = null
  if (shape === 'fork') {
    forkRoute = buildForkRoute(step)
    if (forkRoute) slots['route'] = forkRoute
  }

  return {
    shape,
    slots,
    activeWireIds,
    overlay,
    gaugeSpec,
    forkRoute,
    focus: { selectedPartId: focus?.id ?? '' },
    pinsAllowed: budget.pinsAllowed,
    verdict,
    elements,
  }
}

/** R1 — downstream tracks import the runtime resolver under either name. */
export const resolveSlots = assembleScene
