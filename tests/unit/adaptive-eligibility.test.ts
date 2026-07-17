import { eq } from 'drizzle-orm'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  adaptiveMutationDependencies,
  adaptiveRequestFingerprint,
  authorizeAdaptiveMutation,
  authorizeAdaptiveMutationInLockedScopeV1,
  type AdaptiveMutationActor,
} from '@/lib/diagnostics/adaptive/actor'
import {
  getAdaptiveEligibility,
} from '@/lib/diagnostics/adaptive/eligibility'
import { isAdaptiveCanvasEnabled } from '@/lib/feature-flags'
import {
  profiles,
  sessions,
  shops,
  stripeCustomers,
  ticketJobs,
  tickets,
} from '@/lib/db/schema'
import { createTestDb, type TestDb } from '@/tests/helpers/db'
import { runBoundedShopOsMutationV1 } from '@/lib/shop-os/continuity/mutation-foundation/transaction-runner'

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

const treeState = {
  nodes: [{ id: 'root', label: 'Verify the concern', status: 'active' as const }],
  currentNodeId: 'root',
  message: 'Begin with a visual inspection.',
}

describe('adaptive diagnostic eligibility', () => {
  let db: TestDb
  let close: () => Promise<void>
  let actor: AdaptiveMutationActor
  let otherActor: AdaptiveMutationActor
  let otherShopId: string
  let sessionId: string
  let ticketId: string
  let jobId: string

  beforeEach(async () => {
    vi.stubEnv('SHOP_OS_ADAPTIVE_CANVAS_ENABLED', 'true')
    ;({ db, close } = await createTestDb())

    const [shop, otherShop] = await db.insert(shops).values([
      { id: uuid(1), name: 'North Shop' },
      { id: uuid(2), name: 'South Shop' },
    ]).returning()
    otherShopId = otherShop.id

    const [tech, otherTech] = await db.insert(profiles).values([
      {
        id: uuid(10),
        userId: uuid(20),
        shopId: shop.id,
        fullName: 'Taylor Tech',
        role: 'tech',
        skillTier: 2,
      },
      {
        id: uuid(11),
        userId: uuid(21),
        shopId: shop.id,
        fullName: 'Terry Tech',
        role: 'tech',
        skillTier: 3,
      },
    ]).returning()
    actor = { userId: tech.userId, profileId: tech.id, shopId: shop.id }
    otherActor = {
      userId: otherTech.userId,
      profileId: otherTech.id,
      shopId: shop.id,
    }

    const [session] = await db.insert(sessions).values({
      id: uuid(30),
      shopId: shop.id,
      techId: tech.id,
      intake: {
        vehicleYear: 2018,
        vehicleMake: 'Ford',
        vehicleModel: 'F-150',
        customerComplaint: 'Intermittent no-start',
      },
      treeState,
    }).returning()
    sessionId = session.id

    const [ticket] = await db.insert(tickets).values({
      id: uuid(40),
      shopId: shop.id,
      ticketNumber: 1,
      source: 'tech_quick',
      concern: 'Intermittent no-start',
      createdByProfileId: tech.id,
    }).returning()
    ticketId = ticket.id

    const [job] = await db.insert(ticketJobs).values({
      id: uuid(50),
      shopId: shop.id,
      ticketId: ticket.id,
      title: 'Diagnose no-start',
      kind: 'diagnostic',
      requiredSkillTier: 2,
      assignedTechId: tech.id,
      claimedAt: new Date('2026-07-11T12:00:00Z'),
      sessionId: session.id,
      workStatus: 'in_progress',
      diagnosticStartState: 'ready',
    }).returning()
    jobId = job.id
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await close()
  })

  it('enables only the exact true flag value', () => {
    for (const value of ['', 'TRUE', '1', ' true', 'false']) {
      vi.stubEnv('SHOP_OS_ADAPTIVE_CANVAS_ENABLED', value)
      expect(isAdaptiveCanvasEnabled()).toBe(false)
    }
    vi.stubEnv('SHOP_OS_ADAPTIVE_CANVAS_ENABLED', 'true')
    expect(isAdaptiveCanvasEnabled()).toBe(true)
  })

  it('fails closed before reading eligibility when the flag is off', async () => {
    vi.stubEnv('SHOP_OS_ADAPTIVE_CANVAS_ENABLED', 'false')
    await expect(getAdaptiveEligibility(db, {
      sessionId,
      shopId: actor.shopId,
    })).resolves.toEqual({ eligible: false, reason: 'flag_off' })
  })

  it('fails mutation authorization before entitlement work when the flag is off', async () => {
    vi.stubEnv('SHOP_OS_ADAPTIVE_CANVAS_ENABLED', 'false')
    const hasPaidAccess = vi.fn().mockResolvedValue(true)

    await expect(authorizeAdaptiveMutation(db, {
      actor,
      sessionId,
      expectedRevision: 0,
    }, { hasPaidAccess })).resolves.toBeNull()
    expect(hasPaidAccess).not.toHaveBeenCalled()
  })

  it('allows only the tenant-scoped linked diagnostic session', async () => {
    await expect(getAdaptiveEligibility(db, {
      sessionId,
      shopId: actor.shopId,
    })).resolves.toEqual({ eligible: true, jobId, ticketId })

    await expect(getAdaptiveEligibility(db, {
      sessionId,
      shopId: otherShopId,
    })).resolves.toEqual({ eligible: false, reason: 'not_ticket_backed' })

    const [legacySession] = await db.insert(sessions).values({
      shopId: actor.shopId,
      techId: actor.profileId,
      intake: {
        vehicleYear: 2008,
        vehicleMake: 'Honda',
        vehicleModel: 'Civic',
        customerComplaint: 'Legacy complaint',
      },
      treeState,
    }).returning()
    await expect(getAdaptiveEligibility(db, {
      sessionId: legacySession.id,
      shopId: actor.shopId,
    })).resolves.toEqual({ eligible: false, reason: 'not_ticket_backed' })
  })

  it('rejects a linked non-diagnostic job defensively', async () => {
    await db.execute('alter table ticket_jobs drop constraint ticket_jobs_session_only_for_diagnostic')
    await db.update(ticketJobs).set({ kind: 'repair' }).where(eq(ticketJobs.id, jobId))

    await expect(getAdaptiveEligibility(db, {
      sessionId,
      shopId: actor.shopId,
    })).resolves.toEqual({ eligible: false, reason: 'not_diagnostic' })
  })

  it.each([
    ['terminal session', async (db: TestDb, ids: { sessionId: string }) => {
      await db.update(sessions).set({ status: 'closed' }).where(eq(sessions.id, ids.sessionId))
    }],
    ['terminal job', async (db: TestDb, ids: { jobId: string }) => {
      await db.update(ticketJobs).set({ workStatus: 'done' }).where(eq(ticketJobs.id, ids.jobId))
    }],
    ['terminal ticket', async (db: TestDb, ids: { ticketId: string }) => {
      await db.update(tickets).set({
        status: 'closed',
        closedAt: new Date('2026-07-11T12:05:00.000Z'),
        closedByProfileId: actor.profileId,
        closeDisposition: 'no_repair',
        closeNote: 'Fixture terminal-state proof.',
      }).where(eq(tickets.id, ids.ticketId))
    }],
  ])('rejects a %s', async (_name, mutate) => {
    await mutate(db, { sessionId, jobId, ticketId })
    await expect(getAdaptiveEligibility(db, {
      sessionId,
      shopId: actor.shopId,
    })).resolves.toEqual({ eligible: false, reason: 'not_open' })
  })

  const paid = { hasPaidAccess: async () => true }

  const lockedAuthorize = async (profileIds: string[] = [actor.profileId]) =>
    runBoundedShopOsMutationV1(db, {
      discover: async () => ({
        lockRequest: {
          shopId: actor.shopId,
          actorProfileId: actor.profileId,
          profileIds,
          lockShop: false,
          customerIds: [], vehicleIds: [], ticketIds: [ticketId], jobIds: [jobId],
          includeAllJobsForTickets: true,
          includeAllLinesForJobs: true,
          includeAllQuoteVersionsForTickets: true,
          includeAllQuoteEventsForTickets: true,
          sessionIds: [sessionId], sessionEventIds: [], vendorAccountIds: [], cannedJobIds: [],
          receiptRequestKey: null,
          receiptConditionalInsert: null,
          insertionIntents: { sessions: [], customers: [], vehicles: [], tickets: [], jobs: [] },
        },
        payload: undefined,
      }),
      executeLocked: async (tx, scope) => authorizeAdaptiveMutationInLockedScopeV1(
        tx, scope, { actor, sessionId, expectedRevision: 0 },
      ),
    })

  it('keeps locked adaptive authority query-free', () => {
    const source = readFileSync('lib/diagnostics/adaptive/actor.ts', 'utf8')
    const predicate = source.slice(
      source.indexOf('export function authorizeAdaptiveMutationInLockedScopeV1'),
      source.indexOf('function canonicalJson'),
    )
    expect(predicate).not.toContain('.select(')
    expect(predicate).not.toContain('.from(')
    expect(predicate).not.toContain('await ')
  })

  it('authorizes from the live locked graph and enforces technician tier', async () => {
    await expect(lockedAuthorize()).resolves.toEqual({ sessionId, jobId, revision: 0 })
    await db.update(ticketJobs).set({ requiredSkillTier: 3 }).where(eq(ticketJobs.id, jobId))
    await expect(lockedAuthorize()).resolves.toBeNull()
  })

  it.each(['tech', 'advisor', 'parts', 'owner'] as const)(
    'preserves adaptive authorization for an active non-null-tier %s',
    async (role) => {
      await db.update(profiles).set({ role }).where(eq(profiles.id, actor.profileId))

      await expect(authorizeAdaptiveMutation(db, {
        actor,
        sessionId,
        expectedRevision: 0,
      }, paid)).resolves.toEqual({ sessionId, jobId, revision: 0 })
      await expect(lockedAuthorize()).resolves.toEqual({ sessionId, jobId, revision: 0 })
    },
  )

  it('refuses an otherwise active actor whose skill tier is null', async () => {
    await db.update(profiles).set({ skillTier: null }).where(eq(profiles.id, actor.profileId))

    await expect(authorizeAdaptiveMutation(db, {
      actor,
      sessionId,
      expectedRevision: 0,
    }, paid)).resolves.toBeNull()
    await expect(lockedAuthorize()).resolves.toBeNull()
  })

  it.each([
    ['inactive actor', { deactivatedAt: new Date('2026-07-11T12:10:00Z') }],
    ['unsupported actor role', { role: 'customer' }],
  ])('refuses an %s before locked adaptive authorization', async (_name, patch) => {
    await db.update(profiles).set(patch).where(eq(profiles.id, actor.profileId))

    await expect(authorizeAdaptiveMutation(db, {
      actor,
      sessionId,
      expectedRevision: 0,
    }, paid)).resolves.toBeNull()
    await expect(lockedAuthorize()).rejects.toThrow()
  })

  it('does not invalidate sound history when a non-actor referenced profile is deactivated', async () => {
    await db.update(profiles).set({ deactivatedAt: new Date() })
      .where(eq(profiles.id, otherActor.profileId))
    await expect(lockedAuthorize([actor.profileId, otherActor.profileId]))
      .resolves.toEqual({ sessionId, jobId, revision: 0 })
  })

  it('authorizes a paid active current session tech and job assignee at the live revision', async () => {
    await db.update(sessions).set({ adaptiveRevision: 7 }).where(eq(sessions.id, sessionId))

    await expect(authorizeAdaptiveMutation(db, {
      actor,
      sessionId,
      expectedRevision: 7,
    }, paid)).resolves.toEqual({ sessionId, jobId, revision: 7 })
  })

  it('rechecks paid access for every authorization attempt', async () => {
    const hasPaidAccess = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const input = { actor, sessionId, expectedRevision: 0 }

    await expect(authorizeAdaptiveMutation(db, input, { hasPaidAccess })).resolves.toEqual({
      sessionId,
      jobId,
      revision: 0,
    })
    await expect(authorizeAdaptiveMutation(db, input, { hasPaidAccess })).resolves.toBeNull()
    expect(hasPaidAccess).toHaveBeenCalledTimes(2)
    expect(hasPaidAccess).toHaveBeenNthCalledWith(1, db, actor.userId)
    expect(hasPaidAccess).toHaveBeenNthCalledWith(2, db, actor.userId)
  })

  it('fails closed when the entitlement source cannot answer', async () => {
    await expect(authorizeAdaptiveMutation(db, {
      actor,
      sessionId,
      expectedRevision: 0,
    }, {
      hasPaidAccess: async () => {
        throw new Error('entitlement unavailable')
      },
    })).resolves.toBeNull()
  })

  it('uses the same production entitlement source as the paywall', async () => {
    await db.insert(stripeCustomers).values({
      shopId: actor.shopId,
      stripeCustomerId: 'cus_adaptive',
      subscriptionStatus: 'active',
    })
    await expect(adaptiveMutationDependencies.hasPaidAccess(db, actor.userId)).resolves.toBe(true)

    await db.update(stripeCustomers).set({ subscriptionStatus: 'unpaid' })
      .where(eq(stripeCustomers.shopId, actor.shopId))
    await expect(adaptiveMutationDependencies.hasPaidAccess(db, actor.userId)).resolves.toBe(false)
  })

  it.each([
    ['unpaid actor', async (db: TestDb) => undefined, { hasPaidAccess: async () => false }],
    ['pending member', async (db: TestDb, ctx: { actor: AdaptiveMutationActor }) => {
      await db.update(profiles).set({
        membershipStatus: 'pending',
        membershipActivatedAt: null,
      }).where(eq(profiles.id, ctx.actor.profileId))
    }, paid],
    ['deactivated member', async (db: TestDb, ctx: { actor: AdaptiveMutationActor }) => {
      await db.update(profiles).set({ deactivatedAt: new Date() })
        .where(eq(profiles.id, ctx.actor.profileId))
    }, paid],
    ['non-shop role', async (db: TestDb, ctx: { actor: AdaptiveMutationActor }) => {
      await db.update(profiles).set({ role: 'customer' })
        .where(eq(profiles.id, ctx.actor.profileId))
    }, paid],
    ['other tenant', async () => undefined, paid],
    ['other session technician', async () => undefined, paid],
    ['reassigned job', async (db: TestDb, ctx: { otherActor: AdaptiveMutationActor; jobId: string }) => {
      await db.update(ticketJobs).set({ assignedTechId: ctx.otherActor.profileId })
        .where(eq(ticketJobs.id, ctx.jobId))
    }, paid],
    ['repair job', async (db: TestDb, ctx: { jobId: string }) => {
      await db.execute('alter table ticket_jobs drop constraint ticket_jobs_session_only_for_diagnostic')
      await db.update(ticketJobs).set({ kind: 'repair' }).where(eq(ticketJobs.id, ctx.jobId))
    }, paid],
    ['terminal session', async (db: TestDb, ctx: { sessionId: string }) => {
      await db.update(sessions).set({ status: 'deferred' }).where(eq(sessions.id, ctx.sessionId))
    }, paid],
    ['terminal job', async (db: TestDb, ctx: { jobId: string }) => {
      await db.update(ticketJobs).set({ workStatus: 'canceled' }).where(eq(ticketJobs.id, ctx.jobId))
    }, paid],
    ['closed ticket', async (db: TestDb, ctx: { ticketId: string }) => {
      await db.update(tickets).set({
        status: 'closed',
        closedAt: new Date('2026-07-11T12:05:00.000Z'),
        closedByProfileId: actor.profileId,
        closeDisposition: 'no_repair',
        closeNote: 'Fixture terminal-state proof.',
      }).where(eq(tickets.id, ctx.ticketId))
    }, paid],
    ['stale revision', async (db: TestDb, ctx: { sessionId: string }) => {
      await db.update(sessions).set({ adaptiveRevision: 1 }).where(eq(sessions.id, ctx.sessionId))
    }, paid],
  ])('uniformly rejects a %s', async (name, mutate, dependencies) => {
    await mutate(db, { actor, otherActor, sessionId, jobId, ticketId })
    const inputActor = name === 'other tenant'
      ? { ...actor, shopId: otherShopId }
      : name === 'other session technician'
        ? otherActor
        : actor

    await expect(authorizeAdaptiveMutation(db, {
      actor: inputActor,
      sessionId,
      expectedRevision: 0,
    }, dependencies)).resolves.toBeNull()
  })
})

