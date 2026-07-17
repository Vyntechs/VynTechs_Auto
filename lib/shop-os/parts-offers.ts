import { createHash } from 'node:crypto'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'
import type { AppDb } from '@/lib/db/queries'
import {
  customers,
  jobLines,
  profiles,
  quoteEvents,
  quoteVersions,
  sessions,
  ticketJobs,
  tickets,
  vehicles,
  vendorAccounts,
} from '@/lib/db/schema'
import { canBuildQuotes } from '@/lib/shop-os/capabilities'
import {
  ManualPartsAdapter,
  parseManualOfferSnapshot,
  validateStoredManualOfferLine,
  type ManualOfferSnapshotV1,
  type PartsAdapter,
} from '@/lib/shop-os/parts-adapters'
import { formatScaledDecimal, parseScaledDecimal, stableStringify } from '@/lib/shop-os/quote-math'
import { invalidateActiveQuoteVersionDeltaV1 } from '@/lib/shop-os/quotes'
import { assertLiveLockedMutationScopeV1 } from '@/lib/shop-os/continuity/mutation-foundation/attempt-capability'
import { ShopOsMutationNotFound } from '@/lib/shop-os/continuity/mutation-foundation/contracts'
import { ShopOsMutationConflict } from '@/lib/shop-os/continuity/mutation-foundation/conflicts'
import type {
  LockedMutationScopeV1,
  MutationLockRequestV1,
} from '@/lib/shop-os/continuity/mutation-foundation/lock-order'
import { finalizeMutationRevisionsV1 } from '@/lib/shop-os/continuity/mutation-foundation/revisions'
import { runBoundedShopOsMutationV1 } from '@/lib/shop-os/continuity/mutation-foundation/transaction-runner'

const MAX_INTEGER = 2_147_483_647
const MAX_QUANTITY_SCALED = 999_999_999_999n
const uuidSchema = z.uuid().transform((value) => value.toLowerCase())
const moneySchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const optionalText = (maximum: number) => z.string().trim().min(1).max(maximum).nullable().optional()

const captureSchema = z.strictObject({
  clientKey: uuidSchema,
  vendorAccountId: uuidSchema,
  description: z.string().trim().min(1).max(500),
  partNumber: optionalText(200),
  brand: optionalText(200),
  quantity: z.string().max(32),
  priceCents: moneySchema,
  unitCostCents: moneySchema,
  coreChargeCents: moneySchema,
  taxable: z.boolean(),
  availability: z.enum(['in_stock', 'special_order', 'unavailable', 'unknown']),
  fitment: optionalText(500),
  fulfillment: z.strictObject({
    method: z.enum(['pickup', 'delivery', 'ship', 'unknown']),
    locationLabel: optionalText(500),
  }),
  externalOfferId: optionalText(500),
})

export type ManualOfferActor = { profileId: string }

type CaptureBody = z.output<typeof captureSchema>
type StoredLine = typeof jobLines.$inferSelect

export type SafeManualOfferLine = {
  id: string
  jobId: string
  kind: 'part'
  description: string
  quantity: string
  priceCents: number
  taxable: boolean
  partNumber: string | null
  brand: string | null
  fitment: string | null
  source: 'vendor_offer'
  mutable: false
}

export type SafeManualOfferSourcing = {
  vendorAccountId: string
  displayName: string
  externalOfferId: string | null
  unitCostCents: number
  coreChargeCents: number
  availability: 'in_stock' | 'special_order' | 'unknown'
  fulfillment: {
    method: 'pickup' | 'delivery' | 'ship' | 'unknown'
    locationLabel: string | null
  }
  fetchedAt: string
}

export type ManualOfferResult =
  | { ok: true; changed: boolean; unavailable?: never; line: SafeManualOfferLine; sourcing: SafeManualOfferSourcing }
  | { ok: true; changed: false; unavailable: true }
  | { ok: true; changed: boolean; unavailable?: never; line?: never; sourcing?: never }
  | { ok: false; error: 'invalid_input' | 'not_found' | 'conflict'; retryable?: boolean }

export type ManualOfferDependencies = {
  adapter?: PartsAdapter
  beforeMutation?: () => Promise<void>
  afterDiscovery?: () => Promise<void>
  afterWrite?: () => Promise<void>
  afterFinalization?: () => Promise<void>
}

type Failure = Extract<ManualOfferResult, { ok: false }>

class AbortManualOffer extends Error {
  constructor(readonly failure: Failure) {
    super('abort_manual_offer')
  }
}

function notFound(): Failure {
  return { ok: false, error: 'not_found' }
}

