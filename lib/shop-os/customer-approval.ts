import { createHash } from 'node:crypto'
import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import { z } from 'zod'
import type { AppDb } from '@/lib/db/queries'
import {
  customers,
  profiles,
  quoteEvents,
  quoteSends,
  quoteVersions,
  shops,
  ticketJobs,
  tickets,
  vehicles,
} from '@/lib/db/schema'
import { canSendQuotes } from '@/lib/shop-os/capabilities'
import { calculateTicketTotals, type QuoteCustomerStoryV1 } from '@/lib/shop-os/quote-math'
import { deliveryRetainUntil } from '@/lib/shop-os/messaging-retention-policy'
import { isLockUnavailable, readCustomerApprovalSnapshot } from '@/lib/shop-os/quotes'
import { isCustomerApprovalEnabled } from '@/lib/release-policy'

const uuid = z.uuid().transform((value) => value.toLowerCase())
const hash = z.string().regex(/^[0-9a-f]{64}$/)
const bearerToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
const createBody = z.strictObject({
  requestKey: uuid,
  quoteVersionId: uuid,
  tokenHash: hash,
})
const decision = z.strictObject({
  jobId: uuid,
  decision: z.enum(['approved', 'declined']),
})
const responseBody = z.strictObject({
  requestKey: uuid,
  decisions: z.array(decision).min(1).max(200),
})
const LINK_TTL_MS = 7 * 24 * 60 * 60 * 1_000

type Failure = { ok: false; error: 'invalid_input' | 'not_found' | 'conflict' | 'unavailable'; retryable?: true }
type LinkActor = { profileId: string }
type LinkResult = Failure | {
  ok: true
  changed: boolean
  link: { id: string; quoteVersionId: string; versionNumber: number; expiresAt: string }
}
export type CustomerApprovalQuote = {
  shop: { name: string; phone: string | null }
  customer: { name: string }
  vehicle: { year: number | null; make: string | null; model: string | null }
  ticketNumber: number
  versionNumber: number
  expiresAt: string
  jobs: Array<{
    id: string
    title: string
    story: CustomerApprovalStory | null
    lines: Array<{
      kind: 'part' | 'labor' | 'fee'
      description: string
      quantity: string
      priceCents: number
    }>
    subtotalCents: number
    taxableSubtotalCents: number
  }>
  totals: { subtotalCents: number; taxCents: number; totalCents: number }
  taxRateBps: number
}
type CustomerApprovalStory = Pick<
  QuoteCustomerStoryV1,
  'whatYouToldUs' | 'whatWeFound' | 'whatItMeansIfWaived' | 'whatWeRecommend'
> & { howWeKnow: Array<{ claim: string }> }
type LoadResult = Failure | { ok: true; quote: CustomerApprovalQuote }
type ApprovalDecision = { jobId: string; decision: 'approved' | 'declined' }
type Receipt = {
  versionNumber: number
  decisions: ApprovalDecision[]
  approvedTotalCents: number
}
type ResponseResult = Failure | { ok: true; changed: boolean; receipt: Receipt }

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function linkRequestFingerprint(tokenHash: string): string {
  return sha256(`shop-os-approval-link-v1\0${tokenHash}`)
}

function destinationFingerprint(phone: string, tokenHash: string): string {
  return sha256(`shop-os-approval-destination-v1\0${phone}\0${tokenHash}`)
}

function tokenHashFor(raw: string): string | null {
  const parsed = bearerToken.safeParse(raw)
  return parsed.success ? sha256(parsed.data) : null
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (typeof current === 'object' && 'code' in current && current.code === '23505') return true
    current = typeof current === 'object' && 'cause' in current ? current.cause : null
  }
  return false
}

function safeIso(value: Date): string {
  return value.toISOString()
}

function customerStory(story: QuoteCustomerStoryV1 | null): CustomerApprovalStory | null {
  if (!story) return null
  return {
    whatYouToldUs: story.whatYouToldUs,
    whatWeFound: story.whatWeFound,
    howWeKnow: story.howWeKnow.map(({ claim }) => ({ claim })),
    whatItMeansIfWaived: story.whatItMeansIfWaived,
    whatWeRecommend: story.whatWeRecommend,
  }
}

