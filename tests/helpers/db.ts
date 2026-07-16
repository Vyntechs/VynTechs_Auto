import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import * as schema from '@/lib/db/schema'

export type TestDb = PgliteDatabase<typeof schema>

export function createTestDbClient(client: PGlite): TestDb {
  return drizzle(client, { schema })
}

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
  const db = createTestDbClient(client)
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
  await ensureMessagingRetentionMigration(client)
  await ensureMessagingRetentionAclMigration(client)
  await ensureMessagingRetentionFkIndexMigration(client)
  await ensureShopEntitlementsMigration(client)
  await ensureRepairOrderContinuityMigration(client)
  return {
    db,
    client,
    close: async () => {
      await client.close()
    },
  }
}

type RepairOrderContinuityMarkers = {
  table_count: number
  column_count: number
  constraint_count: number
  index_count: number
  function_count: number
  trigger_count: number
  rls_count: number
  policy_count: number
  effective_client_privilege_count: number
  service_allowed_privilege_count: number
  service_unexpected_privilege_count: number
  function_authority_count: number
  column_digest: string
  constraint_digest: string
  index_digest: string
  function_digest: string
  trigger_digest: string
  policy_digest: string
}

const REPAIR_ORDER_CONTINUITY_DIGESTS = {
  columns: 'a7a4175a8645a531b85d2eb16d9153e333f157d960d4af3ddd42ee3fcbdbbbd5',
  constraints: 'b06169130a7f030683ae7678dc88100340e924f34eb9e8c19ec1837674619f93',
  indexes: '2a895ef2f000ab463f0418c0b763ca727cf2fa3834297414968283c46e1cfff3',
  functions: '53d63957fe6f5a4a2aad953e925ab7d3436c1e5d8ffe9f5c79944d0e56630e5f',
  triggers: '0b42b76cd9ddd336440a32f1ed6695c2a6570628e17de0265b6454f33970b48f',
  policies: '3add8c2ff62f3004649dcd4cb44fd78a9ec1af8b89f4707c3198c87781cef877',
} as const

function contractDigest(value: string | null): string {
  return createHash('sha256').update(value ?? '').digest('hex')
}

