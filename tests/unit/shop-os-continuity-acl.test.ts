import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTestDb } from '@/tests/helpers/db'

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

const IDs = {
  shop: 'a0000000-0000-0000-0000-000000000001',
  shop2: 'a0000000-0000-0000-0000-000000000002',
  profile: 'b0000000-0000-0000-0000-000000000001',
  profile2: 'b0000000-0000-0000-0000-000000000002',
  user: 'c0000000-0000-0000-0000-000000000001',
  user2: 'c0000000-0000-0000-0000-000000000002',
  ticket: 'd0000000-0000-0000-0000-000000000001',
  ticket2: 'd0000000-0000-0000-0000-000000000002',
  job: 'e0000000-0000-0000-0000-000000000001',
  job2: 'e0000000-0000-0000-0000-000000000002',
  receipt: 'f0000000-0000-0000-0000-000000000001',
  receipt2: 'f0000000-0000-0000-0000-000000000002',
  receipt3: 'f0000000-0000-0000-0000-000000000003',
  receipt0: 'f0000000-0000-0000-0000-000000000004',
  request: '01000000-0000-0000-0000-000000000001',
  request2: '01000000-0000-0000-0000-000000000002',
  request3: '01000000-0000-0000-0000-000000000003',
  request0: '01000000-0000-0000-0000-000000000004',
} as const

const HASH = 'a'.repeat(64)

async function seedReceiptParents(client: Awaited<ReturnType<typeof createTestDb>>['client']) {
  await client.exec(`
    insert into shops (id, name) values
      ('${IDs.shop}', 'Receipt shop'),
      ('${IDs.shop2}', 'Other shop');
    insert into profiles (id, user_id, shop_id, full_name) values
      ('${IDs.profile}', '${IDs.user}', '${IDs.shop}', 'Receipt actor'),
      ('${IDs.profile2}', '${IDs.user2}', '${IDs.shop2}', 'Other actor');
    insert into tickets (id, shop_id, ticket_number, source, concern, created_by_profile_id) values
      ('${IDs.ticket}', '${IDs.shop}', 1, 'tech_quick', 'Receipt ticket', '${IDs.profile}'),
      ('${IDs.ticket2}', '${IDs.shop2}', 1, 'tech_quick', 'Other ticket', '${IDs.profile2}');
    insert into ticket_jobs
      (id, shop_id, ticket_id, title, kind, required_skill_tier,
       created_by_profile_id, creator_provenance, sequence_number)
    values
      ('${IDs.job}', '${IDs.shop}', '${IDs.ticket}', 'Receipt job', 'repair', 1,
       '${IDs.profile}', 'direct', 1),
      ('${IDs.job2}', '${IDs.shop2}', '${IDs.ticket2}', 'Other job', 'repair', 1,
       '${IDs.profile2}', 'direct', 1);
  `)
}