function approvedTotal(
  snapshot: NonNullable<ReturnType<typeof readCustomerApprovalSnapshot>>,
  decisions: ApprovalDecision[],
): number {
  const approved = new Set(decisions.filter((item) => item.decision === 'approved').map((item) => item.jobId))
  return calculateTicketTotals(
    snapshot.jobs
      .filter((job) => approved.has(job.id))
      .flatMap((job) => [
        { extendedCents: job.taxableSubtotalCents, taxable: true },
        { extendedCents: job.subtotalCents - job.taxableSubtotalCents, taxable: false },
      ]).filter((line) => line.extendedCents > 0),
    snapshot.taxRateBps,
  ).totalCents
}

export async function createCustomerApprovalLink(
  db: AppDb,
  input: { actor: LinkActor; ticketId: unknown; body: unknown },
): Promise<LinkResult> {
  if (!isCustomerApprovalEnabled()) return { ok: false, error: 'unavailable' }
  const actorId = uuid.safeParse(input.actor.profileId)
  const ticketId = uuid.safeParse(input.ticketId)
  const body = createBody.safeParse(input.body)
  if (!actorId.success || !ticketId.success || !body.success) {
    return { ok: false, error: 'invalid_input' }
  }
  const [actor] = await db.select({ id: profiles.id, shopId: profiles.shopId, role: profiles.role })
    .from(profiles).where(and(
      eq(profiles.id, actorId.data),
      eq(profiles.membershipStatus, 'active'),
      isNull(profiles.deactivatedAt),
    )).limit(1)
  if (!actor?.shopId || !canSendQuotes(actor.role)) return { ok: false, error: 'not_found' }

  try {
    return await db.transaction(async (tx) => {
    const transactionDb = tx as AppDb
    const [ticket] = await transactionDb.select().from(tickets).where(and(
      eq(tickets.shopId, actor.shopId as string),
      eq(tickets.id, ticketId.data),
    )).limit(1).for('update', { noWait: true })
    if (!ticket || ticket.status !== 'open' || !ticket.customerId || !ticket.vehicleId) {
      return { ok: false, error: 'not_found' } as const
    }
    const jobs = await transactionDb.select().from(ticketJobs).where(and(
      eq(ticketJobs.shopId, actor.shopId as string),
      eq(ticketJobs.ticketId, ticket.id),
    )).orderBy(ticketJobs.id).for('update', { noWait: true })
    const versions = await transactionDb.select().from(quoteVersions).where(and(
      eq(quoteVersions.shopId, actor.shopId as string),
      eq(quoteVersions.ticketId, ticket.id),
    )).orderBy(quoteVersions.id).for('update', { noWait: true })
    const [freshActor] = await transactionDb.select({ id: profiles.id, role: profiles.role })
      .from(profiles).where(and(
        eq(profiles.id, actor.id),
        eq(profiles.shopId, actor.shopId as string),
        eq(profiles.membershipStatus, 'active'),
        isNull(profiles.deactivatedAt),
      )).limit(1).for('update', { noWait: true })
    if (!freshActor || !canSendQuotes(freshActor.role)) return { ok: false, error: 'not_found' } as const
    const sends = await transactionDb.select().from(quoteSends).where(and(
      eq(quoteSends.shopId, actor.shopId as string),
      eq(quoteSends.ticketId, ticket.id),
    )).orderBy(quoteSends.id).for('update', { noWait: true })

    const fingerprint = linkRequestFingerprint(body.data.tokenHash)
    const now = new Date()
    const active = versions.filter((version) => version.supersededAt === null)
    const replay = sends.find((send) => send.requestingActorProfileId === actor.id
      && send.requestKey === body.data.requestKey)
    if (replay) {
      if (replay.channel !== 'link' || replay.quoteVersionId !== body.data.quoteVersionId
        || replay.requestFingerprint !== fingerprint || replay.state !== 'submitted'
        || replay.tokenHash !== body.data.tokenHash || !replay.tokenExpiresAt) {
        return { ok: false, error: 'conflict' } as const
      }
      const replayVersion = versions.find((version) => version.id === replay.quoteVersionId)
      if (!replayVersion || replayVersion.supersededAt) {
        await expireLink(transactionDb, replay)
        return { ok: false, error: 'conflict' } as const
      }
      if (replay.tokenExpiresAt.getTime() <= now.getTime()) {
        await expireLink(transactionDb, replay)
        return { ok: false, error: 'conflict' } as const
      }
      const replaySnapshot = readCustomerApprovalSnapshot(replayVersion.snapshot, ticket)
      if (active.length !== 1 || active[0]?.id !== replayVersion.id || !replaySnapshot
        || replaySnapshot.jobs.some((snapshotJob) => {
          const current = jobs.find((job) => job.id === snapshotJob.id)
          return !current || !['quote_ready', 'sent'].includes(current.approvalState)
            || current.approvedQuoteVersionId !== null
        })) {
        await expireLink(transactionDb, replay)
        return { ok: false, error: 'conflict' } as const
      }
      return {
        ok: true,
        changed: false,
        link: {
          id: replay.id,
          quoteVersionId: replay.quoteVersionId,
          versionNumber: replayVersion.versionNumber,
          expiresAt: safeIso(replay.tokenExpiresAt),
        },
      } as const
    }

    if (active.length > 1) return { ok: false, error: 'conflict' } as const
    const version = active[0] ?? null
    if (version && version.id !== body.data.quoteVersionId) {
      return { ok: false, error: 'conflict' } as const
    }
    const snapshot = version ? readCustomerApprovalSnapshot(version.snapshot, ticket) : null
    if (!version || !snapshot
      || snapshot.jobs.some((snapshotJob) => {
        const current = jobs.find((job) => job.id === snapshotJob.id)
        return !current || !['quote_ready', 'sent'].includes(current.approvalState)
          || current.approvedQuoteVersionId !== null
      })) {
      return { ok: false, error: 'not_found' } as const
    }
    const [customer] = await transactionDb.select({ id: customers.id, phone: customers.phone })
      .from(customers).where(and(
        eq(customers.shopId, actor.shopId as string),
        eq(customers.id, ticket.customerId),
      )).limit(1)
    if (!customer) return { ok: false, error: 'not_found' } as const

    const retainUntil = deliveryRetainUntil(now)
    for (const send of sends.filter((candidate) => candidate.channel === 'link'
      && candidate.quoteVersionId === version.id && candidate.state === 'submitted')) {
      await transactionDb.update(quoteSends).set({
        state: 'expired',
        tokenHash: null,
        tokenExpiresAt: null,
        terminalAt: now,
        retainUntil,
        updatedAt: now,
      }).where(eq(quoteSends.id, send.id))
    }

    const expiresAt = new Date(now.getTime() + LINK_TTL_MS)
    const [created] = await transactionDb.insert(quoteSends).values({
      shopId: actor.shopId as string,
      ticketId: ticket.id,
      quoteVersionId: version.id,
      customerId: customer.id,
      subjectKey: customer.id,
      destinationFingerprint: destinationFingerprint(customer.phone, body.data.tokenHash),
      fingerprintKeyVersion: 'link_v1',
      channel: 'link',
      tokenHash: body.data.tokenHash,
      tokenExpiresAt: expiresAt,
      requestingActorProfileId: actor.id,
      requestKey: body.data.requestKey,
      requestFingerprint: fingerprint,
      state: 'submitted',
      submittingAt: now,
      submittedAt: now,
      createdAt: now,
      updatedAt: now,
    }).returning()
    return {
      ok: true,
      changed: true,
      link: {
        id: created.id,
        quoteVersionId: version.id,
        versionNumber: version.versionNumber,
        expiresAt: safeIso(expiresAt),
      },
    } as const
    })
  } catch (error) {
    if (isLockUnavailable(error)) return { ok: false, error: 'conflict', retryable: true }
    if (isUniqueViolation(error)) return { ok: false, error: 'conflict' }
    throw error
  }
}