describe('adaptive request fingerprints', () => {
  it('is independent of object key order but preserves array order', () => {
    const first = adaptiveRequestFingerprint('mode', {
      expectedRevision: 3,
      mode: 'guided',
      nested: { beta: true, alpha: ['a', 'b'] },
    })
    const reordered = adaptiveRequestFingerprint('mode', {
      nested: { alpha: ['a', 'b'], beta: true },
      mode: 'guided',
      expectedRevision: 3,
    })
    const reversedArray = adaptiveRequestFingerprint('mode', {
      expectedRevision: 3,
      mode: 'guided',
      nested: { beta: true, alpha: ['b', 'a'] },
    })

    expect(first).toMatch(/^[a-f0-9]{64}$/)
    expect(reordered).toBe(first)
    expect(reversedArray).not.toBe(first)
  })

  it('hashes the mutation kind and the full normalized body', () => {
    const body = { requestKey: uuid(90), expectedRevision: 3, mode: 'guided' }
    const fingerprint = adaptiveRequestFingerprint('mode', body)

    expect(adaptiveRequestFingerprint('evidence', body)).not.toBe(fingerprint)
    expect(adaptiveRequestFingerprint('mode', { ...body, requestKey: uuid(91) })).not.toBe(fingerprint)
    expect(adaptiveRequestFingerprint('mode', { ...body, mode: 'manual' })).not.toBe(fingerprint)
    expect(adaptiveRequestFingerprint('mode', { ...body, expectedRevision: 4 })).not.toBe(fingerprint)
  })

  it.each([
    ['undefined', { expectedRevision: 0, mode: undefined }],
    ['non-finite number', { expectedRevision: Number.NaN, mode: 'guided' }],
    ['date object', { expectedRevision: 0, at: new Date() }],
    ['bigint', { expectedRevision: BigInt(0), mode: 'guided' }],
  ])('rejects %s outside strictly parsed JSON data', (_name, body) => {
    expect(() => adaptiveRequestFingerprint('mode', body)).toThrow(TypeError)
  })
})
