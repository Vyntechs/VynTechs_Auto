import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
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
  shops,
  profiles,
  sessions,
} from '@/lib/db/schema'
import { loadSystemTopology } from '@/lib/diagnostics/load-system-topology'

const PLATFORM_SLUG = 'ford-super-duty-4th-gen-67-psd'

// IDs captured during fixture setup for reuse in individual tests
let testPlatformId: string
let testPin1Id: string
let testPin2Id: string
let testSessionId: string

async function seedFixtures(db: TestDb) {
  const [platform] = await db
    .insert(platforms)
    .values({
      slug: PLATFORM_SLUG,
      yearRange: '2017-2022',
      parentMake: 'Ford',
      parentModelFamily: 'Super Duty',
      generation: '4th gen',
    })
    .returning({ id: platforms.id })
  testPlatformId = platform.id

  // Symptoms: a fuel symptom, a null-system symptom, an empty-system symptom
  const [sympFuel] = await db
    .insert(symptoms)
    .values([
      { slug: 'p0087', description: 'Fuel rail pressure too low', category: 'dtc', system: 'fuel' },
      { slug: 'p-no-system', description: 'Symptom with no system set', category: 'dtc', system: null },
      { slug: 'p-aftertreatment', description: 'A system with no tagged parts', category: 'dtc', system: 'aftertreatment' },
    ])
    .returning({ id: symptoms.id, slug: symptoms.slug })

  // Components: 3 fuel, 1 cooling (must be excluded), 1 retired fuel (excluded)
  // c-frp gets prose fields set so Step 3 can verify them
  const [cPcm, cFrp, cLiftPump, cRadiator] = await db
    .insert(components)
    .values([
      { slug: 'c-pcm', platformId: platform.id, name: 'PCM', kind: 'module', systems: ['fuel', 'electrical'], sourceProvenance: 'TRAINING-CONFIRMED' },
      {
        slug: 'c-frp',
        platformId: platform.id,
        name: 'FRP Sensor',
        kind: 'sensor',
        location: 'Front of DS rail',
        function: 'Reports rail pressure',
        electricalContract: '3-wire analog',
        systems: ['fuel'],
        sourceProvenance: 'TRAINING-CONFIRMED',
        subtitle: 'Test subtitle',
        role: 'Test role',
        body: 'Test body text',
      },
      { slug: 'c-lift-pump', platformId: platform.id, name: 'Lift Pump', kind: 'pump', systems: ['fuel'], sourceProvenance: 'TRAINING-CONFIRMED' },
      { slug: 'c-radiator', platformId: platform.id, name: 'Radiator', kind: 'mechanical', systems: ['cooling'], sourceProvenance: 'TRAINING-CONFIRMED' },
      { slug: 'c-retired-fuel', platformId: platform.id, name: 'Retired Fuel Part', kind: 'sensor', systems: ['fuel'], isRetired: true, sourceProvenance: 'TRAINING-CONFIRMED' },
    ])
    .returning({ id: components.id, slug: components.slug })

  // Connections: 2 valid fuel-fuel, 1 fuel-cooling (excluded), 1 retired (excluded)
  // The PCM→FRP connection is given an electricalRole + fromPinId set after pins are inserted
  await db.insert(componentConnections).values([
    { fromComponentId: cPcm.id, toComponentId: cFrp.id, connectionKind: 'electrical-wire', direction: 'bidirectional', description: 'PCM reads FRP signal', sourceProvenance: 'TRAINING-CONFIRMED', electricalRole: 'signal' },
    { fromComponentId: cPcm.id, toComponentId: cLiftPump.id, connectionKind: 'electrical-wire', direction: 'unidirectional', description: 'PCM commands lift pump', sourceProvenance: 'TRAINING-CONFIRMED' },
    { fromComponentId: cPcm.id, toComponentId: cRadiator.id, connectionKind: 'electrical-wire', direction: 'unidirectional', description: 'Crosses into cooling — must be excluded', sourceProvenance: 'TRAINING-CONFIRMED' },
    { fromComponentId: cPcm.id, toComponentId: cLiftPump.id, connectionKind: 'electrical-wire', direction: 'unidirectional', description: 'Retired connection', isRetired: true, sourceProvenance: 'TRAINING-CONFIRMED' },
  ])

  // Observable properties on c-frp: 2 active, 1 retired
  await db.insert(observableProperties).values([
    { slug: 'op-frp-signal', componentId: cFrp.id, description: 'Back-probe the signal pin', observationMethod: 'electrical_measurement_at_pin', sourceProvenance: 'TRAINING-CONFIRMED' },
    { slug: 'op-frp-5v', componentId: cFrp.id, description: 'Back-probe the 5V reference pin', observationMethod: 'electrical_measurement_at_pin', sourceProvenance: 'TRAINING-CONFIRMED' },
    { slug: 'op-frp-retired', componentId: cFrp.id, description: 'Retired probe point', observationMethod: 'electrical_measurement_at_pin', isRetired: true, sourceProvenance: 'TRAINING-CONFIRMED' },
  ])

  // Test actions on c-frp: 1 implicated by p0087, 1 not, 1 retired
  const [taImplicated] = await db
    .insert(testActions)
    .values([
      { slug: 'ta-frp-keyon', componentId: cFrp.id, description: 'Check FRP at key-on', scenarioRequired: 'key-on', observationMethod: 'scan_tool_pid', expectedObservation: '26,000-28,000 PSI', invasiveness: 1, confidenceBoost: 30, sourceProvenance: 'TRAINING-CONFIRMED' },
      { slug: 'ta-frp-idle', componentId: cFrp.id, description: 'Check FRP at idle', scenarioRequired: 'idle', observationMethod: 'scan_tool_pid', expectedObservation: 'Idle rail pressure', invasiveness: 1, confidenceBoost: 20, sourceProvenance: 'TRAINING-CONFIRMED' },
      { slug: 'ta-frp-retired', componentId: cFrp.id, description: 'Retired test action', scenarioRequired: 'key-on', observationMethod: 'scan_tool_pid', invasiveness: 1, confidenceBoost: 10, isRetired: true, sourceProvenance: 'TRAINING-CONFIRMED' },
    ])
    .returning({ id: testActions.id })

  // Branch logic on the implicated test action
  await db.insert(branchLogic).values([
    { slug: 'bl-frp-low', testActionId: taImplicated.id, condition: 'Reading below range', verdict: 'fail', nextAction: 'Suspect supply pressure', sourceProvenance: 'TRAINING-CONFIRMED' },
  ])

  // p0087 implicates only ta-frp-keyon
  await db.insert(symptomTestImplications).values([
    { symptomId: sympFuel.id, testActionId: taImplicated.id, priority: 1, sourceProvenance: 'TRAINING-CONFIRMED' },
  ])

  // Pins on c-frp: 2 pins with distinct edges and displayOrder values
  const [pin1, pin2] = await db
    .insert(componentPins)
    .values([
      {
        slug: 'pin-frp-signal',
        componentId: cFrp.id,
        name: 'Signal',
        roleAbbreviation: 'SIG',
        edge: 'top',
        displayOrder: 1,
        probeLocation: 'Pin A back-probe',
        expectedReading: '0.5–4.5 V',
        missingLogic: 'Suspect open signal wire',
        sourceProvenance: 'TRAINING-CONFIRMED',
      },
      {
        slug: 'pin-frp-5vref',
        componentId: cFrp.id,
        name: '5V Reference',
        roleAbbreviation: '5V',
        edge: 'bottom',
        displayOrder: 2,
        probeLocation: 'Pin B back-probe',
        expectedReading: '4.8–5.2 V',
        missingLogic: 'Suspect open 5V reference from PCM',
        sourceProvenance: 'TRAINING-CONFIRMED',
      },
    ])
    .returning({ id: componentPins.id })
  testPin1Id = pin1.id
  testPin2Id = pin2.id

  // Update the PCM→FRP connection to carry fromPinId = pin1
  await db
    .update(componentConnections)
    .set({ fromPinId: pin1.id })
    .where(eq(componentConnections.description, 'PCM reads FRP signal'))

  // Scenarios: 1 operation (default), 1 fault — both for fuel system on this platform
  const [scOp, scFault] = await db
    .insert(systemScenarios)
    .values([
      {
        slug: 'key-on-engine-off',
        platformId: platform.id,
        system: 'fuel',
        label: 'Key On / Engine Off',
        sub: 'KOEO',
        kind: 'operation',
        keyPosition: 'on',
        engineState: 'off',
        isDefault: true,
        displayOrder: 1,
      },
      {
        slug: 'hard-start-fault',
        platformId: platform.id,
        system: 'fuel',
        label: 'Hard Start Fault',
        sub: 'Hard start',
        kind: 'fault',
        isDefault: false,
        displayOrder: 2,
      },
    ])
    .returning({ id: systemScenarios.id })

  // Wire-state rows: one per pin × per scenario (4 rows)
  await db.insert(scenarioWireStates).values([
    { scenarioId: scOp.id, pinId: pin1.id, wireState: 'signal-rest' },
    { scenarioId: scOp.id, pinId: pin2.id, wireState: 'steady-5v' },
    { scenarioId: scFault.id, pinId: pin1.id, wireState: 'signal-low' },
    { scenarioId: scFault.id, pinId: pin2.id, wireState: 'steady-5v' },
  ])

  // Pin-reading rows: one per pin × per scenario (4 rows)
  await db.insert(pinScenarioReadings).values([
    { pinId: pin1.id, scenarioId: scOp.id, reading: '0.5 V' },
    { pinId: pin2.id, scenarioId: scOp.id, reading: '5.0 V' },
    { pinId: pin1.id, scenarioId: scFault.id, reading: '0.2 V (low)' },
    { pinId: pin2.id, scenarioId: scFault.id, reading: '5.0 V' },
  ])

  // System data status row
  await db.insert(systemDataStatus).values({
    platformId: platform.id,
    system: 'fuel',
    capturedHeader: 'Fuel system data captured for KOEO and hard-start',
    missingHeader: 'Heavy-load scenario not yet captured',
    closingNote: 'All key-on readings from a known-good 2019 F-350',
  })

  // Session row for lastScenarioSlug round-trip
  const [shop] = await db
    .insert(shops)
    .values({ name: 'Test Shop' })
    .returning({ id: shops.id })
  const [profile] = await db
    .insert(profiles)
    .values({ userId: crypto.randomUUID(), shopId: shop.id, role: 'tech' })
    .returning({ id: profiles.id })
  const [session] = await db
    .insert(sessions)
    .values({
      shopId: shop.id,
      techId: profile.id,
      intake: {
        vehicleYear: 2019,
        vehicleMake: 'Ford',
        vehicleModel: 'F-350',
        customerComplaint: 'hard start',
      },
      treeState: {
        nodes: [{ id: 'start', label: 'Start', status: 'active' }],
        currentNodeId: 'start',
        message: '',
      },
      lastScenarioSlug: 'key-on-engine-off',
    })
    .returning({ id: sessions.id })
  testSessionId = session.id
}

