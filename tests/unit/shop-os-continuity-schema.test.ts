import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { getTableColumns } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { describe, expect, it } from 'vitest'
import {
  CANCEL_REASON_CODES,
  CLOSE_DISPOSITIONS,
  CREATOR_PROVENANCE,
  PART_STATUSES,
  SEPARATE_REASONS,
  STATEMENT_REVIEW_STATES,
  STATEMENT_SOURCES,
  TICKET_MUTATION_KINDS,
  quoteEvents,
  ticketJobs,
  ticketMutationReceiptJobs,
  ticketMutationReceipts,
  tickets,
} from '@/lib/db/schema'
import {
  createTestDb,
  createTestDbClient,
  ensureMessagingRetentionAclMigration,
  ensureMessagingRetentionFkIndexMigration,
  ensureMessagingRetentionMigration,
  ensureQuoteTriggerSearchPathMigration,
  ensureShopEntitlementsMigration,
  ensureShopOsServerOnlyAclMigration,
  ensureVendorAccountsMigration,
} from '@/tests/helpers/db'

const MIGRATION_PATH = path.join(
  process.cwd(),
  'drizzle/migrations/0037_shop_os_continuity_foundation.sql',
)
const JOURNAL_SHA256 = 'b9773d6ba6f82a9142ad7feac0998a935e86e70ee8c38857d3487ad36ecce93d'

async function readOptional(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
}

function tableContracts(table: Parameters<typeof getTableConfig>[0]) {
  const config = getTableConfig(table)
  return {
    checks: config.checks.map((entry) => entry.name),
    foreignKeys: Object.fromEntries(
      config.foreignKeys.map((entry) => {
        const reference = entry.reference()
        return [
          entry.getName(),
          {
            columns: reference.columns.map((column) => column.name),
            foreignColumns: reference.foreignColumns.map((column) => column.name),
            onDelete: entry.onDelete,
          },
        ]
      }),
    ),
    indexes: Object.fromEntries(
      config.indexes.map((entry) => [
        entry.config.name,
        {
          columns: entry.config.columns.map((column) => (
            column as { name?: string }
          ).name),
          unique: entry.config.unique,
          where: entry.config.where !== undefined,
        },
      ]),
    ),
    primaryKeys: config.primaryKeys.map((entry) => entry.getName()),
  }
}

const IDs = {
  shopA: '10000000-0000-0000-0000-000000000001',
  shopB: '10000000-0000-0000-0000-000000000002',
  profileA: '20000000-0000-0000-0000-000000000001',
  profileA2: '20000000-0000-0000-0000-000000000002',
  profileB: '20000000-0000-0000-0000-000000000003',
  userA: '30000000-0000-0000-0000-000000000001',
  userA2: '30000000-0000-0000-0000-000000000002',
  userB: '30000000-0000-0000-0000-000000000003',
  customerA: '40000000-0000-0000-0000-000000000001',
  customerA2: '40000000-0000-0000-0000-000000000002',
  customerB: '40000000-0000-0000-0000-000000000003',
  vehicleA: '50000000-0000-0000-0000-000000000001',
  vehicleA2: '50000000-0000-0000-0000-000000000002',
  vehicleB: '50000000-0000-0000-0000-000000000003',
  ticketA: '60000000-0000-0000-0000-000000000001',
  ticketA2: '60000000-0000-0000-0000-000000000002',
  ticketB: '60000000-0000-0000-0000-000000000003',
  techQuick: '60000000-0000-0000-0000-000000000004',
  terminal: '60000000-0000-0000-0000-000000000005',
  separate: '60000000-0000-0000-0000-000000000006',
  canceledTerminal: '60000000-0000-0000-0000-000000000007',
  legacyCanceledWhitespace: '60000000-0000-0000-0000-000000000008',
  legacyCanceledEmpty: '60000000-0000-0000-0000-000000000009',
  legacyCanceledLong: '60000000-0000-0000-0000-000000000010',
  jobA: '70000000-0000-0000-0000-000000000001',
  jobA2: '70000000-0000-0000-0000-000000000002',
  jobB: '70000000-0000-0000-0000-000000000003',
  legacyJob: '70000000-0000-0000-0000-000000000004',
  quoteA: '80000000-0000-0000-0000-000000000001',
  quoteA2: '80000000-0000-0000-0000-000000000002',
  quoteB: '80000000-0000-0000-0000-000000000003',
  eventA: '90000000-0000-0000-0000-000000000001',
  eventA2: '90000000-0000-0000-0000-000000000002',
  eventB: '90000000-0000-0000-0000-000000000003',
} as const

async function createPreContinuityDb(): Promise<PGlite> {
  const client = new PGlite({ extensions: { vector } })
  await client.query('CREATE EXTENSION IF NOT EXISTS vector;')
  await client.exec('CREATE SCHEMA IF NOT EXISTS auth;')
  await client.exec(`CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT '00000000-0000-0000-0000-000000000000'::uuid $$;`)
  const db = createTestDbClient(client)
  await migrate(db, {
    migrationsFolder: path.join(process.cwd(), 'drizzle/migrations'),
  })
  const adaptiveMigration = await readFile(
    path.join(process.cwd(), 'drizzle/migrations/0029_adaptive_diagnostic_state.sql'),
    'utf8',
  )
  await client.exec(adaptiveMigration.replaceAll('--> statement-breakpoint', ''))
  await ensureVendorAccountsMigration(client)
  await ensureQuoteTriggerSearchPathMigration(client)
  await ensureShopOsServerOnlyAclMigration(client)
  await ensureMessagingRetentionMigration(client)
  await ensureMessagingRetentionAclMigration(client)
  await ensureMessagingRetentionFkIndexMigration(client)
  await ensureShopEntitlementsMigration(client)
  return client
}

