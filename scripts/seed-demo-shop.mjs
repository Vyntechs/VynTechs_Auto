#!/usr/bin/env node

// ---- Seed the demo shop ----------------------------------------------------
//
// Builds a full day of work in a five-person shop so the product can be looked
// at with something in it. Every repair order is created by the same domain
// code the running application calls; see `scripts/demo-shop-day.ts` for what
// is built and the two rules it follows.
//
// LOCAL ONLY. This script refuses any database that is not on 127.0.0.1 or
// localhost, and refuses the database literally named `postgres`, which on a
// developer machine is the shared Supabase database belonging to another
// project. It never reads production credentials and has no `--production`
// door, unlike `scripts/db-migrate.mjs`.
//
// Usage
//   node scripts/seed-demo-shop.mjs \
//     --database-url postgresql://postgres:postgres@127.0.0.1:54322/vyntechs_demo \
//     --auth-database-url postgresql://postgres:postgres@127.0.0.1:54322/postgres
//
// The demo database must already have the migration folder applied:
//   DATABASE_URL=<demo url> node scripts/db-migrate.mjs apply
//
// `--auth-database-url` is optional and points at the database whose `auth`
// schema the local Supabase auth container serves — normally `postgres` on the
// same server. Given it, the script creates five confirmed sign-ins bound to
// the five demo people. Without it the shop still seeds; nobody can log in.
//
// The demo sign-in password below is a fixed local development constant in the
// same spirit as `postgres:postgres`. It is not a secret and must never be
// used anywhere reachable from a network.

import { createHash } from 'node:crypto'
import { register } from 'node:module'
import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolvePath(SCRIPT_DIR, '..')

export const DEMO_SIGN_IN_PASSWORD = 'demo-shop-local-2026'

/** A local database, and never the one another project's Supabase owns. */
export function refuseNonLocalDatabase(rawUrl, { role }) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return `${role} database URL is not a URL`
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    return `${role} database URL must be a postgres URL`
  }
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
    return `${role} database must be local; refused host ${url.hostname}`
  }
  const database = url.pathname.replace(/^\//, '')
  if (role === 'demo' && (database === 'postgres' || database === '')) {
    return 'refused: `postgres` on a developer machine is another project\'s Supabase database. Create a database of your own and apply the migration folder to it.'
  }
  return null
}

/** Same email in, same auth user id out, so a re-run rebinds rather than duplicates. */
export function demoAuthUserId(email) {
  const bytes = createHash('sha256').update('vyntechs-demo-shop-auth-v1\0').update(email)
    .digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function redactError(error) {
  return String(error instanceof Error ? error.message : error)
    .replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, 'postgres://<REDACTED>@')
}

function parseArgs(argv) {
  const flag = (name) => {
    const index = argv.indexOf(name)
    return index >= 0 ? argv[index + 1] : null
  }
  return {
    databaseUrl: flag('--database-url') ?? process.env.DATABASE_URL ?? null,
    authDatabaseUrl: flag('--auth-database-url') ?? process.env.DEMO_AUTH_DATABASE_URL ?? null,
  }
}

