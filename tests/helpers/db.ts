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
  return {
    db,
    close: async () => {
      await client.close()
    },
  }
}
