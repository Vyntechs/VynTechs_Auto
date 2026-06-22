import { and, arrayContains, eq, inArray } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/queries'
import { mapDbVerdictToFork } from '@/lib/diagnostics/diagram/verdict-vocab'
import {
  platforms,
  symptoms,
  components,
  componentConnections,
  observableProperties,
  testActions,
  branchLogic,
  symptomTestImplications,
  componentPins,
  systemScenarios,
  scenarioWireStates,
  pinScenarioReadings,
  systemDataStatus,
  sessions,
} from '@/lib/db/schema'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * The meter hookup vocabulary. Nullable everywhere — a test action that isn't a
 * meter reading (pressure / look / PID) carries `null`. Exported here as the
 * SINGLE source so C2 (part-api) and C3 (slot-interface) import the name and
 * never re-declare it.
 */
export type MeterMode =
  | 'volts' | 'ohms' | 'drop' | 'duty' | 'amps' | 'pid' | 'pressure'

export type TopologyObservableProperty = {
  slug: string
  description: string
  observationMethod: string
}

export type TopologyBranch = {
  condition: string
  verdict: string
  nextAction: string
  // C1 additive (Wave 0 type-freeze; runtime wired by T1). Optional so the
  // unchanged loader still typechecks; neutral-by-absence.
  routesToTestActionId?: string | null
  reasoning?: string | null
}

// ---------------------------------------------------------------------------
// Branch dedup helper
// ---------------------------------------------------------------------------

/**
 * Provenance values in descending priority order.
 * A branch with a higher-priority provenance wins when two rows share the
 * same (post-normalization) fork verdict.
 */
const PROVENANCE_PRIORITY: Record<string, number> = {
  'FIELD-VERIFIED': 3,
  'TRAINING-CONFIRMED': 2,
  'TRAINING-INFERRED': 1,
  'GAP': 0,
}

/**
 * Given branches for a single test action (already verdict-normalized), keep
 * exactly ONE branch per fork verdict. When two rows tie on verdict, prefer
 * the one with higher sourceProvenance; first-seen is the stable tiebreak
 * when provenance is equal.
 *
 * Exported for unit tests.
 */
export function dedupBranchesByVerdict<T extends TopologyBranch & { sourceProvenance: string }>(
  branches: T[],
): T[] {
  const best = new Map<string, T>()
  for (const b of branches) {
    const existing = best.get(b.verdict)
    if (!existing) {
      best.set(b.verdict, b)
      continue
    }
    const existingPriority = PROVENANCE_PRIORITY[existing.sourceProvenance] ?? -1
    const candidatePriority = PROVENANCE_PRIORITY[b.sourceProvenance] ?? -1
    if (candidatePriority > existingPriority) {
      best.set(b.verdict, b)
    }
    // equal priority → first-seen wins (no update)
  }
  return Array.from(best.values())
}

export type TopologyTestAction = {
  slug: string
  description: string
  scenarioRequired: string
  observationMethod: string
  expectedObservation: string | null
  invasiveness: number
  /** True when the cache-hit symptom's test plan implicates this action. */
  implicatedByCurrentSymptom: boolean
  // C1 additive (Wave 0 type-freeze; runtime wired by T1). Optional so the
  // unchanged loader still typechecks; null/absent degrades honestly.
  /** Meter hookup mode; null for non-meter tests. */
  meterMode?: MeterMode | null
  /** Expected reading magnitude; null when not authored. */
  expectedValue?: number | null
  expectedUnit?: string | null
  expectedTolerance?: number | null
  /** Step-shape hint (e.g. 'locate'); null when not authored. */
  stepKind?: string | null
  /** symptom_test_implications.priority for the current symptom; null when not implicated. */
  priority?: number | null
  branches: TopologyBranch[]
}

export type TopologyPin = {
  id: string
  slug: string
  name: string
  roleAbbreviation: string
  pinNumber: string | null
  edge: 'top' | 'right' | 'bottom' | 'left'
  displayOrder: number
  probeLocation: string
  expectedReading: string
  missingLogic: string
  labelGap: string | null
  sourceProvenance: string
}

