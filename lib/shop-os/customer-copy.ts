import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { AppDb } from '@/lib/db/queries'
import {
  customers,
  quoteEvents,
  quoteVersions,
  shops,
  ticketJobs,
  tickets,
  vehicles,
} from '@/lib/db/schema'
import { canCloseTickets } from '@/lib/shop-os/capabilities'
import {
  readApprovedJobPricing,
  readPreparedCustomerPricing,
  type ApprovedJobPricing,
} from '@/lib/shop-os/quotes'
import { getTicketRingOut, type TicketRingOut } from '@/lib/shop-os/ring-out'
import type { TicketActor } from '@/lib/tickets'

export type CustomerCopyActor = TicketActor

export type CustomerCopyBlocker =
  | 'shop_phone'
  | 'shop_address_line_1'
  | 'shop_city'
  | 'shop_region'
  | 'shop_postal_code'
  | 'pricing_unavailable'

export type CustomerCopyLine = ApprovedJobPricing['lines'][number]

export type CustomerCopyProjection = {
  documentKind: 'estimate' | 'invoice' | 'paid_receipt'
  readyToPrint: boolean
  blockers: CustomerCopyBlocker[]
  shop: { name: string; phone: string | null; address: string[] }
  ticketNumber: number
  customer: { name: string }
  vehicle: {
    year: number
    make: string
    model: string
    vin: string | null
    odometer: number | null
  }
  jobs: Array<{ title: string; kind: ApprovedJobPricing['kind']; lines: CustomerCopyLine[] }>
  decisions: Array<{
    jobTitle: string
    decision: 'approved' | 'declined' | 'deferred'
    method: 'phone' | 'in_person' | null
    recordedAt: string
  }>
  totals: {
    subtotalCents: number
    taxCents: number
    totalCents: number
    payments: Array<{
      amountCents: number
      method: 'cash' | 'card' | 'check' | 'other'
      recordedAt: string
    }>
    paidCents: number
    balanceCents: number
  }
  closedAt: string | null
}

export type CustomerCopyResult =
  | { ok: true; copy: CustomerCopyProjection }
  | { ok: false; error: 'invalid_input' | 'not_found' | 'forbidden' }

type CustomerCopyFailure = Extract<CustomerCopyResult, { ok: false }>

export type CustomerCopyBundleResult =
  | { ok: true; copy: CustomerCopyProjection; ringOut: TicketRingOut }
  | { ok: false; error: 'invalid_input' | 'not_found' | 'forbidden' }

function actorGate(actor: CustomerCopyActor): CustomerCopyFailure | null {
  if (!actor.shopId) return { ok: false, error: 'not_found' }
  if (
    actor.membershipStatus !== 'active'
    || actor.deactivatedAt
    || !canCloseTickets(actor.role)
  ) return { ok: false, error: 'forbidden' }
  return null
}

function missingIdentity(row: {
  phone: string | null
  addressLine1: string | null
  city: string | null
  region: string | null
  postalCode: string | null
}): CustomerCopyBlocker[] {
  const blockers: CustomerCopyBlocker[] = []
  if (!row.phone?.trim()) blockers.push('shop_phone')
  if (!row.addressLine1?.trim()) blockers.push('shop_address_line_1')
  if (!row.city?.trim()) blockers.push('shop_city')
  if (!row.region?.trim()) blockers.push('shop_region')
  if (!row.postalCode?.trim()) blockers.push('shop_postal_code')
  return blockers
}

