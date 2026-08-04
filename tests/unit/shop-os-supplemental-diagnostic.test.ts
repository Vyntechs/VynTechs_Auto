import { and, eq, inArray, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
  jobLines,
  profiles,
  quoteSends,
  quoteVersions,
  sessions,
  ticketJobs,
  tickets,
} from '@/lib/db/schema'
import { createCounterTicket } from '@/lib/intake/counter-ticket'
import {
  createQuoteVersion,
  getQuoteBuilder,
  recordQuoteDecision,
} from '@/lib/shop-os/quotes'
import {
  addSupplementalDiagnosticTime,
  MAX_TICKET_JOBS_PER_TICKET,
  SUPPLEMENTAL_DIAGNOSTIC_TITLE,
} from '@/lib/tickets'
import { createGoldenShopDay, GOLDEN_KEYS } from '@/tests/helpers/golden-shop-day'

type Golden = Awaited<ReturnType<typeof createGoldenShopDay>>

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

const supplementalBody = (
  clientKey: string,
  overrides: Record<string, unknown> = {},
) => ({
  clientKey,
  description: 'Additional diagnostic time',
  laborHours: 1,
  priceCents: 12_000,
  ...overrides,
})

async function seedDiagnosticTicket(
  golden: Golden,
  assignedTechId: string,
  confirmBelowTier = false,
) {
  const created = await createCounterTicket(golden.db, {
    actor: golden.actors.advisor,
    body: {
      clientKey: crypto.randomUUID(),
      vehicleMode: 'new',
      customer: golden.customer,
      vehicle: golden.vehicle,
      concern: 'Intermittent no-start; needs diagnosis.',
      work: {
        mode: 'diagnosis-manual',
        description: 'Diagnose intermittent no-start',
        laborHours: 1,
        priceCents: 12_000,
      },
      assignedTechId,
      ...(confirmBelowTier ? { confirmBelowTier: true } : {}),
    },
  })
  if (!created.ok) throw new Error('counter intake fixture failed')
  return created.ticket
}

