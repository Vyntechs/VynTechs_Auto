import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '@/tests/helpers/db'
import {
  architectureFacts,
  branchLogic,
  componentConnections,
  componentPins,
  components,
  observableProperties,
  pinScenarioReadings,
  platformEquivalents,
  platforms,
  profiles,
  researchRuns,
  scenarioWireStates,
  symptoms,
  symptomTestImplications,
  systemScenarios,
  testActions,
} from '@/lib/db/schema'
import { resolveAdaptiveCoverage } from '@/lib/diagnostics/adaptive/coverage'

const PLATFORM = 'target-platform'
const SOURCE_PLATFORM = 'source-platform'
const SYMPTOM = 'p0087'
const SYSTEM = 'fuel'

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${value.toString().padStart(12, '0')}`
}

let db: TestDb
let close: (() => Promise<void>) | undefined

beforeEach(async () => {
  ;({ db, close } = await createTestDb())
})

afterEach(async () => {
  await close?.()
  close = undefined
})

async function seedPlatform(id: string, slug: string): Promise<void> {
  await db.insert(platforms).values({
    id,
    slug,
    yearRange: '2020-2024',
    parentMake: 'Example',
    parentModelFamily: slug,
  })
}

async function seedSymptom(): Promise<string> {
  const id = uuid(3)
  await db.insert(symptoms).values({
    id,
    slug: SYMPTOM,
    description: 'Fuel pressure low',
    category: 'dtc',
    system: SYSTEM,
  })
  return id
}

async function seedArchitecture(
  platformId: string,
  slug: string,
  provenance: 'FIELD-VERIFIED' | 'TRAINING-CONFIRMED' = 'FIELD-VERIFIED',
): Promise<void> {
  await db.insert(architectureFacts).values({
    slug,
    platformId,
    description: `${SYSTEM} architecture`,
    sourceProvenance: provenance,
  })
}

type GraphIds = {
  componentIds: string[]
  connectionId: string
  observableId: string
  pinIds: string[]
  testActionId: string
  branchId: string
  implicationId: string
  scenarioId: string
  architectureSlug: string
}

async function seedVerifiedGraph(
  platformId: string,
  symptomId: string,
  options: {
    scenarioRequired?: 'none' | 'key-on' | 'cranking'
    includeScenario?: boolean
    scenarioSlug?: string
  } = {},
): Promise<GraphIds> {
  const componentIds = [uuid(101), uuid(102)]
  const pinIds = [uuid(201), uuid(202)]
  const testActionId = uuid(301)
  const branchId = uuid(401)
  const connectionId = uuid(501)
  const observableId = uuid(601)
  const implicationId = uuid(701)
  const scenarioId = uuid(801)
  const architectureSlug = `fuel-architecture-${platformId.slice(-12)}`

  await seedArchitecture(platformId, architectureSlug)
  await db.insert(components).values([
    {
      id: componentIds[0],
      slug: `pressure-sensor-${platformId.slice(-12)}`,
      platformId,
      name: 'Pressure sensor',
      kind: 'sensor',
      systems: [SYSTEM],
      sourceProvenance: 'FIELD-VERIFIED',
    },
    {
      id: componentIds[1],
      slug: `control-module-${platformId.slice(-12)}`,
      platformId,
      name: 'Control module',
      kind: 'module',
      systems: [SYSTEM],
      sourceProvenance: 'FIELD-VERIFIED',
    },
  ])
  await db.insert(componentPins).values([
    {
      id: pinIds[0],
      slug: `signal-pin-${platformId.slice(-12)}`,
      componentId: componentIds[0],
      name: 'Signal',
      roleAbbreviation: 'SIG',
      pinNumber: '1',
      edge: 'right',
      displayOrder: 1,
      probeLocation: 'Back-probe pin 1',
      expectedReading: '5 V key on',
      missingLogic: 'Inspect the signal circuit',
      sourceProvenance: 'FIELD-VERIFIED',
    },
    {
      id: pinIds[1],
      slug: `module-pin-${platformId.slice(-12)}`,
      componentId: componentIds[1],
      name: 'Input',
      roleAbbreviation: 'IN',
      pinNumber: '2',
      edge: 'left',
      displayOrder: 1,
      probeLocation: 'Back-probe pin 2',
      expectedReading: '5 V key on',
      missingLogic: 'Inspect the input circuit',
      sourceProvenance: 'FIELD-VERIFIED',
    },
  ])
  await db.insert(componentConnections).values({
    id: connectionId,
    fromComponentId: componentIds[0],
    toComponentId: componentIds[1],
    connectionKind: 'electrical-wire',
    electricalRole: 'signal',
    fromPinId: pinIds[0],
    toPinId: pinIds[1],
    sourceProvenance: 'FIELD-VERIFIED',
  })
  await db.insert(observableProperties).values({
    id: observableId,
    slug: `signal-voltage-${platformId.slice(-12)}`,
    componentId: componentIds[0],
    description: 'Signal voltage',
    observationMethod: 'electrical_measurement_at_pin',
    sourceProvenance: 'FIELD-VERIFIED',
  })
  await db.insert(testActions).values({
    id: testActionId,
    slug: `measure-signal-${platformId.slice(-12)}`,
    componentId: componentIds[0],
    description: 'Measure signal voltage',
    scenarioRequired: options.scenarioRequired ?? 'none',
    observationMethod: 'electrical_measurement_at_pin',
    meterMode: 'volts',
    expectedValue: 5,
    expectedUnit: 'V',
    expectedTolerance: 0.2,
    invasiveness: 1,
    sourceProvenance: 'FIELD-VERIFIED',
  })
  await db.insert(branchLogic).values({
    id: branchId,
    slug: `signal-low-${platformId.slice(-12)}`,
    testActionId,
    condition: 'Below 4.8 V',
    verdict: 'fail',
    nextAction: 'Inspect the signal circuit',
    sourceProvenance: 'FIELD-VERIFIED',
  })
  await db.insert(symptomTestImplications).values({
    id: implicationId,
    symptomId,
    testActionId,
    priority: 1,
    sourceProvenance: 'FIELD-VERIFIED',
  })
  if (options.includeScenario) {
    await db.insert(systemScenarios).values({
      id: scenarioId,
      slug: options.scenarioSlug ?? `key-on-${platformId.slice(-12)}`,
      platformId,
      system: SYSTEM,
      label: 'Key on',
      sub: 'Engine off',
      kind: 'operation',
      keyPosition: 'on',
      engineState: 'off',
      isDefault: true,
    })
    await db.insert(scenarioWireStates).values([
      { scenarioId, pinId: pinIds[0], wireState: 'steady-5v' },
      { scenarioId, pinId: pinIds[1], wireState: 'steady-5v' },
    ])
    await db.insert(pinScenarioReadings).values([
      { scenarioId, pinId: pinIds[0], reading: '5 V', isOutOfRange: false },
      { scenarioId, pinId: pinIds[1], reading: '5 V', isOutOfRange: false },
    ])
  }

  return {
    componentIds,
    connectionId,
    observableId,
    pinIds,
    testActionId,
    branchId,
    implicationId,
    scenarioId,
    architectureSlug,
  }
}

async function seedDraft(platformSlug = PLATFORM, symptomSlug = SYMPTOM): Promise<void> {
  const [profile] = await db
    .insert(profiles)
    .values({ userId: uuid(990) })
    .returning({ id: profiles.id })
  await db.insert(researchRuns).values({
    platformSlug,
    symptomSlug,
    status: 'completed',
    initiatedBy: profile.id,
    completedAt: new Date(),
    systemDataDraft: {
      platformSlug,
      status: 'draft',
      components: [],
      connections: [],
    },
  })
}

async function resolve() {
  return resolveAdaptiveCoverage(db, { platformSlug: PLATFORM, symptomSlug: SYMPTOM })
}

describe('resolveAdaptiveCoverage', () => {
  it('returns exact instructional coverage only for a proof-closed direct graph', async () => {
    const platformId = uuid(2)
    await seedPlatform(platformId, PLATFORM)
    const symptomId = await seedSymptom()
    const ids = await seedVerifiedGraph(platformId, symptomId)

    const coverage = await resolve()

    expect(coverage.state).toBe('exact')
    expect(coverage.technicianInstructionsAvailable).toBe(true)
    expect(coverage.instructionProof).toEqual({
      componentIds: ids.componentIds,
      testActionIds: [ids.testActionId],
      branchLogicIds: [ids.branchId],
      verifiedAxes: [`exact:${ids.architectureSlug}`],
    })
  })

  it('uses direct exact content before a research draft', async () => {
    const platformId = uuid(2)
    await seedPlatform(platformId, PLATFORM)
    const symptomId = await seedSymptom()
    await seedVerifiedGraph(platformId, symptomId)
    await seedDraft()

    expect((await resolve()).state).toBe('exact')
  })

  it('refuses complete provenance-free scenarios as instructional proof', async () => {
    const platformId = uuid(2)
    await seedPlatform(platformId, PLATFORM)
    const symptomId = await seedSymptom()
    await seedVerifiedGraph(platformId, symptomId, {
      scenarioRequired: 'key-on',
      includeScenario: true,
    })

    const coverage = await resolve()

    expect(coverage.state).toBe('exact')
    expect(coverage.technicianInstructionsAvailable).toBe(false)
    expect(coverage.instructionProof).toBeNull()
    expect(coverage.reasons.join(' ')).toMatch(/scenario.*provenance/i)
  })

  it('never treats a matching scenario slug as publication proof', async () => {
    const platformId = uuid(2)
    await seedPlatform(platformId, PLATFORM)
    const symptomId = await seedSymptom()
    await seedVerifiedGraph(platformId, symptomId, {
      scenarioRequired: 'cranking',
      includeScenario: true,
      scenarioSlug: 'cranking-field-verified-looking-name',
    })

    const coverage = await resolve()

    expect(coverage.state).toBe('exact')
    expect(coverage.technicianInstructionsAvailable).toBe(false)
    expect(coverage.instructionProof).toBeNull()
  })

  it('keeps FULLY + FIELD-VERIFIED equivalence manual without structured relevant-axis proof', async () => {
    const sourceId = uuid(1)
    const targetId = uuid(2)
    await seedPlatform(sourceId, SOURCE_PLATFORM)
    await seedPlatform(targetId, PLATFORM)
    const symptomId = await seedSymptom()
    await seedVerifiedGraph(sourceId, symptomId)
    await seedArchitecture(targetId, 'unrelated-transmission-architecture')
    await db.insert(platformEquivalents).values({
      platformAId: sourceId,
      platformBId: targetId,
      system: SYSTEM,
      verdict: 'FULLY',
      verdictReasoning: 'Fuel architecture and control strategy were field verified.',
      sourceProvenance: 'FIELD-VERIFIED',
    })

    const coverage = await resolve()

    expect(coverage.state).toBe('partial')
    expect(coverage.technicianInstructionsAvailable).toBe(false)
    expect(coverage.instructionProof).toBeNull()
  })

  it.each([
    ['PARTIALLY', 'FIELD-VERIFIED'],
    ['FULLY', 'TRAINING-INFERRED'],
    ['FULLY', 'GAP'],
    ['FULLY', 'TRAINING-CONFIRMED'],
  ] as const)('keeps %s / %s equivalence manual and non-instructive', async (verdict, provenance) => {
    const sourceId = uuid(1)
    const targetId = uuid(2)
    await seedPlatform(sourceId, SOURCE_PLATFORM)
    await seedPlatform(targetId, PLATFORM)
    const symptomId = await seedSymptom()
    await seedVerifiedGraph(sourceId, symptomId)
    await seedArchitecture(targetId, 'target-fuel-architecture')
    await db.insert(platformEquivalents).values({
      platformAId: sourceId,
      platformBId: targetId,
      system: SYSTEM,
      verdict,
      verdictReasoning: 'Candidate applicability is not instruction-grade.',
      sourceProvenance: provenance,
    })

    const coverage = await resolve()

    expect(coverage.state).toBe('partial')
    expect(coverage.technicianInstructionsAvailable).toBe(false)
    expect(coverage.instructionProof).toBeNull()
  })

  it('never routes source tests through a NOT equivalence', async () => {
    const sourceId = uuid(1)
    const targetId = uuid(2)
    await seedPlatform(sourceId, SOURCE_PLATFORM)
    await seedPlatform(targetId, PLATFORM)
    const symptomId = await seedSymptom()
    await seedVerifiedGraph(sourceId, symptomId)
    await db.insert(platformEquivalents).values({
      platformAId: sourceId,
      platformBId: targetId,
      system: SYSTEM,
      verdict: 'NOT',
      verdictReasoning: 'The control strategy differs.',
      sourceProvenance: 'FIELD-VERIFIED',
    })

    const coverage = await resolve()

    expect(coverage.state).toBe('unsupported')
    expect(coverage.sourcePlatformSlug).toBeUndefined()
    expect(coverage.instructionProof).toBeNull()
  })

  it('keeps a direct graph exact but manual when any surfaced proof is incomplete', async () => {
    const platformId = uuid(2)
    await seedPlatform(platformId, PLATFORM)
    const symptomId = await seedSymptom()
    const ids = await seedVerifiedGraph(platformId, symptomId)

    const assertions: Array<{ mutate: () => Promise<void>; restore: () => Promise<void> }> = [
      {
        mutate: async () => { await db.update(components).set({ sourceProvenance: 'TRAINING-INFERRED' }).where(eq(components.id, ids.componentIds[0])) },
        restore: async () => { await db.update(components).set({ sourceProvenance: 'FIELD-VERIFIED' }).where(eq(components.id, ids.componentIds[0])) },
      },
      {
        mutate: async () => { await db.update(componentConnections).set({ sourceProvenance: 'GAP' }).where(eq(componentConnections.id, ids.connectionId)) },
        restore: async () => { await db.update(componentConnections).set({ sourceProvenance: 'FIELD-VERIFIED' }).where(eq(componentConnections.id, ids.connectionId)) },
      },
      {
        mutate: async () => { await db.update(observableProperties).set({ sourceProvenance: 'TRAINING-CONFIRMED' }).where(eq(observableProperties.id, ids.observableId)) },
        restore: async () => { await db.update(observableProperties).set({ sourceProvenance: 'FIELD-VERIFIED' }).where(eq(observableProperties.id, ids.observableId)) },
      },
      {
        mutate: async () => { await db.update(componentPins).set({ sourceProvenance: 'GAP' }).where(eq(componentPins.id, ids.pinIds[0])) },
        restore: async () => { await db.update(componentPins).set({ sourceProvenance: 'FIELD-VERIFIED' }).where(eq(componentPins.id, ids.pinIds[0])) },
      },
      {
        mutate: async () => { await db.update(testActions).set({ sourceProvenance: 'TRAINING-CONFIRMED' }).where(eq(testActions.id, ids.testActionId)) },
        restore: async () => { await db.update(testActions).set({ sourceProvenance: 'FIELD-VERIFIED' }).where(eq(testActions.id, ids.testActionId)) },
      },
      {
        mutate: async () => { await db.update(branchLogic).set({ sourceProvenance: 'TRAINING-INFERRED' }).where(eq(branchLogic.id, ids.branchId)) },
        restore: async () => { await db.update(branchLogic).set({ sourceProvenance: 'FIELD-VERIFIED' }).where(eq(branchLogic.id, ids.branchId)) },
      },
      {
        mutate: async () => { await db.update(symptomTestImplications).set({ sourceProvenance: 'GAP' }).where(eq(symptomTestImplications.id, ids.implicationId)) },
        restore: async () => { await db.update(symptomTestImplications).set({ sourceProvenance: 'FIELD-VERIFIED' }).where(eq(symptomTestImplications.id, ids.implicationId)) },
      },
      {
        mutate: async () => { await db.update(architectureFacts).set({ fieldVerifyRequired: true }).where(eq(architectureFacts.slug, ids.architectureSlug)) },
        restore: async () => { await db.update(architectureFacts).set({ fieldVerifyRequired: false }).where(eq(architectureFacts.slug, ids.architectureSlug)) },
      },
      {
        mutate: async () => { await db.update(testActions).set({ expectedUnit: null }).where(eq(testActions.id, ids.testActionId)) },
        restore: async () => { await db.update(testActions).set({ expectedUnit: 'V' }).where(eq(testActions.id, ids.testActionId)) },
      },
    ]

    for (const assertion of assertions) {
      expect((await resolve()).technicianInstructionsAvailable).toBe(true)
      await assertion.mutate()
      try {
        const coverage = await resolve()
        expect(coverage.state).toBe('exact')
        expect(coverage.technicianInstructionsAvailable).toBe(false)
        expect(coverage.instructionProof).toBeNull()
      } finally {
        await assertion.restore()
      }
    }

    expect((await resolve()).technicianInstructionsAvailable).toBe(true)
  })

  it('returns draft for the latest exact-slug research draft without serving instructions', async () => {
    await seedPlatform(uuid(2), PLATFORM)
    await seedSymptom()
    await seedDraft()

    const coverage = await resolve()

    expect(coverage.state).toBe('draft')
    expect(coverage.system).toBe(SYSTEM)
    expect(coverage.technicianInstructionsAvailable).toBe(false)
    expect(coverage.instructionProof).toBeNull()
  })

  it('returns unsupported when application or concern scope is unresolved', async () => {
    const coverage = await resolveAdaptiveCoverage(db, {
      platformSlug: null,
      symptomSlug: null,
    })

    expect(coverage).toMatchObject({
      state: 'unsupported',
      system: 'unresolved',
      symptomSlug: 'unresolved',
      technicianInstructionsAvailable: false,
      instructionProof: null,
    })
  })

  it('returns unsupported when no direct, equivalent, or draft coverage exists', async () => {
    await seedPlatform(uuid(2), PLATFORM)
    await seedSymptom()

    expect(await resolve()).toMatchObject({
      state: 'unsupported',
      system: SYSTEM,
      technicianInstructionsAvailable: false,
      instructionProof: null,
    })
  })
})
