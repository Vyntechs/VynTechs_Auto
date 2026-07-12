import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { getTableColumns, sql } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { afterEach, describe, expect, it } from 'vitest'
import {
  cannedJobs,
  jobAttachments,
  jobLines,
  quoteEvents,
  quoteVersions,
  shops,
  ticketJobs,
} from '@/lib/db/schema'
import { createTestDb, type TestDb } from '@/tests/helpers/db'

const closeCallbacks: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(closeCallbacks.splice(0).map((close) => close()))
})

const IDs = {
  shopA: '10000000-0000-0000-0000-000000000001',
  shopB: '10000000-0000-0000-0000-000000000002',
  profileA: '20000000-0000-0000-0000-000000000001',
  profileB: '20000000-0000-0000-0000-000000000002',
  userA: '30000000-0000-0000-0000-000000000001',
  userB: '30000000-0000-0000-0000-000000000002',
  ticketA: '40000000-0000-0000-0000-000000000001',
  ticketA2: '40000000-0000-0000-0000-000000000002',
  ticketB: '40000000-0000-0000-0000-000000000003',
  jobA: '50000000-0000-0000-0000-000000000001',
  jobA2: '50000000-0000-0000-0000-000000000002',
  jobB: '50000000-0000-0000-0000-000000000003',
  versionA: '60000000-0000-0000-0000-000000000001',
  versionA2: '60000000-0000-0000-0000-000000000002',
  versionB: '60000000-0000-0000-0000-000000000003',
} as const

async function seedQuoteParents(db: TestDb) {
  await db.execute(sql`
    insert into shops (id, name) values
      (${IDs.shopA}::uuid, 'Shop A'),
      (${IDs.shopB}::uuid, 'Shop B')
  `)
  await db.execute(sql`
    insert into profiles (id, user_id, shop_id, full_name) values
      (${IDs.profileA}::uuid, ${IDs.userA}::uuid, ${IDs.shopA}::uuid, 'Owner A'),
      (${IDs.profileB}::uuid, ${IDs.userB}::uuid, ${IDs.shopB}::uuid, 'Owner B')
  `)
  await db.execute(sql`
    insert into tickets (id, shop_id, ticket_number, source, concern, created_by_profile_id) values
      (${IDs.ticketA}::uuid, ${IDs.shopA}::uuid, 1, 'tech_quick', 'A', ${IDs.profileA}::uuid),
      (${IDs.ticketA2}::uuid, ${IDs.shopA}::uuid, 2, 'tech_quick', 'A2', ${IDs.profileA}::uuid),
      (${IDs.ticketB}::uuid, ${IDs.shopB}::uuid, 1, 'tech_quick', 'B', ${IDs.profileB}::uuid)
  `)
  await db.execute(sql`
    insert into ticket_jobs (id, shop_id, ticket_id, title, kind, required_skill_tier) values
      (${IDs.jobA}::uuid, ${IDs.shopA}::uuid, ${IDs.ticketA}::uuid, 'Job A', 'repair', 1),
      (${IDs.jobA2}::uuid, ${IDs.shopA}::uuid, ${IDs.ticketA2}::uuid, 'Job A2', 'repair', 1),
      (${IDs.jobB}::uuid, ${IDs.shopB}::uuid, ${IDs.ticketB}::uuid, 'Job B', 'repair', 1)
  `)
  await db.execute(sql`
    insert into quote_versions (id, shop_id, ticket_id, version_number, snapshot, created_by_profile_id) values
      (${IDs.versionA}::uuid, ${IDs.shopA}::uuid, ${IDs.ticketA}::uuid, 1, '{}'::jsonb, ${IDs.profileA}::uuid),
      (${IDs.versionA2}::uuid, ${IDs.shopA}::uuid, ${IDs.ticketA2}::uuid, 1, '{}'::jsonb, ${IDs.profileA}::uuid),
      (${IDs.versionB}::uuid, ${IDs.shopB}::uuid, ${IDs.ticketB}::uuid, 1, '{}'::jsonb, ${IDs.profileB}::uuid)
  `)
}