async function findLinkHint(db: AppDb, rawToken: string, includeResponded: boolean) {
  const tokenHash = tokenHashFor(rawToken)
  if (!tokenHash) return null
  const requestFingerprint = linkRequestFingerprint(tokenHash)
  const [send] = await db.select().from(quoteSends).where(and(
    eq(quoteSends.channel, 'link'),
    includeResponded
      ? or(eq(quoteSends.tokenHash, tokenHash), and(
        eq(quoteSends.requestFingerprint, requestFingerprint),
        eq(quoteSends.state, 'responded'),
      ))
      : eq(quoteSends.tokenHash, tokenHash),
  )).limit(1)
  return send ? { send, tokenHash } : null
}

async function lockedApprovalContext(db: AppDb, sendId: string) {
  const hint = await db.select().from(quoteSends).where(eq(quoteSends.id, sendId)).limit(1)
  const initial = hint[0]
  if (!initial) return null
  const [ticket] = await db.select().from(tickets).where(and(
    eq(tickets.shopId, initial.shopId), eq(tickets.id, initial.ticketId),
  )).limit(1).for('update', { noWait: true })
  if (!ticket) return null
  const jobs = await db.select().from(ticketJobs).where(and(
    eq(ticketJobs.shopId, initial.shopId), eq(ticketJobs.ticketId, ticket.id),
  )).orderBy(ticketJobs.id).for('update', { noWait: true })
  const versions = await db.select().from(quoteVersions).where(and(
    eq(quoteVersions.shopId, initial.shopId), eq(quoteVersions.ticketId, ticket.id),
  )).orderBy(quoteVersions.id).for('update', { noWait: true })
  const [send] = await db.select().from(quoteSends).where(and(
    eq(quoteSends.shopId, initial.shopId), eq(quoteSends.id, initial.id),
  )).limit(1).for('update', { noWait: true })
  return send ? { ticket, jobs, versions, send } : null
}