export type TopologyWireState =
  | 'off'
  | 'steady-12v' | 'steady-5v' | 'steady-gnd'
  | 'signal-rest' | 'signal-low' | 'signal-med' | 'signal-high' | 'signal-pegged'
  | 'pwm-low' | 'pwm-med' | 'pwm-high' | 'pwm-max'

export type TopologyScenario = {
  id: string
  slug: string
  label: string
  sub: string
  kind: 'operation' | 'fault'
  keyPosition: 'off' | 'on' | null
  engineState: 'off' | 'running' | null
  loadLevel: 'idle' | 'light' | 'medium' | 'heavy' | null
  isDefault: boolean
  displayOrder: number
  /** Map of pinId → wire-state class for this scenario. Missing pin → 'off'. */
  pinStates: Record<string, TopologyWireState>
  /** Map of pinId → "right now" reading text for this scenario. Missing key → treat as null. */
  pinReadings: Record<string, string>
  /** Map of pinId → out-of-range flag. Missing key → not-out-of-range → neutral.
   *  Authoritative for verdict. C1 additive (Wave 0 type-freeze; runtime wired by T1). */
  isOutOfRange?: Record<string, boolean>
}

export type TopologyDataStatus = {
  capturedHeader: string
  missingHeader: string
  closingNote: string
}

export type TopologyComponent = {
  id: string
  slug: string
  name: string
  kind: string
  location: string | null
  function: string | null
  electricalContract: string | null
  // NEW prose fields (per spec §7.0):
  subtitle: string | null
  role: string | null
  wireSummary: string | null
  body: string | null
  probingTactic: string | null
  unknownNote: string | null
  // existing children + new:
  sourceProvenance: string
  observableProperties: TopologyObservableProperty[]
  testActions: TopologyTestAction[]
  pins: TopologyPin[]
}

export type TopologyConnection = {
  id: string
  fromComponentId: string
  toComponentId: string
  connectionKind: string
  direction: string
  description: string | null
  sourceProvenance: string
  // NEW (per spec §7.2):
  electricalRole: 'signal' | '5v-ref' | 'low-ref' | 'pwm' | '12v' | 'ground' | null
  fromPinId: string | null
  toPinId: string | null
}

export type SystemTopology = {
  platform: { slug: string; name: string }
  symptom: { slug: string; description: string }
  system: string
  components: TopologyComponent[]
  connections: TopologyConnection[]
  // NEW (per spec §7.3 + §7.6):
  scenarios: TopologyScenario[]
  dataStatus: TopologyDataStatus | null
  /** Last-picked scenario slug for the session, if persisted; null otherwise. */
  lastScenarioSlug: string | null
}

/** Human-readable platform name from the stored columns. */
function buildPlatformName(row: {
  parentMake: string
  parentModelFamily: string
  generation: string | null
  yearRange: string
}): string {
  const parts = [row.parentMake, row.parentModelFamily]
  if (row.generation) parts.push(row.generation)
  parts.push(`(${row.yearRange})`)
  return parts.join(' ')
}

// ---------------------------------------------------------------------------
// loadSystemTopology
// ---------------------------------------------------------------------------

/**
 * Loads the full system-topology graph for a platform + cached symptom:
 * every component tagged for the symptom's system, the connections among
 * them, and each component's probe points + diagnostic payload.
 *
 * Pure structured reads — no AI, no external calls. Returns null (never
 * throws) when the platform or symptom is missing, the symptom has no
 * system, or no components are tagged for that system.
 */
