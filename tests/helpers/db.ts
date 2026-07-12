import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import * as schema from '@/lib/db/schema'

export type TestDb = PgliteDatabase<typeof schema>

export async function createTestDb(): Promise<{
  db: TestDb
  client: PGlite
  close: () => Promise<void>
}> {
  // pgvector is required by Phase K's corpus_entries migration. PGlite ships
  // it as an opt-in extension; without it, migrations fail to resolve the
  // `vector(1024)` type and the test DB never finishes setup.
  const client = new PGlite({ extensions: { vector } })
  await client.query('CREATE EXTENSION IF NOT EXISTS vector;')
  // PGlite has no `auth` schema. Supabase's RLS policies reference auth.uid();
  // stub it here so migrations that include policies don't error during pglite
  // setup. Tests run as superuser, so RLS is bypassed and the stub's value is
  // never actually used.
  await client.query('CREATE SCHEMA IF NOT EXISTS auth;')
  await client.query(`CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT '00000000-0000-0000-0000-000000000000'::uuid $$;`)
  const db = drizzle(client, { schema })
  await migrate(db, {
    migrationsFolder: path.join(process.cwd(), 'drizzle/migrations'),
  })

  // Migration 0029 is intentionally not in Drizzle's stale snapshot journal.
  // Keep ephemeral databases aligned without generating metadata, and stop
  // applying this seam automatically once a future journal reconciliation has
  // already created both deployed columns.
  const adaptiveColumns = await client.query<{ column_name: string }>(`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'sessions'
      and column_name in ('adaptive_diagnostic_state', 'adaptive_revision')
    order by column_name
  `)
  if (adaptiveColumns.rows.length === 0) {
    const adaptiveMigration = await readFile(
      path.join(process.cwd(), 'drizzle/migrations/0029_adaptive_diagnostic_state.sql'),
      'utf8',
    )
    await client.exec(adaptiveMigration.replaceAll('--> statement-breakpoint', ''))
  } else if (adaptiveColumns.rows.length !== 2) {
    throw new Error('partial adaptive diagnostic schema in ephemeral database')
  }
  await ensureVendorAccountsMigration(client)
  await ensureQuoteTriggerSearchPathMigration(client)
  await ensureShopOsServerOnlyAclMigration(client)
  return {
    db,
    client,
    close: async () => {
      await client.close()
    },
  }
}

type VendorAccountsMarkers = {
  table_exists: boolean
  column_count: number
  constraint_count: number
  index_count: number
  rls_enabled: boolean
  policy_count: number
  direct_grant_count: number
  service_grant_count: number
  job_line_fk_exists: boolean
}

async function vendorAccountsMarkers(client: PGlite): Promise<VendorAccountsMarkers> {
  const result = await client.query<VendorAccountsMarkers>(`
    select
      to_regclass('public.vendor_accounts') is not null as table_exists,
      (select count(*)::int from information_schema.columns
       where table_schema = 'public' and table_name = 'vendor_accounts'
         and column_name in (
           'id', 'shop_id', 'vendor', 'display_name', 'mode', 'non_secret_config',
           'secret_ref', 'enabled', 'created_at', 'updated_at'
         )) as column_count,
      (select count(*)::int from pg_constraint
       where conrelid = to_regclass('public.vendor_accounts') and conname in (
         'vendor_accounts_pkey', 'vendor_accounts_shop_fk',
         'vendor_accounts_vendor_slug_valid', 'vendor_accounts_display_name_valid',
         'vendor_accounts_mode_valid', 'vendor_accounts_non_secret_config_object',
         'vendor_accounts_non_secret_config_size', 'vendor_accounts_secret_ref_valid',
         'vendor_accounts_mode_secret_ref_valid'
       )) as constraint_count,
      (select count(*)::int from pg_indexes
       where schemaname = 'public' and indexname in (
         'vendor_accounts_shop_id_id_uq', 'vendor_accounts_shop_enabled_vendor_idx'
       )) as index_count,
      coalesce((select relrowsecurity from pg_class
        where oid = to_regclass('public.vendor_accounts')), false) as rls_enabled,
      (select count(*)::int from pg_policies
       where schemaname = 'public' and tablename = 'vendor_accounts'
         and policyname = 'vendor_accounts_server_only_deny_direct'
         and roles::text = '{anon,authenticated}'
         and cmd = 'ALL' and qual = 'false' and with_check = 'false') as policy_count,
      (select count(*)::int from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'vendor_accounts'
         and grantee in ('anon', 'authenticated')) as direct_grant_count,
      (select count(*)::int from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'vendor_accounts'
         and grantee = 'service_role') as service_grant_count,
      exists(select 1 from pg_constraint
       where conname = 'job_lines_shop_vendor_account_fk'
         and conrelid = 'public.job_lines'::regclass
         and confrelid = to_regclass('public.vendor_accounts')
         and pg_get_constraintdef(oid) like
           'FOREIGN KEY (shop_id, vendor_account_id) REFERENCES vendor_accounts(shop_id, id) ON DELETE RESTRICT%'
      ) as job_line_fk_exists
  `)
  const markers = result.rows[0]
  if (!markers) throw new Error('vendor accounts schema inspection failed')
  return markers
}