async function seedContinuityParents(client: PGlite): Promise<void> {
  await client.exec(`
    insert into shops (id, name) values
      ('${IDs.shopA}', 'Shop A'),
      ('${IDs.shopB}', 'Shop B');
    insert into profiles (id, user_id, shop_id, full_name) values
      ('${IDs.profileA}', '${IDs.userA}', '${IDs.shopA}', 'Owner A'),
      ('${IDs.profileA2}', '${IDs.userA2}', '${IDs.shopA}', 'Advisor A'),
      ('${IDs.profileB}', '${IDs.userB}', '${IDs.shopB}', 'Owner B');
    insert into customers (id, shop_id, name, phone) values
      ('${IDs.customerA}', '${IDs.shopA}', 'Customer A', '+15550000001'),
      ('${IDs.customerA2}', '${IDs.shopA}', 'Customer A2', '+15550000002'),
      ('${IDs.customerB}', '${IDs.shopB}', 'Customer B', '+15550000003');
    insert into vehicles (id, customer_id, year, make, model) values
      ('${IDs.vehicleA}', '${IDs.customerA}', 2020, 'Ford', 'F-150'),
      ('${IDs.vehicleA2}', '${IDs.customerA2}', 2021, 'Ford', 'Escape'),
      ('${IDs.vehicleB}', '${IDs.customerB}', 2022, 'Ford', 'Ranger');
    insert into tickets
      (id, shop_id, ticket_number, source, customer_id, vehicle_id, concern,
       created_by_profile_id)
    values
      ('${IDs.ticketA}', '${IDs.shopA}', 1, 'counter', '${IDs.customerA}', '${IDs.vehicleA}',
       'Concern A', '${IDs.profileA}'),
      ('${IDs.ticketA2}', '${IDs.shopA}', 2, 'counter', '${IDs.customerA2}', '${IDs.vehicleA2}',
       'Concern A2', '${IDs.profileA}'),
      ('${IDs.ticketB}', '${IDs.shopB}', 1, 'counter', '${IDs.customerB}', '${IDs.vehicleB}',
       'Concern B', '${IDs.profileB}'),
      ('${IDs.techQuick}', '${IDs.shopA}', 3, 'tech_quick', null, null,
       'Tech Quick concern', '${IDs.profileA}');
    insert into ticket_jobs
      (id, shop_id, ticket_id, title, kind, required_skill_tier,
       created_by_profile_id, creator_provenance, sequence_number)
    values
      ('${IDs.jobA}', '${IDs.shopA}', '${IDs.ticketA}', 'Job A', 'repair', 1,
       '${IDs.profileA}', 'direct', 1),
      ('${IDs.jobA2}', '${IDs.shopA}', '${IDs.ticketA2}', 'Job A2', 'repair', 1,
       '${IDs.profileA}', 'direct', 1),
      ('${IDs.jobB}', '${IDs.shopB}', '${IDs.ticketB}', 'Job B', 'repair', 1,
       '${IDs.profileB}', 'direct', 1),
      ('${IDs.legacyJob}', '${IDs.shopA}', '${IDs.ticketA}', 'Legacy job', 'repair', 1,
       null, null, null);
    insert into quote_versions
      (id, shop_id, ticket_id, version_number, snapshot, created_by_profile_id)
    values
      ('${IDs.quoteA}', '${IDs.shopA}', '${IDs.ticketA}', 1, '{}'::jsonb, '${IDs.profileA}'),
      ('${IDs.quoteA2}', '${IDs.shopA}', '${IDs.ticketA2}', 1, '{}'::jsonb, '${IDs.profileA}'),
      ('${IDs.quoteB}', '${IDs.shopB}', '${IDs.ticketB}', 1, '{}'::jsonb, '${IDs.profileB}');
    insert into quote_events
      (id, shop_id, ticket_id, job_id, quote_version_id, kind, approved_via,
       actor_profile_id, request_key)
    values
      ('${IDs.eventA}', '${IDs.shopA}', '${IDs.ticketA}', '${IDs.jobA}', '${IDs.quoteA}',
       'approved', 'in_person', '${IDs.profileA}', 'event-a'),
      ('${IDs.eventA2}', '${IDs.shopA}', '${IDs.ticketA2}', '${IDs.jobA2}', '${IDs.quoteA2}',
       'approved', 'in_person', '${IDs.profileA}', 'event-a2'),
      ('${IDs.eventB}', '${IDs.shopB}', '${IDs.ticketB}', '${IDs.jobB}', '${IDs.quoteB}',
       'approved', 'in_person', '${IDs.profileB}', 'event-b');
  `)
}

