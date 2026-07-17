import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
  mutateTicketJobAssignment,
  type TicketActor,
} from '@/lib/tickets'
import { recordQuoteDecision } from '@/lib/shop-os/quotes'
import {
  customers,
  profiles,
  quoteEvents,
  quoteVersions,
  shops,
  ticketJobs,
  tickets,
  vehicles,
} from '@/lib/db/schema'
import { createTestDb } from '@/tests/helpers/db'
import { assertContinuityPostgresUrlV1 } from '@/tests/helpers/postgres-continuity-db'

const root = process.cwd()

async function readTask10Source(path: string): Promise<string> {
  try {
    return await readFile(resolve(root, path), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
}

describe('ShopOS continuity cross-writer race guards', () => {
  it('loads the executable Vitest default config with the bounded integration contract', async () => {
    const configModule = await import('../../vitest.config')
    const config = await configModule.default

    expect(config.test?.maxWorkers).toBe(4)
    expect(config.test?.include).toContain('tests/integration/**/*.test.ts')
  })

  it('accepts only the exact disposable loopback PostgreSQL database before connecting', () => {
    for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
      expect(() => assertContinuityPostgresUrlV1(
        `postgresql://postgres:test@${host}:5432/continuity_test`,
      )).not.toThrow()
    }
    for (const candidate of [
      undefined,
      'not a URL',
      'https://127.0.0.1/continuity_test',
      'postgresql://postgres:test@db.example.com/continuity_test',
      'postgresql://postgres:test@127.0.0.1/postgres',
      'postgresql://postgres:test@127.0.0.1/continuity_test/extra',
    ]) {
      expect(() => assertContinuityPostgresUrlV1(candidate)).toThrow()
    }
  })

  it('applies the complete 0000 through 0037 source migration inventory without the stale journal', async () => {
    const source = await readTask10Source(
      'tests/helpers/postgres-continuity-db.ts',
    )

    expect(source).toContain("files[0] !== '0000_whole_domino.sql'")
    expect(source).toContain("files.at(-1) !== '0037_shop_os_continuity_foundation.sql'")
    expect(source).toContain("resolve(process.cwd(), 'drizzle/migrations')")
    expect(source).not.toContain('__drizzle_migrations')
    expect(source).not.toContain('meta/_journal.json')
    expect(source).toContain('create database')
    expect(source).toContain('drop database')
    expect(source).toContain('pg_terminate_backend')
    expect(source).toContain('randomUUID')
    expect(source).toContain('cleanup')
  })

  it('requires the real PostgreSQL race suite and explicit package entrypoint', async () => {
    const [integrationSource, packageSource] = await Promise.all([
      readTask10Source(
        'tests/integration/shop-os-continuity-postgres-races.test.ts',
      ),
      readTask10Source('package.json'),
    ])

    expect(integrationSource).toContain('REQUIRE_CONTINUITY_POSTGRES')
    expect(integrationSource).toContain('CONTINUITY_POSTGRES_URL')
    expect(integrationSource).toContain('250')
    expect(integrationSource).toContain('beforeEach(async () =>')
    expect(integrationSource).toContain('afterEach(async () =>')
    expect(integrationSource).not.toContain('beforeAll(async () =>')
    expect(integrationSource).toContain("wait_event_type = 'Lock'")
    expect(integrationSource).toContain('afterDiscovery: async () =>')
    expect(integrationSource).not.toMatch(/setTimeout\([^,]+,\s*(?:50|100)\)/)
    expect(integrationSource).not.toMatch(/\.ok\s*\?[\s\S]{0,80}:\s*await/)
    expect(packageSource).toContain('test:continuity:postgres')
  })
})

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

type ExecutableRaceOwner = Readonly<{ file: string; title: string }>
type UnitRaceMatrixEntry = Readonly<{
  id: string
  requirement: string
  owners: readonly ExecutableRaceOwner[]
}>

const UNIT_CROSS_WRITER_RACE_MATRIX_V1: readonly UnitRaceMatrixEntry[] = [
  {
    id: 'assignment_vs_quote_decision',
    requirement: 'assignment versus quote decision on one ticket',
    owners: [{
      file: 'tests/unit/shop-os-continuity-cross-writer-races.test.ts',
      title: 'serializes assignment versus quote decision on one ticket without losing either revision',
    }],
  },
  {
    id: 'story_vs_line_invalidation',
    requirement: 'story save versus line edit and quote invalidation',
    owners: [
      { file: 'tests/unit/shop-os-customer-stories.test.ts', title: 'detects selected evidence and quote-version CAS drift after provider work' },
      { file: 'tests/unit/shop-os-customer-story-review.test.ts', title: 'invalidates an active version only when public story content changes' },
      { file: 'tests/unit/shop-os-quote-drafts.test.ts', title: 'invalidates the sole active version and resets every included job but leaves excluded jobs unchanged' },
    ],
  },
  {
    id: 'add_job_vs_quote_version',
    requirement: 'add-job versus quote-version creation',
    owners: [{ file: 'tests/unit/shop-os-quote-versions.test.ts', title: 'serializes same-ticket add-job and version creation on the ticket lock' }],
  },
  {
    id: 'diagnostic_vs_assignment',
    requirement: 'diagnostic finalize versus sibling assignment',
    owners: [
      { file: 'tests/unit/shop-os-diagnostic-start.test.ts', title: 'never links the old technician after assignment changes during provider work' },
      { file: 'tests/unit/shop-os-job-assignment.test.ts', title: 'loses a reassign race when the diagnostic lease starts after prevalidation' },
    ],
  },
  {
    id: 'simple_work_vs_ticketed_close',
    requirement: 'simple-work completion versus ticketed diagnostic close on sibling jobs',
    owners: [
      { file: 'tests/unit/shop-os-simple-work.test.ts', title: 'uses real ticket/session truth while preserving completed closed history' },
      { file: 'tests/unit/shop-os-repair-close-handlers.test.ts', title: 'closes approved performed work and marks its job done' },
      { file: 'tests/unit/shop-os-repair-close-handlers.test.ts', title: 'keeps terminal close replay as the existing no-op response with no second revision bump' },
    ],
  },
  {
    id: 'manual_offer_vs_quote_version',
    requirement: 'manual-offer insert/delete versus quote-version creation',
    owners: [
      { file: 'tests/unit/shop-os-manual-offers.test.ts', title: 'invalidates active quote truth atomically and rolls back when invalidation fails' },
      { file: 'tests/unit/shop-os-manual-offers.test.ts', title: 'removes only proposed unordered vendor offers and makes missing retries unchanged' },
      { file: 'tests/unit/shop-os-quote-versions.test.ts', title: 'deterministically converges same-state calls on one PGlite client and versions later changed state' },
    ],
  },
  {
    id: 'two_actor_assignment',
    requirement: 'two actors assigning each other profile targets',
    owners: [{ file: 'tests/unit/shop-os-job-assignment.test.ts', title: 'returns only the safe current assignee to sequential and concurrent losing claimers' }],
  },
  {
    id: 'exact_retry_no_double_bump',
    requirement: 'Quick, quote decision, canned apply, escalation, and diagnostic exact retries do not double-bump',
    owners: [
      { file: 'tests/unit/shop-os-quick-ticket.test.ts', title: 'binds request identity to actor, replays exact input, and rotates changed keys' },
      { file: 'tests/unit/shop-os-quote-decisions.test.ts', title: 'returns an actor-bound exact retry before stale-version rejection and includes the latest projection' },
      { file: 'tests/unit/shop-os-canned-job-apply.test.ts', title: 'makes same-key replay first-success-wins after template replacement and retirement' },
      { file: 'tests/unit/shop-os-work-escalation.test.ts', title: 'creates one honest unassigned diagnostic and replays the exact request' },
      { file: 'tests/unit/shop-os-diagnostic-start.test.ts', title: 'finalize bumps job, projection, and continuity once while canonical replays bump nothing' },
    ],
  },
  {
    id: 'quick_changed_and_pre_receipt_conflicts',
    requirement: 'changed Quick payload and deterministic pre-receipt ticket conflict without identifiers',
    owners: [
      { file: 'tests/unit/shop-os-quick-ticket.test.ts', title: 'does not disclose or reuse a deterministic identity collision with incompatible persisted truth' },
      { file: 'tests/unit/shop-os-quick-ticket.test.ts', title: 'returns an identifier-free retryable conflict when a historical HMAC key is unavailable' },
    ],
  },
  {
    id: 'origin_bound_receipt_harness',
    requirement: 'constant business content changes only Counter, Quick, or Tech Quick origin',
    owners: [
      { file: 'tests/unit/shop-os-continuity-receipts.test.ts', title: 'keeps constant business content origin-bound across counter, Quick, and Tech Quick' },
      { file: 'tests/unit/shop-os-quick-ticket.test.ts', title: 'replays the exact original request without mutation after template, tax, and identity drift' },
    ],
  },
  {
    id: 'tech_quick_session_collision',
    requirement: 'Tech Quick sessions_pkey exact, changed, cross-actor, and cross-shop classification',
    owners: [
      { file: 'tests/unit/shop-os-tech-quick-session.test.ts', title: 'keeps an exact sessions_pkey collision with a persisted cross-shop occupant stable' },
      { file: 'tests/unit/shop-os-tech-quick-session.test.ts', title: 'locked replay refuses missing, changed, malformed, inactive, and wrong-job occupation without IDs' },
      { file: 'tests/unit/shop-os-tech-quick-session.test.ts', title: 'rejects a cross-actor request-key collision without exposing or changing the first result' },
    ],
  },
  {
    id: 'quick_drift_and_hint_races',
    requirement: 'canned/tax/identity drift, retired templates, duplicate identities, and stale receipt hints restart safely',
    owners: [
      { file: 'tests/unit/shop-os-quick-ticket.test.ts', title: 'replays the exact original request without mutation after template, tax, and identity drift' },
      { file: 'tests/unit/shop-os-quick-ticket.test.ts', title: 'retries one stale-positive hint, loads the keyring once, and reaches one insert' },
      { file: 'tests/unit/shop-os-quick-ticket.test.ts', title: 'treats a forced-absent hint as advisory and suppresses prepared work for an owned receipt' },
      { file: 'tests/unit/shop-os-ticket-intake-identity.test.ts', title: 'fails closed on duplicate customer or vehicle natural-key sets' },
    ],
  },
  {
    id: 'counter_quick_identity_races',
    requirement: 'Counter/Counter and Counter/Quick phone, VIN, plate, mileage, and insertion-intent identity convergence',
    owners: [
      { file: 'tests/integration/shop-os-continuity-postgres-races.test.ts', title: 'serializes production Counter/Counter phone, VIN, plate, mileage, and insertion-intent races' },
      { file: 'tests/integration/shop-os-continuity-postgres-races.test.ts', title: 'serializes production Counter/Quick phone, VIN, plate, mileage, and insertion-intent races' },
    ],
  },
  {
    id: 'attempt_bound_handles_and_receipts',
    requirement: 'prior-attempt identity/template handles and forged finalized receipt results fail closed',
    owners: [
      { file: 'tests/unit/shop-os-ticket-intake-identity.test.ts', title: 'rejects forged, prior-attempt, and extra-intent handles without an identity write' },
      { file: 'tests/unit/shop-os-quick-ticket.test.ts', title: 'rejects attempt-one handles during allowlisted unique-collision recovery' },
      { file: 'tests/unit/shop-os-continuity-receipts.test.ts', title: 'refuses 26 results, duplicate identities, and cross-ticket jobs before receipt commit' },
      { file: 'tests/unit/shop-os-continuity-receipts.test.ts', title: 'refuses persisted child-count corruption without returning result identity' },
    ],
  },
  {
    id: 'rollback_and_retryable_sqlstates',
    requirement: 'post-write/finalization/pre-receipt failures roll back and 55P03/40001/40P01 map equally',
    owners: [
      { file: 'tests/unit/shop-os-continuity-revisions.test.ts', title: 'rolls back domain and revision writes across every finalization failure seam' },
      { file: 'tests/unit/shop-os-continuity-receipts.test.ts', title: 'rolls back domain and finalized revisions when failure occurs before receipt insertion' },
      { file: 'tests/unit/shop-os-quote-decisions.test.ts', title: "it.each(['55P03', '40001', '40P01'] as const)" },
    ],
  },
  {
    id: 'bigint_and_multi_job_cardinality',
    requirement: 'unsafe-integer revisions round-trip exactly and multi-job mutation bumps each row once',
    owners: [
      { file: 'tests/unit/shop-os-quote-decisions.test.ts', title: 'classifies first decisions, reversals, and new-key same-state events at bigint-safe revisions' },
      { file: 'tests/unit/shop-os-counter-ticket.test.ts', title: 'atomically finalizes a two-job Counter batch once with ordered revision-one rows' },
      { file: 'tests/unit/shop-os-continuity-revisions.test.ts', title: 'finalizes a registered 25-job creation at revision one with exact parent bindings' },
    ],
  },
  {
    id: 'legacy_sequence_suffix',
    requirement: 'generic, canned, and escalation appends preserve a contiguous suffix after legacy-null jobs',
    owners: [
      { file: 'tests/unit/shop-os-continuity-revisions.test.ts', title: 'appends after a legacy-null prefix across repeated reservations and finalizes mixed jobs once' },
      { file: 'tests/unit/shop-os-canned-job-apply.test.ts', title: 'reserves after a legacy-null plus populated sequence suffix and finalizes the new job once' },
      { file: 'tests/unit/shop-os-work-escalation.test.ts', title: 'allocates after a populated contiguous sequence without rewriting existing jobs' },
    ],
  },
  {
    id: 'packet_b_null_prefix',
    requirement: 'Packet-B null-prefix ordering simulation executes explicitly',
    owners: [{
      file: 'tests/unit/shop-os-continuity-revisions.test.ts',
      title: 'appends after a legacy-null prefix across repeated reservations and finalizes mixed jobs once',
    }],
  },
  {
    id: 'curator_fk_link_race',
    requirement: 'curator versus concurrent ticket-job session link serializes in both orderings',
    owners: [
      { file: 'tests/unit/curator-deferred-actions.test.ts', title: 'locks and refuses a ticket-linked session identically for every curator action' },
      { file: 'tests/unit/curator-deferred-actions.test.ts', title: 'owns the session lock and ticket-link check inside each action transaction' },
    ],
  },
  {
    id: 'adaptive_assignment_close_race',
    requirement: 'adaptive mode versus assignment and ticket-linked close preserves order/replay without ticket revisions',
    owners: [
      { file: 'tests/unit/adaptive-mode-route.test.ts', title: 'Task 9F RED: returns the exact canonical replay with zero ticket or job revisions' },
      { file: 'tests/unit/adaptive-mode-route.test.ts', title: 'Task 9F RED: serializes same-key and distinct-key same-session race shapes' },
      { file: 'tests/unit/adaptive-mode-route.test.ts', title: 'Task 9F RED: uses the bounded profile-first closure and no revision finalizer' },
    ],
  },
] as const

describe('ShopOS continuity unit cross-writer race matrix', () => {
  it('names every mandatory race with an explicit executable owner', () => {
    expect(UNIT_CROSS_WRITER_RACE_MATRIX_V1.map(({ id }) => id)).toEqual([
      'assignment_vs_quote_decision',
      'story_vs_line_invalidation',
      'add_job_vs_quote_version',
      'diagnostic_vs_assignment',
      'simple_work_vs_ticketed_close',
      'manual_offer_vs_quote_version',
      'two_actor_assignment',
      'exact_retry_no_double_bump',
      'quick_changed_and_pre_receipt_conflicts',
      'origin_bound_receipt_harness',
      'tech_quick_session_collision',
      'quick_drift_and_hint_races',
      'counter_quick_identity_races',
      'attempt_bound_handles_and_receipts',
      'rollback_and_retryable_sqlstates',
      'bigint_and_multi_job_cardinality',
      'legacy_sequence_suffix',
      'packet_b_null_prefix',
      'curator_fk_link_race',
      'adaptive_assignment_close_race',
    ])
    for (const entry of UNIT_CROSS_WRITER_RACE_MATRIX_V1) {
      expect(entry.owners.length, `${entry.id} has owner`).toBeGreaterThan(0)
      expect(entry.owners[0]?.title.trim().length, `${entry.id} owner title`).toBeGreaterThan(0)
    }
  })

  it('executes every mandatory unit owner and rejects skipped, todo, missing, or failing ownership', () => {
    const localFile = 'tests/unit/shop-os-continuity-cross-writer-races.test.ts'
    const owners = UNIT_CROSS_WRITER_RACE_MATRIX_V1
      .map(({ id, owners }) => ({ id, owner: owners[0]! }))
      .filter(({ owner }) => owner.file !== localFile && !owner.file.startsWith('tests/integration/'))
    const files = [...new Set(owners.map(({ owner }) => owner.file))]
    const titlePattern = owners
      .map(({ owner }) => owner.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|')
    const vitestCli = resolve(process.cwd(), 'node_modules/vitest/vitest.mjs')
    const result = spawnSync(
      process.execPath,
      [vitestCli, 'run', ...files, '--reporter=json', '-t', titlePattern],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, REQUIRE_CONTINUITY_POSTGRES: '0' },
        maxBuffer: 5_000_000,
        timeout: 120_000,
      },
    )
    expect(result.error, 'owner execution must finish inside its bound').toBeUndefined()
    expect(result.status, result.stderr || result.stdout).toBe(0)
    const report = JSON.parse(result.stdout) as {
      testResults: Array<{
        assertionResults: Array<{ title: string; status: string }>
      }>
    }
    const assertions = report.testResults.flatMap(({ assertionResults }) => assertionResults)
    for (const { id, owner } of owners) {
      const matches = assertions.filter(({ title }) => title === owner.title)
      expect(matches, `${id} unique executed owner`).toHaveLength(1)
      expect(matches[0]?.status, `${id} owner status`).toBe('passed')
    }
  }, 125_000)

  it('serializes assignment versus quote decision on one ticket without losing either revision', async () => {
    const { db, close } = await createTestDb()
    try {
      const [shop] = await db.insert(shops).values({
        name: 'Race Shop',
        laborRateCents: 15_000,
        taxRateBps: 825,
      }).returning()
      const shopId = shop.id
      const advisorId = uuid(1)
      const techId = uuid(2)
      const customerId = uuid(3)
      const vehicleId = uuid(4)
      const ticketId = uuid(5)
      const jobId = uuid(6)
      const quoteVersionId = uuid(7)
      await db.insert(profiles).values([
        { id: advisorId, userId: uuid(101), shopId, role: 'advisor' },
        { id: techId, userId: uuid(102), shopId, role: 'tech', skillTier: 2 },
      ])
      await db.insert(customers).values({
        id: customerId,
        shopId,
        name: 'Race Customer',
        phone: '5551000000',
      })
      await db.insert(vehicles).values({
        id: vehicleId,
        customerId,
        year: 2020,
        make: 'Ford',
        model: 'F-150',
      })
      await db.insert(tickets).values({
        id: ticketId,
        shopId,
        ticketNumber: 1,
        source: 'counter',
        customerId,
        vehicleId,
        concern: 'Brake noise',
        createdByProfileId: advisorId,
      })
      await db.insert(ticketJobs).values({
        id: jobId,
        shopId,
        ticketId,
        title: 'Front brakes',
        kind: 'repair',
        requiredSkillTier: 1,
        approvalState: 'quote_ready',
      })
      await db.insert(quoteVersions).values({
        id: quoteVersionId,
        shopId,
        ticketId,
        versionNumber: 1,
        createdByProfileId: advisorId,
        snapshot: {
          schemaVersion: 1,
          ticket: {
            id: ticketId,
            number: 1,
            customerId,
            vehicleId,
            laborRateCents: 15_000,
            taxRateBps: 825,
          },
          jobs: [{
            id: jobId,
            title: 'Front brakes',
            kind: 'repair',
            customerStory: null,
            storyMeta: null,
            lines: [{
              id: uuid(9),
              kind: 'fee',
              description: 'Inspection',
              quantity: '1',
              priceCents: 500,
              taxable: true,
              partNumber: null,
              brand: null,
              coreChargeCents: null,
              fitment: null,
              laborHours: null,
              laborRateCents: null,
              source: 'manual',
              vendorContext: null,
            }],
            attachments: [],
            totals: { subtotalCents: 500, taxableSubtotalCents: 500 },
          }],
          totals: {
            subtotalCents: 500,
            taxableSubtotalCents: 500,
            taxCents: 41,
            totalCents: 541,
          },
        },
      })

      const ticketActor: TicketActor = {
        profileId: techId,
        shopId,
        role: 'tech',
        skillTier: 2,
        membershipStatus: 'active',
        deactivatedAt: null,
      }
      const [assignment, decision] = await Promise.all([
        mutateTicketJobAssignment(db, {
          actor: ticketActor,
          ticketId,
          jobId,
          body: { action: 'claim' },
        }),
        recordQuoteDecision(db, {
          actor: { profileId: advisorId },
          ticketId,
          body: {
            requestKey: uuid(8),
            jobId,
            quoteVersionId,
            decision: 'approved',
            approvedVia: 'phone',
          },
        }),
      ])

      expect(assignment).toMatchObject({ ok: true })
      expect(decision).toMatchObject({ ok: true, changed: true })
      const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId))
      const [job] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
      expect(job).toMatchObject({
        assignedTechId: techId,
        approvalState: 'approved',
        approvedQuoteVersionId: quoteVersionId,
        revision: 2n,
      })
      expect(ticket).toMatchObject({ projectionRevision: 2n, continuityRevision: 1n })
      expect(await db.select().from(quoteEvents)).toHaveLength(1)
    } finally {
      await close()
    }
  })
})