function conflict(retryable = false): Failure {
  return { ok: false, error: 'conflict', retryable }
}

export function manualOfferActorFromProfile(profile: { id: string }): ManualOfferActor {
  return { profileId: profile.id }
}

export function manualOfferDomainStatus(
  result: { ok: boolean; error?: 'invalid_input' | 'not_found' | 'conflict' },
  successStatus = 200,
): number {
  if (result.ok) return successStatus
  if (result.error === 'invalid_input') return 422
  if (result.error === 'not_found') return 404
  return 409
}

export function manualOfferErrorBody(result: Failure): { error: Failure['error']; retryable?: true } {
  return result.retryable
    ? { error: result.error, retryable: true }
    : { error: result.error }
}

function canonicalQuantity(value: string): string | null {
  try {
    const scaled = parseScaledDecimal(value, 3)
    if (scaled <= 0n || scaled > MAX_QUANTITY_SCALED) return null
    return formatScaledDecimal(scaled, 3)
  } catch {
    return null
  }
}

function requestFingerprint(
  body: CaptureBody,
  context: { shopId: string; ticketId: string; jobId: string },
): string {
  return createHash('sha256').update(stableStringify({
    schemaVersion: 1,
    shopId: context.shopId,
    ticketId: context.ticketId,
    jobId: context.jobId,
    vendorAccountId: body.vendorAccountId,
    description: body.description,
    partNumber: body.partNumber ?? null,
    brand: body.brand ?? null,
    quantity: body.quantity,
    priceCents: body.priceCents,
    unitCostCents: body.unitCostCents,
    coreChargeCents: body.coreChargeCents,
    taxable: body.taxable,
    availability: body.availability,
    fitment: body.fitment ?? null,
    fulfillment: {
      method: body.fulfillment.method,
      locationLabel: body.fulfillment.locationLabel ?? null,
    },
    externalOfferId: body.externalOfferId ?? null,
  })).digest('hex')
}

function isCleanManualAccount(account: typeof vendorAccounts.$inferSelect): boolean {
  return account.vendor === 'manual'
    && account.mode === 'manual'
    && account.enabled
    && account.secretRef === null
    && account.nonSecretConfig !== null
    && typeof account.nonSecretConfig === 'object'
    && !Array.isArray(account.nonSecretConfig)
    && Object.keys(account.nonSecretConfig).length === 0
}

function isEligibleJob(job: Pick<typeof ticketJobs.$inferSelect, 'kind' | 'workStatus'>): boolean {
  return (job.kind === 'repair' || job.kind === 'maintenance')
    && (job.workStatus === 'open' || job.workStatus === 'blocked')
}

function isOfferLine(line: StoredLine): boolean {
  return validateStoredManualOfferLine(line) !== null
}

function safeResult(
  line: StoredLine,
  snapshot: ManualOfferSnapshotV1,
  changed: boolean,
): Extract<ManualOfferResult, { ok: true; line: SafeManualOfferLine }> {
  return {
    ok: true,
    changed,
    line: {
      id: line.id,
      jobId: line.jobId,
      kind: 'part',
      description: line.description,
      quantity: snapshot.quantity,
      priceCents: line.priceCents,
      taxable: line.taxable,
      partNumber: line.partNumber,
      brand: line.brand,
      fitment: line.fitment,
      source: 'vendor_offer',
      mutable: false,
    },
    sourcing: {
      vendorAccountId: snapshot.vendorAccountId,
      displayName: snapshot.vendorDisplayName,
      externalOfferId: snapshot.externalOfferId ?? null,
      unitCostCents: snapshot.unitCostCents,
      coreChargeCents: snapshot.coreChargeCents,
      availability: snapshot.availability,
      fulfillment: {
        method: snapshot.fulfillment.method,
        locationLabel: snapshot.fulfillment.locationLabel ?? null,
      },
      fetchedAt: snapshot.fetchedAt,
    },
  }
}

