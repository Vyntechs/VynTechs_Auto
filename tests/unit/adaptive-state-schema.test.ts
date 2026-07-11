import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { afterEach, describe, expect, it } from 'vitest'

const closeCallbacks: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(closeCallbacks.splice(0).map((close) => close()))
})

const IDs = {
  shop: '10000000-0000-0000-0000-000000000001',
  tech: '20000000-0000-0000-0000-000000000001',
  actor: '20000000-0000-0000-0000-000000000002',
  otherActor: '20000000-0000-0000-0000-000000000003',
  techUser: '30000000-0000-0000-0000-000000000001',
  actorUser: '30000000-0000-0000-0000-000000000002',
  otherActorUser: '30000000-0000-0000-0000-000000000003',
  session: '40000000-0000-0000-0000-000000000001',
  requestKey: '50000000-0000-0000-0000-000000000001',
} as const

async function createPre0029Db() {
  const client = new PGlite({ extensions: { vector } })
  await client.query('CREATE EXTENSION IF NOT EXISTS vector;')
  await client.exec('CREATE SCHEMA IF NOT EXISTS auth;')
  await client.exec(`CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT '00000000-0000-0000-0000-000000000000'::uuid $$;`)

  const journal = JSON.parse(
    await readFile(path.join(process.cwd(), 'drizzle/migrations/meta/_journal.json'), 'utf8'),
  ) as { entries: Array<{ tag: string }> }
  for (const entry of journal.entries) {
    const migration = await readFile(
      path.join(process.cwd(), `drizzle/migrations/${entry.tag}.sql`),
      'utf8',
    )
    await client.exec(migration.replaceAll('--> statement-breakpoint', ''))
  }

  await client.exec(`
    insert into shops (id, name)
      values ('${IDs.shop}'::uuid, 'Existing shop');
    insert into profiles (id, user_id, shop_id, full_name) values
      ('${IDs.tech}'::uuid, '${IDs.techUser}'::uuid, '${IDs.shop}'::uuid, 'Existing tech'),
      ('${IDs.actor}'::uuid, '${IDs.actorUser}'::uuid, '${IDs.shop}'::uuid, 'Request actor'),
      ('${IDs.otherActor}'::uuid, '${IDs.otherActorUser}'::uuid, '${IDs.shop}'::uuid, 'Other actor');
    insert into sessions (id, shop_id, tech_id, intake, tree_state)
      values ('${IDs.session}'::uuid, '${IDs.shop}'::uuid, '${IDs.tech}'::uuid, '{}'::jsonb, '{}'::jsonb);
    insert into session_events (session_id, node_id, event_type) values
      ('${IDs.session}'::uuid, 'legacy-1', 'observation'),
      ('${IDs.session}'::uuid, 'legacy-2', 'observation');
  `)

  return client
}

async function applyAdaptiveMigration(client: PGlite) {
  const migration = await readFile(
    path.join(process.cwd(), 'drizzle/migrations/0029_adaptive_diagnostic_state.sql'),
    'utf8',
  )
  await client.exec(migration.replaceAll('--> statement-breakpoint', ''))
}