async function createPre0028Db() {
  const client = new PGlite({ extensions: { vector } })
  await client.query('CREATE EXTENSION IF NOT EXISTS vector;')
  await client.exec('CREATE SCHEMA IF NOT EXISTS auth;')
  await client.exec(`CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT '00000000-0000-0000-0000-000000000000'::uuid $$;`)

  const journal = JSON.parse(
    await readFile(path.join(process.cwd(), 'drizzle/migrations/meta/_journal.json'), 'utf8'),
  ) as { entries: Array<{ idx: number; tag: string }> }
  for (const entry of journal.entries.filter(({ idx }) => idx <= 29)) {
    const migration = await readFile(
      path.join(process.cwd(), `drizzle/migrations/${entry.tag}.sql`),
      'utf8',
    )
    await client.exec(migration.replaceAll('--> statement-breakpoint', ''))
  }

  return client
}

function names(table: Parameters<typeof getTableConfig>[0]) {
  const config = getTableConfig(table)
  return {
    checks: config.checks.map((entry) => entry.name),
    foreignKeys: config.foreignKeys.map((entry) => entry.getName()),
    foreignKeyDeletes: Object.fromEntries(
      config.foreignKeys.map((entry) => [entry.getName(), entry.onDelete]),
    ),
    foreignKeyColumns: Object.fromEntries(
      config.foreignKeys.map((entry) => {
        const reference = entry.reference()
        return [
          entry.getName(),
          {
            columns: reference.columns.map((column) => column.name),
            foreignColumns: reference.foreignColumns.map((column) => column.name),
          },
        ]
      }),
    ),
    indexes: config.indexes.map((entry) => entry.config.name),
    indexColumns: Object.fromEntries(
      config.indexes.map((entry) => [
        entry.config.name,
        entry.config.columns.map((column) => (column as { name?: string }).name),
      ]),
    ),
  }
}

