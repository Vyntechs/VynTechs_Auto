import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@/lib/db/schema'

export type PostgresContinuityDb = PostgresJsDatabase<typeof schema>

export type PostgresContinuityHarness = Readonly<{
  clientA: Sql
  clientB: Sql
  observer: Sql
  dbA: PostgresContinuityDb
  dbB: PostgresContinuityDb
  databaseName: string
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

async function bootstrapClusterRoles(client: Sql): Promise<void> {
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
  `)
}

async function bootstrapSupabaseCompatibility(client: Sql): Promise<void> {
  await client.unsafe(`
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
  const baseUrl = assertContinuityPostgresUrlV1(rawUrl)
  const databaseName = `continuity_test_${process.pid}_${randomUUID().replaceAll('-', '')}`
  const derivedUrl = new URL(baseUrl)
  derivedUrl.pathname = `/${databaseName}`
  const migrationFiles = await sourceMigrationFiles()
  const baseAdmin = postgres(baseUrl.toString(), { max: 1, prepare: false })
  let databaseCreated = false
  let migrationAdmin: Sql | null = null
  try {
    await bootstrapClusterRoles(baseAdmin)
    await baseAdmin.unsafe(`create database "${databaseName}"`)
    databaseCreated = true
    migrationAdmin = postgres(derivedUrl.toString(), { max: 1, prepare: false })
    await bootstrapSupabaseCompatibility(migrationAdmin)
    await applySourceMigrations(migrationAdmin, migrationFiles)
    await migrationAdmin.end({ timeout: 5 })
    migrationAdmin = null
  } catch (error) {
    await migrationAdmin?.end({ timeout: 5 }).catch(() => undefined)
    if (databaseCreated) {
      await baseAdmin.unsafe(`drop database if exists "${databaseName}" with (force)`)
        .catch(() => undefined)
    }
    await baseAdmin.end({ timeout: 5 })
    throw error
  }

  const clientA = postgres(derivedUrl.toString(), { max: 1, prepare: false })
  const clientB = postgres(derivedUrl.toString(), { max: 1, prepare: false })
  const observer = postgres(derivedUrl.toString(), { max: 1, prepare: false })
  let cleaned = false
  return Object.freeze({
    clientA,
    clientB,
    observer,
    dbA: drizzle(clientA, { schema }),
    dbB: drizzle(clientB, { schema }),
    databaseName,
    migrationFiles: Object.freeze([...migrationFiles]),
    cleanup: async () => {
      if (cleaned) return
      cleaned = true
      await Promise.all([
        clientA.end({ timeout: 5 }),
        clientB.end({ timeout: 5 }),
        observer.end({ timeout: 5 }),
      ])
      await baseAdmin`
        select pg_terminate_backend(pid)
        from pg_stat_activity
        where datname = ${databaseName} and pid <> pg_backend_pid()
      `
      await baseAdmin.unsafe(`drop database if exists "${databaseName}"`)
      await baseAdmin.end({ timeout: 5 })
    },
  })
}
