import { createHash } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppDb } from '@/lib/db/queries'
import * as dbSchema from '@/lib/db/schema'
import {
  customers,
  jobLines,
  profiles,
  quoteSends,
  quoteVersions,
  sessions,
  shops,
  ticketActivity,
  ticketJobs,
  tickets,
  vehicles,
} from '@/lib/db/schema'
import { createCounterTicket } from '@/lib/intake/counter-ticket'
import { stableStringify } from '@/lib/shop-os/quote-math'
import { createQuoteVersion } from '@/lib/shop-os/quotes'
import {
  correctTicket,
  type TicketCorrectionDependencies,
} from '@/lib/shop-os/ticket-corrections'
import { ticketActorFromProfile } from '@/lib/tickets'
import { createGoldenShopDay } from '@/tests/helpers/golden-shop-day'

type Golden = Awaited<ReturnType<typeof createGoldenShopDay>>

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

async function seedTicket(golden: Golden, options: { secondJob?: boolean; priced?: boolean } = {}) {
  const created = await createCounterTicket(golden.db, {
    actor: golden.actors.advisor,
    body: {
      clientKey: crypto.randomUUID(),
      vehicleMode: 'new',
      customer: golden.customer,
      vehicle: golden.vehicle,
      concern: 'Brake pedal feels soft.',
      work: {
        mode: 'manual',
        kind: 'repair',
        description: 'Inspect front brakes',
        customerSuppliedPartsNote: null,
      },
      assignedTechId: golden.people.tech.id,
    },
  })
  if (!created.ok) throw new Error('ticket fixture failed')
  let ticket = created.ticket
  if (options.secondJob) {
    await golden.db.insert(ticketJobs).values({
      id: uuid(701),
      shopId: golden.shop.id,
      ticketId: ticket.id,
      title: 'Rotate tires',
      kind: 'maintenance',
      requiredSkillTier: 1,
    })
  }
  if (options.priced) {
    await golden.db.insert(jobLines).values({
      id: uuid(702),
      shopId: golden.shop.id,
      jobId: ticket.jobs[0].id,
      kind: 'labor',
      description: 'Inspect front brakes',
      sort: 0,
      quantity: 1,
      priceCents: 12_000,
      taxable: false,
      laborHours: 1,
      laborRateCents: 12_000,
      source: 'manual',
    })
  }
  const [freshTicket] = await golden.db.select().from(tickets).where(eq(tickets.id, ticket.id))
  const freshJobs = await golden.db.select().from(ticketJobs).where(eq(ticketJobs.ticketId, ticket.id))
  ticket = {
    ...ticket,
    updatedAt: freshTicket.updatedAt,
    jobs: freshJobs.map((job) => ({
      ...ticket.jobs[0],
      ...job,
      assignedTech: null,
    })),
  }
  return ticket
}

function common(ticket: { updatedAt: Date }, requestKey: string) {
  return {
    requestKey,
    expectedTicketUpdatedAt: ticket.updatedAt.toISOString(),
    expectedActiveVersionId: null,
  }
}

async function storedTicket(golden: Golden, ticketId: string) {
  const [ticket] = await golden.db.select().from(tickets).where(eq(tickets.id, ticketId))
  if (!ticket) throw new Error('stored ticket missing')
  return ticket
}

async function storedJob(golden: Golden, jobId: string) {
  const [job] = await golden.db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
  if (!job) throw new Error('stored job missing')
  return job
}

async function prepareVersion(golden: Golden, ticketId: string) {
  const result = await createQuoteVersion(golden.db, {
    actor: { profileId: golden.people.advisor.id },
    ticketId,
  })
  if (!result.ok) throw new Error('quote fixture failed')
  const [version] = await golden.db.select().from(quoteVersions).where(eq(quoteVersions.id, result.version.id))
  if (!version) throw new Error('stored quote fixture missing')
  return version
}

async function addActionableLink(
  golden: Golden,
  ticketId: string,
  quoteVersionId: string,
  requestKey: string,
) {
  const sentAt = new Date('2026-08-03T06:00:00.000Z')
  const [link] = await golden.db.insert(quoteSends).values({
    shopId: golden.shop.id,
    ticketId,
    quoteVersionId,
    customerId: null,
    subjectKey: uuid(790),
    destinationFingerprint: 'a'.repeat(64),
    fingerprintKeyVersion: 'link_v1',
    channel: 'link',
    tokenHash: 'b'.repeat(64),
    tokenExpiresAt: new Date('2026-08-10T12:00:00.000Z'),
    requestingActorProfileId: golden.people.advisor.id,
    requestKey,
    requestFingerprint: 'c'.repeat(64),
    state: 'submitted',
    submittingAt: sentAt,
    submittedAt: sentAt,
    createdAt: sentAt,
    updatedAt: sentAt,
  }).returning()
  return link
}

async function replaceVersionSnapshot(
  golden: Golden,
  versionId: string,
  snapshot: Record<string, unknown>,
) {
  await golden.db.execute(sql`alter table quote_versions disable trigger quote_versions_immutable_update`)
  await golden.db.update(quoteVersions).set({ snapshot }).where(eq(quoteVersions.id, versionId))
  await golden.db.execute(sql`alter table quote_versions enable trigger quote_versions_immutable_update`)
}

async function correctionState(golden: Golden, ticketId: string) {
  const jobs = await golden.db.select().from(ticketJobs)
    .where(eq(ticketJobs.ticketId, ticketId)).orderBy(ticketJobs.id)
  return {
    ticket: await storedTicket(golden, ticketId),
    jobs,
    lines: await golden.db.select().from(jobLines).orderBy(jobLines.id),
    versions: await golden.db.select().from(quoteVersions)
      .where(eq(quoteVersions.ticketId, ticketId)).orderBy(quoteVersions.id),
    links: await golden.db.select().from(quoteSends)
      .where(eq(quoteSends.ticketId, ticketId)).orderBy(quoteSends.id),
    receipts: await golden.db.select().from(ticketActivity)
      .where(eq(ticketActivity.ticketId, ticketId)).orderBy(ticketActivity.id),
    customers: await golden.db.select().from(customers).orderBy(customers.id),
    vehicles: await golden.db.select().from(vehicles).orderBy(vehicles.id),
  }
}