describe('Shop OS quote foundation source schema', () => {
  it('loads the real schema module with all five quote foundation tables', () => {
    expect([
      getTableConfig(jobAttachments).name,
      getTableConfig(jobLines).name,
      getTableConfig(cannedJobs).name,
      getTableConfig(quoteVersions).name,
      getTableConfig(quoteEvents).name,
    ]).toEqual([
      'job_attachments',
      'job_lines',
      'canned_jobs',
      'quote_versions',
      'quote_events',
    ])
  })

  it('declares unconfigured shop pricing and exact approved-version job fields', () => {
    const shopColumns = getTableColumns(shops)
    const jobColumns = getTableColumns(ticketJobs)

    expect(shopColumns).toMatchObject({
      laborRateCents: expect.anything(),
      taxRateBps: expect.anything(),
    })
    expect(shopColumns.laborRateCents.getSQLType()).toBe('bigint')
    expect(shopColumns.laborRateCents.notNull).toBe(false)
    expect(shopColumns.laborRateCents.hasDefault).toBe(false)
    expect(shopColumns.taxRateBps.getSQLType()).toBe('integer')
    expect(shopColumns.taxRateBps.notNull).toBe(false)
    expect(shopColumns.taxRateBps.hasDefault).toBe(false)
    expect(names(shops).checks).toEqual(expect.arrayContaining([
      'shops_labor_rate_cents_range',
      'shops_tax_rate_bps_range',
    ]))

    expect(jobColumns).toMatchObject({
      customerStory: expect.anything(),
      storyMeta: expect.anything(),
      approvedQuoteVersionId: expect.anything(),
    })
    expect(jobColumns.customerStory.getSQLType()).toBe('jsonb')
    expect(jobColumns.storyMeta.getSQLType()).toBe('jsonb')
    expect(jobColumns.approvedQuoteVersionId.getSQLType()).toBe('uuid')
  })

  it('declares approved money and precision column types', () => {
    const lineColumns = getTableColumns(jobLines)

    expect(lineColumns.quantity.getSQLType()).toBe('numeric(12, 3)')
    expect(lineColumns.laborHours.getSQLType()).toBe('numeric(8, 2)')
    for (const column of [
      lineColumns.priceCents,
      lineColumns.unitCostCents,
      lineColumns.coreChargeCents,
      lineColumns.laborRateCents,
    ]) {
      expect(column.getSQLType()).toBe('bigint')
    }
  })

  it('declares every approved table field without future transport or vendor foreign keys', () => {
    expect(getTableColumns(jobAttachments)).toMatchObject({
      id: expect.anything(),
      shopId: expect.anything(),
      jobId: expect.anything(),
      storageKey: expect.anything(),
      kind: expect.anything(),
      mimeType: expect.anything(),
      byteSize: expect.anything(),
      uploadedByProfileId: expect.anything(),
      createdAt: expect.anything(),
    })
    expect(getTableColumns(jobLines)).toMatchObject({
      id: expect.anything(),
      shopId: expect.anything(),
      jobId: expect.anything(),
      kind: expect.anything(),
      description: expect.anything(),
      sort: expect.anything(),
      quantity: expect.anything(),
      priceCents: expect.anything(),
      taxable: expect.anything(),
      partNumber: expect.anything(),
      brand: expect.anything(),
      unitCostCents: expect.anything(),
      coreChargeCents: expect.anything(),
      fitment: expect.anything(),
      vendorAccountId: expect.anything(),
      externalOfferId: expect.anything(),
      vendorSnapshot: expect.anything(),
      partStatus: expect.anything(),
      orderedAt: expect.anything(),
      orderedByProfileId: expect.anything(),
      receivedAt: expect.anything(),
      receivedByProfileId: expect.anything(),
      laborHours: expect.anything(),
      laborRateCents: expect.anything(),
      source: expect.anything(),
      createdAt: expect.anything(),
      updatedAt: expect.anything(),
    })
    expect(getTableColumns(cannedJobs)).toMatchObject({
      id: expect.anything(),
      shopId: expect.anything(),
      title: expect.anything(),
      kind: expect.anything(),
      defaultRequiredSkillTier: expect.anything(),
      defaultLines: expect.anything(),
      sort: expect.anything(),
      retiredAt: expect.anything(),
      createdAt: expect.anything(),
      updatedAt: expect.anything(),
    })
    expect(getTableColumns(quoteVersions)).toMatchObject({
      id: expect.anything(),
      shopId: expect.anything(),
      ticketId: expect.anything(),
      versionNumber: expect.anything(),
      snapshot: expect.anything(),
      createdByProfileId: expect.anything(),
      createdAt: expect.anything(),
      supersededAt: expect.anything(),
    })
    expect(getTableColumns(quoteEvents)).toMatchObject({
      id: expect.anything(),
      shopId: expect.anything(),
      ticketId: expect.anything(),
      jobId: expect.anything(),
      quoteVersionId: expect.anything(),
      quoteSendId: expect.anything(),
      kind: expect.anything(),
      actorProfileId: expect.anything(),
      approvedVia: expect.anything(),
      requestKey: expect.anything(),
      providerEventId: expect.anything(),
      body: expect.anything(),
      userAgent: expect.anything(),
      createdAt: expect.anything(),
    })

    expect(names(jobLines).foreignKeys).not.toContain('job_lines_vendor_account_fk')
    expect(names(quoteEvents).foreignKeys).not.toContain('quote_events_send_fk')
  })

  it('declares composite ownership, exact-version, checks, and access indexes', () => {
    expect(names(ticketJobs).indexes).toEqual(expect.arrayContaining([
      'ticket_jobs_shop_id_uq',
      'ticket_jobs_shop_ticket_id_uq',
      'ticket_jobs_approved_quote_version_idx',
    ]))
    expect(names(ticketJobs).foreignKeys).toContain('ticket_jobs_approved_quote_version_fk')
    expect(names(ticketJobs).foreignKeyColumns.ticket_jobs_approved_quote_version_fk).toEqual({
      columns: ['shop_id', 'ticket_id', 'approved_quote_version_id'],
      foreignColumns: ['shop_id', 'ticket_id', 'id'],
    })
    expect(names(ticketJobs).foreignKeyDeletes.ticket_jobs_approved_quote_version_fk).toBe('restrict')
    expect(names(ticketJobs).indexColumns.ticket_jobs_approved_quote_version_idx).toEqual([
      'shop_id',
      'ticket_id',
      'approved_quote_version_id',
    ])

    expect(names(jobAttachments)).toMatchObject({
      foreignKeys: expect.arrayContaining([
        'job_attachments_shop_job_fk',
        'job_attachments_shop_uploader_fk',
      ]),
      indexes: expect.arrayContaining([
        'job_attachments_shop_storage_key_uq',
        'job_attachments_job_created_idx',
        'job_attachments_uploader_created_idx',
      ]),
      foreignKeyDeletes: expect.objectContaining({
        job_attachments_shop_job_fk: 'restrict',
        job_attachments_shop_uploader_fk: 'restrict',
      }),
      checks: expect.arrayContaining([
        'job_attachments_kind_valid',
        'job_attachments_byte_size_range',
      ]),
    })
    expect(names(jobAttachments).foreignKeyColumns).toMatchObject({
      job_attachments_shop_job_fk: {
        columns: ['shop_id', 'job_id'],
        foreignColumns: ['shop_id', 'id'],
      },
      job_attachments_shop_uploader_fk: {
        columns: ['shop_id', 'uploaded_by_profile_id'],
        foreignColumns: ['shop_id', 'id'],
      },
    })
    expect(names(jobAttachments).indexColumns).toMatchObject({
      job_attachments_job_created_idx: ['shop_id', 'job_id', 'created_at'],
      job_attachments_uploader_created_idx: [
        'shop_id',
        'uploaded_by_profile_id',
        'created_at',
      ],
    })
    expect(names(jobLines)).toMatchObject({
      foreignKeys: expect.arrayContaining([
        'job_lines_shop_job_fk',
        'job_lines_shop_ordered_by_fk',
        'job_lines_shop_received_by_fk',
      ]),
      checks: expect.arrayContaining([
        'job_lines_kind_valid',
        'job_lines_quantity_positive',
        'job_lines_money_nonnegative',
        'job_lines_money_safe_integer',
        'job_lines_labor_hours_nonnegative',
        'job_lines_json_objects',
      ]),
      indexes: expect.arrayContaining([
        'job_lines_job_sort_idx',
        'job_lines_shop_vendor_account_idx',
        'job_lines_ordered_by_idx',
        'job_lines_received_by_idx',
      ]),
      foreignKeyDeletes: expect.objectContaining({
        job_lines_shop_job_fk: 'restrict',
        job_lines_shop_ordered_by_fk: 'restrict',
        job_lines_shop_received_by_fk: 'restrict',
      }),
    })
    expect(names(jobLines).foreignKeyColumns).toMatchObject({
      job_lines_shop_job_fk: {
        columns: ['shop_id', 'job_id'],
        foreignColumns: ['shop_id', 'id'],
      },
      job_lines_shop_ordered_by_fk: {
        columns: ['shop_id', 'ordered_by_profile_id'],
        foreignColumns: ['shop_id', 'id'],
      },
      job_lines_shop_received_by_fk: {
        columns: ['shop_id', 'received_by_profile_id'],
        foreignColumns: ['shop_id', 'id'],
      },
    })
    expect(names(jobLines).indexColumns).toMatchObject({
      job_lines_job_sort_idx: ['shop_id', 'job_id', 'sort'],
      job_lines_ordered_by_idx: ['shop_id', 'ordered_by_profile_id'],
      job_lines_received_by_idx: ['shop_id', 'received_by_profile_id'],
    })
    expect(names(cannedJobs)).toMatchObject({
      checks: expect.arrayContaining([
        'canned_jobs_kind_valid',
        'canned_jobs_skill_tier_range',
        'canned_jobs_sort_nonnegative',
        'canned_jobs_default_lines_array',
      ]),
      indexes: expect.arrayContaining(['canned_jobs_shop_sort_idx']),
    })
    expect(names(quoteVersions)).toMatchObject({
      foreignKeys: expect.arrayContaining([
        'quote_versions_shop_ticket_fk',
        'quote_versions_shop_creator_fk',
      ]),
      checks: expect.arrayContaining([
        'quote_versions_number_positive',
        'quote_versions_snapshot_object',
      ]),
      indexes: expect.arrayContaining([
        'quote_versions_shop_ticket_version_uq',
        'quote_versions_shop_ticket_id_uq',
        'quote_versions_shop_creator_idx',
      ]),
      foreignKeyDeletes: expect.objectContaining({
        quote_versions_shop_ticket_fk: 'restrict',
        quote_versions_shop_creator_fk: 'restrict',
      }),
    })
    expect(names(quoteVersions).foreignKeyColumns).toMatchObject({
      quote_versions_shop_ticket_fk: {
        columns: ['shop_id', 'ticket_id'],
        foreignColumns: ['shop_id', 'id'],
      },
      quote_versions_shop_creator_fk: {
        columns: ['shop_id', 'created_by_profile_id'],
        foreignColumns: ['shop_id', 'id'],
      },
    })
    expect(names(quoteVersions).indexColumns).toMatchObject({
      quote_versions_shop_ticket_version_uq: ['shop_id', 'ticket_id', 'version_number'],
      quote_versions_shop_creator_idx: ['shop_id', 'created_by_profile_id'],
    })
    expect(names(quoteEvents)).toMatchObject({
      foreignKeys: expect.arrayContaining([
        'quote_events_shop_ticket_fk',
        'quote_events_shop_ticket_job_fk',
        'quote_events_shop_ticket_version_fk',
        'quote_events_shop_actor_fk',
      ]),
      checks: expect.arrayContaining([
        'quote_events_kind_valid',
        'quote_events_approved_via_valid',
        'quote_events_approval_channel_consistent',
        'quote_events_decision_job_consistent',
        'quote_events_offline_approval_actor_consistent',
      ]),
      indexes: expect.arrayContaining([
        'quote_events_shop_request_key_uq',
        'quote_events_shop_provider_event_uq',
        'quote_events_ticket_created_idx',
        'quote_events_quote_send_idx',
        'quote_events_job_idx',
        'quote_events_version_idx',
        'quote_events_actor_idx',
      ]),
      foreignKeyDeletes: expect.objectContaining({
        quote_events_shop_ticket_fk: 'restrict',
        quote_events_shop_ticket_job_fk: 'restrict',
        quote_events_shop_ticket_version_fk: 'restrict',
        quote_events_shop_actor_fk: 'restrict',
      }),
    })
    expect(names(quoteEvents).foreignKeyColumns).toMatchObject({
      quote_events_shop_ticket_fk: {
        columns: ['shop_id', 'ticket_id'],
        foreignColumns: ['shop_id', 'id'],
      },
      quote_events_shop_ticket_job_fk: {
        columns: ['shop_id', 'ticket_id', 'job_id'],
        foreignColumns: ['shop_id', 'ticket_id', 'id'],
      },
      quote_events_shop_ticket_version_fk: {
        columns: ['shop_id', 'ticket_id', 'quote_version_id'],
        foreignColumns: ['shop_id', 'ticket_id', 'id'],
      },
      quote_events_shop_actor_fk: {
        columns: ['shop_id', 'actor_profile_id'],
        foreignColumns: ['shop_id', 'id'],
      },
    })
    expect(names(quoteEvents).indexColumns).toMatchObject({
      quote_events_ticket_created_idx: ['shop_id', 'ticket_id', 'created_at'],
      quote_events_job_idx: ['shop_id', 'ticket_id', 'job_id'],
      quote_events_version_idx: ['shop_id', 'ticket_id', 'quote_version_id'],
      quote_events_actor_idx: ['shop_id', 'actor_profile_id'],
    })
  })
})

