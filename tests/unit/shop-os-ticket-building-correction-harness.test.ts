import { and, eq } from 'drizzle-orm'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  customers,
  jobLines,
  quoteSends,
  quoteVersions,
  ticketActivity,
  ticketJobs,
  vehicles,
} from '@/lib/db/schema'
import { createCounterTicket } from '@/lib/intake/counter-ticket'
import {
  createAdHocJob,
  createDraftLine,
  createQuoteVersion,
  getQuoteBuilder,
} from '@/lib/shop-os/quotes'
import { correctTicket } from '@/lib/shop-os/ticket-corrections'
import { addSupplementalDiagnosticTime } from '@/lib/tickets'
import { createTestDb, ensureTicketCorrectionMigration } from '@/tests/helpers/db'
import { createGoldenShopDay } from '@/tests/helpers/golden-shop-day'
import {
  CANONICAL_TICKET_CORRECTION_BASE_URL,
  assertTicketCorrectionHarnessSafety,
} from '@/tests/e2e/ticket-building-correction-harness/safety.mjs'
import {
  createHash as harnessCreateHash,
  createHmac as harnessCreateHmac,
  randomUUID as harnessRandomUUID,
  timingSafeEqual as harnessTimingSafeEqual,
} from '@/tests/e2e/ticket-building-correction-harness/node-crypto'

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

const OLD_EXPRESSION = "kind in ('work_paused', 'work_resumed', 'work_completed', 'job_blocked', 'job_hold_resolved', 'job_reassigned', 'job_handed_off', 'ticket_canceled', 'ticket_reopened')"
const COMPLETE_DEFINITION = "CHECK ((kind = ANY (ARRAY['work_paused'::text, 'work_resumed'::text, 'work_completed'::text, 'job_blocked'::text, 'job_hold_resolved'::text, 'job_reassigned'::text, 'job_handed_off'::text, 'ticket_canceled'::text, 'ticket_reopened'::text, 'ticket_corrected'::text])))"

async function constraintState(client: Awaited<ReturnType<typeof createTestDb>>['client']) {
  const result = await client.query<{
    oid: number
    definition: string
    contype: string
    convalidated: boolean
    connoinherit: boolean
  }>(`
    select oid::int, pg_get_constraintdef(oid) as definition,
      contype::text, convalidated, connoinherit
    from pg_constraint
    where conrelid = to_regclass('public.ticket_activity')
      and conname = 'ticket_activity_kind_valid'
  `)
  return result.rows[0] ?? null
}

async function replaceConstraint(
  client: Awaited<ReturnType<typeof createTestDb>>['client'],
  expression: string | null,
) {
  await client.exec('alter table public.ticket_activity drop constraint if exists ticket_activity_kind_valid;')
  if (expression) {
    await client.exec(`alter table public.ticket_activity add constraint ticket_activity_kind_valid check (${expression});`)
  }
}

async function createDiagnosisFirstTicket(golden: Awaited<ReturnType<typeof createGoldenShopDay>>) {
  const result = await createCounterTicket(golden.db, {
    actor: golden.actors.advisor,
    body: {
      clientKey: uuid(801),
      vehicleMode: 'new',
      customer: golden.customer,
      vehicle: golden.vehicle,
      concern: 'Brake pedal shakes under load.',
      work: {
        mode: 'diagnosis-manual',
        description: 'Diagnose brake vibration',
        laborHours: 1,
        priceCents: 12_000,
      },
      assignedTechId: golden.people.tech.id,
    },
  })
  if (!result.ok) throw new Error('diagnosis-first fixture failed')
  return result.ticket
}