async function withDatabase(url, operation) {
  const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 15, prepare: false })
  try {
    return await operation(sql)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

/**
 * Create or repoint the five demo sign-ins. Written straight into the auth
 * schema rather than through the admin API so the script needs no service key
 * and no running HTTP endpoint — the local container reads the same rows.
 */
async function ensureDemoAuthUsers(authDatabaseUrl, people) {
  return withDatabase(authDatabaseUrl, async (sql) => {
    const [{ present }] = await sql`
      select to_regclass('auth.users') is not null as present
    `
    if (!present) throw new Error('auth database has no auth.users table')

    const ids = {}
    for (const [personKey, person] of Object.entries(people)) {
      const id = demoAuthUserId(person.email)
      // The empty strings are load-bearing. GoTrue scans the token columns into
      // Go strings and a NULL there fails the whole sign-in with "Database
      // error querying schema", which reads like a broken database rather than
      // a row this script wrote badly.
      await sql`
        insert into auth.users (
          instance_id, id, aud, role, email, encrypted_password,
          email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
          confirmation_token, recovery_token, email_change_token_new,
          email_change, email_change_token_current, phone_change,
          phone_change_token, reauthentication_token,
          created_at, updated_at
        ) values (
          '00000000-0000-0000-0000-000000000000'::uuid,
          ${id}::uuid, 'authenticated', 'authenticated', ${person.email}::text,
          extensions.crypt(${DEMO_SIGN_IN_PASSWORD}::text, extensions.gen_salt('bf')),
          now(),
          jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
          jsonb_build_object('full_name', ${person.fullName}::text),
          '', '', '', '', '', '', '', '',
          now(), now()
        )
        on conflict (id) do update set
          email = excluded.email,
          encrypted_password = excluded.encrypted_password,
          email_confirmed_at = now(),
          raw_user_meta_data = excluded.raw_user_meta_data,
          confirmation_token = '',
          recovery_token = '',
          email_change_token_new = '',
          email_change = '',
          email_change_token_current = '',
          phone_change = '',
          phone_change_token = '',
          reauthentication_token = '',
          updated_at = now()
      `
      await sql`
        insert into auth.identities (
          provider_id, user_id, identity_data, provider, created_at, updated_at
        ) values (
          ${id}::text, ${id}::uuid,
          jsonb_build_object('sub', ${id}::text, 'email', ${person.email}::text, 'email_verified', true),
          'email', now(), now()
        )
        on conflict (provider_id, provider) do update set
          identity_data = excluded.identity_data,
          updated_at = now()
      `
      ids[personKey] = id
    }
    return ids
  })
}

async function main() {
  const { databaseUrl, authDatabaseUrl } = parseArgs(process.argv)
  if (!databaseUrl) {
    throw new Error('Set DATABASE_URL or pass --database-url')
  }
  const demoRefusal = refuseNonLocalDatabase(databaseUrl, { role: 'demo' })
  if (demoRefusal) throw new Error(demoRefusal)
  if (authDatabaseUrl) {
    const authRefusal = refuseNonLocalDatabase(authDatabaseUrl, { role: 'auth' })
    if (authRefusal) throw new Error(authRefusal)
  }

  process.env.VYNTECHS_REPO_ROOT = REPO_ROOT
  register(pathToFileURL(resolvePath(SCRIPT_DIR, 'ts-module-hooks.mjs')))
  const day = await import(pathToFileURL(resolvePath(SCRIPT_DIR, 'demo-shop-day.ts')).href)

  const authUserIds = authDatabaseUrl
    ? await ensureDemoAuthUsers(authDatabaseUrl, day.DEMO_PEOPLE)
    : Object.fromEntries(Object.entries(day.DEMO_PEOPLE)
      .map(([personKey, person]) => [personKey, demoAuthUserId(person.email)]))

  const client = postgres(databaseUrl, { max: 4, prepare: false })
  try {
    const schema = await import(pathToFileURL(resolvePath(REPO_ROOT, 'lib/db/schema.ts')).href)
    const db = drizzle(client, { schema })
    const receipt = await day.seedDemoShopDay(db, { authUserIds })
    process.stdout.write(
      `demo shop seeded — repair orders: ${receipt.repairOrders} `
      + `(open ${receipt.open}, closed ${receipt.closed}) · `
      + `jobs: ${receipt.jobs} · saved jobs: ${receipt.cannedJobs}\n`,
    )
    if (authDatabaseUrl) {
      process.stdout.write('\nsign in locally as:\n')
      for (const person of Object.values(day.DEMO_PEOPLE)) {
        process.stdout.write(
          `  ${person.email.padEnd(28)} ${person.fullName} — ${person.role}`
          + `${person.skillTier ? ` (tier ${person.skillTier})` : ''}\n`,
        )
      }
      process.stdout.write(`  password for all five: ${DEMO_SIGN_IN_PASSWORD}\n`)
    } else {
      process.stdout.write('no --auth-database-url given; profiles exist but nobody can sign in\n')
    }
  } finally {
    await client.end({ timeout: 5 })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolvePath(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`seed-demo-shop failed: ${redactError(error)}\n`)
    process.exitCode = 1
  })
}
