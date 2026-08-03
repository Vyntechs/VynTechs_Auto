import { eq, sql } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
      await golden.db.execute(sql`alter table quote_versions disable trigger quote_versions_immutable_update`)
      await golden.db.update(quoteVersions)
        .set({ snapshot: corrupted as unknown as Record<string, unknown> })
        .where(eq(quoteVersions.id, version.id))
      await golden.db.execute(sql`alter table quote_versions enable trigger quote_versions_immutable_update`)

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
      const dependencies: TicketCorrectionDependencies = {
        beforeFactWrite: async () => { throw new Error('forced final-write failure') },
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
    } finally {
      await golden.close()
    }
  })
})
