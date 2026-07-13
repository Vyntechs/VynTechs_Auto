import { existsSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createTestDb,
  ensureMessagingRetentionAclMigration,
} from '@/tests/helpers/db'

const closeCallbacks: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(closeCallbacks.splice(0).map((close) => close()))
})

const MESSAGING_TABLES = [
  'messaging_consent_events',
  'messaging_consent_state',
  'sms_suppressions',
  'quote_sends',
  'sms_log',
  'notifications',
  'messaging_deletion_requests',
  'messaging_retention_holds',
] as const

const FUNCTION_EXECUTION = [
  { signature: 'validate_quote_event_send_reference()', serviceExecute: false },
  { signature: 'guard_quote_send_lifecycle()', serviceExecute: false },
  { signature: 'reject_messaging_consent_event_mutation()', serviceExecute: false },
  { signature: 'require_messaging_compaction_completion()', serviceExecute: false },
  { signature: 'compact_messaging_consent_events(uuid,uuid,uuid,uuid,integer)', serviceExecute: true },
  { signature: 'guard_messaging_deletion_request_mutation()', serviceExecute: false },
  { signature: 'purge_expired_messaging_deletion_request(uuid,uuid)', serviceExecute: true },
  { signature: 'purge_expired_messaging_consent_event(uuid,uuid)', serviceExecute: true },
  { signature: 'purge_expired_messaging_retention_hold(uuid,uuid)', serviceExecute: true },
  { signature: 'serialize_messaging_retention_hold_target()', serviceExecute: false },
] as const