async function repairOrderContinuityMarkers(
  client: PGlite,
): Promise<RepairOrderContinuityMarkers> {
  const result = await client.query<{
    table_count: number
    column_count: number
    constraint_count: number
    index_count: number
    function_count: number
    trigger_count: number
    rls_count: number
    policy_count: number
    effective_client_privilege_count: number
    service_allowed_privilege_count: number
    service_unexpected_privilege_count: number
    column_contracts: string | null
    constraint_contracts: string | null
    index_contracts: string | null
    function_contracts: string | null
    trigger_contracts: string | null
    policy_contracts: string | null
  }>(`
    with expected_tables(table_name) as (values
      ('ticket_mutation_receipts'),
      ('ticket_mutation_receipt_jobs')
    ), expected_columns(table_name, column_name) as (values
      ('tickets', 'projection_revision'),
      ('tickets', 'continuity_revision'),
      ('tickets', 'separate_from_ticket_id'),
      ('tickets', 'separate_reason'),
      ('tickets', 'separate_reason_note'),
      ('tickets', 'close_disposition'),
      ('tickets', 'close_note'),
      ('tickets', 'cancel_reason_code'),
      ('ticket_jobs', 'sequence_number'),
      ('ticket_jobs', 'work_statement'),
      ('ticket_jobs', 'statement_source'),
      ('ticket_jobs', 'statement_review_state'),
      ('ticket_jobs', 'statement_confirmed_by_profile_id'),
      ('ticket_jobs', 'statement_confirmed_at'),
      ('ticket_jobs', 'when_started'),
      ('ticket_jobs', 'how_often'),
      ('ticket_jobs', 'diagnostic_authorized_cents'),
      ('ticket_jobs', 'diagnostic_authorization_note'),
      ('ticket_jobs', 'created_by_profile_id'),
      ('ticket_jobs', 'creator_provenance'),
      ('ticket_jobs', 'created_from_job_id'),
      ('ticket_jobs', 'revision'),
      ('ticket_jobs', 'approved_authorization_fingerprint'),
      ('ticket_jobs', 'approved_approval_event_id'),
      ('ticket_mutation_receipts', 'id'),
      ('ticket_mutation_receipts', 'shop_id'),
      ('ticket_mutation_receipts', 'request_key'),
      ('ticket_mutation_receipts', 'mutation_schema_version'),
      ('ticket_mutation_receipts', 'fingerprint_key_version'),
      ('ticket_mutation_receipts', 'mutation_kind'),
      ('ticket_mutation_receipts', 'actor_profile_id'),
      ('ticket_mutation_receipts', 'target_ticket_id'),
      ('ticket_mutation_receipts', 'target_binding_fingerprint'),
      ('ticket_mutation_receipts', 'request_fingerprint'),
      ('ticket_mutation_receipts', 'result_ticket_id'),
      ('ticket_mutation_receipts', 'result_job_count'),
      ('ticket_mutation_receipts', 'created_at'),
      ('ticket_mutation_receipt_jobs', 'shop_id'),
      ('ticket_mutation_receipt_jobs', 'receipt_id'),
      ('ticket_mutation_receipt_jobs', 'result_ticket_id'),
      ('ticket_mutation_receipt_jobs', 'result_job_count'),
      ('ticket_mutation_receipt_jobs', 'ordinal'),
      ('ticket_mutation_receipt_jobs', 'job_id')
    ), expected_constraints(table_name, constraint_name) as (values
      ('tickets', 'tickets_projection_revision_nonnegative'),
      ('tickets', 'tickets_continuity_revision_nonnegative'),
      ('tickets', 'tickets_separate_reason_valid'),
      ('tickets', 'tickets_separate_evidence_consistent'),
      ('tickets', 'tickets_separate_from_not_self'),
      ('tickets', 'tickets_close_disposition_valid'),
      ('tickets', 'tickets_cancel_reason_code_valid'),
      ('tickets', 'tickets_canceled_reason_bounded'),
      ('tickets', 'tickets_close_note_bounded'),
      ('tickets', 'tickets_shop_separate_from_fk'),
      ('ticket_jobs', 'ticket_jobs_sequence_positive'),
      ('ticket_jobs', 'ticket_jobs_work_statement_bounded'),
      ('ticket_jobs', 'ticket_jobs_statement_source_valid'),
      ('ticket_jobs', 'ticket_jobs_statement_review_state_valid'),
      ('ticket_jobs', 'ticket_jobs_statement_truth_consistent'),
      ('ticket_jobs', 'ticket_jobs_statement_confirmation_consistent'),
      ('ticket_jobs', 'ticket_jobs_context_bounded'),
      ('ticket_jobs', 'ticket_jobs_diagnostic_authorization_consistent'),
      ('ticket_jobs', 'ticket_jobs_creator_provenance_consistent'),
      ('ticket_jobs', 'ticket_jobs_approved_fingerprint_valid'),
      ('ticket_jobs', 'ticket_jobs_revision_nonnegative'),
      ('ticket_jobs', 'ticket_jobs_shop_creator_fk'),
      ('ticket_jobs', 'ticket_jobs_shop_confirmer_fk'),
      ('ticket_jobs', 'ticket_jobs_shop_ticket_created_from_fk'),
      ('ticket_jobs', 'ticket_jobs_approved_approval_event_fk'),
      ('ticket_mutation_receipts', 'ticket_mutation_receipts_pkey'),
      ('ticket_mutation_receipts', 'ticket_mutation_receipts_shop_actor_fk'),
      ('ticket_mutation_receipts', 'ticket_mutation_receipts_shop_target_ticket_fk'),
      ('ticket_mutation_receipts', 'ticket_mutation_receipts_shop_result_ticket_fk'),
      ('ticket_mutation_receipts', 'ticket_mutation_receipts_schema_version_v1'),
      ('ticket_mutation_receipts', 'ticket_mutation_receipts_key_version_positive'),
      ('ticket_mutation_receipts', 'ticket_mutation_receipts_kind_valid'),
      ('ticket_mutation_receipts', 'ticket_mutation_receipts_target_fingerprint_valid'),
      ('ticket_mutation_receipts', 'ticket_mutation_receipts_request_fingerprint_valid'),
      ('ticket_mutation_receipts', 'ticket_mutation_receipts_result_count_valid'),
      ('ticket_mutation_receipt_jobs', 'ticket_mutation_receipt_jobs_pk'),
      ('ticket_mutation_receipt_jobs', 'ticket_mutation_receipt_jobs_receipt_ticket_fk'),
      ('ticket_mutation_receipt_jobs', 'ticket_mutation_receipt_jobs_job_fk'),
      ('ticket_mutation_receipt_jobs', 'ticket_mutation_receipt_jobs_ordinal_range')
    ), expected_indexes(table_name, index_name) as (values
      ('tickets', 'tickets_shop_vehicle_status_idx'),
      ('tickets', 'tickets_shop_separate_from_idx'),
      ('ticket_jobs', 'ticket_jobs_shop_ticket_sequence_uq'),
      ('ticket_jobs', 'ticket_jobs_shop_created_by_idx'),
      ('ticket_jobs', 'ticket_jobs_shop_confirmed_by_idx'),
      ('ticket_jobs', 'ticket_jobs_shop_ticket_created_from_idx'),
      ('ticket_jobs', 'ticket_jobs_shop_ticket_approval_event_idx'),
      ('quote_events', 'quote_events_shop_ticket_job_id_uq'),
      ('ticket_mutation_receipts', 'ticket_mutation_receipts_shop_request_key_uq'),
      ('ticket_mutation_receipts', 'ticket_mutation_receipts_shop_id_uq'),
      ('ticket_mutation_receipts', 'ticket_mutation_receipts_shop_id_result_ticket_count_uq'),
      ('ticket_mutation_receipts', 'ticket_mutation_receipts_shop_result_created_idx'),
      ('ticket_mutation_receipts', 'ticket_mutation_receipts_shop_target_idx'),
      ('ticket_mutation_receipts', 'ticket_mutation_receipts_shop_actor_created_idx'),
      ('ticket_mutation_receipt_jobs', 'ticket_mutation_receipt_jobs_shop_receipt_job_uq'),
      ('ticket_mutation_receipt_jobs', 'ticket_mutation_receipt_jobs_shop_job_idx'),
      ('ticket_mutation_receipt_jobs', 'ticket_mutation_receipt_jobs_header_idx')
    ), expected_functions(function_name) as (values
      ('guard_ticket_terminal_shape'),
      ('guard_ticket_immutable_identity'),
      ('guard_ticket_job_immutable_identity'),
      ('reject_ticket_mutation_receipt_mutation'),
      ('enforce_ticket_mutation_receipt_complete')
    ), expected_triggers(table_name, trigger_name, function_name) as (values
      ('tickets', 'tickets_terminal_shape_write', 'guard_ticket_terminal_shape'),
      ('tickets', 'tickets_immutable_identity_update', 'guard_ticket_immutable_identity'),
      ('ticket_jobs', 'ticket_jobs_immutable_identity_update', 'guard_ticket_job_immutable_identity'),
      ('ticket_mutation_receipts', 'ticket_mutation_receipts_immutable_write', 'reject_ticket_mutation_receipt_mutation'),
      ('ticket_mutation_receipt_jobs', 'ticket_mutation_receipt_jobs_immutable_write', 'reject_ticket_mutation_receipt_mutation'),
      ('ticket_mutation_receipts', 'ticket_mutation_receipts_complete_deferred', 'enforce_ticket_mutation_receipt_complete'),
      ('ticket_mutation_receipt_jobs', 'ticket_mutation_receipt_jobs_complete_deferred', 'enforce_ticket_mutation_receipt_complete')
    ), client_roles(role_name) as (values ('anon'), ('authenticated')),
    table_privileges(privilege_name) as (values
      ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
      ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')
    ), service_allowed(privilege_name) as (values ('SELECT'), ('INSERT')),
    service_unexpected(privilege_name) as (values
      ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')
    )
    select
      (select count(*)::int
       from expected_tables e
       join pg_class c on c.relname = e.table_name
       join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
       where c.relkind in ('r', 'p')) as table_count,
      (select count(*)::int
       from expected_columns e
       join information_schema.columns c using (table_name, column_name)
       where c.table_schema = 'public') as column_count,
      (select count(*)::int
       from expected_constraints e
       join pg_constraint c on c.conname = e.constraint_name
       where c.conrelid = to_regclass('public.' || e.table_name)) as constraint_count,
      (select count(*)::int
       from expected_indexes e
       join pg_indexes i on i.schemaname = 'public'
         and i.tablename = e.table_name and i.indexname = e.index_name) as index_count,
      (select count(*)::int
       from expected_functions e
       join pg_proc p on p.proname = e.function_name
       join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
       where p.pronargs = 0) as function_count,
      (select count(*)::int
       from expected_triggers e
       join pg_trigger t on t.tgname = e.trigger_name
         and t.tgrelid = to_regclass('public.' || e.table_name)
       join pg_proc p on p.oid = t.tgfoid and p.proname = e.function_name
       where not t.tgisinternal) as trigger_count,
      (select count(*)::int
       from expected_tables e
       join pg_class c on c.relname = e.table_name
       join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
       where c.relrowsecurity) as rls_count,
      (select count(*)::int
       from expected_tables e
       join pg_policies p on p.schemaname = 'public' and p.tablename = e.table_name
      ) as policy_count,
      (select count(*)::int
       from expected_tables e
       join pg_class c on c.relname = e.table_name
       join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
       cross join client_roles r
       cross join table_privileges p
       where has_table_privilege(
         r.role_name, c.oid, p.privilege_name
       )) as effective_client_privilege_count,
      (select count(*)::int
       from expected_tables e
       join pg_class c on c.relname = e.table_name
       join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
       cross join service_allowed p
       where has_table_privilege(
         'service_role', c.oid, p.privilege_name
       )) as service_allowed_privilege_count,
      (select count(*)::int
       from expected_tables e
       join pg_class c on c.relname = e.table_name
       join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
       cross join service_unexpected p
       where has_table_privilege(
         'service_role', c.oid, p.privilege_name
       )) as service_unexpected_privilege_count,
      (select string_agg(
         e.table_name || '.' || e.column_name || ':' || c.data_type || ':' || c.udt_name
           || ':' || c.is_nullable || ':' || coalesce(c.column_default, ''),
         E'\n' order by e.table_name, e.column_name
       )
       from expected_columns e
       join information_schema.columns c using (table_name, column_name)
       where c.table_schema = 'public') as column_contracts,
      (select string_agg(
         e.table_name || '.' || e.constraint_name || ':'
           || regexp_replace(pg_get_constraintdef(c.oid), '\\s+', ' ', 'g'),
         E'\n' order by e.table_name, e.constraint_name
       )
       from expected_constraints e
       join pg_constraint c on c.conname = e.constraint_name
       where c.conrelid = to_regclass('public.' || e.table_name)) as constraint_contracts,
      (select string_agg(
         e.table_name || '.' || e.index_name || ':'
           || regexp_replace(i.indexdef, '\\s+', ' ', 'g'),
         E'\n' order by e.table_name, e.index_name
       )
       from expected_indexes e
       join pg_indexes i on i.schemaname = 'public'
         and i.tablename = e.table_name and i.indexname = e.index_name) as index_contracts,
      (select string_agg(
         e.function_name || ':' || pg_get_userbyid(p.proowner) || ':'
           || p.prorettype::regtype::text || ':' || p.prosecdef::text || ':'
           || coalesce(array_to_string(p.proconfig, ','), '') || ':'
           || regexp_replace(btrim(p.prosrc), '\\s+', ' ', 'g'),
         E'\n' order by e.function_name
       )
       from expected_functions e
       join pg_proc p on p.proname = e.function_name
       join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
       where p.pronargs = 0) as function_contracts,
      (select string_agg(
         e.table_name || '.' || e.trigger_name || ':' || e.function_name || ':'
           || t.tgtype::text || ':' || t.tgattr::text || ':' || t.tgdeferrable::text
           || ':' || t.tginitdeferred::text || ':' || t.tgenabled::text || ':'
           || regexp_replace(pg_get_triggerdef(t.oid), '\\s+', ' ', 'g'),
         E'\n' order by e.table_name, e.trigger_name
       )
       from expected_triggers e
       join pg_trigger t on t.tgname = e.trigger_name
         and t.tgrelid = to_regclass('public.' || e.table_name)
       join pg_proc p on p.oid = t.tgfoid and p.proname = e.function_name
       where not t.tgisinternal) as trigger_contracts,
      (select string_agg(
         e.table_name || ':' || p.policyname || ':' || p.roles::text || ':'
           || p.cmd || ':' || coalesce(p.qual, '') || ':' || coalesce(p.with_check, ''),
         E'\n' order by e.table_name
       )
       from expected_tables e
       join pg_policies p on p.schemaname = 'public' and p.tablename = e.table_name
      ) as policy_contracts
  `)
  const markers = result.rows[0]
  if (!markers) throw new Error('repair order continuity schema inspection failed')

  const authority = await client.query<{
    authority_count: number
  }>(`
    with expected_functions(function_name) as (values
      ('guard_ticket_terminal_shape'),
      ('guard_ticket_immutable_identity'),
      ('guard_ticket_job_immutable_identity'),
      ('reject_ticket_mutation_receipt_mutation'),
      ('enforce_ticket_mutation_receipt_complete')
    )
    select count(*)::int as authority_count
    from expected_functions e
    join pg_proc p on p.proname = e.function_name and p.pronargs = 0
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
    join pg_roles owner_role on owner_role.oid = p.proowner
    where owner_role.rolname = 'postgres'
      and owner_role.rolsuper
      and not pg_has_role('service_role', owner_role.oid, 'usage')
      and not pg_has_role('anon', owner_role.oid, 'usage')
      and not pg_has_role('authenticated', owner_role.oid, 'usage')
      and not has_function_privilege('service_role', p.oid, 'execute')
      and not has_function_privilege('anon', p.oid, 'execute')
      and not has_function_privilege('authenticated', p.oid, 'execute')
      and not exists (
        select 1
        from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
        where acl.privilege_type = 'EXECUTE' and acl.grantee <> p.proowner
      )
  `)

  return {
    table_count: markers.table_count,
    column_count: markers.column_count,
    constraint_count: markers.constraint_count,
    index_count: markers.index_count,
    function_count: markers.function_count,
    trigger_count: markers.trigger_count,
    rls_count: markers.rls_count,
    policy_count: markers.policy_count,
    effective_client_privilege_count: markers.effective_client_privilege_count,
    service_allowed_privilege_count: markers.service_allowed_privilege_count,
    service_unexpected_privilege_count: markers.service_unexpected_privilege_count,
    function_authority_count: authority.rows[0]?.authority_count ?? 0,
    column_digest: contractDigest(markers.column_contracts),
    constraint_digest: contractDigest(markers.constraint_contracts),
    index_digest: contractDigest(markers.index_contracts),
    function_digest: contractDigest(markers.function_contracts),
    trigger_digest: contractDigest(markers.trigger_contracts),
    policy_digest: contractDigest(markers.policy_contracts),
  }
}