async function projectCustomerCopy(
  db: AppDb,
  input: { actor: CustomerCopyActor; ticketId: unknown },
  ringOut: TicketRingOut,
): Promise<CustomerCopyResult> {
  const denied = actorGate(input.actor)
  if (denied) return denied
  const ticketId = z.uuid().safeParse(input.ticketId)
  if (!ticketId.success) return { ok: false, error: 'invalid_input' }
  const shopId = input.actor.shopId as string

  const [row] = await db
    .select({
      ticketNumber: tickets.ticketNumber,
      ticketStatus: tickets.status,
      closedAt: tickets.closedAt,
      shopName: shops.name,
      shopPhone: shops.phone,
      addressLine1: shops.addressLine1,
      addressLine2: shops.addressLine2,
      city: shops.city,
      region: shops.region,
      postalCode: shops.postalCode,
      customerName: customers.name,
      vehicleYear: vehicles.year,
      vehicleMake: vehicles.make,
      vehicleModel: vehicles.model,
      vehicleVin: vehicles.vin,
      vehicleMileage: vehicles.mileage,
    })
    .from(tickets)
    .innerJoin(shops, and(eq(shops.id, tickets.shopId), eq(shops.id, shopId)))
    .innerJoin(customers, and(eq(customers.id, tickets.customerId), eq(customers.shopId, shopId)))
    .innerJoin(vehicles, and(eq(vehicles.id, tickets.vehicleId), eq(vehicles.customerId, customers.id)))
    .where(and(eq(tickets.shopId, shopId), eq(tickets.id, ticketId.data)))
    .limit(1)
  if (!row) return { ok: false, error: 'not_found' }

  const [jobs, versions, events] = await Promise.all([
    db.select({
      id: ticketJobs.id,
      approvalState: ticketJobs.approvalState,
      approvedQuoteVersionId: ticketJobs.approvedQuoteVersionId,
    }).from(ticketJobs).where(and(
      eq(ticketJobs.shopId, shopId),
      eq(ticketJobs.ticketId, ticketId.data),
    )).orderBy(asc(ticketJobs.createdAt), asc(ticketJobs.id)),
    db.select({
      id: quoteVersions.id,
      snapshot: quoteVersions.snapshot,
      supersededAt: quoteVersions.supersededAt,
    }).from(quoteVersions).where(and(
      eq(quoteVersions.shopId, shopId),
      eq(quoteVersions.ticketId, ticketId.data),
    )),
    db.select({
      jobId: quoteEvents.jobId,
      versionId: quoteEvents.quoteVersionId,
      kind: quoteEvents.kind,
      approvedVia: quoteEvents.approvedVia,
      createdAt: quoteEvents.createdAt,
    }).from(quoteEvents).where(and(
      eq(quoteEvents.shopId, shopId),
      eq(quoteEvents.ticketId, ticketId.data),
    )).orderBy(asc(quoteEvents.createdAt), asc(quoteEvents.id)),
  ])

  const versionById = new Map(versions.map((version) => [version.id, version]))
  const activeVersions = versions.filter((version) => version.supersededAt === null)
  const approvedJobs = jobs.filter((job) => job.approvalState === 'approved')
  let pricingUnavailable = activeVersions.length > 1
  let projectedJobs: CustomerCopyProjection['jobs'] = []
  let subtotalCents = 0
  let taxCents = 0
  let totalCents = 0
  let paidCents = 0
  let balanceCents = 0
  let payments: CustomerCopyProjection['totals']['payments'] = []

  if (approvedJobs.length > 0) {
    const priced = approvedJobs.map((job) => {
      if (!job.approvedQuoteVersionId) return null
      const version = versionById.get(job.approvedQuoteVersionId)
      return version ? readApprovedJobPricing(version.snapshot, job.id) : null
    })
    pricingUnavailable ||= priced.some((job) => job === null)
    if (!pricingUnavailable) {
      projectedJobs = (priced as ApprovedJobPricing[]).map((job) => ({
        title: job.title,
        kind: job.kind,
        lines: job.lines,
      }))
    }
    subtotalCents = ringOut.owed.subtotalCents
    taxCents = ringOut.owed.taxCents
    totalCents = ringOut.owed.totalCents
    paidCents = ringOut.paidCents
    balanceCents = ringOut.balanceCents
    payments = ringOut.payments.map(({ amountCents, method, recordedAt }) => ({
      amountCents,
      method,
      recordedAt,
    }))
  } else {
    const active = activeVersions[0]
    const prepared = active ? readPreparedCustomerPricing(active.snapshot) : null
    pricingUnavailable ||= prepared === null
    if (prepared) {
      projectedJobs = prepared.jobs.map((job) => ({ title: job.title, kind: job.kind, lines: job.lines }))
      subtotalCents = prepared.totals.subtotalCents
      taxCents = prepared.totals.taxCents
      totalCents = prepared.totals.totalCents
      balanceCents = prepared.totals.totalCents
    }
  }

  const decisions: CustomerCopyProjection['decisions'] = []
  for (const event of events) {
    if (!event.jobId || !['approved', 'declined', 'deferred'].includes(event.kind)) continue
    const version = versionById.get(event.versionId)
    const priced = version ? readApprovedJobPricing(version.snapshot, event.jobId) : null
    if (!priced) {
      pricingUnavailable = true
      continue
    }
    decisions.push({
      jobTitle: priced.title,
      decision: event.kind as 'approved' | 'declined' | 'deferred',
      method: event.approvedVia === 'phone' || event.approvedVia === 'in_person'
        ? event.approvedVia
        : null,
      recordedAt: event.createdAt.toISOString(),
    })
  }

  const identityBlockers = missingIdentity({
    phone: row.shopPhone,
    addressLine1: row.addressLine1,
    city: row.city,
    region: row.region,
    postalCode: row.postalCode,
  })
  const blockers = [
    ...identityBlockers,
    ...(pricingUnavailable ? ['pricing_unavailable' as const] : []),
  ]
  if (pricingUnavailable) projectedJobs = []
  const documentKind: CustomerCopyProjection['documentKind'] = approvedJobs.length === 0
    ? 'estimate'
    : row.ticketStatus === 'closed' && balanceCents === 0
      ? 'paid_receipt'
      : 'invoice'

  return {
    ok: true,
    copy: {
      documentKind,
      readyToPrint: blockers.length === 0,
      blockers,
      shop: {
        name: row.shopName,
        phone: row.shopPhone,
        address: [
          row.addressLine1,
          row.addressLine2,
          [row.city, row.region].filter(Boolean).join(', ') + (row.postalCode ? ` ${row.postalCode}` : ''),
        ].filter((line): line is string => Boolean(line?.trim())),
      },
      ticketNumber: row.ticketNumber,
      customer: { name: row.customerName },
      vehicle: {
        year: row.vehicleYear,
        make: row.vehicleMake,
        model: row.vehicleModel,
        vin: row.vehicleVin,
        odometer: row.vehicleMileage,
      },
      jobs: projectedJobs,
      decisions,
      totals: { subtotalCents, taxCents, totalCents, payments, paidCents, balanceCents },
      closedAt: row.closedAt?.toISOString() ?? null,
    },
  }
}