describe('loadSystemTopology', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    await seedFixtures(db)
  })

  afterEach(async () => {
    await close()
  })

  it('returns the full fuel-system graph for a known platform + fuel symptom', async () => {
    const result = await loadSystemTopology({ db, platformSlug: PLATFORM_SLUG, symptomSlug: 'p0087' })

    expect(result).not.toBeNull()
    expect(result!.system).toBe('fuel')
    expect(result!.platform.slug).toBe(PLATFORM_SLUG)
    expect(result!.platform.name.length).toBeGreaterThan(0)
    expect(result!.symptom.slug).toBe('p0087')

    // 3 fuel components — radiator (cooling) and the retired fuel part excluded
    const slugs = result!.components.map((c) => c.slug).sort()
    expect(slugs).toEqual(['c-frp', 'c-lift-pump', 'c-pcm'])
  })

  it('includes only connections with both endpoints inside the system', async () => {
    const result = await loadSystemTopology({ db, platformSlug: PLATFORM_SLUG, symptomSlug: 'p0087' })
    // 2 valid fuel-fuel connections; the fuel-cooling and retired ones excluded
    expect(result!.connections).toHaveLength(2)

    const pcm = result!.components.find((c) => c.slug === 'c-pcm')!
    const frp = result!.components.find((c) => c.slug === 'c-frp')!
    const liftPump = result!.components.find((c) => c.slug === 'c-lift-pump')!

    const frpConn = result!.connections.find((cn) => cn.toComponentId === frp.id)!
    expect(frpConn.fromComponentId).toBe(pcm.id)
    expect(frpConn.connectionKind).toBe('electrical-wire')
    expect(frpConn.direction).toBe('bidirectional')
    expect(frpConn.description).toBe('PCM reads FRP signal')

    const liftPumpConn = result!.connections.find((cn) => cn.toComponentId === liftPump.id)!
    expect(liftPumpConn.fromComponentId).toBe(pcm.id)
    expect(liftPumpConn.connectionKind).toBe('electrical-wire')
    expect(liftPumpConn.direction).toBe('unidirectional')
    expect(liftPumpConn.description).toBe('PCM commands lift pump')
  })

  it('includes a component whose systems array contains the target system among others', async () => {
    // The PCM fixture is tagged ['fuel', 'electrical'] — arrayContains must match
    // on the presence of 'fuel', not exact array equality.
    const result = await loadSystemTopology({ db, platformSlug: PLATFORM_SLUG, symptomSlug: 'p0087' })
    expect(result).not.toBeNull()
    const slugs = result!.components.map((c) => c.slug)
    expect(slugs).toContain('c-pcm')
  })

  it('attaches active observable properties to a component', async () => {
    const result = await loadSystemTopology({ db, platformSlug: PLATFORM_SLUG, symptomSlug: 'p0087' })
    const frp = result!.components.find((c) => c.slug === 'c-frp')!
    expect(frp.observableProperties.map((o) => o.slug).sort()).toEqual(['op-frp-5v', 'op-frp-signal'])
  })

  it('flags test actions implicated by the current symptom and attaches branches', async () => {
    const result = await loadSystemTopology({ db, platformSlug: PLATFORM_SLUG, symptomSlug: 'p0087' })
    const frp = result!.components.find((c) => c.slug === 'c-frp')!
    // 2 active test actions (retired one excluded)
    expect(frp.testActions).toHaveLength(2)
    const implicated = frp.testActions.find((t) => t.slug === 'ta-frp-keyon')!
    const other = frp.testActions.find((t) => t.slug === 'ta-frp-idle')!
    expect(implicated.implicatedByCurrentSymptom).toBe(true)
    expect(other.implicatedByCurrentSymptom).toBe(false)
    expect(implicated.branches).toHaveLength(1)
    expect(implicated.branches[0].verdict).toBe('fail')
  })

  it('returns null for an unknown platform', async () => {
    const result = await loadSystemTopology({ db, platformSlug: 'nope', symptomSlug: 'p0087' })
    expect(result).toBeNull()
  })

  it('returns null for an unknown symptom', async () => {
    const result = await loadSystemTopology({ db, platformSlug: PLATFORM_SLUG, symptomSlug: 'nope' })
    expect(result).toBeNull()
  })

  it('returns null when the symptom has no system set', async () => {
    const result = await loadSystemTopology({ db, platformSlug: PLATFORM_SLUG, symptomSlug: 'p-no-system' })
    expect(result).toBeNull()
  })

  it('returns null when no components are tagged for the symptom system', async () => {
    const result = await loadSystemTopology({ db, platformSlug: PLATFORM_SLUG, symptomSlug: 'p-aftertreatment' })
    expect(result).toBeNull()
  })

  // -------------------------------------------------------------------------
  // New coverage: prose columns, pins, connections, scenarios, dataStatus,
  // lastScenarioSlug (Tasks 6–9 retroactive TDD)
  // -------------------------------------------------------------------------

  it('loadSystemTopology includes new component prose columns', async () => {
    const result = await loadSystemTopology({ db, platformSlug: PLATFORM_SLUG, symptomSlug: 'p0087' })
    const frp = result!.components.find((c) => c.slug === 'c-frp')!
    expect(frp.subtitle).toBe('Test subtitle')
    expect(frp.role).toBe('Test role')
    expect(frp.body).toContain('Test body')
  })

  it('loadSystemTopology loads pins per component, sorted by displayOrder', async () => {
    const result = await loadSystemTopology({ db, platformSlug: PLATFORM_SLUG, symptomSlug: 'p0087' })
    const frp = result!.components.find((c) => c.slug === 'c-frp')!
    expect(frp.pins).toHaveLength(2)
    expect(frp.pins[0].displayOrder).toBeLessThan(frp.pins[1].displayOrder)
    expect(frp.pins[0].roleAbbreviation).toBe('SIG')
    expect(frp.pins[0].probeLocation).toBe('Pin A back-probe')
    // Confirm edge enum values round-trip correctly
    expect(frp.pins[0].edge).toBe('top')
    expect(frp.pins[1].edge).toBe('bottom')
  })

  it('loadSystemTopology includes electricalRole + pin endpoints on connections', async () => {
    const result = await loadSystemTopology({ db, platformSlug: PLATFORM_SLUG, symptomSlug: 'p0087' })
    const frp = result!.components.find((c) => c.slug === 'c-frp')!
    const conn = result!.connections.find((c) => c.toComponentId === frp.id)!
    expect(conn.electricalRole).toBe('signal')
    expect(conn.fromPinId).toBe(testPin1Id)
    expect(conn.toPinId).toBeNull()
  })

  it('loadSystemTopology assembles scenarios with pin-state + reading maps', async () => {
    const result = await loadSystemTopology({ db, platformSlug: PLATFORM_SLUG, symptomSlug: 'p0087' })
    expect(result!.scenarios).toHaveLength(2)

    const opScenario = result!.scenarios.find((s) => s.kind === 'operation')!
    expect(opScenario.slug).toBe('key-on-engine-off')
    expect(opScenario.isDefault).toBe(true)
    expect(Object.keys(opScenario.pinStates).length).toBe(2)
    expect(opScenario.pinStates[testPin1Id]).toBe('signal-rest')
    expect(opScenario.pinStates[testPin2Id]).toBe('steady-5v')
    expect(opScenario.pinReadings[testPin1Id]).toBe('0.5 V')
    expect(opScenario.pinReadings[testPin2Id]).toBe('5.0 V')

    const faultScenario = result!.scenarios.find((s) => s.kind === 'fault')!
    expect(faultScenario.slug).toBe('hard-start-fault')
    expect(faultScenario.pinStates[testPin1Id]).toBe('signal-low')
  })

  it('loadSystemTopology returns dataStatus when row is present', async () => {
    const result = await loadSystemTopology({ db, platformSlug: PLATFORM_SLUG, symptomSlug: 'p0087' })
    expect(result!.dataStatus).not.toBeNull()
    expect(result!.dataStatus!.capturedHeader).toBe('Fuel system data captured for KOEO and hard-start')
    expect(result!.dataStatus!.closingNote).toBe('All key-on readings from a known-good 2019 F-350')
    expect(result!.dataStatus!.missingHeader).toBeTruthy()
  })

  it('loadSystemTopology returns dataStatus = null when no row exists', async () => {
    // Remove the status row before querying
    await db
      .delete(systemDataStatus)
      .where(eq(systemDataStatus.platformId, testPlatformId))
    const result = await loadSystemTopology({ db, platformSlug: PLATFORM_SLUG, symptomSlug: 'p0087' })
    expect(result!.dataStatus).toBeNull()
  })

  it('loadSystemTopology returns lastScenarioSlug when sessionId is given', async () => {
    const result = await loadSystemTopology({
      db,
      platformSlug: PLATFORM_SLUG,
      symptomSlug: 'p0087',
      sessionId: testSessionId,
    })
    expect(result!.lastScenarioSlug).toBe('key-on-engine-off')
  })

  it('loadSystemTopology returns lastScenarioSlug = null when no sessionId given', async () => {
    const result = await loadSystemTopology({ db, platformSlug: PLATFORM_SLUG, symptomSlug: 'p0087' })
    expect(result!.lastScenarioSlug).toBeNull()
  })
})