function exactReplay(
  line: StoredLine,
  body: CaptureBody,
  fingerprint: string,
  context: { jobId: string },
): Extract<ManualOfferResult, { ok: true; line: SafeManualOfferLine }> | null {
  if (line.jobId !== context.jobId || !isOfferLine(line)) return null
  const snapshot = validateStoredManualOfferLine(line)
  if (!snapshot
    || snapshot.requestFingerprint !== fingerprint
    || snapshot.vendorAccountId !== body.vendorAccountId
    || snapshot.quantity !== body.quantity
    || snapshot.unitCostCents !== body.unitCostCents
    || snapshot.coreChargeCents !== body.coreChargeCents
    || snapshot.availability !== body.availability
    || snapshot.fitment !== (body.fitment ?? null)
    || snapshot.fulfillment.method !== body.fulfillment.method
    || (snapshot.fulfillment.locationLabel ?? null) !== (body.fulfillment.locationLabel ?? null)
    || (snapshot.externalOfferId ?? null) !== (body.externalOfferId ?? null)
    || line.vendorAccountId !== body.vendorAccountId
    || line.externalOfferId !== (body.externalOfferId ?? null)
    || line.description !== body.description
    || line.quantity !== Number(body.quantity)
    || line.priceCents !== body.priceCents
    || line.taxable !== body.taxable
    || line.partNumber !== (body.partNumber ?? null)
    || line.brand !== (body.brand ?? null)
    || line.unitCostCents !== body.unitCostCents
    || line.coreChargeCents !== body.coreChargeCents
    || line.fitment !== (body.fitment ?? null)) return null
  return safeResult(line, snapshot, false)
}

async function loadActiveActor(db: AppDb, actor: ManualOfferActor) {
  const parsed = uuidSchema.safeParse(actor.profileId)
  if (!parsed.success) return null
  const [profile] = await db.select({ id: profiles.id, shopId: profiles.shopId, role: profiles.role })
    .from(profiles)
    .where(and(
      eq(profiles.id, parsed.data),
      eq(profiles.membershipStatus, 'active'),
      isNull(profiles.deactivatedAt),
    ))
    .limit(1)
  return profile?.shopId && canBuildQuotes(profile.role) ? profile : null
}

function emptyManualOfferInsertionIntents(): MutationLockRequestV1['insertionIntents'] {
  return Object.freeze({
    sessions: Object.freeze([]),
    customers: Object.freeze([]),
    vehicles: Object.freeze([]),
    tickets: Object.freeze([]),
    jobs: Object.freeze([]),
  })
}

function manualOfferUuidList(values: readonly (string | null | undefined)[]): readonly string[] {
  return Object.freeze([...new Set(values.filter(
    (value): value is string => typeof value === 'string',
  ))].sort())
}

function manualOfferFingerprint(value: unknown): string {
  const normalize = (member: unknown): unknown => {
    if (member instanceof Date) return { $date: member.toISOString() }
    if (typeof member === 'bigint') return { $bigint: member.toString() }
    if (
      member === null || member === undefined || typeof member === 'string' ||
      typeof member === 'number' || typeof member === 'boolean'
    ) return member ?? null
    if (Array.isArray(member)) return member.map(normalize)
    if (typeof member !== 'object') throw new TypeError('invalid_manual_offer_discovery_value')
    const result: Record<string, unknown> = Object.create(null)
    for (const key of Object.keys(member).sort()) {
      result[key] = normalize((member as Record<string, unknown>)[key])
    }
    return result
  }
  return JSON.stringify(normalize(value))
}

function manualOfferRowsById<T extends { id: string }>(rows: readonly T[]): readonly T[] {
  return [...rows].sort((left, right) => left.id.localeCompare(right.id))
}

type ManualOfferDiscovery = Readonly<{
  kind: 'not_found' | 'ready'
  separateChainIds: readonly string[]
  closureFingerprint: string | null
}>

function manualOfferActorOnlyRequest(
  shopId: string,
  actorProfileId: string,
): MutationLockRequestV1 {
  return Object.freeze({
    shopId,
    actorProfileId,
    profileIds: Object.freeze([actorProfileId]),
    lockShop: false,
    customerIds: Object.freeze([]),
    vehicleIds: Object.freeze([]),
    ticketIds: Object.freeze([]),
    jobIds: Object.freeze([]),
    includeAllJobsForTickets: false,
    includeAllLinesForJobs: false,
    includeAllQuoteVersionsForTickets: false,
    includeAllQuoteEventsForTickets: false,
    sessionIds: Object.freeze([]),
    sessionEventIds: Object.freeze([]),
    vendorAccountIds: Object.freeze([]),
    cannedJobIds: Object.freeze([]),
    receiptRequestKey: null,
    receiptConditionalInsert: null,
    insertionIntents: emptyManualOfferInsertionIntents(),
  })
}

