import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { jobLines, profiles, ticketJobs, tickets } from '@/lib/db/schema'
import { createCounterTicket } from '@/lib/intake/counter-ticket'
import { createQuoteVersion, recordQuoteDecision } from '@/lib/shop-os/quotes'
import {
  addSupplementalDiagnosticTime,
  SUPPLEMENTAL_DIAGNOSTIC_TITLE,
} from '@/lib/tickets'
import { createGoldenShopDay, GOLDEN_KEYS } from '@/tests/helpers/golden-shop-day'

type Golden = Awaited<ReturnType<typeof createGoldenShopDay>>

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
        body: { laborHours: 0.5, priceCents: 6_000 },
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
          description: 'Additional diagnostic time — customer approved overage',
          laborHours: 1,
          priceCents: 12_000,
        },
      })
      expect(added.ok).toBe(true)
      if (!added.ok) return
      const supplemental = added.ticket.jobs.find((job) => job.id !== originalJobId)
      if (!supplemental) throw new Error('supplemental job missing')

      const version = await createQuoteVersion(golden.db, {
        actor: { profileId: golden.people.advisor.id },
        ticketId: ticket.id,
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
        body: { description: 'Additional diagnostic time', laborHours: 1, priceCents: 12_000 },
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
        body: { description: 'Additional diagnostic time', laborHours: 1, priceCents: 12_000 },
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
          body: { description: 'Additional diagnostic time', laborHours, priceCents: 12_000 },
        })).resolves.toEqual({ ok: false, error: 'invalid_input' })
      }
      expect(await golden.db.select().from(ticketJobs)).toEqual(jobsBefore)
    } finally {
      await golden.close()
    }
  })
})