export async function getCustomerCopyBundle(
  db: AppDb,
  input: { actor: CustomerCopyActor; ticketId: unknown },
): Promise<CustomerCopyBundleResult> {
  const denied = actorGate(input.actor)
  if (denied) return denied
  const ticketId = z.uuid().safeParse(input.ticketId)
  if (!ticketId.success) return { ok: false, error: 'invalid_input' }

  return db.transaction(async (txRaw) => {
    const tx = txRaw as AppDb
    const ringOutResult = await getTicketRingOut(tx, {
      actor: input.actor,
      ticketId: ticketId.data,
    })
    if (!ringOutResult.ok) {
      return {
        ok: false as const,
        error: ringOutResult.error === 'invalid_input'
          ? 'invalid_input' as const
          : ringOutResult.error === 'forbidden'
            ? 'forbidden' as const
            : 'not_found' as const,
      }
    }
    const copyResult = await projectCustomerCopy(tx, {
      actor: input.actor,
      ticketId: ticketId.data,
    }, ringOutResult.ringOut)
    if (!copyResult.ok) return { ok: false as const, error: copyResult.error }
    return { ok: true as const, ringOut: ringOutResult.ringOut, copy: copyResult.copy }
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
}

export async function getCustomerCopy(
  db: AppDb,
  input: { actor: CustomerCopyActor; ticketId: unknown },
): Promise<CustomerCopyResult> {
  const result = await getCustomerCopyBundle(db, input)
  return result.ok ? { ok: true, copy: result.copy } : result
}