async function discoverManualOfferMutation(
  tx: AppDb,
  input: Readonly<{
    shopId: string
    actorProfileId: string
    ticketId: string
    jobId: string
    requestedVendorAccountId: string | null
  }>,
): Promise<Readonly<{
  lockRequest: MutationLockRequestV1
  payload: ManualOfferDiscovery
}>> {
  const [target] = await tx.select().from(tickets).where(and(
    eq(tickets.shopId, input.shopId),
    eq(tickets.id, input.ticketId),
  )).limit(1)
  const [pair] = target ? await tx.select({ id: ticketJobs.id }).from(ticketJobs).where(and(
    eq(ticketJobs.shopId, input.shopId),
    eq(ticketJobs.ticketId, input.ticketId),
    eq(ticketJobs.id, input.jobId),
  )).limit(1) : []
  if (!target || !pair) return Object.freeze({
    lockRequest: manualOfferActorOnlyRequest(input.shopId, input.actorProfileId),
    payload: Object.freeze({
      kind: 'not_found', separateChainIds: Object.freeze([]), closureFingerprint: null,
    }),
  })

  const ticketRows = [target]
  const seenTicketIds = new Set([target.id])
  let parentId = target.separateFromTicketId
  while (parentId !== null) {
    if (ticketRows.length >= 64 || seenTicketIds.has(parentId)) {
      throw new ShopOsMutationConflict()
    }
    const [parent] = await tx.select().from(tickets).where(and(
      eq(tickets.shopId, input.shopId),
      eq(tickets.id, parentId),
    )).limit(1)
    if (!parent) throw new ShopOsMutationConflict()
    ticketRows.push(parent)
    seenTicketIds.add(parent.id)
    parentId = parent.separateFromTicketId
  }
  const ticketIds = manualOfferUuidList(ticketRows.map(({ id }) => id))
  const jobs = await tx.select().from(ticketJobs).where(and(
    eq(ticketJobs.shopId, input.shopId),
    inArray(ticketJobs.ticketId, ticketIds),
  )).orderBy(ticketJobs.id)
  const jobIds = manualOfferUuidList(jobs.map(({ id }) => id))
  const lines = jobIds.length === 0 ? [] : await tx.select().from(jobLines).where(and(
    eq(jobLines.shopId, input.shopId),
    inArray(jobLines.jobId, jobIds),
  )).orderBy(jobLines.id)
  const versions = await tx.select().from(quoteVersions).where(and(
    eq(quoteVersions.shopId, input.shopId),
    inArray(quoteVersions.ticketId, ticketIds),
  )).orderBy(quoteVersions.id)
  const events = await tx.select().from(quoteEvents).where(and(
    eq(quoteEvents.shopId, input.shopId),
    inArray(quoteEvents.ticketId, ticketIds),
  )).orderBy(quoteEvents.id)
  const sessionIds = manualOfferUuidList(jobs.map(({ sessionId }) => sessionId))
  const sessionRows = sessionIds.length === 0 ? [] : await tx.select().from(sessions).where(and(
    eq(sessions.shopId, input.shopId),
    inArray(sessions.id, sessionIds),
  )).orderBy(sessions.id)
  const vehicleIds = manualOfferUuidList([
    ...ticketRows.map(({ vehicleId }) => vehicleId),
    ...sessionRows.map(({ vehicleId }) => vehicleId),
  ])
  const vehicleRows = vehicleIds.length === 0 ? [] : (await tx.select({ row: vehicles })
    .from(vehicles)
    .innerJoin(customers, eq(customers.id, vehicles.customerId))
    .where(and(
      eq(customers.shopId, input.shopId),
      inArray(vehicles.id, vehicleIds),
    )).orderBy(vehicles.id)).map(({ row }) => row)
  const customerIds = manualOfferUuidList([
    ...ticketRows.map(({ customerId }) => customerId),
    ...vehicleRows.map(({ customerId }) => customerId),
  ])
  const customerRows = customerIds.length === 0 ? [] : await tx.select().from(customers).where(and(
    eq(customers.shopId, input.shopId),
    inArray(customers.id, customerIds),
  )).orderBy(customers.id)
  const vendorAccountIds = manualOfferUuidList([
    input.requestedVendorAccountId,
    ...lines.map(({ vendorAccountId }) => vendorAccountId),
  ])
  const vendorRows = vendorAccountIds.length === 0 ? [] : await tx.select().from(vendorAccounts)
    .where(and(
      eq(vendorAccounts.shopId, input.shopId),
      inArray(vendorAccounts.id, vendorAccountIds),
    )).orderBy(vendorAccounts.id)
  const profileIds = manualOfferUuidList([
    input.actorProfileId,
    ...ticketRows.flatMap((ticket) => [
      ticket.createdByProfileId,
      ticket.canceledByProfileId,
      ticket.deliveredByProfileId,
      ticket.closedByProfileId,
    ]),
    ...jobs.flatMap((job) => [
      job.assignedTechId,
      job.createdByProfileId,
      job.statementConfirmedByProfileId,
    ]),
    ...lines.flatMap((line) => [line.orderedByProfileId, line.receivedByProfileId]),
    ...sessionRows.map(({ techId }) => techId),
    ...versions.map(({ createdByProfileId }) => createdByProfileId),
    ...events.map(({ actorProfileId }) => actorProfileId),
  ])
  const profileRows = await tx.select().from(profiles).where(and(
    eq(profiles.shopId, input.shopId),
    inArray(profiles.id, profileIds),
  )).orderBy(profiles.id)
  const closureFingerprint = manualOfferFingerprint({
    profiles: manualOfferRowsById(profileRows),
    customers: manualOfferRowsById(customerRows),
    vehicles: manualOfferRowsById(vehicleRows),
    tickets: manualOfferRowsById(ticketRows),
    jobs: manualOfferRowsById(jobs),
    lines: manualOfferRowsById(lines),
    versions: manualOfferRowsById(versions),
    events: manualOfferRowsById(events),
    sessions: manualOfferRowsById(sessionRows),
    vendors: manualOfferRowsById(vendorRows),
  })
  return Object.freeze({
    lockRequest: Object.freeze({
      shopId: input.shopId,
      actorProfileId: input.actorProfileId,
      profileIds,
      lockShop: false,
      customerIds,
      vehicleIds,
      ticketIds,
      jobIds,
      includeAllJobsForTickets: true,
      includeAllLinesForJobs: true,
      includeAllQuoteVersionsForTickets: true,
      includeAllQuoteEventsForTickets: true,
      sessionIds,
      sessionEventIds: Object.freeze([]),
      vendorAccountIds,
      cannedJobIds: Object.freeze([]),
      receiptRequestKey: null,
      receiptConditionalInsert: null,
      insertionIntents: emptyManualOfferInsertionIntents(),
    }),
    payload: Object.freeze({
      kind: 'ready',
      separateChainIds: Object.freeze(ticketRows.map(({ id }) => id)),
      closureFingerprint,
    }),
  })
}

