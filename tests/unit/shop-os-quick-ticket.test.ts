import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'

const quickAdapterSpies = vi.hoisted(() => ({
  hintReceiptPresence: vi.fn(),
  preflightIdentity: vi.fn(),
  preflightTemplate: vi.fn(),
}))

vi.mock(
  '@/lib/shop-os/continuity/mutation-foundation/receipts',
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import('@/lib/shop-os/continuity/mutation-foundation/receipts')
    >()
    quickAdapterSpies.hintReceiptPresence.mockImplementation(
      actual.hintMutationReceiptPresenceV1,
    )
    return {
      ...actual,
      hintMutationReceiptPresenceV1: quickAdapterSpies.hintReceiptPresence,
    }
  },
)

vi.mock('@/lib/intake/ticket-identity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/intake/ticket-identity')>()
  quickAdapterSpies.preflightIdentity.mockImplementation(
    actual.preflightTicketIntakeIdentityV1,
  )
  return {
    ...actual,
    preflightTicketIntakeIdentityV1: quickAdapterSpies.preflightIdentity,
  }
})

vi.mock('@/lib/shop-os/canned-jobs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/shop-os/canned-jobs')>()
  quickAdapterSpies.preflightTemplate.mockImplementation(actual.preflightStrictCannedJobV1)
  return {
    ...actual,
    preflightStrictCannedJobV1: quickAdapterSpies.preflightTemplate,
  }
})

import {
  createQuickTicket as createQuickTicketHandler,
  type QuickTicketDependencies,
} from '@/lib/intake/quick-ticket'
import {
  consumeCanonicalQuickReceiptRequestForCreationV1,
  parseQuickTicketRequestV1,
  type QuickTicketBodyV1,
} from '@/lib/intake/quick-ticket-contracts'
import {
  cannedJobs,
  customers,
  jobLines,
  profiles,
  quoteEvents,
  quoteVersions,
  sessions,
  shops,
  ticketMutationReceiptJobs,
  ticketMutationReceipts,
  ticketJobs,
  tickets,
  vehicles,
} from '@/lib/db/schema'
import * as schema from '@/lib/db/schema'
import type { AppDb } from '@/lib/db/queries'
import { createTicket, ticketDomainStatus, type TicketActor } from '@/lib/tickets'
import {
  consumeResolvedLockedQuickTemplateForCreationV1,
  createCannedJob,
  preflightStrictCannedJobV1,
  replaceCannedJob,
  resolveStrictCannedJobInLockedScopeV1,
  retireCannedJob,
} from '@/lib/shop-os/canned-jobs'
import type {
  MutationAttemptCapabilityV1,
  ResolvedLockedQuickTemplateV1,
  ResolvedQuickTemplateV1,
} from '@/lib/shop-os/continuity/mutation-foundation/contracts'
import type { MutationLockRequestV1 } from '@/lib/shop-os/continuity/mutation-foundation/lock-order'
import { runBoundedShopOsMutationV1 } from '@/lib/shop-os/continuity/mutation-foundation/transaction-runner'
import { createMutationFingerprintKeyringV1 } from '@/lib/shop-os/continuity/mutation-foundation/keyring'
import { calculateTicketTotals } from '@/lib/shop-os/quote-math'
import { getQuoteBuilder } from '@/lib/shop-os/quotes'
import { createTestDb, type TestDb } from '@/tests/helpers/db'

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

const testMutationKeyring = createMutationFingerprintKeyringV1({
  SHOP_OS_MUTATION_HMAC_ACTIVE_VERSION: '1',
  SHOP_OS_MUTATION_HMAC_KEYS_B64: `1:${Buffer.alloc(32, 17).toString('base64')}`,
})

const testMutationKeyringV2Only = createMutationFingerprintKeyringV1({
  SHOP_OS_MUTATION_HMAC_ACTIVE_VERSION: '2',
  SHOP_OS_MUTATION_HMAC_KEYS_B64: `2:${Buffer.alloc(32, 29).toString('base64')}`,
})

function createQuickTicket(
  db: AppDb,
  input: Parameters<typeof createQuickTicketHandler>[1],
  dependencies: QuickTicketDependencies = {},
) {
  return createQuickTicketHandler(db, input, {
    loadMutationKeyring: () => testMutationKeyring,
    ...dependencies,
  })
}

