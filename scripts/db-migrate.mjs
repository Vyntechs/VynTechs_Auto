#!/usr/bin/env node

// ---- Migration runner ------------------------------------------------------
//
// This repository writes its migrations by hand and applies them in filename
// order. Drizzle's journal was frozen at `0028` and its snapshot chain broke
// long before that, so `drizzle-kit migrate` silently builds a database twenty
// migrations behind and `drizzle-kit generate` cannot be trusted to diff. The
// deploy runbook already told a human to apply the files in order by hand.
//
// This makes that real system explicit, so a database records what it has
// applied instead of a person remembering. Three things it deliberately does:
//
//   * Refuses to apply anything to a database that already has application
//     tables but no ledger. That combination means "an existing database that
//     has never been recorded," and blindly applying 51 migrations to it is the
//     single worst thing this script could do. `baseline` is the way in.
//   * Records a checksum per file and refuses to apply while a recorded file
//     differs on disk. An edit to an already-applied migration is exactly how
//     `0045` and `0047` came to create the same indexes twice.
//   * Applies each file in its own transaction, so a failure leaves the
//     database and the ledger agreeing with each other.

import { createHash } from 'node:crypto'
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

import postgres from 'postgres'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '..')
const MIGRATIONS_DIR = join(REPO_ROOT, 'drizzle/migrations')

export const LEDGER_TABLE = 'public.schema_migrations'

export const CREATE_LEDGER_SQL = `
create table if not exists ${LEDGER_TABLE} (
  filename text primary key,
  checksum text not null,
  applied_at timestamptz not null default now()
);
revoke all privileges on ${LEDGER_TABLE} from public, anon, authenticated;
`

/** A migration filename must sort correctly and unambiguously by name alone. */
export function isMigrationFilename(name) {
  return /^\d{4}[a-z]?_[a-z0-9_]+\.sql$/.test(name)
}

export function listMigrationFiles(dir = MIGRATIONS_DIR) {
  const names = readdirSync(dir).filter((name) => name.endsWith('.sql'))
  const invalid = names.filter((name) => !isMigrationFilename(name))
  if (invalid.length > 0) {
    throw new Error(`Migration filenames must sort by name: ${invalid.join(', ')}`)
  }
  return names.sort()
}

export function checksum(contents) {
  return createHash('sha256').update(contents).digest('hex')
}

/**
 * `applied` maps filename to the checksum recorded when it ran.
 *
 * `missing` is a file the database has applied that is no longer on disk, and
 * `drifted` is one whose contents changed after it ran. Both mean the folder
 * and the database disagree about history, which no amount of applying fixes.
 */
export function planMigrations({ files, applied }) {
  const pending = files.filter((file) => !(file.name in applied))
  const drifted = files
    .filter((file) => file.name in applied && applied[file.name] !== file.checksum)
    .map((file) => file.name)
  const onDisk = new Set(files.map((file) => file.name))
  const missing = Object.keys(applied).filter((name) => !onDisk.has(name)).sort()
  return { pending, drifted, missing }
}

/**
 * Select the pending files an apply command is allowed to run.
 *
 * A production cutoff is intentionally stricter than a local cutoff: it may
 * apply the one exact target file or do nothing. An unexpected older pending
 * migration therefore fails before the ledger or application schema is touched.
 */
export function selectApplyMigrations({ files, pending, through, production }) {
  if (production && !through) {
    throw new Error('Production apply requires --through <filename-prefix>')
  }
  if (!through) return pending
  const matches = files.filter((file) => file.name.startsWith(through))
  if (matches.length === 0) throw new Error(`No migration matches --through ${through}`)
  if (matches.length > 1) throw new Error(`Multiple migrations match --through ${through}`)
  const target = matches[0]
  const cutoff = files.findIndex((file) => file.name === target.name)
  const allowedNames = new Set(files.slice(0, cutoff + 1).map((file) => file.name))
  const selected = pending.filter((file) => allowedNames.has(file.name))
  if (production && selected.some((file) => file.name !== target.name)) {
    throw new Error(`Production cutoff ${through} would apply unexpected migrations`)
  }
  return selected
}

/**
 * The guard that makes this script safe to point at production. A database with
 * application tables and no ledger has a history nobody recorded; applying to it
 * would re-run migrations it already has.
 */
export function applyRefusalReason({ hasLedger, hasApplicationTables }) {
  if (!hasLedger && hasApplicationTables) {
    return 'This database already has tables but no migration ledger. Run `baseline` to record its history before applying anything.'
  }
  return null
}

export function redactError(error) {
  return String(error instanceof Error ? error.message : error)
    .replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, 'postgres://<REDACTED>@')
    .replace(/\b[A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|DATABASE_URL)=\S+/gi, (value) =>
      `${value.slice(0, value.indexOf('=') + 1)}<REDACTED>`)
}

// ---- Runtime ---------------------------------------------------------------

function readMigrations() {
  return listMigrationFiles().map((name) => {
    const contents = readFileSync(join(MIGRATIONS_DIR, name), 'utf8')
    return { name, contents, checksum: checksum(contents) }
  })
}

