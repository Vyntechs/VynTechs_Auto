import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTicket, type TicketActor } from '@/lib/tickets'
import {
  customers,
  profiles,
  shops,
  ticketJobs,
  tickets,
  vehicles,
  type Profile,
} from '@/lib/db/schema'
import { createTestDb, type TestDb } from '@/tests/helpers/db'

type SeededProfile = Pick<
  Profile,
  'id' | 'shopId' | 'role' | 'skillTier' | 'membershipStatus' | 'deactivatedAt'
>

const uuid = (suffix: number) =>
  `00000000-0000-0000-0000-${suffix.toString().padStart(12, '0')}`

function actorFrom(profile: SeededProfile): TicketActor {
  return {
    profileId: profile.id,
    shopId: profile.shopId,
    role: profile.role,
    skillTier: profile.skillTier,
    membershipStatus: profile.membershipStatus,
    deactivatedAt: profile.deactivatedAt,
  }
}

describe('createTicket', () => {
  let db: TestDb
  let close: () => Promise<void>
  let shopA: typeof shops.$inferSelect
  let shopB: typeof shops.$inferSelect
  let customerA: typeof customers.$inferSelect
  let customerA2: typeof customers.$inferSelect
  let customerB: typeof customers.$inferSelect
  let vehicleA: typeof vehicles.$inferSelect
  let vehicleA2: typeof vehicles.$inferSelect
  let vehicleB: typeof vehicles.$inferSelect
  let actors: Record<'tech' | 'advisor' | 'parts' | 'owner', TicketActor>
  let sameShopTierOne: SeededProfile

  beforeEach(async () => {
    const created = await createTestDb()
    db = created.db
    close = created.close

    ;[shopA, shopB] = await db
      .insert(shops)
      .values([{ name: 'North Shop' }, { name: 'South Shop' }])
      .returning()
    ;[customerA, customerA2, customerB] = await db
      .insert(customers)
      .values([
        { shopId: shopA.id, name: 'Ada Driver', phone: '555-0101', email: 'ada@example.com' },
        { shopId: shopA.id, name: 'Ben Driver', phone: '555-0102' },
        { shopId: shopB.id, name: 'Cross Shop', phone: '555-0201' },
      ])
      .returning()
    ;[vehicleA, vehicleA2, vehicleB] = await db
      .insert(vehicles)
      .values([
        {
          customerId: customerA.id,
          year: 2020,
          make: 'Honda',
          model: 'Civic',
          engine: '2.0L',
          vin: 'VIN-A',
          mileage: 42000,
          plate: 'NORTH1',
        },
        { customerId: customerA2.id, year: 2019, make: 'Ford', model: 'F-150' },
        { customerId: customerB.id, year: 2021, make: 'Toyota', model: 'Camry' },
      ])
      .returning()

    const seeded = await db
      .insert(profiles)
      .values([
        {
          userId: uuid(1),
          shopId: shopA.id,
          role: 'tech',
          skillTier: 2,
          fullName: 'Taylor Tech',
        },
        {
          userId: uuid(2),
          shopId: shopA.id,
          role: 'advisor',
          skillTier: 2,
          fullName: 'Alex Advisor',
        },
        {
          userId: uuid(3),
          shopId: shopA.id,
          role: 'parts',
          skillTier: null,
          fullName: 'Pat Parts',
        },
        {
          userId: uuid(4),
          shopId: shopA.id,
          role: 'owner',
          skillTier: 3,
          fullName: 'Owen Owner',
        },
        {
          userId: uuid(5),
          shopId: shopA.id,
          role: 'tech',
          skillTier: 1,
          fullName: 'Terry Tier One',
        },
      ])
      .returning()

    actors = {
      tech: actorFrom(seeded[0]),
      advisor: actorFrom(seeded[1]),
      parts: actorFrom(seeded[2]),
      owner: actorFrom(seeded[3]),
    }
    sameShopTierOne = seeded[4]
  })

  afterEach(async () => {
    await close()
  })

  function body(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      source: 'counter',
      customerId: customerA.id,
      vehicleId: vehicleA.id,
      concern: '  Intermittent front-end noise  ',
      whenStarted: '  last week  ',
      howOften: '  on cold starts  ',
      diagnosticAuthorizedCents: 12500,
      diagnosticAuthorizationNote: '  customer approved by phone  ',
      jobs: [
        {
          title: '  Diagnose front-end noise  ',
          kind: 'diagnostic',
          requiredSkillTier: 2,
        },
      ],
      ...overrides,
    }
  }

  it('allows every active Shop OS role and returns the trimmed canonical safe projection', async () => {
    for (const role of ['tech', 'advisor', 'parts', 'owner'] as const) {
      const result = await createTicket(db, { actor: actors[role], body: body() })
      expect(result.ok, role).toBe(true)
      if (!result.ok) continue

      expect(result.ticket).toMatchObject({
        ticketNumber: ['tech', 'advisor', 'parts', 'owner'].indexOf(role) + 1,
        source: 'counter',
        status: 'open',
        concern: 'Intermittent front-end noise',
        whenStarted: 'last week',
        howOften: 'on cold starts',
        diagnosticAuthorizedCents: 12500,
        diagnosticAuthorizationNote: 'customer approved by phone',
        customer: {
          id: customerA.id,
          name: 'Ada Driver',
          phone: '555-0101',
          email: 'ada@example.com',
        },
        vehicle: {
          id: vehicleA.id,
          year: 2020,
          make: 'Honda',
          model: 'Civic',
          engine: '2.0L',
          vin: 'VIN-A',
          mileage: 42000,
          plate: 'NORTH1',
        },
        jobs: [
          {
            title: 'Diagnose front-end noise',
            kind: 'diagnostic',
            requiredSkillTier: 2,
            assignedTechId: null,
            assignedTech: null,
            sessionId: null,
            workStatus: 'open',
            approvalState: 'pending_quote',
            workNotes: null,
            diagnosticStartState: 'idle',
            diagnosticStartErrorCode: null,
            createdAt: expect.any(Date),
            updatedAt: expect.any(Date),
          },
        ],
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      })
      expect(result.ticket).not.toHaveProperty('shopId')
      expect(result.ticket).not.toHaveProperty('createdByProfileId')
    }
  })

  it('rejects unsupported, pending, deactivated, and no-shop actors without mutation', async () => {
    const denied: Array<[TicketActor, string]> = [
      [{ ...actors.tech, role: 'curator' }, 'forbidden'],
      [{ ...actors.tech, membershipStatus: 'pending' }, 'inactive_profile'],
      [{ ...actors.tech, deactivatedAt: new Date() }, 'inactive_profile'],
      [{ ...actors.tech, shopId: null }, 'no_shop'],
    ]

    for (const [actor, error] of denied) {
      await expect(createTicket(db, { actor, body: body() })).resolves.toEqual({
        ok: false,
        error,
      })
    }
    expect(await db.select().from(tickets)).toEqual([])
    expect(await db.select().from(ticketJobs)).toEqual([])
  })

  it('rejects malformed, unbounded, unsafe, empty, and client-managed body fields', async () => {
    const invalidBodies: unknown[] = [
      null,
      body({ source: 'legacy_repair_order' }),
      body({ customerId: 'not-a-uuid' }),
      body({ concern: '   ' }),
      body({ concern: 'x'.repeat(5001) }),
      body({ whenStarted: 'x'.repeat(1001) }),
      body({ howOften: 'x'.repeat(1001) }),
      body({ diagnosticAuthorizationNote: 'x'.repeat(2001) }),
      body({ diagnosticAuthorizedCents: -1 }),
      body({ diagnosticAuthorizedCents: Number.MAX_SAFE_INTEGER + 1 }),
      body({ diagnosticAuthorizedCents: 1.5 }),
      body({ jobs: [] }),
      body({
        jobs: Array.from({ length: 26 }, () => ({
          title: 'Job',
          kind: 'repair',
          requiredSkillTier: 1,
        })),
      }),
      body({ jobs: [{ title: ' ', kind: 'repair', requiredSkillTier: 1 }] }),
      body({ jobs: [{ title: 'x'.repeat(201), kind: 'repair', requiredSkillTier: 1 }] }),
      body({ jobs: [{ title: 'Job', kind: 'inspection', requiredSkillTier: 1 }] }),
      body({ jobs: [{ title: 'Job', kind: 'repair', requiredSkillTier: 4 }] }),
      { ...body(), status: 'closed' },
      body({
        jobs: [{ title: 'Job', kind: 'repair', requiredSkillTier: 1, workStatus: 'done' }],
      }),
    ]

    for (const invalidBody of invalidBodies) {
      await expect(
        createTicket(db, { actor: actors.owner, body: invalidBody }),
      ).resolves.toEqual({ ok: false, error: 'invalid_input' })
    }
    expect(await db.select().from(tickets)).toEqual([])
    expect(await db.select().from(ticketJobs)).toEqual([])
  })

  it('enforces customer and vehicle pair rules without revealing cross-shop records', async () => {
    const invalidPairs = [
      body({ customerId: null }),
      body({ vehicleId: null }),
      body({ customerId: customerA.id, vehicleId: vehicleA2.id }),
      body({ customerId: customerB.id, vehicleId: vehicleB.id }),
      body({ customerId: customerA.id, vehicleId: vehicleB.id }),
    ]

    await expect(
      createTicket(db, { actor: actors.advisor, body: invalidPairs[0] }),
    ).resolves.toEqual({ ok: false, error: 'invalid_input' })
    await expect(
      createTicket(db, { actor: actors.advisor, body: invalidPairs[1] }),
    ).resolves.toEqual({ ok: false, error: 'invalid_input' })
    for (const invalidPair of invalidPairs.slice(2)) {
      await expect(
        createTicket(db, { actor: actors.advisor, body: invalidPair }),
      ).resolves.toEqual({ ok: false, error: 'not_found' })
    }

    for (const invalidTechQuick of [
      body({ source: 'tech_quick', customerId: customerA.id, vehicleId: null }),
      body({ source: 'tech_quick', customerId: null, vehicleId: vehicleA.id }),
      body({ source: 'tech_quick', customerId: customerA.id, vehicleId: vehicleA.id }),
    ]) {
      await expect(
        createTicket(db, { actor: actors.tech, body: invalidTechQuick }),
      ).resolves.toEqual({ ok: false, error: 'invalid_input' })
    }

    await expect(
      createTicket(db, {
        actor: actors.tech,
        body: body({ source: 'tech_quick', customerId: null, vehicleId: null }),
      }),
    ).resolves.toMatchObject({ ok: true, ticket: { customer: null, vehicle: null } })
  })

  it('keeps open work unassigned and permits only sufficiently tiered self-assignment', async () => {
    const open = await createTicket(db, { actor: actors.tech, body: body() })
    expect(open).toMatchObject({
      ok: true,
      ticket: { jobs: [{ assignedTechId: null, assignedTech: null }] },
    })

    const assigned = await createTicket(db, {
      actor: actors.tech,
      body: body({
        jobs: [
          {
            title: 'Self-assigned diagnosis',
            kind: 'diagnostic',
            requiredSkillTier: 2,
            assignedTechId: actors.tech.profileId,
          },
        ],
      }),
    })
    expect(assigned).toMatchObject({
      ok: true,
      ticket: {
        jobs: [
          {
            assignedTechId: actors.tech.profileId,
            assignedTech: {
              id: actors.tech.profileId,
              fullName: 'Taylor Tech',
              role: 'tech',
              skillTier: 2,
            },
          },
        ],
      },
    })
    if (assigned.ok) {
      expect(assigned.ticket.jobs[0].assignedTech).not.toHaveProperty('userId')
    }

    await expect(
      createTicket(db, {
        actor: actors.tech,
        body: body({
          jobs: [
            {
              title: 'Too advanced',
              kind: 'repair',
              requiredSkillTier: 3,
              assignedTechId: actors.tech.profileId,
              confirmBelowTier: true,
            },
          ],
        }),
      }),
    ).resolves.toEqual({ ok: false, error: 'invalid_assignee' })
  })

  it('requires assignment authority and explicit advisor or owner confirmation below tier', async () => {
    for (const role of ['tech', 'parts'] as const) {
      await expect(
        createTicket(db, {
          actor: actors[role],
          body: body({
            jobs: [
              {
                title: 'Assign another tech',
                kind: 'repair',
                requiredSkillTier: 1,
                assignedTechId: sameShopTierOne.id,
              },
            ],
          }),
        }),
      ).resolves.toEqual({ ok: false, error: 'invalid_assignee' })
    }

    for (const role of ['advisor', 'owner'] as const) {
      const assignment = {
        title: 'Advanced repair',
        kind: 'repair',
        requiredSkillTier: 3,
        assignedTechId: sameShopTierOne.id,
      }
      await expect(
        createTicket(db, { actor: actors[role], body: body({ jobs: [assignment] }) }),
      ).resolves.toEqual({
        ok: false,
        error: 'tier_confirmation_required',
        warning: {
          code: 'below_required_tier',
          assignedTechId: sameShopTierOne.id,
          assignedSkillTier: 1,
          requiredSkillTier: 3,
        },
      })

      await expect(
        createTicket(db, {
          actor: actors[role],
          body: body({ jobs: [{ ...assignment, confirmBelowTier: true }] }),
        }),
      ).resolves.toMatchObject({
        ok: true,
        ticket: { jobs: [{ assignedTechId: sameShopTierOne.id }] },
      })
    }
  })

  it('rejects unknown, cross-shop, pending, deactivated, and tierless assignees', async () => {
    const [crossShop, pending, deactivated, tierless] = await db
      .insert(profiles)
      .values([
        { userId: uuid(20), shopId: shopB.id, role: 'tech', skillTier: 3 },
        {
          userId: uuid(21),
          shopId: shopA.id,
          role: 'tech',
          skillTier: 3,
          membershipStatus: 'pending',
          membershipActivatedAt: null,
        },
        {
          userId: uuid(22),
          shopId: shopA.id,
          role: 'tech',
          skillTier: 3,
          deactivatedAt: new Date(),
        },
        { userId: uuid(23), shopId: shopA.id, role: 'parts', skillTier: null },
      ])
      .returning()

    for (const assignedTechId of [
      '00000000-0000-4000-8000-000000000999',
      crossShop.id,
      pending.id,
      deactivated.id,
      tierless.id,
    ]) {
      await expect(
        createTicket(db, {
          actor: actors.owner,
          body: body({
            jobs: [
              {
                title: 'Invalid assignment',
                kind: 'repair',
                requiredSkillTier: 1,
                assignedTechId,
              },
            ],
          }),
        }),
      ).resolves.toEqual({ ok: false, error: 'invalid_assignee' })
    }
    expect(await db.select().from(tickets)).toEqual([])
  })

  it('allocates concurrent same-shop numbers consecutively and sequences shops independently', async () => {
    const [first, second] = await Promise.all([
      createTicket(db, { actor: actors.owner, body: body() }),
      createTicket(db, { actor: actors.advisor, body: body() }),
    ])
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect([first.ticket.ticketNumber, second.ticket.ticketNumber].sort()).toEqual([1, 2])

    const [shopBActor] = await db
      .insert(profiles)
      .values({ userId: uuid(30), shopId: shopB.id, role: 'owner', skillTier: 3 })
      .returning()
    const otherShop = await createTicket(db, {
      actor: actorFrom(shopBActor),
      body: body({ customerId: customerB.id, vehicleId: vehicleB.id }),
    })
    expect(otherShop).toMatchObject({ ok: true, ticket: { ticketNumber: 1 } })

    const [northSequence] = await db
      .select({ nextTicketNumber: shops.nextTicketNumber })
      .from(shops)
      .where(eq(shops.id, shopA.id))
    const [southSequence] = await db
      .select({ nextTicketNumber: shops.nextTicketNumber })
      .from(shops)
      .where(eq(shops.id, shopB.id))
    expect(northSequence.nextTicketNumber).toBe(3)
    expect(southSequence.nextTicketNumber).toBe(2)
  })
})
