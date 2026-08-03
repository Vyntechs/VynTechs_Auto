import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import * as schema from '@/lib/db/schema'
import {
  createTestDb,
  ensureTicketCorrectionMigration,
} from '@/tests/helpers/db'

// A database has to be buildable from nothing. `0047` created two indexes that
// an amended `0045` had already created, so a rebuild from an empty schema died
// there — and nothing caught it, because the ephemeral test database applies a
// hand-picked subset of migrations rather than replaying the folder. This test
// replays every file in order and fails on the first collision, so the next
// amendment that contradicts an earlier migration is caught here instead of by
// whoever next tries to stand up a fresh environment.

const MIGRATIONS = path.join(process.cwd(), 'drizzle/migrations')
const CORRECTION_MIGRATION = path.join(MIGRATIONS, '0051_shop_os_ticket_corrections.sql')
const OLD_DEFINITION = "CHECK ((kind = ANY (ARRAY['work_paused'::text, 'work_resumed'::text, 'job_blocked'::text, 'job_hold_resolved'::text, 'job_reassigned'::text, 'job_handed_off'::text, 'ticket_canceled'::text, 'ticket_reopened'::text])))"
const COMPLETE_DEFINITION = "CHECK ((kind = ANY (ARRAY['work_paused'::text, 'work_resumed'::text, 'job_blocked'::text, 'job_hold_resolved'::text, 'job_reassigned'::text, 'job_handed_off'::text, 'ticket_canceled'::text, 'ticket_reopened'::text, 'ticket_corrected'::text])))"
const OLD_EXPRESSION = "kind in ('work_paused', 'work_resumed', 'job_blocked', 'job_hold_resolved', 'job_reassigned', 'job_handed_off', 'ticket_canceled', 'ticket_reopened')"
const COMPLETE_EXPRESSION = "kind in ('work_paused', 'work_resumed', 'job_blocked', 'job_hold_resolved', 'job_reassigned', 'job_handed_off', 'ticket_canceled', 'ticket_reopened', 'ticket_corrected')"

type ConstraintState = {
  oid: number
  contype: string
  convalidated: boolean
  connoinherit: boolean
  definition: string
}

async function correctionSql(): Promise<string> {
  return (await readFile(CORRECTION_MIGRATION, 'utf8'))
    .replaceAll('--> statement-breakpoint', '')
}

async function constraintState(client: PGlite): Promise<ConstraintState | null> {
  const result = await client.query<ConstraintState>(`
    select oid::int, contype::text, convalidated, connoinherit,
      pg_get_constraintdef(oid) as definition
    from pg_constraint
    where conrelid = to_regclass('public.ticket_activity')
      and conname = 'ticket_activity_kind_valid'
  `)
  return result.rows[0] ?? null
}

async function replaceKindConstraint(
  client: PGlite,
  expression: string | null,
  suffix = '',
): Promise<void> {
  await client.exec('alter table public.ticket_activity drop constraint if exists ticket_activity_kind_valid;')
  if (expression !== null) {
    await client.exec(`alter table public.ticket_activity add constraint ticket_activity_kind_valid check (${expression})${suffix};`)
  }
}

async function emptyDatabase(): Promise<PGlite> {
  const client = new PGlite({ extensions: { vector } })
  // The same two environment stubs the ephemeral test database installs:
  // pgvector for the corpus migration, and Supabase's `auth` schema for the
  // RLS policies. Neither is part of what is under test.
  await client.query('CREATE EXTENSION IF NOT EXISTS vector;')
  await client.query('CREATE SCHEMA IF NOT EXISTS auth;')
  await client.query(
    `CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT '00000000-0000-0000-0000-000000000000'::uuid $$;`,
  )
  // Supabase supplies these roles; the grant migrations reference them by name.
  for (const role of ['anon', 'authenticated', 'service_role', 'postgres']) {
    await client.query(
      `do $$ begin create role ${role}; exception when duplicate_object then null; end $$;`,
    )
  }
  return client
}

