import { getTableColumns, sql } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { afterEach, describe, expect, it } from 'vitest'
import { jobLines, vendorAccounts } from '@/lib/db/schema'
import {
  createTestDb,
  ensureVendorAccountsMigration,
  type TestDb,
} from '@/tests/helpers/db'

const closeCallbacks: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(closeCallbacks.splice(0).map((close) => close()))
})

const IDs = {
  shopA: '10000000-0000-0000-0000-000000000001',
  shopB: '10000000-0000-0000-0000-000000000002',
  profileA: '20000000-0000-0000-0000-000000000001',
  userA: '30000000-0000-0000-0000-000000000001',
  ticketA: '40000000-0000-0000-0000-000000000001',
  jobA: '50000000-0000-0000-0000-000000000001',
  manualA: '60000000-0000-0000-0000-000000000001',
  envA: '60000000-0000-0000-0000-000000000002',
  vaultA: '60000000-0000-0000-0000-000000000003',
  manualB: '60000000-0000-0000-0000-000000000004',
} as const

function tableNames(table: Parameters<typeof getTableConfig>[0]) {
  const config = getTableConfig(table)
  return {
    checks: config.checks.map((entry) => entry.name),
    foreignKeys: config.foreignKeys.map((entry) => entry.getName()),
    foreignKeyDeletes: Object.fromEntries(
      config.foreignKeys.map((entry) => [entry.getName(), entry.onDelete]),
    ),
    indexes: config.indexes.map((entry) => entry.config.name),
  }
}

async function seedParents(db: TestDb) {
  await db.execute(sql`
    insert into shops (id, name) values
      (${IDs.shopA}::uuid, 'Shop A'),
      (${IDs.shopB}::uuid, 'Shop B')
  `)
  await db.execute(sql`
    insert into profiles (id, user_id, shop_id, full_name)
    values (${IDs.profileA}::uuid, ${IDs.userA}::uuid, ${IDs.shopA}::uuid, 'Owner A')
  `)
  await db.execute(sql`
    insert into tickets (id, shop_id, ticket_number, source, concern, created_by_profile_id)
    values (${IDs.ticketA}::uuid, ${IDs.shopA}::uuid, 1, 'tech_quick', 'Concern', ${IDs.profileA}::uuid)
  `)
  await db.execute(sql`
    insert into ticket_jobs (id, shop_id, ticket_id, title, kind, required_skill_tier)
    values (${IDs.jobA}::uuid, ${IDs.shopA}::uuid, ${IDs.ticketA}::uuid, 'Repair', 'repair', 1)
  `)
}

