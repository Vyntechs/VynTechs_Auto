import { existsSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createTestDb,
  ensureMessagingRetentionAclMigration,
  ensureShopOsServerOnlyAclMigration,
} from '@/tests/helpers/db'

const closeCallbacks: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(closeCallbacks.splice(0).map((close) => close()))
})

const SERVER_ONLY_TABLES = [
  'tickets',
  'ticket_jobs',
  'job_attachments',
  'job_lines',
  'canned_jobs',
  'quote_versions',
  'quote_events',
  'vendor_accounts',
  'messaging_consent_events',
  'messaging_consent_state',
  'sms_suppressions',
  'quote_sends',
  'sms_log',
  'notifications',
  'messaging_deletion_requests',
  'messaging_retention_holds',
] as const

const LEGACY_SERVER_ONLY_TABLES = SERVER_ONLY_TABLES.slice(0, 8)

const APPEND_ONLY_RECEIPT_TABLES = [
  'ticket_mutation_receipts',
  'ticket_mutation_receipt_jobs',
] as const

describe('Shop OS server-only table ACL hardening', () => {
  it('revokes every direct anon and authenticated table privilege without changing service CRUD', async () => {
    const migrationPath = path.join(
      process.cwd(),
      'drizzle/migrations/0032_shop_os_server_only_acl.sql',
    )
    expect(existsSync(migrationPath), 'source migration 0032 must exist').toBe(true)
    const messagingMigrationPath = path.join(
      process.cwd(),
      'drizzle/migrations/0034_shop_os_messaging_retention_acl.sql',
    )
    expect(existsSync(messagingMigrationPath), 'source migration 0034 must exist').toBe(true)
    if (!existsSync(migrationPath) || !existsSync(messagingMigrationPath)) return

    const { client, close } = await createTestDb()
    closeCallbacks.push(close)

    await client.exec(`
      grant truncate, references, trigger, maintain
      on ${SERVER_ONLY_TABLES.map((table) => `public.${table}`).join(', ')}
      to anon, authenticated;
    `)

    const before = await client.query<{ count: number }>(`
      with
        expected_tables(table_name) as (values
          ${SERVER_ONLY_TABLES.map((table) => `('${table}')`).join(', ')}
        ),
        client_roles(role_name) as (values ('anon'), ('authenticated')),
        granted_privileges(privilege_name) as (values
          ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')
        )
      select count(*)::int
      from expected_tables e
      cross join client_roles r
      cross join granted_privileges p
      where has_table_privilege(r.role_name, 'public.' || e.table_name, p.privilege_name)
    `)
    expect(before.rows[0]?.count).toBe(SERVER_ONLY_TABLES.length * 2 * 4)

    await expect(ensureShopOsServerOnlyAclMigration(client)).resolves.toBeUndefined()
    await expect(ensureShopOsServerOnlyAclMigration(client)).resolves.toBeUndefined()
    await expect(ensureMessagingRetentionAclMigration(client)).resolves.toBeUndefined()
    await expect(ensureMessagingRetentionAclMigration(client)).resolves.toBeUndefined()

    const after = await client.query<{ count: number }>(`
      select count(*)::int
      from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name = any(array[${SERVER_ONLY_TABLES.map((table) => `'${table}'`).join(', ')}])
        and grantee in ('anon', 'authenticated')
    `)
    expect(after.rows[0]?.count).toBe(0)

    const service = await client.query<{ table_name: string; crud_count: number }>(`
      select table_name, count(*)::int as crud_count
      from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name = any(array[${SERVER_ONLY_TABLES.map((table) => `'${table}'`).join(', ')}])
        and grantee = 'service_role'
        and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
      group by table_name
      order by table_name
    `)
    expect(service.rows).toEqual(
      [...SERVER_ONLY_TABLES]
        .sort()
        .map((tableName) => ({ table_name: tableName, crud_count: 4 })),
    )
  }, 15_000)

  it('fails closed when a server-only table loses required service CRUD', async () => {
    const { client, close } = await createTestDb()
    closeCallbacks.push(close)

    await client.exec('revoke select on public.vendor_accounts from service_role;')

    await expect(ensureShopOsServerOnlyAclMigration(client)).rejects.toThrow(
      'partial Shop OS server-only ACL in ephemeral database',
    )
  }, 15_000)

  it('fails closed when PUBLIC grants effective client access', async () => {
    const { client, close } = await createTestDb()
    closeCallbacks.push(close)

    await client.exec('grant select on public.tickets to public;')

    await expect(ensureShopOsServerOnlyAclMigration(client)).rejects.toThrow(
      'Shop OS server-only ACL hardening failed in ephemeral database',
    )
  }, 15_000)

  it('keeps the legacy 0032 guard scoped to its original eight tables', () => {
    expect(LEGACY_SERVER_ONLY_TABLES).toEqual([
      'tickets',
      'ticket_jobs',
      'job_attachments',
      'job_lines',
      'canned_jobs',
      'quote_versions',
      'quote_events',
      'vendor_accounts',
    ])
  })

  it('tracks continuity receipts outside the four-CRUD service contract', async () => {
    const { client, close } = await createTestDb()
    closeCallbacks.push(close)

    expect(SERVER_ONLY_TABLES).not.toEqual(
      expect.arrayContaining([...APPEND_ONLY_RECEIPT_TABLES]),
    )
    const service = await client.query<{
      table_name: string
      privileges: string[]
    }>(`
      select table_name, array_agg(privilege_type order by privilege_type) as privileges
      from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name = any(array[
          ${APPEND_ONLY_RECEIPT_TABLES.map((table) => `'${table}'`).join(', ')}
        ])
        and grantee = 'service_role'
      group by table_name
      order by table_name
    `)
    expect(service.rows).toEqual([
      {
        table_name: 'ticket_mutation_receipt_jobs',
        privileges: ['INSERT', 'SELECT'],
      },
      {
        table_name: 'ticket_mutation_receipts',
        privileges: ['INSERT', 'SELECT'],
      },
    ])
  }, 15_000)
})