function resolveManualOfferScope(
  tx: AppDb,
  scope: LockedMutationScopeV1,
  discovery: ManualOfferDiscovery,
  ticketId: string,
  jobId: string,
): Readonly<{
  graph: LockedMutationScopeV1['tickets'][number]
  targetJob: LockedMutationScopeV1['tickets'][number]['jobs'][number]
}> {
  assertLiveLockedMutationScopeV1(tx, scope)
  if (discovery.kind === 'not_found') throw new ShopOsMutationNotFound()
  if (
    !canBuildQuotes(scope.actor.role) ||
    scope.profiles.length !== scope.request.profileIds.length ||
    scope.profiles.some(({ id }) => !scope.request.profileIds.includes(id)) ||
    scope.profiles.some((profile) =>
      profile.shopId !== scope.actor.shopId ||
      profile.membershipStatus !== 'active' || profile.deactivatedAt !== null ||
      (profile.skillTier !== null && ![1, 2, 3].includes(profile.skillTier)))
  ) throw new ShopOsMutationNotFound()
  const graphById = new Map(scope.tickets.map((graph) => [graph.ticket.id, graph] as const))
  if (
    discovery.separateChainIds.length < 1 || discovery.separateChainIds[0] !== ticketId ||
    discovery.separateChainIds.length !== scope.tickets.length ||
    new Set(discovery.separateChainIds).size !== discovery.separateChainIds.length
  ) throw new ShopOsMutationConflict()
  for (let index = 0; index < discovery.separateChainIds.length; index += 1) {
    const graph = graphById.get(discovery.separateChainIds[index]!)
    if (!graph || graph.ticket.separateFromTicketId !==
      (discovery.separateChainIds[index + 1] ?? null)) throw new ShopOsMutationConflict()
  }
  const lockedFingerprint = manualOfferFingerprint({
    profiles: manualOfferRowsById(scope.profiles),
    customers: manualOfferRowsById(scope.customers),
    vehicles: manualOfferRowsById(scope.vehicles),
    tickets: manualOfferRowsById(scope.tickets.map(({ ticket }) => ticket)),
    jobs: manualOfferRowsById(scope.tickets.flatMap(({ jobs }) => jobs)),
    lines: manualOfferRowsById(scope.tickets.flatMap(({ lines }) => lines)),
    versions: manualOfferRowsById(scope.tickets.flatMap(({ versions }) => versions)),
    events: manualOfferRowsById(scope.tickets.flatMap(({ events }) => events)),
    sessions: manualOfferRowsById(scope.sessions),
    vendors: manualOfferRowsById(scope.vendorAccounts),
  })
  if (lockedFingerprint !== discovery.closureFingerprint) throw new ShopOsMutationConflict()
  const graph = graphById.get(ticketId)
  const targetJob = graph?.jobs.find(({ id }) => id === jobId)
  if (
    !graph || !targetJob || graph.ticket.status !== 'open' ||
    !graph.ticket.customerId || !graph.ticket.vehicleId || !isEligibleJob(targetJob)
  ) throw new ShopOsMutationNotFound()
  return Object.freeze({ graph, targetJob })
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (typeof current === 'object' && 'code' in current && current.code === '23505') return true
    current = typeof current === 'object' && 'cause' in current ? current.cause : null
  }
  return false
}

