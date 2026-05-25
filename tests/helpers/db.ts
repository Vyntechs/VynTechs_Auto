import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite/vector'
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { sql } from 'drizzle-orm'
import fs from 'node:fs/promises'
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
  return {
    db,
    close: async () => {
      await client.close()
    },
  }
}

/**
 * Reads a seed SQL file (relative to project root) and executes each statement
 * against the test DB. Splits on `;` boundaries that are not inside single-quoted
 * strings or line comments, then executes each statement.
 */
export async function applySeedFile(db: TestDb, relativePath: string): Promise<void> {
  const filePath = path.join(process.cwd(), relativePath)
  const content = await fs.readFile(filePath, 'utf-8')

  const statements: string[] = []
  let current = ''
  let inSingleQuote = false
  let inLineComment = false

  for (let i = 0; i < content.length; i++) {
    const ch = content[i]
    const next = content[i + 1]

    if (inLineComment) {
      if (ch === '\n') inLineComment = false
      // never append comment text to current
      continue
    }

    if (!inSingleQuote && ch === '-' && next === '-') {
      inLineComment = true
      i++ // skip second '-'
      continue
    }

    if (ch === "'" && !inLineComment) {
      inSingleQuote = !inSingleQuote
    }

    if (ch === ';' && !inSingleQuote) {
      const stmt = current.trim()
      if (stmt.length > 0) statements.push(stmt)
      current = ''
      continue
    }

    current += ch
  }

  const trailing = current.trim()
  if (trailing.length > 0) statements.push(trailing)

  for (const stmt of statements) {
    await db.execute(sql.raw(stmt))
  }
}