describe('Shop OS messaging retention ACL hardening', () => {
  it('proves exact RLS, policy, client isolation, service CRUD, and function execution', async () => {
    const migrationPath = path.join(
      process.cwd(),
      'drizzle/migrations/0034_shop_os_messaging_retention_acl.sql',
    )
    expect(existsSync(migrationPath), 'source migration 0034 must exist').toBe(true)
    if (!existsSync(migrationPath)) return

    const { client, close } = await createTestDb()
    closeCallbacks.push(close)

    const tables = await client.query<{
      table_name: string
      rls_enabled: boolean
      policy_count: number
      matching_policy_count: number
      direct_client_grant_count: number
      effective_client_privilege_count: number
      service_grants: string[]
      service_effective_acl_count: number
    }>(`
      with
        expected_tables(table_name) as (values
          ${MESSAGING_TABLES.map((table) => `('${table}')`).join(', ')}
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
        e.table_name,
        c.relrowsecurity as rls_enabled,
        (select count(*)::int from pg_policies p
         where p.schemaname = 'public' and p.tablename = e.table_name) as policy_count,
        (select count(*)::int from pg_policies p
         where p.schemaname = 'public' and p.tablename = e.table_name
           and p.policyname = e.table_name || '_server_only_deny_direct'
           and p.roles::text = '{anon,authenticated}'
           and p.cmd = 'ALL' and p.qual = 'false' and p.with_check = 'false') as matching_policy_count,
        (select count(*)::int from information_schema.role_table_grants g
         where g.table_schema = 'public' and g.table_name = e.table_name
           and g.grantee in ('anon', 'authenticated')) as direct_client_grant_count,
        (select count(*)::int from client_roles r cross join table_privileges p
         where has_table_privilege(r.role_name, c.oid, p.privilege_name)) as effective_client_privilege_count,
        coalesce((select array_agg(g.privilege_type order by g.privilege_type)
         from information_schema.role_table_grants g
         where g.table_schema = 'public' and g.table_name = e.table_name
           and g.grantee = 'service_role'), array[]::text[]) as service_grants,
        (select count(*)::int from service_privileges p
         where has_table_privilege('service_role', c.oid, p.privilege_name) = p.expected)
          as service_effective_acl_count
      from expected_tables e
      join pg_class c on c.relname = e.table_name
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      order by e.table_name
    `)

    expect(tables.rows).toHaveLength(MESSAGING_TABLES.length)
    expect(tables.rows).toEqual(
      [...MESSAGING_TABLES].sort().map((tableName) => ({
        table_name: tableName,
        rls_enabled: true,
        policy_count: 1,
        matching_policy_count: 1,
        direct_client_grant_count: 0,
        effective_client_privilege_count: 0,
        service_grants: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
        service_effective_acl_count: 8,
      })),
    )

    const functions = await client.query<{
      signature: string
      anon_execute: boolean
      authenticated_execute: boolean
      service_execute: boolean
      public_direct_execute: boolean
      client_direct_execute_count: number
    }>(`
      with expected_functions(signature) as (values
        ${FUNCTION_EXECUTION.map(({ signature }) => `('${signature}')`).join(', ')}
      )
      select
        e.signature,
        has_function_privilege('anon', p.oid, 'execute') as anon_execute,
        has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute,
        has_function_privilege('service_role', p.oid, 'execute') as service_execute,
        coalesce(has_function_privilege(0, p.oid, 'execute'), false) as public_direct_execute,
        (select count(*)::int
         from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
         join pg_roles r on r.oid = acl.grantee
         where r.rolname in ('anon', 'authenticated') and acl.privilege_type = 'EXECUTE')
          as client_direct_execute_count
      from expected_functions e
      join pg_proc p on p.oid = to_regprocedure('public.' || e.signature)
      order by e.signature
    `)

    expect(functions.rows).toEqual(
      [...FUNCTION_EXECUTION]
        .sort((left, right) => left.signature.localeCompare(right.signature))
        .map(({ signature, serviceExecute }) => ({
          signature,
          anon_execute: false,
          authenticated_execute: false,
          service_execute: serviceExecute,
          public_direct_execute: false,
          client_direct_execute_count: 0,
        })),
    )
  }, 15_000)

  it('requires trusted non-client owners and an exact effective executor set', async () => {
    const { client, close } = await createTestDb()
    closeCallbacks.push(close)
    const owners = await client.query<{
      signature: string
      owner_exact: boolean
      owner_superuser: boolean
      client_inherits_owner: boolean
      unexpected_executor_count: number
    }>(`
      with expected_functions(signature, service_execute) as (values
        ${FUNCTION_EXECUTION.map(({ signature, serviceExecute }) =>
          `('${signature}', ${serviceExecute})`).join(', ')}
      )
      select e.signature,
        owner_role.rolname = 'postgres' as owner_exact,
        owner_role.rolsuper as owner_superuser,
        pg_has_role('service_role', owner_role.oid, 'usage')
          or pg_has_role('anon', owner_role.oid, 'usage')
          or pg_has_role('authenticated', owner_role.oid, 'usage') as client_inherits_owner,
        (select count(*)::int
         from pg_roles executor
         where not executor.rolsuper
           and executor.oid <> p.proowner
           and not (e.service_execute and executor.rolname = 'service_role')
           and has_function_privilege(executor.oid, p.oid, 'execute'))
          as unexpected_executor_count
      from expected_functions e
      join pg_proc p on p.oid = to_regprocedure('public.' || e.signature)
      join pg_roles owner_role on owner_role.oid = p.proowner
      order by e.signature
    `)
    expect(owners.rows).toHaveLength(FUNCTION_EXECUTION.length)
    expect(owners.rows.every((row) => row.owner_exact)).toBe(true)
    expect(owners.rows.every((row) => row.owner_superuser)).toBe(true)
    expect(owners.rows.every((row) => !row.client_inherits_owner)).toBe(true)
    expect(owners.rows.every((row) => row.unexpected_executor_count === 0)).toBe(true)
  }, 15_000)

  it('repairs direct and PUBLIC table/function leakage idempotently', async () => {
    const { client, close } = await createTestDb()
    closeCallbacks.push(close)

    await client.exec(`
      grant truncate, references, trigger, maintain on public.notifications to anon, authenticated, service_role;
      grant select on public.notifications to public;
      grant execute on function public.guard_quote_send_lifecycle() to public, anon, authenticated, service_role;
    `)

    await expect(ensureMessagingRetentionAclMigration(client)).resolves.toBeUndefined()
    await expect(ensureMessagingRetentionAclMigration(client)).resolves.toBeUndefined()

    const privileges = await client.query<{ client_count: number; service_count: number }>(`
      select
        (select count(*)::int from (values
          ('anon'), ('authenticated')
        ) roles(role_name) cross join (values
          ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
          ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')
        ) privileges(privilege_name)
        where has_table_privilege(role_name, 'public.notifications', privilege_name)) as client_count,
        (select count(*)::int from (values
          ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
          ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')
        ) privileges(privilege_name)
        where has_table_privilege('service_role', 'public.notifications', privilege_name)) as service_count
    `)
    expect(privileges.rows[0]).toEqual({ client_count: 0, service_count: 4 })
    expect((await client.query<{ client_execute: boolean; service_execute: boolean }>(`
      select
        has_function_privilege('anon', 'public.guard_quote_send_lifecycle()', 'execute')
          or has_function_privilege('authenticated', 'public.guard_quote_send_lifecycle()', 'execute')
          as client_execute,
        has_function_privilege('service_role', 'public.guard_quote_send_lifecycle()', 'execute')
          as service_execute
    `)).rows[0]).toEqual({ client_execute: false, service_execute: false })
  }, 15_000)

  it('repairs direct and PUBLIC MAINTAIN but refuses inherited client or service MAINTAIN', async () => {
    const { client, close } = await createTestDb()
    closeCallbacks.push(close)

    await client.exec('grant maintain on public.notifications to public;')
    await expect(ensureMessagingRetentionAclMigration(client)).resolves.toBeUndefined()
    expect((await client.query<{ leaked: boolean }>(`
      select has_table_privilege('anon', 'public.notifications', 'maintain')
        or has_table_privilege('authenticated', 'public.notifications', 'maintain') as leaked
    `)).rows[0]?.leaked).toBe(false)

    await client.exec('grant maintain on public.notifications to anon, authenticated;')
    await expect(ensureMessagingRetentionAclMigration(client)).resolves.toBeUndefined()
    expect((await client.query<{ leaked: boolean }>(`
      select has_table_privilege('anon', 'public.notifications', 'maintain')
        or has_table_privilege('authenticated', 'public.notifications', 'maintain') as leaked
    `)).rows[0]?.leaked).toBe(false)

    await client.exec(`
      create role messaging_acl_client_maintain nologin;
      grant maintain on public.notifications to messaging_acl_client_maintain;
      grant messaging_acl_client_maintain to authenticated;
    `)
    await expect(ensureMessagingRetentionAclMigration(client)).rejects.toThrow(
      'messaging retention ACL hardening failed in ephemeral database',
    )

    await client.exec(`
      revoke messaging_acl_client_maintain from authenticated;
      revoke maintain on public.notifications from messaging_acl_client_maintain;
      drop role messaging_acl_client_maintain;
      create role messaging_acl_service_maintain nologin;
      grant maintain on public.notifications to messaging_acl_service_maintain;
      grant messaging_acl_service_maintain to service_role;
    `)
    await expect(ensureMessagingRetentionAclMigration(client)).rejects.toThrow(
      'messaging retention ACL hardening failed in ephemeral database',
    )
  }, 15_000)

  it('fails closed on absent tables, missing service CRUD, and missing allowed function execution', async () => {
    const { client, close } = await createTestDb()
    closeCallbacks.push(close)

    await client.exec('revoke select on public.notifications from service_role;')
    await expect(ensureMessagingRetentionAclMigration(client)).rejects.toThrow(
      'partial messaging retention ACL in ephemeral database',
    )

    await client.exec(`
      grant select on public.notifications to service_role;
      revoke execute on function public.compact_messaging_consent_events(uuid, uuid, uuid, uuid, integer)
        from service_role;
    `)
    await expect(ensureMessagingRetentionAclMigration(client)).rejects.toThrow(
      'partial messaging retention ACL in ephemeral database',
    )

    await client.exec(`
      grant execute on function public.compact_messaging_consent_events(uuid, uuid, uuid, uuid, integer)
        to service_role;
      revoke execute on function public.purge_expired_messaging_consent_event(uuid, uuid)
        from service_role;
    `)
    await expect(ensureMessagingRetentionAclMigration(client)).rejects.toThrow(
      'partial messaging retention ACL in ephemeral database',
    )

    await client.exec(`
      grant execute on function public.purge_expired_messaging_consent_event(uuid, uuid)
        to service_role;
      drop table public.notifications;
    `)
    await expect(ensureMessagingRetentionAclMigration(client)).rejects.toThrow(
      'partial messaging retention ACL in ephemeral database',
    )
  }, 15_000)

  it('fails closed on inherited client access and extra policies that 0034 cannot safely infer', async () => {
    const { client, close } = await createTestDb()
    closeCallbacks.push(close)

    await client.exec(`
      create role messaging_acl_inherited nologin;
      grant select on public.sms_log to messaging_acl_inherited;
      grant messaging_acl_inherited to anon;
    `)
    await expect(ensureMessagingRetentionAclMigration(client)).rejects.toThrow(
      'messaging retention ACL hardening failed in ephemeral database',
    )

    await client.exec(`
      revoke select on public.sms_log from messaging_acl_inherited;
      grant execute on function public.guard_quote_send_lifecycle()
        to messaging_acl_inherited;
    `)
    await expect(ensureMessagingRetentionAclMigration(client)).rejects.toThrow(
      'messaging retention ACL hardening failed in ephemeral database',
    )

    await client.exec(`
      revoke messaging_acl_inherited from anon;
      revoke execute on function public.guard_quote_send_lifecycle()
        from messaging_acl_inherited;
      drop role messaging_acl_inherited;
      create policy notifications_unexpected on public.notifications for select to service_role using (true);
    `)
    await expect(ensureMessagingRetentionAclMigration(client)).rejects.toThrow(
      'messaging retention ACL hardening failed in ephemeral database',
    )
  }, 15_000)

  it('fails closed on untrusted function owners and unrelated direct executors', async () => {
    const ownerFixture = await createTestDb()
    closeCallbacks.push(ownerFixture.close)
    await ownerFixture.client.exec(
      `alter function public.purge_expired_messaging_consent_event(uuid, uuid)
      owner to service_role`,
    )
    await expect(ensureMessagingRetentionAclMigration(ownerFixture.client)).rejects.toThrow(
      'messaging retention ACL hardening failed in ephemeral database',
    )

    const executorFixture = await createTestDb()
    closeCallbacks.push(executorFixture.close)
    await executorFixture.client.exec(`
      create role messaging_unrelated_executor nologin;
      grant execute on function public.purge_expired_messaging_consent_event(uuid, uuid)
        to messaging_unrelated_executor;
    `)
    await expect(ensureMessagingRetentionAclMigration(executorFixture.client)).rejects.toThrow(
      'messaging retention ACL hardening failed in ephemeral database',
    )

    const inheritanceFixture = await createTestDb()
    closeCallbacks.push(inheritanceFixture.close)
    await inheritanceFixture.client.exec(`
      create role messaging_trusted_owner nologin;
      alter function public.purge_expired_messaging_retention_hold(uuid, uuid)
        owner to messaging_trusted_owner;
      grant messaging_trusted_owner to authenticated;
    `)
    await expect(ensureMessagingRetentionAclMigration(inheritanceFixture.client)).rejects.toThrow(
      'messaging retention ACL hardening failed in ephemeral database',
    )

    const inheritedExecutor = await createTestDb()
    closeCallbacks.push(inheritedExecutor.close)
    await inheritedExecutor.client.exec(`
      create role messaging_inherited_executor nologin;
      grant execute on function public.serialize_messaging_retention_hold_target()
        to messaging_inherited_executor;
      grant messaging_inherited_executor to service_role;
    `)
    await expect(ensureMessagingRetentionAclMigration(inheritedExecutor.client)).rejects.toThrow(
      'messaging retention ACL hardening failed in ephemeral database',
    )
  }, 15_000)

  it('rejects an unrelated LOGIN role as a Row 31 function owner', async () => {
    const { client, close } = await createTestDb()
    closeCallbacks.push(close)
    await client.exec(`
      create role messaging_unrelated_login login;
      alter function public.purge_expired_messaging_retention_hold(uuid, uuid)
        owner to messaging_unrelated_login;
    `)
    await expect(ensureMessagingRetentionAclMigration(client)).rejects.toThrow(
      'messaging retention ACL hardening failed in ephemeral database',
    )
  }, 15_000)
})
