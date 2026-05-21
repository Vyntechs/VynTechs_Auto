import { and, arrayContains, eq, inArray } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/queries'
import {
  platforms,
  symptoms,
  components,
  componentConnections,
  observableProperties,
  testActions,
  branchLogic,
  symptomTestImplications,
} from '@/lib/db/schema'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type TopologyObservableProperty = {
  slug: string
  description: string
  observationMethod: string
}

export type TopologyBranch = {
  condition: string
  verdict: string
  nextAction: string
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
  branches: TopologyBranch[]
}

export type TopologyComponent = {
  id: string
  slug: string
  name: string
  kind: string
  location: string | null
  function: string | null
  electricalContract: string | null
  sourceProvenance: string
  observableProperties: TopologyObservableProperty[]
  testActions: TopologyTestAction[]
}

export type TopologyConnection = {
  id: string
  fromComponentId: string
  toComponentId: string
  connectionKind: string
  direction: string
  description: string | null
  sourceProvenance: string
}

export type SystemTopology = {
  platform: { slug: string; name: string }
  symptom: { slug: string; description: string }
  system: string
  components: TopologyComponent[]
  connections: TopologyConnection[]
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
}: {
  db: AppDb
  platformSlug: string
  symptomSlug: string
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

  // 6. Test actions for those components + their branch logic
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
        })
        .from(branchLogic)
        .where(
          and(
            inArray(branchLogic.testActionId, testActionIds),
            eq(branchLogic.isRetired, false),
          ),
        )
    : []

  // Which of those test actions does the CURRENT symptom implicate?
  const implRows = testActionIds.length
    ? await db
        .select({ testActionId: symptomTestImplications.testActionId })
        .from(symptomTestImplications)
        .where(
          and(
            eq(symptomTestImplications.symptomId, symptom.id),
            eq(symptomTestImplications.isRetired, false),
            inArray(symptomTestImplications.testActionId, testActionIds),
          ),
        )
    : []
  const implicatedIds = new Set(implRows.map((r) => r.testActionId))

  // 7. Assemble the graph
  const assembledComponents: TopologyComponent[] = componentRows.map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    kind: c.kind,
    location: c.location,
    function: c.function,
    electricalContract: c.electricalContract,
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
        implicatedByCurrentSymptom: implicatedIds.has(t.id),
        branches: branchRows
          .filter((b) => b.testActionId === t.id)
          .map((b) => ({
            condition: b.condition,
            verdict: b.verdict,
            nextAction: b.nextAction,
          })),
      })),
  }))

  return {
    platform: { slug: platform.slug, name: buildPlatformName(platform) },
    symptom: { slug: symptom.slug, description: symptom.description },
    system,
    components: assembledComponents,
    connections: connectionRows,
  }
}