describe('Shop OS quote foundation migration', () => {
  it('pins both quote trigger functions to an empty search path', async () => {
    const { client, close } = await createTestDb()
    closeCallbacks.push(close)

    const functions = await client.query<{
      proname: string
      proconfig: string[] | null
    }>(`
      select p.proname, p.proconfig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('guard_quote_versions_immutable', 'reject_quote_events_mutation')
      order by p.proname
    `)

    expect(functions.rows).toEqual([
      { proname: 'guard_quote_versions_immutable', proconfig: ['search_path=""'] },
      { proname: 'reject_quote_events_mutation', proconfig: ['search_path=""'] },
    ])
  })

  it('creates the additive foundation through the complete source chain with unconfigured shop rates', async () => {
    const client = await createPre0028Db()
    closeCallbacks.push(() => client.close())
    await client.exec(`
      insert into shops (id, name) values ('${IDs.shopA}'::uuid, 'Existing-safe');
      insert into profiles (id, user_id, shop_id, full_name)
        values ('${IDs.profileA}'::uuid, '${IDs.userA}'::uuid, '${IDs.shopA}'::uuid, 'Existing owner');
      insert into tickets (id, shop_id, ticket_number, source, concern, created_by_profile_id)
        values ('${IDs.ticketA}'::uuid, '${IDs.shopA}'::uuid, 1, 'tech_quick', 'Existing concern', '${IDs.profileA}'::uuid);
      insert into ticket_jobs (id, shop_id, ticket_id, title, kind, required_skill_tier)
        values ('${IDs.jobA}'::uuid, '${IDs.shopA}'::uuid, '${IDs.ticketA}'::uuid, 'Existing job', 'repair', 1);
    `)
    const migration = await readFile(
      path.join(process.cwd(), 'drizzle/migrations/0028_shop_os_quote_foundation.sql'),
      'utf8',
    )
    await client.exec(migration.replaceAll('--> statement-breakpoint', ''))

    const columns = await client.query<{
      labor_default: string | null
      tax_default: string | null
      labor_nullable: string
      tax_nullable: string
    }>(`
      select
        max(column_default) filter (where column_name = 'labor_rate_cents') as labor_default,
        max(column_default) filter (where column_name = 'tax_rate_bps') as tax_default,
        max(is_nullable) filter (where column_name = 'labor_rate_cents') as labor_nullable,
        max(is_nullable) filter (where column_name = 'tax_rate_bps') as tax_nullable
      from information_schema.columns
      where table_schema = 'public' and table_name = 'shops'
    `)
    expect(columns.rows[0]).toEqual({
      labor_default: null,
      tax_default: null,
      labor_nullable: 'YES',
      tax_nullable: 'YES',
    })

    const rates = await client.query<{ labor_rate_cents: number | null; tax_rate_bps: number | null }>(
      `select labor_rate_cents, tax_rate_bps from shops where id = '${IDs.shopA}'::uuid`,
    )
    expect(rates.rows[0]).toEqual({ labor_rate_cents: null, tax_rate_bps: null })

    const job = await client.query<{ customer_story: unknown; approved_quote_version_id: string | null }>(
      `select customer_story, approved_quote_version_id from ticket_jobs where id = '${IDs.jobA}'::uuid`,
    )
    expect(job.rows[0]).toEqual({ customer_story: null, approved_quote_version_id: null })

    const tables = await client.query<{ table_name: string }>(`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name in ('job_attachments','job_lines','canned_jobs','quote_versions','quote_events')
      order by table_name
    `)
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      'canned_jobs',
      'job_attachments',
      'job_lines',
      'quote_events',
      'quote_versions',
    ])
  })

  it('enforces same-shop, same-ticket, and exact-version ownership', async () => {
    const { db, close } = await createTestDb()
    closeCallbacks.push(close)
    await seedQuoteParents(db)

    await expect(db.execute(sql`
      insert into job_attachments
        (shop_id, job_id, storage_key, kind, mime_type, byte_size, uploaded_by_profile_id)
      values
        (${IDs.shopB}::uuid, ${IDs.jobA}::uuid, 'wrong-shop', 'photo', 'image/jpeg', 10, ${IDs.profileB}::uuid)
    `)).rejects.toThrow()

    await expect(db.execute(sql`
      update ticket_jobs set approved_quote_version_id = ${IDs.versionA2}::uuid
      where id = ${IDs.jobA}::uuid
    `)).rejects.toThrow()

    await expect(db.execute(sql`
      insert into quote_events
        (shop_id, ticket_id, job_id, quote_version_id, kind, approved_via, request_key)
      values
        (${IDs.shopA}::uuid, ${IDs.ticketA}::uuid, ${IDs.jobA}::uuid,
         ${IDs.versionA2}::uuid, 'approved', 'page', 'wrong-version')
    `)).rejects.toThrow()

    await expect(db.execute(sql`
      insert into quote_events
        (shop_id, ticket_id, job_id, quote_version_id, kind, approved_via, request_key)
      values
        (${IDs.shopA}::uuid, ${IDs.ticketA}::uuid, ${IDs.jobA2}::uuid,
         ${IDs.versionA}::uuid, 'approved', 'page', 'wrong-job')
    `)).rejects.toThrow()
  })

  it('rejects unsafe money, precision, ranges, and wrong JSON containers', async () => {
    const { db, close } = await createTestDb()
    closeCallbacks.push(close)
    await seedQuoteParents(db)

    await expect(db.execute(sql`
      update shops set labor_rate_cents = 9007199254740992 where id = ${IDs.shopA}::uuid
    `)).rejects.toThrow()
    await expect(db.execute(sql`
      update shops set tax_rate_bps = 10001 where id = ${IDs.shopA}::uuid
    `)).rejects.toThrow()
    await expect(db.execute(sql`
      update ticket_jobs set customer_story = '[]'::jsonb where id = ${IDs.jobA}::uuid
    `)).rejects.toThrow()
    await expect(db.execute(sql`
      insert into job_attachments
        (shop_id, job_id, storage_key, kind, mime_type, byte_size, uploaded_by_profile_id)
      values
        (${IDs.shopA}::uuid, ${IDs.jobA}::uuid, 'too-large', 'photo', 'image/jpeg',
         9007199254740992, ${IDs.profileA}::uuid)
    `)).rejects.toThrow()
    await expect(db.execute(sql`
      insert into job_lines
        (shop_id, job_id, kind, description, quantity, price_cents, vendor_snapshot)
      values
        (${IDs.shopA}::uuid, ${IDs.jobA}::uuid, 'part', 'Zero quantity', 0, 1, '{}'::jsonb)
    `)).rejects.toThrow()
    await expect(db.execute(sql`
      insert into job_lines
        (shop_id, job_id, kind, description, quantity, price_cents)
      values
        (${IDs.shopA}::uuid, ${IDs.jobA}::uuid, 'part', 'Negative money', 1, -1)
    `)).rejects.toThrow()
    await expect(db.execute(sql`
      insert into job_lines
        (shop_id, job_id, kind, description, quantity, price_cents)
      values
        (${IDs.shopA}::uuid, ${IDs.jobA}::uuid, 'part', 'Unsafe integer', 1, 9007199254740992)
    `)).rejects.toThrow()
    await expect(db.execute(sql`
      insert into job_lines
        (shop_id, job_id, kind, description, quantity, price_cents)
      values
        (${IDs.shopA}::uuid, ${IDs.jobA}::uuid, 'part', 'Quantity overflow', 1000000000, 1)
    `)).rejects.toThrow()
    await expect(db.execute(sql`
      insert into job_lines
        (shop_id, job_id, kind, description, quantity, price_cents, labor_hours)
      values
        (${IDs.shopA}::uuid, ${IDs.jobA}::uuid, 'labor', 'Hours overflow', 1, 1, 1000000)
    `)).rejects.toThrow()
    await expect(db.execute(sql`
      insert into job_lines
        (shop_id, job_id, kind, description, quantity, price_cents, vendor_snapshot)
      values
        (${IDs.shopA}::uuid, ${IDs.jobA}::uuid, 'part', 'Wrong JSON', 1, 1, '[]'::jsonb)
    `)).rejects.toThrow()
    await expect(db.execute(sql`
      insert into canned_jobs
        (shop_id, title, kind, default_required_skill_tier, default_lines)
      values
        (${IDs.shopA}::uuid, 'Bad template', 'repair', 1, '{}'::jsonb)
    `)).rejects.toThrow()
    await expect(db.execute(sql`
      insert into quote_versions
        (shop_id, ticket_id, version_number, snapshot, created_by_profile_id)
      values
        (${IDs.shopA}::uuid, ${IDs.ticketA}::uuid, 2, '[]'::jsonb, ${IDs.profileA}::uuid)
    `)).rejects.toThrow()
  })

  it('enforces event decision rules and immutable quote history', async () => {
    const { db, close } = await createTestDb()
    closeCallbacks.push(close)
    await seedQuoteParents(db)

    await expect(db.execute(sql`
      insert into quote_events
        (shop_id, ticket_id, quote_version_id, kind, approved_via, request_key)
      values
        (${IDs.shopA}::uuid, ${IDs.ticketA}::uuid, ${IDs.versionA}::uuid,
         'approved', 'page', 'approved-without-job')
    `)).rejects.toThrow()
    await expect(db.execute(sql`
      insert into quote_events
        (shop_id, ticket_id, quote_version_id, kind, request_key)
      values
        (${IDs.shopA}::uuid, ${IDs.ticketA}::uuid, ${IDs.versionA}::uuid,
         'declined', 'declined-without-job')
    `)).rejects.toThrow()
    await expect(db.execute(sql`
      insert into quote_events
        (shop_id, ticket_id, quote_version_id, kind, approved_via, request_key)
      values
        (${IDs.shopA}::uuid, ${IDs.ticketA}::uuid, ${IDs.versionA}::uuid,
         'sent', 'page', 'nonapproval-with-channel')
    `)).rejects.toThrow()
    await expect(db.execute(sql`
      insert into quote_events
        (shop_id, ticket_id, job_id, quote_version_id, kind, approved_via, request_key)
      values
        (${IDs.shopA}::uuid, ${IDs.ticketA}::uuid, ${IDs.jobA}::uuid, ${IDs.versionA}::uuid,
         'approved', 'phone', 'offline-without-actor')
    `)).rejects.toThrow()

    await db.execute(sql`
      insert into quote_events
        (shop_id, ticket_id, job_id, quote_version_id, kind, approved_via, actor_profile_id, request_key)
      values
        (${IDs.shopA}::uuid, ${IDs.ticketA}::uuid, ${IDs.jobA}::uuid, ${IDs.versionA}::uuid,
         'approved', 'phone', ${IDs.profileA}::uuid, 'valid-approval')
    `)
    await expect(db.execute(sql`
      update quote_events set body = 'changed' where request_key = 'valid-approval'
    `)).rejects.toThrow()
    await expect(db.execute(sql`
      delete from quote_events where request_key = 'valid-approval'
    `)).rejects.toThrow()

    await expect(db.execute(sql`
      update quote_versions set snapshot = '{"changed":true}'::jsonb where id = ${IDs.versionA}::uuid
    `)).rejects.toThrow()
    await expect(db.execute(sql`
      update quote_versions
      set superseded_at = now(), snapshot = '{"changed_during_supersession":true}'::jsonb
      where id = ${IDs.versionA}::uuid
    `)).rejects.toThrow()
    await db.execute(sql`
      update quote_versions set superseded_at = now() where id = ${IDs.versionA}::uuid
    `)
    await expect(db.execute(sql`
      update quote_versions set superseded_at = now() where id = ${IDs.versionA}::uuid
    `)).rejects.toThrow()
    await expect(db.execute(sql`
      delete from quote_versions where id = ${IDs.versionA}::uuid
    `)).rejects.toThrow()
  })

  it('keeps every new table server-only with RLS, deny policies, and service grants', async () => {
    const { db, close } = await createTestDb()
    closeCallbacks.push(close)

    const security = await db.execute<{
      relname: string
      relrowsecurity: boolean
      anon_select: boolean
      anon_insert: boolean
      anon_update: boolean
      anon_delete: boolean
      authenticated_select: boolean
      authenticated_insert: boolean
      authenticated_update: boolean
      authenticated_delete: boolean
      service_select: boolean
      service_insert: boolean
      service_update: boolean
      service_delete: boolean
      policy_name: string
      policy_roles: string
      policy_cmd: string
      policy_qual: string
      policy_with_check: string
    }>(sql`
      select c.relname,
             c.relrowsecurity,
             has_table_privilege('anon', c.oid, 'select') as anon_select,
             has_table_privilege('anon', c.oid, 'insert') as anon_insert,
             has_table_privilege('anon', c.oid, 'update') as anon_update,
             has_table_privilege('anon', c.oid, 'delete') as anon_delete,
             has_table_privilege('authenticated', c.oid, 'select') as authenticated_select,
             has_table_privilege('authenticated', c.oid, 'insert') as authenticated_insert,
             has_table_privilege('authenticated', c.oid, 'update') as authenticated_update,
             has_table_privilege('authenticated', c.oid, 'delete') as authenticated_delete,
             has_table_privilege('service_role', c.oid, 'select') as service_select,
             has_table_privilege('service_role', c.oid, 'insert') as service_insert,
             has_table_privilege('service_role', c.oid, 'update') as service_update,
             has_table_privilege('service_role', c.oid, 'delete') as service_delete,
             p.policyname as policy_name,
             p.roles::text as policy_roles,
             p.cmd as policy_cmd,
             p.qual as policy_qual,
             p.with_check as policy_with_check
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_policies p on p.schemaname = n.nspname and p.tablename = c.relname
      where n.nspname = 'public'
        and c.relname in ('job_attachments','job_lines','canned_jobs','quote_versions','quote_events')
      order by c.relname
    `)
    expect(security.rows).toHaveLength(5)
    for (const row of security.rows) {
      expect(row).toMatchObject({
        relrowsecurity: true,
        anon_select: false,
        anon_insert: false,
        anon_update: false,
        anon_delete: false,
        authenticated_select: false,
        authenticated_insert: false,
        authenticated_update: false,
        authenticated_delete: false,
        service_select: true,
        service_insert: true,
        service_update: true,
        service_delete: true,
        policy_name: `${row.relname}_server_only_deny_direct`,
        policy_roles: '{anon,authenticated}',
        policy_cmd: 'ALL',
        policy_qual: 'false',
        policy_with_check: 'false',
      })
    }
  })
})
