import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq, and } from 'drizzle-orm'
import { createTestDb, type TestDb } from '@/tests/helpers/db'
import {
  platforms,
  symptoms,
  components,
  componentConnections,
  observableProperties,
  testActions,
  testActions as testActionsT,
  branchLogic,
  symptomTestImplications,
  componentPins,
  systemScenarios,
  pinScenarioReadings,
  pinScenarioReadings as pinScenarioReadingsT,
} from '@/lib/db/schema'
import { loadSystemTopology } from '@/lib/diagnostics/load-system-topology'
import {
  promoteSystemDataDraft,
  type SystemDataDraft,
} from '@/lib/diagnostics/promote-system-data'

let db: TestDb
let close: (() => Promise<void>) | undefined

beforeEach(async () => {
  const t = await createTestDb()
  db = t.db
  close = t.close
})

afterEach(async () => {
  await close?.()
  close = undefined
})

const PLATFORM_SLUG = 'ford-super-duty-4th-gen-67-psd'

/** Seed the platform the draft targets (PR2 never creates platforms). */
async function seedPlatform(slug: string = PLATFORM_SLUG): Promise<string> {
  const [row] = await db
    .insert(platforms)
    .values({
      slug,
      yearRange: '2017-2022',
      parentMake: 'Ford',
      parentModelFamily: 'Super Duty',
      generation: '4th Gen',
    })
    .returning({ id: platforms.id })
  return row.id
}

/**
 * A small slice of the 6.7 fuel system, authored in slug-space the way a
 * curator/AI draft would be (no UUIDs): pump -> rail fluid line, with a
 * pressure reading on the rail.
 */
function fuelDraft(overrides: Partial<SystemDataDraft> = {}): SystemDataDraft {
  return {
    platformSlug: PLATFORM_SLUG,
    status: 'approved',
    approvedBy: 'curator-1',
    components: [
      {
        slug: 'low-pressure-fuel-pump',
        name: 'Low-Pressure (Lift) Pump',
        kind: 'pump',
        systems: ['fuel'],
        sourceProvenance: 'TRAINING-CONFIRMED',
        observableProperties: [],
      },
      {
        slug: 'fuel-rail',
        name: 'Fuel Rail',
        kind: 'mechanical',
        systems: ['fuel'],
        sourceProvenance: 'TRAINING-CONFIRMED',
        observableProperties: [
          {
            slug: 'fuel-rail-pressure',
            description: 'Fuel rail pressure (desired vs actual)',
            observationMethod: 'scan_tool_pid',
            sourceProvenance: 'TRAINING-CONFIRMED',
          },
        ],
      },
    ],
    connections: [
      {
        fromComponentSlug: 'low-pressure-fuel-pump',
        toComponentSlug: 'fuel-rail',
        connectionKind: 'fluid-line',
        sourceProvenance: 'TRAINING-CONFIRMED',
      },
    ],
    ...overrides,
  }
}

async function countRows() {
  const c = await db.select().from(components)
  const conn = await db.select().from(componentConnections)
  const op = await db.select().from(observableProperties)
  return { components: c.length, connections: conn.length, observableProperties: op.length }
}

describe('promoteSystemDataDraft — the approval gate', () => {
  it('writes NOTHING and reports failure when the draft is not approved', async () => {
    await seedPlatform()
    const result = await promoteSystemDataDraft(db, fuelDraft({ status: 'draft' }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join(' ')).toMatch(/approv/i)
    }
    expect(await countRows()).toEqual({ components: 0, connections: 0, observableProperties: 0 })
  })

  it('refuses an approved draft that names no approver', async () => {
    await seedPlatform()
    const result = await promoteSystemDataDraft(
      db,
      fuelDraft({ status: 'approved', approvedBy: undefined }),
    )

    expect(result.ok).toBe(false)
    expect(await countRows()).toEqual({ components: 0, connections: 0, observableProperties: 0 })
  })
})