function validActiveContext(
  context: NonNullable<Awaited<ReturnType<typeof lockedApprovalContext>>>,
  tokenHash: string,
  now: Date,
) {
  const active = context.versions.filter((version) => version.supersededAt === null)
  const version = active.length === 1 ? active[0] : null
  const snapshot = version ? readCustomerApprovalSnapshot(version.snapshot, context.ticket) : null
  if (!version || !snapshot || context.send.channel !== 'link'
    || context.send.state !== 'submitted' || context.send.tokenHash !== tokenHash
    || !context.send.tokenExpiresAt || context.send.tokenExpiresAt.getTime() <= now.getTime()
    || context.send.quoteVersionId !== version.id || context.ticket.status !== 'open'
    || !context.ticket.customerId || !context.ticket.vehicleId
    || snapshot.jobs.some((job) => {
      const current = context.jobs.find((candidate) => candidate.id === job.id)
      return !current || !['quote_ready', 'sent'].includes(current.approvalState)
        || current.approvedQuoteVersionId !== null
    })) return null
  return { version, snapshot }
}

async function expireLink(db: AppDb, send: typeof quoteSends.$inferSelect): Promise<void> {
  if (send.state !== 'submitted') return
  const now = new Date()
  await db.update(quoteSends).set({
    state: 'expired',
    tokenHash: null,
    tokenExpiresAt: null,
    terminalAt: now,
    retainUntil: deliveryRetainUntil(now),
    updatedAt: now,
  }).where(and(
    eq(quoteSends.id, send.id),
    eq(quoteSends.state, 'submitted'),
  ))
}