async function prepareActiveVersion(golden: Golden, ticketId: string) {
  const actor = { profileId: golden.people.advisor.id }
  const builder = await getQuoteBuilder(golden.db, { actor, ticketId })
  if (!builder.ok || !builder.builder.draftCommitment) {
    throw new Error('quote commitment fixture failed')
  }
  const created = await createQuoteVersion(golden.db, {
    actor,
    ticketId,
    expectedDraftFingerprint: builder.builder.draftCommitment.fingerprint,
  })
  if (!created.ok) throw new Error('quote version fixture failed')
  const [stored] = await golden.db
    .select()
    .from(quoteVersions)
    .where(eq(quoteVersions.id, created.version.id))
  if (!stored) throw new Error('stored quote version fixture missing')
  return { created, stored }
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
    subjectKey: uuid(900),
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

async function ticketRows(golden: Golden, ticketId: string) {
  const jobs = await golden.db
    .select()
    .from(ticketJobs)
    .where(and(eq(ticketJobs.shopId, golden.shop.id), eq(ticketJobs.ticketId, ticketId)))
  const lines = await golden.db
    .select()
    .from(jobLines)
    .where(and(
      eq(jobLines.shopId, golden.shop.id),
      inArray(jobLines.jobId, jobs.map((job) => job.id)),
    ))
  return { jobs, lines }
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

describe('addSupplementalDiagnosticTime', () => {
  it('persists a supplemental diagnostic job and labor line assigned by default to the ticket diagnostic technician', async () => {
    const golden = await createGoldenShopDay()
    try {
      const ticket = await seedDiagnosticTicket(golden, golden.people.tech.id)
      const originalJobId = ticket.jobs[0].id

      const result = await addSupplementalDiagnosticTime(golden.db, {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: {
          clientKey: uuid(301),
          description: 'Additional diagnostic time — deeper electrical trace',
          laborHours: 1.5,
          priceCents: 28_125,
        },
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      const added = result.ticket.jobs.find((job) => job.id !== originalJobId)
      expect(added).toMatchObject({
        title: 'Additional diagnostic time — deeper electrical trace',
        kind: 'diagnostic',
        requiredSkillTier: 2,
        assignedTechId: golden.people.tech.id,
        sessionId: null,
        workStatus: 'open',
        approvalState: 'pending_quote',
      })
      if (!added) return
      expect(await golden.db.select().from(jobLines).where(eq(jobLines.jobId, added.id)))
        .toEqual([
          expect.objectContaining({
            jobId: added.id,
            kind: 'labor',
            description: 'Additional diagnostic time — deeper electrical trace',
            priceCents: 28_125,
            laborHours: 1.5,
            taxable: false,
            source: 'manual',
          }),
        ])
    } finally {
      await golden.close()
    }
  })

  it('defaults the title to "Additional diagnostic time" when the writer types no description', async () => {
    const golden = await createGoldenShopDay()
    try {
      const ticket = await seedDiagnosticTicket(golden, golden.people.tech.id)
      const originalJobId = ticket.jobs[0].id

      const result = await addSupplementalDiagnosticTime(golden.db, {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: { clientKey: uuid(302), laborHours: 0.5, priceCents: 6_000 },
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      const added = result.ticket.jobs.find((job) => job.id !== originalJobId)
      expect(added?.title).toBe(SUPPLEMENTAL_DIAGNOSTIC_TITLE)
      if (!added) return
      const [line] = await golden.db.select().from(jobLines).where(eq(jobLines.jobId, added.id))
      expect(line).toMatchObject({
        description: SUPPLEMENTAL_DIAGNOSTIC_TITLE,
        kind: 'labor',
        priceCents: 6_000,
      })
    } finally {
      await golden.close()
    }
  })

  it('yields a job that is quotable and approvable through the existing quote engine while still open', async () => {
    const golden = await createGoldenShopDay()
    try {
      const ticket = await seedDiagnosticTicket(golden, golden.people.tech.id)
      const originalJobId = ticket.jobs[0].id

      const added = await addSupplementalDiagnosticTime(golden.db, {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: {
          clientKey: uuid(303),
          description: 'Additional diagnostic time — customer approved overage',
          laborHours: 1,
          priceCents: 12_000,
        },
      })
      expect(added.ok).toBe(true)
      if (!added.ok) return
      const supplemental = added.ticket.jobs.find((job) => job.id !== originalJobId)
      if (!supplemental) throw new Error('supplemental job missing')

      const builder = await getQuoteBuilder(golden.db, {
        actor: { profileId: golden.people.advisor.id }, ticketId: ticket.id,
      })
      if (!builder.ok || !builder.builder.draftCommitment) throw new Error('quote commitment failed')
      const version = await createQuoteVersion(golden.db, {
        actor: { profileId: golden.people.advisor.id },
        ticketId: ticket.id,
        expectedDraftFingerprint: builder.builder.draftCommitment.fingerprint,
      })
      expect(version).toMatchObject({ ok: true, changed: true })
      if (!version.ok) throw new Error('quote version failed')

      const decision = await recordQuoteDecision(golden.db, {
        actor: { profileId: golden.people.advisor.id },
        ticketId: ticket.id,
        body: {
          requestKey: GOLDEN_KEYS.approval,
          jobId: supplemental.id,
          quoteVersionId: version.version.id,
          decision: 'approved',
          approvedVia: 'phone',
        },
      })
      expect(decision).toMatchObject({
        ok: true,
        projection: { approvalState: 'approved', approvedQuoteVersionId: version.version.id },
      })

      const [persisted] = await golden.db
        .select({ workStatus: ticketJobs.workStatus, approvalState: ticketJobs.approvalState })
        .from(ticketJobs)
        .where(eq(ticketJobs.id, supplemental.id))
      expect(persisted).toMatchObject({ workStatus: 'open', approvalState: 'approved' })
    } finally {
      await golden.close()
    }
  })

  it('rejects supplemental diagnostic time on a ticket that is no longer open, writing nothing', async () => {
    const golden = await createGoldenShopDay()
    try {
      const ticket = await seedDiagnosticTicket(golden, golden.people.tech.id)
      await golden.db.update(tickets).set({ status: 'closed' }).where(eq(tickets.id, ticket.id))
      const jobsBefore = await golden.db.select().from(ticketJobs)
      const linesBefore = await golden.db.select().from(jobLines)

      const result = await addSupplementalDiagnosticTime(golden.db, {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: supplementalBody(uuid(304)),
      })

      expect(result).toEqual({ ok: false, error: 'ticket_not_open' })
      expect(await golden.db.select().from(ticketJobs)).toEqual(jobsBefore)
      expect(await golden.db.select().from(jobLines)).toEqual(linesBefore)
    } finally {
      await golden.close()
    }
  })

  it('surfaces the below-tier warning when the default technician is under tier, then proceeds on confirmation', async () => {
    const golden = await createGoldenShopDay()
    try {
      const [tierOneTech] = await golden.db
        .insert(profiles)
        .values({
          userId: '00000000-0000-4000-8000-000000000911',
          shopId: golden.shop.id,
          role: 'tech',
          skillTier: 1,
          fullName: 'Tier One Tech',
        })
        .returning()
      const ticket = await seedDiagnosticTicket(golden, tierOneTech.id, true)

      const warned = await addSupplementalDiagnosticTime(golden.db, {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: supplementalBody(uuid(305)),
      })
      expect(warned).toEqual({
        ok: false,
        error: 'tier_confirmation_required',
        warning: {
          code: 'below_required_tier',
          assignedTechId: tierOneTech.id,
          assignedSkillTier: 1,
          requiredSkillTier: 2,
        },
      })

      const confirmed = await addSupplementalDiagnosticTime(golden.db, {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: {
          clientKey: uuid(305),
          description: 'Additional diagnostic time',
          laborHours: 1,
          priceCents: 12_000,
          confirmBelowTier: true,
        },
      })
      expect(confirmed.ok).toBe(true)
      if (!confirmed.ok) return
      const added = confirmed.ticket.jobs.find((job) => job.id !== ticket.jobs[0].id)
      expect(added?.assignedTechId).toBe(tierOneTech.id)
    } finally {
      await golden.close()
    }
  })

  it('rejects non-positive labor hours before any write', async () => {
    const golden = await createGoldenShopDay()
    try {
      const ticket = await seedDiagnosticTicket(golden, golden.people.tech.id)
      const jobsBefore = await golden.db.select().from(ticketJobs)

      for (const laborHours of [0, -1]) {
        await expect(addSupplementalDiagnosticTime(golden.db, {
          actor: golden.actors.advisor,
          ticketId: ticket.id,
          body: supplementalBody(uuid(306 + Math.abs(laborHours)), { laborHours }),
        })).resolves.toEqual({ ok: false, error: 'invalid_input' })
      }
      expect(await golden.db.select().from(ticketJobs)).toEqual(jobsBefore)
    } finally {
      await golden.close()
    }
  })

  it('rejects an ambiguous request beyond the stored two-decimal hour precision before writing', async () => {
    const golden = await createGoldenShopDay()
    try {
      const ticket = await seedDiagnosticTicket(golden, golden.people.tech.id)
      const before = await ticketRows(golden, ticket.id)
      const input = {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: supplementalBody(uuid(319), { laborHours: 1.234 }),
      }

      await expect(addSupplementalDiagnosticTime(golden.db, input))
        .resolves.toEqual({ ok: false, error: 'invalid_input' })
      await expect(addSupplementalDiagnosticTime(golden.db, input))
        .resolves.toEqual({ ok: false, error: 'invalid_input' })
      expect(await ticketRows(golden, ticket.id)).toEqual(before)
    } finally {
      await golden.close()
    }
  })

  it('converges an ambiguous exact replay at stored hour precision on one deterministic job and line', async () => {
    const golden = await createGoldenShopDay()
    try {
      const ticket = await seedDiagnosticTicket(golden, golden.people.tech.id)
      const clientKey = uuid(320)
      const input = {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: supplementalBody(clientKey, {
          description: '  Deeper electrical trace  ',
          laborHours: 1.23,
          priceCents: 28_125,
        }),
      }

      const first = await addSupplementalDiagnosticTime(golden.db, input)
      const replay = await addSupplementalDiagnosticTime(golden.db, input)
      expect(first.ok).toBe(true)
      expect(replay.ok).toBe(true)
      if (!first.ok || !replay.ok) return

      const firstJob = first.ticket.jobs.find((job) => job.id !== ticket.jobs[0].id)
      const replayJob = replay.ticket.jobs.find((job) => job.id !== ticket.jobs[0].id)
      expect(first.confirmation).toEqual({
        clientKey,
        jobId: firstJob?.id,
        title: 'Deeper electrical trace',
        laborHours: 1.23,
        priceCents: 28_125,
      })
      expect(replay.confirmation).toEqual(first.confirmation)
      expect(firstJob?.id).toBe(replayJob?.id)
      expect(firstJob?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
      const rows = await ticketRows(golden, ticket.id)
      expect(rows.jobs.filter((job) => job.id === firstJob?.id)).toHaveLength(1)
      expect(rows.lines.filter((line) => line.jobId === firstJob?.id)).toEqual([
        expect.objectContaining({
          kind: 'labor',
          description: 'Deeper electrical trace',
          sort: 0,
          quantity: 1,
          priceCents: 28_125,
          taxable: false,
          laborHours: 1.23,
          source: 'manual',
        }),
      ])
    } finally {
      await golden.close()
    }
  })

  it.each([
    ['unit cost', { unitCostCents: 1 }],
    ['core charge', { coreChargeCents: 1 }],
    ['fitment', { fitment: 'unexpected fitment' }],
    ['vendor snapshot', { vendorSnapshot: { source: 'unexpected' } }],
    ['part status', { partStatus: 'needs_order' as const }],
    ['ordered timestamp', { orderedAt: new Date('2026-08-03T12:00:00.000Z') }],
    ['ordered-by identity', { orderedByProfileId: uuid(11) }],
    ['received timestamp', { receivedAt: new Date('2026-08-03T12:00:00.000Z') }],
    ['received-by identity', { receivedByProfileId: uuid(11) }],
  ])('refuses exact replay when the deterministic labor line has unexpected %s metadata', async (_label, corruption) => {
    const golden = await createGoldenShopDay()
    try {
      const ticket = await seedDiagnosticTicket(golden, golden.people.tech.id)
      const input = {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: supplementalBody(uuid(341)),
      }
      const first = await addSupplementalDiagnosticTime(golden.db, input)
      expect(first.ok).toBe(true)
      if (!first.ok) return

      await golden.db.update(jobLines)
        .set(corruption)
        .where(eq(jobLines.jobId, first.confirmation.jobId))

      await expect(addSupplementalDiagnosticTime(golden.db, input))
        .resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
    } finally {
      await golden.close()
    }
  })

  it('treats UUID casing as the same persisted request identity', async () => {
    const golden = await createGoldenShopDay()
    try {
      const ticket = await seedDiagnosticTicket(golden, golden.people.tech.id)
      const clientKey = uuid(338)
      const first = await addSupplementalDiagnosticTime(golden.db, {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: supplementalBody(clientKey),
      })
      const replay = await addSupplementalDiagnosticTime(golden.db, {
        actor: {
          ...golden.actors.advisor,
          profileId: golden.actors.advisor.profileId.toUpperCase(),
          shopId: golden.actors.advisor.shopId?.toUpperCase() ?? null,
        },
        ticketId: ticket.id.toUpperCase(),
        body: supplementalBody(clientKey.toUpperCase()),
      })

      expect(first.ok).toBe(true)
      expect(replay.ok).toBe(true)
      if (!first.ok || !replay.ok) return
      expect(replay.confirmation).toEqual(first.confirmation)
      const rows = await ticketRows(golden, ticket.id)
      expect(rows.jobs).toHaveLength(2)
      expect(rows.lines.filter((line) => line.jobId === first.confirmation.jobId)).toHaveLength(1)
    } finally {
      await golden.close()
    }
  })

  it('conflicts when one client key is replayed with a different normalized intent', async () => {
    const golden = await createGoldenShopDay()
    try {
      const ticket = await seedDiagnosticTicket(golden, golden.people.tech.id)
      const clientKey = uuid(321)
      const firstBody = supplementalBody(clientKey, {
        description: '  Deeper electrical trace  ',
        laborHours: 1.5,
        priceCents: 28_125,
      })
      await expect(addSupplementalDiagnosticTime(golden.db, {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: firstBody,
      })).resolves.toMatchObject({ ok: true })

      for (const body of [
        supplementalBody(clientKey, { description: 'Different trace', laborHours: 1.5, priceCents: 28_125 }),
        supplementalBody(clientKey, { description: 'Deeper electrical trace', laborHours: 2, priceCents: 28_125 }),
        supplementalBody(clientKey, { description: 'Deeper electrical trace', laborHours: 1.5, priceCents: 28_126 }),
      ]) {
        await expect(addSupplementalDiagnosticTime(golden.db, {
          actor: golden.actors.advisor,
          ticketId: ticket.id,
          body,
        })).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
      }
      const rows = await ticketRows(golden, ticket.id)
      expect(rows.jobs).toHaveLength(2)
      expect(rows.lines.filter((line) => line.jobId !== ticket.jobs[0].id)).toHaveLength(1)
    } finally {
      await golden.close()
    }
  })

  it('scopes the same client key to the ticket as well as the persisted caller', async () => {
    const golden = await createGoldenShopDay()
    try {
      const firstTicket = await seedDiagnosticTicket(golden, golden.people.tech.id)
      const secondTicket = await seedDiagnosticTicket(golden, golden.people.tech.id)
      const clientKey = uuid(322)
      const add = (ticketId: string, actor = golden.actors.advisor) => addSupplementalDiagnosticTime(golden.db, {
        actor,
        ticketId,
        body: supplementalBody(clientKey),
      })

      const first = await add(firstTicket.id)
      const second = await add(secondTicket.id)
      const third = await add(firstTicket.id, golden.actors.owner)
      expect(first.ok).toBe(true)
      expect(second.ok).toBe(true)
      expect(third.ok).toBe(true)
      if (!first.ok || !second.ok || !third.ok) return
      const firstId = first.ticket.jobs.find((job) => job.id !== firstTicket.jobs[0].id)?.id
      const secondId = second.ticket.jobs.find((job) => job.id !== secondTicket.jobs[0].id)?.id
      const thirdId = third.ticket.jobs.find((job) => (
        job.id !== firstTicket.jobs[0].id && job.id !== firstId
      ))?.id
      expect(firstId).toBeTruthy()
      expect(secondId).toBeTruthy()
      expect(thirdId).toBeTruthy()
      expect(firstId).not.toBe(secondId)
      expect(firstId).not.toBe(thirdId)
      expect(secondId).not.toBe(thirdId)
    } finally {
      await golden.close()
    }
  })

  it.each([
    ['deactivated', { deactivatedAt: new Date('2026-08-03T12:00:00.000Z') }, { ok: false, error: 'inactive_profile' }],
    ['role-drifted', { role: 'tech' }, { ok: false, error: 'forbidden' }],
  ] as const)('reauthorizes a %s persisted caller under lock before writing', async (_label, change, expected) => {
    const golden = await createGoldenShopDay()
    try {
      const ticket = await seedDiagnosticTicket(golden, golden.people.tech.id)
      await golden.db.update(profiles).set(change).where(eq(profiles.id, golden.people.advisor.id))
      const before = await ticketRows(golden, ticket.id)
      await expect(addSupplementalDiagnosticTime(golden.db, {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: supplementalBody(uuid(323)),
      })).resolves.toEqual(expected)
      expect(await ticketRows(golden, ticket.id)).toEqual(before)
    } finally {
      await golden.close()
    }
  })

  it('never lets an exact replay bypass current caller authorization', async () => {
    const golden = await createGoldenShopDay()
    try {
      const ticket = await seedDiagnosticTicket(golden, golden.people.tech.id)
      const input = {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: supplementalBody(uuid(324)),
      }
      await expect(addSupplementalDiagnosticTime(golden.db, input)).resolves.toMatchObject({ ok: true })
      await golden.db.update(profiles).set({ role: 'tech' }).where(eq(profiles.id, golden.people.advisor.id))
      await expect(addSupplementalDiagnosticTime(golden.db, input))
        .resolves.toEqual({ ok: false, error: 'forbidden' })
      const rows = await ticketRows(golden, ticket.id)
      expect(rows.jobs).toHaveLength(2)
    } finally {
      await golden.close()
    }
  })

  it('replays against the stored supplemental assignee after the original diagnostic is reassigned', async () => {
    const golden = await createGoldenShopDay()
    try {
      const ticket = await seedDiagnosticTicket(golden, golden.people.tech.id)
      const input = {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: supplementalBody(uuid(334)),
      }
      const first = await addSupplementalDiagnosticTime(golden.db, input)
      expect(first.ok).toBe(true)
      if (!first.ok) return

      await golden.db.update(ticketJobs)
        .set({ assignedTechId: golden.people.relief.id })
        .where(eq(ticketJobs.id, ticket.jobs[0].id))
      const replay = await addSupplementalDiagnosticTime(golden.db, input)
      expect(replay).toMatchObject({ ok: true, confirmation: first.confirmation })
      if (!replay.ok) return
      expect(replay.ticket.jobs.find((job) => job.id === first.confirmation.jobId)?.assignedTechId)
        .toBe(golden.people.tech.id)
    } finally {
      await golden.close()
    }
  })

  it('keeps an unassigned supplemental job unassigned when the original diagnostic is assigned later', async () => {
    const golden = await createGoldenShopDay()
    try {
      const ticket = await seedDiagnosticTicket(golden, golden.people.tech.id)
      await golden.db.update(ticketJobs)
        .set({ assignedTechId: null })
        .where(eq(ticketJobs.id, ticket.jobs[0].id))
      const input = {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: supplementalBody(uuid(339)),
      }
      const first = await addSupplementalDiagnosticTime(golden.db, input)
      expect(first.ok).toBe(true)
      if (!first.ok) return
      expect(first.ticket.jobs.find((job) => job.id === first.confirmation.jobId)?.assignedTechId).toBeNull()

      await golden.db.update(ticketJobs)
        .set({ assignedTechId: golden.people.tech.id })
        .where(eq(ticketJobs.id, ticket.jobs[0].id))
      const replay = await addSupplementalDiagnosticTime(golden.db, input)
      expect(replay).toMatchObject({ ok: true, confirmation: first.confirmation })
      if (!replay.ok) return
      expect(replay.ticket.jobs.find((job) => job.id === first.confirmation.jobId)?.assignedTechId).toBeNull()
    } finally {
      await golden.close()
    }
  })

  it('refuses replay when the stored supplemental assignee is deactivated after original reassignment', async () => {
    const golden = await createGoldenShopDay()
    try {
      const ticket = await seedDiagnosticTicket(golden, golden.people.tech.id)
      const input = {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: supplementalBody(uuid(335)),
      }
      const first = await addSupplementalDiagnosticTime(golden.db, input)
      expect(first.ok).toBe(true)
      if (!first.ok) return

      await golden.db.update(ticketJobs)
        .set({ assignedTechId: golden.people.relief.id })
        .where(eq(ticketJobs.id, ticket.jobs[0].id))
      await golden.db.update(profiles)
        .set({ deactivatedAt: new Date('2026-08-03T12:00:00.000Z') })
        .where(eq(profiles.id, golden.people.tech.id))

      await expect(addSupplementalDiagnosticTime(golden.db, input))
        .resolves.toEqual({ ok: false, error: 'invalid_assignee' })
    } finally {
      await golden.close()
    }
  })

  it('returns current truth when an exact replay has legitimately started its diagnostic session', async () => {
    const golden = await createGoldenShopDay()
    try {
      const ticket = await seedDiagnosticTicket(golden, golden.people.tech.id)
      const input = {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: supplementalBody(uuid(336)),
      }
      const first = await addSupplementalDiagnosticTime(golden.db, input)
      expect(first.ok).toBe(true)
      if (!first.ok) return

      const sessionId = uuid(342)
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
          nodes: [{ id: 'root', label: 'Verify the concern', status: 'active' }],
          currentNodeId: 'root',
          message: 'Begin with a visual inspection.',
        },
      })
      await golden.db.update(ticketJobs)
        .set({
          approvalState: 'approved',
          workStatus: 'in_progress',
          sessionId,
          diagnosticStartState: 'ready',
        })
        .where(eq(ticketJobs.id, first.confirmation.jobId))
      const replay = await addSupplementalDiagnosticTime(golden.db, input)
      expect(replay).toMatchObject({ ok: true, confirmation: first.confirmation })
      if (!replay.ok) return
      expect(replay.ticket.jobs.find((job) => job.id === first.confirmation.jobId)).toMatchObject({
        approvalState: 'approved',
        workStatus: 'in_progress',
        sessionId,
        diagnosticStartState: 'ready',
      })
    } finally {
      await golden.close()
    }
  })

  it('rejects an inherited assignee deactivated after the ticket lock and rolls back', async () => {
    const golden = await createGoldenShopDay()
    try {
      const ticket = await seedDiagnosticTicket(golden, golden.people.tech.id)
      const before = await ticketRows(golden, ticket.id)
      const result = await addSupplementalDiagnosticTime(golden.db, {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: supplementalBody(uuid(325)),
      }, {
        afterTicketLock: async (transactionDb) => {
          await transactionDb.update(profiles)
            .set({ deactivatedAt: new Date('2026-08-03T12:00:00.000Z') })
            .where(eq(profiles.id, golden.people.tech.id))
        },
      })
      expect(result).toEqual({ ok: false, error: 'invalid_assignee' })
      expect(await ticketRows(golden, ticket.id)).toEqual(before)
    } finally {
      await golden.close()
    }
  })

  it('executes the canonical sorted NOWAIT lock order before actionable links', async () => {
    const golden = await createGoldenShopDay()
    try {
      const ticket = await seedDiagnosticTicket(golden, golden.people.tech.id)
      await prepareActiveVersion(golden, ticket.id)
      const statements: string[] = []
      const result = await addSupplementalDiagnosticTime(golden.db, {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: supplementalBody(uuid(340)),
      }, {
        captureLockSql: (statement) => statements.push(statement.replace(/\s+/g, ' ')),
        afterLinkLock: async () => { statements.push('after-link-lock') },
      })

      expect(result.ok).toBe(true)
      expect(statements).toEqual([
        expect.stringMatching(/from "tickets".*for update nowait/i),
        expect.stringMatching(/from "ticket_jobs".*order by "ticket_jobs"\."id".*for update nowait/i),
        expect.stringMatching(/from "job_lines".*order by "job_lines"\."id".*for update nowait/i),
        expect.stringMatching(/from "quote_versions".*order by "quote_versions"\."id".*for update nowait/i),
        expect.stringMatching(/from "profiles".*order by "profiles"\."id".*for update nowait/i),
        'after-link-lock',
      ])
    } finally {
      await golden.close()
    }
  })

  it('classifies ticket-lock contention as retryable and writes nothing', async () => {
    const golden = await createGoldenShopDay()
    try {
      const ticket = await seedDiagnosticTicket(golden, golden.people.tech.id)
      const before = await ticketRows(golden, ticket.id)
      await expect(addSupplementalDiagnosticTime(golden.db, {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: supplementalBody(uuid(326)),
      }, {
        afterTicketLock: async () => {
          throw Object.assign(new Error('ticket held'), { code: '55P03' })
        },
      })).resolves.toEqual({ ok: false, error: 'conflict', retryable: true })
      expect(await ticketRows(golden, ticket.id)).toEqual(before)
    } finally {
      await golden.close()
    }
  })

  it('enforces the ticket job limit before invalidation or insertion', async () => {
    const golden = await createGoldenShopDay()
    try {
      const ticket = await seedDiagnosticTicket(golden, golden.people.tech.id)
      await golden.db.insert(ticketJobs).values(Array.from(
        { length: MAX_TICKET_JOBS_PER_TICKET - ticket.jobs.length },
        (_, index) => ({
          shopId: golden.shop.id,
          ticketId: ticket.id,
          title: `Existing work ${index}`,
          kind: 'repair' as const,
          requiredSkillTier: 1,
        }),
      ))
      const before = await ticketRows(golden, ticket.id)
      await expect(addSupplementalDiagnosticTime(golden.db, {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: supplementalBody(uuid(327)),
      })).resolves.toEqual({ ok: false, error: 'job_limit_reached' })
      expect(await ticketRows(golden, ticket.id)).toEqual(before)
    } finally {
      await golden.close()
    }
  })

  it('invalidates V1 and its link before adding priced work while preserving immutable bytes', async () => {
    const golden = await createGoldenShopDay()
    try {
      const ticket = await seedDiagnosticTicket(golden, golden.people.tech.id)
      const { created: version, stored } = await prepareActiveVersion(golden, ticket.id)
      const snapshotBytes = JSON.stringify(stored.snapshot)
      await golden.db.update(ticketJobs).set({
        approvalState: 'approved',
        approvedQuoteVersionId: version.version.id,
      }).where(eq(ticketJobs.id, ticket.jobs[0].id))
      const link = await addActionableLink(golden, ticket.id, version.version.id, uuid(328))

      const result = await addSupplementalDiagnosticTime(golden.db, {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: supplementalBody(uuid(329), { priceCents: 18_000 }),
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const added = result.ticket.jobs.find((job) => job.id !== ticket.jobs[0].id)
      expect(added).toMatchObject({ approvalState: 'pending_quote', kind: 'diagnostic' })
      if (!added) return

      const [oldVersion] = await golden.db.select().from(quoteVersions)
        .where(eq(quoteVersions.id, version.version.id))
      expect(oldVersion.supersededAt).toEqual(expect.any(Date))
      expect(JSON.stringify(oldVersion.snapshot)).toBe(snapshotBytes)
      expect(snapshotBytes).not.toContain(added.id)
      const [expiredLink] = await golden.db.select().from(quoteSends).where(eq(quoteSends.id, link.id))
      expect(expiredLink).toMatchObject({
        state: 'expired',
        tokenHash: null,
        tokenExpiresAt: null,
        terminalAt: expect.any(Date),
      })
      const [originalJob] = await golden.db.select().from(ticketJobs)
        .where(eq(ticketJobs.id, ticket.jobs[0].id))
      expect(originalJob).toMatchObject({ approvalState: 'pending_quote', approvedQuoteVersionId: null })
      expect(await golden.db.select().from(jobLines).where(eq(jobLines.jobId, added.id))).toEqual([
        expect.objectContaining({ priceCents: 18_000, kind: 'labor' }),
      ])
      const builder = await getQuoteBuilder(golden.db, {
        actor: { profileId: golden.people.advisor.id },
        ticketId: ticket.id,
      })
      expect(builder).toMatchObject({ ok: true, builder: { activeVersion: null } })
      if (builder.ok) expect(builder.builder.jobs.map((job) => job.id)).toContain(added.id)
    } finally {
      await golden.close()
    }
  })

  it.each(['schema-invalid', 'semantically-corrupt'] as const)(
    'rolls back without partial invalidation when V1 is %s',
    async (corruption) => {
      const golden = await createGoldenShopDay()
      try {
        const ticket = await seedDiagnosticTicket(golden, golden.people.tech.id)
        const { created: version, stored } = await prepareActiveVersion(golden, ticket.id)
        const replacement = corruption === 'schema-invalid'
          ? { broken: true }
          : (() => {
              const snapshot = structuredClone(stored.snapshot) as { ticket: { number: number } }
              snapshot.ticket.number += 1
              return snapshot as unknown as Record<string, unknown>
            })()
        await replaceVersionSnapshot(golden, version.version.id, replacement)
        const before = await ticketRows(golden, ticket.id)

        await expect(addSupplementalDiagnosticTime(golden.db, {
          actor: golden.actors.advisor,
          ticketId: ticket.id,
          body: supplementalBody(uuid(corruption === 'schema-invalid' ? 330 : 331)),
        })).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
        expect(await ticketRows(golden, ticket.id)).toEqual(before)
        const [unchanged] = await golden.db.select().from(quoteVersions)
          .where(eq(quoteVersions.id, version.version.id))
        expect(unchanged.supersededAt).toBeNull()
      } finally {
        await golden.close()
      }
    },
  )

  it('rolls back insertion and all V1 changes when the actionable-link lock fails', async () => {
    const golden = await createGoldenShopDay()
    try {
      const ticket = await seedDiagnosticTicket(golden, golden.people.tech.id)
      const { created: version } = await prepareActiveVersion(golden, ticket.id)
      const link = await addActionableLink(golden, ticket.id, version.version.id, uuid(332))
      const before = await ticketRows(golden, ticket.id)
      await expect(addSupplementalDiagnosticTime(golden.db, {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: supplementalBody(uuid(333)),
      }, {
        afterLinkLock: async () => {
          throw Object.assign(new Error('link held'), { code: '55P03' })
        },
      })).resolves.toEqual({ ok: false, error: 'conflict', retryable: true })
      expect(await ticketRows(golden, ticket.id)).toEqual(before)
      const [unchangedVersion] = await golden.db.select().from(quoteVersions)
        .where(eq(quoteVersions.id, version.version.id))
      const [unchangedLink] = await golden.db.select().from(quoteSends).where(eq(quoteSends.id, link.id))
      expect(unchangedVersion.supersededAt).toBeNull()
      expect(unchangedLink).toMatchObject({ state: 'submitted', tokenHash: 'b'.repeat(64) })
    } finally {
      await golden.close()
    }
  })
})