describe('Shop OS continuity ACL source guards', () => {
  it('declares immutable, deferred-completeness, and lifecycle-only trigger contracts', async () => {
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
    const normalized = migration.replace(/\s+/g, ' ').toLowerCase()

    expect(journal.entries).toHaveLength(31)
    expect(journal.entries.at(-1)).toMatchObject({
      idx: 30,
      tag: '0028_shop_os_quote_foundation',
    })
    expect(createHash('sha256').update(journalSource).digest('hex')).toBe(
      JOURNAL_SHA256,
    )
    expect(schema).toContain('export const tickets = pgTable(')
    expect(schema).toContain('export const ticketJobs = pgTable(')
    expect(schema).toContain('export const quoteEvents = pgTable(')
    expect(migration, 'source migration 0037 must exist').not.toBe('')

    for (const contract of [
      'guard_ticket_terminal_shape()',
      'tickets_terminal_shape_write',
      'guard_ticket_immutable_identity()',
      'tickets_immutable_identity_update',
      'guard_ticket_job_immutable_identity()',
      'ticket_jobs_immutable_identity_update',
      'immutable_ticket_mutation_receipt',
      'incomplete_ticket_mutation_receipt',
    ]) {
      expect(normalized.includes(contract), contract).toBe(true)
    }
    expect(normalized).toContain('deferrable initially deferred')
    expect(normalized).not.toContain('add constraint tickets_terminal_shape')
  })

  it('denies direct receipt access and grants service inserts and reads only', async () => {
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

    expect(journal).not.toContain('0037_shop_os_continuity_foundation')
    expect(schema.includes('ticketMutationReceipts'), 'ticketMutationReceipts').toBe(true)
    expect(schema.includes('ticketMutationReceiptJobs'), 'ticketMutationReceiptJobs').toBe(true)
    for (const table of [
      'ticket_mutation_receipts',
      'ticket_mutation_receipt_jobs',
    ]) {
      expect(normalized).toContain(
        `alter table public.${table} enable row level security`,
      )
      expect(normalized).toContain(
        `revoke all privileges on table public.${table} from public, anon, authenticated, service_role`,
      )
      expect(normalized).toContain(
        `grant select, insert on table public.${table} to service_role`,
      )
      expect(normalized).not.toContain(
        `grant select, insert, update, delete on table public.${table} to service_role`,
      )
      expect(normalized).toContain(`${table}_server_only_deny_direct`)
    }
    expect(normalized).toContain("set search_path = ''")
    expect(normalized).toMatch(
      /revoke all on function public\.guard_ticket_terminal_shape\(\) from public, anon, authenticated, service_role/,
    )
  })

  it('enforces exact effective receipt ACLs, deny policies, hardened functions, and trigger bindings', async () => {
    const { client, close } = await createTestDb()
    try {
      const privileges = await client.query<{
        role_name: string
        table_name: string
        privileges: string[]
      }>(`
        with roles(role_name) as (
          values ('anon'), ('authenticated'), ('service_role')
        ), tables(table_name) as (
          values ('ticket_mutation_receipts'), ('ticket_mutation_receipt_jobs')
        ), privileges(privilege_name) as (
          values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                 ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')
        )
        select role_name, table_name,
               coalesce(array_agg(privilege_name order by privilege_name)
                 filter (where has_table_privilege(
                   role_name, 'public.' || table_name, privilege_name
                 )), '{}') as privileges
        from roles cross join tables cross join privileges
        group by role_name, table_name
        order by role_name, table_name
      `)
      expect(privileges.rows).toEqual([
        { role_name: 'anon', table_name: 'ticket_mutation_receipt_jobs', privileges: [] },
        { role_name: 'anon', table_name: 'ticket_mutation_receipts', privileges: [] },
        { role_name: 'authenticated', table_name: 'ticket_mutation_receipt_jobs', privileges: [] },
        { role_name: 'authenticated', table_name: 'ticket_mutation_receipts', privileges: [] },
        { role_name: 'service_role', table_name: 'ticket_mutation_receipt_jobs', privileges: ['INSERT', 'SELECT'] },
        { role_name: 'service_role', table_name: 'ticket_mutation_receipts', privileges: ['INSERT', 'SELECT'] },
      ])

      const policies = await client.query<Record<string, unknown>>(`
        select tablename, policyname, roles::text as roles, cmd,
               qual, with_check
        from pg_policies
        where schemaname = 'public'
          and tablename in ('ticket_mutation_receipts', 'ticket_mutation_receipt_jobs')
        order by tablename
      `)
      expect(policies.rows).toEqual([
        {
          tablename: 'ticket_mutation_receipt_jobs',
          policyname: 'ticket_mutation_receipt_jobs_server_only_deny_direct',
          roles: '{anon,authenticated}',
          cmd: 'ALL',
          qual: 'false',
          with_check: 'false',
        },
        {
          tablename: 'ticket_mutation_receipts',
          policyname: 'ticket_mutation_receipts_server_only_deny_direct',
          roles: '{anon,authenticated}',
          cmd: 'ALL',
          qual: 'false',
          with_check: 'false',
        },
      ])

      const functions = await client.query<Record<string, unknown>>(`
        select p.proname, pg_get_userbyid(p.proowner) as owner, p.proconfig,
               has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
               has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
               has_function_privilege('service_role', p.oid, 'EXECUTE') as service_execute
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in (
            'guard_ticket_terminal_shape',
            'guard_ticket_immutable_identity',
            'guard_ticket_job_immutable_identity',
            'reject_ticket_mutation_receipt_mutation',
            'enforce_ticket_mutation_receipt_complete'
          )
        order by p.proname
      `)
      expect(functions.rows).toHaveLength(5)
      for (const fn of functions.rows) {
        expect(fn).toMatchObject({
          owner: 'postgres',
          proconfig: ['search_path=""'],
          anon_execute: false,
          authenticated_execute: false,
          service_execute: false,
        })
      }
      const publicExecute = await client.query<{ proname: string }>(`
        select p.proname
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
          on acl.privilege_type = 'EXECUTE' and acl.grantee = 0
        where n.nspname = 'public'
          and p.proname in (
            'guard_ticket_terminal_shape',
            'guard_ticket_immutable_identity',
            'guard_ticket_job_immutable_identity',
            'reject_ticket_mutation_receipt_mutation',
            'enforce_ticket_mutation_receipt_complete'
          )
      `)
      expect(publicExecute.rows).toEqual([])

      const triggers = await client.query<{ tgname: string }>(`
        select tgname
        from pg_trigger
        where not tgisinternal and tgname in (
          'tickets_terminal_shape_write',
          'tickets_immutable_identity_update',
          'ticket_jobs_immutable_identity_update',
          'ticket_mutation_receipts_immutable_write',
          'ticket_mutation_receipt_jobs_immutable_write',
          'ticket_mutation_receipts_complete_deferred',
          'ticket_mutation_receipt_jobs_complete_deferred'
        )
        order by tgname
      `)
      expect(triggers.rows.map(({ tgname }) => tgname)).toEqual([
        'ticket_jobs_immutable_identity_update',
        'ticket_mutation_receipt_jobs_complete_deferred',
        'ticket_mutation_receipt_jobs_immutable_write',
        'ticket_mutation_receipts_complete_deferred',
        'ticket_mutation_receipts_immutable_write',
        'tickets_immutable_identity_update',
        'tickets_terminal_shape_write',
      ])
    } finally {
      await close()
    }
  }, 30_000)

  it('keeps receipts immutable and proves deferred ordinal completeness at commit', async () => {
    const { client, close } = await createTestDb()
    try {
      await seedReceiptParents(client)
      await client.exec('begin')
      await client.exec(`
        insert into ticket_mutation_receipts
          (id, shop_id, request_key, mutation_schema_version, fingerprint_key_version,
           mutation_kind, actor_profile_id, target_binding_fingerprint,
           request_fingerprint, result_ticket_id, result_job_count)
        values
          ('${IDs.receipt}', '${IDs.shop}', '${IDs.request}', 1, 1,
           'create_repair_order', '${IDs.profile}', '${HASH}', '${HASH}',
           '${IDs.ticket}', 1)
      `)
      await client.exec(`
        insert into ticket_mutation_receipt_jobs
          (shop_id, receipt_id, result_ticket_id, result_job_count, ordinal, job_id)
        values
          ('${IDs.shop}', '${IDs.receipt}', '${IDs.ticket}', 1, 0, '${IDs.job}')
      `)
      await client.exec('commit')

      await client.exec('begin')
      await client.exec(`
        insert into ticket_mutation_receipts
          (id, shop_id, request_key, mutation_schema_version, fingerprint_key_version,
           mutation_kind, actor_profile_id, target_binding_fingerprint,
           request_fingerprint, result_ticket_id, result_job_count)
        values
          ('${IDs.receipt0}', '${IDs.shop}', '${IDs.request0}', 1, 1,
           'append_work_items', '${IDs.profile}', '${HASH}', '${HASH}',
           '${IDs.ticket}', 0)
      `)
      await expect(client.exec('commit')).resolves.toBeDefined()

      await expect(client.exec(`
        update ticket_mutation_receipts set mutation_schema_version = 1
        where id = '${IDs.receipt}'
      `)).rejects.toThrow(/immutable_ticket_mutation_receipt/)
      await expect(client.exec(`
        delete from ticket_mutation_receipt_jobs where receipt_id = '${IDs.receipt}'
      `)).rejects.toThrow(/immutable_ticket_mutation_receipt/)
    } finally {
      await close()
    }

    const gapDb = await createTestDb()
    try {
      await seedReceiptParents(gapDb.client)
      await gapDb.client.exec('begin')
      await gapDb.client.exec(`
        insert into ticket_mutation_receipts
          (id, shop_id, request_key, mutation_schema_version, fingerprint_key_version,
           mutation_kind, actor_profile_id, target_binding_fingerprint,
           request_fingerprint, result_ticket_id, result_job_count)
        values
          ('${IDs.receipt2}', '${IDs.shop}', '${IDs.request2}', 1, 1,
           'append_work_items', '${IDs.profile}', '${HASH}', '${HASH}',
           '${IDs.ticket}', 2)
      `)
      await gapDb.client.exec(`
        insert into ticket_mutation_receipt_jobs
          (shop_id, receipt_id, result_ticket_id, result_job_count, ordinal, job_id)
        values
          ('${IDs.shop}', '${IDs.receipt2}', '${IDs.ticket}', 2, 0, '${IDs.job}')
      `)
      await expect(gapDb.client.exec('commit')).rejects.toThrow(
        /incomplete_ticket_mutation_receipt/,
      )
    } finally {
      await gapDb.close()
    }
  }, 30_000)

  it('rejects mismatched receipt headers and result jobs by their composite constraints', async () => {
    const { client, close } = await createTestDb()
    try {
      await seedReceiptParents(client)
      await client.exec('begin')
      await client.exec(`
        insert into ticket_mutation_receipts
          (id, shop_id, request_key, mutation_schema_version, fingerprint_key_version,
           mutation_kind, actor_profile_id, target_binding_fingerprint,
           request_fingerprint, result_ticket_id, result_job_count)
        values
          ('${IDs.receipt3}', '${IDs.shop}', '${IDs.request3}', 1, 1,
           'append_work_items', '${IDs.profile}', '${HASH}', '${HASH}',
           '${IDs.ticket}', 1)
      `)

      await client.exec('savepoint out_of_range')
      await expect(client.exec(`
        insert into ticket_mutation_receipt_jobs
          (shop_id, receipt_id, result_ticket_id, result_job_count, ordinal, job_id)
        values
          ('${IDs.shop}', '${IDs.receipt3}', '${IDs.ticket}', 1, 1, '${IDs.job}')
      `)).rejects.toThrow(/ticket_mutation_receipt_jobs_ordinal_range/)
      await client.exec('rollback to savepoint out_of_range')

      await client.exec('savepoint wrong_header')
      await expect(client.exec(`
        insert into ticket_mutation_receipt_jobs
          (shop_id, receipt_id, result_ticket_id, result_job_count, ordinal, job_id)
        values
          ('${IDs.shop}', '${IDs.receipt3}', '${IDs.ticket}', 2, 0, '${IDs.job}')
      `)).rejects.toThrow(/ticket_mutation_receipt_jobs_receipt_ticket_fk/)
      await client.exec('rollback to savepoint wrong_header')

      await client.exec('savepoint wrong_job')
      await expect(client.exec(`
        insert into ticket_mutation_receipt_jobs
          (shop_id, receipt_id, result_ticket_id, result_job_count, ordinal, job_id)
        values
          ('${IDs.shop}', '${IDs.receipt3}', '${IDs.ticket}', 1, 0, '${IDs.job2}')
      `)).rejects.toThrow(/ticket_mutation_receipt_jobs_job_fk/)
      await client.exec('rollback to savepoint wrong_job')
      await client.exec('rollback')
    } finally {
      await close()
    }
  }, 30_000)

  it('applies from zero, no-ops when complete, and fails closed on marker drift', async () => {
    const helpers = await import('@/tests/helpers/db')
    const ensure = (
      helpers as typeof helpers & {
        ensureRepairOrderContinuityMigration?: (
          client: Awaited<ReturnType<typeof createTestDb>>['client'],
        ) => Promise<void>
      }
    ).ensureRepairOrderContinuityMigration
    expect(typeof ensure, 'continuity ensure export').toBe('function')
    if (!ensure) return

    const { client, close } = await createTestDb()
    try {
      await expect(ensure(client)).resolves.toBeUndefined()
    } finally {
      await close()
    }

    const drifts = [
      'alter table public.tickets alter column projection_revision drop default',
      'alter table public.tickets drop constraint tickets_projection_revision_nonnegative',
      'drop index public.tickets_shop_vehicle_status_idx',
      `drop policy ticket_mutation_receipts_server_only_deny_direct
        on public.ticket_mutation_receipts`,
      `create policy ticket_mutation_receipts_unexpected_allow
        on public.ticket_mutation_receipts for select to authenticated using (true)`,
      'grant update on table public.ticket_mutation_receipts to service_role',
      'alter function public.guard_ticket_terminal_shape() reset search_path',
      'alter table public.tickets disable trigger tickets_terminal_shape_write',
      `drop trigger tickets_terminal_shape_write on public.tickets;
       create trigger tickets_terminal_shape_write
       before insert or update of status, canceled_at, canceled_by_profile_id,
         canceled_reason, cancel_reason_code, delivered_at, delivered_by_profile_id,
         closed_at, closed_by_profile_id, close_disposition, close_note
       on public.tickets for each row when (false)
       execute function public.guard_ticket_terminal_shape()`,
    ]
    for (const drift of drifts) {
      const driftDb = await createTestDb()
      try {
        await driftDb.client.exec(drift)
        await expect(ensure(driftDb.client)).rejects.toThrow(
          'partial repair order continuity schema in ephemeral database',
        )
      } finally {
        await driftDb.close()
      }
    }
  }, 30_000)
})