async function addActionableLink(
  golden: Awaited<ReturnType<typeof createGoldenShopDay>>,
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
    subjectKey: uuid(890),
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

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('ticket-building correction proof harness safety', () => {
  it('accepts only the exact secret-free loopback envelope', () => {
    expect(assertTicketCorrectionHarnessSafety({}, CANONICAL_TICKET_CORRECTION_BASE_URL)).toEqual({
      baseUrl: CANONICAL_TICKET_CORRECTION_BASE_URL,
      loopback: true,
      productionVercelMode: false,
      forbiddenEnvironmentPresent: false,
    })
  })

  it.each([
    'DATABASE_URL',
    'DATABASE_URL_DIRECT',
    'SUPABASE_SERVICE_ROLE_KEY',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  ])('rejects presence of %s even when empty without reading its value', (name) => {
    expect(() => assertTicketCorrectionHarnessSafety({ [name]: '' }))
      .toThrow(new RegExp(name))
  })

  it('rejects production mode and every noncanonical URL', () => {
    expect(() => assertTicketCorrectionHarnessSafety({ VERCEL_ENV: 'production' }))
      .toThrow(/production Vercel mode/)
    for (const url of [
      'http://localhost:4181',
      'http://127.0.0.1:4182',
      'https://127.0.0.1:4181',
      'https://preview.example.invalid',
    ]) {
      expect(() => assertTicketCorrectionHarnessSafety({}, url)).toThrow(/canonical loopback URL/)
    }
  })

  it('runs the guard before loading Vite and disables Vite environment files', async () => {
    const server = await readFile(resolve(
      process.cwd(),
      'tests/e2e/ticket-building-correction-harness/server.mjs',
    ), 'utf8')
    expect(server.indexOf('assertTicketCorrectionHarnessSafety(process.env'))
      .toBeLessThan(server.indexOf("import('@vitejs/plugin-react')"))
    expect(server).toMatch(/envFile:\s*false/)
  })

  it('aliases only the Node crypto boundary and fails visibly if product behavior reaches it', async () => {
    const server = await readFile(resolve(
      process.cwd(),
      'tests/e2e/ticket-building-correction-harness/server.mjs',
    ), 'utf8')
    expect(server).toContain("'node:crypto': resolve(harnessRoot, 'node-crypto.ts')")
    for (const serverOnlyExport of [
      harnessCreateHash,
      harnessCreateHmac,
      harnessRandomUUID,
      harnessTimingSafeEqual,
    ]) {
      expect(() => serverOnlyExport()).toThrow(
        'server-only node:crypto reached the ticket correction browser harness',
      )
    }
  })

  it('gives the real predictive-search input a 44px border box inherited by phone and desktop', async () => {
    const css = await readFile(resolve(
      process.cwd(),
      'components/vt/intake-search/intake-search.css',
    ), 'utf8')
    const baseInputRule = css.match(/\.pis__input\s*\{([^}]*)\}/)?.[1] ?? ''

    expect(baseInputRule).toMatch(/min-height:\s*44px/)
    expect(baseInputRule).toMatch(/box-sizing:\s*border-box/)
  })

  it('never copies a forbidden environment value into its refusal', () => {
    const sentinel = 'must-not-appear-in-error'
    let message = ''
    try {
      assertTicketCorrectionHarnessSafety({ DATABASE_URL: sentinel })
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain('DATABASE_URL')
    expect(message).not.toContain(sentinel)
  })
})

describe('migrated PGlite persistence half of the split proof', () => {
  it('proves exact-old to complete 0051, exact-complete no-op, drift refusal, and atomic rollback of DDL/data/trigger/ledger state', async () => {
    const fixture = await createTestDb()
    try {
      const exactCompleteBefore = await constraintState(fixture.client)
      expect(exactCompleteBefore?.definition).toBe(COMPLETE_DEFINITION)
      await ensureTicketCorrectionMigration(fixture.client)
      expect(await constraintState(fixture.client)).toEqual(exactCompleteBefore)

      await replaceConstraint(fixture.client, OLD_EXPRESSION)
      await ensureTicketCorrectionMigration(fixture.client)
      expect(await constraintState(fixture.client)).toMatchObject({
        definition: COMPLETE_DEFINITION,
        contype: 'c',
        convalidated: true,
        connoinherit: false,
      })

      await replaceConstraint(fixture.client, "kind in ('work_paused')")
      const drift = await constraintState(fixture.client)
      await expect(ensureTicketCorrectionMigration(fixture.client))
        .rejects.toThrow(/unexpected ticket correction constraint state/)
      expect(await constraintState(fixture.client)).toEqual(drift)

      await replaceConstraint(fixture.client, OLD_EXPRESSION)
      const beforeConstraint = await constraintState(fixture.client)
      const beforeTriggers = await fixture.client.query(`
        select tgname, tgenabled from pg_trigger
        where tgrelid = to_regclass('public.ticket_activity') and not tgisinternal
        order by tgname
      `)
      const beforeRows = await fixture.client.query('select count(*)::int as count from public.ticket_activity')
      await fixture.client.exec(`
        create table if not exists public.schema_migrations (
          filename text primary key,
          checksum text not null,
          applied_at timestamptz not null default now()
        );
      `)
      await fixture.client.exec('begin;')
      await ensureTicketCorrectionMigration(fixture.client)
      await fixture.client.exec(`
        insert into public.schema_migrations (filename, checksum)
        values ('0051_shop_os_ticket_corrections.sql', 'forced-failure');
      `)
      await expect(fixture.client.exec('select 1 / 0;')).rejects.toThrow()
      await fixture.client.exec('rollback;')

      expect(await constraintState(fixture.client)).toEqual(beforeConstraint)
      expect(await fixture.client.query(`
        select tgname, tgenabled from pg_trigger
        where tgrelid = to_regclass('public.ticket_activity') and not tgisinternal
        order by tgname
      `)).toEqual(beforeTriggers)
      expect(await fixture.client.query('select count(*)::int as count from public.ticket_activity'))
        .toEqual(beforeRows)
      expect((await fixture.client.query(`
        select filename from public.schema_migrations
        where filename = '0051_shop_os_ticket_corrections.sql'
      `)).rows).toEqual([])
    } finally {
      await fixture.close()
    }
  })

  it('persists Finish and pre-prepare identity/concern/job corrections, then preserves immutable V1 while expiring its handoff', async () => {
    vi.stubEnv('SHOP_OS_TICKET_CORRECTION_ENABLED', 'true')
    const golden = await createGoldenShopDay()
    try {
      let ticket = await createDiagnosisFirstTicket(golden)
      const repair = await createAdHocJob(golden.db, {
        actor: { profileId: golden.people.advisor.id },
        ticketId: ticket.id,
        clientKey: uuid(802),
        body: { title: 'Replace front brake pads', kind: 'repair' },
      })
      expect(repair).toMatchObject({ ok: true, changed: true })
      if (!repair.ok) return
      const priced = await createDraftLine(golden.db, {
        actor: { profileId: golden.people.advisor.id },
        ticketId: ticket.id,
        jobId: repair.job.id,
        clientKey: uuid(803),
        body: {
          kind: 'labor', description: 'Replace front brake pads',
          laborHours: '2', laborRateCents: 12_000, taxable: false,
        },
      })
      expect(priced).toMatchObject({ ok: true, changed: true, line: { priceCents: 24_000 } })

      const [newCustomer] = await golden.db.insert(customers).values({
        shopId: golden.shop.id, name: 'Correct Customer', phone: '202-555-0199', email: null,
      }).returning()
      const [newVehicle] = await golden.db.insert(vehicles).values({
        customerId: newCustomer.id,
        year: 2021, make: 'Ram', model: '2500', engine: '6.7L', mileage: 88_300,
      }).returning()

      const identity = await correctTicket(golden.db, {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: {
          action: 'identity', requestKey: uuid(804),
          expectedTicketUpdatedAt: ticket.updatedAt.toISOString(), expectedActiveVersionId: null,
          selection: { mode: 'existing', vehicleId: newVehicle.id },
        },
      })
      expect(identity).toMatchObject({ ok: true, outcome: 'changed', scope: 'identity' })
      if (!identity.ok) return
      ticket = identity.ticket

      const concern = await correctTicket(golden.db, {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: {
          action: 'concern', requestKey: uuid(805),
          expectedTicketUpdatedAt: ticket.updatedAt.toISOString(), expectedActiveVersionId: null,
          concern: 'Brake vibration corrected after road test.',
        },
      })
      expect(concern).toMatchObject({ ok: true, outcome: 'changed', scope: 'concern' })
      if (!concern.ok) return
      ticket = concern.ticket

      const repairJob = ticket.jobs.find((candidate) => candidate.id === repair.job.id)
      if (!repairJob) throw new Error('repair job missing after concern correction')
      const jobCorrection = await correctTicket(golden.db, {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: {
          action: 'job', requestKey: uuid(806),
          expectedTicketUpdatedAt: ticket.updatedAt.toISOString(), expectedActiveVersionId: null,
          jobId: repairJob.id, expectedJobUpdatedAt: repairJob.updatedAt.toISOString(),
          title: 'Replace front pads and hardware', kind: 'repair',
          customerSuppliedPartsNote: null,
        },
      })
      expect(jobCorrection).toMatchObject({ ok: true, outcome: 'changed', scope: 'job' })
      if (!jobCorrection.ok) return
      ticket = jobCorrection.ticket

      const beforePrepareReceipts = await golden.db.select().from(ticketActivity)
        .where(eq(ticketActivity.ticketId, ticket.id))
      expect(beforePrepareReceipts).toHaveLength(3)
      expect(beforePrepareReceipts.map((row) => (row.payload as { scope: string }).scope).sort())
        .toEqual(['concern', 'identity', 'job'])

      const builder = await getQuoteBuilder(golden.db, {
        actor: { profileId: golden.people.advisor.id }, ticketId: ticket.id,
      })
      if (!builder.ok || !builder.builder.draftCommitment) throw new Error('quote commitment failed')
      const prepared = await createQuoteVersion(golden.db, {
        actor: { profileId: golden.people.advisor.id }, ticketId: ticket.id,
        expectedDraftFingerprint: builder.builder.draftCommitment.fingerprint,
      })
      expect(prepared).toMatchObject({ ok: true, changed: true, version: { versionNumber: 1 } })
      if (!prepared.ok) return
      const [storedV1] = await golden.db.select().from(quoteVersions)
        .where(eq(quoteVersions.id, prepared.version.id))
      const snapshotBytes = JSON.stringify(storedV1.snapshot)
      const link = await addActionableLink(golden, ticket.id, prepared.version.id, uuid(807))

      const afterV1 = await correctTicket(golden.db, {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: {
          action: 'concern', requestKey: uuid(808),
          expectedTicketUpdatedAt: ticket.updatedAt.toISOString(),
          expectedActiveVersionId: prepared.version.id,
          concern: 'Brake vibration now confirmed at highway speed.',
        },
      })
      expect(afterV1).toMatchObject({
        ok: true, outcome: 'changed', scope: 'concern', invalidatedVersionNumber: 1,
      })
      if (!afterV1.ok) return
      const replay = await correctTicket(golden.db, {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: {
          action: 'concern', requestKey: uuid(808),
          expectedTicketUpdatedAt: ticket.updatedAt.toISOString(),
          expectedActiveVersionId: prepared.version.id,
          concern: 'Brake vibration now confirmed at highway speed.',
        },
      })
      expect(replay).toMatchObject({ ok: true, outcome: 'replayed', changed: false })

      const [immutableV1] = await golden.db.select().from(quoteVersions)
        .where(eq(quoteVersions.id, prepared.version.id))
      const [expiredLink] = await golden.db.select().from(quoteSends).where(eq(quoteSends.id, link.id))
      expect(JSON.stringify(immutableV1.snapshot)).toBe(snapshotBytes)
      expect(immutableV1.supersededAt).toBeInstanceOf(Date)
      expect(expiredLink).toMatchObject({ state: 'expired', tokenHash: null, tokenExpiresAt: null })
      expect(await golden.db.select().from(ticketActivity)
        .where(eq(ticketActivity.ticketId, ticket.id))).toHaveLength(4)
      expect(await golden.db.select().from(jobLines).where(and(
        eq(jobLines.jobId, repair.job.id), eq(jobLines.priceCents, 24_000),
      ))).toHaveLength(1)
    } finally {
      await golden.close()
    }
  })

  it('reuses one supplemental request identity and persists exactly one supplemental job and line', async () => {
    const golden = await createGoldenShopDay()
    try {
      const ticket = await createDiagnosisFirstTicket(golden)
      const input = {
        actor: golden.actors.advisor,
        ticketId: ticket.id,
        body: {
          clientKey: uuid(820),
          description: 'Additional diagnostic time — deeper electrical trace',
          laborHours: 1.25,
          priceCents: 15_000,
        },
      }
      const first = await addSupplementalDiagnosticTime(golden.db, input)
      const replay = await addSupplementalDiagnosticTime(golden.db, input)
      expect(first).toMatchObject({ ok: true })
      expect(replay).toMatchObject({ ok: true })
      if (!first.ok || !replay.ok) return
      expect(replay.confirmation).toEqual(first.confirmation)
      const jobs = await golden.db.select().from(ticketJobs)
        .where(eq(ticketJobs.ticketId, ticket.id))
      const supplemental = jobs.filter((row) => row.id === first.confirmation.jobId)
      const lines = await golden.db.select().from(jobLines)
        .where(eq(jobLines.jobId, first.confirmation.jobId))
      expect(supplemental).toHaveLength(1)
      expect(lines).toEqual([expect.objectContaining({
        jobId: first.confirmation.jobId,
        description: 'Additional diagnostic time — deeper electrical trace',
        laborHours: 1.25,
        priceCents: 15_000,
      })])
    } finally {
      await golden.close()
    }
  })
})