export async function loadCustomerApproval(
  db: AppDb,
  input: { token: unknown },
): Promise<LoadResult> {
  if (!isCustomerApprovalEnabled()) return { ok: false, error: 'unavailable' }
  if (typeof input.token !== 'string') return { ok: false, error: 'invalid_input' }
  const hint = await findLinkHint(db, input.token, false)
  if (!hint) return { ok: false, error: 'unavailable' }
  try {
    return await db.transaction(async (tx) => {
    const transactionDb = tx as AppDb
    const context = await lockedApprovalContext(transactionDb, hint.send.id)
    if (!context) return { ok: false, error: 'unavailable' } as const
    const active = validActiveContext(context, hint.tokenHash, new Date())
    if (!active) {
      await expireLink(transactionDb, context.send)
      return { ok: false, error: 'unavailable' } as const
    }
    const [shop] = await transactionDb.select({ name: shops.name, phone: shops.phone })
      .from(shops).where(eq(shops.id, context.send.shopId)).limit(1)
    const [customer] = await transactionDb.select({ name: customers.name })
      .from(customers).where(and(
        eq(customers.shopId, context.send.shopId),
        eq(customers.id, context.ticket.customerId as string),
      )).limit(1)
    const [vehicle] = await transactionDb.select({
      year: vehicles.year,
      make: vehicles.make,
      model: vehicles.model,
    }).from(vehicles).where(and(
      eq(vehicles.customerId, context.ticket.customerId as string),
      eq(vehicles.id, context.ticket.vehicleId as string),
    )).limit(1)
    if (!shop || !customer || !vehicle) return { ok: false, error: 'unavailable' } as const

    const viewKey = `approval-view:${context.send.id}`
    const [viewed] = await transactionDb.select({ id: quoteEvents.id }).from(quoteEvents)
      .where(and(eq(quoteEvents.shopId, context.send.shopId), eq(quoteEvents.requestKey, viewKey)))
      .limit(1)
    if (!viewed) await transactionDb.insert(quoteEvents).values({
      shopId: context.send.shopId,
      ticketId: context.ticket.id,
      quoteVersionId: active.version.id,
      quoteSendId: context.send.id,
      kind: 'viewed',
      actorProfileId: null,
      approvedVia: null,
      requestKey: viewKey,
    })
    const jobIds = active.snapshot.jobs.map((job) => job.id)
    await transactionDb.update(ticketJobs).set({ approvalState: 'sent', updatedAt: new Date() })
      .where(and(
        eq(ticketJobs.shopId, context.send.shopId),
        eq(ticketJobs.ticketId, context.ticket.id),
        inArray(ticketJobs.id, jobIds),
        eq(ticketJobs.approvalState, 'quote_ready'),
      ))
    return {
      ok: true,
      quote: {
        shop,
        customer,
        vehicle,
        ticketNumber: context.ticket.ticketNumber,
        versionNumber: active.version.versionNumber,
        expiresAt: safeIso(context.send.tokenExpiresAt as Date),
        jobs: active.snapshot.jobs.map((job) => ({
          id: job.id,
          title: job.title,
          story: customerStory(job.story),
          lines: job.lines,
          subtotalCents: job.subtotalCents,
          taxableSubtotalCents: job.taxableSubtotalCents,
        })),
        totals: active.snapshot.totals,
        taxRateBps: active.snapshot.taxRateBps,
      },
    } as const
    })
  } catch (error) {
    if (isLockUnavailable(error)) return { ok: false, error: 'conflict', retryable: true }
    throw error
  }
}

function eventKey(requestKey: string, jobId: string): string {
  return `approval-response:${requestKey}:${jobId}`
}