export async function captureManualOffer(
  db: AppDb,
  input: { actor: ManualOfferActor; ticketId: unknown; jobId: unknown; body: unknown },
  dependencies: ManualOfferDependencies = {},
): Promise<ManualOfferResult> {
  const parsedActor = uuidSchema.safeParse(input.actor.profileId)
  const parsedTicket = uuidSchema.safeParse(input.ticketId)
  const parsedJob = uuidSchema.safeParse(input.jobId)
  const parsedBody = captureSchema.safeParse(input.body)
  if (!parsedActor.success || !parsedTicket.success || !parsedJob.success || !parsedBody.success) {
    return { ok: false, error: 'invalid_input' }
  }
  const quantity = canonicalQuantity(parsedBody.data.quantity)
  if (!quantity) return { ok: false, error: 'invalid_input' }
  const body: CaptureBody = { ...parsedBody.data, quantity }
  const persistedActor = await loadActiveActor(db, { profileId: parsedActor.data })
  if (!persistedActor?.shopId) return notFound()
  const adapter = dependencies.adapter ?? new ManualPartsAdapter()
  const seams = Object.freeze({
    beforeMutation: dependencies.beforeMutation,
    afterDiscovery: dependencies.afterDiscovery,
    afterWrite: dependencies.afterWrite,
    afterFinalization: dependencies.afterFinalization,
  })

  try {
    return await runBoundedShopOsMutationV1<ManualOfferResult, ManualOfferDiscovery>(db, {
      discover: async (tx) => discoverManualOfferMutation(tx, {
        shopId: persistedActor.shopId as string,
        actorProfileId: persistedActor.id,
        ticketId: parsedTicket.data,
        jobId: parsedJob.data,
        requestedVendorAccountId: body.vendorAccountId,
      }),
      executeLocked: async (tx, scope, discovery) => {
      assertLiveLockedMutationScopeV1(tx, scope)
      const { graph, targetJob } = resolveManualOfferScope(
        tx,
        scope,
        discovery,
        parsedTicket.data,
        parsedJob.data,
      )
      await seams.afterDiscovery?.()
      const activeVersions = graph.versions.filter(({ supersededAt }) => supersededAt === null)
      if (activeVersions.length > 1) throw new AbortManualOffer(conflict())
      const fingerprint = requestFingerprint(body, {
        shopId: scope.actor.shopId,
        ticketId: graph.ticket.id,
        jobId: targetJob.id,
      })
      const collision = graph.lines.find((line) => line.id === body.clientKey)
      if (collision) {
        const replay = exactReplay(collision, body, fingerprint, { jobId: targetJob.id })
        if (replay) return replay
        throw new AbortManualOffer(conflict())
      }

      const account = scope.vendorAccounts.find(({ id }) => id === body.vendorAccountId)
      if (!account || !isCleanManualAccount(account)) throw new ShopOsMutationNotFound()
      let refreshed: Awaited<ReturnType<PartsAdapter['refreshOffer']>>
      try {
        refreshed = await adapter.refreshOffer({
          description: body.description,
          partNumber: body.partNumber ?? null,
          brand: body.brand ?? null,
          quantity: body.quantity,
          unitCostCents: body.unitCostCents,
          coreChargeCents: body.coreChargeCents,
          availability: body.availability,
          fitment: body.fitment ?? null,
          fulfillment: {
            method: body.fulfillment.method,
            locationLabel: body.fulfillment.locationLabel ?? null,
          },
          externalOfferId: body.externalOfferId ?? null,
          verifyingProfileId: scope.actor.id,
        })
      } catch {
        return { ok: false, error: 'invalid_input' }
      }
      if (refreshed.kind === 'unavailable') {
        return { ok: true, changed: false, unavailable: true }
      }
      const offer = refreshed.offer
      if (offer.description !== body.description
        || offer.partNumber !== (body.partNumber ?? null)
        || offer.brand !== (body.brand ?? null)
        || offer.quantity !== body.quantity
        || offer.unitCostCents !== body.unitCostCents
        || offer.coreChargeCents !== body.coreChargeCents
        || offer.availability !== body.availability
        || offer.fitment !== (body.fitment ?? null)
        || offer.fulfillment.method !== body.fulfillment.method
        || offer.fulfillment.locationLabel !== (body.fulfillment.locationLabel ?? null)
        || offer.externalOfferId !== (body.externalOfferId ?? null)
        || offer.currency !== 'USD'
        || offer.verifiedByProfileId !== scope.actor.id) {
        return { ok: false, error: 'invalid_input' }
      }
      const snapshot: ManualOfferSnapshotV1 = {
        schemaVersion: 1,
        kind: 'manual_offer',
        vendorAccountId: account.id,
        vendorDisplayName: account.displayName,
        externalOfferId: offer.externalOfferId,
        currency: 'USD',
        quantity: offer.quantity,
        unitCostCents: offer.unitCostCents,
        coreChargeCents: offer.coreChargeCents,
        availability: offer.availability,
        fitment: offer.fitment,
        fulfillment: offer.fulfillment,
        fetchedAt: offer.fetchedAt,
        verifiedByProfileId: offer.verifiedByProfileId,
        requestFingerprint: fingerprint,
      }
      const strictSnapshot = parseManualOfferSnapshot(snapshot)
      if (!strictSnapshot) return { ok: false, error: 'invalid_input' }
      const maximumSort = graph.lines
        .filter((line) => line.jobId === targetJob.id)
        .reduce((maximum, line) => Math.max(maximum, line.sort), -1)
      if (!Number.isSafeInteger(maximumSort) || maximumSort >= MAX_INTEGER) {
        throw new AbortManualOffer(conflict())
      }
      await seams.beforeMutation?.()
      const [line] = await tx.insert(jobLines).values({
        id: body.clientKey,
        shopId: scope.actor.shopId,
        jobId: targetJob.id,
        kind: 'part',
        description: offer.description,
        sort: maximumSort + 1,
        quantity: Number(offer.quantity),
        priceCents: body.priceCents,
        taxable: body.taxable,
        partNumber: offer.partNumber,
        brand: offer.brand,
        unitCostCents: offer.unitCostCents,
        coreChargeCents: offer.coreChargeCents,
        fitment: offer.fitment,
        vendorAccountId: account.id,
        externalOfferId: offer.externalOfferId,
        vendorSnapshot: strictSnapshot,
        partStatus: 'proposed',
        source: 'vendor_offer',
      }).returning()
      const invalidation = await invalidateActiveQuoteVersionDeltaV1(tx, {
        shopId: scope.actor.shopId,
        ticketId: graph.ticket.id,
        jobIds: graph.jobs.map(({ id }) => id),
        activeVersions,
        scope,
      })
      if ('ok' in invalidation) throw new AbortManualOffer(invalidation)
      await seams.afterWrite?.()
      await finalizeMutationRevisionsV1(
        tx,
        scope,
        { sessionIds: [], customerIds: [], vehicleIds: [] },
        [{
          ticketId: graph.ticket.id,
          createdTicket: false,
          createdJobIds: [],
          existingChangedJobIds: [...new Set([
            targetJob.id,
            ...invalidation.changedJobIds,
          ])].sort(),
          actorVisibleTicketFieldsChanged: false,
        }],
      )
      await seams.afterFinalization?.()
      return safeResult(line, strictSnapshot, true)
      },
    })
  } catch (error) {
    if (error instanceof AbortManualOffer) return error.failure
    if (error instanceof ShopOsMutationNotFound) return notFound()
    if (error instanceof ShopOsMutationConflict) return conflict(true)
    if (isUniqueViolation(error)) return conflict()
    throw error
  }
}