function concernBody(
  ticket: { updatedAt: Date },
  requestKey: string,
  expectedActiveVersionId: string | null = null,
) {
  return {
    action: 'concern' as const,
    ...common(ticket, requestKey),
    expectedActiveVersionId,
    concern: 'Brake concern corrected under lock.',
  }
}

function intentHash(body: unknown): string {
  return createHash('sha256').update(stableStringify(body)).digest('hex')
}

function loggedDb(
  golden: Golden,
  logQuery: (query: string) => void,
): AppDb {
  return drizzle(golden.client, {
    schema: dbSchema,
    logger: { logQuery: (query) => logQuery(query) },
  })
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('correctTicket', () => {
  it('fails closed before parsing and rejects non-canonical bodies once enabled', async () => {
    const golden = await createGoldenShopDay()
    try {
      vi.stubEnv('SHOP_OS_TICKET_CORRECTION_ENABLED', 'false')
      await expect(correctTicket(golden.db, {
        actor: golden.actors.advisor,
        ticketId: 'bad',
        body: { raw: 'customer data' },
      })).resolves.toEqual({ ok: false, error: 'unavailable' })

      vi.stubEnv('SHOP_OS_TICKET_CORRECTION_ENABLED', 'true')
      await expect(correctTicket(golden.db, {
        actor: golden.actors.advisor,
        ticketId: 'bad',
        body: { action: 'concern', concern: 'x', extra: true },
      })).resolves.toEqual({ ok: false, error: 'invalid_input' })
      expect(await golden.db.select().from(ticketActivity)).toEqual([])
    } finally {
      await golden.close()
    }
  })

  it('changes concern once, replays exact stale input, conflicts on changed intent, and leaves a new no-op receipt-free', async () => {
    vi.stubEnv('SHOP_OS_TICKET_CORRECTION_ENABLED', 'true')
    const golden = await createGoldenShopDay()
    try {
      const ticket = await seedTicket(golden)
      const body = {
        action: 'concern' as const,
        ...common(ticket, uuid(710)),
        concern: '  Brake pedal sinks at stoplights.  ',
      }
      const first = await correctTicket(golden.db, {
        actor: golden.actors.advisor, ticketId: ticket.id, body,
      })
      expect(first).toMatchObject({ ok: true, outcome: 'changed', changed: true, scope: 'concern' })
      const replay = await correctTicket(golden.db, {
        actor: golden.actors.advisor, ticketId: ticket.id, body,
      })
      expect(replay).toMatchObject({ ok: true, outcome: 'replayed', changed: false, scope: 'concern' })
      await expect(correctTicket(golden.db, {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: { ...body, concern: 'Different concern' },
      })).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })

      if (!first.ok) return
      const unchanged = await correctTicket(golden.db, {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: {
          action: 'concern',
          ...common(first.ticket, uuid(711)),
          concern: 'Brake pedal sinks at stoplights.',
        },
      })
      expect(unchanged).toMatchObject({ ok: true, outcome: 'unchanged', changed: false })
      const receipts = await golden.db.select().from(ticketActivity)
      expect(receipts).toHaveLength(1)
      expect(JSON.stringify(receipts[0].payload)).not.toContain('Brake pedal')
    } finally {
      await golden.close()
    }
  })

  it('uses only a currently persisted advisor/owner in the original shop for new work and replay', async () => {
    vi.stubEnv('SHOP_OS_TICKET_CORRECTION_ENABLED', 'true')
    const golden = await createGoldenShopDay()
    try {
      const ticket = await seedTicket(golden)
      const body = {
        action: 'concern' as const,
        ...common(ticket, uuid(712)),
        concern: 'New persisted concern',
      }
      await expect(correctTicket(golden.db, {
        actor: golden.actors.tech, ticketId: ticket.id, body,
      })).resolves.toEqual({ ok: false, error: 'forbidden' })

      const movedShop = await golden.db.insert(shops).values({ name: 'Moved Shop' }).returning()
      const result = await correctTicket(golden.db, {
        actor: golden.actors.owner,
        ticketId: ticket.id,
        body,
      }, {
        afterVersionLock: async (transactionDb) => {
          await transactionDb.update(profiles)
            .set({ shopId: movedShop[0].id })
            .where(eq(profiles.id, golden.people.owner.id))
        },
      })
      expect(result).toEqual({ ok: false, error: 'not_found' })
      expect((await storedTicket(golden, ticket.id)).concern).toBe(ticket.concern)
      expect(await golden.db.select().from(ticketActivity)).toEqual([])
    } finally {
      await golden.close()
    }
  })

  it.each([
    ['demoted new write', false, 'forbidden'],
    ['deactivated replay', true, 'not_found'],
  ] as const)('refuses a persisted actor %s after version lock with zero repair-order mutation', async (
    _label,
    replay,
    expectedError,
  ) => {
    vi.stubEnv('SHOP_OS_TICKET_CORRECTION_ENABLED', 'true')
    const golden = await createGoldenShopDay()
    try {
      const ticket = await seedTicket(golden, { priced: true })
      const body = concernBody(ticket, uuid(replay ? 734 : 735))
      if (replay) {
        await expect(correctTicket(golden.db, {
          actor: golden.actors.advisor,
          ticketId: ticket.id,
          body,
        })).resolves.toMatchObject({ ok: true, outcome: 'changed' })
      }
      const currentTicket = await storedTicket(golden, ticket.id)
      const version = await prepareVersion(golden, ticket.id)
      await addActionableLink(golden, ticket.id, version.id, uuid(replay ? 736 : 737))
      const before = await correctionState(golden, ticket.id)
      const result = await correctTicket(golden.db, {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: replay ? body : concernBody(currentTicket, uuid(738), version.id),
      }, {
        afterVersionLock: async (transactionDb) => {
          await transactionDb.update(profiles).set(replay
            ? { deactivatedAt: new Date('2026-08-03T12:00:00.000Z') }
            : { role: 'tech' })
            .where(eq(profiles.id, golden.people.advisor.id))
        },
      })

      expect(result).toEqual({ ok: false, error: expectedError })
      expect(result).not.toHaveProperty('ticket')
      expect(await correctionState(golden, ticket.id)).toEqual(before)
    } finally {
      await golden.close()
    }
  })

  it('rejects a malformed persisted correction receipt before exposing replay truth', async () => {
    vi.stubEnv('SHOP_OS_TICKET_CORRECTION_ENABLED', 'true')
    const golden = await createGoldenShopDay()
    try {
      const ticket = await seedTicket(golden)
      const requestKey = uuid(713)
      await golden.db.insert(ticketActivity).values({
        shopId: golden.shop.id,
        ticketId: ticket.id,
        actorProfileId: golden.people.advisor.id,
        kind: 'ticket_corrected',
        requestKey,
        payload: {
          v: 1,
          scope: 'concern',
          intentHash: 'a'.repeat(64),
          changedFields: ['concern'],
          privilegedExtra: true,
        },
      })
      const result = await correctTicket(golden.db, {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: {
          action: 'concern',
          ...common(ticket, requestKey),
          concern: 'Attempted replay',
        },
      })
      expect(result).toEqual({ ok: false, error: 'conflict', retryable: false })
      expect(result).not.toHaveProperty('ticket')
    } finally {
      await golden.close()
    }
  })

  it.each(['malformed version pair', 'scope/job mismatch'] as const)(
    'rejects a hostile persisted receipt with %s and returns no current ticket data',
    async (corruption) => {
      vi.stubEnv('SHOP_OS_TICKET_CORRECTION_ENABLED', 'true')
      const golden = await createGoldenShopDay()
      try {
        const ticket = await seedTicket(golden)
        const job = await storedJob(golden, ticket.jobs[0].id)
        const requestKey = uuid(corruption === 'malformed version pair' ? 739 : 740)
        const body = corruption === 'malformed version pair'
          ? concernBody(ticket, requestKey)
          : {
              action: 'job' as const,
              ...common(ticket, requestKey),
              jobId: job.id,
              expectedJobUpdatedAt: job.updatedAt.toISOString(),
              title: 'Hostile receipt must not replay',
              kind: 'repair' as const,
              customerSuppliedPartsNote: null,
            }
        await golden.db.insert(ticketActivity).values({
          shopId: golden.shop.id,
          ticketId: ticket.id,
          jobId: corruption === 'scope/job mismatch' ? job.id : null,
          actorProfileId: golden.people.advisor.id,
          kind: 'ticket_corrected',
          requestKey,
          payload: corruption === 'malformed version pair' ? {
            v: 1,
            scope: 'concern',
            intentHash: intentHash(body),
            changedFields: ['concern'],
            invalidatedVersionId: uuid(741),
            invalidatedVersionNumber: null,
          } : {
            v: 1,
            scope: 'concern',
            intentHash: intentHash(body),
            changedFields: ['concern'],
          },
        })
        const before = await correctionState(golden, ticket.id)

        const result = await correctTicket(golden.db, {
          actor: golden.actors.advisor,
          ticketId: ticket.id,
          body,
        })

        expect(result).toEqual({ ok: false, error: 'conflict', retryable: false })
        expect(result).not.toHaveProperty('ticket')
        expect(await correctionState(golden, ticket.id)).toEqual(before)
      } finally {
        await golden.close()
      }
    },
  )

  it('relinks only this ticket to an existing same-shop customer/vehicle and hides cross-shop selections', async () => {
    vi.stubEnv('SHOP_OS_TICKET_CORRECTION_ENABLED', 'true')
    const golden = await createGoldenShopDay()
    try {
      const ticket = await seedTicket(golden)
      const [customer] = await golden.db.insert(customers).values({
        shopId: golden.shop.id, name: 'Second Customer', phone: '202-555-0199',
      }).returning()
      const [vehicle] = await golden.db.insert(vehicles).values({
        customerId: customer.id, year: 2021, make: 'Honda', model: 'Accord',
      }).returning()
      const originalCustomer = ticket.customer
      const body = {
        action: 'identity' as const,
        ...common(ticket, uuid(714)),
        selection: { mode: 'existing' as const, vehicleId: vehicle.id },
      }
      const result = await correctTicket(golden.db, {
        actor: golden.actors.owner,
        ticketId: ticket.id,
        body,
      })
      expect(result).toMatchObject({
        ok: true,
        outcome: 'changed',
        scope: 'identity',
        ticket: { customer: { id: customer.id }, vehicle: { id: vehicle.id } },
      })
      if (!originalCustomer) throw new Error('original customer missing')
      const [stillOriginal] = await golden.db.select().from(customers)
        .where(eq(customers.id, originalCustomer.id))
      expect(stillOriginal.name).toBe(originalCustomer.name)
      await expect(correctTicket(golden.db, {
        actor: golden.actors.owner, ticketId: ticket.id, body,
      })).resolves.toMatchObject({ ok: true, outcome: 'replayed', changed: false, scope: 'identity' })
      if (!result.ok) return
      await expect(correctTicket(golden.db, {
        actor: golden.actors.owner,
        ticketId: ticket.id,
        body: {
          action: 'identity',
          ...common(result.ticket, uuid(727)),
          selection: { mode: 'existing', vehicleId: vehicle.id },
        },
      })).resolves.toMatchObject({ ok: true, outcome: 'unchanged', changed: false, scope: 'identity' })
      expect(await golden.db.select().from(ticketActivity)).toHaveLength(1)

      const [otherShop] = await golden.db.insert(shops).values({ name: 'Other Shop' }).returning()
      const [otherCustomer] = await golden.db.insert(customers).values({
        shopId: otherShop.id, name: 'Hidden Customer', phone: '202-555-0188',
      }).returning()
      const [otherVehicle] = await golden.db.insert(vehicles).values({
        customerId: otherCustomer.id, year: 2022, make: 'Hidden', model: 'Vehicle',
      }).returning()
      await expect(correctTicket(golden.db, {
        actor: golden.actors.owner,
        ticketId: ticket.id,
        body: {
          action: 'identity',
          ...common(result.ticket, uuid(715)),
          selection: { mode: 'existing', vehicleId: otherVehicle.id },
        },
      })).resolves.toEqual({ ok: false, error: 'not_found' })
    } finally {
      await golden.close()
    }
  })

  it('creates a new same-shop identity pair without mutating the old customer or vehicle', async () => {
    vi.stubEnv('SHOP_OS_TICKET_CORRECTION_ENABLED', 'true')
    const golden = await createGoldenShopDay()
    try {
      const ticket = await seedTicket(golden)
      if (!ticket.customer || !ticket.vehicle) throw new Error('identity fixture missing')
      const [oldCustomer] = await golden.db.select().from(customers)
        .where(eq(customers.id, ticket.customer.id))
      const [oldVehicle] = await golden.db.select().from(vehicles)
        .where(eq(vehicles.id, ticket.vehicle.id))
      const result = await correctTicket(golden.db, {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: {
          action: 'identity',
          ...common(ticket, uuid(726)),
          selection: {
            mode: 'new',
            customer: {
              name: 'New Repair Order Customer',
              phone: '202-555-0177',
              email: null,
            },
            vehicle: {
              year: 2022,
              make: 'Toyota',
              model: 'Camry',
              engine: null,
              vin: null,
              mileage: 22_000,
              plate: 'NEW-177',
            },
          },
        },
      })
      expect(result).toMatchObject({ ok: true, outcome: 'changed', scope: 'identity' })
      if (!result.ok) return
      expect(result.ticket.customer?.id).not.toBe(ticket.customer.id)
      expect(result.ticket.vehicle?.id).not.toBe(ticket.vehicle.id)
      expect((await golden.db.select().from(customers).where(eq(customers.id, oldCustomer.id)))[0])
        .toEqual(oldCustomer)
      expect((await golden.db.select().from(vehicles).where(eq(vehicles.id, oldVehicle.id)))[0])
        .toEqual(oldVehicle)
    } finally {
      await golden.close()
    }
  })

  it('keeps an exact new-identity no-op receipt, version, link, and facts untouched', async () => {
    vi.stubEnv('SHOP_OS_TICKET_CORRECTION_ENABLED', 'true')
    const golden = await createGoldenShopDay()
    try {
      const ticket = await seedTicket(golden, { priced: true })
      if (!ticket.customer || !ticket.vehicle) throw new Error('identity fixture missing')
      const version = await prepareVersion(golden, ticket.id)
      await addActionableLink(golden, ticket.id, version.id, uuid(764))
      const before = await correctionState(golden, ticket.id)
      const beforeFactWrite = vi.fn(async () => {})

      await expect(correctTicket(golden.db, {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: {
          action: 'identity',
          ...common(before.ticket, uuid(765)),
          expectedActiveVersionId: version.id,
          selection: {
            mode: 'new',
            customer: {
              name: ticket.customer.name,
              phone: ticket.customer.phone,
              email: ticket.customer.email,
            },
            vehicle: {
              year: ticket.vehicle.year,
              make: ticket.vehicle.make,
              model: ticket.vehicle.model,
              engine: ticket.vehicle.engine,
              vin: ticket.vehicle.vin,
              mileage: ticket.vehicle.mileage,
              plate: ticket.vehicle.plate,
            },
          },
        },
      }, { beforeFactWrite })).resolves.toMatchObject({
        ok: true,
        outcome: 'unchanged',
        changed: false,
        scope: 'identity',
        invalidatedVersionNumber: null,
      })
      expect(beforeFactWrite).not.toHaveBeenCalled()
      expect(await correctionState(golden, ticket.id)).toEqual(before)
    } finally {
      await golden.close()
    }
  })

  it('edits only safe job facts while preserving assignment and skill tier', async () => {
    vi.stubEnv('SHOP_OS_TICKET_CORRECTION_ENABLED', 'true')
    const golden = await createGoldenShopDay()
    try {
      const ticket = await seedTicket(golden)
      const before = await storedJob(golden, ticket.jobs[0].id)
      const body = {
        action: 'job' as const,
        ...common(ticket, uuid(716)),
        jobId: before.id,
        expectedJobUpdatedAt: before.updatedAt.toISOString(),
        title: 'Replace front brake pads',
        kind: 'maintenance' as const,
        customerSuppliedPartsNote: 'Customer supplied sealed pads',
      }
      const result = await correctTicket(golden.db, {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body,
      })
      expect(result).toMatchObject({ ok: true, outcome: 'changed', scope: 'job' })
      const after = await storedJob(golden, before.id)
      expect(after).toMatchObject({
        title: 'Replace front brake pads',
        kind: 'maintenance',
        customerSuppliedPartsNote: 'Customer supplied sealed pads',
        assignedTechId: before.assignedTechId,
        requiredSkillTier: before.requiredSkillTier,
      })
      await expect(correctTicket(golden.db, {
        actor: golden.actors.advisor, ticketId: ticket.id, body,
      })).resolves.toMatchObject({ ok: true, outcome: 'replayed', changed: false, scope: 'job' })
      if (!result.ok) return
      await expect(correctTicket(golden.db, {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: {
          ...body,
          ...common(result.ticket, uuid(728)),
          expectedJobUpdatedAt: after.updatedAt.toISOString(),
        },
      })).resolves.toMatchObject({ ok: true, outcome: 'unchanged', changed: false, scope: 'job' })
      expect(await golden.db.select().from(ticketActivity)).toHaveLength(1)
    } finally {
      await golden.close()
    }
  })

  it('keeps the last job but history-preserves removal when another active job remains', async () => {
    vi.stubEnv('SHOP_OS_TICKET_CORRECTION_ENABLED', 'true')
    const golden = await createGoldenShopDay()
    try {
      const single = await seedTicket(golden)
      const target = await storedJob(golden, single.jobs[0].id)
      await golden.db.insert(jobLines).values({
        id: uuid(704), shopId: golden.shop.id, jobId: target.id,
        kind: 'fee', description: 'Preserved line', sort: 0,
        quantity: 1, priceCents: 1_000, taxable: false,
      })
      await expect(correctTicket(golden.db, {
        actor: golden.actors.advisor,
        ticketId: single.id,
        body: {
          action: 'remove_job',
          ...common(single, uuid(717)),
          jobId: target.id,
          expectedJobUpdatedAt: target.updatedAt.toISOString(),
        },
      })).resolves.toEqual({ ok: false, error: 'last_job' })

      await golden.db.insert(ticketJobs).values({
        id: uuid(703), shopId: golden.shop.id, ticketId: single.id,
        title: 'Rotate tires', kind: 'maintenance', requiredSkillTier: 1,
      })
      const freshTicket = await storedTicket(golden, single.id)
      const body = {
        action: 'remove_job' as const,
        ...common(freshTicket, uuid(718)),
        jobId: target.id,
        expectedJobUpdatedAt: target.updatedAt.toISOString(),
      }
      const result = await correctTicket(golden.db, {
        actor: golden.actors.advisor,
        ticketId: single.id,
        body,
      })
      expect(result).toMatchObject({ ok: true, outcome: 'changed', scope: 'job_removed' })
      expect((await storedJob(golden, target.id)).workStatus).toBe('canceled')
      expect(await golden.db.select().from(ticketJobs).where(eq(ticketJobs.id, target.id))).toHaveLength(1)
      expect(await golden.db.select().from(jobLines).where(eq(jobLines.jobId, target.id))).toEqual([
        expect.objectContaining({ id: uuid(704), description: 'Preserved line' }),
      ])
      await expect(correctTicket(golden.db, {
        actor: golden.actors.advisor, ticketId: single.id, body,
      })).resolves.toMatchObject({ ok: true, outcome: 'replayed', changed: false, scope: 'job_removed' })
      expect(await golden.db.select().from(ticketActivity)).toEqual([
        expect.objectContaining({
          jobId: target.id,
          payload: expect.objectContaining({ scope: 'job_removed', changedFields: ['work_status'] }),
        }),
      ])
    } finally {
      await golden.close()
    }
  })

  it('refuses global and target correction once work crosses the open/session boundary', async () => {
    vi.stubEnv('SHOP_OS_TICKET_CORRECTION_ENABLED', 'true')
    const golden = await createGoldenShopDay()
    try {
      const ticket = await seedTicket(golden)
      const target = await storedJob(golden, ticket.jobs[0].id)
      await golden.db.update(ticketJobs).set({ workStatus: 'in_progress' }).where(eq(ticketJobs.id, target.id))
      await expect(correctTicket(golden.db, {
        actor: golden.actors.owner,
        ticketId: ticket.id,
        body: {
          action: 'concern', ...common(ticket, uuid(719)), concern: 'Unsafe global edit',
        },
      })).resolves.toEqual({ ok: false, error: 'job_not_open' })
      await expect(correctTicket(golden.db, {
        actor: golden.actors.owner,
        ticketId: ticket.id,
        body: {
          action: 'job',
          ...common(ticket, uuid(720)),
          jobId: target.id,
          expectedJobUpdatedAt: target.updatedAt.toISOString(),
          title: 'Unsafe edit',
          kind: 'repair',
          customerSuppliedPartsNote: null,
        },
      })).resolves.toEqual({ ok: false, error: 'job_not_open' })
    } finally {
      await golden.close()
    }
  })

  it.each(['session-linked', 'initializing', 'ambiguous'] as const)(
    'refuses ticket-wide and target correction for %s work with zero mutation',
    async (unsafeState) => {
      vi.stubEnv('SHOP_OS_TICKET_CORRECTION_ENABLED', 'true')
      const golden = await createGoldenShopDay()
      try {
        const ticket = await seedTicket(golden)
        const job = await storedJob(golden, ticket.jobs[0].id)
        if (unsafeState === 'session-linked') {
          const sessionId = uuid(742)
          await golden.db.insert(sessions).values({
            id: sessionId,
            shopId: golden.shop.id,
            techId: golden.people.tech.id,
            vehicleId: ticket.vehicle?.id ?? null,
            intake: {
              vehicleYear: ticket.vehicle?.year ?? 2020,
              vehicleMake: ticket.vehicle?.make ?? 'Ford',
              vehicleModel: ticket.vehicle?.model ?? 'F-150',
              customerComplaint: ticket.concern,
            },
            treeState: {
              nodes: [{ id: 'root', label: 'Verify concern', status: 'active' }],
              currentNodeId: 'root',
              message: 'Begin inspection.',
            },
          })
          await golden.db.update(ticketJobs).set({
            kind: 'diagnostic',
            sessionId,
          }).where(eq(ticketJobs.id, job.id))
        } else {
          await golden.db.update(ticketJobs).set({
            kind: 'diagnostic',
            diagnosticStartState: unsafeState,
          }).where(eq(ticketJobs.id, job.id))
        }
        const lockedJob = await storedJob(golden, job.id)
        const before = await correctionState(golden, ticket.id)
        await expect(correctTicket(golden.db, {
          actor: golden.actors.owner,
          ticketId: ticket.id,
          body: concernBody(before.ticket, uuid(unsafeState === 'session-linked' ? 743 : unsafeState === 'initializing' ? 744 : 745)),
        })).resolves.toEqual({ ok: false, error: 'job_not_open' })
        await expect(correctTicket(golden.db, {
          actor: golden.actors.owner,
          ticketId: ticket.id,
          body: {
            action: 'job',
            ...common(before.ticket, uuid(unsafeState === 'session-linked' ? 746 : unsafeState === 'initializing' ? 747 : 748)),
            jobId: lockedJob.id,
            expectedJobUpdatedAt: lockedJob.updatedAt.toISOString(),
            title: 'Unsafe target correction',
            kind: lockedJob.kind,
            customerSuppliedPartsNote: null,
          },
        })).resolves.toEqual({ ok: false, error: 'job_not_open' })
        expect(await correctionState(golden, ticket.id)).toEqual(before)
      } finally {
        await golden.close()
      }
    },
  )

  it('rejects stale job and active-version expectations without changing facts or history', async () => {
    vi.stubEnv('SHOP_OS_TICKET_CORRECTION_ENABLED', 'true')
    const golden = await createGoldenShopDay()
    try {
      const ticket = await seedTicket(golden, { priced: true })
      const job = await storedJob(golden, ticket.jobs[0].id)
      const beforeJobConflict = await correctionState(golden, ticket.id)
      await expect(correctTicket(golden.db, {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: {
          action: 'job',
          ...common(ticket, uuid(749)),
          jobId: job.id,
          expectedJobUpdatedAt: new Date(job.updatedAt.getTime() - 1).toISOString(),
          title: 'Stale job correction',
          kind: 'repair',
          customerSuppliedPartsNote: null,
        },
      })).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
      expect(await correctionState(golden, ticket.id)).toEqual(beforeJobConflict)

      const version = await prepareVersion(golden, ticket.id)
      await addActionableLink(golden, ticket.id, version.id, uuid(750))
      const beforeVersionConflict = await correctionState(golden, ticket.id)
      await expect(correctTicket(golden.db, {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: concernBody(beforeVersionConflict.ticket, uuid(751), null),
      })).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
      expect(await correctionState(golden, ticket.id)).toEqual(beforeVersionConflict)
    } finally {
      await golden.close()
    }
  })

  it('rejects multiple active versions before invalidation with zero mutation', async () => {
    vi.stubEnv('SHOP_OS_TICKET_CORRECTION_ENABLED', 'true')
    const golden = await createGoldenShopDay()
    try {
      const ticket = await seedTicket(golden, { priced: true })
      const version = await prepareVersion(golden, ticket.id)
      await golden.db.insert(quoteVersions).values({
        id: uuid(752),
        shopId: golden.shop.id,
        ticketId: ticket.id,
        versionNumber: 2,
        snapshot: version.snapshot,
        createdByProfileId: golden.people.advisor.id,
      })
      await addActionableLink(golden, ticket.id, version.id, uuid(753))
      const before = await correctionState(golden, ticket.id)

      await expect(correctTicket(golden.db, {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: concernBody(before.ticket, uuid(754), version.id),
      })).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
      expect(await correctionState(golden, ticket.id)).toEqual(before)
    } finally {
      await golden.close()
    }
  })

  it('invalidates one active version atomically while preserving its snapshot bytes and expiring its link', async () => {
    vi.stubEnv('SHOP_OS_TICKET_CORRECTION_ENABLED', 'true')
    const golden = await createGoldenShopDay()
    try {
      const ticket = await seedTicket(golden, { priced: true })
      const version = await prepareVersion(golden, ticket.id)
      const snapshotBytes = JSON.stringify(version.snapshot)
      const sentAt = new Date(Date.now() - 60_000)
      const [link] = await golden.db.insert(quoteSends).values({
        shopId: golden.shop.id,
        ticketId: ticket.id,
        quoteVersionId: version.id,
        customerId: null,
        subjectKey: uuid(721),
        destinationFingerprint: 'a'.repeat(64),
        fingerprintKeyVersion: 'link_v1',
        channel: 'link',
        tokenHash: 'b'.repeat(64),
        tokenExpiresAt: new Date('2026-08-10T12:00:00.000Z'),
        requestingActorProfileId: golden.people.advisor.id,
        requestKey: uuid(722),
        requestFingerprint: 'c'.repeat(64),
        state: 'submitted',
        submittingAt: sentAt,
        submittedAt: sentAt,
        createdAt: sentAt,
        updatedAt: sentAt,
      }).returning()
      const result = await correctTicket(golden.db, {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: {
          action: 'concern',
          ...common(ticket, uuid(723)),
          expectedActiveVersionId: version.id,
          concern: 'Brake pedal sinks after warming up.',
        },
      })
      expect(result).toMatchObject({
        ok: true,
        outcome: 'changed',
        invalidatedVersionNumber: version.versionNumber,
      })
      const [storedVersion] = await golden.db.select().from(quoteVersions).where(eq(quoteVersions.id, version.id))
      const [storedLink] = await golden.db.select().from(quoteSends).where(eq(quoteSends.id, link.id))
      expect(storedVersion.supersededAt).not.toBeNull()
      expect(JSON.stringify(storedVersion.snapshot)).toBe(snapshotBytes)
      expect(storedLink).toMatchObject({ state: 'expired', tokenHash: null, tokenExpiresAt: null })
      const [receipt] = await golden.db.select().from(ticketActivity)
      expect(receipt.payload).toMatchObject({
        scope: 'concern',
        invalidatedVersionId: version.id,
        invalidatedVersionNumber: version.versionNumber,
      })
      expect((await storedJob(golden, ticket.jobs[0].id)).approvalState).toBe('pending_quote')
    } finally {
      await golden.close()
    }
  })

  it('rejects a schema-valid active snapshot whose customer story differs from locked job truth', async () => {
    vi.stubEnv('SHOP_OS_TICKET_CORRECTION_ENABLED', 'true')
    const golden = await createGoldenShopDay()
    try {
      const ticket = await seedTicket(golden, { priced: true })
      const version = await prepareVersion(golden, ticket.id)
      const corrupted = structuredClone(version.snapshot) as {
        jobs: Array<{
          customerStory: unknown
          storyMeta: unknown
        }>
      }
      corrupted.jobs[0].customerStory = {
        whatYouToldUs: 'Brake pedal feels soft.',
        whatWeFound: 'Front brake wear needs inspection.',
        howWeKnow: [],
        whatItMeansIfWaived: 'Braking performance may continue to worsen.',
        whatWeRecommend: 'Inspect the front brakes before further driving.',
      }
      corrupted.jobs[0].storyMeta = { source: 'manual' }
      await replaceVersionSnapshot(
        golden,
        version.id,
        corrupted as unknown as Record<string, unknown>,
      )

      const beforeTicket = await storedTicket(golden, ticket.id)
      const beforeJob = await storedJob(golden, ticket.jobs[0].id)
      const result = await correctTicket(golden.db, {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: {
          action: 'concern',
          ...common(beforeTicket, uuid(729)),
          expectedActiveVersionId: version.id,
          concern: 'This mutation must not commit.',
        },
      })

      expect(result).toEqual({ ok: false, error: 'conflict', retryable: false })
      expect(await storedTicket(golden, ticket.id)).toEqual(beforeTicket)
      expect(await storedJob(golden, ticket.jobs[0].id)).toEqual(beforeJob)
      const [stillActive] = await golden.db.select().from(quoteVersions)
        .where(eq(quoteVersions.id, version.id))
      expect(stillActive.supersededAt).toBeNull()
      expect(stillActive.snapshot).toEqual(corrupted)
      expect(await golden.db.select().from(ticketActivity)).toEqual([])
    } finally {
      await golden.close()
    }
  })

  it('rejects a schema-invalid active snapshot with zero fact or handoff mutation', async () => {
    vi.stubEnv('SHOP_OS_TICKET_CORRECTION_ENABLED', 'true')
    const golden = await createGoldenShopDay()
    try {
      const ticket = await seedTicket(golden, { priced: true })
      const version = await prepareVersion(golden, ticket.id)
      await replaceVersionSnapshot(golden, version.id, { broken: true })
      await addActionableLink(golden, ticket.id, version.id, uuid(766))
      const before = await correctionState(golden, ticket.id)

      await expect(correctTicket(golden.db, {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: concernBody(before.ticket, uuid(767), version.id),
      })).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
      expect(await correctionState(golden, ticket.id)).toEqual(before)
    } finally {
      await golden.close()
    }
  })

  it('rejects an active snapshot that omits one canonical eligible locked job', async () => {
    vi.stubEnv('SHOP_OS_TICKET_CORRECTION_ENABLED', 'true')
    const golden = await createGoldenShopDay()
    try {
      const ticket = await seedTicket(golden, { secondJob: true, priced: true })
      const secondJob = await storedJob(golden, uuid(701))
      await golden.db.insert(jobLines).values({
        id: uuid(730),
        shopId: golden.shop.id,
        jobId: secondJob.id,
        kind: 'fee',
        description: 'Tire rotation',
        sort: 0,
        quantity: 1,
        priceCents: 4_000,
        taxable: false,
        source: 'manual',
      })
      const version = await prepareVersion(golden, ticket.id)
      const snapshot = structuredClone(version.snapshot) as {
        jobs: Array<{ id: string }>
      }
      expect(snapshot.jobs).toHaveLength(2)
      const omittedJobId = snapshot.jobs[1].id
      snapshot.jobs = snapshot.jobs.slice(0, 1)
      const keptSubtotal = (version.snapshot as {
        jobs: Array<{ totals: { subtotalCents: number; taxableSubtotalCents: number } }>
      }).jobs[0].totals
      Object.assign(snapshot as object, {
        totals: {
          subtotalCents: keptSubtotal.subtotalCents,
          taxableSubtotalCents: keptSubtotal.taxableSubtotalCents,
          taxCents: 0,
          totalCents: keptSubtotal.subtotalCents,
        },
      })
      await replaceVersionSnapshot(
        golden,
        version.id,
        snapshot as unknown as Record<string, unknown>,
      )
      await addActionableLink(golden, ticket.id, version.id, uuid(731))
      const before = await correctionState(golden, ticket.id)
      expect(before.jobs.find((job) => job.id === omittedJobId)?.approvalState).toBe('quote_ready')

      const result = await correctTicket(golden.db, {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: {
          action: 'concern',
          ...common(before.ticket, uuid(732)),
          expectedActiveVersionId: version.id,
          concern: 'This incomplete snapshot must not be invalidated.',
        },
      })

      expect(result).toEqual({ ok: false, error: 'conflict', retryable: false })
      expect(await correctionState(golden, ticket.id)).toEqual(before)
    } finally {
      await golden.close()
    }
  })

  it('rejects an active snapshot containing an unknown job with zero mutation', async () => {
    vi.stubEnv('SHOP_OS_TICKET_CORRECTION_ENABLED', 'true')
    const golden = await createGoldenShopDay()
    try {
      const ticket = await seedTicket(golden, { priced: true })
      const version = await prepareVersion(golden, ticket.id)
      const snapshot = structuredClone(version.snapshot) as {
        jobs: Array<{ id: string }>
      }
      snapshot.jobs[0].id = uuid(755)
      await replaceVersionSnapshot(
        golden,
        version.id,
        snapshot as unknown as Record<string, unknown>,
      )
      await addActionableLink(golden, ticket.id, version.id, uuid(756))
      const before = await correctionState(golden, ticket.id)

      await expect(correctTicket(golden.db, {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: concernBody(before.ticket, uuid(757), version.id),
      })).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
      expect(await correctionState(golden, ticket.id)).toEqual(before)
    } finally {
      await golden.close()
    }
  })

  it.each([
    ['tickets', 'ticket'],
    ['ticket_jobs', 'job'],
    ['quote_versions', 'version'],
    ['profiles', 'actor'],
    ['quote_sends', 'link'],
  ] as const)('classifies exact %s NOWAIT contention as retryable and rolls back all state', async (
    table,
    _boundary,
  ) => {
    vi.stubEnv('SHOP_OS_TICKET_CORRECTION_ENABLED', 'true')
    const golden = await createGoldenShopDay()
    try {
      const ticket = await seedTicket(golden, { priced: true })
      const version = await prepareVersion(golden, ticket.id)
      await addActionableLink(golden, ticket.id, version.id, uuid(758))
      const before = await correctionState(golden, ticket.id)
      let injected = false
      const db = loggedDb(golden, (query) => {
        if (!injected
          && new RegExp(`from "${table}"`, 'i').test(query)
          && /for update nowait/i.test(query)) {
          injected = true
          throw Object.assign(new Error(`${table} row held`), { code: '55P03' })
        }
      })

      await expect(correctTicket(db, {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: concernBody(before.ticket, uuid(759), version.id),
      })).resolves.toEqual({ ok: false, error: 'conflict', retryable: true })
      expect(injected).toBe(true)
      expect(await correctionState(golden, ticket.id)).toEqual(before)
    } finally {
      await golden.close()
    }
  })

  it('executes canonical ticket-to-link NOWAIT lock order before fact mutation', async () => {
    vi.stubEnv('SHOP_OS_TICKET_CORRECTION_ENABLED', 'true')
    const golden = await createGoldenShopDay()
    try {
      const ticket = await seedTicket(golden, { priced: true })
      const version = await prepareVersion(golden, ticket.id)
      await addActionableLink(golden, ticket.id, version.id, uuid(760))
      const statements: string[] = []
      const db = loggedDb(golden, (query) => statements.push(query.replace(/\s+/g, ' ')))

      await expect(correctTicket(db, {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: concernBody(ticket, uuid(761), version.id),
      })).resolves.toMatchObject({ ok: true, outcome: 'changed' })

      const lockTables = statements
        .filter((query) => /for update nowait/i.test(query))
        .map((query) => [
          'tickets', 'ticket_jobs', 'job_lines', 'quote_versions',
          'profiles', 'ticket_activity', 'quote_sends',
        ].find((table) => new RegExp(`from "${table}"`, 'i').test(query)))
      expect(lockTables).toEqual([
        'tickets',
        'ticket_jobs',
        'job_lines',
        'quote_versions',
        'profiles',
        'ticket_activity',
        'quote_sends',
      ])
    } finally {
      await golden.close()
    }
  })

  it('rolls back a quote-version CAS miss after the link lock', async () => {
    vi.stubEnv('SHOP_OS_TICKET_CORRECTION_ENABLED', 'true')
    const golden = await createGoldenShopDay()
    try {
      const ticket = await seedTicket(golden, { priced: true })
      const version = await prepareVersion(golden, ticket.id)
      await addActionableLink(golden, ticket.id, version.id, uuid(762))
      const before = await correctionState(golden, ticket.id)
      let transactionDb: AppDb

      await expect(correctTicket(golden.db, {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: concernBody(before.ticket, uuid(763), version.id),
      }, {
        afterVersionLock: async (db) => { transactionDb = db },
        afterLinkLock: async () => {
          await transactionDb.update(quoteVersions)
            .set({ supersededAt: new Date('2026-08-03T12:00:00.000Z') })
            .where(eq(quoteVersions.id, version.id))
        },
      })).resolves.toEqual({ ok: false, error: 'conflict', retryable: true })
      expect(await correctionState(golden, ticket.id)).toEqual(before)
    } finally {
      await golden.close()
    }
  })

  it('advances ticket and job timestamps monotonically beyond persisted future milliseconds', async () => {
    vi.stubEnv('SHOP_OS_TICKET_CORRECTION_ENABLED', 'true')
    const golden = await createGoldenShopDay()
    try {
      const ticket = await seedTicket(golden)
      const future = new Date(Date.now() + 60_000)
      await golden.db.update(tickets).set({ updatedAt: future }).where(eq(tickets.id, ticket.id))
      await golden.db.update(ticketJobs).set({ updatedAt: future }).where(eq(ticketJobs.id, ticket.jobs[0].id))
      const result = await correctTicket(golden.db, {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: {
          action: 'job',
          requestKey: uuid(724),
          expectedTicketUpdatedAt: future.toISOString(),
          expectedActiveVersionId: null,
          jobId: ticket.jobs[0].id,
          expectedJobUpdatedAt: future.toISOString(),
          title: 'Inspect front brakes carefully',
          kind: 'repair',
          customerSuppliedPartsNote: null,
        },
      })
      expect(result).toMatchObject({ ok: true, outcome: 'changed' })
      expect((await storedTicket(golden, ticket.id)).updatedAt.getTime()).toBeGreaterThan(future.getTime())
      expect((await storedJob(golden, ticket.jobs[0].id)).updatedAt.getTime()).toBeGreaterThan(future.getTime())
    } finally {
      await golden.close()
    }
  })

  it('rolls new identity rows and quote invalidation back when the final-write seam fails', async () => {
    vi.stubEnv('SHOP_OS_TICKET_CORRECTION_ENABLED', 'true')
    const golden = await createGoldenShopDay()
    try {
      const ticket = await seedTicket(golden, { priced: true })
      const version = await prepareVersion(golden, ticket.id)
      const before = await storedTicket(golden, ticket.id)
      const customersBefore = await golden.db.select().from(customers)
      const vehiclesBefore = await golden.db.select().from(vehicles)
      await addActionableLink(golden, ticket.id, version.id, uuid(733))
      const stateBefore = await correctionState(golden, ticket.id)
      let rowsVisibleAtSeam: { customers: number; vehicles: number } | null = null
      let transactionDb: Parameters<NonNullable<TicketCorrectionDependencies['afterVersionLock']>>[0]
      const dependencies: TicketCorrectionDependencies = {
        afterVersionLock: async (db) => { transactionDb = db },
        beforeFactWrite: async () => {
          rowsVisibleAtSeam = {
            customers: (await transactionDb.select().from(customers)
              .where(eq(customers.phone, '202-555-0166'))).length,
            vehicles: (await transactionDb.select().from(vehicles)
              .where(eq(vehicles.plate, 'ROLLBACK'))).length,
          }
          throw new Error('forced final-write failure')
        },
      }
      await expect(correctTicket(golden.db, {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: {
          action: 'identity',
          ...common(before, uuid(725)),
          expectedActiveVersionId: version.id,
          selection: {
            mode: 'new',
            customer: {
              name: 'Rolled Back Customer',
              phone: '202-555-0166',
              email: null,
            },
            vehicle: {
              year: 2023,
              make: 'Honda',
              model: 'Civic',
              engine: null,
              vin: null,
              mileage: null,
              plate: 'ROLLBACK',
            },
          },
        },
      }, dependencies)).rejects.toThrow('forced final-write failure')
      expect(rowsVisibleAtSeam).toEqual({ customers: 0, vehicles: 0 })
      expect(await storedTicket(golden, ticket.id)).toMatchObject({
        customerId: before.customerId,
        vehicleId: before.vehicleId,
        concern: before.concern,
      })
      expect(await golden.db.select().from(customers)).toEqual(customersBefore)
      expect(await golden.db.select().from(vehicles)).toEqual(vehiclesBefore)
      const [stillActive] = await golden.db.select().from(quoteVersions).where(eq(quoteVersions.id, version.id))
      expect(stillActive.supersededAt).toBeNull()
      expect(await golden.db.select().from(ticketActivity)).toEqual([])
      expect(await correctionState(golden, ticket.id)).toEqual(stateBefore)
    } finally {
      await golden.close()
    }
  })
})