function pullProductionDatabaseUrl() {
  const previousUmask = process.umask(0o077)
  const directory = mkdtempSync(join(tmpdir(), 'vyntechs-migrate-env-'))
  const file = join(directory, '.env.production')
  try {
    writeFileSync(file, '', { mode: 0o600 })
    execFileSync('vercel', ['env', 'pull', file, '--environment=production', '--yes'], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    chmodSync(file, 0o600)
    const match = readFileSync(file, 'utf8').match(/^DATABASE_URL=(.*)$/m)
    if (!match) throw new Error('DATABASE_URL missing from production environment')
    return { url: match[1].replace(/^["']|["']$/g, '') }
  } finally {
    rmSync(directory, { recursive: true, force: true })
    process.umask(previousUmask)
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

async function inspect(sql) {
  const [{ has_ledger: hasLedger, application_tables: applicationTables }] = await sql`
    select
      to_regclass(${LEDGER_TABLE}) is not null as has_ledger,
      (select count(*)::int from information_schema.tables
        where table_schema = 'public' and table_name <> 'schema_migrations') as application_tables
  `
  const applied = {}
  if (hasLedger) {
    const rows = await sql`select filename, checksum from public.schema_migrations`
    for (const row of rows) applied[row.filename] = row.checksum
  }
  return { hasLedger, hasApplicationTables: applicationTables > 0, applied }
}

function report(label, plan, state) {
  const lines = [
    `ledger: ${state.hasLedger ? 'present' : 'absent'}`,
    `recorded: ${Object.keys(state.applied).length}`,
    `pending: ${plan.pending.length}`,
  ]
  if (plan.drifted.length > 0) lines.push(`drifted: ${plan.drifted.join(', ')}`)
  if (plan.missing.length > 0) lines.push(`missing from disk: ${plan.missing.join(', ')}`)
  process.stdout.write(`${label} — ${lines.join(' · ')}\n`)
  for (const file of plan.pending) process.stdout.write(`  pending  ${file.name}\n`)
}

async function commandStatus(url) {
  const files = readMigrations()
  return withDatabase(url, async (sql) => {
    const state = await inspect(sql)
    const plan = planMigrations({ files, applied: state.applied })
    report('status', plan, state)
    const refusal = applyRefusalReason(state)
    if (refusal) process.stdout.write(`\napply would refuse: ${refusal}\n`)
    return { plan, state }
  })
}

async function commandBaseline(url, through) {
  const files = readMigrations()
  if (!through) throw new Error('baseline requires --through <filename-prefix>')
  const cutoff = files.findIndex((file) => file.name.startsWith(through))
  if (cutoff < 0) throw new Error(`No migration matches --through ${through}`)
  const record = files.slice(0, cutoff + 1)

  return withDatabase(url, async (sql) => {
    const before = await inspect(sql)
    if (Object.keys(before.applied).length > 0) {
      throw new Error('Ledger already has rows; baseline is for an unrecorded database only')
    }
    await sql.begin(async (tx) => {
      await tx.unsafe(CREATE_LEDGER_SQL)
      for (const file of record) {
        await tx`
          insert into public.schema_migrations (filename, checksum)
          values (${file.name}, ${file.checksum})
          on conflict (filename) do nothing
        `
      }
    })
    const after = await inspect(sql)
    const plan = planMigrations({ files, applied: after.applied })
    if (Object.keys(after.applied).length !== record.length) {
      throw new Error('baseline did not record every migration')
    }
    process.stdout.write(`baseline recorded ${record.length} migrations through ${record.at(-1).name}\n`)
    report('status', plan, after)
    return after
  })
}

async function commandApply(url, through, production) {
  const files = readMigrations()
  return withDatabase(url, async (sql) => {
    const state = await inspect(sql)
    const refusal = applyRefusalReason(state)
    if (refusal) throw new Error(refusal)

    const plan = planMigrations({ files, applied: state.applied })
    if (plan.drifted.length > 0) {
      throw new Error(`Applied migrations changed on disk: ${plan.drifted.join(', ')}`)
    }
    if (plan.missing.length > 0) {
      throw new Error(`Applied migrations are missing from disk: ${plan.missing.join(', ')}`)
    }
    const selected = selectApplyMigrations({ files, pending: plan.pending, through, production })
    if (selected.length === 0) {
      process.stdout.write('apply — nothing pending\n')
      return plan
    }

    for (const file of selected) process.stdout.write(`selected ${file.name}\n`)
    await withDatabase(url, async (ledger) => ledger.unsafe(CREATE_LEDGER_SQL))
    for (const file of selected) {
      await sql.begin(async (tx) => {
        await tx.unsafe(file.contents.replaceAll('--> statement-breakpoint', ''))
        await tx`
          insert into public.schema_migrations (filename, checksum)
          values (${file.name}, ${file.checksum})
        `
      })
      process.stdout.write(`applied  ${file.name}\n`)
    }
    process.stdout.write(`apply — ${selected.length} applied\n`)
    return plan
  })
}

function parseArgs(argv) {
  const command = argv[2]
  const flag = (name) => {
    const index = argv.indexOf(name)
    return index >= 0 ? argv[index + 1] : null
  }
  return {
    command,
    production: argv.includes('--production'),
    through: flag('--through'),
    databaseUrl: flag('--database-url') ?? process.env.DATABASE_URL ?? null,
  }
}

async function main() {
  const { command, production, through, databaseUrl } = parseArgs(process.argv)
  if (!['status', 'apply', 'baseline'].includes(command)) {
    throw new Error('Usage: db-migrate.mjs <status|apply|baseline> [--production] [--through NNNN]')
  }
  const url = production ? pullProductionDatabaseUrl().url : databaseUrl
  if (!url) throw new Error('Set DATABASE_URL, pass --database-url, or use --production')

  if (command === 'status') await commandStatus(url)
  else if (command === 'baseline') await commandBaseline(url, through)
  else await commandApply(url, through, production)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`db-migrate failed: ${redactError(error)}\n`)
    process.exitCode = 1
  })
}