describe('promoteSystemDataDraft — promoting an approved draft', () => {
  it('inserts components, their observable properties, and the connections between them', async () => {
    const platformId = await seedPlatform()
    const result = await promoteSystemDataDraft(db, fuelDraft())

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.platformId).toBe(platformId)
      expect(result.counts.componentsWritten).toBe(2)
      expect(result.counts.connectionsWritten).toBe(1)
      expect(result.counts.observablePropertiesWritten).toBe(1)
    }

    const comps = await db.select().from(components).where(eq(components.platformId, platformId))
    expect(comps.map((c) => c.slug).sort()).toEqual(['fuel-rail', 'low-pressure-fuel-pump'])

    const rail = comps.find((c) => c.slug === 'fuel-rail')!
    const ops = await db
      .select()
      .from(observableProperties)
      .where(eq(observableProperties.componentId, rail.id))
    expect(ops).toHaveLength(1)
    expect(ops[0].slug).toBe('fuel-rail-pressure')

    const conns = await db.select().from(componentConnections)
    expect(conns).toHaveLength(1)
    expect(conns[0].connectionKind).toBe('fluid-line')
  })

  it('round-trips: a promoted draft is readable by loadSystemTopology', async () => {
    await seedPlatform()
    await db.insert(symptoms).values({
      slug: 'p0087-fuel-rail-pressure-too-low',
      description: 'P0087 Fuel Rail Pressure Too Low',
      category: 'dtc',
      system: 'fuel',
    })

    await promoteSystemDataDraft(db, fuelDraft())

    const topo = await loadSystemTopology({
      db,
      platformSlug: PLATFORM_SLUG,
      symptomSlug: 'p0087-fuel-rail-pressure-too-low',
    })
    expect(topo).not.toBeNull()
    expect(topo!.components.map((c) => c.slug).sort()).toEqual([
      'fuel-rail',
      'low-pressure-fuel-pump',
    ])
    expect(topo!.connections).toHaveLength(1)
    const rail = topo!.components.find((c) => c.slug === 'fuel-rail')!
    expect(rail.observableProperties.map((o) => o.slug)).toEqual(['fuel-rail-pressure'])
  })

  it('preserves a GAP provenance verbatim (honest "needs field check" row)', async () => {
    const platformId = await seedPlatform()
    const draft = fuelDraft()
    draft.components[0].sourceProvenance = 'GAP'
    await promoteSystemDataDraft(db, draft)

    const [pump] = await db
      .select()
      .from(components)
      .where(and(eq(components.platformId, platformId), eq(components.slug, 'low-pressure-fuel-pump')))
    expect(pump.sourceProvenance).toBe('GAP')
  })
})

describe('promoteSystemDataDraft — merge / dedupe (idempotent, re-runnable)', () => {
  it('does not duplicate rows when the same approved draft is promoted twice', async () => {
    await seedPlatform()
    await promoteSystemDataDraft(db, fuelDraft())
    await promoteSystemDataDraft(db, fuelDraft())

    expect(await countRows()).toEqual({ components: 2, connections: 1, observableProperties: 1 })
  })

  it('updates an existing row in place when a corrected draft reuses its slug', async () => {
    const platformId = await seedPlatform()
    await promoteSystemDataDraft(db, fuelDraft())

    const corrected = fuelDraft()
    corrected.components[0].name = 'Low-Pressure Lift Pump (corrected)'
    corrected.components[0].sourceProvenance = 'FIELD-VERIFIED'
    await promoteSystemDataDraft(db, corrected)

    const pumps = await db
      .select()
      .from(components)
      .where(and(eq(components.platformId, platformId), eq(components.slug, 'low-pressure-fuel-pump')))
    expect(pumps).toHaveLength(1)
    expect(pumps[0].name).toBe('Low-Pressure Lift Pump (corrected)')
    expect(pumps[0].sourceProvenance).toBe('FIELD-VERIFIED')
  })
})

describe('promoteSystemDataDraft — never fabricates structure', () => {
  it('fails (writes nothing) when the platform does not exist', async () => {
    const result = await promoteSystemDataDraft(db, fuelDraft())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/platform/i)
    expect(await countRows()).toEqual({ components: 0, connections: 0, observableProperties: 0 })
  })

  it('fails (writes nothing) when a connection references an unknown component', async () => {
    await seedPlatform()
    const draft = fuelDraft()
    draft.connections[0].toComponentSlug = 'ghost-component-not-in-draft'
    const result = await promoteSystemDataDraft(db, draft)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/ghost-component-not-in-draft/i)
    expect(await countRows()).toEqual({ components: 0, connections: 0, observableProperties: 0 })
  })
})

describe('promoteSystemDataDraft — identity matches the DB unique indexes', () => {
  it('refuses (cleanly) a component slug that already belongs to a different platform', async () => {
    const platformAId = await seedPlatform(PLATFORM_SLUG)
    await promoteSystemDataDraft(db, fuelDraft())

    await seedPlatform('ford-super-duty-3rd-gen-60-psd')
    const draftB = fuelDraft({ platformSlug: 'ford-super-duty-3rd-gen-60-psd' })
    const result = await promoteSystemDataDraft(db, draftB)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      const joined = result.errors.join(' ')
      // a legible domain error, not a raw SQL/unique-violation dump
      expect(joined).toMatch(/fuel-rail|low-pressure-fuel-pump/)
      expect(joined).toMatch(/platform/i)
      expect(joined).not.toMatch(/insert into|duplicate key|unique/i)
    }
    // platform A's data is untouched
    const aRows = await db.select().from(components).where(eq(components.platformId, platformAId))
    expect(aRows).toHaveLength(2)
  })
})

