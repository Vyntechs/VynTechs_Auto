import { afterEach, describe, expect, it } from 'vitest'
import {
  createTestDb,
  ensurePublicSchemaClientAclMigration,
} from '../helpers/db'

const closeCallbacks: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(closeCallbacks.splice(0).map((close) => close()))
})

describe('public-schema client ACL migration', () => {
  it('removes legacy and future client privileges while preserving service grants', async () => {
    const { client, close } = await createTestDb()
    closeCallbacks.push(close)

    await client.exec(`
      grant all privileges on all tables in schema public to public, anon, authenticated;

      create or replace function public.rls_auto_enable()
      returns void
      language sql
      security definer
      set search_path = pg_catalog
      as 'select';

      grant execute on function public.rls_auto_enable() to public, anon, authenticated, service_role;
    `)

    const serviceBefore = await client.query<{
      table_name: string
      privilege_type: string
    }>(`
      select table_name, privilege_type
      from information_schema.role_table_grants
      where table_schema = 'public' and grantee = 'service_role'
      order by table_name, privilege_type
    `)

    await expect(ensurePublicSchemaClientAclMigration(client)).resolves.toBeUndefined()
    await expect(ensurePublicSchemaClientAclMigration(client)).resolves.toBeUndefined()

    const existingClientPrivileges = await client.query<{ count: number }>(`
      with client_roles(role_name) as (values ('anon'), ('authenticated')),
      table_privileges(privilege_name) as (values
        ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
        ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
      )
      select count(*)::int
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join client_roles r
      cross join table_privileges p
      where n.nspname = 'public'
        and c.relkind in ('r', 'p')
        and has_table_privilege(r.role_name, c.oid, p.privilege_name)
    `)
    expect(existingClientPrivileges.rows[0]?.count).toBe(0)

    const functionPrivileges = await client.query<{
      anon_execute: boolean
      authenticated_execute: boolean
      service_execute: boolean
    }>(`
      select
        has_function_privilege('anon', 'public.rls_auto_enable()', 'execute') as anon_execute,
        has_function_privilege('authenticated', 'public.rls_auto_enable()', 'execute') as authenticated_execute,
        has_function_privilege('service_role', 'public.rls_auto_enable()', 'execute') as service_execute
    `)
    expect(functionPrivileges.rows[0]).toEqual({
      anon_execute: false,
      authenticated_execute: false,
      service_execute: true,
    })

    const serviceAfter = await client.query<{
      table_name: string
      privilege_type: string
    }>(`
      select table_name, privilege_type
      from information_schema.role_table_grants
      where table_schema = 'public' and grantee = 'service_role'
      order by table_name, privilege_type
    `)
    expect(serviceAfter.rows).toEqual(serviceBefore.rows)

    await client.exec(`
      create table public.acl_future_table_probe(id integer primary key);
      create function public.acl_future_function_probe()
      returns integer language sql as 'select 1';
    `)

    const futurePrivileges = await client.query<{
      anon_table: boolean
      authenticated_table: boolean
      anon_function: boolean
      authenticated_function: boolean
    }>(`
      select
        has_table_privilege('anon', 'public.acl_future_table_probe', 'select') as anon_table,
        has_table_privilege('authenticated', 'public.acl_future_table_probe', 'select') as authenticated_table,
        has_function_privilege('anon', 'public.acl_future_function_probe()', 'execute') as anon_function,
        has_function_privilege('authenticated', 'public.acl_future_function_probe()', 'execute') as authenticated_function
    `)
    expect(futurePrivileges.rows[0]).toEqual({
      anon_table: false,
      authenticated_table: false,
      anon_function: false,
      authenticated_function: false,
    })
  }, 20_000)
})
