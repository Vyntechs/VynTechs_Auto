// ---- A full day in a five-person shop, built by the product itself ---------
//
// THIS IS DEMONSTRATION DATA. Every customer, vehicle, plate, phone number and
// repair order below is invented. Nothing here is a record of real work for a
// real person, and it must never be loaded into a hosted environment.
//
// The point of this file is that the owner has only ever seen his product
// empty. An empty board hides everything: which lane is thin, which word is
// wrong, which screen has nothing to say. So this builds a believable day and
// leaves it standing.
//
// Two rules govern every line of it.
//
//   1. **Only the product may write.** Repair orders are created through
//      `createCounterTicket`, priced through `createDraftLine`, versioned
//      through `createQuoteVersion`, answered through `recordQuoteDecision`,
//      worked through `mutateSimpleWork`, held through `mutateJobInterruption`,
//      and rung out through `recordTicketPayment` / `closeTicket`. If a state
//      cannot be produced by those functions, it does not appear here — a
//      screen the product cannot actually reach is worse than an empty one,
//      because it teaches the owner to expect something that will never come.
//
//      `addTicketJob` is deliberately unused. It is exported by `lib/tickets`
//      but no route calls it, so a second job on a repair order is added the
//      way the running product adds one: an applied canned job, customer-
//      approved extra diagnostic time, or work a technician found under the
//      truck.
//
//   2. **The only non-product write is the clock.** A demo cannot wait three
//      days for a customer to go quiet, so `shiftTicketClock` moves an
//      already-built repair order's timestamps backwards. It changes no state
//      and no money — only when the same, product-produced state happened. It
//      is the one function here that a person could not perform, and it is
//      isolated for exactly that reason.
//
// The reset at the top is teardown, not fabrication: it clears this one shop's
// operational tables so the whole day rebuilds identically on every run.

import { eq, inArray, sql } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/queries'
import {
  customers,
  jobLines,
  jobPartRequests,
  profiles,
  quoteEvents,
  quoteVersions,
  shopEntitlements,
  shops,
  ticketActivity,
  ticketJobs,
  ticketPayments,
  tickets,
  vehicles,
} from '@/lib/db/schema'
import { createCounterTicket } from '@/lib/intake/counter-ticket'
import { applyCannedJobToTicket, createCannedJob } from '@/lib/shop-os/canned-jobs'
import { mutateJobInterruption } from '@/lib/shop-os/interruption'
import { createPartRequest } from '@/lib/shop-os/part-requests'
import { createDraftLine, createQuoteVersion, recordQuoteDecision } from '@/lib/shop-os/quotes'
import { closeTicket, getTicketRingOut, recordTicketPayment } from '@/lib/shop-os/ring-out'
import { createWorkEscalation, mutateSimpleWork } from '@/lib/shop-os/simple-work'
import {
  addSupplementalDiagnosticTime,
  getTicketDetail,
  mutateTicketJobAssignment,
  ticketActorFromProfile,
  type TicketActor,
  type TicketDetail,
} from '@/lib/tickets'

// ---- Identity --------------------------------------------------------------

export const DEMO_SHOP_ID = '3d3e0a41-0000-4000-8000-000000000001'

/**
 * The shop's own numbers. A labor rate and a tax rate are not decoration: every
 * total on every screen is derived from them, so they are the two values to
 * change first when this is shown to a shop that charges something else.
 */
export const DEMO_SHOP = {
  id: DEMO_SHOP_ID,
  name: 'Northside Diesel & Auto',
  laborRateCents: 15_500,
  taxRateBps: 825,
  partsMarkupBps: 4_500,
} as const

/**
 * Five people, and the product has no sixth.
 *
 * The owner is the front of house — he is the only one who writes a vehicle up,
 * prices it, takes the customer's answer and takes the money, because
 * `canSendQuotes` (and with it approval, assignment and close) is
 * owner-or-advisor and this shop runs no advisor. The lead technician is the
 * only A-tech; the other two get the work their tier allows. The parts person
 * carries no skill tier because he turns no wrenches.
 */
export const DEMO_PEOPLE = {
  owner: {
    profileId: '3d3e0a41-0000-4000-8000-000000000010',
    fullName: 'Ray Dalton',
    role: 'owner' as const,
    skillTier: null,
    email: 'demo.owner@vyntechs.test',
  },
  lead: {
    profileId: '3d3e0a41-0000-4000-8000-000000000011',
    fullName: 'Curtis Vance',
    role: 'tech' as const,
    skillTier: 3,
    email: 'demo.lead@vyntechs.test',
  },
  tech2: {
    profileId: '3d3e0a41-0000-4000-8000-000000000012',
    fullName: 'Tyler Boone',
    role: 'tech' as const,
    skillTier: 2,
    email: 'demo.tech@vyntechs.test',
  },
  tech1: {
    profileId: '3d3e0a41-0000-4000-8000-000000000013',
    fullName: 'Jesse Alvarez',
    role: 'tech' as const,
    skillTier: 1,
    email: 'demo.helper@vyntechs.test',
  },
  parts: {
    profileId: '3d3e0a41-0000-4000-8000-000000000014',
    fullName: 'Omar Castillo',
    role: 'parts' as const,
    skillTier: null,
    email: 'demo.parts@vyntechs.test',
  },
} as const

export type DemoPersonKey = keyof typeof DEMO_PEOPLE