describe('promoteSystemDataDraft — non-destructive merge', () => {
  it('unions systems on update instead of clobbering the ones not in this draft', async () => {
    const platformId = await seedPlatform()
    const first = fuelDraft()
    first.components[1].systems = ['fuel', 'emissions']
    await promoteSystemDataDraft(db, first)

    const second = fuelDraft()
    second.components[1].systems = ['fuel'] // a fuel-only correction
    await promoteSystemDataDraft(db, second)

    const [rail] = await db
      .select()
      .from(components)
      .where(and(eq(components.platformId, platformId), eq(components.slug, 'fuel-rail')))
    expect([...rail.systems].sort()).toEqual(['emissions', 'fuel'])
  })

  it('leaves a previously-promoted item in place when a later draft omits it (additive)', async () => {
    await seedPlatform()
    await promoteSystemDataDraft(db, fuelDraft())

    // Re-promote a draft that lists only the rail and no connection.
    const partial = fuelDraft()
    partial.components = [partial.components[1]]
    partial.connections = []
    await promoteSystemDataDraft(db, partial)

    // The pump and the connection that were dropped from the draft still exist.
    expect(await countRows()).toEqual({ components: 2, connections: 1, observableProperties: 1 })
  })
})

describe('promoteSystemDataDraft — refuses ambiguous or malformed drafts (writes nothing)', () => {
  it('refuses a draft with two components sharing a slug', async () => {
    await seedPlatform()
    const draft = fuelDraft()
    draft.components[1].slug = 'low-pressure-fuel-pump' // collide with components[0]
    draft.connections = [] // isolate the duplicate-slug check from endpoint resolution
    const result = await promoteSystemDataDraft(db, draft)

    expect(result.ok).toBe(false)
    expect(await countRows()).toEqual({ components: 0, connections: 0, observableProperties: 0 })
  })

  it('refuses a draft with two observable properties sharing a slug', async () => {
    await seedPlatform()
    const draft = fuelDraft()
    draft.components[0].observableProperties = [
      {
        slug: 'pressure',
        description: 'a',
        observationMethod: 'scan_tool_pid',
        sourceProvenance: 'TRAINING-CONFIRMED',
      },
    ]
    draft.components[1].observableProperties = [
      {
        slug: 'pressure', // globally duplicate OP slug
        description: 'b',
        observationMethod: 'scan_tool_pid',
        sourceProvenance: 'TRAINING-CONFIRMED',
      },
    ]
    const result = await promoteSystemDataDraft(db, draft)

    expect(result.ok).toBe(false)
    expect(await countRows()).toEqual({ components: 0, connections: 0, observableProperties: 0 })
  })

  it('refuses a draft with two connections sharing (from, to, kind)', async () => {
    await seedPlatform()
    const draft = fuelDraft()
    draft.connections.push({
      fromComponentSlug: 'low-pressure-fuel-pump',
      toComponentSlug: 'fuel-rail',
      connectionKind: 'fluid-line',
      sourceProvenance: 'TRAINING-CONFIRMED',
    })
    const result = await promoteSystemDataDraft(db, draft)

    expect(result.ok).toBe(false)
    expect(await countRows()).toEqual({ components: 0, connections: 0, observableProperties: 0 })
  })

  it('refuses a self-referential connection (from === to)', async () => {
    await seedPlatform()
    const draft = fuelDraft()
    draft.connections[0].toComponentSlug = 'low-pressure-fuel-pump'
    draft.connections[0].fromComponentSlug = 'low-pressure-fuel-pump'
    const result = await promoteSystemDataDraft(db, draft)

    expect(result.ok).toBe(false)
    expect(await countRows()).toEqual({ components: 0, connections: 0, observableProperties: 0 })
  })

  it('refuses an invalid enum value (component kind) even when approved', async () => {
    await seedPlatform()
    const draft = fuelDraft()
    ;(draft.components[0] as { kind: string }).kind = 'not-a-real-kind'
    const result = await promoteSystemDataDraft(db, draft)

    expect(result.ok).toBe(false)
    expect(await countRows()).toEqual({ components: 0, connections: 0, observableProperties: 0 })
  })
})

