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
  await ensureMessagingRetentionMigration(client)
  await ensureMessagingRetentionAclMigration(client)
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
  rls_count: number
  policy_count: number
  function_marker_count: number
  trigger_binding_count: number
  nullable_quote_send_customer_count: number
  direct_client_grant_count: number
  effective_client_privilege_count: number
  service_crud_count: number
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
      ('messaging_retention_holds', 'id'), ('messaging_retention_holds', 'shop_id'),
      ('messaging_retention_holds', 'resource_type'), ('messaging_retention_holds', 'resource_id'),
      ('messaging_retention_holds', 'subject_key'), ('messaging_retention_holds', 'reason_code'),
      ('messaging_retention_holds', 'authorizing_actor_profile_id'), ('messaging_retention_holds', 'starts_at'),
      ('messaging_retention_holds', 'review_at'), ('messaging_retention_holds', 'expires_at'),
      ('messaging_retention_holds', 'released_at'), ('messaging_retention_holds', 'retain_until'),
      ('quote_sends', 'id'), ('quote_sends', 'shop_id'),
      ('quote_sends', 'ticket_id'), ('quote_sends', 'quote_version_id'),
      ('quote_sends', 'customer_id'), ('quote_sends', 'destination_fingerprint'),
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
      ('messaging_retention_holds_pkey'), ('messaging_retention_holds_shop_fk'),
      ('messaging_retention_holds_shop_actor_fk'), ('messaging_retention_holds_resource_type_valid'),
      ('messaging_retention_holds_reason_code_valid'), ('messaging_retention_holds_target_consistent'),
      ('messaging_retention_holds_review_valid'), ('messaging_retention_holds_release_valid'),
      ('messaging_retention_holds_max_duration'),
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
      ('messaging_deletion_requests_shop_actor_request_uq'), ('messaging_deletion_requests_pending_idx'),
      ('messaging_retention_holds_shop_id_uq'), ('messaging_retention_holds_active_subject_idx'),
      ('quote_sends_shop_id_uq'), ('quote_sends_shop_ticket_id_uq'),
      ('quote_sends_shop_ticket_version_id_uq'),
      ('quote_sends_shop_actor_request_uq'), ('quote_sends_destination_idx'),
      ('quote_sends_purge_idx'), ('sms_log_shop_id_uq'),
      ('sms_log_shop_provider_event_uq'), ('sms_log_send_idx'), ('sms_log_purge_idx'),
      ('notifications_shop_id_uq'), ('notifications_shop_recipient_dedupe_uq'),
      ('notifications_purge_idx')
    ), expected_functions(
      signature, return_type, security_definer, service_execute,
      body_marker, secondary_body_marker, tertiary_body_marker
    ) as (values
      ('validate_quote_event_send_reference()', 'trigger', true, false,
        'quote event send reference must match an exact live quote send', null, null),
      ('guard_quote_send_lifecycle()', 'trigger', false, false,
        'matching pending messaging deletion request',
        'order by deletion_request.id', 'for share'),
      ('reject_messaging_consent_event_mutation()', 'trigger', false, false, null, null, null),
      ('require_messaging_compaction_completion()', 'trigger', false, false, null, null, null),
      ('compact_messaging_consent_events(uuid,uuid,uuid)', 'integer', true, true,
        null, null, null),
      ('guard_messaging_deletion_request_mutation()', 'trigger', false, false,
        null, null, null),
      ('purge_expired_messaging_deletion_request(uuid,uuid)', 'boolean', true, true,
        null, null, null),
      ('serialize_messaging_retention_hold_target()', 'trigger', false, false,
        'array_agg(distinct target_shop_id order by target_shop_id)',
        'from public.shops locked_shop where locked_shop.id = locked_shop_id for update',
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
      ('messaging_retention_holds', 'messaging_retention_holds_serialize_target',
        'serialize_messaging_retention_hold_target()', 23, false, '2 3 4 5')
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
       join pg_indexes i on i.indexname = e.index_name and i.schemaname = 'public') as index_count,
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
  return markers
}

function isCompleteMessagingRetention(markers: MessagingRetentionMarkers): boolean {
  return markers.table_count === 8
    && markers.column_count === 114
    && markers.constraint_count === 89
    && markers.index_count === 25
    && markers.rls_count === 8
    && markers.policy_count === 8
    && markers.function_marker_count === 8
    && markers.trigger_binding_count === 6
    && markers.nullable_quote_send_customer_count === 1
    && markers.direct_client_grant_count === 0
    && markers.effective_client_privilege_count === 0
    && markers.service_crud_count === 32
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
        ('compact_messaging_consent_events(uuid,uuid,uuid)', true),
        ('guard_messaging_deletion_request_mutation()', false),
        ('purge_expired_messaging_deletion_request(uuid,uuid)', true),
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
    && markers.function_count === 8
    && markers.required_service_function_count === 2
    && markers.exact_function_acl_count === 8
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
    || before.function_count !== 8
    || before.required_service_function_count !== 2
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