describe('Shop OS vendor account source schema', () => {
  it('declares the exact tenant-safe vendor account model and line reference', () => {
    expect(getTableConfig(vendorAccounts).name).toBe('vendor_accounts')
    const columns = getTableColumns(vendorAccounts)
    expect(columns).toMatchObject({
      id: expect.anything(),
      shopId: expect.anything(),
      vendor: expect.anything(),
      displayName: expect.anything(),
      mode: expect.anything(),
      nonSecretConfig: expect.anything(),
      secretRef: expect.anything(),
      enabled: expect.anything(),
      createdAt: expect.anything(),
      updatedAt: expect.anything(),
    })
    expect(columns.nonSecretConfig.getSQLType()).toBe('jsonb')
    expect(columns.secretRef.getSQLType()).toBe('text')
    expect(columns.secretRef.notNull).toBe(false)
    expect(columns.enabled.notNull).toBe(true)
    expect(columns.enabled.hasDefault).toBe(true)

    expect(tableNames(vendorAccounts)).toMatchObject({
      checks: expect.arrayContaining([
        'vendor_accounts_vendor_slug_valid',
        'vendor_accounts_display_name_valid',
        'vendor_accounts_mode_valid',
        'vendor_accounts_non_secret_config_object',
        'vendor_accounts_non_secret_config_size',
        'vendor_accounts_secret_ref_valid',
        'vendor_accounts_mode_secret_ref_valid',
      ]),
      foreignKeys: ['vendor_accounts_shop_fk'],
      foreignKeyDeletes: { vendor_accounts_shop_fk: 'cascade' },
      indexes: expect.arrayContaining([
        'vendor_accounts_shop_id_id_uq',
        'vendor_accounts_shop_enabled_vendor_idx',
      ]),
    })
    expect(tableNames(jobLines)).toMatchObject({
      foreignKeys: expect.arrayContaining(['job_lines_shop_vendor_account_fk']),
      foreignKeyDeletes: expect.objectContaining({ job_lines_shop_vendor_account_fk: 'restrict' }),
    })
  })

  it('loads Row 27 through the standard fixture and refuses partial migration state', async () => {
    const { db, client, close } = await createTestDb()
    closeCallbacks.push(close)

    const table = await db.execute<{ name: string | null }>(sql`
      select to_regclass('public.vendor_accounts')::text as name
    `)
    expect(table.rows).toEqual([{ name: 'vendor_accounts' }])

    await expect(ensureVendorAccountsMigration(client)).resolves.toBeUndefined()
    await db.execute(sql`
      alter table job_lines drop constraint job_lines_shop_vendor_account_fk
    `)
    await expect(ensureVendorAccountsMigration(client)).rejects.toThrow(
      'partial vendor accounts schema in ephemeral database',
    )
  })

  it('accepts only bounded manual, env-reference, and vault-reference accounts', async () => {
    const { db, close } = await createTestDb()
    closeCallbacks.push(close)
    await seedParents(db)

    await db.execute(sql`
      insert into vendor_accounts
        (id, shop_id, vendor, display_name, mode, non_secret_config, secret_ref, enabled)
      values
        (${IDs.manualA}::uuid, ${IDs.shopA}::uuid, 'local_supplier', 'Local Supplier',
         'manual', '{"website":"https://supplier.example"}'::jsonb, null, true),
        (${IDs.envA}::uuid, ${IDs.shopA}::uuid, 'partstech', 'PartsTech',
         'api', '{}'::jsonb, 'env:PARTSTECH_API_CREDENTIALS', false),
        (${IDs.vaultA}::uuid, ${IDs.shopA}::uuid, 'oreilly', 'O''Reilly',
         'punchout', '{}'::jsonb, 'vault:550e8400-e29b-41d4-a716-446655440000', false)
    `)

    const invalidRows = [
      sql`(${IDs.shopA}::uuid, 'bad slug', 'Bad', 'manual', '{}'::jsonb, null)`,
      sql`(${IDs.shopA}::uuid, 'ok', ' ', 'manual', '{}'::jsonb, null)`,
      sql`(${IDs.shopA}::uuid, 'ok', 'Bad mode', 'oauth', '{}'::jsonb, null)`,
      sql`(${IDs.shopA}::uuid, 'ok', 'Array config', 'manual', '[]'::jsonb, null)`,
      sql`(${IDs.shopA}::uuid, 'ok', 'Manual secret', 'manual', '{}'::jsonb, 'env:PARTS_API_KEY')`,
      sql`(${IDs.shopA}::uuid, 'ok', 'Missing ref', 'api', '{}'::jsonb, null)`,
      sql`(${IDs.shopA}::uuid, 'ok', 'Raw secret', 'api', '{}'::jsonb, 'sk_live_secret')`,
      sql`(${IDs.shopA}::uuid, 'ok', 'Lower env', 'api', '{}'::jsonb, 'env:parts_api_key')`,
      sql`(${IDs.shopA}::uuid, 'ok', 'Upper vault', 'api', '{}'::jsonb, 'vault:550E8400-E29B-41D4-A716-446655440000')`,
    ]
    for (const values of invalidRows) {
      await expect(db.execute(sql`
        insert into vendor_accounts
          (shop_id, vendor, display_name, mode, non_secret_config, secret_ref)
        values ${values}
      `)).rejects.toThrow()
    }

    await expect(db.execute(sql`
      insert into vendor_accounts
        (shop_id, vendor, display_name, mode, non_secret_config)
      values
        (${IDs.shopA}::uuid, 'ok', 'Oversized config', 'manual',
         jsonb_build_object('note', repeat('x', 4097)))
    `)).rejects.toThrow()
  })

  it('enforces direct shop ownership, same-shop line linkage, and referenced delete protection', async () => {
    const { db, close } = await createTestDb()
    closeCallbacks.push(close)
    await seedParents(db)

    await expect(db.execute(sql`
      insert into vendor_accounts (shop_id, vendor, display_name, mode)
      values ('90000000-0000-0000-0000-000000000009'::uuid, 'missing', 'Missing shop', 'manual')
    `)).rejects.toThrow()

    await db.execute(sql`
      insert into vendor_accounts (id, shop_id, vendor, display_name, mode)
      values
        (${IDs.manualA}::uuid, ${IDs.shopA}::uuid, 'supplier_a', 'Supplier A', 'manual'),
        (${IDs.manualB}::uuid, ${IDs.shopB}::uuid, 'supplier_b', 'Supplier B', 'manual')
    `)
    await db.execute(sql`
      insert into job_lines
        (shop_id, job_id, kind, description, quantity, price_cents, vendor_account_id)
      values
        (${IDs.shopA}::uuid, ${IDs.jobA}::uuid, 'part', 'Filter', 1, 1000, ${IDs.manualA}::uuid)
    `)
    await expect(db.execute(sql`
      update job_lines set vendor_account_id = ${IDs.manualB}::uuid
      where job_id = ${IDs.jobA}::uuid
    `)).rejects.toThrow()
    await expect(db.execute(sql`
      delete from vendor_accounts where id = ${IDs.manualA}::uuid
    `)).rejects.toThrow()
  })

  it('keeps the table server-only with exact RLS, ACL, policy, index, and constraint markers', async () => {
    const { db, close } = await createTestDb()
    closeCallbacks.push(close)

    const security = await db.execute<{
      relrowsecurity: boolean
      anon_select: boolean
      authenticated_insert: boolean
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
      select c.relrowsecurity,
             has_table_privilege('anon', c.oid, 'select') as anon_select,
             has_table_privilege('authenticated', c.oid, 'insert') as authenticated_insert,
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
      where n.nspname = 'public' and c.relname = 'vendor_accounts'
    `)
    expect(security.rows).toEqual([{
      relrowsecurity: true,
      anon_select: false,
      authenticated_insert: false,
      service_select: true,
      service_insert: true,
      service_update: true,
      service_delete: true,
      policy_name: 'vendor_accounts_server_only_deny_direct',
      policy_roles: '{anon,authenticated}',
      policy_cmd: 'ALL',
      policy_qual: 'false',
      policy_with_check: 'false',
    }])

    const markers = await db.execute<{ object_name: string }>(sql`
      select conname as object_name from pg_constraint
      where conname in (
        'vendor_accounts_shop_fk',
        'vendor_accounts_shop_id_id_uq',
        'vendor_accounts_secret_ref_valid',
        'job_lines_shop_vendor_account_fk'
      )
      union all
      select indexname from pg_indexes
      where schemaname = 'public' and indexname in (
        'vendor_accounts_shop_id_id_uq',
        'vendor_accounts_shop_enabled_vendor_idx'
      )
      order by object_name
    `)
    expect(markers.rows.map((row) => row.object_name)).toEqual([
      'job_lines_shop_vendor_account_fk',
      'vendor_accounts_secret_ref_valid',
      'vendor_accounts_shop_enabled_vendor_idx',
      'vendor_accounts_shop_fk',
      'vendor_accounts_shop_id_id_uq',
    ])
  })
})
