import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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
} from '@/lib/db/schema'
import { loadSystemTopology } from '@/lib/diagnostics/load-system-topology'

const PLATFORM_SLUG = 'ford-super-duty-4th-gen-67-psd'

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
  const [cPcm, cFrp, cLiftPump, cRadiator] = await db
    .insert(components)
    .values([
      { slug: 'c-pcm', platformId: platform.id, name: 'PCM', kind: 'module', systems: ['fuel'], sourceProvenance: 'TRAINING-CONFIRMED' },
      { slug: 'c-frp', platformId: platform.id, name: 'FRP Sensor', kind: 'sensor', location: 'Front of DS rail', function: 'Reports rail pressure', electricalContract: '3-wire analog', systems: ['fuel'], sourceProvenance: 'TRAINING-CONFIRMED' },
      { slug: 'c-lift-pump', platformId: platform.id, name: 'Lift Pump', kind: 'pump', systems: ['fuel'], sourceProvenance: 'TRAINING-CONFIRMED' },
      { slug: 'c-radiator', platformId: platform.id, name: 'Radiator', kind: 'mechanical', systems: ['cooling'], sourceProvenance: 'TRAINING-CONFIRMED' },
      { slug: 'c-retired-fuel', platformId: platform.id, name: 'Retired Fuel Part', kind: 'sensor', systems: ['fuel'], isRetired: true, sourceProvenance: 'TRAINING-CONFIRMED' },
    ])
    .returning({ id: components.id, slug: components.slug })

  // Connections: 2 valid fuel-fuel, 1 fuel-cooling (excluded), 1 retired (excluded)
  await db.insert(componentConnections).values([
    { fromComponentId: cPcm.id, toComponentId: cFrp.id, connectionKind: 'electrical-wire', direction: 'bidirectional', description: 'PCM reads FRP signal', sourceProvenance: 'TRAINING-CONFIRMED' },
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
})