describe('Shop OS continuity source schema guards', () => {
  it('declares the exact additive continuity vocabulary and source migration', async () => {
    const schema = await readFile(
      path.join(process.cwd(), 'lib/db/schema.ts'),
      'utf8',
    )
    const migration = await readOptional(MIGRATION_PATH)
    const journalSource = await readFile(
      path.join(process.cwd(), 'drizzle/migrations/meta/_journal.json'),
      'utf8',
    )
    const journal = JSON.parse(journalSource) as {
      entries: Array<{ idx: number; tag: string }>
    }

    expect(journal.entries).toHaveLength(31)
    expect(journal.entries.at(-1)).toMatchObject({
      idx: 30,
      tag: '0028_shop_os_quote_foundation',
    })
    expect(journal.entries.map(({ tag }) => tag)).not.toContain(
      '0037_shop_os_continuity_foundation',
    )
    expect(createHash('sha256').update(journalSource).digest('hex')).toBe(
      JOURNAL_SHA256,
    )

    for (const declaration of [
      'export const SEPARATE_REASONS',
      'export const CLOSE_DISPOSITIONS',
      'export const CANCEL_REASON_CODES',
      'export const STATEMENT_SOURCES',
      'export const STATEMENT_REVIEW_STATES',
      'export const CREATOR_PROVENANCE',
      'export const PART_STATUSES',
      'export const TICKET_MUTATION_KINDS',
      "projectionRevision: bigint('projection_revision', { mode: 'bigint' })",
      "continuityRevision: bigint('continuity_revision', { mode: 'bigint' })",
      "sequenceNumber: integer('sequence_number')",
      "workStatement: text('work_statement')",
      "revision: bigint('revision', { mode: 'bigint' })",
      'export const ticketMutationReceipts',
      'export const ticketMutationReceiptJobs',
    ]) {
      expect(schema.includes(declaration), declaration).toBe(true)
    }

    expect(migration, 'source migration 0037 must exist').not.toBe('')
    for (const contract of [
      'tickets_projection_revision_nonnegative',
      'tickets_continuity_revision_nonnegative',
      'tickets_shop_vehicle_status_idx',
      'tickets_shop_separate_from_fk',
      'ticket_jobs_shop_ticket_sequence_uq',
      'quote_events_shop_ticket_job_id_uq',
      'ticket_jobs_approved_approval_event_fk',
      'ticket_mutation_receipts',
      'ticket_mutation_receipt_jobs',
    ]) {
      expect(migration.includes(contract), contract).toBe(true)
    }
  })

  it('keeps the open repair-order lookup non-unique and terminal shape out of a full-row check', async () => {
    const schema = await readFile(
      path.join(process.cwd(), 'lib/db/schema.ts'),
      'utf8',
    )
    const migration = await readOptional(MIGRATION_PATH)
    const journal = await readFile(
      path.join(process.cwd(), 'drizzle/migrations/meta/_journal.json'),
      'utf8',
    )
    const normalized = migration.replace(/\s+/g, ' ').toLowerCase()
    const ticketConfig = tableContracts(tickets)
    const vehicleStatusIndexes = (
      Object.values(ticketConfig.indexes) as Array<{
        columns: Array<string | undefined>
        unique: boolean
      }>
    ).filter(({ columns }) => columns.join(',') === 'shop_id,vehicle_id,status')
    const fullRowTerminalChecks = normalized.split(';').filter((statement) => (
      statement.includes('add constraint')
      && statement.includes('check')
      && statement.includes('status')
      && (
        statement.includes('closed_by_profile_id')
        || statement.includes('canceled_by_profile_id')
        || statement.includes('delivered_by_profile_id')
      )
    ))

    expect(journal).not.toContain('0037_shop_os_continuity_foundation')
    expect(schema).not.toContain("uniqueIndex('tickets_shop_vehicle_status_idx')")
    expect(normalized).not.toMatch(
      /create unique index tickets_shop_vehicle_status_idx/,
    )
    expect(normalized).not.toMatch(
      /create unique index \S+\s+on (?:public\.)?tickets\s*\(\s*shop_id\s*,\s*vehicle_id\s*,\s*status\s*\)/,
    )
    expect(vehicleStatusIndexes).toHaveLength(1)
    expect(vehicleStatusIndexes.every(({ unique }) => !unique)).toBe(true)
    expect(normalized).not.toContain('add constraint tickets_terminal_shape')
    expect(fullRowTerminalChecks).toEqual([])
    expect(normalized).toContain(
      'before insert or update of status, canceled_at, canceled_by_profile_id, canceled_reason, cancel_reason_code, delivered_at, delivered_by_profile_id, closed_at, closed_by_profile_id, close_disposition, close_note',
    )
    expect(normalized).not.toContain(
      'before insert or update on public.tickets execute function public.guard_ticket_terminal_shape()',
    )
  })

  it('exposes the exact shared vocabularies and bigint transport declarations', () => {
    expect(SEPARATE_REASONS).toEqual([
      'warranty',
      'comeback',
      'different_payer',
      'internal_work',
      'future_or_scheduled_work',
      'fleet_split',
      'other',
    ])
    expect(CLOSE_DISPOSITIONS).toEqual([
      'delivered',
      'customer_declined',
      'no_repair',
      'remote_quote_not_proceeding',
    ])
    expect(CANCEL_REASON_CODES).toEqual([
      'duplicate_created',
      'customer_canceled_before_authorization',
      'administrative_error',
      'other',
    ])
    expect(STATEMENT_SOURCES).toEqual([
      'customer_concern',
      'customer_request',
      'technician_found',
      'advisor_added',
      'shop_internal',
      'legacy_migrated',
    ])
    expect(STATEMENT_REVIEW_STATES).toEqual(['confirmed', 'review_required'])
    expect(CREATOR_PROVENANCE).toEqual(['direct', 'ticket_creator_backfill'])
    expect(PART_STATUSES).toEqual([
      'proposed',
      'needs_order',
      'ordered',
      'received',
      'installed',
      'returned',
    ])
    expect(TICKET_MUTATION_KINDS).toEqual([
      'create_repair_order',
      'append_work_items',
      'create_separate_repair_order',
      'confirm_legacy_work_statement',
      'deliver_repair_order',
      'close_repair_order',
      'cancel_repair_order',
      'return_job_to_open_queue',
    ])

    const ticketColumns = getTableColumns(tickets)
    expect(ticketColumns.projectionRevision.getSQLType()).toBe('bigint')
    expect(ticketColumns.projectionRevision.notNull).toBe(true)
    expect(ticketColumns.projectionRevision.hasDefault).toBe(true)
    expect(ticketColumns.continuityRevision.getSQLType()).toBe('bigint')
    expect(ticketColumns.continuityRevision.notNull).toBe(true)
    expect(ticketColumns.continuityRevision.hasDefault).toBe(true)

    const jobColumns = getTableColumns(ticketJobs)
    expect(jobColumns.revision.getSQLType()).toBe('bigint')
    expect(jobColumns.revision.notNull).toBe(true)
    expect(jobColumns.revision.hasDefault).toBe(true)
    expect(jobColumns.diagnosticAuthorizedCents.getSQLType()).toBe('bigint')
    expect(jobColumns.diagnosticAuthorizedCents.dataType).toBe('number')
  })

  it('declares exact ticket, work-item, approval, and receipt relational contracts', () => {
    const ticketContracts = tableContracts(tickets)
    expect(ticketContracts.checks).toEqual(expect.arrayContaining([
      'tickets_projection_revision_nonnegative',
      'tickets_continuity_revision_nonnegative',
      'tickets_separate_reason_valid',
      'tickets_separate_evidence_consistent',
      'tickets_separate_from_not_self',
      'tickets_close_disposition_valid',
      'tickets_cancel_reason_code_valid',
      'tickets_canceled_reason_bounded',
      'tickets_close_note_bounded',
    ]))
    expect(ticketContracts.foreignKeys.tickets_shop_separate_from_fk).toEqual({
      columns: ['shop_id', 'separate_from_ticket_id'],
      foreignColumns: ['shop_id', 'id'],
      onDelete: 'restrict',
    })
    expect(ticketContracts.indexes.tickets_shop_vehicle_status_idx).toEqual({
      columns: ['shop_id', 'vehicle_id', 'status'],
      unique: false,
      where: false,
    })
    expect(ticketContracts.indexes.tickets_shop_separate_from_idx).toEqual({
      columns: ['shop_id', 'separate_from_ticket_id'],
      unique: false,
      where: true,
    })

    const jobContracts = tableContracts(ticketJobs)
    expect(jobContracts.checks).toEqual(expect.arrayContaining([
      'ticket_jobs_sequence_positive',
      'ticket_jobs_work_statement_bounded',
      'ticket_jobs_statement_source_valid',
      'ticket_jobs_statement_review_state_valid',
      'ticket_jobs_statement_truth_consistent',
      'ticket_jobs_statement_confirmation_consistent',
      'ticket_jobs_context_bounded',
      'ticket_jobs_diagnostic_authorization_consistent',
      'ticket_jobs_creator_provenance_consistent',
      'ticket_jobs_approved_fingerprint_valid',
      'ticket_jobs_revision_nonnegative',
    ]))
    expect(jobContracts.indexes.ticket_jobs_shop_ticket_sequence_uq).toEqual({
      columns: ['shop_id', 'ticket_id', 'sequence_number'],
      unique: true,
      where: true,
    })
    expect(jobContracts.foreignKeys).toMatchObject({
      ticket_jobs_shop_creator_fk: {
        columns: ['shop_id', 'created_by_profile_id'],
        foreignColumns: ['shop_id', 'id'],
        onDelete: 'restrict',
      },
      ticket_jobs_shop_confirmer_fk: {
        columns: ['shop_id', 'statement_confirmed_by_profile_id'],
        foreignColumns: ['shop_id', 'id'],
        onDelete: 'restrict',
      },
      ticket_jobs_shop_ticket_created_from_fk: {
        columns: ['shop_id', 'ticket_id', 'created_from_job_id'],
        foreignColumns: ['shop_id', 'ticket_id', 'id'],
        onDelete: 'restrict',
      },
      ticket_jobs_approved_approval_event_fk: {
        columns: ['shop_id', 'ticket_id', 'id', 'approved_approval_event_id'],
        foreignColumns: ['shop_id', 'ticket_id', 'job_id', 'id'],
        onDelete: 'restrict',
      },
    })

    expect(tableContracts(quoteEvents).indexes.quote_events_shop_ticket_job_id_uq).toEqual({
      columns: ['shop_id', 'ticket_id', 'job_id', 'id'],
      unique: true,
      where: false,
    })

    const receipts = tableContracts(ticketMutationReceipts)
    expect(receipts.checks).toEqual(expect.arrayContaining([
      'ticket_mutation_receipts_schema_version_v1',
      'ticket_mutation_receipts_key_version_positive',
      'ticket_mutation_receipts_kind_valid',
      'ticket_mutation_receipts_target_fingerprint_valid',
      'ticket_mutation_receipts_request_fingerprint_valid',
      'ticket_mutation_receipts_result_count_valid',
    ]))
    expect(receipts.foreignKeys).toMatchObject({
      ticket_mutation_receipts_shop_actor_fk: {
        columns: ['shop_id', 'actor_profile_id'],
        foreignColumns: ['shop_id', 'id'],
        onDelete: 'restrict',
      },
      ticket_mutation_receipts_shop_target_ticket_fk: {
        columns: ['shop_id', 'target_ticket_id'],
        foreignColumns: ['shop_id', 'id'],
        onDelete: 'restrict',
      },
      ticket_mutation_receipts_shop_result_ticket_fk: {
        columns: ['shop_id', 'result_ticket_id'],
        foreignColumns: ['shop_id', 'id'],
        onDelete: 'restrict',
      },
    })

    const receiptJobs = tableContracts(ticketMutationReceiptJobs)
    expect(receiptJobs.primaryKeys).toContain('ticket_mutation_receipt_jobs_pk')
    expect(receiptJobs.checks).toContain('ticket_mutation_receipt_jobs_ordinal_range')
    expect(receiptJobs.foreignKeys).toMatchObject({
      ticket_mutation_receipt_jobs_receipt_ticket_fk: {
        columns: ['shop_id', 'receipt_id', 'result_ticket_id', 'result_job_count'],
        foreignColumns: ['shop_id', 'id', 'result_ticket_id', 'result_job_count'],
        onDelete: 'restrict',
      },
      ticket_mutation_receipt_jobs_job_fk: {
        columns: ['shop_id', 'result_ticket_id', 'job_id'],
        foreignColumns: ['shop_id', 'ticket_id', 'id'],
        onDelete: 'restrict',
      },
    })
  })

  it('adopts 0037 additively without rewriting populated legacy ticket, job, or quote values', async () => {
    const client = await createPreContinuityDb()
    try {
      await client.exec(`
        insert into shops (id, name) values ('${IDs.shopA}', 'Legacy shop');
        insert into profiles (id, user_id, shop_id, full_name)
          values ('${IDs.profileA}', '${IDs.userA}', '${IDs.shopA}', 'Legacy owner');
        insert into tickets
          (id, shop_id, ticket_number, source, concern, when_started, how_often,
           diagnostic_authorized_cents, diagnostic_authorization_note, status,
           created_by_profile_id, closed_at, closed_by_profile_id)
        values
          ('${IDs.ticketA}', '${IDs.shopA}', 41, 'tech_quick', 'Legacy concern',
           'Yesterday', 'Intermittent', 12900, 'Authorized by phone', 'closed',
           '${IDs.profileA}', '2026-07-01T12:00:00Z', '${IDs.profileA}'),
          ('${IDs.ticketA2}', '${IDs.shopA}', 42, 'tech_quick', 'Legacy canceled concern',
           null, null, null, null, 'canceled', '${IDs.profileA}', null, null);
        update tickets
        set canceled_at = '2026-07-02T12:00:00Z',
            canceled_by_profile_id = '${IDs.profileA}',
            canceled_reason = 'Legacy cancellation'
        where id = '${IDs.ticketA2}';
        insert into ticket_jobs
          (id, shop_id, ticket_id, title, kind, required_skill_tier, assigned_tech_id,
           claimed_at, work_status, approval_state, work_notes)
        values
          ('${IDs.jobA}', '${IDs.shopA}', '${IDs.ticketA}', 'Legacy repair', 'repair', 2,
           '${IDs.profileA}', '2026-07-01T10:00:00Z', 'done', 'approved', 'Legacy notes');
        insert into quote_versions
          (id, shop_id, ticket_id, version_number, snapshot, created_by_profile_id)
        values
          ('${IDs.quoteA}', '${IDs.shopA}', '${IDs.ticketA}', 1,
           '{"legacy":true}'::jsonb, '${IDs.profileA}');
        insert into quote_events
          (id, shop_id, ticket_id, job_id, quote_version_id, kind, approved_via,
           actor_profile_id, request_key, body)
        values
          ('${IDs.eventA}', '${IDs.shopA}', '${IDs.ticketA}', '${IDs.jobA}', '${IDs.quoteA}',
           'approved', 'phone', '${IDs.profileA}', 'legacy-approval', 'Approved by phone');
      `)

      const before = await client.query<Record<string, unknown>>(`
        select
          (select to_jsonb(t) from (
            select id, shop_id, ticket_number, source, customer_id, vehicle_id,
                   concern, when_started, how_often, diagnostic_authorized_cents,
                   diagnostic_authorization_note, status, created_by_profile_id,
                   canceled_at, canceled_by_profile_id, canceled_reason, delivered_at,
                   delivered_by_profile_id, closed_at, closed_by_profile_id, created_at, updated_at
            from tickets where id = '${IDs.ticketA}'
          ) t) as ticket,
          (select to_jsonb(j) from (
            select id, shop_id, ticket_id, title, kind, required_skill_tier,
                   assigned_tech_id, claimed_at, session_id, work_status, approval_state,
                   customer_story, story_meta, work_notes, approved_quote_version_id,
                   diagnostic_start_state, diagnostic_start_attempt_key,
                   diagnostic_start_lease_until, diagnostic_start_error_code, created_at, updated_at
            from ticket_jobs where id = '${IDs.jobA}'
          ) j) as job,
          (select to_jsonb(q) from quote_events q where id = '${IDs.eventA}') as quote_event
      `)

      const migration = await readOptional(MIGRATION_PATH)
      expect(migration, 'source migration 0037 must exist').not.toBe('')
      if (!migration) return
      await client.exec(migration.replaceAll('--> statement-breakpoint', ''))

      const after = await client.query<Record<string, unknown>>(`
        select
          (select to_jsonb(t) from (
            select id, shop_id, ticket_number, source, customer_id, vehicle_id,
                   concern, when_started, how_often, diagnostic_authorized_cents,
                   diagnostic_authorization_note, status, created_by_profile_id,
                   canceled_at, canceled_by_profile_id, canceled_reason, delivered_at,
                   delivered_by_profile_id, closed_at, closed_by_profile_id, created_at, updated_at
            from tickets where id = '${IDs.ticketA}'
          ) t) as ticket,
          (select to_jsonb(j) from (
            select id, shop_id, ticket_id, title, kind, required_skill_tier,
                   assigned_tech_id, claimed_at, session_id, work_status, approval_state,
                   customer_story, story_meta, work_notes, approved_quote_version_id,
                   diagnostic_start_state, diagnostic_start_attempt_key,
                   diagnostic_start_lease_until, diagnostic_start_error_code, created_at, updated_at
            from ticket_jobs where id = '${IDs.jobA}'
          ) j) as job,
          (select to_jsonb(q) from quote_events q where id = '${IDs.eventA}') as quote_event
      `)
      expect(after.rows[0]).toEqual(before.rows[0])

      const additive = await client.query<Record<string, unknown>>(`
        select projection_revision, continuity_revision, separate_from_ticket_id,
               separate_reason, separate_reason_note, close_disposition, close_note,
               cancel_reason_code
        from tickets where id = '${IDs.ticketA}'
      `)
      expect(additive.rows[0]).toEqual({
        projection_revision: 0,
        continuity_revision: 0,
        separate_from_ticket_id: null,
        separate_reason: null,
        separate_reason_note: null,
        close_disposition: null,
        close_note: null,
        cancel_reason_code: null,
      })

      const jobAdditive = await client.query<Record<string, unknown>>(`
        select sequence_number, work_statement, statement_source, statement_review_state,
               statement_confirmed_by_profile_id, statement_confirmed_at, when_started,
               how_often, diagnostic_authorized_cents, diagnostic_authorization_note,
               created_by_profile_id, creator_provenance, created_from_job_id, revision,
               approved_authorization_fingerprint, approved_approval_event_id
        from ticket_jobs where id = '${IDs.jobA}'
      `)
      expect(jobAdditive.rows[0]).toEqual({
        sequence_number: null,
        work_statement: null,
        statement_source: null,
        statement_review_state: null,
        statement_confirmed_by_profile_id: null,
        statement_confirmed_at: null,
        when_started: null,
        how_often: null,
        diagnostic_authorized_cents: null,
        diagnostic_authorization_note: null,
        created_by_profile_id: null,
        creator_provenance: null,
        created_from_job_id: null,
        revision: 0,
        approved_authorization_fingerprint: null,
        approved_approval_event_id: null,
      })

      await expect(client.exec(`
        update tickets set projection_revision = projection_revision + 1
        where id = '${IDs.ticketA}'
      `)).resolves.toBeDefined()
      await expect(client.exec(`
        update tickets set projection_revision = projection_revision + 1
        where id = '${IDs.ticketA2}'
      `)).resolves.toBeDefined()
      const legacyCanceled = await client.query<Record<string, unknown>>(`
        select status, projection_revision, cancel_reason_code, close_disposition
        from tickets where id = '${IDs.ticketA2}'
      `)
      expect(legacyCanceled.rows[0]).toEqual({
        status: 'canceled',
        projection_revision: 1,
        cancel_reason_code: null,
        close_disposition: null,
      })
    } finally {
      await client.close()
    }
  }, 30_000)

  it('keeps pre-0037 canceled tickets with legacy reason shapes updateable for unrelated revision writes', async () => {
    const client = await createPreContinuityDb()
    try {
      const longLegacyReason = `x${'y'.repeat(2_000)}`
      await client.exec(`
        insert into shops (id, name) values ('${IDs.shopA}', 'Legacy shop');
        insert into profiles (id, user_id, shop_id, full_name)
          values ('${IDs.profileA}', '${IDs.userA}', '${IDs.shopA}', 'Legacy owner');
        insert into tickets
          (id, shop_id, ticket_number, source, concern, status, created_by_profile_id)
        values
          ('${IDs.legacyCanceledWhitespace}', '${IDs.shopA}', 43, 'tech_quick',
           'Whitespace legacy cancellation', 'canceled', '${IDs.profileA}'),
          ('${IDs.legacyCanceledEmpty}', '${IDs.shopA}', 44, 'tech_quick',
           'Empty legacy cancellation', 'canceled', '${IDs.profileA}'),
          ('${IDs.legacyCanceledLong}', '${IDs.shopA}', 45, 'tech_quick',
           'Long legacy cancellation', 'canceled', '${IDs.profileA}');
        update tickets
        set canceled_at = '2026-07-02T12:00:00Z',
            canceled_by_profile_id = '${IDs.profileA}',
            canceled_reason = case id
              when '${IDs.legacyCanceledWhitespace}' then ' legacy cancellation '
              when '${IDs.legacyCanceledEmpty}' then ''
              else '${longLegacyReason}'
            end
        where id in (
          '${IDs.legacyCanceledWhitespace}',
          '${IDs.legacyCanceledEmpty}',
          '${IDs.legacyCanceledLong}'
        );
      `)

      const migration = await readOptional(MIGRATION_PATH)
      expect(migration, 'source migration 0037 must exist').not.toBe('')
      if (!migration) return
      await client.exec(migration.replaceAll('--> statement-breakpoint', ''))

      for (const ticketId of [
        IDs.legacyCanceledWhitespace,
        IDs.legacyCanceledEmpty,
        IDs.legacyCanceledLong,
      ]) {
        await expect(client.exec(`
          update tickets
          set projection_revision = projection_revision + 1
          where id = '${ticketId}'
        `)).resolves.toBeDefined()
      }

      const result = await client.query<{ id: string; projection_revision: number }>(`
        select id, projection_revision
        from tickets
        where id in (
          '${IDs.legacyCanceledWhitespace}',
          '${IDs.legacyCanceledEmpty}',
          '${IDs.legacyCanceledLong}'
        )
        order by ticket_number
      `)
      expect(result.rows).toEqual([
        { id: IDs.legacyCanceledWhitespace, projection_revision: 1 },
        { id: IDs.legacyCanceledEmpty, projection_revision: 1 },
        { id: IDs.legacyCanceledLong, projection_revision: 1 },
      ])
    } finally {
      await client.close()
    }
  }, 30_000)

  it('enforces terminal shape and one-way ticket identity without blocking Tech Quick reconciliation', async () => {
    const { client, close } = await createTestDb()
    try {
      await seedContinuityParents(client)

      await expect(client.exec(`
        insert into tickets
          (id, shop_id, ticket_number, source, customer_id, vehicle_id, concern,
           created_by_profile_id, status)
        values
          ('${IDs.terminal}', '${IDs.shopA}', 4, 'counter', '${IDs.customerA}',
           '${IDs.vehicleA}', 'Invalid close', '${IDs.profileA}', 'closed')
      `)).rejects.toThrow(/invalid_ticket_terminal_shape/)

      await expect(client.exec(`
        update tickets set status = 'closed' where id = '${IDs.ticketA}'
      `)).rejects.toThrow(/invalid_ticket_terminal_shape/)

      await client.exec(`
        insert into tickets
          (id, shop_id, ticket_number, source, customer_id, vehicle_id, concern,
           created_by_profile_id, status, delivered_at, delivered_by_profile_id,
           closed_at, closed_by_profile_id, close_disposition)
        values
          ('${IDs.terminal}', '${IDs.shopA}', 4, 'counter', '${IDs.customerA}',
           '${IDs.vehicleA}', 'Valid delivered close', '${IDs.profileA}', 'closed',
           '2026-07-15T12:00:00Z', '${IDs.profileA}', '2026-07-15T12:00:00Z',
           '${IDs.profileA}', 'delivered')
      `)
      for (const mutation of [
        "status = 'open'",
        "status = 'canceled'",
        `closed_by_profile_id = '${IDs.profileA2}'`,
        "closed_at = '2026-07-16T12:00:00Z'",
        `delivered_by_profile_id = '${IDs.profileA2}'`,
        "delivered_at = '2026-07-16T12:00:00Z'",
        "close_disposition = 'customer_declined'",
        "close_note = 'rewritten'",
        "cancel_reason_code = 'administrative_error'",
      ]) {
        await expect(client.exec(`
          update tickets set ${mutation} where id = '${IDs.terminal}'
        `)).rejects.toThrow(/immutable_terminal_ticket/)
      }

      await expect(client.exec(`
        insert into tickets
          (id, shop_id, ticket_number, source, customer_id, vehicle_id, concern,
           created_by_profile_id, status, canceled_at, cancel_reason_code)
        values
          ('${IDs.canceledTerminal}', '${IDs.shopA}', 6, 'counter', '${IDs.customerA}',
           '${IDs.vehicleA}', 'Invalid cancellation', '${IDs.profileA}', 'canceled',
           '2026-07-15T12:00:00Z', 'administrative_error')
      `)).rejects.toThrow(/invalid_ticket_terminal_shape/)
      await client.exec(`
        insert into tickets
          (id, shop_id, ticket_number, source, customer_id, vehicle_id, concern,
           created_by_profile_id, status, canceled_at, canceled_by_profile_id,
           canceled_reason, cancel_reason_code)
        values
          ('${IDs.canceledTerminal}', '${IDs.shopA}', 6, 'counter', '${IDs.customerA}',
           '${IDs.vehicleA}', 'Valid cancellation', '${IDs.profileA}', 'canceled',
           '2026-07-15T12:00:00Z', '${IDs.profileA}', 'Administrative cancellation',
           'administrative_error')
      `)
      for (const mutation of [
        "status = 'open'",
        "status = 'closed'",
        `canceled_by_profile_id = '${IDs.profileA2}'`,
        "canceled_at = '2026-07-16T12:00:00Z'",
        "canceled_reason = 'Rewritten cancellation'",
        "cancel_reason_code = 'other'",
      ]) {
        await expect(client.exec(`
          update tickets set ${mutation} where id = '${IDs.canceledTerminal}'
        `)).rejects.toThrow(/immutable_terminal_ticket/)
      }

      await expect(client.exec(`
        update tickets set concern = 'Rewritten root' where id = '${IDs.ticketA}'
      `)).rejects.toThrow(/immutable_ticket_identity/)
      await expect(client.exec(`
        update tickets set when_started = 'Rewritten context' where id = '${IDs.ticketA}'
      `)).rejects.toThrow(/immutable_ticket_identity/)
      await expect(client.exec(`
        update tickets set customer_id = null, vehicle_id = null where id = '${IDs.ticketA}'
      `)).rejects.toThrow(/immutable_ticket_identity/)

      await client.exec(`
        update tickets
        set customer_id = '${IDs.customerA2}', vehicle_id = '${IDs.vehicleA2}'
        where id = '${IDs.techQuick}'
      `)
      await expect(client.exec(`
        update tickets
        set customer_id = '${IDs.customerA}', vehicle_id = '${IDs.vehicleA}'
        where id = '${IDs.techQuick}'
      `)).rejects.toThrow(/immutable_ticket_identity/)
      await expect(client.exec(`
        update tickets set customer_id = null where id = '${IDs.techQuick}'
      `)).rejects.toThrow(/immutable_ticket_identity/)

      await client.exec(`
        insert into tickets
          (id, shop_id, ticket_number, source, customer_id, vehicle_id, concern,
           created_by_profile_id, separate_from_ticket_id, separate_reason,
           separate_reason_note)
        values
          ('${IDs.separate}', '${IDs.shopA}', 5, 'counter', '${IDs.customerA}',
           '${IDs.vehicleA}', 'Separate warranty work', '${IDs.profileA}',
           '${IDs.ticketA}', 'warranty', 'Warranty evidence')
      `)
      await expect(client.exec(`
        update tickets set separate_reason_note = 'Changed evidence'
        where id = '${IDs.separate}'
      `)).rejects.toThrow(/immutable_ticket_identity/)
    } finally {
      await close()
    }
  }, 30_000)

  it('enforces one-way work-item provenance, sequence, identity, and composite approval ownership', async () => {
    const { client, close } = await createTestDb()
    try {
      await seedContinuityParents(client)

      await expect(client.exec(`
        update ticket_jobs
        set created_by_profile_id = '${IDs.profileA}', creator_provenance = 'direct'
        where id = '${IDs.legacyJob}'
      `)).rejects.toThrow(/invalid_ticket_job_creator_adoption/)
      await expect(client.exec(`
        update ticket_jobs
        set created_by_profile_id = '${IDs.profileA2}', creator_provenance = 'ticket_creator_backfill'
        where id = '${IDs.legacyJob}'
      `)).rejects.toThrow(/invalid_ticket_job_creator_adoption/)

      await client.exec(`
        update ticket_jobs
        set created_by_profile_id = '${IDs.profileA}', creator_provenance = 'ticket_creator_backfill'
        where id = '${IDs.legacyJob}'
      `)
      await expect(client.exec(`
        update ticket_jobs
        set created_by_profile_id = null, creator_provenance = null
        where id = '${IDs.legacyJob}'
      `)).rejects.toThrow(/immutable_ticket_job_creator/)
      await expect(client.exec(`
        update ticket_jobs set creator_provenance = 'direct'
        where id = '${IDs.legacyJob}'
      `)).rejects.toThrow(/immutable_ticket_job_creator/)

      await client.exec(`
        update ticket_jobs set sequence_number = 2 where id = '${IDs.legacyJob}'
      `)
      await expect(client.exec(`
        update ticket_jobs set sequence_number = 3 where id = '${IDs.legacyJob}'
      `)).rejects.toThrow(/immutable_ticket_job_sequence/)
      await expect(client.exec(`
        update ticket_jobs set created_from_job_id = '${IDs.jobA}'
        where id = '${IDs.legacyJob}'
      `)).rejects.toThrow(/immutable_ticket_job_identity/)

      for (const mutation of [
        `id = '70000000-0000-0000-0000-000000000099'`,
        `ticket_id = '${IDs.ticketA2}'`,
        `shop_id = '${IDs.shopB}'`,
        "created_at = '2026-07-16T12:00:00Z'",
      ]) {
        await expect(client.exec(`
          update ticket_jobs set ${mutation} where id = '${IDs.jobA}'
        `)).rejects.toThrow(/immutable_ticket_job_identity/)
      }

      await expect(client.exec(`
        insert into ticket_jobs
          (shop_id, ticket_id, title, kind, required_skill_tier,
           created_by_profile_id, creator_provenance)
        values
          ('${IDs.shopA}', '${IDs.ticketA}', 'Bad creator insert', 'repair', 1,
           '${IDs.profileA}', 'ticket_creator_backfill')
      `)).rejects.toThrow(/invalid_ticket_job_creator_provenance/)
      await expect(client.exec(`
        insert into ticket_jobs
          (shop_id, ticket_id, title, kind, required_skill_tier, sequence_number,
           created_by_profile_id, creator_provenance)
        values
          ('${IDs.shopA}', '${IDs.ticketA}', 'Duplicate sequence', 'repair', 1, 1,
           '${IDs.profileA}', 'direct')
      `)).rejects.toThrow(/ticket_jobs_shop_ticket_sequence_uq/)
      await expect(client.exec(`
        insert into ticket_jobs
          (shop_id, ticket_id, title, kind, required_skill_tier,
           created_by_profile_id, creator_provenance, created_from_job_id)
        values
          ('${IDs.shopA}', '${IDs.ticketA}', 'Wrong source job', 'repair', 1,
           '${IDs.profileA}', 'direct', '${IDs.jobA2}')
      `)).rejects.toThrow(/ticket_jobs_shop_ticket_created_from_fk/)
      await expect(client.exec(`
        insert into ticket_jobs
          (shop_id, ticket_id, title, kind, required_skill_tier,
           created_by_profile_id, creator_provenance)
        values
          ('${IDs.shopA}', '${IDs.ticketA}', 'Wrong creator shop', 'repair', 1,
           '${IDs.profileB}', 'direct')
      `)).rejects.toThrow(/ticket_jobs_shop_creator_fk/)

      await client.exec(`
        update ticket_jobs
        set approved_approval_event_id = '${IDs.eventA}'
        where id = '${IDs.jobA}'
      `)
      await expect(client.exec(`
        update ticket_jobs
        set approved_approval_event_id = '${IDs.eventA}'
        where id = '${IDs.jobA2}'
      `)).rejects.toThrow(/ticket_jobs_approved_approval_event_fk/)

      await expect(client.exec(`
        update ticket_jobs
        set work_statement = 'Partial truth'
        where id = '${IDs.jobA}'
      `)).rejects.toThrow(/ticket_jobs_statement_truth_consistent/)
      await expect(client.exec(`
        update ticket_jobs
        set work_statement = 'Legacy review', statement_source = 'legacy_migrated',
            statement_review_state = 'review_required',
            statement_confirmed_by_profile_id = '${IDs.profileA}', statement_confirmed_at = now()
        where id = '${IDs.jobA}'
      `)).rejects.toThrow(/ticket_jobs_statement_confirmation_consistent/)
      await client.exec(`
        update ticket_jobs
        set work_statement = 'Direct truth', statement_source = 'advisor_added',
            statement_review_state = 'confirmed'
        where id = '${IDs.jobA}'
      `)
    } finally {
      await close()
    }
  }, 30_000)
})