function deterministicQuickTicketId(shopId: string, profileId: string, clientKey: string): string {
  const bytes = createHash('sha256')
    .update('shop-os-quick-quote-ticket-v2\0')
    .update(shopId).update('\0')
    .update(profileId).update('\0')
    .update(clientKey)
    .digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x80
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function findStructuredDbError(error: unknown): Readonly<{
  code?: unknown
  constraint?: unknown
  message?: unknown
}> | null {
  let current = error
  for (let depth = 0; depth < 8; depth += 1) {
    if ((typeof current !== 'object' || current === null) && typeof current !== 'function') {
      return null
    }
    const candidate = current as {
      code?: unknown
      constraint?: unknown
      message?: unknown
      cause?: unknown
    }
    if (candidate.code !== undefined) return candidate
    current = candidate.cause
  }
  return null
}

describe('Task 7A Quick request contract', () => {
  it('strictly normalizes one owned public body and one opaque canonical receipt', () => {
    const caller = {
      vehicleMode: 'new' as const,
      customer: {
        name: '  Maria Lopez  ',
        phone: '  555-1234  ',
        email: '  maria@example.com  ',
      },
      vehicle: {
        year: 2018,
        make: '  Ford  ',
        model: '  F-150  ',
        engine: '  3.5L EcoBoost  ',
        vin: '  1FTEW1EP5JFC10001  ',
        mileage: 84_000,
        plate: '  ABC123  ',
      },
      clientKey: uuid(799).toUpperCase(),
      quote: {
        mode: 'manual' as const,
        kind: 'repair' as const,
        description: '  Replace boost hose  ',
      },
    }

    const parsed = parseQuickTicketRequestV1(caller)

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('Quick contract parse failed')
    expect(parsed.value.body).toEqual({
      vehicleMode: 'new',
      customer: {
        name: 'Maria Lopez',
        phone: '555-1234',
        email: 'maria@example.com',
      },
      vehicle: {
        year: 2018,
        make: 'Ford',
        model: 'F-150',
        engine: '3.5L EcoBoost',
        vin: '1FTEW1EP5JFC10001',
        mileage: 84_000,
        plate: 'ABC123',
      },
      clientKey: uuid(799),
      quote: {
        mode: 'manual',
        kind: 'repair',
        description: 'Replace boost hose',
      },
    })
    expect(Object.isFrozen(parsed.value)).toBe(true)
    expect(Object.isFrozen(parsed.value.body)).toBe(true)
    if (parsed.value.body.vehicleMode !== 'new') throw new Error('expected new vehicle body')
    expect(Object.isFrozen(parsed.value.body.customer)).toBe(true)
    expect(Object.isFrozen(parsed.value.body.vehicle)).toBe(true)
    expect(Object.isFrozen(parsed.value.body.quote)).toBe(true)
    expect(Object.getPrototypeOf(parsed.value.receipt)).toBe(null)
    expect(Object.isFrozen(parsed.value.receipt)).toBe(true)
    expect(Reflect.ownKeys(parsed.value.receipt)).toEqual([])

    const consumed = consumeCanonicalQuickReceiptRequestForCreationV1(parsed.value.receipt)
    expect(consumed).toEqual({
      requestKey: uuid(799),
      body: parsed.value.body,
      base: {
        schemaVersion: 1,
        mutationKind: 'create_repair_order',
        target: {},
        candidates: [],
        payload: parsed.value.body,
      },
    })
    expect(Object.isFrozen(consumed)).toBe(true)
    expect(Object.isFrozen(consumed.body)).toBe(true)
    expect(Object.isFrozen(consumed.base)).toBe(true)
    expect(Object.isFrozen(consumed.base.target)).toBe(true)
    expect(Object.isFrozen(consumed.base.candidates)).toBe(true)
    expect(Object.isFrozen(consumed.base.payload)).toBe(true)
    expect('actorProfileId' in consumed.base).toBe(false)
    expect('operationOrigin' in consumed.base).toBe(false)
  })

  it('keeps canonical receipt truth isolated from caller, public-body, and consumer mutation', () => {
    const caller = {
      vehicleMode: 'existing' as const,
      existingVehicleId: uuid(600).toUpperCase(),
      mileage: 45_000,
      clientKey: uuid(601).toUpperCase(),
      quote: {
        mode: 'canned' as const,
        cannedJobId: uuid(602).toUpperCase(),
        expectedFingerprint: 'a'.repeat(64),
        expectedTaxRateBps: 825,
      },
    }
    const parsed = parseQuickTicketRequestV1(caller)
    if (!parsed.ok) throw new Error('Quick contract parse failed')
    caller.mileage = 99_999
    caller.quote.expectedFingerprint = 'b'.repeat(64)
    expect(() => {
      ;(parsed.value.body as { mileage: number }).mileage = 88_888
    }).toThrow()

    const first = consumeCanonicalQuickReceiptRequestForCreationV1(parsed.value.receipt)
    expect(() => {
      ;(first.body as { mileage: number }).mileage = 77_777
    }).toThrow()
    const second = consumeCanonicalQuickReceiptRequestForCreationV1(parsed.value.receipt)

    expect(second).not.toBe(first)
    expect(second.body).not.toBe(first.body)
    expect(second.base).not.toBe(first.base)
    expect(second).toEqual({
      requestKey: uuid(601),
      body: {
        vehicleMode: 'existing',
        existingVehicleId: uuid(600),
        mileage: 45_000,
        clientKey: uuid(601),
        quote: {
          mode: 'canned',
          cannedJobId: uuid(602),
          expectedFingerprint: 'a'.repeat(64),
          expectedTaxRateBps: 825,
        },
      },
      base: {
        schemaVersion: 1,
        mutationKind: 'create_repair_order',
        target: {},
        candidates: [],
        payload: {
          vehicleMode: 'existing',
          existingVehicleId: uuid(600),
          mileage: 45_000,
          clientKey: uuid(601),
          quote: {
            mode: 'canned',
            cannedJobId: uuid(602),
            expectedFingerprint: 'a'.repeat(64),
            expectedTaxRateBps: 825,
          },
        },
      },
    })
  })

  it('preserves strict Quick request acceptance and rejects forged receipt handles', () => {
    const valid: readonly unknown[] = [
      {
        vehicleMode: 'existing', existingVehicleId: uuid(610), mileage: null,
        clientKey: uuid(611),
        quote: { mode: 'manual', kind: 'maintenance', description: ' Rotate tires ' },
      },
      {
        vehicleMode: 'new',
        customer: { name: 'Ada', phone: '555-0101' },
        vehicle: { year: 2020, make: 'Honda', model: 'Civic' },
        clientKey: uuid(612),
        quote: {
          mode: 'canned', cannedJobId: uuid(613),
          expectedFingerprint: '0'.repeat(64), expectedTaxRateBps: null,
        },
      },
    ]
    for (const input of valid) expect(parseQuickTicketRequestV1(input).ok).toBe(true)

    const invalid = [
      null,
      { ...valid[0] as object, extra: true },
      { ...valid[0] as object, clientKey: 'bad' },
      { ...valid[0] as object, mileage: -1 },
      {
        ...valid[1] as object,
        quote: { mode: 'manual', kind: 'diagnostic', description: 'Inspect' },
      },
    ]
    for (const input of invalid) {
      expect(parseQuickTicketRequestV1(input)).toEqual({ ok: false, error: 'invalid_input' })
    }

    const forged = Object.freeze(Object.create(null))
    expect(() => consumeCanonicalQuickReceiptRequestForCreationV1(forged as never))
      .toThrow('canonical_quick_receipt_invalid')
  })
})

const quickBodyCompileGuard: QuickTicketBodyV1 = {
  vehicleMode: 'existing',
  existingVehicleId: uuid(620),
  clientKey: uuid(621),
  quote: { mode: 'manual', kind: 'repair', description: 'Inspect leak' },
}
void quickBodyCompileGuard

describe('createQuickTicket', () => {
  let db: TestDb
  let client: PGlite
  let close: () => Promise<void>
  let shopA: typeof shops.$inferSelect
  let shopB: typeof shops.$inferSelect
  let actor: TicketActor
  let crossShopActor: TicketActor
  let existingCustomer: typeof customers.$inferSelect
  let existingVehicle: typeof vehicles.$inferSelect
  let crossShopVehicle: typeof vehicles.$inferSelect
  let cannedJob: Awaited<ReturnType<typeof createCannedJob>> & { ok: true }
  let crossShopCannedJob: Awaited<ReturnType<typeof createCannedJob>> & { ok: true }

  beforeEach(async () => {
    quickAdapterSpies.hintReceiptPresence.mockClear()
    quickAdapterSpies.preflightIdentity.mockClear()
    quickAdapterSpies.preflightTemplate.mockClear()
    const created = await createTestDb()
    db = created.db
    client = created.client
    close = created.close

    const [firstShop, secondShop] = await db
      .insert(shops)
      .values([
        { name: 'North Shop', taxRateBps: 825 },
        { name: 'South Shop', taxRateBps: 700 },
      ])
      .returning()
    shopA = firstShop
    shopB = secondShop

    const [profile] = await db
      .insert(profiles)
      .values({
        userId: uuid(1),
        shopId: firstShop.id,
        role: 'owner',
        skillTier: 3,
        fullName: 'Owen Owner',
      })
      .returning()
    const [crossShopProfile] = await db.insert(profiles).values({
      userId: uuid(3), shopId: secondShop.id, role: 'owner', skillTier: 3, fullName: 'South Owner',
    }).returning()
    actor = {
      profileId: profile.id,
      shopId: profile.shopId,
      role: profile.role,
      skillTier: profile.skillTier,
      membershipStatus: profile.membershipStatus,
      deactivatedAt: profile.deactivatedAt,
    }
    crossShopActor = {
      profileId: crossShopProfile.id,
      shopId: crossShopProfile.shopId,
      role: crossShopProfile.role,
      skillTier: crossShopProfile.skillTier,
      membershipStatus: crossShopProfile.membershipStatus,
      deactivatedAt: crossShopProfile.deactivatedAt,
    }

    const [customerA, customerB] = await db
      .insert(customers)
      .values([
        { shopId: firstShop.id, name: 'Ada Driver', phone: '555-0101' },
        { shopId: secondShop.id, name: 'Cross Shop', phone: '555-0201' },
      ])
      .returning()
    existingCustomer = customerA
    ;[existingVehicle, crossShopVehicle] = await db
      .insert(vehicles)
      .values([
        {
          customerId: customerA.id,
          year: 2020,
          make: 'Honda',
          model: 'Civic',
          mileage: 42_000,
        },
        { customerId: customerB.id, year: 2021, make: 'Toyota', model: 'Camry' },
      ])
      .returning()

    const template = await createCannedJob(db, {
      actor: { profileId: profile.id },
      clientKey: uuid(700),
      body: {
        title: 'Brake service',
        kind: 'repair',
        defaultRequiredSkillTier: 2,
        sort: 10,
        lines: [
          { kind: 'part', description: 'Brake pads', sort: 10, quantity: '1.000', priceCents: 12_500, taxable: true, partNumber: 'PAD-1', brand: 'ACME' },
          { kind: 'labor', description: 'Install pads', sort: 20, hours: '1.25', priceCents: 18_750, taxable: false, laborRateCents: 15_000 },
          { kind: 'fee', description: 'Shop supplies', sort: 30, priceCents: 500, taxable: true },
        ],
      },
    })
    if (!template.ok) throw new Error('fixture template failed')
    cannedJob = template
    const crossTemplate = await createCannedJob(db, {
      actor: { profileId: crossShopProfile.id },
      clientKey: uuid(701),
      body: {
        title: 'South service', kind: 'repair', defaultRequiredSkillTier: 2, sort: 1,
        lines: [{ kind: 'fee', description: 'South fee', sort: 1, priceCents: 100, taxable: true }],
      },
    })
    if (!crossTemplate.ok) throw new Error('cross-shop fixture template failed')
    crossShopCannedJob = crossTemplate
  })

  afterEach(async () => {
    await close()
  })

  function newBody(overrides: Record<string, unknown> = {}) {
    return {
      vehicleMode: 'new',
      customer: {
        name: '  Maria Lopez  ',
        phone: '  555-1234  ',
        email: '  maria@example.com  ',
      },
      vehicle: {
        year: 2018,
        make: '  Ford  ',
        model: '  F-150  ',
        engine: '  3.5L EcoBoost  ',
        vin: '  1FTEW1EP5JFC10001  ',
        mileage: 84_000,
        plate: '  ABC123  ',
      },
      clientKey: uuid(800),
      quote: { mode: 'manual', kind: 'repair', description: '  Replace boost hose  ' },
      ...overrides,
    }
  }

  function existingBody(overrides: Record<string, unknown> = {}) {
    return {
      vehicleMode: 'existing',
      existingVehicleId: existingVehicle.id,
      clientKey: uuid(801),
      quote: { mode: 'manual', kind: 'maintenance', description: '  Rotate tires  ' },
      ...overrides,
    }
  }

  function cannedExistingBody(overrides: Record<string, unknown> = {}) {
    return existingBody({
      clientKey: uuid(802),
      quote: {
        mode: 'canned',
        cannedJobId: cannedJob.cannedJob.id,
        expectedFingerprint: cannedJob.cannedJob.fingerprint,
        expectedTaxRateBps: 825,
      },
      ...overrides,
    })
  }

  async function quickMutationState() {
    const [
      [shop],
      customerRows,
      vehicleRows,
      ticketRows,
      jobRows,
      lineRows,
      receiptRows,
      receiptJobRows,
      sessionRows,
      quoteVersionRows,
      quoteEventRows,
    ] = await Promise.all([
      db.select({ nextTicketNumber: shops.nextTicketNumber })
        .from(shops).where(eq(shops.id, shopA.id)),
      db.select().from(customers).orderBy(customers.id),
      db.select().from(vehicles).orderBy(vehicles.id),
      db.select().from(tickets).orderBy(tickets.id),
      db.select().from(ticketJobs).orderBy(ticketJobs.id),
      db.select().from(jobLines).orderBy(jobLines.id),
      db.select().from(ticketMutationReceipts).orderBy(ticketMutationReceipts.id),
      db.select().from(ticketMutationReceiptJobs)
        .orderBy(ticketMutationReceiptJobs.receiptId, ticketMutationReceiptJobs.ordinal),
      db.select().from(sessions).orderBy(sessions.id),
      db.select().from(quoteVersions).orderBy(quoteVersions.id),
      db.select().from(quoteEvents).orderBy(quoteEvents.id),
    ])
    return {
      nextTicketNumber: shop!.nextTicketNumber,
      customers: customerRows,
      vehicles: vehicleRows,
      tickets: ticketRows,
      jobs: jobRows,
      lines: lineRows,
      receipts: receiptRows,
      receiptJobs: receiptJobRows,
      sessions: sessionRows,
      quoteVersions: quoteVersionRows,
      quoteEvents: quoteEventRows,
    }
  }

  function cannedLockRequest(
    cannedJobIds: readonly string[],
    authority: Readonly<{ shopId: string; actorProfileId: string }> = {
      shopId: shopA.id,
      actorProfileId: actor.profileId,
    },
  ): MutationLockRequestV1 {
    return {
      shopId: authority.shopId,
      actorProfileId: authority.actorProfileId,
      profileIds: [authority.actorProfileId],
      lockShop: cannedJobIds.length > 0,
      customerIds: [],
      vehicleIds: [],
      ticketIds: [],
      jobIds: [],
      includeAllJobsForTickets: false,
      includeAllLinesForJobs: false,
      includeAllQuoteVersionsForTickets: false,
      includeAllQuoteEventsForTickets: false,
      sessionIds: [],
      sessionEventIds: [],
      vendorAccountIds: [],
      cannedJobIds,
      receiptRequestKey: null,
      receiptConditionalInsert: null,
      insertionIntents: {
        sessions: [], customers: [], vehicles: [], tickets: [], jobs: [],
      },
    }
  }

  async function runCannedCapability(
    input: {
      shopId: string
      cannedJobId: string
      expectedFingerprint: string
      expectedTaxRateBps: number | null
    },
    options: Readonly<{
      db?: TestDb
      mutateInputAfterCall?: () => void
      afterPreflight?: (tx: AppDb) => Promise<void>
      transformRequest?: (request: MutationLockRequestV1) => MutationLockRequestV1
      beforeResolve?: () => void
      afterResolve?: () => void
      inspectConsumers?: (
        first: ReturnType<typeof consumeResolvedLockedQuickTemplateForCreationV1>,
        second: ReturnType<typeof consumeResolvedLockedQuickTemplateForCreationV1>,
      ) => void
    }> = {},
  ) {
    let resolved: ResolvedQuickTemplateV1 | undefined
    let locked: ResolvedLockedQuickTemplateV1 | undefined
    let lockedTx: AppDb | undefined
    let lockedScope: Parameters<
      typeof consumeResolvedLockedQuickTemplateForCreationV1
    >[1] | undefined
    const result = await runBoundedShopOsMutationV1(options.db ?? db, {
      discover: async (tx, attempt) => {
        const pending = preflightStrictCannedJobV1(tx, attempt.capability, input)
        options.mutateInputAfterCall?.()
        const preflight = await pending
        if (preflight.ok) {
          resolved = preflight.template
          await options.afterPreflight?.(tx)
        }
        const request = cannedLockRequest(preflight.ok ? preflight.cannedJobIds : [])
        return {
          lockRequest: options.transformRequest?.(request) ?? request,
          payload: preflight,
        }
      },
      executeLocked: async (tx, scope, preflight) => {
        if (!preflight.ok) return preflight
        options.beforeResolve?.()
        const template = resolveStrictCannedJobInLockedScopeV1(
          tx,
          scope,
          preflight.template,
        )
        options.afterResolve?.()
        locked = template
        lockedTx = tx
        lockedScope = scope
        const value = consumeResolvedLockedQuickTemplateForCreationV1(tx, scope, template)
        if (options.inspectConsumers) {
          options.inspectConsumers(
            value,
            consumeResolvedLockedQuickTemplateForCreationV1(tx, scope, template),
          )
        }
        return Object.freeze({
          ok: true as const,
          value,
        })
      },
    })
    return { result, resolved, locked, lockedTx, lockedScope }
  }

  describe('opaque canned-template capability', () => {
    it('preflights one owned attempt handle and resolves one locked canonical copy', async () => {
      const input: {
        shopId: string
        cannedJobId: string
        expectedFingerprint: string
        expectedTaxRateBps: number | null
      } = {
        shopId: shopA.id.toUpperCase(),
        cannedJobId: cannedJob.cannedJob.id.toUpperCase(),
        expectedFingerprint: cannedJob.cannedJob.fingerprint,
        expectedTaxRateBps: 825,
      }
      const { result, resolved, locked, lockedTx, lockedScope } = await runCannedCapability(
        input,
        {
          mutateInputAfterCall: () => {
            input.expectedFingerprint = '0'.repeat(64)
            input.expectedTaxRateBps = null
          },
        },
      )

      expect(result).toEqual({
        ok: true,
        value: {
          cannedJobId: cannedJob.cannedJob.id,
          title: 'Brake service',
          kind: 'repair',
          defaultRequiredSkillTier: 2,
          sort: 10,
          lines: cannedJob.cannedJob.lines,
          fingerprint: cannedJob.cannedJob.fingerprint,
          taxRateBps: 825,
        },
      })
      for (const handle of [resolved, locked]) {
        expect(Object.getPrototypeOf(handle!)).toBe(null)
        expect(Object.isFrozen(handle)).toBe(true)
        expect(Reflect.ownKeys(handle!)).toEqual([])
      }
      expect(() => consumeResolvedLockedQuickTemplateForCreationV1(
        lockedTx!, lockedScope!, locked!,
      )).toThrow('mutation_attempt_capability_closed')
    })

    it('returns not_found or template_drift from strict non-locking preflight', async () => {
      const cases = [
        {
          input: {
            shopId: shopA.id, cannedJobId: uuid(999),
            expectedFingerprint: cannedJob.cannedJob.fingerprint, expectedTaxRateBps: 825,
          },
          expected: { ok: false, error: 'not_found' },
        },
        {
          input: {
            shopId: shopA.id, cannedJobId: cannedJob.cannedJob.id,
            expectedFingerprint: '0'.repeat(64), expectedTaxRateBps: 825,
          },
          expected: { ok: false, error: 'template_drift' },
        },
        {
          input: {
            shopId: shopA.id, cannedJobId: cannedJob.cannedJob.id,
            expectedFingerprint: cannedJob.cannedJob.fingerprint, expectedTaxRateBps: null,
          },
          expected: { ok: false, error: 'template_drift' },
        },
      ]
      for (const testCase of cases) {
        const { result } = await runCannedCapability(testCase.input)
        expect(result).toEqual(testCase.expected)
      }
    })

    it.each(['retired', 'replaced', 'tax'] as const)(
      'rejects %s drift from locked shop/template truth',
      async (drift) => {
        await expect(runCannedCapability({
          shopId: shopA.id,
          cannedJobId: cannedJob.cannedJob.id,
          expectedFingerprint: cannedJob.cannedJob.fingerprint,
          expectedTaxRateBps: 825,
        }, {
          afterPreflight: async (tx) => {
            if (drift === 'tax') {
              await tx.update(shops).set({ taxRateBps: 900 }).where(eq(shops.id, shopA.id))
            } else {
              await tx.update(cannedJobs).set(drift === 'retired'
                ? { retiredAt: new Date('2026-07-16T12:00:00Z') }
                : { title: 'Changed', updatedAt: new Date('2026-07-16T12:00:00Z') })
                .where(eq(cannedJobs.id, cannedJob.cannedJob.id))
            }
          },
        })).rejects.toThrow('resolved_quick_template_invalid')
      },
    )

    it('rejects a same-attempt globally identified template moved to an equal-tax shop', async () => {
      await db.update(shops).set({ taxRateBps: 825 }).where(eq(shops.id, shopB.id))

      await expect(runBoundedShopOsMutationV1(db, {
        discover: async (tx, attempt) => {
          const preflight = await preflightStrictCannedJobV1(tx, attempt.capability, {
            shopId: shopA.id,
            cannedJobId: cannedJob.cannedJob.id,
            expectedFingerprint: cannedJob.cannedJob.fingerprint,
            expectedTaxRateBps: 825,
          })
          if (!preflight.ok) throw new Error('template preflight failed')
          await tx.update(cannedJobs)
            .set({ shopId: shopB.id })
            .where(eq(cannedJobs.id, cannedJob.cannedJob.id))
          return {
            lockRequest: cannedLockRequest(preflight.cannedJobIds, {
              shopId: shopB.id,
              actorProfileId: crossShopActor.profileId,
            }),
            payload: preflight.template,
          }
        },
        executeLocked: async (tx, scope, template) => {
          expect(scope.request.shopId).toBe(shopB.id)
          expect(scope.actor.shopId).toBe(shopB.id)
          expect(scope.shop?.id).toBe(shopB.id)
          expect(scope.cannedJobs[0]?.shopId).toBe(shopB.id)
          expect(() => resolveStrictCannedJobInLockedScopeV1(tx, scope, template))
            .toThrow('resolved_quick_template_invalid')
          throw new Error('rollback_cross_shop_template_move')
        },
      })).rejects.toThrow('rollback_cross_shop_template_move')

      const [persisted] = await db.select({ shopId: cannedJobs.shopId })
        .from(cannedJobs)
        .where(eq(cannedJobs.id, cannedJob.cannedJob.id))
      expect(persisted?.shopId).toBe(shopA.id)
    })

    it('rejects forged, wrong-ID, and prior-attempt handles before consumption', async () => {
      const baseline = await runCannedCapability({
        shopId: shopA.id,
        cannedJobId: cannedJob.cannedJob.id,
        expectedFingerprint: cannedJob.cannedJob.fingerprint,
        expectedTaxRateBps: 825,
      })
      const other = await createCannedJob(db, {
        actor: { profileId: actor.profileId },
        clientKey: uuid(702),
        body: {
          title: 'Other service', kind: 'maintenance', defaultRequiredSkillTier: 1, sort: 20,
          lines: [{ kind: 'fee', description: 'Other', sort: 1, priceCents: 100, taxable: true }],
        },
      })
      if (!other.ok) throw new Error('other template failed')

      await expect(runCannedCapability({
        shopId: shopA.id,
        cannedJobId: cannedJob.cannedJob.id,
        expectedFingerprint: cannedJob.cannedJob.fingerprint,
        expectedTaxRateBps: 825,
      }, {
        transformRequest: (request) => ({ ...request, cannedJobIds: [other.cannedJob.id] }),
      })).rejects.toThrow('resolved_quick_template_invalid')

      await expect(runBoundedShopOsMutationV1(db, {
        discover: async () => ({
          lockRequest: cannedLockRequest([cannedJob.cannedJob.id]),
          payload: undefined,
        }),
        executeLocked: async (tx, scope) => {
          expect(() => resolveStrictCannedJobInLockedScopeV1(
            tx,
            scope,
            Object.freeze(Object.create(null)) as ResolvedQuickTemplateV1,
          )).toThrow('resolved_quick_template_invalid')
          expect(() => resolveStrictCannedJobInLockedScopeV1(
            tx,
            scope,
            baseline.resolved!,
          )).toThrow('resolved_quick_template_invalid')
          return 'rejected'
        },
      })).resolves.toBe('rejected')
    })

    it('rejects attempt-one handles during allowlisted unique-collision recovery', async () => {
      const queryLog: string[] = []
      const loggingDb = drizzle(client, {
        schema,
        logger: { logQuery: (query) => { queryLog.push(query) } },
      }) as TestDb
      let activeTx: AppDb | undefined
      const stableTx = new Proxy(Object.create(null) as AppDb, {
        get: (_target, property) => {
          if (!activeTx) throw new Error('stable transaction used outside an attempt')
          const value = Reflect.get(activeTx as object, property, activeTx)
          return typeof value === 'function' ? value.bind(activeTx) : value
        },
      })
      const sameIdentityDb = Object.freeze({
        transaction: async <T>(callback: (tx: AppDb) => Promise<T>): Promise<T> =>
          loggingDb.transaction(async (rawTx) => {
            if (activeTx) throw new Error('overlapping transaction attempts')
            activeTx = rawTx as AppDb
            try {
              return await callback(stableTx)
            } finally {
              activeTx = undefined
            }
          }),
      }) as unknown as TestDb
      let primaryCapability: MutationAttemptCapabilityV1 | undefined
      let primaryResolved: ResolvedQuickTemplateV1 | undefined
      let primaryLocked: ResolvedLockedQuickTemplateV1 | undefined
      const attempts: Array<Readonly<{ ordinal: number; purpose: string }>> = []

      const result = await runBoundedShopOsMutationV1<'recovered', ResolvedQuickTemplateV1>(
        sameIdentityDb,
        {
          discover: async (tx, attempt) => {
            attempts.push({ ordinal: attempt.ordinal, purpose: attempt.purpose })
            const preflight = await preflightStrictCannedJobV1(tx, attempt.capability, {
              shopId: shopA.id,
              cannedJobId: cannedJob.cannedJob.id,
              expectedFingerprint: cannedJob.cannedJob.fingerprint,
              expectedTaxRateBps: 825,
            })
            if (!preflight.ok) throw new Error('template preflight failed')
            return {
              lockRequest: cannedLockRequest(preflight.cannedJobIds),
              payload: preflight.template,
            }
          },
          executeLocked: async (tx, scope, template, attempt) => {
            expect(attempt).toMatchObject({ ordinal: 1, purpose: 'primary' })
            primaryCapability = attempt.capability
            primaryResolved = template
            primaryLocked = resolveStrictCannedJobInLockedScopeV1(tx, scope, template)
            throw Object.assign(new Error('forced sessions collision'), {
              code: '23505',
              constraint: 'sessions_pkey',
            })
          },
          uniqueCollisionRecovery: {
            allowedConstraints: ['sessions_pkey'],
            executeLocked: async (tx, scope, freshResolved, attempt, constraint) => {
              expect(attempt).toMatchObject({
                ordinal: 2,
                purpose: 'unique_collision_recovery',
              })
              expect(constraint).toBe('sessions_pkey')
              expect(attempt.capability).not.toBe(primaryCapability)
              expect(tx).toBe(stableTx)

              const beforeStaleHandles = queryLog.length
              expect(() => resolveStrictCannedJobInLockedScopeV1(
                tx,
                scope,
                primaryResolved!,
              )).toThrow('resolved_quick_template_invalid')
              expect(() => consumeResolvedLockedQuickTemplateForCreationV1(
                tx,
                scope,
                primaryLocked!,
              )).toThrow('resolved_quick_template_invalid')
              expect(queryLog).toHaveLength(beforeStaleHandles)

              const freshLocked = resolveStrictCannedJobInLockedScopeV1(
                tx,
                scope,
                freshResolved,
              )
              const fresh = consumeResolvedLockedQuickTemplateForCreationV1(
                tx,
                scope,
                freshLocked,
              )
              expect(fresh.cannedJobId).toBe(cannedJob.cannedJob.id)
              return { kind: 'recovered', value: 'recovered' }
            },
          },
        },
      )

      expect(result).toBe('recovered')
      expect(attempts).toEqual([
        { ordinal: 1, purpose: 'primary' },
        { ordinal: 2, purpose: 'unique_collision_recovery' },
      ])
    })

    it('resolves and consumes locked template handles without issuing SQL', async () => {
      const queryLog: string[] = []
      const loggingDb = drizzle(client, {
        schema,
        logger: { logQuery: (query) => { queryLog.push(query) } },
      }) as TestDb
      let countBefore = -1
      let countAfter = -1
      const { result } = await runCannedCapability({
        shopId: shopA.id,
        cannedJobId: cannedJob.cannedJob.id,
        expectedFingerprint: cannedJob.cannedJob.fingerprint,
        expectedTaxRateBps: 825,
      }, {
        db: loggingDb,
        beforeResolve: () => { countBefore = queryLog.length },
        afterResolve: () => { countAfter = queryLog.length },
      })

      expect(result).toMatchObject({ ok: true })
      expect(countAfter).toBe(countBefore)
    })

    it('returns fresh frozen consumer copies and rejects a valid handle in another live scope', async () => {
      const firstRun = await runCannedCapability({
        shopId: shopA.id,
        cannedJobId: cannedJob.cannedJob.id,
        expectedFingerprint: cannedJob.cannedJob.fingerprint,
        expectedTaxRateBps: 825,
      }, {
        inspectConsumers: (first, second) => {
          expect(second).not.toBe(first)
          expect(second.lines).not.toBe(first.lines)
          expect(second.lines[0]).not.toBe(first.lines[0])
          expect(Object.isFrozen(first)).toBe(true)
          expect(Object.isFrozen(first.lines)).toBe(true)
          expect(Object.isFrozen(first.lines[0])).toBe(true)
          expect(() => {
            ;(first.lines[0] as { description: string }).description = 'Mutated'
          }).toThrow()
          expect(second.lines[0]!.description).toBe('Brake pads')
        },
      })

      await expect(runBoundedShopOsMutationV1(db, {
        discover: async (tx, attempt) => {
          const preflight = await preflightStrictCannedJobV1(tx, attempt.capability, {
            shopId: shopA.id,
            cannedJobId: cannedJob.cannedJob.id,
            expectedFingerprint: cannedJob.cannedJob.fingerprint,
            expectedTaxRateBps: 825,
          })
          if (!preflight.ok) throw new Error('template preflight failed')
          return {
            lockRequest: cannedLockRequest(preflight.cannedJobIds),
            payload: undefined,
          }
        },
        executeLocked: async (tx, scope) => {
          expect(() => consumeResolvedLockedQuickTemplateForCreationV1(
            tx,
            scope,
            firstRun.locked!,
          )).toThrow('resolved_quick_template_invalid')
          return 'rejected'
        },
      })).resolves.toBe('rejected')
    })
  })

  it('creates a new-customer quick ticket with one true-open repair job and no session', async () => {
    const beforeNumber = (await db.select().from(shops).where(eq(shops.id, shopA.id)))[0]!
      .nextTicketNumber
    const result = await createQuickTicket(db, { actor, body: newBody() })

    expect(result).toMatchObject({
      ok: true,
      ticket: {
        source: 'quick_quote',
        concern: 'Replace boost hose',
        customer: {
          name: 'Maria Lopez',
          phone: '555-1234',
          email: 'maria@example.com',
        },
        vehicle: {
          year: 2018,
          make: 'Ford',
          model: 'F-150',
          engine: '3.5L EcoBoost',
          vin: '1FTEW1EP5JFC10001',
          mileage: 84_000,
          plate: 'ABC123',
        },
        jobs: [
          {
            title: 'Replace boost hose',
            kind: 'repair',
            requiredSkillTier: 2,
            assignedTechId: null,
            assignedTech: null,
            sessionId: null,
          },
        ],
      },
    })
    if (!result.ok) throw new Error('quick quote failed')
    const [persistedTicket] = await db.select().from(tickets)
      .where(eq(tickets.id, result.ticket.id))
    const [persistedJob] = await db.select().from(ticketJobs)
      .where(eq(ticketJobs.ticketId, result.ticket.id))
    expect(persistedTicket).toMatchObject({
      source: 'quick_quote',
      projectionRevision: 1n,
      continuityRevision: 1n,
    })
    expect(persistedJob).toMatchObject({
      sequenceNumber: 1,
      revision: 1n,
      creatorProvenance: 'direct',
    })
    const [receipt] = await db.select().from(ticketMutationReceipts)
      .where(eq(ticketMutationReceipts.requestKey, uuid(800)))
    expect(receipt).toMatchObject({
      shopId: shopA.id,
      actorProfileId: actor.profileId,
      mutationKind: 'create_repair_order',
      targetTicketId: null,
      resultTicketId: result.ticket.id,
      resultJobCount: 1,
    })
    expect(await db.select().from(ticketMutationReceiptJobs)
      .where(eq(ticketMutationReceiptJobs.receiptId, receipt!.id)))
      .toEqual([expect.objectContaining({
        shopId: shopA.id,
        receiptId: receipt!.id,
        ordinal: 0,
        jobId: persistedJob!.id,
      })])
    expect((await db.select().from(shops).where(eq(shops.id, shopA.id)))[0]!
      .nextTicketNumber).toBe(beforeNumber + 1)
    expect(await db.select().from(jobLines)).toEqual([])
    expect(await db.select().from(sessions)).toEqual([])
  })

  it('resolves a same-shop vehicle, updates supplied mileage, and creates one C-tier maintenance job', async () => {
    const result = await createQuickTicket(db, {
      actor,
      body: existingBody({ mileage: 43_210 }),
    })

    expect(result).toMatchObject({
      ok: true,
      ticket: {
        customer: { id: existingCustomer.id },
        vehicle: { id: existingVehicle.id, mileage: 43_210 },
        concern: 'Rotate tires',
        jobs: [
          {
            title: 'Rotate tires',
            kind: 'maintenance',
            requiredSkillTier: 1,
            assignedTechId: null,
            sessionId: null,
          },
        ],
      },
    })
    expect(await db.select().from(sessions)).toEqual([])
  })

  it.each(['tech', 'advisor', 'parts', 'owner'] as const)(
    'allows active %s actors to create',
    async (role) => {
      await db.update(profiles).set({ role }).where(eq(profiles.id, actor.profileId))
      const result = await createQuickTicket(db, {
        actor: { ...actor, role },
        body: existingBody(),
      })
      expect(result.ok).toBe(true)
    },
  )

  it.each([
    ['no shop', { shopId: null }, 'no_shop'],
    ['pending', { membershipStatus: 'pending' }, 'inactive_profile'],
    ['deactivated', { deactivatedAt: new Date('2026-07-10T12:00:00Z') }, 'inactive_profile'],
    ['unknown role', { role: 'curator' }, 'forbidden'],
  ] as const)('fails closed for a %s actor', async (_label, actorPatch, error) => {
    const result = await createQuickTicket(db, {
      actor: { ...actor, ...actorPatch },
      body: existingBody(),
    })
    expect(result).toEqual({ ok: false, error })
    expect(await db.select().from(tickets)).toEqual([])
  })

  it.each([
    ['cross-shop', () => existingBody({ existingVehicleId: crossShopVehicle.id })],
    [
      'missing',
      () =>
        existingBody({
          existingVehicleId: '00000000-0000-4000-8000-000000000999',
        }),
    ],
  ])('fails closed for a %s existing vehicle', async (_label, makeBody) => {
    const result = await createQuickTicket(db, { actor, body: makeBody() })
    expect(result).toEqual({ ok: false, error: 'not_found' })
    expect(await db.select().from(tickets)).toEqual([])
  })

  it('strictly rejects malformed, mixed, and out-of-bounds bodies before writes', async () => {
    const vehicle = newBody().vehicle as Record<string, unknown>
    const invalidBodies = [
      null,
      newBody({ vehicleMode: 'other' }),
      { ...newBody(), existingVehicleId: existingVehicle.id },
      { ...existingBody(), customer: newBody().customer, vehicle },
      newBody({ quote: { mode: 'manual', kind: 'diagnostic', description: 'Inspect' } }),
      newBody({ quote: { mode: 'manual', kind: 'repair', description: ' ' } }),
      newBody({ quote: { mode: 'manual', kind: 'repair', description: 'x'.repeat(201) } }),
      newBody({ clientKey: 'bad' }),
      newBody({ quote: { mode: 'canned', cannedJobId: cannedJob.cannedJob.id, expectedFingerprint: 'bad', expectedTaxRateBps: 825 } }),
      existingBody({ mileage: -1 }),
      existingBody({ mileage: 2_147_483_648 }),
      newBody({ vehicle: { ...vehicle, mileage: 2_147_483_648 } }),
      { ...newBody(), assignedTechId: null },
    ]

    for (const body of invalidBodies) {
      await expect(createQuickTicket(db, { actor, body })).resolves.toEqual({
        ok: false,
        error: 'invalid_input',
      })
    }
    expect(await db.select().from(tickets)).toEqual([])
    expect(await db.select().from(ticketJobs)).toEqual([])
  })

  it('does not change existing mileage when mileage is omitted', async () => {
    await createQuickTicket(db, { actor, body: existingBody() })
    const [persisted] = await db
      .select({ mileage: vehicles.mileage })
      .from(vehicles)
      .where(eq(vehicles.id, existingVehicle.id))
    expect(persisted.mileage).toBe(42_000)
  })

  it('keeps callbacks ordered after their writes and runs afterLines only for canned mode', async () => {
    const manualEvents: string[] = []
    const manualAfterLines = vi.fn(async () => undefined)
    const manual = await createQuickTicket(db, {
      actor,
      body: newBody({ clientKey: uuid(820) }),
    }, {
      afterCustomer: async () => { manualEvents.push('customer') },
      afterVehicle: async () => { manualEvents.push('vehicle') },
      afterTicket: async () => { manualEvents.push('ticket') },
      afterLines: manualAfterLines,
    })
    expect(manual.ok).toBe(true)
    expect(manualEvents).toEqual(['customer', 'vehicle', 'ticket'])
    expect(manualAfterLines).not.toHaveBeenCalled()

    const mileageEvents: string[] = []
    const mileage = await createQuickTicket(db, {
      actor,
      body: existingBody({ clientKey: uuid(821), mileage: 43_210 }),
    }, {
      afterMileage: async () => { mileageEvents.push('mileage') },
      afterTicket: async () => { mileageEvents.push('ticket') },
    })
    expect(mileage.ok).toBe(true)
    expect(mileageEvents).toEqual(['mileage', 'ticket'])

    const cannedEvents: string[] = []
    const canned = await createQuickTicket(db, {
      actor,
      body: cannedExistingBody({ clientKey: uuid(822) }),
    }, {
      afterTicket: async () => { cannedEvents.push('ticket') },
      afterLines: async () => { cannedEvents.push('lines') },
    })
    expect(canned.ok).toBe(true)
    expect(cannedEvents).toEqual(['ticket', 'lines'])
  })

  it('rolls back new customer and vehicle rows when the post-batch stage fails', async () => {
    const beforeCustomers = await db.select().from(customers)
    const beforeVehicles = await db.select().from(vehicles)

    await expect(createQuickTicket(db, { actor, body: newBody() }, {
      afterTicket: async () => { throw new Error('after_batch') },
    })).rejects.toThrow('after_batch')

    expect(await db.select().from(customers)).toEqual(beforeCustomers)
    expect(await db.select().from(vehicles)).toEqual(beforeVehicles)
    expect(await db.select().from(tickets)).toEqual([])
    expect(await db.select().from(ticketJobs)).toEqual([])
    expect(await db.select().from(ticketMutationReceipts)).toEqual([])
    expect(await db.select().from(sessions)).toEqual([])
  })

  it('rolls back an existing mileage update when the post-batch stage fails', async () => {
    await expect(createQuickTicket(db, {
      actor,
      body: existingBody({ mileage: 99_999 }),
    }, {
      afterTicket: async () => { throw new Error('after_batch') },
    })).rejects.toThrow('after_batch')

    const [persisted] = await db
      .select({ mileage: vehicles.mileage })
      .from(vehicles)
      .where(eq(vehicles.id, existingVehicle.id))
    expect(persisted.mileage).toBe(42_000)
    expect(await db.select().from(tickets)).toEqual([])
    expect(await db.select().from(ticketMutationReceipts)).toEqual([])
  })

  it('copies an exact canned job into a new quick quote and exposes exact builder totals', async () => {
    const beforeNumber = (await db.select({ nextTicketNumber: shops.nextTicketNumber })
      .from(shops).where(eq(shops.id, shopA.id)))[0]!.nextTicketNumber
    const result = await createQuickTicket(db, { actor, body: cannedExistingBody() })
    expect(result).toMatchObject({
      ok: true,
      ticket: {
        source: 'quick_quote',
        concern: 'Brake service',
        jobs: [{ title: 'Brake service', kind: 'repair', requiredSkillTier: 2, assignedTechId: null, sessionId: null }],
      },
    })
    if (!result.ok) throw new Error('quick quote failed')
    const [persistedTicket] = await db.select().from(tickets)
      .where(eq(tickets.id, result.ticket.id))
    const [job] = await db.select().from(ticketJobs).where(eq(ticketJobs.ticketId, result.ticket.id))
    const lines = await db.select().from(jobLines).where(eq(jobLines.jobId, job.id)).orderBy(jobLines.sort)
    expect(persistedTicket).toMatchObject({
      source: 'quick_quote', projectionRevision: 1n, continuityRevision: 1n,
    })
    expect(job).toMatchObject({
      sequenceNumber: 1, revision: 1n, creatorProvenance: 'direct',
    })
    expect(lines.map((line) => ({
      kind: line.kind, description: line.description, sort: line.sort,
      quantity: Number(line.quantity), priceCents: line.priceCents, taxable: line.taxable,
      partNumber: line.partNumber, brand: line.brand,
      laborHours: line.laborHours === null ? null : Number(line.laborHours),
      laborRateCents: line.laborRateCents, source: line.source, partStatus: line.partStatus,
    }))).toEqual([
      { kind: 'part', description: 'Brake pads', sort: 10, quantity: 1, priceCents: 12_500, taxable: true, partNumber: 'PAD-1', brand: 'ACME', laborHours: null, laborRateCents: null, source: 'manual', partStatus: 'proposed' },
      { kind: 'labor', description: 'Install pads', sort: 20, quantity: 1, priceCents: 18_750, taxable: false, partNumber: null, brand: null, laborHours: 1.25, laborRateCents: 15_000, source: 'manual', partStatus: 'proposed' },
      { kind: 'fee', description: 'Shop supplies', sort: 30, quantity: 1, priceCents: 500, taxable: true, partNumber: null, brand: null, laborHours: null, laborRateCents: null, source: 'manual', partStatus: 'proposed' },
    ])
    for (const line of lines) {
      expect(line).toMatchObject({
        unitCostCents: null, coreChargeCents: null, fitment: null, vendorAccountId: null,
        externalOfferId: null, vendorSnapshot: null, orderedAt: null, orderedByProfileId: null,
        receivedAt: null, receivedByProfileId: null,
      })
    }
    const builder = await getQuoteBuilder(db, { actor, ticketId: result.ticket.id })
    expect(builder).toMatchObject({ ok: true, builder: { configuration: { taxRateBps: 825 } } })
    if (!builder.ok) throw new Error('builder failed')
    expect(calculateTicketTotals(
      builder.builder.jobs.flatMap((builderJob) => builderJob.lines.map((line) => ({
        extendedCents: line.priceCents,
        taxable: line.taxable,
      }))),
      builder.builder.configuration.taxRateBps ?? 0,
    )).toEqual({ subtotalCents: 31_750, taxableSubtotalCents: 13_000, taxCents: 1_073, totalCents: 32_823 })
    const [receipt] = await db.select().from(ticketMutationReceipts)
      .where(eq(ticketMutationReceipts.requestKey, uuid(802)))
    expect(receipt).toMatchObject({
      shopId: shopA.id,
      actorProfileId: actor.profileId,
      mutationKind: 'create_repair_order',
      targetTicketId: null,
      resultTicketId: result.ticket.id,
      resultJobCount: 1,
    })
    expect(await db.select().from(ticketMutationReceiptJobs)
      .where(eq(ticketMutationReceiptJobs.receiptId, receipt!.id)))
      .toEqual([expect.objectContaining({ ordinal: 0, jobId: job.id })])
    expect((await db.select({ nextTicketNumber: shops.nextTicketNumber })
      .from(shops).where(eq(shops.id, shopA.id)))[0]!.nextTicketNumber)
      .toBe(beforeNumber + 1)
    expect(await db.select().from(sessions)).toEqual([])
  })

  it('copies the same exact canned truth for a newly resolved customer and vehicle', async () => {
    const cannedQuote = cannedExistingBody().quote
    const result = await createQuickTicket(db, {
      actor,
      body: newBody({ clientKey: uuid(805), quote: cannedQuote }),
    })
    expect(result).toMatchObject({
      ok: true,
      ticket: {
        customer: { name: 'Maria Lopez' },
        vehicle: { make: 'Ford', model: 'F-150', mileage: 84_000 },
        concern: 'Brake service',
        jobs: [{ title: 'Brake service', assignedTechId: null, sessionId: null }],
      },
    })
    if (!result.ok) throw new Error('quick quote failed')
    const [job] = await db.select().from(ticketJobs).where(eq(ticketJobs.ticketId, result.ticket.id))
    const lines = await db.select().from(jobLines).where(eq(jobLines.jobId, job.id))
    expect(lines.map((line) => line.priceCents)).toEqual([12_500, 18_750, 500])
  })

  it('replays the exact original request without mutation after template, tax, and identity drift', async () => {
    const body = newBody({
      clientKey: uuid(823),
      quote: cannedExistingBody().quote,
    })
    const first = await createQuickTicket(db, { actor, body })
    if (!first.ok) throw new Error('quick quote failed')
    const replaced = await replaceCannedJob(db, {
      actor: { profileId: actor.profileId }, cannedJobId: cannedJob.cannedJob.id,
      expectedFingerprint: cannedJob.cannedJob.fingerprint,
      body: { title: 'Changed', kind: 'repair', defaultRequiredSkillTier: 2, sort: 10, lines: [{ kind: 'fee', description: 'Changed', sort: 1, priceCents: 1, taxable: true }] },
    })
    if (!replaced.ok) throw new Error('replace failed')
    await retireCannedJob(db, { actor: { profileId: actor.profileId }, cannedJobId: replaced.cannedJob.id, expectedFingerprint: replaced.cannedJob.fingerprint })
    await db.update(shops).set({ taxRateBps: null }).where(eq(shops.id, shopA.id))
    const [duplicateCustomer] = await db.insert(customers).values({
      shopId: shopA.id,
      name: 'Duplicate Maria',
      phone: '555-1234',
      email: 'duplicate@example.com',
    }).returning()
    await db.insert(vehicles).values({
      customerId: duplicateCustomer.id,
      year: 2018,
      make: 'Ford',
      model: 'F-150',
      engine: '3.5L EcoBoost',
      vin: '1FTEW1EP5JFC10001',
      mileage: 1,
      plate: 'ABC123',
    })
    const beforeReplay = await quickMutationState()
    const callbacks = {
      afterCustomer: vi.fn(async () => undefined),
      afterVehicle: vi.fn(async () => undefined),
      afterMileage: vi.fn(async () => undefined),
      afterTicket: vi.fn(async () => undefined),
      afterLines: vi.fn(async () => undefined),
    }
    const replay = await createQuickTicket(db, { actor, body }, callbacks)
    expect(replay).toEqual(first)
    for (const callback of Object.values(callbacks)) expect(callback).not.toHaveBeenCalled()
    expect(await quickMutationState()).toEqual(beforeReplay)
    await expect(createQuickTicket(db, {
      actor,
      body: newBody({
        clientKey: uuid(823),
        vehicle: { ...body.vehicle, mileage: 84_001 },
        quote: body.quote,
      }),
    })).resolves.toEqual({ ok: false, error: 'conflict' })
    expect(await quickMutationState()).toEqual(beforeReplay)
  })

  it('binds request identity to actor, replays exact input, and rotates changed keys', async () => {
    const first = await createQuickTicket(db, { actor, body: existingBody() })
    const replay = await createQuickTicket(db, { actor, body: existingBody() })
    const changed = await createQuickTicket(db, { actor, body: existingBody({ clientKey: uuid(803) }) })
    const [otherProfile] = await db.insert(profiles).values({
      userId: uuid(2), shopId: shopA.id, role: 'advisor', skillTier: 2, fullName: 'Avery Advisor',
    }).returning()
    const otherActor: TicketActor = {
      profileId: otherProfile.id, shopId: otherProfile.shopId, role: otherProfile.role,
      skillTier: otherProfile.skillTier, membershipStatus: otherProfile.membershipStatus,
      deactivatedAt: otherProfile.deactivatedAt,
    }
    const other = await createQuickTicket(db, { actor: otherActor, body: existingBody() })
    expect(first).toMatchObject({ ok: true })
    expect(replay).toEqual(first)
    expect(changed).toMatchObject({ ok: true })
    expect(other).toEqual({ ok: false, error: 'conflict' })
    expect(JSON.stringify(other)).not.toContain(first.ok ? first.ticket.id : 'unreachable')
    expect(new Set([first, changed].filter((x) => x.ok).map((x) => x.ticket.id))).toHaveLength(2)
  })

  it('keeps the same request key independent across shops', async () => {
    const clientKey = uuid(824)
    const north = await createQuickTicket(db, {
      actor,
      body: existingBody({ clientKey }),
    })
    const south = await createQuickTicket(db, {
      actor: crossShopActor,
      body: existingBody({
        clientKey,
        existingVehicleId: crossShopVehicle.id,
      }),
    })
    expect(north).toMatchObject({ ok: true })
    expect(south).toMatchObject({ ok: true })
    if (!north.ok || !south.ok) throw new Error('cross-shop quick quote failed')
    expect(south.ticket.id).not.toBe(north.ticket.id)
    expect(await db.select().from(ticketMutationReceipts)
      .where(eq(ticketMutationReceipts.requestKey, clientKey)))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ shopId: shopA.id, resultTicketId: north.ticket.id }),
        expect.objectContaining({ shopId: shopB.id, resultTicketId: south.ticket.id }),
      ]))
  })

  it('returns an identifier-free retryable conflict when a historical HMAC key is unavailable', async () => {
    const body = existingBody({ clientKey: uuid(825) })
    const first = await createQuickTicket(db, { actor, body })
    if (!first.ok) throw new Error('quick quote failed')
    const beforeReplay = await quickMutationState()

    const replay = await createQuickTicket(db, { actor, body }, {
      loadMutationKeyring: () => testMutationKeyringV2Only,
    })

    expect(replay).toEqual({ ok: false, error: 'conflict', retryable: true })
    expect(JSON.stringify(replay)).not.toContain(first.ticket.id)
    expect(await quickMutationState()).toEqual(beforeReplay)
  })

  it('uses a present receipt hint before legacy, identity, or template preflight work', async () => {
    const body = cannedExistingBody({ clientKey: uuid(827) })
    const first = await createQuickTicket(db, { actor, body })
    if (!first.ok) throw new Error('quick quote failed')
    quickAdapterSpies.hintReceiptPresence.mockClear()
    quickAdapterSpies.preflightIdentity.mockClear()
    quickAdapterSpies.preflightTemplate.mockClear()
    const queryLog: Array<{ sql: string; params: unknown[] }> = []
    const loggingDb = drizzle(client, {
      schema,
      logger: {
        logQuery(sqlText, params) {
          queryLog.push({ sql: sqlText, params })
        },
      },
    }) as TestDb

    const replay = await createQuickTicket(loggingDb, { actor, body })

    expect(replay).toEqual(first)
    expect(quickAdapterSpies.hintReceiptPresence).toHaveBeenCalledTimes(1)
    expect(quickAdapterSpies.preflightIdentity).not.toHaveBeenCalled()
    expect(quickAdapterSpies.preflightTemplate).not.toHaveBeenCalled()
    expect(JSON.stringify(queryLog)).not.toContain(
      deterministicQuickTicketId(shopA.id, actor.profileId, uuid(827)),
    )
  })

  it('retries one stale-positive hint, loads the keyring once, and reaches one insert', async () => {
    quickAdapterSpies.hintReceiptPresence
      .mockResolvedValueOnce('present')
      .mockResolvedValueOnce('absent')
    const loadMutationKeyring = vi.fn(() => testMutationKeyring)

    const result = await createQuickTicket(db, {
      actor,
      body: existingBody({ clientKey: uuid(828) }),
    }, { loadMutationKeyring })

    expect(result).toMatchObject({ ok: true })
    expect(loadMutationKeyring).toHaveBeenCalledTimes(1)
    expect(quickAdapterSpies.hintReceiptPresence).toHaveBeenCalledTimes(2)
    expect(quickAdapterSpies.preflightIdentity).toHaveBeenCalledTimes(1)
    expect(await db.select().from(tickets)).toHaveLength(1)
    expect(await db.select().from(ticketMutationReceipts)).toHaveLength(1)
  })

  it('treats a forced-absent hint as advisory and suppresses prepared work for an owned receipt', async () => {
    const body = existingBody({ clientKey: uuid(829) })
    const first = await createQuickTicket(db, { actor, body })
    if (!first.ok) throw new Error('quick quote failed')
    quickAdapterSpies.hintReceiptPresence.mockClear()
    quickAdapterSpies.preflightIdentity.mockClear()
    quickAdapterSpies.hintReceiptPresence.mockResolvedValueOnce('absent')
    const beforeReplay = await quickMutationState()
    const callbacks = {
      afterCustomer: vi.fn(async () => undefined),
      afterVehicle: vi.fn(async () => undefined),
      afterMileage: vi.fn(async () => undefined),
      afterTicket: vi.fn(async () => undefined),
      afterLines: vi.fn(async () => undefined),
    }

    const replay = await createQuickTicket(db, { actor, body }, callbacks)

    expect(replay).toEqual(first)
    expect(quickAdapterSpies.hintReceiptPresence).toHaveBeenCalledTimes(1)
    expect(quickAdapterSpies.preflightIdentity).toHaveBeenCalledTimes(1)
    for (const callback of Object.values(callbacks)) expect(callback).not.toHaveBeenCalled()
    expect(await quickMutationState()).toEqual(beforeReplay)
  })

  it('recovers only the exact structured receipt constraint and classifies the committed winner', async () => {
    const body = existingBody({ clientKey: uuid(834) })
    await client.exec(`
      CREATE FUNCTION task_7d_raise_exact_receipt_collision()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'forced_receipt_race'
          USING ERRCODE = '23505',
                CONSTRAINT = 'ticket_mutation_receipts_shop_request_key_uq';
      END;
      $$;
      CREATE TRIGGER task_7d_raise_exact_receipt_collision
      BEFORE INSERT ON ticket_mutation_receipts
      FOR EACH ROW
      EXECUTE FUNCTION task_7d_raise_exact_receipt_collision();
    `)
    let seededWinner: Awaited<ReturnType<typeof createQuickTicket>> | undefined
    let seeded = false
    const racingDb = new Proxy(db as AppDb, {
      get(target, property, receiver) {
        if (property !== 'transaction') return Reflect.get(target, property, receiver)
        return async (callback: (tx: AppDb) => Promise<unknown>) => {
          try {
            return await db.transaction(async (rawTx) => callback(rawTx as AppDb))
          } catch (error) {
            if (!seeded) {
              seeded = true
              await client.exec(`
                DROP TRIGGER task_7d_raise_exact_receipt_collision
                  ON ticket_mutation_receipts;
                DROP FUNCTION task_7d_raise_exact_receipt_collision();
              `)
              seededWinner = await createQuickTicket(db, { actor, body })
              if (!seededWinner.ok) throw new Error('failed to seed race winner')
            }
            throw error
          }
        }
      },
    }) as AppDb

    const recovered = await createQuickTicket(racingDb, { actor, body })

    expect(seededWinner).toMatchObject({ ok: true })
    expect(recovered).toEqual(seededWinner)
    expect(await db.select().from(tickets)).toHaveLength(1)
    expect(await db.select().from(ticketJobs)).toHaveLength(1)
    expect(await db.select().from(ticketMutationReceipts)).toHaveLength(1)
    expect(await db.select().from(ticketMutationReceiptJobs)).toHaveLength(1)

    const beforeOtherConstraint = await quickMutationState()
    await client.exec(`
      CREATE FUNCTION task_7d_raise_other_unique_collision()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'forced_other_unique'
          USING ERRCODE = '23505', CONSTRAINT = 'tickets_pkey';
      END;
      $$;
      CREATE TRIGGER task_7d_raise_other_unique_collision
      BEFORE INSERT ON ticket_mutation_receipts
      FOR EACH ROW
      EXECUTE FUNCTION task_7d_raise_other_unique_collision();
    `)
    let otherConstraintError: unknown
    try {
      await createQuickTicket(db, {
        actor,
        body: existingBody({ clientKey: uuid(835) }),
      })
    } catch (error) {
      otherConstraintError = error
    }
    await client.exec(`
      DROP TRIGGER task_7d_raise_other_unique_collision ON ticket_mutation_receipts;
      DROP FUNCTION task_7d_raise_other_unique_collision();
    `)
    expect(findStructuredDbError(otherConstraintError)).toMatchObject({
      code: '23505', constraint: 'tickets_pkey',
    })
    expect(await quickMutationState()).toEqual(beforeOtherConstraint)

    await client.exec(`
      CREATE FUNCTION task_7d_raise_spoofed_receipt_collision()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION
          '23505 ticket_mutation_receipts_shop_request_key_uq spoof';
      END;
      $$;
      CREATE TRIGGER task_7d_raise_spoofed_receipt_collision
      BEFORE INSERT ON ticket_mutation_receipts
      FOR EACH ROW
      EXECUTE FUNCTION task_7d_raise_spoofed_receipt_collision();
    `)
    let spoofedError: unknown
    try {
      await createQuickTicket(db, {
        actor,
        body: existingBody({ clientKey: uuid(836) }),
      })
    } catch (error) {
      spoofedError = error
    }
    await client.exec(`
      DROP TRIGGER task_7d_raise_spoofed_receipt_collision ON ticket_mutation_receipts;
      DROP FUNCTION task_7d_raise_spoofed_receipt_collision();
    `)
    expect(findStructuredDbError(spoofedError)).toMatchObject({ code: 'P0001' })
    expect(await quickMutationState()).toEqual(beforeOtherConstraint)
  })

  it('leaves an exact collision unresolved without a winner and never prepares recovery inserts', async () => {
    await client.exec(`
      CREATE FUNCTION task_7d_raise_unresolved_receipt_collision()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'forced_unresolved_receipt_race'
          USING ERRCODE = '23505',
                CONSTRAINT = 'ticket_mutation_receipts_shop_request_key_uq';
      END;
      $$;
      CREATE TRIGGER task_7d_raise_unresolved_receipt_collision
      BEFORE INSERT ON ticket_mutation_receipts
      FOR EACH ROW
      EXECUTE FUNCTION task_7d_raise_unresolved_receipt_collision();
    `)
    const before = await quickMutationState()
    let collisionError: unknown

    try {
      await createQuickTicket(db, {
        actor,
        body: existingBody({ clientKey: uuid(837) }),
      })
    } catch (error) {
      collisionError = error
    }
    await client.exec(`
      DROP TRIGGER task_7d_raise_unresolved_receipt_collision
        ON ticket_mutation_receipts;
      DROP FUNCTION task_7d_raise_unresolved_receipt_collision();
    `)

    expect(findStructuredDbError(collisionError)).toMatchObject({
      code: '23505',
      constraint: 'ticket_mutation_receipts_shop_request_key_uq',
    })
    expect(quickAdapterSpies.hintReceiptPresence).toHaveBeenCalledTimes(2)
    expect(quickAdapterSpies.preflightIdentity).toHaveBeenCalledTimes(1)
    expect(quickAdapterSpies.preflightTemplate).not.toHaveBeenCalled()
    expect(await quickMutationState()).toEqual(before)
  })

  it('fails closed before the first await when the keyring loader fails', async () => {
    const before = await quickMutationState()
    const loadMutationKeyring = vi.fn(() => {
      throw new Error('secret configuration detail')
    })
    quickAdapterSpies.hintReceiptPresence.mockClear()

    const result = await createQuickTicket(db, {
      actor,
      body: existingBody({ clientKey: uuid(830) }),
    }, { loadMutationKeyring })

    expect(result).toEqual({ ok: false, error: 'conflict', retryable: true })
    expect(JSON.stringify(result)).not.toContain('secret configuration detail')
    expect(loadMutationKeyring).toHaveBeenCalledTimes(1)
    expect(quickAdapterSpies.hintReceiptPresence).not.toHaveBeenCalled()
    expect(await quickMutationState()).toEqual(before)
  })

  it('owns the caller actor and body before the first await and binds replay to the original copies', async () => {
    const mutableActor: TicketActor = { ...actor }
    const originalActor: TicketActor = { ...mutableActor }
    const mutableBody = newBody({ clientKey: uuid(831) })
    const originalBody = structuredClone(mutableBody)
    const pending = createQuickTicket(db, { actor: mutableActor, body: mutableBody })
    mutableActor.profileId = crossShopActor.profileId
    mutableActor.shopId = shopB.id
    mutableActor.role = 'curator'
    mutableActor.skillTier = null
    mutableActor.membershipStatus = 'pending'
    mutableActor.deactivatedAt = new Date('2026-07-10T12:00:00Z')
    mutableBody.customer.name = 'Mutated Caller'
    mutableBody.vehicle.mileage = 1
    mutableBody.quote.description = 'Mutated concern'

    const first = await pending
    expect(first).toMatchObject({
      ok: true,
      ticket: {
        concern: 'Replace boost hose',
        customer: { name: 'Maria Lopez' },
        vehicle: { mileage: 84_000 },
      },
    })
    if (!first.ok) throw new Error('quick quote failed')
    expect((await db.select().from(tickets).where(eq(tickets.id, first.ticket.id)))[0])
      .toMatchObject({
        shopId: shopA.id,
        createdByProfileId: originalActor.profileId,
      })
    expect((await db.select().from(ticketMutationReceipts)
      .where(eq(ticketMutationReceipts.requestKey, uuid(831))))[0])
      .toMatchObject({
        shopId: shopA.id,
        actorProfileId: originalActor.profileId,
        resultTicketId: first.ticket.id,
      })
    const replay = await createQuickTicket(db, { actor: originalActor, body: originalBody })
    expect(replay).toEqual(first)
    await expect(createQuickTicket(db, { actor: originalActor, body: mutableBody }))
      .resolves.toEqual({ ok: false, error: 'conflict' })
  })

  it('reauthorizes the persisted actor status', async () => {
    await db.update(profiles).set({ membershipStatus: 'pending', membershipActivatedAt: null }).where(eq(profiles.id, actor.profileId))
    await expect(createQuickTicket(db, { actor, body: existingBody() })).resolves.toEqual({ ok: false, error: 'not_found' })
    expect(await db.select().from(tickets)).toEqual([])
  })

  it('reauthorizes the persisted actor role', async () => {
    await db.update(profiles).set({ role: 'curator' }).where(eq(profiles.id, actor.profileId))
    await expect(createQuickTicket(db, { actor, body: existingBody() }))
      .resolves.toEqual({ ok: false, error: 'not_found' })
    expect(await db.select().from(tickets)).toEqual([])
  })

  it('uses the persisted actor shop instead of the caller snapshot', async () => {
    await db.update(profiles).set({ shopId: shopB.id }).where(eq(profiles.id, actor.profileId))
    const result = await createQuickTicket(db, {
      actor,
      body: existingBody({
        clientKey: uuid(826),
        existingVehicleId: crossShopVehicle.id,
      }),
    })
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) throw new Error('moved-shop quick quote failed')
    expect((await db.select().from(tickets).where(eq(tickets.id, result.ticket.id)))[0])
      .toMatchObject({ shopId: shopB.id })
    expect((await db.select().from(ticketMutationReceipts)
      .where(eq(ticketMutationReceipts.requestKey, uuid(826))))[0])
      .toMatchObject({ shopId: shopB.id, actorProfileId: actor.profileId })
  })

  it('does not disclose or reuse a deterministic identity collision with incompatible persisted truth', async () => {
    const body = existingBody({ clientKey: uuid(806) })
    const collision = await createTicket(db, {
      actor,
      internal: {
        ticketId: deterministicQuickTicketId(
          actor.shopId as string,
          actor.profileId,
          uuid(806),
        ),
      },
      body: {
        source: 'counter',
        customerId: existingCustomer.id,
        vehicleId: existingVehicle.id,
        concern: 'Existing Counter work',
        jobs: [{
          title: 'Existing Counter work',
          kind: 'repair',
          requiredSkillTier: 2,
          assignedTechId: null,
        }],
      },
    })
    expect(collision).toMatchObject({ ok: true, ticket: { source: 'counter' } })
    await expect(createQuickTicket(db, { actor, body })).resolves.toEqual({ ok: false, error: 'conflict' })
    expect(await db.select().from(tickets)).toHaveLength(1)
  })

  it('rejects stale, cross-shop, retired, and corrupt canned state with no writes', async () => {
    const cases: Array<[Record<string, unknown>, Record<string, unknown>]> = [
      [{ mode: 'canned', cannedJobId: cannedJob.cannedJob.id, expectedFingerprint: '0'.repeat(64), expectedTaxRateBps: 825 }, { ok: false, error: 'conflict' }],
      [{ mode: 'canned', cannedJobId: cannedJob.cannedJob.id, expectedFingerprint: cannedJob.cannedJob.fingerprint, expectedTaxRateBps: null }, { ok: false, error: 'conflict' }],
      [{ mode: 'canned', cannedJobId: uuid(999), expectedFingerprint: cannedJob.cannedJob.fingerprint, expectedTaxRateBps: 825 }, { ok: false, error: 'not_found' }],
      [{ mode: 'canned', cannedJobId: crossShopCannedJob.cannedJob.id, expectedFingerprint: crossShopCannedJob.cannedJob.fingerprint, expectedTaxRateBps: 825 }, { ok: false, error: 'not_found' }],
    ]
    for (const [quote, expected] of cases) {
      const result = await createQuickTicket(db, { actor, body: cannedExistingBody({ clientKey: crypto.randomUUID(), quote }) })
      expect(result).toEqual(expected)
      if (expected.error === 'conflict') expect(ticketDomainStatus(result, 201)).toBe(409)
    }
    await db.update(cannedJobs).set({ defaultLines: [{ bad: true }] as never }).where(eq(cannedJobs.id, cannedJob.cannedJob.id))
    await expect(createQuickTicket(db, { actor, body: cannedExistingBody({ clientKey: uuid(804) }) })).resolves.toEqual({ ok: false, error: 'conflict' })
    expect(await db.select().from(tickets)).toEqual([])
    expect(await db.select().from(jobLines)).toEqual([])
  })

  it.each([
    ['VIN', { vin: '1FTEW1EP5JFC10001', plate: 'OLD123' }, { vin: '1FTEW1EP5JFC10001', plate: 'NEW123' }],
    ['plate', { vin: null, plate: 'ABC123' }, { vin: null, plate: 'ABC123' }],
  ] as const)('updates submitted mileage when new-mode upsert reuses an existing %s vehicle', async (_label, persistedIdentity, submittedIdentity) => {
    await db.update(vehicles).set({
      year: 2018, make: 'Ford', model: 'F-150', mileage: 40_000,
      vin: persistedIdentity.vin, plate: persistedIdentity.plate,
    }).where(eq(vehicles.id, existingVehicle.id))
    const body = newBody({
      clientKey: crypto.randomUUID(),
      customer: { name: 'Ada Driver', phone: '555-0101', email: null },
      vehicle: {
        year: 2018, make: 'Ford', model: 'F-150', engine: null,
        vin: submittedIdentity.vin, plate: submittedIdentity.plate, mileage: 88_888,
      },
    })
    const result = await createQuickTicket(db, { actor, body })
    expect(result).toMatchObject({ ok: true, ticket: { vehicle: { id: existingVehicle.id, mileage: 88_888 } } })
    const [persisted] = await db.select().from(vehicles).where(eq(vehicles.id, existingVehicle.id))
    expect(persisted.mileage).toBe(88_888)
    expect(await db.select().from(vehicles).where(eq(vehicles.customerId, existingCustomer.id))).toHaveLength(1)
  })

  it('rolls back a matched new-mode vehicle mileage update when a later stage fails', async () => {
    await db.update(vehicles).set({
      year: 2018, make: 'Ford', model: 'F-150', mileage: 40_000,
      vin: '1FTEW1EP5JFC10001', plate: 'OLD123',
    }).where(eq(vehicles.id, existingVehicle.id))
    const body = newBody({
      clientKey: uuid(815),
      customer: { name: 'Ada Driver', phone: '555-0101', email: null },
      vehicle: {
        year: 2018, make: 'Ford', model: 'F-150', engine: null,
        vin: '1FTEW1EP5JFC10001', plate: 'NEW123', mileage: 88_888,
      },
    })
    await expect(createQuickTicket(db, { actor, body }, {
      afterMileage: async () => { throw new Error('after_new_mileage') },
    })).rejects.toThrow('after_new_mileage')
    const [persisted] = await db.select().from(vehicles).where(eq(vehicles.id, existingVehicle.id))
    expect(persisted.mileage).toBe(40_000)
    expect(await db.select().from(tickets)).toEqual([])
  })

  it('creates no session, assignment, quote version, approval event, or hidden workflow state', async () => {
    const result = await createQuickTicket(db, { actor, body: cannedExistingBody() })
    expect(result.ok).toBe(true)
    const [job] = await db.select().from(ticketJobs)
    expect(job).toMatchObject({ assignedTechId: null, sessionId: null, workStatus: 'open', approvalState: 'pending_quote' })
    expect(await db.select().from(sessions)).toEqual([])
    expect(await db.select().from(quoteVersions)).toEqual([])
    expect(await db.select().from(quoteEvents)).toEqual([])
  })

  it('rolls back the full graph when finalization rejects post-batch drift', async () => {
    await client.exec(`
      CREATE FUNCTION task_7d_drift_ticket_before_finalization()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        UPDATE tickets
        SET projection_revision = 2
        WHERE id = NEW.id;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER task_7d_drift_ticket_before_finalization
      AFTER INSERT ON tickets
      FOR EACH ROW
      EXECUTE FUNCTION task_7d_drift_ticket_before_finalization();
    `)
    const before = await quickMutationState()

    await expect(createQuickTicket(db, {
      actor,
      body: existingBody({ clientKey: uuid(832) }),
    })).rejects.toThrow('ticket_creation_kernel_invalid')

    expect(await quickMutationState()).toEqual(before)
  })

  it('rolls back the full graph when an after-insert receipt trigger fails', async () => {
    await client.exec(`
      CREATE FUNCTION task_7d_fail_after_receipt_insert()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'forced_after_receipt_insert';
      END;
      $$;
      CREATE TRIGGER task_7d_fail_after_receipt_insert
      AFTER INSERT ON ticket_mutation_receipt_jobs
      FOR EACH ROW
      EXECUTE FUNCTION task_7d_fail_after_receipt_insert();
    `)
    const before = await quickMutationState()

    await expect(createQuickTicket(db, {
      actor,
      body: cannedExistingBody({ clientKey: uuid(833) }),
    })).rejects.toBeDefined()

    expect(await quickMutationState()).toEqual(before)
  })

  it('rolls back customer, vehicle, mileage, ticket, and canned-line stage failures', async () => {
    const before = await quickMutationState()
    const fail = async () => { throw new Error('injected_stage_failure') }

    await expect(createQuickTicket(db, { actor, body: newBody({ clientKey: uuid(810) }) }, { afterCustomer: fail })).rejects.toThrow('injected_stage_failure')
    await expect(createQuickTicket(db, { actor, body: newBody({ clientKey: uuid(811) }) }, { afterVehicle: fail })).rejects.toThrow('injected_stage_failure')
    await expect(createQuickTicket(db, { actor, body: existingBody({ clientKey: uuid(812), mileage: 99_999 }) }, { afterMileage: fail })).rejects.toThrow('injected_stage_failure')
    await expect(createQuickTicket(db, { actor, body: existingBody({ clientKey: uuid(813), mileage: 99_999 }) }, { afterTicket: fail })).rejects.toThrow('injected_stage_failure')
    await expect(createQuickTicket(db, { actor, body: cannedExistingBody({ clientKey: uuid(814) }) }, { afterLines: fail })).rejects.toThrow('injected_stage_failure')

    expect(await quickMutationState()).toEqual(before)
  })
})
