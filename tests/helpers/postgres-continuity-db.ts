import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import postgres, { type Sql } from 'postgres'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@/lib/db/schema'

export type PostgresContinuityDb = PostgresJsDatabase<typeof schema>

export type PostgresContinuityHarness = Readonly<{
  clientA: Sql
  clientB: Sql
  dbA: PostgresContinuityDb
  dbB: PostgresContinuityDb
  migrationFiles: readonly string[]
  cleanup: () => Promise<void>
}>

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])
const MIGRATION_FILE = /^\d{4}[a-z]?_.+\.sql$/

export function assertContinuityPostgresUrlV1(rawUrl: string | undefined): URL {
  if (!rawUrl) throw new Error('CONTINUITY_POSTGRES_URL is required')
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error('CONTINUITY_POSTGRES_URL must be a valid PostgreSQL URL')
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('CONTINUITY_POSTGRES_URL must use PostgreSQL')
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error('CONTINUITY_POSTGRES_URL must use a loopback host')
  }
  if (decodeURIComponent(parsed.pathname) !== '/continuity_test') {
    throw new Error('CONTINUITY_POSTGRES_URL database must be continuity_test')
  }
  return parsed
}

async function sourceMigrationFiles(): Promise<string[]> {
  const directory = resolve(process.cwd(), 'drizzle/migrations')
  const files = (await readdir(directory))
    .filter((file) => MIGRATION_FILE.test(file))
    .sort((left, right) => left.localeCompare(right))
  if (files[0] !== '0000_whole_domino.sql') {
    throw new Error('continuity PostgreSQL migration inventory must start at 0000')
  }
  if (files.at(-1) !== '0037_shop_os_continuity_foundation.sql') {
    throw new Error('continuity PostgreSQL migration inventory must end at 0037')
  }
  return files
}

async function bootstrapSupabaseCompatibility(client: Sql): Promise<void> {
  await client.unsafe(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then
        create role service_role nologin;
      end if;
    end $$;
    create extension if not exists vector;
    create schema if not exists auth;
    create or replace function auth.uid()
      returns uuid language sql stable
      as $$ select '00000000-0000-0000-0000-000000000000'::uuid $$;
  `)
}

async function applySourceMigrations(
  client: Sql,
  migrationFiles: readonly string[],
): Promise<void> {
  const directory = resolve(process.cwd(), 'drizzle/migrations')
  for (const file of migrationFiles) {
    const sql = await readFile(resolve(directory, file), 'utf8')
    await client.unsafe(sql.replaceAll('--> statement-breakpoint', ''))
  }
}

export async function createPostgresContinuityDb(
  rawUrl = process.env.CONTINUITY_POSTGRES_URL,
): Promise<PostgresContinuityHarness> {
  const url = assertContinuityPostgresUrlV1(rawUrl).toString()
  const migrationFiles = await sourceMigrationFiles()
  const admin = postgres(url, { max: 1, prepare: false })
  try {
    await bootstrapSupabaseCompatibility(admin)
    await applySourceMigrations(admin, migrationFiles)
  } finally {
    await admin.end({ timeout: 5 })
  }

  const clientA = postgres(url, { max: 1, prepare: false })
  const clientB = postgres(url, { max: 1, prepare: false })
  return Object.freeze({
    clientA,
    clientB,
    dbA: drizzle(clientA, { schema }),
    dbB: drizzle(clientB, { schema }),
    migrationFiles: Object.freeze([...migrationFiles]),
    cleanup: async () => {
      await Promise.all([
        clientA.end({ timeout: 5 }),
        clientB.end({ timeout: 5 }),
      ])
    },
  })
}