// Every idempotency key this seed uses is derived from a stable label, so a
// re-run replays the same request rather than making a second one.
function key(label: string): string {
  const bytes = new Uint8Array(16)
  let hash = 0x811c9dc5
  for (let index = 0; index < 16; index += 1) {
    for (const character of `${label}#${index}`) {
      hash ^= character.charCodeAt(0)
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
    bytes[index] = hash & 0xff
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const HOUR = 3_600
const DAY = 24 * HOUR

// ---- Reset -----------------------------------------------------------------

/**
 * Quote versions, quote events and repair-order activity are append-only:
 * database triggers refuse every UPDATE and DELETE on them, which is correct —
 * an approved quote is what the shop is owed, and nobody gets to rewrite it
 * after the fact. Tearing down a demo and moving a demo clock are the two
 * things that legitimately need to step around that, and this is the same lever
 * the audited QA cleanup in `scripts/shop-os-golden-browser.mjs` pulls. It is
 * released with the transaction.
 */
async function withoutAppendOnlyGuards<T>(
  db: AppDb,
  work: (tx: AppDb) => Promise<T>,
): Promise<T> {
  return db.transaction(async (txRaw) => {
    const tx = txRaw as AppDb
    await tx.execute(sql.raw('set local session_replication_role = replica'))
    const result = await work(tx)
    await tx.execute(sql.raw('set local session_replication_role = origin'))
    return result
  })
}

/**
 * Clear this one shop's operational rows so the day rebuilds identically.
 * Scoped to `DEMO_SHOP_ID` on every table, in dependency order. The people, the
 * shop and its rates survive — those are configuration, not the day's work.
 */
export async function resetDemoShopDay(db: AppDb): Promise<void> {
  await withoutAppendOnlyGuards(db, async (tx) => {
    await tx.delete(ticketActivity).where(eq(ticketActivity.shopId, DEMO_SHOP_ID))
    await tx.delete(ticketPayments).where(eq(ticketPayments.shopId, DEMO_SHOP_ID))
    await tx.delete(quoteEvents).where(eq(quoteEvents.shopId, DEMO_SHOP_ID))
    await tx.delete(jobPartRequests).where(eq(jobPartRequests.shopId, DEMO_SHOP_ID))
    await tx.delete(jobLines).where(eq(jobLines.shopId, DEMO_SHOP_ID))
    await tx.update(ticketJobs)
      .set({ approvedQuoteVersionId: null })
      .where(eq(ticketJobs.shopId, DEMO_SHOP_ID))
    await tx.delete(quoteVersions).where(eq(quoteVersions.shopId, DEMO_SHOP_ID))
    await tx.delete(ticketJobs).where(eq(ticketJobs.shopId, DEMO_SHOP_ID))
    await tx.delete(tickets).where(eq(tickets.shopId, DEMO_SHOP_ID))
    const shopCustomers = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.shopId, DEMO_SHOP_ID))
    if (shopCustomers.length > 0) {
      await tx.delete(vehicles).where(
        inArray(vehicles.customerId, shopCustomers.map((row) => row.id)),
      )
    }
    await tx.delete(customers).where(eq(customers.shopId, DEMO_SHOP_ID))
    await tx.update(shops).set({ nextTicketNumber: 1 }).where(eq(shops.id, DEMO_SHOP_ID))
  })
}

// ---- The clock -------------------------------------------------------------

const CLOCK_SHIFT_TABLES = [
  { table: 'tickets', columns: ['created_at', 'updated_at'], scope: 'ticket' },
  { table: 'ticket_jobs', columns: ['created_at', 'updated_at'], scope: 'ticket' },
  { table: 'quote_versions', columns: ['created_at'], scope: 'ticket' },
  { table: 'quote_events', columns: ['created_at'], scope: 'ticket' },
  { table: 'ticket_activity', columns: ['created_at'], scope: 'ticket' },
  { table: 'job_part_requests', columns: ['created_at'], scope: 'ticket' },
  { table: 'ticket_payments', columns: ['recorded_at'], scope: 'ticket' },
] as const

/**
 * Move one repair order backwards in time.
 *
 * The single write in this file that no person and no route could perform. It
 * exists because two of the states the owner needs to see are defined by
 * elapsed time — a customer who has heard nothing in over forty-eight hours,
 * and a diagnosis that has learned nothing in days — and a seed cannot wait.
 *
 * It changes no status, no assignment and not one cent. Every row of the repair
 * order moves by the same delta, so the order of events inside it, which the
 * approval and work paths both read, is preserved exactly.
 */
async function shiftTicketClock(
  db: AppDb,
  input: { ticketId: string; bySeconds: number },
): Promise<void> {
  await withoutAppendOnlyGuards(db, async (tx) => {
    for (const spec of CLOCK_SHIFT_TABLES) {
      const assignments = spec.columns
        .map((column) => `${column} = ${column} - make_interval(secs => ${Number(input.bySeconds)})`)
        .join(', ')
      const filter = spec.table === 'tickets' ? 'id' : 'ticket_id'
      await tx.execute(sql`
        update ${sql.raw(`public.${spec.table}`)}
        set ${sql.raw(assignments)}
        where shop_id = ${DEMO_SHOP_ID} and ${sql.raw(filter)} = ${input.ticketId}
      `)
    }
  })
}

// ---- Configuration ---------------------------------------------------------

async function ensureShopAndPeople(
  db: AppDb,
  authUserIds: Record<DemoPersonKey, string>,
): Promise<Record<DemoPersonKey, TicketActor>> {
  await db.insert(shops).values({
    id: DEMO_SHOP.id,
    name: DEMO_SHOP.name,
    laborRateCents: DEMO_SHOP.laborRateCents,
    taxRateBps: DEMO_SHOP.taxRateBps,
    partsMarkupBps: DEMO_SHOP.partsMarkupBps,
  }).onConflictDoUpdate({
    target: shops.id,
    set: {
      name: DEMO_SHOP.name,
      laborRateCents: DEMO_SHOP.laborRateCents,
      taxRateBps: DEMO_SHOP.taxRateBps,
      partsMarkupBps: DEMO_SHOP.partsMarkupBps,
    },
  })

  await db.insert(shopEntitlements).values({ shopId: DEMO_SHOP.id, diagnostics: false })
    .onConflictDoUpdate({ target: shopEntitlements.shopId, set: { diagnostics: false } })

  const actors = {} as Record<DemoPersonKey, TicketActor>
  for (const [personKey, person] of Object.entries(DEMO_PEOPLE) as Array<[DemoPersonKey, typeof DEMO_PEOPLE[DemoPersonKey]]>) {
    const [row] = await db.insert(profiles).values({
      id: person.profileId,
      userId: authUserIds[personKey],
      shopId: DEMO_SHOP.id,
      fullName: person.fullName,
      role: person.role,
      skillTier: person.skillTier,
      membershipStatus: 'active',
      isComp: true,
      deactivatedAt: null,
    }).onConflictDoUpdate({
      target: profiles.id,
      set: {
        userId: authUserIds[personKey],
        shopId: DEMO_SHOP.id,
        fullName: person.fullName,
        role: person.role,
        skillTier: person.skillTier,
        membershipStatus: 'active',
        isComp: true,
        deactivatedAt: null,
      },
    }).returning()
    actors[personKey] = ticketActorFromProfile(row)
  }
  return actors
}

// ---- The canned-job library ------------------------------------------------
//
// A real shop's library is the ten jobs it does every week, priced once. It is
// also the only way the write-up screen can ask for an A-tech: hand-typed work
// takes its tier from its kind (repair 2, maintenance 1), so a template is
// where "this one needs Curtis" is actually expressible.

type CannedSpec = {
  label: string
  title: string
  kind: 'diagnostic' | 'repair' | 'maintenance'
  defaultRequiredSkillTier: 1 | 2 | 3
  sort: number
  lines: Array<
    | { kind: 'labor'; description: string; sort: number; priceCents: number; taxable: boolean; hours: string }
    | { kind: 'part'; description: string; sort: number; priceCents: number; taxable: boolean; quantity: string; partNumber?: string; brand?: string }
    | { kind: 'fee'; description: string; sort: number; priceCents: number; taxable: boolean }
  >
}

const CANNED_LIBRARY: CannedSpec[] = [
  {
    label: 'diesel-diagnosis',
    title: 'Diesel driveability diagnosis — first hour',
    kind: 'diagnostic',
    defaultRequiredSkillTier: 3,
    sort: 10,
    lines: [
      { kind: 'labor', description: 'Diesel driveability diagnosis, first hour', sort: 0, priceCents: 15_500, taxable: false, hours: '1' },
    ],
  },
  {
    label: 'electrical-diagnosis',
    title: 'Electrical fault diagnosis — first hour',
    kind: 'diagnostic',
    defaultRequiredSkillTier: 2,
    sort: 20,
    lines: [
      { kind: 'labor', description: 'Electrical fault diagnosis, first hour', sort: 0, priceCents: 15_500, taxable: false, hours: '1' },
    ],
  },
  {
    label: 'oil-service-diesel',
    title: 'Diesel oil and filter service',
    kind: 'maintenance',
    defaultRequiredSkillTier: 1,
    sort: 30,
    lines: [
      { kind: 'labor', description: 'Drain, refill and reset oil life monitor', sort: 0, priceCents: 10_850, taxable: false, hours: '0.7' },
      { kind: 'part', description: '15W-40 diesel engine oil, 13 quarts', sort: 10, priceCents: 9_620, taxable: true, quantity: '13', brand: 'Rotella T4' },
      { kind: 'part', description: 'Engine oil filter', sort: 20, priceCents: 3_180, taxable: true, quantity: '1', partNumber: 'FL-2051-S', brand: 'Motorcraft' },
    ],
  },
  {
    label: 'oil-service-gas',
    title: 'Full synthetic oil and filter service',
    kind: 'maintenance',
    defaultRequiredSkillTier: 1,
    sort: 40,
    lines: [
      { kind: 'labor', description: 'Drain, refill and reset oil life monitor', sort: 0, priceCents: 7_750, taxable: false, hours: '0.5' },
      { kind: 'part', description: '5W-30 full synthetic engine oil, 6 quarts', sort: 10, priceCents: 4_770, taxable: true, quantity: '6', brand: 'Motorcraft' },
      { kind: 'part', description: 'Engine oil filter', sort: 20, priceCents: 1_495, taxable: true, quantity: '1', partNumber: 'FL-910-S', brand: 'Motorcraft' },
    ],
  },
  {
    label: 'front-brakes',
    title: 'Front brake pads and rotor service',
    kind: 'repair',
    defaultRequiredSkillTier: 2,
    sort: 50,
    lines: [
      { kind: 'labor', description: 'Replace front pads, machine rotors, service hardware', sort: 0, priceCents: 27_900, taxable: false, hours: '1.8' },
      { kind: 'part', description: 'Front brake pad set, ceramic', sort: 10, priceCents: 8_900, taxable: true, quantity: '1', brand: 'Wagner ThermoQuiet' },
      { kind: 'fee', description: 'Rotor resurfacing, per axle', sort: 20, priceCents: 5_000, taxable: false },
    ],
  },
  {
    label: 'fuel-filters-67',
    title: '6.7L Power Stroke fuel filter service',
    kind: 'maintenance',
    defaultRequiredSkillTier: 1,
    sort: 60,
    lines: [
      { kind: 'labor', description: 'Replace both fuel filters and prime system', sort: 0, priceCents: 12_400, taxable: false, hours: '0.8' },
      { kind: 'part', description: 'Fuel filter kit, 6.7L Power Stroke', sort: 10, priceCents: 6_890, taxable: true, quantity: '1', partNumber: 'FD-4615', brand: 'Motorcraft' },
    ],
  },
  {
    label: 'coolant-flush',
    title: 'Cooling system flush and refill',
    kind: 'maintenance',
    defaultRequiredSkillTier: 1,
    sort: 70,
    lines: [
      { kind: 'labor', description: 'Flush cooling system, refill and bleed', sort: 0, priceCents: 15_500, taxable: false, hours: '1' },
      { kind: 'part', description: 'Extended-life coolant, 2 gallons', sort: 10, priceCents: 5_980, taxable: true, quantity: '2' },
    ],
  },
  {
    label: 'ac-performance',
    title: 'Air conditioning performance check',
    kind: 'diagnostic',
    defaultRequiredSkillTier: 2,
    sort: 80,
    lines: [
      { kind: 'labor', description: 'Air conditioning performance and leak check', sort: 0, priceCents: 11_625, taxable: false, hours: '0.75' },
    ],
  },
  {
    label: 'cabin-filter',
    title: 'Cabin air filter and evaporator service',
    kind: 'maintenance',
    defaultRequiredSkillTier: 1,
    sort: 90,
    lines: [
      { kind: 'labor', description: 'Replace cabin air filter and treat evaporator', sort: 0, priceCents: 9_300, taxable: false, hours: '0.6' },
      { kind: 'part', description: 'Cabin air filter', sort: 10, priceCents: 3_400, taxable: true, quantity: '1' },
      { kind: 'part', description: 'Evaporator cleaner treatment', sort: 20, priceCents: 4_200, taxable: true, quantity: '1' },
    ],
  },
  {
    label: 'state-inspection',
    title: 'State safety inspection',
    kind: 'maintenance',
    defaultRequiredSkillTier: 1,
    sort: 100,
    lines: [
      { kind: 'labor', description: 'State safety inspection', sort: 0, priceCents: 2_550, taxable: false, hours: '0.25' },
    ],
  },
]

type CannedHandle = { id: string; fingerprint: string }

async function ensureCannedLibrary(
  db: AppDb,
  owner: TicketActor,
): Promise<Record<string, CannedHandle>> {
  const handles: Record<string, CannedHandle> = {}
  for (const spec of CANNED_LIBRARY) {
    const result = await createCannedJob(db, {
      actor: { profileId: owner.profileId },
      clientKey: key(`canned:${spec.label}`),
      body: {
        title: spec.title,
        kind: spec.kind,
        defaultRequiredSkillTier: spec.defaultRequiredSkillTier,
        sort: spec.sort,
        lines: spec.lines,
      },
    })
    if (!result.ok) throw new Error(`canned job ${spec.label} failed: ${result.error}`)
    handles[spec.label] = {
      id: result.cannedJob.id,
      fingerprint: result.cannedJob.fingerprint,
    }
  }
  return handles
}

// ---- Small helpers over the domain -----------------------------------------

type Actors = Record<DemoPersonKey, TicketActor>

function must<T extends { ok: boolean }>(result: T, what: string): Extract<T, { ok: true }> {
  if (!result.ok) {
    const detail = 'error' in result ? String((result as { error: unknown }).error) : 'unknown'
    throw new Error(`${what} failed: ${detail}`)
  }
  return result as Extract<T, { ok: true }>
}

type CustomerSpec = { name: string; phone: string; email?: string | null }
type VehicleSpec = {
  year: number
  make: string
  model: string
  engine: string
  vin: string
  mileage: number
  plate: string
}

type WriteUpWork =
  | { mode: 'manual'; kind: 'repair' | 'maintenance'; description: string; customerSuppliedPartsNote?: string | null }
  | { mode: 'diagnosis-manual'; description: string; laborHours: number; priceCents: number }
  | { mode: 'canned'; canned: string; customerSuppliedPartsNote?: string | null }
  | { mode: 'diagnosis'; canned: string }

async function writeUp(
  db: AppDb,
  actors: Actors,
  library: Record<string, CannedHandle>,
  input: {
    label: string
    customer: CustomerSpec
    vehicle: VehicleSpec
    concern: string
    whenStarted: string | null
    howOften: string | null
    work: WriteUpWork
    assignTo: DemoPersonKey | null
  },
): Promise<TicketDetail> {
  const cannedBody = (label: string) => ({
    cannedJobId: library[label].id,
    expectedFingerprint: library[label].fingerprint,
    expectedTaxRateBps: DEMO_SHOP.taxRateBps,
  })
  const work =
    input.work.mode === 'canned'
      ? {
        mode: 'canned' as const,
        ...cannedBody(input.work.canned),
        customerSuppliedPartsNote: input.work.customerSuppliedPartsNote ?? null,
      }
      : input.work.mode === 'diagnosis'
        ? { mode: 'diagnosis' as const, ...cannedBody(input.work.canned) }
        : input.work

  const created = must(await createCounterTicket(db, {
    actor: actors.owner,
    body: {
      clientKey: key(`ticket:${input.label}`),
      vehicleMode: 'new',
      customer: {
        name: input.customer.name,
        phone: input.customer.phone,
        email: input.customer.email ?? null,
      },
      vehicle: input.vehicle,
      concern: input.concern,
      whenStarted: input.whenStarted,
      howOften: input.howOften,
      work,
      assignedTechId: input.assignTo ? actors[input.assignTo].profileId : null,
      confirmBelowTier: true,
    },
  }), `write-up ${input.label}`)
  return created.ticket
}

/** The write-up door only assigns at creation. Later moves go through dispatch. */
async function assign(
  db: AppDb,
  actors: Actors,
  input: { label: string; ticketId: string; jobId: string; to: DemoPersonKey },
): Promise<void> {
  must(await mutateTicketJobAssignment(db, {
    actor: actors.owner,
    ticketId: input.ticketId,
    jobId: input.jobId,
    body: {
      action: 'reassign',
      requestKey: key(`assign:${input.label}`),
      assignedTechId: actors[input.to].profileId,
      confirmBelowTier: true,
    },
  }), `assign ${input.label}`)
}

type LineSpec =
  | { kind: 'labor'; description: string; laborHours: string; priceCents?: number }
  | { kind: 'part'; description: string; quantity: string; priceCents: number; partNumber?: string; brand?: string }
  | { kind: 'fee'; description: string; priceCents: number }

async function price(
  db: AppDb,
  actors: Actors,
  input: { label: string; ticketId: string; jobId: string; lines: LineSpec[] },
): Promise<void> {
  let sort = 0
  for (const line of input.lines) {
    const body =
      line.kind === 'labor'
        ? {
          kind: 'labor' as const,
          description: line.description,
          sort,
          taxable: false,
          laborHours: line.laborHours,
          ...(line.priceCents === undefined ? {} : { priceCents: line.priceCents }),
        }
        : line.kind === 'part'
          ? {
            kind: 'part' as const,
            description: line.description,
            sort,
            taxable: true,
            quantity: line.quantity,
            priceCents: line.priceCents,
            ...(line.partNumber === undefined ? {} : { partNumber: line.partNumber }),
            ...(line.brand === undefined ? {} : { brand: line.brand }),
          }
          : {
            kind: 'fee' as const,
            description: line.description,
            sort,
            taxable: false,
            priceCents: line.priceCents,
          }
    must(await createDraftLine(db, {
      actor: { profileId: actors.owner.profileId },
      ticketId: input.ticketId,
      jobId: input.jobId,
      clientKey: key(`line:${input.label}:${sort}`),
      body,
    }), `line ${input.label}:${sort}`)
    sort += 10
  }
}

async function buildQuote(
  db: AppDb,
  actors: Actors,
  input: { label: string; ticketId: string },
): Promise<string> {
  const version = must(await createQuoteVersion(db, {
    actor: { profileId: actors.owner.profileId },
    ticketId: input.ticketId,
  }), `quote ${input.label}`)
  return version.version.id
}

type Answer =
  | { decision: 'approved'; via: 'phone' | 'in_person' }
  | { decision: 'declined' }
  | { decision: 'deferred'; reason: string }

async function customerAnswer(
  db: AppDb,
  actors: Actors,
  input: { label: string; ticketId: string; jobId: string; versionId: string; answer: Answer },
): Promise<void> {
  const body =
    input.answer.decision === 'approved'
      ? {
        requestKey: key(`answer:${input.label}`),
        jobId: input.jobId,
        quoteVersionId: input.versionId,
        decision: 'approved' as const,
        approvedVia: input.answer.via,
      }
      : input.answer.decision === 'declined'
        ? {
          requestKey: key(`answer:${input.label}`),
          jobId: input.jobId,
          quoteVersionId: input.versionId,
          decision: 'declined' as const,
        }
        : {
          requestKey: key(`answer:${input.label}`),
          jobId: input.jobId,
          quoteVersionId: input.versionId,
          decision: 'deferred' as const,
          reason: input.answer.reason,
        }
  must(await recordQuoteDecision(db, {
    actor: { profileId: actors.owner.profileId },
    ticketId: input.ticketId,
    body,
  }), `answer ${input.label}`)
}

/**
 * Put a technician on the clock, leave a real note, and optionally finish.
 * Notes are what the next person reads, so every worked job here carries one
 * in a technician's own words rather than a status word.
 */
async function work(
  db: AppDb,
  actors: Actors,
  input: {
    ticketId: string
    jobId: string
    who: DemoPersonKey
    note?: string
    clockRunning?: boolean
    finish?: boolean
  },
): Promise<void> {
  const actor = { profileId: actors[input.who].profileId, shopId: DEMO_SHOP_ID }
  let latest = must(await mutateSimpleWork(db, {
    actor, ticketId: input.ticketId, jobId: input.jobId, body: { action: 'clock_on' },
  }), 'clock on')
  if (input.note) {
    latest = must(await mutateSimpleWork(db, {
      actor,
      ticketId: input.ticketId,
      jobId: input.jobId,
      body: { action: 'save_note', note: input.note, expectedUpdatedAt: latest.work.updatedAt },
    }), 'save note')
  }
  if (input.clockRunning === false) {
    latest = must(await mutateSimpleWork(db, {
      actor, ticketId: input.ticketId, jobId: input.jobId, body: { action: 'clock_off' },
    }), 'clock off')
  }
  if (input.finish) {
    must(await mutateSimpleWork(db, {
      actor,
      ticketId: input.ticketId,
      jobId: input.jobId,
      body: { action: 'complete', expectedUpdatedAt: latest.work.updatedAt },
    }), 'complete')
  }
}

function jobByTitle(ticket: TicketDetail, title: string): string {
  const job = ticket.jobs.find((candidate) => candidate.title === title)
  if (!job) throw new Error(`job not found on repair order ${ticket.ticketNumber}: ${title}`)
  return job.id
}

async function reload(db: AppDb, actors: Actors, ticketId: string): Promise<TicketDetail> {
  return must(await getTicketDetail(db, { actor: actors.owner, ticketId }), 'reload').ticket
}

// ---- The day ---------------------------------------------------------------

export type DemoShopDayReceipt = {
  shopId: string
  repairOrders: number
  open: number
  closed: number
  jobs: number
  cannedJobs: number
}

export async function seedDemoShopDay(
  db: AppDb,
  input: { authUserIds: Record<DemoPersonKey, string> },
): Promise<DemoShopDayReceipt> {
  const actors = await ensureShopAndPeople(db, input.authUserIds)
  await resetDemoShopDay(db)
  const library = await ensureCannedLibrary(db, actors.owner)

  // 1 — Written up minutes ago. Nothing priced, nobody on it.
  const shakes = await writeUp(db, actors, library, {
    label: 'silverado-vibration',
    customer: { name: 'Dana Whitfield', phone: '(512) 555-0148', email: 'dana.whitfield@example.invalid' },
    vehicle: {
      year: 2018, make: 'Chevrolet', model: 'Silverado 1500', engine: '5.3L V8',
      vin: '3GCUKREC8JG204118', mileage: 118_430, plate: 'JVR-4471',
    },
    concern: 'Steering wheel shakes over about 60 and it gets worse when I brake coming down the hill into town.',
    whenStarted: 'About two weeks ago',
    howOften: 'Every time I get on the highway',
    work: { mode: 'manual', kind: 'repair', description: 'Find highway-speed vibration and brake pulsation' },
    assignTo: null,
  })
  await shiftTicketClock(db, { ticketId: shakes.id, bySeconds: 11 * 60 })

  // 2 — Priced this morning and sitting with the customer, unanswered.
  const injector = await writeUp(db, actors, library, {
    label: 'ram-injector',
    customer: { name: 'Alvin Pruitt', phone: '(512) 555-0173', email: null },
    vehicle: {
      year: 2015, make: 'Ram', model: '2500', engine: '6.7L Cummins',
      vin: '3C6UR5DL1FG610294', mileage: 214_880, plate: 'TDX-9052',
    },
    concern: 'Check engine light is on and it puffs white smoke for the first minute on a cold morning. Smells like raw fuel.',
    whenStarted: 'Since the cold snap',
    howOften: 'Every cold start',
    work: { mode: 'manual', kind: 'repair', description: 'Replace number 4 injector and high-pressure line' },
    assignTo: 'lead',
  })
  await price(db, actors, {
    label: 'ram-injector',
    ticketId: injector.id,
    jobId: injector.jobs[0].id,
    lines: [
      { kind: 'labor', description: 'Replace number 4 injector, high-pressure line, reprogram injector code', laborHours: '3.4' },
      { kind: 'part', description: 'Remanufactured fuel injector, 6.7L Cummins', quantity: '1', priceCents: 68_900, partNumber: '0986435518', brand: 'Bosch' },
      { kind: 'part', description: 'High-pressure fuel line, number 4 cylinder', quantity: '1', priceCents: 9_450, partNumber: '68210039AA', brand: 'Mopar' },
      { kind: 'part', description: 'Valve cover gasket and injector seal kit', quantity: '1', priceCents: 4_320 },
    ],
  })
  await buildQuote(db, actors, { label: 'ram-injector', ticketId: injector.id })
  await shiftTicketClock(db, { ticketId: injector.id, bySeconds: 3 * HOUR })

  // 3 — Customer said yes; the lead technician is on it right now, and he found
  //     more work while he was under it.
  const hotStart = await writeUp(db, actors, library, {
    label: 'f250-hot-start',
    customer: { name: 'Renee Kowalski', phone: '(512) 555-0119', email: 'rkowalski@example.invalid' },
    vehicle: {
      year: 2016, make: 'Ford', model: 'F-250 Super Duty', engine: '6.7L Power Stroke',
      vin: '1FT7W2BT4GEB33807', mileage: 168_205, plate: 'LBK-2280',
    },
    concern: 'Fires right up cold. Once it has been running an hour it cranks and cranks before it catches.',
    whenStarted: 'Started after the last cold front',
    howOften: 'Only when it is hot',
    work: { mode: 'manual', kind: 'repair', description: 'Replace both injector return line assemblies and reseal high-pressure pump' },
    assignTo: 'lead',
  })
  await price(db, actors, {
    label: 'f250-hot-start',
    ticketId: hotStart.id,
    jobId: hotStart.jobs[0].id,
    lines: [
      { kind: 'labor', description: 'Replace both return line assemblies, reseal high-pressure pump, bleed and test', laborHours: '6' },
      { kind: 'part', description: 'Injector return line kit, 6.7L Power Stroke', quantity: '1', priceCents: 31_200, partNumber: 'BC3Z-9K022-A', brand: 'Motorcraft' },
      { kind: 'part', description: 'High-pressure pump seal kit', quantity: '1', priceCents: 8_640 },
    ],
  })
  const hotStartVersion = await buildQuote(db, actors, { label: 'f250-hot-start', ticketId: hotStart.id })
  await customerAnswer(db, actors, {
    label: 'f250-hot-start',
    ticketId: hotStart.id,
    jobId: hotStart.jobs[0].id,
    versionId: hotStartVersion,
    answer: { decision: 'approved', via: 'phone' },
  })
  await work(db, actors, {
    ticketId: hotStart.id,
    jobId: hotStart.jobs[0].id,
    who: 'lead',
    note: 'Return lines are weeping at both rear caps — confirmed with a clean rag on a hot restart. HPFP front seal is wet too. Old lines off, waiting on the seal kit to open the pump.',
  })
  must(await createWorkEscalation(db, {
    actor: { profileId: actors.lead.profileId, shopId: DEMO_SHOP_ID },
    ticketId: hotStart.id,
    sourceJobId: hotStart.jobs[0].id,
    body: {
      requestKey: key('found:f250-hot-start'),
      concern: 'Both front cab mount bushings are collapsed and the driver side is contacting the frame',
      requiredSkillTier: 2,
    },
  }), 'found work')
  await shiftTicketClock(db, { ticketId: hotStart.id, bySeconds: 5 * HOUR })

  // 4 — A partial answer. Yes to the brakes, no to the cabin filter, on one
  //     repair order and one quote.
  const highlander = await writeUp(db, actors, library, {
    label: 'highlander-brakes',
    customer: { name: 'Pam Ostrander', phone: '(512) 555-0164', email: 'p.ostrander@example.invalid' },
    vehicle: {
      year: 2019, make: 'Toyota', model: 'Highlander', engine: '3.5L V6',
      vin: '5TDJZRFH0KS612340', mileage: 74_910, plate: 'HRC-3318',
    },
    concern: 'It squeals backing out of the driveway in the morning, and the air conditioning smells like a locker room.',
    whenStarted: 'A month or so',
    howOften: 'Squeal every morning; the smell is all the time now',
    work: { mode: 'canned', canned: 'front-brakes' },
    assignTo: 'tech2',
  })
  must(await applyCannedJobToTicket(db, {
    actor: { profileId: actors.owner.profileId },
    ticketId: highlander.id,
    clientKey: key('apply:highlander-cabin'),
    cannedJobId: library['cabin-filter'].id,
    expectedFingerprint: library['cabin-filter'].fingerprint,
    expectedTaxRateBps: DEMO_SHOP.taxRateBps,
  }), 'apply cabin filter')
  const highlanderFull = await reload(db, actors, highlander.id)
  const brakeJob = jobByTitle(highlanderFull, 'Front brake pads and rotor service')
  const cabinJob = jobByTitle(highlanderFull, 'Cabin air filter and evaporator service')
  const highlanderVersion = await buildQuote(db, actors, { label: 'highlander', ticketId: highlander.id })
  await customerAnswer(db, actors, {
    label: 'highlander-brakes',
    ticketId: highlander.id,
    jobId: brakeJob,
    versionId: highlanderVersion,
    answer: { decision: 'approved', via: 'in_person' },
  })
  await customerAnswer(db, actors, {
    label: 'highlander-cabin',
    ticketId: highlander.id,
    jobId: cabinJob,
    versionId: highlanderVersion,
    answer: { decision: 'declined' },
  })
  await shiftTicketClock(db, { ticketId: highlander.id, bySeconds: 2 * HOUR })

  // 5 — Approved, running, and the parts desk owes him a turbo actuator.
  const turbo = await writeUp(db, actors, library, {
    label: 'f350-turbo',
    customer: { name: 'Hollis Barrett', phone: '(512) 555-0187', email: null },
    vehicle: {
      year: 2013, make: 'Ford', model: 'F-350 Super Duty', engine: '6.7L Power Stroke',
      vin: '1FT8W3BT0DEA55112', mileage: 241_660, plate: 'WNP-7714',
    },
    concern: 'No power at all up the hills with the trailer, and the wrench light came on Tuesday.',
    whenStarted: 'Getting worse for a month',
    howOften: 'Every time it is loaded',
    work: { mode: 'manual', kind: 'repair', description: 'Replace variable-geometry turbocharger actuator and relearn' },
    assignTo: 'tech2',
  })
  await price(db, actors, {
    label: 'f350-turbo',
    ticketId: turbo.id,
    jobId: turbo.jobs[0].id,
    lines: [
      { kind: 'labor', description: 'Replace VGT actuator, calibrate and road test loaded', laborHours: '2.6' },
      { kind: 'part', description: 'Variable-geometry turbo actuator, 6.7L Power Stroke', quantity: '1', priceCents: 79_500, partNumber: 'BC3Z-6F089-A', brand: 'Motorcraft' },
    ],
  })
  const turboVersion = await buildQuote(db, actors, { label: 'f350-turbo', ticketId: turbo.id })
  await customerAnswer(db, actors, {
    label: 'f350-turbo',
    ticketId: turbo.id,
    jobId: turbo.jobs[0].id,
    versionId: turboVersion,
    answer: { decision: 'approved', via: 'phone' },
  })
  await work(db, actors, {
    ticketId: turbo.id,
    jobId: turbo.jobs[0].id,
    who: 'tech2',
    note: 'Actuator sticks at 40 percent commanded, motor draws current but the vane arm will not sweep. Turbo itself has no shaft play. Old actuator is off.',
    clockRunning: false,
  })
  must(await createPartRequest(db, {
    actor: { profileId: actors.tech2.profileId, shopId: DEMO_SHOP_ID },
    ticketId: turbo.id,
    jobId: turbo.jobs[0].id,
    body: {
      requestKey: key('part:f350-turbo'),
      description: 'VGT turbo actuator, 2013 6.7L Power Stroke',
      preference: 'Motorcraft if anyone in town has one on the shelf today — customer needs the truck by Friday',
      quantity: 1,
    },
  }), 'part request')
  await shiftTicketClock(db, { ticketId: turbo.id, bySeconds: 26 * HOUR })

  // 6 — On hold, in the customer's own words.
  const clutch = await writeUp(db, actors, library, {
    label: 'ram-clutch',
    customer: { name: 'Wade Ferris', phone: '(512) 555-0126', email: 'wferris@example.invalid' },
    vehicle: {
      year: 2017, make: 'Ram', model: '3500', engine: '6.7L Cummins',
      vin: '3C63R3DL8HG703556', mileage: 189_340, plate: 'GQF-6605',
    },
    concern: 'Clutch pedal goes to the floor and it will not go into gear once it is warmed up.',
    whenStarted: 'Three weeks ago',
    howOften: 'Every day now',
    work: { mode: 'manual', kind: 'repair', description: 'Replace clutch, pressure plate and hydraulic slave cylinder' },
    assignTo: 'tech2',
  })
  await price(db, actors, {
    label: 'ram-clutch',
    ticketId: clutch.id,
    jobId: clutch.jobs[0].id,
    lines: [
      { kind: 'labor', description: 'Remove transmission, replace clutch assembly and slave cylinder, bleed and road test', laborHours: '8.5' },
      { kind: 'part', description: 'Clutch kit, G56 six-speed', quantity: '1', priceCents: 94_500, brand: 'South Bend' },
      { kind: 'part', description: 'Hydraulic slave cylinder', quantity: '1', priceCents: 18_900 },
    ],
  })
  const clutchVersion = await buildQuote(db, actors, { label: 'ram-clutch', ticketId: clutch.id })
  await customerAnswer(db, actors, {
    label: 'ram-clutch',
    ticketId: clutch.id,
    jobId: clutch.jobs[0].id,
    versionId: clutchVersion,
    answer: { decision: 'approved', via: 'in_person' },
  })
  await work(db, actors, {
    ticketId: clutch.id,
    jobId: clutch.jobs[0].id,
    who: 'tech2',
    note: 'Transmission is out. Disc is down to the rivets and the flywheel is heat checked all the way across. Stopped here to talk to him about the flywheel before I order anything.',
    clockRunning: false,
  })
  must(await mutateJobInterruption(db, {
    actor: {
      profileId: actors.tech2.profileId, shopId: DEMO_SHOP_ID, role: 'tech',
      membershipStatus: 'active', deactivatedAt: null,
    },
    ticketId: clutch.id,
    jobId: clutch.jobs[0].id,
    body: {
      action: 'block',
      requestKey: key('hold:ram-clutch'),
      holdKind: 'customer',
      holdNote: 'Customer wants to stop until he decides whether to do the flywheel while we are in there. He is calling his brother-in-law.',
    },
  }), 'hold clutch')
  await shiftTicketClock(db, { ticketId: clutch.id, bySeconds: 2 * DAY })

  // 7 — Priced three days ago. Nobody has told this customer anything since.
  const odyssey = await writeUp(db, actors, library, {
    label: 'odyssey-door',
    customer: { name: 'Bernice Tallman', phone: '(512) 555-0155', email: 'btallman@example.invalid' },
    vehicle: {
      year: 2020, make: 'Honda', model: 'Odyssey', engine: '3.5L V6',
      vin: '5FNRL6H72LB018446', mileage: 61_275, plate: 'PSD-1194',
    },
    concern: 'The passenger sliding door quit halfway open and there is a rattle underneath when I go over bumps.',
    whenStarted: 'The door quit last Thursday',
    howOften: 'The door is dead; the rattle is over every bump',
    work: { mode: 'manual', kind: 'repair', description: 'Replace right sliding door center roller and rear stabilizer links' },
    assignTo: null,
  })
  await price(db, actors, {
    label: 'odyssey-door',
    ticketId: odyssey.id,
    jobId: odyssey.jobs[0].id,
    lines: [
      { kind: 'labor', description: 'Replace right sliding door center roller assembly and both rear stabilizer links', laborHours: '2.2' },
      { kind: 'part', description: 'Sliding door center roller assembly, right', quantity: '1', priceCents: 24_800, partNumber: '72521-THR-A01', brand: 'Honda' },
      { kind: 'part', description: 'Rear stabilizer link, pair', quantity: '2', priceCents: 7_600 },
    ],
  })
  await buildQuote(db, actors, { label: 'odyssey-door', ticketId: odyssey.id })
  await shiftTicketClock(db, { ticketId: odyssey.id, bySeconds: 3 * DAY + 4 * HOUR })

  // 8 — The problem child. Two shops before this one, parts already thrown at
  //     it, and nothing new learned since Monday. The customer approved more
  //     diagnostic time rather than a guess.
  const noStart = await writeUp(db, actors, library, {
    label: 'f250-no-start',
    customer: { name: 'Gil Marchetti', phone: '(512) 555-0132', email: 'gmarchetti@example.invalid' },
    vehicle: {
      year: 2014, make: 'Ford', model: 'F-250 Super Duty', engine: '6.7L Power Stroke',
      vin: '1FT7W2BT9EEA71203', mileage: 227_915, plate: 'BXT-5023',
    },
    concern: 'Two other shops have had this truck. It just quits and will not restart, no warning and no light. One of them put a fuel pump in it, the other one did the FICM. Towed it twice.',
    whenStarted: 'Since March',
    howOften: 'Two or three times a month, no pattern I can find',
    work: { mode: 'diagnosis-manual', description: 'Find intermittent no-start — two prior shops, parts already replaced', laborHours: 2, priceCents: 31_000 },
    assignTo: 'lead',
  })
  const noStartVersion = await buildQuote(db, actors, { label: 'f250-no-start', ticketId: noStart.id })
  await customerAnswer(db, actors, {
    label: 'f250-no-start',
    ticketId: noStart.id,
    jobId: noStart.jobs[0].id,
    versionId: noStartVersion,
    answer: { decision: 'approved', via: 'in_person' },
  })
  await work(db, actors, {
    ticketId: noStart.id,
    jobId: noStart.jobs[0].id,
    who: 'lead',
    note: 'Three days on it and it has not failed for me once. No stored codes, no history codes. Fuel pressure holds 6800 psi cranking, CMP and CKP both clean on the scope. Data logger is wired to the FICM power feed and the cam sensor. Nothing to report until it drops.',
    clockRunning: false,
  })
  must(await addSupplementalDiagnosticTime(db, {
    actor: actors.owner,
    ticketId: noStart.id,
    body: {
      description: 'Additional diagnostic time — leave the logger on it until it fails',
      laborHours: 3,
      priceCents: 46_500,
      confirmBelowTier: true,
    },
  }), 'supplemental diagnostic time')
  const noStartFull = await reload(db, actors, noStart.id)
  const supplementalJob = jobByTitle(noStartFull, 'Additional diagnostic time — leave the logger on it until it fails')
  const noStartVersion2 = await buildQuote(db, actors, { label: 'f250-no-start-2', ticketId: noStart.id })
  await customerAnswer(db, actors, {
    label: 'f250-no-start-supplemental',
    ticketId: noStart.id,
    jobId: supplementalJob,
    versionId: noStartVersion2,
    answer: { decision: 'approved', via: 'phone' },
  })
  await shiftTicketClock(db, { ticketId: noStart.id, bySeconds: 5 * DAY })

  // 9 — The second hard one. Someone already sold this customer a turbo.
  const limp = await writeUp(db, actors, library, {
    label: 'ram-limp',
    customer: { name: 'Sylvia Renner', phone: '(512) 555-0141', email: null },
    vehicle: {
      year: 2016, make: 'Ram', model: '2500', engine: '6.7L Cummins',
      vin: '3C6UR5FL5GG287401', mileage: 176_540, plate: 'MTV-8836',
    },
    concern: 'The last shop put a turbo and an EGR cooler in it. It still drops into limp mode every single time I pull the trailer up a grade.',
    whenStarted: 'Before the turbo, and it never stopped',
    howOften: 'Every time it is loaded and hot',
    work: { mode: 'diagnosis', canned: 'diesel-diagnosis' },
    assignTo: 'lead',
  })
  const limpVersion = await buildQuote(db, actors, { label: 'ram-limp', ticketId: limp.id })
  await customerAnswer(db, actors, {
    label: 'ram-limp',
    ticketId: limp.id,
    jobId: limp.jobs[0].id,
    versionId: limpVersion,
    answer: { decision: 'approved', via: 'in_person' },
  })
  await work(db, actors, {
    ticketId: limp.id,
    jobId: limp.jobs[0].id,
    who: 'lead',
    note: 'Loaded it to 14,000 and pulled the hill. Derate at 1,100 F EGT with the DPF differential pinned. New turbo is fine. Soot load is reading 118 percent with only 400 miles since the last regen, so I am looking at the seventh injector and the DOC before anyone buys another part.',
    clockRunning: false,
  })
  await shiftTicketClock(db, { ticketId: limp.id, bySeconds: 2 * DAY + 3 * HOUR })

  // 10 — Done, sitting outside, still owed.
  const tahoe = await writeUp(db, actors, library, {
    label: 'tahoe-ac',
    customer: { name: 'Doug Prentiss', phone: '(512) 555-0109', email: 'dprentiss@example.invalid' },
    vehicle: {
      year: 2012, make: 'Chevrolet', model: 'Tahoe', engine: '5.3L V8',
      vin: '1GNSKBE05CR241889', mileage: 198_720, plate: 'CRW-2947',
    },
    concern: 'Air conditioning quit blowing cold about a week ago. It blows plenty of air, it is just warm.',
    whenStarted: 'Last week',
    howOften: 'All the time now',
    work: { mode: 'manual', kind: 'repair', description: 'Replace air conditioning compressor, accumulator and orifice tube; evacuate and recharge' },
    assignTo: 'tech2',
  })
  await price(db, actors, {
    label: 'tahoe-ac',
    ticketId: tahoe.id,
    jobId: tahoe.jobs[0].id,
    lines: [
      { kind: 'labor', description: 'Replace compressor, accumulator and orifice tube, flush lines, evacuate and recharge', laborHours: '4.2' },
      { kind: 'part', description: 'Air conditioning compressor with clutch', quantity: '1', priceCents: 42_900, brand: 'Denso' },
      { kind: 'part', description: 'Accumulator and orifice tube kit', quantity: '1', priceCents: 11_250 },
      { kind: 'part', description: 'R-134a refrigerant, 2.5 lb', quantity: '1', priceCents: 6_800 },
    ],
  })
  const tahoeVersion = await buildQuote(db, actors, { label: 'tahoe-ac', ticketId: tahoe.id })
  await customerAnswer(db, actors, {
    label: 'tahoe-ac',
    ticketId: tahoe.id,
    jobId: tahoe.jobs[0].id,
    versionId: tahoeVersion,
    answer: { decision: 'approved', via: 'phone' },
  })
  await work(db, actors, {
    ticketId: tahoe.id,
    jobId: tahoe.jobs[0].id,
    who: 'tech2',
    note: 'Compressor had metal in it, so the lines and condenser got flushed. New accumulator and orifice tube. Holds 28 inches for 45 minutes. Vent temp 41 F at idle with the doors open. Called and left a message that it is ready.',
    finish: true,
  })
  await shiftTicketClock(db, { ticketId: tahoe.id, bySeconds: 7 * HOUR })

  // 11 — Paid and closed this morning. Two jobs, one bill, nothing owed.
  const f150 = await writeUp(db, actors, library, {
    label: 'f150-service',
    customer: { name: 'Marisol Vega', phone: '(512) 555-0102', email: 'mvega@example.invalid' },
    vehicle: {
      year: 2019, make: 'Ford', model: 'F-150', engine: '2.7L EcoBoost',
      vin: '1FTEW1EP8KFA92117', mileage: 82_140, plate: 'DLN-6612',
    },
    concern: 'Due for an oil change, and the front end clunks over railroad tracks.',
    whenStarted: 'The clunk started a couple of months ago',
    howOften: 'Every bump',
    work: { mode: 'canned', canned: 'oil-service-gas' },
    assignTo: 'tech1',
  })
  const f150Link = must(await applyCannedJobToTicket(db, {
    actor: { profileId: actors.owner.profileId },
    ticketId: f150.id,
    clientKey: key('apply:f150-links'),
    cannedJobId: library['front-brakes'].id,
    expectedFingerprint: library['front-brakes'].fingerprint,
    expectedTaxRateBps: DEMO_SHOP.taxRateBps,
  }), 'apply f150 brakes')
  await assign(db, actors, {
    label: 'f150-brakes',
    ticketId: f150.id,
    jobId: f150Link.job.id,
    to: 'tech2',
  })
  const f150Version = await buildQuote(db, actors, { label: 'f150-service', ticketId: f150.id })
  await customerAnswer(db, actors, {
    label: 'f150-oil',
    ticketId: f150.id,
    jobId: f150.jobs[0].id,
    versionId: f150Version,
    answer: { decision: 'approved', via: 'in_person' },
  })
  await customerAnswer(db, actors, {
    label: 'f150-brakes',
    ticketId: f150.id,
    jobId: f150Link.job.id,
    versionId: f150Version,
    answer: { decision: 'approved', via: 'in_person' },
  })
  await work(db, actors, {
    ticketId: f150.id,
    jobId: f150.jobs[0].id,
    who: 'tech1',
    note: 'Oil and filter done, 6 quarts. Reset the monitor. Tires all at 35 psi, rotated. No leaks anywhere underneath.',
    finish: true,
  })
  await work(db, actors, {
    ticketId: f150.id,
    jobId: f150Link.job.id,
    who: 'tech2',
    note: 'Pads were down to 3 mm inboard. Rotors cleaned up at 0.020 under. Hardware and slides serviced. The clunk was the pads rattling in worn abutment clips, gone on the road test.',
    finish: true,
  })
  const f150RingOut = must(await getTicketRingOut(db, { actor: actors.owner, ticketId: f150.id }), 'f150 ring out')
  must(await recordTicketPayment(db, {
    actor: actors.owner,
    ticketId: f150.id,
    body: {
      requestKey: key('payment:f150'),
      amountCents: f150RingOut.ringOut.balanceCents,
      method: 'card',
      note: 'Paid at pickup',
    },
  }), 'f150 payment')
  must(await closeTicket(db, { actor: actors.owner, ticketId: f150.id }), 'f150 close')
  await shiftTicketClock(db, { ticketId: f150.id, bySeconds: 4 * HOUR })

  // 12 — Three weeks ago: the water pump this shop already did and got paid for.
  const sierraFirst = await writeUp(db, actors, library, {
    label: 'sierra-water-pump',
    customer: { name: 'Terrance Blake', phone: '(512) 555-0166', email: 'tblake@example.invalid' },
    vehicle: {
      year: 2015, make: 'GMC', model: 'Sierra 2500HD', engine: '6.6L Duramax',
      vin: '1GT12ZE85FF135420', mileage: 203_410, plate: 'FYH-4108',
    },
    concern: 'Temperature gauge climbing on the highway and I keep having to add coolant.',
    whenStarted: 'About a month ago',
    howOften: 'Any long drive',
    work: { mode: 'manual', kind: 'repair', description: 'Replace water pump and thermostat' },
    assignTo: 'tech2',
  })
  await price(db, actors, {
    label: 'sierra-water-pump',
    ticketId: sierraFirst.id,
    jobId: sierraFirst.jobs[0].id,
    lines: [
      { kind: 'labor', description: 'Replace water pump and thermostat, flush and bleed cooling system', laborHours: '3.5' },
      { kind: 'part', description: 'Water pump, 6.6L Duramax', quantity: '1', priceCents: 28_900, brand: 'ACDelco' },
      { kind: 'part', description: 'Thermostat and gasket', quantity: '1', priceCents: 6_450, brand: 'ACDelco' },
      { kind: 'part', description: 'Dex-Cool coolant, 2 gallons', quantity: '2', priceCents: 5_980 },
    ],
  })
  const sierraVersion = await buildQuote(db, actors, { label: 'sierra-water-pump', ticketId: sierraFirst.id })
  await customerAnswer(db, actors, {
    label: 'sierra-water-pump',
    ticketId: sierraFirst.id,
    jobId: sierraFirst.jobs[0].id,
    versionId: sierraVersion,
    answer: { decision: 'approved', via: 'phone' },
  })
  await work(db, actors, {
    ticketId: sierraFirst.id,
    jobId: sierraFirst.jobs[0].id,
    who: 'tech2',
    note: 'Water pump weep hole was dripping. New pump and thermostat, system flushed and filled with Dex-Cool. Pressure tested at 15 psi for 30 minutes, no drop. Ran to temperature twice.',
    finish: true,
  })
  const sierraRingOut = must(await getTicketRingOut(db, { actor: actors.owner, ticketId: sierraFirst.id }), 'sierra ring out')
  must(await recordTicketPayment(db, {
    actor: actors.owner,
    ticketId: sierraFirst.id,
    body: {
      requestKey: key('payment:sierra'),
      amountCents: sierraRingOut.ringOut.balanceCents,
      method: 'check',
      note: 'Check 4471',
    },
  }), 'sierra payment')
  must(await closeTicket(db, { actor: actors.owner, ticketId: sierraFirst.id }), 'sierra close')
  await shiftTicketClock(db, { ticketId: sierraFirst.id, bySeconds: 21 * DAY })

  // 13 — And this morning it came back. Same truck, same customer, no charge.
  const sierraComeback = await writeUp(db, actors, library, {
    label: 'sierra-comeback',
    customer: { name: 'Terrance Blake', phone: '(512) 555-0166', email: 'tblake@example.invalid' },
    vehicle: {
      year: 2015, make: 'GMC', model: 'Sierra 2500HD', engine: '6.6L Duramax',
      vin: '1GT12ZE85FF135420', mileage: 204_690, plate: 'FYH-4108',
    },
    concern: 'You did the water pump on it three weeks ago and there is coolant on my driveway again this morning.',
    whenStarted: 'This morning',
    howOften: 'Overnight, every night since Saturday',
    work: { mode: 'manual', kind: 'repair', description: 'Comeback — recheck cooling system after water pump replacement' },
    assignTo: 'tech2',
  })
  await price(db, actors, {
    label: 'sierra-comeback',
    ticketId: sierraComeback.id,
    jobId: sierraComeback.jobs[0].id,
    lines: [
      { kind: 'labor', description: 'Comeback inspection — pressure test and recheck our own work, no charge', laborHours: '1', priceCents: 0 },
    ],
  })
  const comebackVersion = await buildQuote(db, actors, { label: 'sierra-comeback', ticketId: sierraComeback.id })
  await customerAnswer(db, actors, {
    label: 'sierra-comeback',
    ticketId: sierraComeback.id,
    jobId: sierraComeback.jobs[0].id,
    versionId: comebackVersion,
    answer: { decision: 'approved', via: 'in_person' },
  })
  await work(db, actors, {
    ticketId: sierraComeback.id,
    jobId: sierraComeback.jobs[0].id,
    who: 'tech2',
    note: 'Pressure tested cold at 15 psi. Our pump and gasket are dry. The leak is the upper radiator seam about four inches in from the passenger tank — it is a crack in the plastic, not our work. Told Ray before I said anything to the customer.',
  })
  await shiftTicketClock(db, { ticketId: sierraComeback.id, bySeconds: 90 * 60 })

  // 14 — Priced nothing, assigned to nobody. This is the one the board should
  //     make somebody pick up.
  const rogue = await writeUp(db, actors, library, {
    label: 'rogue-grinding',
    customer: { name: 'Lorna Deitch', phone: '(512) 555-0138', email: null },
    vehicle: {
      year: 2017, make: 'Nissan', model: 'Rogue', engine: '2.5L I4',
      vin: 'JN8AT2MT6HW387905', mileage: 96_455, plate: 'KEP-7729',
    },
    concern: 'Grinding out of the back end when I turn right, and it is getting louder every week.',
    whenStarted: 'A month ago',
    howOften: 'Only turning right',
    work: { mode: 'manual', kind: 'repair', description: 'Find rear-end grinding on right turns' },
    assignTo: null,
  })
  await shiftTicketClock(db, { ticketId: rogue.id, bySeconds: 42 * 60 })

  // 15 — The one person sitting in the lobby. Under one percent of the cars
  //      that come through here, and it must not take over the screen.
  const outback = await writeUp(db, actors, library, {
    label: 'outback-battery',
    customer: { name: 'Priya Raman', phone: '(512) 555-0181', email: 'praman@example.invalid' },
    vehicle: {
      year: 2021, make: 'Subaru', model: 'Outback', engine: '2.5L H4',
      vin: '4S4BTAFC6M3184072', mileage: 48_330, plate: 'NQD-5560',
    },
    concern: 'I am waiting on it. Battery light flickers and it would not start in the grocery store parking lot yesterday.',
    whenStarted: 'Yesterday',
    howOften: 'Once so far, but the light is on now',
    work: { mode: 'manual', kind: 'repair', description: 'Test charging system and replace battery — customer waiting' },
    assignTo: 'tech1',
  })
  await price(db, actors, {
    label: 'outback-battery',
    ticketId: outback.id,
    jobId: outback.jobs[0].id,
    lines: [
      { kind: 'labor', description: 'Test charging system and battery, replace battery, verify output', laborHours: '0.7' },
      { kind: 'part', description: 'Group 25 AGM battery, 3-year free replacement', quantity: '1', priceCents: 22_900 },
    ],
  })
  const outbackVersion = await buildQuote(db, actors, { label: 'outback-battery', ticketId: outback.id })
  await customerAnswer(db, actors, {
    label: 'outback-battery',
    ticketId: outback.id,
    jobId: outback.jobs[0].id,
    versionId: outbackVersion,
    answer: { decision: 'approved', via: 'in_person' },
  })
  await work(db, actors, {
    ticketId: outback.id,
    jobId: outback.jobs[0].id,
    who: 'tech1',
    note: 'Battery tested 312 CCA of 650 and failed under load. Alternator puts out 14.2 V at idle and holds it with the lights and blower on, so the charging system is fine. New battery going in.',
  })
  await shiftTicketClock(db, { ticketId: outback.id, bySeconds: 48 * 60 })

  // 16 — Ordinary visible work for the least experienced technician, next to
  //      work he is not allowed to take.
  const escape = await writeUp(db, actors, library, {
    label: 'escape-lights',
    customer: { name: 'Hank Whitlow', phone: '(512) 555-0193', email: null },
    vehicle: {
      year: 2018, make: 'Ford', model: 'Escape', engine: '1.5L EcoBoost',
      vin: '1FMCU9GD1JUA40318', mileage: 105_220, plate: 'SVA-1176',
    },
    concern: 'Wipers quit working in the rain last night and the passenger headlight is out.',
    whenStarted: 'Last night',
    howOften: 'Wipers are dead; the light has been out a while',
    work: { mode: 'manual', kind: 'maintenance', description: 'Replace right low-beam headlight bulb' },
    assignTo: 'tech1',
  })
  await price(db, actors, {
    label: 'escape-lights',
    ticketId: escape.id,
    jobId: escape.jobs[0].id,
    lines: [
      { kind: 'labor', description: 'Replace right low-beam bulb and aim', laborHours: '0.4' },
      { kind: 'part', description: 'H11 low-beam bulb', quantity: '1', priceCents: 1_850, partNumber: 'H11', brand: 'Sylvania' },
    ],
  })
  const escapeVersion = await buildQuote(db, actors, { label: 'escape-lights', ticketId: escape.id })
  await customerAnswer(db, actors, {
    label: 'escape-lights',
    ticketId: escape.id,
    jobId: escape.jobs[0].id,
    versionId: escapeVersion,
    answer: { decision: 'approved', via: 'phone' },
  })
  await work(db, actors, {
    ticketId: escape.id,
    jobId: escape.jobs[0].id,
    who: 'tech1',
    note: 'Right low beam replaced and aimed. Left one is original and hazed, told Ray to mention it.',
  })
  must(await createWorkEscalation(db, {
    actor: { profileId: actors.tech1.profileId, shopId: DEMO_SHOP_ID },
    ticketId: escape.id,
    sourceJobId: escape.jobs[0].id,
    body: {
      requestKey: key('found:escape-wipers'),
      concern: 'Wiper motor does not run on any speed and the park switch has no signal — needs somebody on the wiring',
      requiredSkillTier: 2,
    },
  }), 'found wiper work')
  await shiftTicketClock(db, { ticketId: escape.id, bySeconds: 3 * HOUR })

  // ---- Receipt -------------------------------------------------------------

  const [counts] = await db
    .select({
      repairOrders: sql<number>`count(*)::int`,
      open: sql<number>`count(*) filter (where ${tickets.status} = 'open')::int`,
      closed: sql<number>`count(*) filter (where ${tickets.status} = 'closed')::int`,
    })
    .from(tickets)
    .where(eq(tickets.shopId, DEMO_SHOP_ID))
  const [jobCount] = await db
    .select({ jobs: sql<number>`count(*)::int` })
    .from(ticketJobs)
    .where(eq(ticketJobs.shopId, DEMO_SHOP_ID))

  return {
    shopId: DEMO_SHOP_ID,
    repairOrders: counts.repairOrders,
    open: counts.open,
    closed: counts.closed,
    jobs: jobCount.jobs,
    cannedJobs: CANNED_LIBRARY.length,
  }
}