export async function removeManualOffer(
  db: AppDb,
  input: { actor: ManualOfferActor; ticketId: unknown; jobId: unknown; lineId: unknown },
  dependencies: ManualOfferDependencies = {},
): Promise<ManualOfferResult> {
  const parsedActor = uuidSchema.safeParse(input.actor.profileId)
  const parsedTicket = uuidSchema.safeParse(input.ticketId)
  const parsedJob = uuidSchema.safeParse(input.jobId)
  const parsedLine = uuidSchema.safeParse(input.lineId)
  if (!parsedActor.success || !parsedTicket.success || !parsedJob.success || !parsedLine.success) {
    return { ok: false, error: 'invalid_input' }
  }
  const persistedActor = await loadActiveActor(db, { profileId: parsedActor.data })
  if (!persistedActor?.shopId) return notFound()
  const seams = Object.freeze({
    beforeMutation: dependencies.beforeMutation,
    afterDiscovery: dependencies.afterDiscovery,
    afterWrite: dependencies.afterWrite,
    afterFinalization: dependencies.afterFinalization,
  })

  try {
    return await runBoundedShopOsMutationV1<ManualOfferResult, ManualOfferDiscovery>(db, {
      discover: async (tx) => discoverManualOfferMutation(tx, {
        shopId: persistedActor.shopId as string,
        actorProfileId: persistedActor.id,
        ticketId: parsedTicket.data,
        jobId: parsedJob.data,
        requestedVendorAccountId: null,
      }),
      executeLocked: async (tx, scope, discovery) => {
      assertLiveLockedMutationScopeV1(tx, scope)
      const { graph, targetJob } = resolveManualOfferScope(
        tx,
        scope,
        discovery,
        parsedTicket.data,
        parsedJob.data,
      )
      await seams.afterDiscovery?.()
      const activeVersions = graph.versions.filter(({ supersededAt }) => supersededAt === null)
      if (activeVersions.length > 1) throw new AbortManualOffer(conflict())
      const line = graph.lines.find((candidate) =>
        candidate.id === parsedLine.data && candidate.jobId === targetJob.id)
      if (!line) return { ok: true, changed: false }
      const account = line.vendorAccountId === null
        ? null
        : scope.vendorAccounts.find(({ id }) => id === line.vendorAccountId)
      if (!account || !validateStoredManualOfferLine(line)
        || line.vendorAccountId !== account.id) throw new ShopOsMutationNotFound()
      await seams.beforeMutation?.()
      const [deleted] = await tx.delete(jobLines).where(and(
        eq(jobLines.shopId, scope.actor.shopId),
        eq(jobLines.jobId, targetJob.id),
        eq(jobLines.id, parsedLine.data),
      )).returning()
      if (!deleted) throw new AbortManualOffer(conflict(true))
      const invalidation = await invalidateActiveQuoteVersionDeltaV1(tx, {
        shopId: scope.actor.shopId,
        ticketId: graph.ticket.id,
        jobIds: graph.jobs.map(({ id }) => id),
        activeVersions,
        scope,
      })
      if ('ok' in invalidation) throw new AbortManualOffer(invalidation)
      await seams.afterWrite?.()
      await finalizeMutationRevisionsV1(
        tx,
        scope,
        { sessionIds: [], customerIds: [], vehicleIds: [] },
        [{
          ticketId: graph.ticket.id,
          createdTicket: false,
          createdJobIds: [],
          existingChangedJobIds: [...new Set([
            targetJob.id,
            ...invalidation.changedJobIds,
          ])].sort(),
          actorVisibleTicketFieldsChanged: false,
        }],
      )
      await seams.afterFinalization?.()
      return { ok: true, changed: true }
      },
    })
  } catch (error) {
    if (error instanceof AbortManualOffer) return error.failure
    if (error instanceof ShopOsMutationNotFound) return notFound()
    if (error instanceof ShopOsMutationConflict) return conflict(true)
    throw error
  }
}