function hasCompleteRepairOrderContinuity(
  markers: RepairOrderContinuityMarkers,
): boolean {
  return markers.table_count === 2
    && markers.column_count === 43
    && markers.constraint_count === 39
    && markers.index_count === 17
    && markers.function_count === 5
    && markers.trigger_count === 7
    && markers.rls_count === 2
    && markers.policy_count === 2
    && markers.effective_client_privilege_count === 0
    && markers.service_allowed_privilege_count === 4
    && markers.service_unexpected_privilege_count === 0
    && markers.function_authority_count === 5
    && markers.column_digest === REPAIR_ORDER_CONTINUITY_DIGESTS.columns
    && markers.constraint_digest === REPAIR_ORDER_CONTINUITY_DIGESTS.constraints
    && markers.index_digest === REPAIR_ORDER_CONTINUITY_DIGESTS.indexes
    && markers.function_digest === REPAIR_ORDER_CONTINUITY_DIGESTS.functions
    && markers.trigger_digest === REPAIR_ORDER_CONTINUITY_DIGESTS.triggers
    && markers.policy_digest === REPAIR_ORDER_CONTINUITY_DIGESTS.policies
}

function hasAnyRepairOrderContinuityMarker(
  markers: RepairOrderContinuityMarkers,
): boolean {
  return markers.table_count > 0
    || markers.column_count > 0
    || markers.constraint_count > 0
    || markers.index_count > 0
    || markers.function_count > 0
    || markers.trigger_count > 0
    || markers.rls_count > 0
    || markers.policy_count > 0
    || markers.service_allowed_privilege_count > 0
}

export async function ensureRepairOrderContinuityMigration(
  client: PGlite,
): Promise<void> {
  const before = await repairOrderContinuityMarkers(client)
  if (hasCompleteRepairOrderContinuity(before)) return
  if (hasAnyRepairOrderContinuityMarker(before)) {
    throw new Error('partial repair order continuity schema in ephemeral database')
  }

  const migration = await readFile(
    path.join(process.cwd(), 'drizzle/migrations/0037_shop_os_continuity_foundation.sql'),
    'utf8',
  )
  await client.exec(migration.replaceAll('--> statement-breakpoint', ''))

  const after = await repairOrderContinuityMarkers(client)
  if (!hasCompleteRepairOrderContinuity(after)) {
    throw new Error('partial repair order continuity schema in ephemeral database')
  }
}

type ShopEntitlementsMarkers = {
  table_exists: boolean
  column_count: number
  pk_fk_count: number
  rls_enabled: boolean
  policy_count: number
  direct_client_grant_count: number
  service_crud_count: number
}

async function shopEntitlementsMarkers(client: PGlite): Promise<ShopEntitlementsMarkers> {
  const result = await client.query<ShopEntitlementsMarkers>(`
    select
      to_regclass('public.shop_entitlements') is not null as table_exists,
      (select count(*)::int from information_schema.columns
       where table_schema = 'public' and table_name = 'shop_entitlements'
         and column_name in (
           'shop_id', 'diagnostics', 'stripe_price_id', 'created_at', 'updated_at'
         )) as column_count,
      (select count(*)::int from pg_constraint
       where conrelid = to_regclass('public.shop_entitlements')
         and contype in ('p', 'f')) as pk_fk_count,
      coalesce((select relrowsecurity from pg_class
        where oid = to_regclass('public.shop_entitlements')), false) as rls_enabled,
      (select count(*)::int from pg_policies
       where schemaname = 'public' and tablename = 'shop_entitlements'
         and policyname = 'shop_entitlements_server_only_deny_direct'
         and roles::text = '{anon,authenticated}'
         and cmd = 'ALL' and qual = 'false' and with_check = 'false') as policy_count,
      (select count(*)::int from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'shop_entitlements'
         and grantee in ('anon', 'authenticated')) as direct_client_grant_count,
      (select count(*)::int from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'shop_entitlements'
         and grantee = 'service_role'
         and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')) as service_crud_count
  `)
  const markers = result.rows[0]
  if (!markers) throw new Error('shop entitlements schema inspection failed')
  return markers
}

function hasCompleteShopEntitlements(markers: ShopEntitlementsMarkers): boolean {
  return markers.table_exists
    && markers.column_count === 5
    && markers.pk_fk_count === 2
    && markers.rls_enabled
    && markers.policy_count === 1
    && markers.direct_client_grant_count === 0
    && markers.service_crud_count === 4
}