export async function recordCustomerApprovalResponse(
  db: AppDb,
  input: { token: unknown; body: unknown },
): Promise<ResponseResult> {
  if (!isCustomerApprovalEnabled()) return { ok: false, error: 'unavailable' }
  if (typeof input.token !== 'string') return { ok: false, error: 'invalid_input' }
  const body = responseBody.safeParse(input.body)
  if (!body.success) return { ok: false, error: 'invalid_input' }
  const hint = await findLinkHint(db, input.token, true)
  if (!hint) return { ok: false, error: 'unavailable' }
  try {
    return await db.transaction(async (tx) => {
    const transactionDb = tx as AppDb
    const context = await lockedApprovalContext(transactionDb, hint.send.id)
    if (!context) return { ok: false, error: 'unavailable' } as const
    const activeVersion = context.versions.find((version) => version.id === context.send.quoteVersionId)
    const snapshot = activeVersion
      ? readCustomerApprovalSnapshot(activeVersion.snapshot, context.ticket)
      : null
    if (!activeVersion || !snapshot) return { ok: false, error: 'unavailable' } as const

    const normalized = body.data.decisions.slice().sort((left, right) => left.jobId.localeCompare(right.jobId))
    const snapshotIds = snapshot.jobs.map((job) => job.id).sort()
    if (new Set(normalized.map((item) => item.jobId)).size !== normalized.length
      || normalized.length !== snapshotIds.length
      || normalized.some((item, index) => item.jobId !== snapshotIds[index])) {
      return { ok: false, error: 'invalid_input' } as const
    }

    if (context.send.state === 'responded') {
      const events = await transactionDb.select().from(quoteEvents).where(and(
        eq(quoteEvents.shopId, context.send.shopId),
        eq(quoteEvents.quoteSendId, context.send.id),
        inArray(quoteEvents.kind, ['approved', 'declined']),
      )).orderBy(quoteEvents.jobId)
      const matches = normalized.every((item) => events.some((event) =>
        event.jobId === item.jobId && event.kind === item.decision
        && event.requestKey === eventKey(body.data.requestKey, item.jobId)))
      return matches && events.length === normalized.length
        ? {
          ok: true,
          changed: false,
          receipt: {
            versionNumber: activeVersion.versionNumber,
            decisions: normalized,
            approvedTotalCents: approvedTotal(snapshot, normalized),
          },
        } as const
        : { ok: false, error: 'unavailable' } as const
    }

    const active = validActiveContext(context, hint.tokenHash, new Date())
    if (!active || active.version.id !== activeVersion.id) {
      await expireLink(transactionDb, context.send)
      return { ok: false, error: 'unavailable' } as const
    }
    for (const item of normalized) await transactionDb.insert(quoteEvents).values({
      shopId: context.send.shopId,
      ticketId: context.ticket.id,
      jobId: item.jobId,
      quoteVersionId: activeVersion.id,
      quoteSendId: context.send.id,
      kind: item.decision,
      actorProfileId: null,
      approvedVia: item.decision === 'approved' ? 'page' : null,
      requestKey: eventKey(body.data.requestKey, item.jobId),
    })
    for (const item of normalized) {
      const updated = await transactionDb.update(ticketJobs).set({
        approvalState: item.decision,
        approvedQuoteVersionId: item.decision === 'approved' ? activeVersion.id : null,
        updatedAt: new Date(),
      }).where(and(
        eq(ticketJobs.shopId, context.send.shopId),
        eq(ticketJobs.ticketId, context.ticket.id),
        eq(ticketJobs.id, item.jobId),
        inArray(ticketJobs.approvalState, ['quote_ready', 'sent']),
        isNull(ticketJobs.approvedQuoteVersionId),
      )).returning()
      if (updated.length !== 1) throw new Error('customer_approval_projection_conflict')
    }
    const now = new Date()
    await transactionDb.update(quoteSends).set({
      state: 'responded',
      tokenHash: null,
      tokenExpiresAt: null,
      terminalAt: now,
      retainUntil: deliveryRetainUntil(now),
      updatedAt: now,
    }).where(eq(quoteSends.id, context.send.id))
    return {
      ok: true,
      changed: true,
      receipt: {
        versionNumber: activeVersion.versionNumber,
        decisions: normalized,
        approvedTotalCents: approvedTotal(snapshot, normalized),
      },
    } as const
    })
  } catch (error) {
    if (isLockUnavailable(error)
      || error instanceof Error && error.message === 'customer_approval_projection_conflict') {
      return { ok: false, error: 'conflict', retryable: true }
    }
    throw error
  }
}