describe('promoteSystemDataDraft — provenance + lifecycle fidelity', () => {
  it('preserves GAP provenance on a connection and on an observable property', async () => {
    const platformId = await seedPlatform()
    const draft = fuelDraft()
    draft.connections[0].sourceProvenance = 'GAP'
    draft.components[1].observableProperties[0].sourceProvenance = 'GAP'
    await promoteSystemDataDraft(db, draft)

    const [conn] = await db.select().from(componentConnections)
    expect(conn.sourceProvenance).toBe('GAP')

    const rail = (
      await db
        .select()
        .from(components)
        .where(and(eq(components.platformId, platformId), eq(components.slug, 'fuel-rail')))
    )[0]
    const [op] = await db
      .select()
      .from(observableProperties)
      .where(eq(observableProperties.componentId, rail.id))
    expect(op.sourceProvenance).toBe('GAP')
  })

  it('records inferenceClass for an inferred fact', async () => {
    const platformId = await seedPlatform()
    const draft = fuelDraft()
    draft.components[0].sourceProvenance = 'TRAINING-INFERRED'
    draft.components[0].inferenceClass = 'PATTERN'
    await promoteSystemDataDraft(db, draft)

    const [pump] = await db
      .select()
      .from(components)
      .where(and(eq(components.platformId, platformId), eq(components.slug, 'low-pressure-fuel-pump')))
    expect(pump.inferenceClass).toBe('PATTERN')
  })

  it('does not resolve a connection endpoint to a retired component', async () => {
    const platformId = await seedPlatform()
    // A retired component sharing no slug with the draft's components.
    await db.insert(components).values({
      slug: 'retired-ghost-pump',
      platformId,
      name: 'Retired Ghost Pump',
      kind: 'pump',
      systems: ['fuel'],
      sourceProvenance: 'TRAINING-CONFIRMED',
      isRetired: true,
    })

    const draft = fuelDraft()
    draft.connections[0].toComponentSlug = 'retired-ghost-pump'
    const result = await promoteSystemDataDraft(db, draft)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/retired-ghost-pump/i)
    // rollback: nothing from the draft landed
    const active = await db.select().from(components).where(eq(components.isRetired, false))
    expect(active).toHaveLength(0)
    expect((await db.select().from(componentConnections))).toHaveLength(0)
  })

  it('updates a connection in place when re-promoted with a changed field', async () => {
    await seedPlatform()
    await promoteSystemDataDraft(db, fuelDraft())

    const corrected = fuelDraft()
    corrected.connections[0].description = 'Lift pump supplies the rail (corrected)'
    await promoteSystemDataDraft(db, corrected)

    const conns = await db.select().from(componentConnections)
    expect(conns).toHaveLength(1)
    expect(conns[0].description).toBe('Lift pump supplies the rail (corrected)')
  })

  it('round-trips a multi-system component into the correct system diagram', async () => {
    await seedPlatform()
    await db.insert(symptoms).values({
      slug: 'air-intake-restriction',
      description: 'Air intake restriction',
      category: 'performance',
      system: 'air',
    })

    const draft: SystemDataDraft = {
      platformSlug: PLATFORM_SLUG,
      status: 'approved',
      approvedBy: 'curator-1',
      components: [
        {
          slug: 'maf-sensor',
          name: 'Mass Air Flow Sensor',
          kind: 'sensor',
          systems: ['fuel', 'air'],
          sourceProvenance: 'TRAINING-CONFIRMED',
          observableProperties: [],
        },
        {
          slug: 'intake-throttle',
          name: 'Intake Throttle Valve',
          kind: 'valve',
          systems: ['air'],
          sourceProvenance: 'TRAINING-CONFIRMED',
          observableProperties: [],
        },
      ],
      connections: [
        {
          fromComponentSlug: 'maf-sensor',
          toComponentSlug: 'intake-throttle',
          connectionKind: 'electrical-wire',
          sourceProvenance: 'TRAINING-CONFIRMED',
        },
      ],
    }
    await promoteSystemDataDraft(db, draft)

    const topo = await loadSystemTopology({
      db,
      platformSlug: PLATFORM_SLUG,
      symptomSlug: 'air-intake-restriction',
    })
    expect(topo).not.toBeNull()
    expect(topo!.components.map((c) => c.slug).sort()).toEqual(['intake-throttle', 'maf-sensor'])
    expect(topo!.connections).toHaveLength(1)
  })
})

describe('migration 0024 — additive diagram columns', () => {
  it('exposes test_actions.step_kind and pin_scenario_readings.is_out_of_range as nullable', async () => {
    // A bare select of the new columns proves the migration created them and
    // schema.ts declares them. No rows needed — an empty result is success.
    const steps = await db
      .select({ stepKind: testActions.stepKind })
      .from(testActions)
    expect(steps).toEqual([])

    const flags = await db
      .select({ isOutOfRange: pinScenarioReadings.isOutOfRange })
      .from(pinScenarioReadings)
    expect(flags).toEqual([])
  })
})