export async function loadSystemTopology({
  db,
  platformSlug,
  symptomSlug,
  sessionId,
}: {
  db: AppDb
  platformSlug: string
  symptomSlug: string
  sessionId?: string  // NEW — for restoring last-picked scenario
}): Promise<SystemTopology | null> {
  // 1. Resolve platform
  const platform = await db.query.platforms.findFirst({
    where: eq(platforms.slug, platformSlug),
    columns: {
      id: true,
      slug: true,
      parentMake: true,
      parentModelFamily: true,
      generation: true,
      yearRange: true,
    },
  })
  if (!platform) return null

  // 2. Resolve symptom + the system its diagram opens
  const symptom = await db.query.symptoms.findFirst({
    where: eq(symptoms.slug, symptomSlug),
    columns: { id: true, slug: true, description: true, system: true },
  })
  if (!symptom || !symptom.system) return null
  const system = symptom.system

  // 3. Components tagged for this system on this platform
  const componentRows = await db
    .select({
      id: components.id,
      slug: components.slug,
      name: components.name,
      kind: components.kind,
      location: components.location,
      function: components.function,
      electricalContract: components.electricalContract,
      // NEW (from migration 0020):
      subtitle: components.subtitle,
      role: components.role,
      wireSummary: components.wireSummary,
      body: components.body,
      probingTactic: components.probingTactic,
      unknownNote: components.unknownNote,
      sourceProvenance: components.sourceProvenance,
    })
    .from(components)
    .where(
      and(
        eq(components.platformId, platform.id),
        eq(components.isRetired, false),
        arrayContains(components.systems, [system]),
      ),
    )
  if (componentRows.length === 0) return null
  const componentIds = componentRows.map((c) => c.id)

  // 4. Connections — only those with BOTH endpoints inside the system set
  const connectionRows = await db
    .select({
      id: componentConnections.id,
      fromComponentId: componentConnections.fromComponentId,
      toComponentId: componentConnections.toComponentId,
      connectionKind: componentConnections.connectionKind,
      direction: componentConnections.direction,
      description: componentConnections.description,
      sourceProvenance: componentConnections.sourceProvenance,
      // NEW (from migration 0020):
      electricalRole: componentConnections.electricalRole,
      fromPinId: componentConnections.fromPinId,
      toPinId: componentConnections.toPinId,
    })
    .from(componentConnections)
    .where(
      and(
        eq(componentConnections.isRetired, false),
        inArray(componentConnections.fromComponentId, componentIds),
        inArray(componentConnections.toComponentId, componentIds),
      ),
    )

  // 5. Observable properties (probe points) for those components
  const opRows = await db
    .select({
      componentId: observableProperties.componentId,
      slug: observableProperties.slug,
      description: observableProperties.description,
      observationMethod: observableProperties.observationMethod,
    })
    .from(observableProperties)
    .where(
      and(
        inArray(observableProperties.componentId, componentIds),
        eq(observableProperties.isRetired, false),
      ),
    )

  // 6. Pins for the in-set components
  const pinRows = await db
    .select({
      id: componentPins.id,
      slug: componentPins.slug,
      componentId: componentPins.componentId,
      name: componentPins.name,
      roleAbbreviation: componentPins.roleAbbreviation,
      pinNumber: componentPins.pinNumber,
      edge: componentPins.edge,
      displayOrder: componentPins.displayOrder,
      probeLocation: componentPins.probeLocation,
      expectedReading: componentPins.expectedReading,
      missingLogic: componentPins.missingLogic,
      labelGap: componentPins.labelGap,
      sourceProvenance: componentPins.sourceProvenance,
    })
    .from(componentPins)
    .where(
      and(
        inArray(componentPins.componentId, componentIds),
        eq(componentPins.isRetired, false),
      ),
    )

  // 7. Test actions for those components + their branch logic
  const testActionRows = await db
    .select({
      id: testActions.id,
      componentId: testActions.componentId,
      slug: testActions.slug,
      description: testActions.description,
      scenarioRequired: testActions.scenarioRequired,
      observationMethod: testActions.observationMethod,
      expectedObservation: testActions.expectedObservation,
      invasiveness: testActions.invasiveness,
      meterMode: testActions.meterMode,
      expectedValue: testActions.expectedValue,
      expectedUnit: testActions.expectedUnit,
      expectedTolerance: testActions.expectedTolerance,
      stepKind: testActions.stepKind,
    })
    .from(testActions)
    .where(
      and(
        inArray(testActions.componentId, componentIds),
        eq(testActions.isRetired, false),
      ),
    )
  const testActionIds = testActionRows.map((t) => t.id)

  const branchRows = testActionIds.length
    ? await db
        .select({
          testActionId: branchLogic.testActionId,
          condition: branchLogic.condition,
          verdict: branchLogic.verdict,
          nextAction: branchLogic.nextAction,
          routesToTestActionId: branchLogic.routesToTestActionId,
          reasoning: branchLogic.reasoning,
          sourceProvenance: branchLogic.sourceProvenance,
        })
        .from(branchLogic)
        .where(
          and(
            inArray(branchLogic.testActionId, testActionIds),
            eq(branchLogic.isRetired, false),
          ),
        )
    : []

  // Which of those test actions does the CURRENT symptom implicate, and at what
  // priority? A Map (testActionId -> priority) carries the rank so the engine
  // can order steps; non-implicated actions get priority: null.
  const implRows = testActionIds.length
    ? await db
        .select({
          testActionId: symptomTestImplications.testActionId,
          priority: symptomTestImplications.priority,
        })
        .from(symptomTestImplications)
        .where(
          and(
            eq(symptomTestImplications.symptomId, symptom.id),
            eq(symptomTestImplications.isRetired, false),
            inArray(symptomTestImplications.testActionId, testActionIds),
          ),
        )
    : []
  const implicatedPriorities = new Map<string, number>(
    implRows.map((r) => [r.testActionId, r.priority]),
  )

  // 8. Scenarios for this (platform, system)
  const scenarioRows = await db
    .select({
      id: systemScenarios.id,
      slug: systemScenarios.slug,
      label: systemScenarios.label,
      sub: systemScenarios.sub,
      kind: systemScenarios.kind,
      keyPosition: systemScenarios.keyPosition,
      engineState: systemScenarios.engineState,
      loadLevel: systemScenarios.loadLevel,
      isDefault: systemScenarios.isDefault,
      displayOrder: systemScenarios.displayOrder,
    })
    .from(systemScenarios)
    .where(
      and(
        eq(systemScenarios.platformId, platform.id),
        eq(systemScenarios.system, system),
        eq(systemScenarios.isRetired, false),
      ),
    )
  const scenarioIds = scenarioRows.map((s) => s.id)

  // Wire-state matrix for those scenarios
  const wireStateRows = scenarioIds.length
    ? await db
        .select({
          scenarioId: scenarioWireStates.scenarioId,
          pinId: scenarioWireStates.pinId,
          wireState: scenarioWireStates.wireState,
        })
        .from(scenarioWireStates)
        .where(inArray(scenarioWireStates.scenarioId, scenarioIds))
    : []

  // Pin readings for those scenarios
  const readingRows = scenarioIds.length
    ? await db
        .select({
          pinId: pinScenarioReadings.pinId,
          scenarioId: pinScenarioReadings.scenarioId,
          reading: pinScenarioReadings.reading,
          isOutOfRange: pinScenarioReadings.isOutOfRange,
        })
        .from(pinScenarioReadings)
        .where(inArray(pinScenarioReadings.scenarioId, scenarioIds))
    : []

  // 9. Assemble scenarios with their pin-state + reading maps
  const assembledScenarios: TopologyScenario[] = scenarioRows
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((s) => {
      const pinStates: Record<string, TopologyWireState> = {}
      for (const ws of wireStateRows) {
        if (ws.scenarioId === s.id) pinStates[ws.pinId] = ws.wireState
      }
      const pinReadings: Record<string, string> = {}
      const isOutOfRange: Record<string, boolean> = {}
      for (const r of readingRows) {
        if (r.scenarioId === s.id) {
          pinReadings[r.pinId] = r.reading
          if (r.isOutOfRange !== null) isOutOfRange[r.pinId] = r.isOutOfRange
        }
      }
      return {
        id: s.id,
        slug: s.slug,
        label: s.label,
        sub: s.sub,
        kind: s.kind,
        keyPosition: s.keyPosition,
        engineState: s.engineState,
        loadLevel: s.loadLevel,
        isDefault: s.isDefault,
        displayOrder: s.displayOrder,
        pinStates,
        pinReadings,
        isOutOfRange,
      }
    })

  // 10. Assemble the graph
  const assembledComponents: TopologyComponent[] = componentRows.map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    kind: c.kind,
    location: c.location,
    function: c.function,
    electricalContract: c.electricalContract,
    subtitle: c.subtitle,
    role: c.role,
    wireSummary: c.wireSummary,
    body: c.body,
    probingTactic: c.probingTactic,
    unknownNote: c.unknownNote,
    sourceProvenance: c.sourceProvenance,
    observableProperties: opRows
      .filter((op) => op.componentId === c.id)
      .map((op) => ({
        slug: op.slug,
        description: op.description,
        observationMethod: op.observationMethod,
      })),
    testActions: testActionRows
      .filter((t) => t.componentId === c.id)
      .map((t) => ({
        slug: t.slug,
        description: t.description,
        scenarioRequired: t.scenarioRequired,
        observationMethod: t.observationMethod,
        expectedObservation: t.expectedObservation,
        invasiveness: t.invasiveness,
        implicatedByCurrentSymptom: implicatedPriorities.has(t.id),
        meterMode: (t.meterMode as MeterMode | null) ?? null,
        expectedValue: t.expectedValue,
        expectedUnit: t.expectedUnit,
        expectedTolerance: t.expectedTolerance,
        stepKind: t.stepKind,
        priority: implicatedPriorities.get(t.id) ?? null,
        branches: dedupBranchesByVerdict(
          branchRows
            .filter((b) => b.testActionId === t.id)
            .map((b) => ({
              condition: b.condition,
              verdict: mapDbVerdictToFork(b.verdict),
              nextAction: b.nextAction,
              routesToTestActionId: b.routesToTestActionId,
              reasoning: b.reasoning,
              sourceProvenance: b.sourceProvenance,
            })),
        ),
      })),
    pins: pinRows
      .filter((p) => p.componentId === c.id)
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((p) => ({
        id: p.id,
        slug: p.slug,
        name: p.name,
        roleAbbreviation: p.roleAbbreviation,
        pinNumber: p.pinNumber,
        edge: p.edge,
        displayOrder: p.displayOrder,
        probeLocation: p.probeLocation,
        expectedReading: p.expectedReading,
        missingLogic: p.missingLogic,
        labelGap: p.labelGap,
        sourceProvenance: p.sourceProvenance,
      })),
  }))

  // Captured/missing framing copy for this (platform, system)
  const statusRow = await db.query.systemDataStatus.findFirst({
    where: and(
      eq(systemDataStatus.platformId, platform.id),
      eq(systemDataStatus.system, system),
    ),
    columns: {
      capturedHeader: true,
      missingHeader: true,
      closingNote: true,
    },
  })
  const dataStatus: TopologyDataStatus | null = statusRow
    ? {
        capturedHeader: statusRow.capturedHeader,
        missingHeader: statusRow.missingHeader,
        closingNote: statusRow.closingNote,
      }
    : null

  // Last-picked scenario for this session, if available
  let lastScenarioSlug: string | null = null
  if (sessionId) {
    const sessionRow = await db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
      columns: { lastScenarioSlug: true },
    })
    lastScenarioSlug = sessionRow?.lastScenarioSlug ?? null
  }

  return {
    platform: { slug: platform.slug, name: buildPlatformName(platform) },
    symptom: { slug: symptom.slug, description: symptom.description },
    system,
    components: assembledComponents,
    connections: connectionRows,
    scenarios: assembledScenarios,
    dataStatus,
    lastScenarioSlug,
  }
}