describe('migration folder', () => {
  it('bounds the correction DDL and locks before inspecting exact catalog state', async () => {
    const sql = (await readFile(CORRECTION_MIGRATION, 'utf8')).toLowerCase()
    const lockTimeout = sql.indexOf('set local lock_timeout')
    const statementTimeout = sql.indexOf('set local statement_timeout')
    const tableLock = sql.indexOf('lock table public.ticket_activity in access exclusive mode')
    const catalogInspection = sql.indexOf('from pg_constraint')
    const constraintDrop = sql.indexOf('drop constraint ticket_activity_kind_valid')

    expect(lockTimeout).toBeGreaterThanOrEqual(0)
    expect(statementTimeout).toBeGreaterThan(lockTimeout)
    expect(tableLock).toBeGreaterThan(statementTimeout)
    expect(catalogInspection).toBeGreaterThan(tableLock)
    expect(constraintDrop).toBeGreaterThan(catalogInspection)
    expect(sql).toContain("set local lock_timeout = '5s'")
    expect(sql).toContain("set local statement_timeout = '15s'")
  })

  it('applies raw 0051 only from exact-old and refuses raw re-execution', async () => {
    const fixture = await createTestDb()
    try {
      await replaceKindConstraint(fixture.client, OLD_EXPRESSION)
      expect((await constraintState(fixture.client))?.definition).toBe(OLD_DEFINITION)

      const sql = await correctionSql()
      await fixture.client.exec(sql)
      const complete = await constraintState(fixture.client)
      expect(complete).toMatchObject({
        contype: 'c',
        convalidated: true,
        connoinherit: false,
        definition: COMPLETE_DEFINITION,
      })

      await expect(fixture.client.exec(sql)).rejects.toThrow(/exact pre-0051 state/)
      expect(await constraintState(fixture.client)).toEqual(complete)
    } finally {
      await fixture.close()
    }
  })

  it('leaves every non-old raw constraint state byte-for-byte unchanged', async () => {
    const fixture = await createTestDb()
    try {
      const sql = await correctionSql()
      const cases: Array<[string, string | null, string]> = [
        ['complete', COMPLETE_EXPRESSION, ''],
        ['missing', null, ''],
        ['partial', "kind in ('work_paused')", ''],
        ['reordered', "kind in ('ticket_reopened', 'ticket_canceled', 'job_handed_off', 'job_reassigned', 'job_hold_resolved', 'job_blocked', 'work_resumed', 'work_paused')", ''],
        ['unexpected extra', `${OLD_EXPRESSION.slice(0, -1)}, 'future_kind')`, ''],
        ['not validated', OLD_EXPRESSION, ' not valid'],
        ['no inherit', OLD_EXPRESSION, ' no inherit'],
      ]

      for (const [_label, expression, suffix] of cases) {
        await replaceKindConstraint(fixture.client, expression, suffix)
        const before = await constraintState(fixture.client)
        await expect(fixture.client.exec(sql)).rejects.toThrow(/exact pre-0051 state/)
        expect(await constraintState(fixture.client)).toEqual(before)
      }
    } finally {
      await fixture.close()
    }
  })

  it('lets the ephemeral helper apply old, no-op complete, and refuse every other state', async () => {
    const fixture = await createTestDb()
    try {
      const completeBefore = await constraintState(fixture.client)
      await ensureTicketCorrectionMigration(fixture.client)
      expect(await constraintState(fixture.client)).toEqual(completeBefore)

      await replaceKindConstraint(fixture.client, OLD_EXPRESSION)
      await ensureTicketCorrectionMigration(fixture.client)
      expect(await constraintState(fixture.client)).toMatchObject({
        contype: 'c',
        convalidated: true,
        connoinherit: false,
        definition: COMPLETE_DEFINITION,
      })

      const cases: Array<[string, string | null, string]> = [
        ['missing', null, ''],
        ['partial', "kind in ('work_paused')", ''],
        ['reordered', "kind in ('ticket_reopened', 'ticket_canceled', 'job_handed_off', 'job_reassigned', 'job_hold_resolved', 'job_blocked', 'work_resumed', 'work_paused')", ''],
        ['unexpected extra', `${OLD_EXPRESSION.slice(0, -1)}, 'future_kind')`, ''],
        ['not validated', OLD_EXPRESSION, ' not valid'],
        ['no inherit', OLD_EXPRESSION, ' no inherit'],
      ]
      for (const [_label, expression, suffix] of cases) {
        await replaceKindConstraint(fixture.client, expression, suffix)
        const before = await constraintState(fixture.client)
        await expect(ensureTicketCorrectionMigration(fixture.client))
          .rejects.toThrow(/unexpected ticket correction constraint state/)
        expect(await constraintState(fixture.client)).toEqual(before)
      }
    } finally {
      await fixture.close()
    }
  })

  it('rolls back the constraint, rows, triggers, and migration receipt on a post-DDL failure', async () => {
    const fixture = await createTestDb()
    try {
      const [shop] = await fixture.db.insert(schema.shops).values({ name: 'Migration Rollback Shop' }).returning()
      const [actor] = await fixture.db.insert(schema.profiles).values({
        userId: '00000000-0000-4000-8000-000000000701',
        shopId: shop.id,
        fullName: 'Migration Advisor',
        role: 'advisor',
      }).returning()
      const [ticket] = await fixture.db.insert(schema.tickets).values({
        shopId: shop.id,
        ticketNumber: 1,
        source: 'tech_quick',
        concern: 'Migration rollback proof',
        createdByProfileId: actor.id,
      }).returning()
      await fixture.db.insert(schema.ticketActivity).values({
        shopId: shop.id,
        ticketId: ticket.id,
        actorProfileId: actor.id,
        kind: 'ticket_reopened',
        requestKey: '00000000-0000-4000-8000-000000000702',
        payload: {},
      })
      await fixture.client.exec(`
        create table if not exists public.schema_migrations (
          filename text primary key,
          checksum text not null,
          applied_at timestamptz not null default now()
        );
        insert into public.schema_migrations (filename, checksum)
        values ('0050_shop_os_customer_approval_links.sql', 'prior')
        on conflict (filename) do nothing;
      `)
      await replaceKindConstraint(fixture.client, OLD_EXPRESSION)
      const beforeConstraint = await constraintState(fixture.client)
      const beforeTriggers = await fixture.client.query<{ tgname: string; tgenabled: string }>(`
        select tgname, tgenabled
        from pg_trigger
        where tgrelid = to_regclass('public.ticket_activity') and not tgisinternal
        order by tgname
      `)
      const beforeRows = await fixture.client.query<{ count: number }>(
        'select count(*)::int as count from public.ticket_activity',
      )
      const sql = await correctionSql()

      await expect(fixture.client.exec(`
        begin;
        ${sql}
        insert into public.schema_migrations (filename, checksum)
        values ('0051_shop_os_ticket_corrections.sql', 'forced-failure');
        select 1 / 0;
        commit;
      `)).rejects.toThrow()
      await fixture.client.exec('rollback;')

      expect(await constraintState(fixture.client)).toEqual(beforeConstraint)
      expect(await fixture.client.query(`
        select tgname, tgenabled
        from pg_trigger
        where tgrelid = to_regclass('public.ticket_activity') and not tgisinternal
        order by tgname
      `)).toEqual(beforeTriggers)
      expect(await fixture.client.query(
        'select count(*)::int as count from public.ticket_activity',
      )).toEqual(beforeRows)
      expect(await fixture.client.query<{ filename: string }>(`
        select filename from public.schema_migrations order by filename
      `)).toEqual({ rows: [{ filename: '0050_shop_os_customer_approval_links.sql' }], fields: expect.any(Array), affectedRows: 0 })
    } finally {
      await fixture.close()
    }
  })

  it('replays from an empty database without a single collision', async () => {
    const files = (await readdir(MIGRATIONS))
      .filter((file) => file.endsWith('.sql'))
      .sort()
    expect(files.length).toBeGreaterThan(0)

    const client = await emptyDatabase()
    const failures: string[] = []
    try {
      for (const file of files) {
        const sql = await readFile(path.join(MIGRATIONS, file), 'utf8')
        try {
          await client.exec(sql.replaceAll('--> statement-breakpoint', ''))
        } catch (error) {
          const message = String(error instanceof Error ? error.message : error).split('\n')[0]
          failures.push(`${file}: ${message}`)
        }
      }

      const identityColumns = await client.query<{
        column_name: string
        is_nullable: string
      }>(`
        select column_name, is_nullable
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'shops'
          and column_name in (
            'phone', 'address_line_1', 'address_line_2',
            'city', 'region', 'postal_code'
          )
        order by column_name
      `)
      expect(identityColumns.rows).toEqual([
        { column_name: 'address_line_1', is_nullable: 'YES' },
        { column_name: 'address_line_2', is_nullable: 'YES' },
        { column_name: 'city', is_nullable: 'YES' },
        { column_name: 'phone', is_nullable: 'YES' },
        { column_name: 'postal_code', is_nullable: 'YES' },
        { column_name: 'region', is_nullable: 'YES' },
      ])
      expect(await constraintState(client)).toMatchObject({
        contype: 'c',
        convalidated: true,
        connoinherit: false,
        definition: COMPLETE_DEFINITION,
      })
    } finally {
      await client.close()
    }

    expect(failures).toEqual([])
  }, 300_000)
})