export function publicManualOfferResult(result: Extract<ManualOfferResult, { ok: true }>): object {
  if ('unavailable' in result && result.unavailable) {
    return { changed: false, unavailable: true }
  }
  if (!('line' in result) || !result.line || !('sourcing' in result) || !result.sourcing) {
    return { changed: result.changed }
  }
  return {
    changed: result.changed,
    line: {
      id: result.line.id,
      jobId: result.line.jobId,
      kind: 'part',
      description: result.line.description,
      quantity: result.line.quantity,
      priceCents: result.line.priceCents,
      taxable: result.line.taxable,
      partNumber: result.line.partNumber,
      brand: result.line.brand,
      fitment: result.line.fitment,
      source: 'vendor_offer',
      mutable: false,
    },
    sourcing: {
      vendorAccountId: result.sourcing.vendorAccountId,
      displayName: result.sourcing.displayName,
      externalOfferId: result.sourcing.externalOfferId,
      unitCostCents: result.sourcing.unitCostCents,
      coreChargeCents: result.sourcing.coreChargeCents,
      availability: result.sourcing.availability,
      fulfillment: {
        method: result.sourcing.fulfillment.method,
        locationLabel: result.sourcing.fulfillment.locationLabel,
      },
      fetchedAt: result.sourcing.fetchedAt,
    },
  }
}