describe('adaptive diagnostic state source migration', () => {
  it('adds nullable object state and revision zero without changing existing rows', async () => {
    const client = await createPre0029Db()
    closeCallbacks.push(() => client.close())

    await applyAdaptiveMigration(client)

    const columns = await client.query<{
      column_name: string
      data_type: string
      is_nullable: string
      column_default: string | null
    }>(`
      select column_name, data_type, is_nullable, column_default
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'sessions'
        and column_name in ('adaptive_diagnostic_state', 'adaptive_revision')
      order by column_name
    `)
    expect(columns.rows).toEqual([
      {
        column_name: 'adaptive_diagnostic_state',
        data_type: 'jsonb',
        is_nullable: 'YES',
        column_default: null,
      },
      {
        column_name: 'adaptive_revision',
        data_type: 'bigint',
        is_nullable: 'NO',
        column_default: '0',
      },
    ])

    const existing = await client.query<{
      adaptive_diagnostic_state: unknown
      adaptive_revision: string
    }>(`
      select adaptive_diagnostic_state, adaptive_revision::text as adaptive_revision
      from sessions where id = '${IDs.session}'::uuid
    `)
    expect(existing.rows).toEqual([
      { adaptive_diagnostic_state: null, adaptive_revision: '0' },
    ])

    const counts = await client.query<{ sessions: number; events: number }>(`
      select
        (select count(*)::int from sessions) as sessions,
        (select count(*)::int from session_events) as events
    `)
    expect(counts.rows[0]).toEqual({ sessions: 1, events: 2 })
  })

  it('accepts only JSON objects for adaptive state', async () => {
    const client = await createPre0029Db()
    closeCallbacks.push(() => client.close())
    await applyAdaptiveMigration(client)

    await expect(client.exec(`
      update sessions set adaptive_diagnostic_state = '[]'::jsonb
      where id = '${IDs.session}'::uuid
    `)).rejects.toThrow()
    await expect(client.exec(`
      update sessions set adaptive_diagnostic_state = '"guided"'::jsonb
      where id = '${IDs.session}'::uuid
    `)).rejects.toThrow()
    await client.exec(`
      update sessions set adaptive_diagnostic_state = '{"schemaVersion":1}'::jsonb
      where id = '${IDs.session}'::uuid
    `)
  })

  it('requires actor request metadata as one all-null or all-present set', async () => {
    const client = await createPre0029Db()
    closeCallbacks.push(() => client.close())
    await applyAdaptiveMigration(client)

    const partialValues = [
      `'${IDs.requestKey}'::uuid, null, null`,
      `null, '${IDs.actor}'::uuid, null`,
      `null, null, 'fingerprint'`,
      `'${IDs.requestKey}'::uuid, '${IDs.actor}'::uuid, null`,
      `'${IDs.requestKey}'::uuid, null, 'fingerprint'`,
      `null, '${IDs.actor}'::uuid, 'fingerprint'`,
    ]
    for (const values of partialValues) {
      await expect(client.exec(`
        insert into session_events
          (session_id, node_id, event_type, request_key, request_actor_profile_id, request_fingerprint)
        values ('${IDs.session}'::uuid, 'partial', 'adaptive_evidence', ${values})
      `)).rejects.toThrow()
    }

    await client.exec(`
      insert into session_events (session_id, node_id, event_type)
      values ('${IDs.session}'::uuid, 'legacy-3', 'observation');
      insert into session_events
        (session_id, node_id, event_type, request_key, request_actor_profile_id, request_fingerprint)
      values
        ('${IDs.session}'::uuid, 'actor-a', 'adaptive_evidence', '${IDs.requestKey}'::uuid, '${IDs.actor}'::uuid, 'fingerprint-a'),
        ('${IDs.session}'::uuid, 'actor-b', 'adaptive_evidence', '${IDs.requestKey}'::uuid, '${IDs.otherActor}'::uuid, 'fingerprint-b');
    `)

    await expect(client.exec(`
      insert into session_events
        (session_id, node_id, event_type, request_key, request_actor_profile_id, request_fingerprint)
      values
        ('${IDs.session}'::uuid, 'duplicate', 'adaptive_evidence', '${IDs.requestKey}'::uuid, '${IDs.actor}'::uuid, 'fingerprint-a')
    `)).rejects.toThrow()

    const nullMetadata = await client.query<{ count: number }>(`
      select count(*)::int as count from session_events
      where request_key is null
        and request_actor_profile_id is null
        and request_fingerprint is null
    `)
    expect(nullMetadata.rows[0]).toEqual({ count: 3 })
  })

  it('restricts deletion of profiles referenced as request actors', async () => {
    const client = await createPre0029Db()
    closeCallbacks.push(() => client.close())
    await applyAdaptiveMigration(client)

    await client.exec(`
      insert into session_events
        (session_id, node_id, event_type, request_key, request_actor_profile_id, request_fingerprint)
      values
        ('${IDs.session}'::uuid, 'actor-a', 'adaptive_evidence', '${IDs.requestKey}'::uuid, '${IDs.actor}'::uuid, 'fingerprint-a')
    `)

    await expect(client.exec(`
      delete from profiles where id = '${IDs.actor}'::uuid
    `)).rejects.toThrow()

    const foreignKey = await client.query<{ delete_action: string }>(`
      select confdeltype::text as delete_action
      from pg_constraint
      where conrelid = 'session_events'::regclass
        and conname = 'session_events_request_actor_profile_id_fkey'
    `)
    expect(foreignKey.rows[0]).toEqual({ delete_action: 'r' })
  })
})