export async function ensureShopEntitlementsMigration(client: PGlite): Promise<void> {
  const before = await shopEntitlementsMarkers(client)
  if (hasCompleteShopEntitlements(before)) return
  if (before.table_exists) {
    throw new Error('partial shop entitlements schema in ephemeral database')
  }

  const migration = await readFile(
    path.join(process.cwd(), 'drizzle/migrations/0036_shop_entitlements.sql'),
    'utf8',
  )
  await client.exec(migration.replaceAll('--> statement-breakpoint', ''))

  const after = await shopEntitlementsMarkers(client)
  if (!hasCompleteShopEntitlements(after)) {
    throw new Error('shop entitlements schema hardening failed in ephemeral database')
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
          ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')
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

type MessagingRetentionMarkers = {
  table_count: number
  column_count: number
  constraint_count: number
  index_count: number
  active_resource_index_count: number
  rls_count: number
  policy_count: number
  function_marker_count: number
  function_digest_count: number
  function_authority_count: number
  trigger_binding_count: number
  nullable_quote_send_customer_count: number
  direct_client_grant_count: number
  effective_client_privilege_count: number
  service_crud_count: number
}

const MESSAGING_RETENTION_FUNCTION_DIGESTS = {
  'validate_quote_event_send_reference()': 'be3c718f2e44f7a71c4c0f3366de84a1ed3d949048df400a99501dbc5690191b',
  'guard_quote_send_lifecycle()': '7abe807df38550897a3627113b9d778a7abda964042f5b7c7a5e3c62917ac34d',
  'serialize_messaging_retention_hold_target()': 'c324faa9988827a2e66824118c1b5ea4481ffd5321eb9582a556eca374e0e82e',
  'reject_messaging_consent_event_mutation()': '3e6750e1e10eb90b7bd6343ae4709aa7aa6cd5cbba3a3c70ba3d523119ac4a21',
  'require_messaging_compaction_completion()': 'af771807e893482a0ae55236cc7118ea9b95ab0d28737948aff318693508b20e',
  'compact_messaging_consent_work_items(uuid,uuid,uuid[])': '2a3c12eebb6c6ef10da88114a51f2a402b68e3e5345dee05507beeb93580447b',
  'finalize_messaging_deletion_request(uuid,uuid)': '0177717f2f30d4f3a1a6203eeb59295e6d070a69442f8ee89dbcb2ae59268638',
  'purge_expired_messaging_consent_event(uuid,uuid)': '33f378ecff1afb6dc5f34263a92063433e8dcf5a5ccf79481430ac2749951948',
  'purge_expired_messaging_retention_hold(uuid,uuid)': '99f9749e6bb58f8c394733314f2c7d8b8143d16fde0ba72eb97855187ea86e65',
  'guard_messaging_deletion_request_mutation()': '56e59cec5b96c75d5c3185c99acc701b9676c04c4eb202b72ed76018191cadcf',
  'guard_messaging_deletion_work_item_mutation()': '7fa255e7e301e8119d43630276d796c55cc4c2b8800ce2ce1da60b950e50f6ce',
  'purge_expired_messaging_deletion_request(uuid,uuid)': '8b4aae451704d22bbd987724e442241914506384f92d8ef1db0536afd8d5002a',
} as const

async function messagingRetentionFunctionInspection(client: PGlite): Promise<{
  digestCount: number
  authorityCount: number
}> {
  const result = await client.query<{
    signature: keyof typeof MESSAGING_RETENTION_FUNCTION_DIGESTS
    prosrc: string
    owner_exact: boolean
    owner_superuser: boolean
    client_inherits_owner: boolean
    unexpected_direct_acl_count: number
    unexpected_effective_executor_count: number
  }>(`
    with expected_functions(signature, service_execute) as (values
      ('validate_quote_event_send_reference()', false),
      ('guard_quote_send_lifecycle()', false),
      ('reject_messaging_consent_event_mutation()', false),
      ('require_messaging_compaction_completion()', false),
      ('compact_messaging_consent_work_items(uuid,uuid,uuid[])', true),
      ('finalize_messaging_deletion_request(uuid,uuid)', true),
      ('guard_messaging_deletion_work_item_mutation()', false),
      ('guard_messaging_deletion_request_mutation()', false),
      ('purge_expired_messaging_deletion_request(uuid,uuid)', true),
      ('purge_expired_messaging_consent_event(uuid,uuid)', true),
      ('purge_expired_messaging_retention_hold(uuid,uuid)', true),
      ('serialize_messaging_retention_hold_target()', false)
    )
    select e.signature, p.prosrc,
      owner_role.rolname = 'postgres' as owner_exact,
      owner_role.rolsuper as owner_superuser,
      pg_has_role('service_role', owner_role.oid, 'usage')
        or pg_has_role('anon', owner_role.oid, 'usage')
        or pg_has_role('authenticated', owner_role.oid, 'usage') as client_inherits_owner,
      (select count(*)::int
       from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
       where acl.privilege_type = 'EXECUTE'
         and acl.grantee <> p.proowner
         and not (e.service_execute and acl.grantee = 'service_role'::regrole))
        as unexpected_direct_acl_count,
      (select count(*)::int
       from pg_roles executor
       where not executor.rolsuper
         and executor.oid <> p.proowner
         and not (e.service_execute and executor.rolname = 'service_role')
         and has_function_privilege(executor.oid, p.oid, 'execute'))
        as unexpected_effective_executor_count
    from expected_functions e
    join pg_proc p on p.oid = to_regprocedure('public.' || e.signature)
    join pg_roles owner_role on owner_role.oid = p.proowner
  `)
  const digestCount = result.rows.filter(({ signature, prosrc }) => {
    const normalized = prosrc.trim().replace(/\s+/g, ' ')
    return createHash('sha256').update(normalized).digest('hex')
      === MESSAGING_RETENTION_FUNCTION_DIGESTS[signature]
  }).length
  const authorityCount = result.rows.filter((row) => row.owner_exact
    && row.owner_superuser
    && !row.client_inherits_owner
    && row.unexpected_direct_acl_count === 0
    && row.unexpected_effective_executor_count === 0).length
  return { digestCount, authorityCount }
}

async function messagingRetentionMarkers(
  client: PGlite,
): Promise<MessagingRetentionMarkers> {
  const result = await client.query<MessagingRetentionMarkers>(`
    with expected_tables(table_name) as (values
      ('messaging_consent_events'),
      ('messaging_consent_state'),
      ('sms_suppressions'),
      ('messaging_deletion_requests'),
      ('messaging_deletion_work_items'),
      ('messaging_retention_holds'),
      ('quote_sends'),
      ('sms_log'),
      ('notifications')
    ), expected_columns(table_name, column_name) as (values
      ('messaging_consent_events', 'id'), ('messaging_consent_events', 'shop_id'),
      ('messaging_consent_events', 'subject_key'), ('messaging_consent_events', 'customer_id'),
      ('messaging_consent_events', 'destination_fingerprint'), ('messaging_consent_events', 'fingerprint_key_version'),
      ('messaging_consent_events', 'program_version'), ('messaging_consent_events', 'event_type'),
      ('messaging_consent_events', 'committed_at'), ('messaging_consent_events', 'occurred_at'),
      ('messaging_consent_events', 'capture_method'), ('messaging_consent_events', 'customer_controlled'),
      ('messaging_consent_events', 'disclosure_snapshot'), ('messaging_consent_events', 'disclosure_hash'),
      ('messaging_consent_events', 'evidence_kind'), ('messaging_consent_events', 'evidence_ref'),
      ('messaging_consent_events', 'actor_profile_id'), ('messaging_consent_events', 'request_key'),
      ('messaging_consent_events', 'request_fingerprint'), ('messaging_consent_events', 'retain_until'),
      ('messaging_consent_state', 'id'), ('messaging_consent_state', 'shop_id'),
      ('messaging_consent_state', 'subject_key'), ('messaging_consent_state', 'customer_id'),
      ('messaging_consent_state', 'destination_fingerprint'), ('messaging_consent_state', 'fingerprint_key_version'),
      ('messaging_consent_state', 'program_version'), ('messaging_consent_state', 'status'),
      ('messaging_consent_state', 'source_event_id'), ('messaging_consent_state', 'consented_at'),
      ('messaging_consent_state', 'revoked_at'), ('messaging_consent_state', 'retain_until'),
      ('messaging_consent_state', 'updated_at'),
      ('sms_suppressions', 'id'), ('sms_suppressions', 'shop_id'),
      ('sms_suppressions', 'destination_fingerprint'), ('sms_suppressions', 'fingerprint_key_version'),
      ('sms_suppressions', 'source_event_id'), ('sms_suppressions', 'reason'),
      ('sms_suppressions', 'suppressed_at'), ('sms_suppressions', 'lifted_at'),
      ('sms_suppressions', 'retain_until'), ('sms_suppressions', 'updated_at'),
      ('messaging_deletion_requests', 'id'), ('messaging_deletion_requests', 'request_key'),
      ('messaging_deletion_requests', 'request_fingerprint'), ('messaging_deletion_requests', 'shop_id'),
      ('messaging_deletion_requests', 'subject_key'), ('messaging_deletion_requests', 'customer_id'),
      ('messaging_deletion_requests', 'destination_fingerprint'), ('messaging_deletion_requests', 'fingerprint_key_version'),
      ('messaging_deletion_requests', 'state'), ('messaging_deletion_requests', 'reason_code'),
      ('messaging_deletion_requests', 'requesting_actor_profile_id'), ('messaging_deletion_requests', 'requested_at'),
      ('messaging_deletion_requests', 'completed_at'), ('messaging_deletion_requests', 'latest_relevant_at'),
      ('messaging_deletion_requests', 'prior_record_counts'),
      ('messaging_deletion_requests', 'proof_summary'), ('messaging_deletion_requests', 'retain_until'),
      ('messaging_deletion_work_items', 'id'), ('messaging_deletion_work_items', 'shop_id'),
      ('messaging_deletion_work_items', 'request_id'), ('messaging_deletion_work_items', 'resource_type'),
      ('messaging_deletion_work_items', 'resource_id'), ('messaging_deletion_work_items', 'parent_work_item_id'),
      ('messaging_deletion_work_items', 'outcome'), ('messaging_deletion_work_items', 'retention_basis'),
      ('messaging_deletion_work_items', 'counts_toward_proof'),
      ('messaging_deletion_work_items', 'detached_suppression_sources'),
      ('messaging_deletion_work_items', 'discovered_at'), ('messaging_deletion_work_items', 'resolved_at'),
      ('messaging_retention_holds', 'id'), ('messaging_retention_holds', 'shop_id'),
      ('messaging_retention_holds', 'resource_type'), ('messaging_retention_holds', 'resource_id'),
      ('messaging_retention_holds', 'subject_key'), ('messaging_retention_holds', 'reason_code'),
      ('messaging_retention_holds', 'authorizing_actor_profile_id'), ('messaging_retention_holds', 'starts_at'),
      ('messaging_retention_holds', 'review_at'), ('messaging_retention_holds', 'expires_at'),
      ('messaging_retention_holds', 'released_at'), ('messaging_retention_holds', 'retain_until'),
      ('quote_sends', 'id'), ('quote_sends', 'shop_id'),
      ('quote_sends', 'ticket_id'), ('quote_sends', 'quote_version_id'),
      ('quote_sends', 'customer_id'), ('quote_sends', 'subject_key'),
      ('quote_sends', 'destination_fingerprint'),
      ('quote_sends', 'fingerprint_key_version'), ('quote_sends', 'channel'),
      ('quote_sends', 'token_hash'), ('quote_sends', 'token_expires_at'),
      ('quote_sends', 'requesting_actor_profile_id'), ('quote_sends', 'request_key'),
      ('quote_sends', 'request_fingerprint'), ('quote_sends', 'state'),
      ('quote_sends', 'submitting_at'), ('quote_sends', 'submitted_at'),
      ('quote_sends', 'terminal_at'), ('quote_sends', 'retain_until'),
      ('quote_sends', 'created_at'), ('quote_sends', 'updated_at'),
      ('sms_log', 'id'), ('sms_log', 'shop_id'),
      ('sms_log', 'quote_send_id'), ('sms_log', 'provider_message_id'),
      ('sms_log', 'provider_event_id'), ('sms_log', 'template_key'),
      ('sms_log', 'template_version'), ('sms_log', 'state'),
      ('sms_log', 'error_code'), ('sms_log', 'provider_occurred_at'),
      ('sms_log', 'server_received_at'), ('sms_log', 'retain_until'),
      ('notifications', 'id'), ('notifications', 'shop_id'),
      ('notifications', 'recipient_profile_id'), ('notifications', 'event_type'),
      ('notifications', 'entity_type'), ('notifications', 'entity_id'),
      ('notifications', 'dedupe_key'), ('notifications', 'created_at'),
      ('notifications', 'read_at'), ('notifications', 'retain_until')
    ), expected_constraints(constraint_name) as (values
      ('messaging_consent_events_pkey'), ('messaging_consent_events_shop_fk'),
      ('messaging_consent_events_shop_customer_fk'), ('messaging_consent_events_shop_actor_fk'),
      ('messaging_consent_events_destination_fingerprint_valid'), ('messaging_consent_events_fingerprint_key_version_valid'),
      ('messaging_consent_events_program_version_valid'), ('messaging_consent_events_event_type_valid'),
      ('messaging_consent_events_capture_method_valid'), ('messaging_consent_events_disclosure_snapshot_object'),
      ('messaging_consent_events_disclosure_snapshot_size'), ('messaging_consent_events_disclosure_hash_valid'),
      ('messaging_consent_events_evidence_kind_valid'), ('messaging_consent_events_evidence_ref_valid'),
      ('messaging_consent_events_request_fingerprint_valid'),
      ('messaging_consent_state_pkey'), ('messaging_consent_state_shop_fk'),
      ('messaging_consent_state_shop_customer_fk'), ('messaging_consent_state_shop_source_event_fk'),
      ('messaging_consent_state_destination_fingerprint_valid'), ('messaging_consent_state_fingerprint_key_version_valid'),
      ('messaging_consent_state_program_version_valid'), ('messaging_consent_state_status_valid'),
      ('messaging_consent_state_timestamps_consistent'),
      ('sms_suppressions_pkey'), ('sms_suppressions_shop_fk'),
      ('sms_suppressions_shop_source_event_fk'), ('sms_suppressions_destination_fingerprint_valid'),
      ('sms_suppressions_fingerprint_key_version_valid'), ('sms_suppressions_reason_valid'),
      ('sms_suppressions_lifted_at_valid'),
      ('messaging_deletion_requests_pkey'), ('messaging_deletion_requests_shop_fk'),
      ('messaging_deletion_requests_shop_customer_fk'), ('messaging_deletion_requests_shop_actor_fk'),
      ('messaging_deletion_requests_request_fingerprint_valid'), ('messaging_deletion_requests_destination_fingerprint_valid'),
      ('messaging_deletion_requests_fingerprint_key_version_valid'), ('messaging_deletion_requests_state_valid'),
      ('messaging_deletion_requests_reason_code_valid'), ('messaging_deletion_requests_prior_counts_object'),
      ('messaging_deletion_requests_prior_counts_size'), ('messaging_deletion_requests_proof_summary_object'),
      ('messaging_deletion_requests_proof_summary_size'), ('messaging_deletion_requests_state_consistent'),
      ('messaging_deletion_requests_retention_window_exact'),
      ('messaging_deletion_work_items_pkey'),
      ('messaging_deletion_work_items_shop_request_fk'),
      ('messaging_deletion_work_items_parent_fk'),
      ('messaging_deletion_work_items_resource_type_valid'),
      ('messaging_deletion_work_items_outcome_valid'),
      ('messaging_deletion_work_items_retention_basis_valid'),
      ('messaging_deletion_work_items_state_consistent'),
      ('messaging_deletion_work_items_detached_count_valid'),
      ('messaging_retention_holds_pkey'), ('messaging_retention_holds_shop_fk'),
      ('messaging_retention_holds_shop_actor_fk'), ('messaging_retention_holds_resource_type_valid'),
      ('messaging_retention_holds_reason_code_valid'), ('messaging_retention_holds_target_consistent'),
      ('messaging_retention_holds_review_valid'), ('messaging_retention_holds_release_valid'),
      ('messaging_retention_holds_max_duration'),
      ('messaging_retention_holds_retention_window_exact'),
      ('quote_sends_pkey'), ('quote_sends_shop_fk'),
      ('quote_sends_shop_ticket_fk'), ('quote_sends_shop_ticket_version_fk'),
      ('quote_sends_shop_customer_fk'), ('quote_sends_shop_actor_fk'),
      ('quote_sends_destination_fingerprint_valid'), ('quote_sends_fingerprint_key_version_valid'),
      ('quote_sends_channel_valid'), ('quote_sends_token_hash_valid'),
      ('quote_sends_request_fingerprint_valid'), ('quote_sends_state_valid'),
      ('quote_sends_token_action_consistent'), ('quote_sends_submission_timestamps_consistent'),
      ('quote_sends_terminal_timestamps_consistent'), ('quote_sends_retention_timestamp_valid'),
      ('sms_log_pkey'), ('sms_log_shop_fk'), ('sms_log_shop_send_fk'),
      ('sms_log_provider_message_id_valid'), ('sms_log_provider_event_id_valid'),
      ('sms_log_template_key_valid'), ('sms_log_template_version_valid'),
      ('sms_log_state_valid'), ('sms_log_error_code_valid'),
      ('sms_log_retention_timestamp_valid'),
      ('notifications_pkey'), ('notifications_shop_fk'), ('notifications_shop_recipient_fk'),
      ('notifications_event_type_valid'), ('notifications_entity_type_valid'),
      ('notifications_dedupe_key_valid'), ('notifications_read_at_valid'),
      ('notifications_retention_timestamp_valid')
    ), expected_indexes(index_name) as (values
      ('messaging_consent_events_shop_id_uq'), ('messaging_consent_events_shop_request_uq'),
      ('messaging_consent_events_subject_idx'), ('messaging_consent_state_shop_id_uq'),
      ('messaging_consent_state_subject_program_uq'), ('sms_suppressions_shop_id_uq'),
      ('sms_suppressions_shop_destination_uq'), ('messaging_deletion_requests_shop_id_uq'),
      ('messaging_deletion_requests_shop_actor_request_uq'),
      ('messaging_deletion_requests_shop_customer_pending_uq'),
      ('messaging_deletion_requests_pending_idx'),
      ('messaging_deletion_work_items_request_resource_uq'),
      ('messaging_deletion_work_items_request_id_uq'),
      ('messaging_deletion_work_items_pending_idx'),
      ('messaging_deletion_work_items_parent_idx'),
      ('messaging_retention_holds_shop_id_uq'), ('messaging_retention_holds_active_subject_idx'),
      ('messaging_retention_holds_purge_idx'), ('messaging_retention_holds_active_resource_idx'),
      ('quote_sends_shop_id_uq'), ('quote_sends_shop_ticket_id_uq'),
      ('quote_sends_shop_ticket_version_id_uq'),
      ('quote_sends_shop_actor_request_uq'), ('quote_sends_destination_idx'),
      ('quote_sends_purge_idx'), ('quote_sends_subject_retention_idx'), ('sms_log_shop_id_uq'),
      ('sms_log_shop_provider_event_uq'), ('sms_log_send_idx'), ('sms_log_purge_idx'),
      ('notifications_shop_id_uq'), ('notifications_shop_recipient_dedupe_uq'),
      ('notifications_purge_idx')
    ), expected_functions(
      signature, return_type, security_definer, service_execute,
      body_marker, secondary_body_marker, tertiary_body_marker, quaternary_body_marker
    ) as (values
      ('validate_quote_event_send_reference()', 'trigger', true, false,
        'quote event send reference must match an exact live quote send', null, null, null),
      ('guard_quote_send_lifecycle()', 'trigger', false, false,
        'matching pending messaging deletion request',
        'into locked_request_id, locked_request_requested_at from public.messaging_deletion_requests deletion_request',
        'and suppression.destination_fingerprint = old.destination_fingerprint and suppression.fingerprint_key_version = old.fingerprint_key_version and suppression.reason in (''verified_deletion'', ''permanent_failure'', ''number_reassigned'') and suppression.lifted_at is null and suppression.retain_until >= approved_deletion_barrier order by suppression.id for share',
        'quote send subject identity is immutable'),
      ('reject_messaging_consent_event_mutation()', 'trigger', false, false,
        'compact_messaging_consent_work_items(uuid,uuid,uuid[])',
        'compaction_shop_id = old.shop_id and old.id = any(compaction_event_ids)',
        'purge_shop_id = old.shop_id and old.id = any(purge_event_ids)', null),
      ('require_messaging_compaction_completion()', 'trigger', false, false,
        'vyntechs.messaging_consent_compaction_shop',
        'old.id = any(compaction_event_ids)',
        'r.shop_id = old.shop_id and r.state in (''pending'', ''completed'')',
        'old.id = any(purge_event_ids)'),
      ('compact_messaging_consent_work_items(uuid,uuid,uuid[])', 'integer', true, true,
        'between 1 and 256 distinct exact work item IDs',
        'work_item.id = any(p_work_item_ids)',
        'work_item.outcome in (''pending'', ''retained'')',
        'return advanced_count'),
      ('finalize_messaging_deletion_request(uuid,uuid)', 'record', true, true,
        'messaging deletion finalizer requires an exact shop',
        'work.request_id = request_row.id and work.outcome = ''pending''',
        'delete from public.messaging_deletion_work_items work',
        'vyntechs.messaging_deletion_finalizer_request'),
      ('guard_messaging_deletion_work_item_mutation()', 'trigger', false, false,
        'deletion work items must be inserted pending',
        'deletion work item resource identity is immutable',
        'consent-event work item counts_toward_proof is derived from its source',
        'deletion work item detached count requires controlled compaction'),
      ('guard_messaging_deletion_request_mutation()', 'trigger', false, false,
        'messaging deletion request identity is immutable',
        'vyntechs.messaging_deletion_finalizer_shop',
        'vyntechs.messaging_deletion_finalizer_request',
        'completed messaging deletion tombstones are immutable'),
      ('purge_expired_messaging_deletion_request(uuid,uuid)', 'boolean', true, true,
        'clock_timestamp()',
        'from public.shops locked_shop where locked_shop.id = p_shop_id for update',
        'from public.messaging_deletion_requests where shop_id = p_shop_id and id = p_request_id for update',
        'active messaging retention hold blocks purge'),
      ('purge_expired_messaging_consent_event(uuid,uuid)', 'boolean', true, true,
        'clock_timestamp()',
        'consent projection still references event',
        'suppression still references event',
        'from public.shops locked_shop where locked_shop.id = p_shop_id for update'),
      ('purge_expired_messaging_retention_hold(uuid,uuid)', 'boolean', true, true,
        'clock_timestamp()',
        'vyntechs.messaging_retention_hold_purge_shop',
        'from public.shops locked_shop where locked_shop.id = p_shop_id for update',
        'vyntechs.messaging_retention_hold_purge_ids'),
      ('serialize_messaging_retention_hold_target()', 'trigger', false, false,
        'messaging retention hold target is immutable',
        'messaging retention hold lifecycle is immutable',
        'from public.shops locked_shop where locked_shop.id = new.shop_id for update',
        'array_agg(distinct r.id order by r.id)')
    ), expected_triggers(
      table_name, trigger_name, function_signature, trigger_type, is_deferrable,
      trigger_columns
    ) as (values
      ('quote_events', 'quote_events_send_reference_validator',
        'validate_quote_event_send_reference()', 7, false, null),
      ('quote_sends', 'quote_sends_lifecycle_guard',
        'guard_quote_send_lifecycle()', 19, false, null),
      ('messaging_consent_events', 'messaging_consent_events_append_only',
        'reject_messaging_consent_event_mutation()', 27, false, null),
      ('messaging_consent_events', 'messaging_consent_events_compaction_completion',
        'require_messaging_compaction_completion()', 9, true, null),
      ('messaging_deletion_requests', 'messaging_deletion_requests_guard',
        'guard_messaging_deletion_request_mutation()', 27, false, null),
      ('messaging_deletion_work_items', 'messaging_deletion_work_items_guard',
        'guard_messaging_deletion_work_item_mutation()', 31, false, null),
      ('messaging_retention_holds', 'messaging_retention_holds_serialize_target',
        'serialize_messaging_retention_hold_target()', 31, false, null)
    ), client_roles(role_name) as (values
      ('anon'), ('authenticated')
    ), table_privileges(privilege_name) as (values
      ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
      ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')
    )
    select
      (select count(*)::int from expected_tables e
       join pg_class c on c.relname = e.table_name
       join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
       where c.relkind in ('r', 'p')) as table_count,
      (select count(*)::int from expected_columns e
       join information_schema.columns c using (table_name, column_name)
       where c.table_schema = 'public') as column_count,
      (select count(*)::int from expected_constraints e
       join pg_constraint c on c.conname = e.constraint_name
       where c.connamespace = 'public'::regnamespace) as constraint_count,
      (select count(*)::int from expected_indexes e
       join pg_indexes i on i.indexname = e.index_name and i.schemaname = 'public'
       where e.index_name <> 'messaging_deletion_requests_shop_customer_pending_uq'
         or (position('state' in lower(i.indexdef)) > 0
           and position('pending' in lower(i.indexdef)) > 0
           and position('customer_id is not null' in lower(i.indexdef)) > 0)) as index_count,
      (select count(*)::int
       from pg_indexes i
       where i.schemaname = 'public'
         and i.indexname = 'messaging_retention_holds_active_resource_idx'
         and position(
           'on public.messaging_retention_holds using btree (shop_id, resource_type, resource_id, starts_at, expires_at) where ((resource_id is not null) and (released_at is null))'
           in lower(regexp_replace(i.indexdef, '\\s+', ' ', 'g'))
         ) > 0) as active_resource_index_count,
      (select count(*)::int from expected_tables e
       join pg_class c on c.relname = e.table_name
       join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
       where c.relrowsecurity) as rls_count,
      (select count(*)::int from expected_tables e
       join pg_policies p on p.tablename = e.table_name and p.schemaname = 'public'
       where p.policyname = e.table_name || '_server_only_deny_direct'
         and p.roles::text = '{anon,authenticated}'
         and p.cmd = 'ALL' and p.qual = 'false' and p.with_check = 'false') as policy_count,
      (select count(*)::int from expected_functions e
       join pg_proc p on p.oid = to_regprocedure('public.' || e.signature)
       where p.prorettype = e.return_type::regtype
         and p.prosecdef = e.security_definer
         and p.proconfig = array['search_path=""']
         and (e.body_marker is null or position(e.body_marker in
           regexp_replace(pg_get_functiondef(p.oid), '\\s+', ' ', 'g')) > 0)
         and (e.secondary_body_marker is null
           or position(e.secondary_body_marker in
             regexp_replace(pg_get_functiondef(p.oid), '\\s+', ' ', 'g')) > 0)
         and (e.tertiary_body_marker is null
           or position(e.tertiary_body_marker in
             regexp_replace(pg_get_functiondef(p.oid), '\\s+', ' ', 'g')) > 0)
         and (e.quaternary_body_marker is null
           or position(e.quaternary_body_marker in
             regexp_replace(pg_get_functiondef(p.oid), '\\s+', ' ', 'g')) > 0)
         and (e.signature <> 'serialize_messaging_retention_hold_target()'
           or (length(lower(pg_get_functiondef(p.oid)))
             - length(replace(lower(pg_get_functiondef(p.oid)), 'from public.shops', '')))
             / length('from public.shops') = 1)
         and has_function_privilege('service_role', p.oid, 'execute') = e.service_execute
         and not has_function_privilege('anon', p.oid, 'execute')
         and not has_function_privilege('authenticated', p.oid, 'execute')) as function_marker_count,
      (select count(*)::int from expected_triggers e
       join pg_trigger t on t.tgname = e.trigger_name
         and t.tgrelid = to_regclass('public.' || e.table_name)
         and t.tgfoid = to_regprocedure('public.' || e.function_signature)
       where not t.tgisinternal
         and t.tgenabled = 'O'
         and t.tgtype = e.trigger_type
         and t.tgdeferrable = e.is_deferrable
         and t.tginitdeferred = e.is_deferrable
         and (e.trigger_columns is null or t.tgattr::text = e.trigger_columns)) as trigger_binding_count,
      (select count(*)::int
       from information_schema.columns c
       where c.table_schema = 'public'
         and c.table_name = 'quote_sends'
         and c.column_name = 'customer_id'
         and c.is_nullable = 'YES') as nullable_quote_send_customer_count,
      (select count(*)::int from expected_tables e
       join information_schema.role_table_grants g on g.table_name = e.table_name
       where g.table_schema = 'public' and g.grantee in ('anon', 'authenticated')) as direct_client_grant_count,
      (select count(*)::int from expected_tables e
       join pg_class c on c.relname = e.table_name
       join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
       cross join client_roles r
       cross join table_privileges p
       where has_table_privilege(r.role_name, c.oid, p.privilege_name)) as effective_client_privilege_count,
      (select count(*)::int from expected_tables e
       join information_schema.role_table_grants g on g.table_name = e.table_name
       where g.table_schema = 'public' and g.grantee = 'service_role'
         and g.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')) as service_crud_count
  `)
  const markers = result.rows[0]
  if (!markers) throw new Error('messaging retention schema inspection failed')
  const functionInspection = await messagingRetentionFunctionInspection(client)
  markers.function_digest_count = functionInspection.digestCount
  markers.function_authority_count = functionInspection.authorityCount
  return markers
}

function isCompleteMessagingRetention(markers: MessagingRetentionMarkers): boolean {
  return markers.table_count === 9
    && markers.column_count === 127
    && markers.constraint_count === 98
    && markers.index_count === 33
    && markers.active_resource_index_count === 1
    && markers.rls_count === 9
    && markers.policy_count === 9
    && markers.function_marker_count === 12
    && markers.function_digest_count === 12
    && markers.function_authority_count === 12
    && markers.trigger_binding_count === 7
    && markers.nullable_quote_send_customer_count === 1
    && markers.direct_client_grant_count === 0
    && markers.effective_client_privilege_count === 0
    && markers.service_crud_count === 36
}

function hasAnyMessagingRetentionMarker(markers: MessagingRetentionMarkers): boolean {
  return Object.values(markers).some((value) => value > 0)
}

export async function ensureMessagingRetentionMigration(client: PGlite): Promise<void> {
  const before = await messagingRetentionMarkers(client)
  if (isCompleteMessagingRetention(before)) return
  if (hasAnyMessagingRetentionMarker(before)) {
    throw new Error('partial messaging retention schema in ephemeral database')
  }
  const migration = await readFile(
    path.join(process.cwd(), 'drizzle/migrations/0033_shop_os_messaging_retention.sql'),
    'utf8',
  )
  await client.exec(migration.replaceAll('--> statement-breakpoint', ''))
  const after = await messagingRetentionMarkers(client)
  if (!isCompleteMessagingRetention(after)) {
    throw new Error('messaging retention schema hardening failed in ephemeral database')
  }
}

const MESSAGING_RETENTION_ACL_TABLES = [
  'messaging_consent_events',
  'messaging_consent_state',
  'sms_suppressions',
  'quote_sends',
  'sms_log',
  'notifications',
  'messaging_deletion_requests',
  'messaging_deletion_work_items',
  'messaging_retention_holds',
] as const

type MessagingRetentionAclMarkers = {
  table_count: number
  rls_count: number
  policy_count: number
  matching_policy_count: number
  direct_client_grant_count: number
  effective_client_privilege_count: number
  service_crud_count: number
  service_grant_count: number
  service_effective_acl_count: number
  function_count: number
  required_service_function_count: number
  exact_function_acl_count: number
  function_authority_count: number
}

async function messagingRetentionAclMarkers(
  client: PGlite,
): Promise<MessagingRetentionAclMarkers> {
  const expectedTables = MESSAGING_RETENTION_ACL_TABLES
    .map((table) => `('${table}')`)
    .join(', ')
  const result = await client.query<MessagingRetentionAclMarkers>(`
    with
      expected_tables(table_name) as (values ${expectedTables}),
      expected_functions(signature, service_execute) as (values
        ('validate_quote_event_send_reference()', false),
        ('guard_quote_send_lifecycle()', false),
        ('reject_messaging_consent_event_mutation()', false),
        ('require_messaging_compaction_completion()', false),
        ('compact_messaging_consent_work_items(uuid,uuid,uuid[])', true),
        ('finalize_messaging_deletion_request(uuid,uuid)', true),
        ('guard_messaging_deletion_work_item_mutation()', false),
        ('guard_messaging_deletion_request_mutation()', false),
        ('purge_expired_messaging_deletion_request(uuid,uuid)', true),
        ('purge_expired_messaging_consent_event(uuid,uuid)', true),
        ('purge_expired_messaging_retention_hold(uuid,uuid)', true),
        ('serialize_messaging_retention_hold_target()', false)
      ),
      client_roles(role_name) as (values ('anon'), ('authenticated')),
      table_privileges(privilege_name) as (values
        ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
        ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')
      ),
      service_privileges(privilege_name, expected) as (values
        ('SELECT', true), ('INSERT', true), ('UPDATE', true), ('DELETE', true),
        ('TRUNCATE', false), ('REFERENCES', false), ('TRIGGER', false),
        ('MAINTAIN', false)
      )
    select
      (select count(*)::int from expected_tables e
       join pg_class c on c.relname = e.table_name
       join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
       where c.relkind in ('r', 'p')) as table_count,
      (select count(*)::int from expected_tables e
       join pg_class c on c.relname = e.table_name
       join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
       where c.relrowsecurity) as rls_count,
      (select count(*)::int from expected_tables e
       join pg_policies p on p.tablename = e.table_name and p.schemaname = 'public')
        as policy_count,
      (select count(*)::int from expected_tables e
       join pg_policies p on p.tablename = e.table_name and p.schemaname = 'public'
       where p.policyname = e.table_name || '_server_only_deny_direct'
         and p.roles::text = '{anon,authenticated}'
         and p.cmd = 'ALL' and p.qual = 'false' and p.with_check = 'false')
        as matching_policy_count,
      (select count(*)::int from expected_tables e
       join information_schema.role_table_grants g on g.table_name = e.table_name
       where g.table_schema = 'public' and g.grantee in ('anon', 'authenticated'))
        as direct_client_grant_count,
      (select count(*)::int from expected_tables e
       join pg_class c on c.relname = e.table_name
       join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
       cross join client_roles r
       cross join table_privileges p
       where has_table_privilege(r.role_name, c.oid, p.privilege_name))
        as effective_client_privilege_count,
      (select count(*)::int from expected_tables e
       join information_schema.role_table_grants g on g.table_name = e.table_name
       where g.table_schema = 'public' and g.grantee = 'service_role'
         and g.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE'))
        as service_crud_count,
      (select count(*)::int from expected_tables e
       join information_schema.role_table_grants g on g.table_name = e.table_name
       where g.table_schema = 'public' and g.grantee = 'service_role')
        as service_grant_count,
      (select count(*)::int from expected_tables e
       join pg_class c on c.relname = e.table_name
       join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
       cross join service_privileges p
       where has_table_privilege('service_role', c.oid, p.privilege_name) = p.expected)
        as service_effective_acl_count,
      (select count(*)::int from expected_functions e
       join pg_proc p on p.oid = to_regprocedure('public.' || e.signature))
        as function_count,
      (select count(*)::int from expected_functions e
       join pg_proc p on p.oid = to_regprocedure('public.' || e.signature)
       where e.service_execute and has_function_privilege('service_role', p.oid, 'execute'))
        as required_service_function_count,
      (select count(*)::int from expected_functions e
       join pg_proc p on p.oid = to_regprocedure('public.' || e.signature)
       where has_function_privilege('service_role', p.oid, 'execute') = e.service_execute
         and not has_function_privilege('anon', p.oid, 'execute')
         and not has_function_privilege('authenticated', p.oid, 'execute'))
        as exact_function_acl_count
  `)
  const markers = result.rows[0]
  if (!markers) throw new Error('messaging retention ACL inspection failed')
  markers.function_authority_count = (
    await messagingRetentionFunctionInspection(client)
  ).authorityCount
  return markers
}

function hasCompleteMessagingRetentionAcl(
  markers: MessagingRetentionAclMarkers,
): boolean {
  return markers.table_count === MESSAGING_RETENTION_ACL_TABLES.length
    && markers.rls_count === MESSAGING_RETENTION_ACL_TABLES.length
    && markers.policy_count === MESSAGING_RETENTION_ACL_TABLES.length
    && markers.matching_policy_count === MESSAGING_RETENTION_ACL_TABLES.length
    && markers.direct_client_grant_count === 0
    && markers.effective_client_privilege_count === 0
    && markers.service_crud_count === MESSAGING_RETENTION_ACL_TABLES.length * 4
    && markers.service_grant_count === MESSAGING_RETENTION_ACL_TABLES.length * 4
    && markers.service_effective_acl_count === MESSAGING_RETENTION_ACL_TABLES.length * 8
    && markers.function_count === 12
    && markers.required_service_function_count === 5
    && markers.exact_function_acl_count === 12
    && markers.function_authority_count === 12
}

export async function ensureMessagingRetentionAclMigration(
  client: PGlite,
): Promise<void> {
  const before = await messagingRetentionAclMarkers(client)
  if (
    before.table_count !== MESSAGING_RETENTION_ACL_TABLES.length
    || before.rls_count !== MESSAGING_RETENTION_ACL_TABLES.length
    || before.matching_policy_count !== MESSAGING_RETENTION_ACL_TABLES.length
    || before.service_crud_count !== MESSAGING_RETENTION_ACL_TABLES.length * 4
    || before.function_count !== 12
    || before.required_service_function_count !== 5
  ) {
    throw new Error('partial messaging retention ACL in ephemeral database')
  }
  if (hasCompleteMessagingRetentionAcl(before)) return

  const migration = await readFile(
    path.join(process.cwd(), 'drizzle/migrations/0034_shop_os_messaging_retention_acl.sql'),
    'utf8',
  )
  await client.exec(migration.replaceAll('--> statement-breakpoint', ''))

  const after = await messagingRetentionAclMarkers(client)
  if (!hasCompleteMessagingRetentionAcl(after)) {
    throw new Error('messaging retention ACL hardening failed in ephemeral database')
  }
}

const MESSAGING_RETENTION_FK_INDEXES = [
  { name: 'messaging_consent_events_shop_customer_idx', table: 'messaging_consent_events', columns: ['shop_id', 'customer_id'] },
  { name: 'messaging_consent_state_shop_customer_idx', table: 'messaging_consent_state', columns: ['shop_id', 'customer_id'] },
  { name: 'messaging_consent_state_shop_source_event_idx', table: 'messaging_consent_state', columns: ['shop_id', 'source_event_id'] },
  { name: 'messaging_deletion_work_items_parent_work_item_idx', table: 'messaging_deletion_work_items', columns: ['parent_work_item_id'] },
  { name: 'messaging_deletion_work_items_shop_request_idx', table: 'messaging_deletion_work_items', columns: ['shop_id', 'request_id'] },
  { name: 'messaging_retention_holds_shop_actor_idx', table: 'messaging_retention_holds', columns: ['shop_id', 'authorizing_actor_profile_id'] },
  { name: 'quote_sends_shop_customer_idx', table: 'quote_sends', columns: ['shop_id', 'customer_id'] },
  { name: 'sms_suppressions_shop_source_event_idx', table: 'sms_suppressions', columns: ['shop_id', 'source_event_id'] },
] as const

async function inspectMessagingRetentionFkIndexes(client: PGlite): Promise<{
  present: number
  exact: number
  alternateCovering: number
}> {
  const names = MESSAGING_RETENTION_FK_INDEXES
    .map(({ name }) => `'${name}'`)
    .join(', ')
  const tables = [...new Set(MESSAGING_RETENTION_FK_INDEXES.map(({ table }) => table))]
    .map((table) => `'${table}'`)
    .join(', ')
  const result = await client.query<{
    indexname: string
    tablename: string
    access_method: string
    is_valid: boolean
    is_ready: boolean
    predicate: string | null
    key_columns: string[]
  }>(`
    select
      index_class.relname as indexname,
      table_class.relname as tablename,
      access_method.amname as access_method,
      index_catalog.indisvalid as is_valid,
      index_catalog.indisready as is_ready,
      pg_get_expr(index_catalog.indpred, index_catalog.indrelid) as predicate,
      array(
        select attribute.attname
        from unnest(index_catalog.indkey::smallint[]) with ordinality
          as index_key(attribute_number, position)
        join pg_attribute attribute
          on attribute.attrelid = table_class.oid
         and attribute.attnum = index_key.attribute_number
        where index_key.position <= index_catalog.indnkeyatts
        order by index_key.position
      ) as key_columns
    from pg_index index_catalog
    join pg_class index_class on index_class.oid = index_catalog.indexrelid
    join pg_class table_class on table_class.oid = index_catalog.indrelid
    join pg_namespace namespace on namespace.oid = table_class.relnamespace
    join pg_am access_method on access_method.oid = index_class.relam
    where namespace.nspname = 'public'
      and (table_class.relname in (${tables}) or index_class.relname in (${names}))
  `)
  const expectedNames = new Set<string>(MESSAGING_RETENTION_FK_INDEXES.map(({ name }) => name))
  const structurallyMatches = (
    row: (typeof result.rows)[number],
    expected: (typeof MESSAGING_RETENTION_FK_INDEXES)[number],
    allowTrailingColumns = false,
  ) => row.tablename === expected.table
    && row.access_method === 'btree'
    && row.is_valid
    && row.is_ready
    && row.predicate === null
    && (allowTrailingColumns
      ? expected.columns.every((column, index) => row.key_columns[index] === column)
      : row.key_columns.length === expected.columns.length
        && expected.columns.every((column, index) => row.key_columns[index] === column))
  const exact = MESSAGING_RETENTION_FK_INDEXES.filter((expected) => result.rows.some(
    (row) => row.indexname === expected.name && structurallyMatches(row, expected),
  )).length
  const alternateCovering = MESSAGING_RETENTION_FK_INDEXES.filter((expected) => result.rows.some(
    (row) => !expectedNames.has(row.indexname) && structurallyMatches(row, expected, true),
  )).length
  const present = result.rows.filter((row) => expectedNames.has(row.indexname)).length
  return { present, exact, alternateCovering }
}

export async function ensureMessagingRetentionFkIndexMigration(client: PGlite): Promise<void> {
  const before = await inspectMessagingRetentionFkIndexes(client)
  if (before.exact === MESSAGING_RETENTION_FK_INDEXES.length) return
  if (before.present > 0 || before.alternateCovering > 0) {
    throw new Error('partial messaging retention foreign-key indexes in ephemeral database')
  }

  const migration = await readFile(
    path.join(process.cwd(), 'drizzle/migrations/0035_shop_os_messaging_retention_fk_indexes.sql'),
    'utf8',
  )
  await client.exec(migration.replaceAll('--> statement-breakpoint', ''))

  const after = await inspectMessagingRetentionFkIndexes(client)
  if (after.exact !== MESSAGING_RETENTION_FK_INDEXES.length) {
    throw new Error('messaging retention foreign-key index hardening failed in ephemeral database')
  }
}