export async function ensureVendorAccountsMigration(client: PGlite): Promise<void> {
  const before = await vendorAccountsMarkers(client)
  const anyMarker = before.table_exists
    || before.column_count > 0
    || before.constraint_count > 0
    || before.index_count > 0
    || before.rls_enabled
    || before.policy_count > 0
    || before.direct_grant_count > 0
    || before.service_grant_count > 0
    || before.job_line_fk_exists
  const isComplete = before.table_exists
    && before.column_count === 10
    && before.constraint_count === 9
    && before.index_count === 2
    && before.rls_enabled
    && before.policy_count === 1
    && before.direct_grant_count === 0
    && before.service_grant_count === 4
    && before.job_line_fk_exists

  if (isComplete) return
  if (anyMarker) throw new Error('partial vendor accounts schema in ephemeral database')

  const migration = await readFile(
    path.join(process.cwd(), 'drizzle/migrations/0030_shop_os_vendor_accounts.sql'),
    'utf8',
  )
  await client.exec(migration.replaceAll('--> statement-breakpoint', ''))

  const after = await vendorAccountsMarkers(client)
  const applied = after.table_exists
    && after.column_count === 10
    && after.constraint_count === 9
    && after.index_count === 2
    && after.rls_enabled
    && after.policy_count === 1
    && after.direct_grant_count === 0
    && after.service_grant_count === 4
    && after.job_line_fk_exists
  if (!applied) throw new Error('partial vendor accounts schema in ephemeral database')
}

async function quoteTriggerSearchPaths(client: PGlite) {
  const result = await client.query<{
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
  return result.rows
}

export async function ensureQuoteTriggerSearchPathMigration(client: PGlite): Promise<void> {
  const before = await quoteTriggerSearchPaths(client)
  if (before.length !== 2) {
    throw new Error('quote trigger functions missing in ephemeral database')
  }
  if (before.every(({ proconfig }) => proconfig?.includes('search_path=""'))) return

  const migration = await readFile(
    path.join(process.cwd(), 'drizzle/migrations/0031_shop_os_quote_trigger_search_path.sql'),
    'utf8',
  )
  await client.exec(migration.replaceAll('--> statement-breakpoint', ''))

  const after = await quoteTriggerSearchPaths(client)
  if (after.length !== 2 || after.some(({ proconfig }) => !proconfig?.includes('search_path=""'))) {
    throw new Error(`quote trigger search path hardening failed in ephemeral database: ${JSON.stringify(after)}`)
  }
}

const SHOP_OS_SERVER_ONLY_TABLES = [
  'tickets',
  'ticket_jobs',
  'job_attachments',
  'job_lines',
  'canned_jobs',
  'quote_versions',
  'quote_events',
  'vendor_accounts',
] as const

type ShopOsServerOnlyAclMarkers = {
  table_count: number
  direct_client_grant_count: number
  effective_client_privilege_count: number
  service_crud_count: number
}

async function shopOsServerOnlyAclMarkers(
  client: PGlite,
): Promise<ShopOsServerOnlyAclMarkers> {
  const expectedTables = SHOP_OS_SERVER_ONLY_TABLES
    .map((table) => `('${table}')`)
    .join(', ')
  const result = await client.query<ShopOsServerOnlyAclMarkers>(`
    with
      expected_tables(table_name) as (values ${expectedTables}),
      client_roles(role_name) as (values ('anon'), ('authenticated')),
      table_privileges(privilege_name) as (
        values
          ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
          ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
      )
    select
      (select count(*)::int
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       join expected_tables e on e.table_name = c.relname
       where n.nspname = 'public' and c.relkind in ('r', 'p')) as table_count,
      (select count(*)::int
       from information_schema.role_table_grants g
       join expected_tables e on e.table_name = g.table_name
       where g.table_schema = 'public'
         and g.grantee in ('anon', 'authenticated')) as direct_client_grant_count,
      (select count(*)::int
       from expected_tables e
       join pg_class c on c.relname = e.table_name
       join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
       cross join client_roles r
       cross join table_privileges p
       where has_table_privilege(r.role_name, c.oid, p.privilege_name)
      ) as effective_client_privilege_count,
      (select count(*)::int
       from information_schema.role_table_grants g
       join expected_tables e on e.table_name = g.table_name
       where g.table_schema = 'public'
         and g.grantee = 'service_role'
         and g.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')) as service_crud_count
  `)
  const markers = result.rows[0]
  if (!markers) throw new Error('Shop OS server-only ACL inspection failed')
  return markers
}

function hasCompleteShopOsServerOnlyAcl(
  markers: ShopOsServerOnlyAclMarkers,
): boolean {
  return markers.table_count === SHOP_OS_SERVER_ONLY_TABLES.length
    && markers.direct_client_grant_count === 0
    && markers.effective_client_privilege_count === 0
    && markers.service_crud_count === SHOP_OS_SERVER_ONLY_TABLES.length * 4
}

export async function ensureShopOsServerOnlyAclMigration(client: PGlite): Promise<void> {
  const before = await shopOsServerOnlyAclMarkers(client)
  if (
    before.table_count !== SHOP_OS_SERVER_ONLY_TABLES.length
    || before.service_crud_count !== SHOP_OS_SERVER_ONLY_TABLES.length * 4
  ) {
    throw new Error('partial Shop OS server-only ACL in ephemeral database')
  }
  if (hasCompleteShopOsServerOnlyAcl(before)) return

  const migration = await readFile(
    path.join(process.cwd(), 'drizzle/migrations/0032_shop_os_server_only_acl.sql'),
    'utf8',
  )
  await client.exec(migration.replaceAll('--> statement-breakpoint', ''))

  const after = await shopOsServerOnlyAclMarkers(client)
  if (!hasCompleteShopOsServerOnlyAcl(after)) {
    throw new Error('Shop OS server-only ACL hardening failed in ephemeral database')
  }
}
