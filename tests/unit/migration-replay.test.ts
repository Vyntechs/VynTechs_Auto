import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// A database has to be buildable from nothing. `0047` created two indexes that
// an amended `0045` had already created, so a rebuild from an empty schema died
// there — and nothing caught it, because the ephemeral test database applies a
// hand-picked subset of migrations rather than replaying the folder. This test
// replays every file in order and fails on the first collision, so the next
// amendment that contradicts an earlier migration is caught here instead of by
// whoever next tries to stand up a fresh environment.

const MIGRATIONS = path.join(process.cwd(), 'drizzle/migrations')

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
    } finally {
      await client.close()
    }

    expect(failures).toEqual([])
  }, 300_000)
})
