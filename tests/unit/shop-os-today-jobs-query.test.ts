import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  listTodayTicketJobs,
  ticketActorFromProfile,
  type TicketActor,
} from '@/lib/tickets'
import {
  customers,
  profiles,
  sessions,
  shops,
  ticketJobs,
  tickets,
  vehicles,
} from '@/lib/db/schema'
import { createTestDb, type TestDb } from '@/tests/helpers/db'

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

const treeState = {
  nodes: [{ id: 'root', label: 'Initial scan', status: 'pending' as const }],
  currentNodeId: 'root',
  message: 'Starting',
}

describe('Today ticket jobs read model', () => {
  let db: TestDb
  let close: () => Promise<void>
  let shopId: string
  let otherShopId: string
  let actor: TicketActor
  let actorProfileId: string
  let otherProfileId: string
  let ticketId: string
  let customerId: string
  let vehicleId: string

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    const [shop, otherShop] = await db
      .insert(shops)
      .values([{ name: 'North Shop' }, { name: 'South Shop' }])
      .returning()
    shopId = shop.id
    otherShopId = otherShop.id

    const [actorProfile, otherProfile] = await db
      .insert(profiles)
      .values([
        {
          id: uuid(1),
          userId: uuid(101),
          shopId,
          fullName: 'Taylor Tech',
          role: 'tech',
          skillTier: 2,
        },
        {
          id: uuid(2),
          userId: uuid(102),
          shopId: otherShopId,
          fullName: 'Hidden Technician',
          role: 'tech',
          skillTier: 3,
        },
      ])
      .returning()
    actorProfileId = actorProfile.id
    otherProfileId = otherProfile.id
    actor = ticketActorFromProfile(actorProfile)

    const [customer] = await db
      .insert(customers)
      .values({
        id: uuid(10),
        shopId,
        name: 'Ada Driver',
        phone: '555-0101',
        email: 'private@example.com',
      })
      .returning()
    customerId = customer.id
    const [vehicle] = await db
      .insert(vehicles)
      .values({
        id: uuid(11),
        customerId,
        year: 2020,
        make: 'Honda',
        model: 'Civic',
        engine: 'private engine detail',
        vin: 'PRIVATEVIN',
        mileage: 42_000,
        plate: 'PRIVATE',
      })
      .returning()
    vehicleId = vehicle.id

    const [ticket] = await db
      .insert(tickets)
      .values({
        id: uuid(20),
        shopId,
        ticketNumber: 7,
        source: 'counter',
        customerId,
        vehicleId,
        concern: 'Persisted concern is not a Today card label',
        createdByProfileId: actorProfileId,
      })
      .returning()
    ticketId = ticket.id
  })

  afterEach(async () => close())

  it('returns assigned diagnostic, repair, and maintenance jobs plus eligible open jobs in persisted order', async () => {
    const [session] = await db
      .insert(sessions)
      .values({
        id: uuid(30),
        shopId,
        techId: actorProfileId,
        intake: {
          vehicleYear: 2020,
          vehicleMake: 'Honda',
          vehicleModel: 'Civic',
          customerComplaint: 'No start',
        },
        treeState,
      })
      .returning()
    await db.insert(ticketJobs).values([
      {
        id: uuid(43),
        shopId,
        ticketId,
        title: 'Rotate tires',
        kind: 'maintenance',
        requiredSkillTier: 1,
        assignedTechId: actorProfileId,
        workStatus: 'blocked',
        createdAt: new Date('2026-07-10T10:03:00Z'),
      },
      {
        id: uuid(41),
        shopId,
        ticketId,
        title: 'Diagnose no start',
        kind: 'diagnostic',
        requiredSkillTier: 2,
        assignedTechId: actorProfileId,
        sessionId: session.id,
        diagnosticStartState: 'ready',
        workStatus: 'open',
        createdAt: new Date('2026-07-10T10:01:00Z'),
      },
      {
        id: uuid(42),
        shopId,
        ticketId,
        title: 'Replace starter',
        kind: 'repair',
        requiredSkillTier: 2,
        assignedTechId: actorProfileId,
        workStatus: 'in_progress',
        createdAt: new Date('2026-07-10T10:02:00Z'),
      },
      {
        id: uuid(45),
        shopId,
        ticketId,
        title: 'Tier two open diagnosis',
        kind: 'diagnostic',
        requiredSkillTier: 2,
        createdAt: new Date('2026-07-10T10:05:00Z'),
      },
      {
        id: uuid(44),
        shopId,
        ticketId,
        title: 'Tier one open maintenance',
        kind: 'maintenance',
        requiredSkillTier: 1,
        createdAt: new Date('2026-07-10T10:04:00Z'),
      },
      {
        id: uuid(46),
        shopId,
        ticketId,
        title: 'Tier three hidden repair',
        kind: 'repair',
        requiredSkillTier: 3,
        createdAt: new Date('2026-07-10T10:06:00Z'),
      },
    ])

    const result = await listTodayTicketJobs(db, { actor })

    expect(result.myJobs.map((job) => [job.title, job.kind, job.workStatus])).toEqual([
      ['Diagnose no start', 'diagnostic', 'open'],
      ['Replace starter', 'repair', 'in_progress'],
      ['Rotate tires', 'maintenance', 'blocked'],
    ])
    expect(result.openJobs.map((job) => job.title)).toEqual([
      'Tier one open maintenance',
      'Tier two open diagnosis',
      'Tier three hidden repair',
    ])
    expect(result.createdJobs).toEqual([])
    expect(result.myJobs[0]).toEqual({
      id: uuid(41),
      ticketId,
      ticketNumber: 7,
      customerName: 'Ada Driver',
      vehicle: { year: 2020, make: 'Honda', model: 'Civic' },
      title: 'Diagnose no start',
      kind: 'diagnostic',
      requiredSkillTier: 2,
      sessionId: session.id,
      workStatus: 'open',
      canClaim: false,
      diagnosticStartState: 'ready',
      diagnosticStartErrorCode: null,
    })
    expect(result.linkedSessionIds).toEqual([session.id])
    expect(JSON.stringify(result)).not.toMatch(
      /diagnosticStartAttemptKey|diagnosticStartLeaseUntil/,
    )
  })

  it('excludes other tenants and terminal tickets or jobs without leaking profile or private customer/vehicle fields', async () => {
    const [otherTicket] = await db
      .insert(tickets)
      .values({
        id: uuid(50),
        shopId: otherShopId,
        ticketNumber: 1,
        source: 'tech_quick',
        concern: 'Hidden concern',
        createdByProfileId: otherProfileId,
      })
      .returning()
    await db.insert(ticketJobs).values([
      {
        id: uuid(51),
        shopId: otherShopId,
        ticketId: otherTicket.id,
        title: 'Hidden cross-shop job',
        kind: 'diagnostic',
        requiredSkillTier: 1,
      },
      {
        id: uuid(52),
        shopId,
        ticketId,
        title: 'Done job',
        kind: 'repair',
        requiredSkillTier: 1,
        assignedTechId: actorProfileId,
        workStatus: 'done',
      },
      {
        id: uuid(53),
        shopId,
        ticketId,
        title: 'Canceled job',
        kind: 'maintenance',
        requiredSkillTier: 1,
        workStatus: 'canceled',
      },
    ])
    const [closedTicket] = await db
      .insert(tickets)
      .values({
        id: uuid(54),
        shopId,
        ticketNumber: 8,
        source: 'counter',
        customerId,
        vehicleId,
        concern: 'Closed ticket',
        status: 'closed',
        createdByProfileId: actorProfileId,
      })
      .returning()
    await db.insert(ticketJobs).values({
      id: uuid(55),
      shopId,
      ticketId: closedTicket.id,
      title: 'Open job on closed ticket',
      kind: 'diagnostic',
      requiredSkillTier: 1,
      assignedTechId: actorProfileId,
    })

    const result = await listTodayTicketJobs(db, { actor })

    expect(result).toEqual({
      myJobs: [],
      openJobs: [],
      createdJobs: [],
      linkedSessionIds: [],
    })
    expect(JSON.stringify(result)).not.toMatch(
      /Taylor Tech|Hidden Technician|00000000-0000-4000-8000-00000000010[12]|North Shop|South Shop|private@example|PRIVATEVIN|PRIVATE|engine detail|Persisted concern|Hidden concern/,
    )
  })

  it('projects only safe diagnostic-start state and error fields', async () => {
    const leaseUntil = new Date('2026-07-10T12:02:00Z')
    await db.insert(ticketJobs).values({
      id: uuid(48),
      shopId,
      ticketId,
      title: 'Retry known-safe diagnostic start failure',
      kind: 'diagnostic',
      requiredSkillTier: 2,
      assignedTechId: actorProfileId,
      diagnosticStartState: 'failed',
      diagnosticStartAttemptKey: uuid(49),
      diagnosticStartLeaseUntil: leaseUntil,
      diagnosticStartErrorCode: 'open_session_limit',
    })

    const result = await listTodayTicketJobs(db, { actor })

    expect(result.myJobs).toEqual([
      expect.objectContaining({
        id: uuid(48),
        diagnosticStartState: 'failed',
        diagnosticStartErrorCode: 'open_session_limit',
      }),
    ])
    expect(JSON.stringify(result)).not.toContain(uuid(49))
    expect(JSON.stringify(result)).not.toContain(leaseUntil.toISOString())
    expect(result.myJobs[0]).not.toHaveProperty('diagnosticStartAttemptKey')
    expect(result.myJobs[0]).not.toHaveProperty('diagnosticStartLeaseUntil')

    await db
      .update(ticketJobs)
      .set({ diagnosticStartErrorCode: 'provider_secret=do-not-project' })
      .where(eq(ticketJobs.id, uuid(48)))
    const unknownErrorResult = await listTodayTicketJobs(db, { actor })

    expect(unknownErrorResult.myJobs[0].diagnosticStartErrorCode).toBeNull()
    expect(JSON.stringify(unknownErrorResult)).not.toContain('provider_secret')
  })

  it('gates all jobs to active same-shop Shop roles and keeps creator work visible to null-tier actors', async () => {
    await db.insert(ticketJobs).values([
      {
        shopId,
        ticketId,
        title: 'Assigned job',
        kind: 'repair',
        requiredSkillTier: 3,
        assignedTechId: actorProfileId,
        workStatus: 'blocked',
      },
      {
        shopId,
        ticketId,
        title: 'Open job',
        kind: 'maintenance',
        requiredSkillTier: 1,
      },
    ])

    await expect(
      listTodayTicketJobs(db, { actor: { ...actor, skillTier: null } }),
    ).resolves.toMatchObject({
      myJobs: [{ title: 'Assigned job' }],
      openJobs: [{ title: 'Open job', canClaim: false }],
    })

    const deniedActors: TicketActor[] = [
      { ...actor, shopId: null },
      { ...actor, role: 'curator' },
      { ...actor, membershipStatus: 'pending' },
      { ...actor, deactivatedAt: new Date('2026-07-10T12:00:00Z') },
    ]
    for (const deniedActor of deniedActors) {
      await expect(listTodayTicketJobs(db, { actor: deniedActor })).resolves.toEqual({
        myJobs: [],
        openJobs: [],
        createdJobs: [],
        linkedSessionIds: [],
      })
    }
  })

  it('keeps newly created work discoverable when the creator cannot claim it', async () => {
    await db.insert(ticketJobs).values({
      shopId,
      ticketId,
      title: 'Tier two inspection created by parts',
      kind: 'repair',
      requiredSkillTier: 2,
      workStatus: 'open',
    })

    const partsResult = await listTodayTicketJobs(db, {
      actor: { ...actor, role: 'parts', skillTier: null },
    })
    const juniorTechResult = await listTodayTicketJobs(db, {
      actor: { ...actor, role: 'tech', skillTier: 1 },
    })

    expect(partsResult.openJobs).toEqual([
      expect.objectContaining({
        title: 'Tier two inspection created by parts',
        canClaim: false,
      }),
    ])
    expect(juniorTechResult.openJobs).toEqual([
      expect.objectContaining({
        title: 'Tier two inspection created by parts',
        canClaim: false,
      }),
    ])
  })

  it('keeps preassigned work in a creator-only recovery lane', async () => {
    const [assignee] = await db
      .insert(profiles)
      .values({
        id: uuid(4),
        userId: uuid(104),
        shopId,
        fullName: 'Morgan Technician',
        role: 'tech',
        skillTier: 2,
      })
      .returning()
    await db.insert(ticketJobs).values({
      shopId,
      ticketId,
      title: 'Preassigned cooling-system inspection',
      kind: 'repair',
      requiredSkillTier: 2,
      assignedTechId: assignee.id,
      workStatus: 'open',
    })

    const result = await listTodayTicketJobs(db, {
      actor: { ...actor, role: 'advisor', skillTier: null },
    })

    expect(result.myJobs).toEqual([])
    expect(result.openJobs).toEqual([])
    expect(result.createdJobs).toEqual([
      expect.objectContaining({
        title: 'Preassigned cooling-system inspection',
        canClaim: false,
      }),
    ])
  })

  it.each(['in_progress', 'blocked'] as const)(
    'keeps unassigned creator work that is %s view-only',
    async (workStatus) => {
      await db.insert(ticketJobs).values({
        shopId,
        ticketId,
        title: `Creator recovery ${workStatus}`,
        kind: 'repair',
        requiredSkillTier: 1,
        workStatus,
      })

      const result = await listTodayTicketJobs(db, { actor })

      expect(result.openJobs).toEqual([])
      expect(result.createdJobs).toEqual([
        expect.objectContaining({
          title: `Creator recovery ${workStatus}`,
          workStatus,
          canClaim: false,
        }),
      ])
    },
  )

  it('keeps unassigned shop work visible to a tierless Owner without making it claimable', async () => {
    await db.insert(ticketJobs).values({
      shopId,
      ticketId,
      title: 'Unassigned Tier three diagnosis',
      kind: 'diagnostic',
      requiredSkillTier: 3,
      workStatus: 'open',
    })

    const result = await listTodayTicketJobs(db, {
      actor: { ...actor, role: 'owner', skillTier: null },
    })

    expect(result.myJobs).toEqual([])
    expect(result.openJobs).toEqual([
      expect.objectContaining({
        title: 'Unassigned Tier three diagnosis',
        requiredSkillTier: 3,
        canClaim: false,
      }),
    ])
  })

  it('keeps linked sessions for de-duplication but exposes navigation only to the session owner', async () => {
    const [otherActorProfile] = await db
      .insert(profiles)
      .values({
        id: uuid(3),
        userId: uuid(103),
        shopId,
        fullName: 'Terry Tech',
        role: 'tech',
        skillTier: 2,
      })
      .returning()
    const otherActor = ticketActorFromProfile(otherActorProfile)
    const [session] = await db
      .insert(sessions)
      .values({
        id: uuid(31),
        shopId,
        techId: actorProfileId,
        intake: {
          vehicleYear: 2020,
          vehicleMake: 'Honda',
          vehicleModel: 'Civic',
          customerComplaint: 'No start',
        },
        treeState,
      })
      .returning()
    const [job] = await db
      .insert(ticketJobs)
      .values({
        id: uuid(47),
        shopId,
        ticketId,
        title: 'Linked diagnosis owned by another tech',
        kind: 'diagnostic',
        requiredSkillTier: 2,
        assignedTechId: otherActor.profileId,
        sessionId: session.id,
      })
      .returning()

    const assignedResult = await listTodayTicketJobs(db, { actor: otherActor })

    expect(assignedResult.myJobs).toMatchObject([{ id: job.id, sessionId: null }])
    expect(assignedResult.linkedSessionIds).toEqual([session.id])

    await db
      .update(ticketJobs)
      .set({ assignedTechId: null })
      .where(eq(ticketJobs.id, job.id))

    const claimableResult = await listTodayTicketJobs(db, { actor: otherActor })
    const ownerResult = await listTodayTicketJobs(db, { actor })

    expect(claimableResult.openJobs).toMatchObject([{ id: job.id, sessionId: null }])
    expect(claimableResult.linkedSessionIds).toEqual([session.id])
    expect(ownerResult.openJobs).toMatchObject([{ id: job.id, sessionId: session.id }])
    expect(ownerResult.linkedSessionIds).toEqual([session.id])
  })

  it('bounds a high-cardinality Today backlog and reports that more work remains', async () => {
    await db.insert(ticketJobs).values(
      Array.from({ length: 205 }, (_, index) => ({
        shopId,
        ticketId,
        title: `Assigned backlog ${index + 1}`,
        kind: 'repair' as const,
        requiredSkillTier: 1,
        assignedTechId: actorProfileId,
      })),
    )

    const result = await listTodayTicketJobs(db, { actor })

    expect(result.myJobs).toHaveLength(200)
    expect(result.openJobs).toEqual([])
    expect(result.hasMore).toBe(true)
  })
})
