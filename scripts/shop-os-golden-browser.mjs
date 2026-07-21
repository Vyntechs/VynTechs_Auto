#!/usr/bin/env node

import { randomBytes, randomUUID } from 'node:crypto'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'

import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '..')

export const QA_SHOP_ID = '8f33a153-1267-4cd8-8e2e-6a72a9f5a101'
export const QA_SHOP_NAME = 'Vyntechs Golden Browser QA'
export const QA_SUPABASE_URL = 'https://ynmtszuybeenjbigxdyl.supabase.co'
export const QA_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_3uwoW37WS09mI6cgUQP2-Q_CeJ8-X1J'

export const QA_USERS = Object.freeze({
  owner: Object.freeze({
    profileId: '8f33a153-1267-4cd8-8e2e-6a72a9f5a120',
    role: 'owner',
    skillTier: null,
    fullName: 'Golden QA Owner',
    email: 'shopos.qa.owner@vyntechs.invalid',
    keychainService: 'com.vyntechs.shopos.golden-qa.owner',
    envPrefix: 'GOLDEN_QA_OWNER',
  }),
  advisor: Object.freeze({
    profileId: '8f33a153-1267-4cd8-8e2e-6a72a9f5a121',
    role: 'advisor',
    skillTier: null,
    fullName: 'Golden QA Advisor',
    email: 'shopos.qa.advisor@vyntechs.invalid',
    keychainService: 'com.vyntechs.shopos.golden-qa.advisor',
    envPrefix: 'GOLDEN_QA_ADVISOR',
  }),
  tech: Object.freeze({
    profileId: '8f33a153-1267-4cd8-8e2e-6a72a9f5a122',
    role: 'tech',
    skillTier: 3,
    fullName: 'Golden QA Technician',
    email: 'shopos.qa.tech@vyntechs.invalid',
    keychainService: 'com.vyntechs.shopos.golden-qa.tech',
    envPrefix: 'GOLDEN_QA_TECH',
  }),
  parts: Object.freeze({
    profileId: '8f33a153-1267-4cd8-8e2e-6a72a9f5a123',
    role: 'parts',
    skillTier: null,
    fullName: 'Golden QA Parts',
    email: 'shopos.qa.parts@vyntechs.invalid',
    keychainService: 'com.vyntechs.shopos.golden-qa.parts',
    envPrefix: 'GOLDEN_QA_PARTS',
  }),
})

export const CLEANUP_TABLES = Object.freeze([
  'ticket_payments',
  'quote_events',
  'job_part_requests',
  'job_lines',
  'ticket_jobs',
  'quote_versions',
  'tickets',
  'vehicles',
  'customers',
])

const FORBIDDEN_OPERATIONAL_TABLES = Object.freeze([
  'sessions',
  'job_attachments',
  'quote_sends',
  'sms_log',
  'notifications',
])

export function parseEnvFile(source) {
  const result = {}
  for (const rawLine of String(source).split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (!match) continue
    let value = match[2]
    if (
      value.length >= 2
      && ((value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1)
    }
    result[match[1]] = value
  }
  return result
}

export function redactError(error) {
  return String(error instanceof Error ? error.message : error)
    .replace(
      /\b[A-Z0-9_]*(?:PASSWORD|PASS|TOKEN|SECRET|API_KEY|SERVICE_ROLE_KEY|DATABASE_URL)=\S+/gi,
      (value) => `${value.slice(0, value.indexOf('=') + 1)}<REDACTED>`,
    )
    .replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, 'postgres://<REDACTED>@')
    .replace(/eyJ[A-Za-z0-9._-]{20,}/g, '<REDACTED>')
}

export function validateBaseUrl(raw, allowLocalhost = false, allowVercelPreview = false) {
  const url = new URL(raw)
  const normalized = url.origin
  if (url.protocol === 'https:' && (url.hostname === 'vyntechs.dev' || url.hostname.endsWith('.vyntechs.dev'))) {
    return normalized
  }
  if (allowLocalhost && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)) {
    return normalized
  }
  if (allowVercelPreview && url.protocol === 'https:'
    && url.hostname.startsWith('vyntechs-dev-') && url.hostname.endsWith('.vercel.app')) {
    return normalized
  }
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    throw new Error('Set GOLDEN_QA_ALLOW_LOCALHOST=1 to target localhost')
  }
  throw new Error('Golden browser QA accepts only Vyntechs hosts')
}

export function cleanupStatements(shopId) {
  if (shopId !== QA_SHOP_ID) throw new Error('cleanup refused outside the fixed QA shop')
  return CLEANUP_TABLES.map((table) => ({
    table,
    sql: table === 'vehicles'
      ? 'delete from public.vehicles where customer_id in (select id from public.customers where shop_id = $1)'
      : `delete from public.${table} where shop_id = $1`,
    values: [shopId],
  }))
}

export function cleanupReplicationGuard() {
  return {
    enter: 'set local session_replication_role = replica',
    exit: 'set local session_replication_role = origin',
  }
}

function requireEnv(env, names) {
  const missing = names.filter((name) => !env[name])
  if (missing.length > 0) throw new Error(`Missing required environment variables: ${missing.join(', ')}`)
}

function pullProductionEnv() {
  const previousUmask = process.umask(0o077)
  const directory = mkdtempSync(join(tmpdir(), 'vyntechs-golden-env-'))
  const file = join(directory, '.env.production')
  try {
    writeFileSync(file, '', { mode: 0o600 })
    execFileSync(
      'vercel',
      ['env', 'pull', file, '--environment=production', '--yes'],
      { cwd: REPO_ROOT, stdio: ['ignore', 'ignore', 'pipe'] },
    )
    chmodSync(file, 0o600)
    const env = parseEnvFile(readFileSync(file, 'utf8'))
    requireEnv(env, ['DATABASE_URL'])
    return {
      env,
      dispose() {
        rmSync(directory, { recursive: true, force: true })
        process.umask(previousUmask)
      },
    }
  } catch (error) {
    rmSync(directory, { recursive: true, force: true })
    process.umask(previousUmask)
    throw error
  }
}

function writeKeychainPassword(user, password) {
  const result = spawnSync(
    '/usr/bin/security',
    [
      'add-generic-password',
      '-U',
      '-a', user.email,
      '-s', user.keychainService,
      '-l', `Vyntechs Golden QA ${user.role}`,
      '-w', password,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] },
  )
  if (result.status !== 0) throw new Error(`Keychain write failed for ${user.role}`)
}

function readKeychainPassword(user) {
  const result = spawnSync(
    '/usr/bin/security',
    ['find-generic-password', '-a', user.email, '-s', user.keychainService, '-w'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
  if (result.status !== 0) throw new Error(`Missing Keychain credential for ${user.role}; run provision`)
  const password = result.stdout.trim()
  if (!password) throw new Error(`Empty Keychain credential for ${user.role}; run provision`)
  return password
}

export function readQaCredentials() {
  return Object.fromEntries(Object.entries(QA_USERS).map(([role, user]) => [
    role,
    { email: user.email, password: readKeychainPassword(user) },
  ]))
}

async function withDatabase(databaseUrl, operation) {
  const sql = postgres(databaseUrl, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 15,
    prepare: false,
  })
  try {
    return await operation(sql)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

async function assertQaIdentityPreflight(sql) {
  const nameCollisions = await sql`
    select id::text
    from public.shops
    where name = ${QA_SHOP_NAME} and id <> ${QA_SHOP_ID}::uuid
  `
  if (nameCollisions.length > 0) throw new Error('QA shop name belongs to an unexpected shop ID')

  const profileIds = Object.values(QA_USERS).map((user) => user.profileId)
  const profileCollisions = await sql`
    select p.id::text, lower(u.email) as email
    from public.profiles p
    left join auth.users u on u.id = p.user_id
    where p.id = any(${profileIds}::uuid[])
  `
  for (const row of profileCollisions) {
    const expected = Object.values(QA_USERS).find((user) => user.profileId === row.id)
    if (!expected || row.email !== expected.email) {
      throw new Error('QA profile ID collides with an unexpected auth identity')
    }
  }

  const emails = Object.values(QA_USERS).map((user) => user.email)
  const emailCollisions = await sql`
    select lower(u.email) as email, p.id::text as profile_id
    from auth.users u
    join public.profiles p on p.user_id = u.id
    where lower(u.email) = any(${emails}::text[])
  `
  for (const row of emailCollisions) {
    const expected = Object.values(QA_USERS).find((user) => user.email === row.email)
    if (!expected || row.profile_id !== expected.profileId) {
      throw new Error('QA auth email is attached to an unexpected profile')
    }
  }
}

async function ensureQaAuthUsers(databaseUrl) {
  return withDatabase(databaseUrl, async (sql) => {
    const ids = {}
  for (const user of Object.values(QA_USERS)) {
    const password = randomBytes(36).toString('base64url')
      let rows = await sql`
        select id::text
        from auth.users
        where lower(email) = ${user.email}
      `
      if (rows.length === 0) {
        const client = createClient(QA_SUPABASE_URL, QA_SUPABASE_PUBLISHABLE_KEY, {
          auth: { autoRefreshToken: false, persistSession: false },
        })
        const created = await client.auth.signUp({
          email: user.email,
          password,
          options: { data: { qa_shop_id: QA_SHOP_ID, qa_role: user.role } },
        })
        if (created.error || !created.data.user?.id) {
          throw new Error(`QA ${user.role} auth signup failed: ${created.error?.message ?? 'missing user'}`)
        }
        rows = [{ id: created.data.user.id }]
      }
      if (rows.length !== 1) throw new Error(`QA ${user.role} auth identity is not unique`)
      const authUserId = rows[0].id
      await sql`
        update auth.users set
          encrypted_password = extensions.crypt(${password}, extensions.gen_salt('bf')),
          email_confirmed_at = coalesce(email_confirmed_at, now()),
          updated_at = now(),
          raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
            || jsonb_build_object(
              'qa_shop_id', ${QA_SHOP_ID}::text,
              'qa_role', ${user.role}::text
            )
        where id = ${authUserId}::uuid and lower(email) = ${user.email}
      `
      ids[user.role] = authUserId
      writeKeychainPassword(user, password)
    }
    return ids
  })
}

async function verifyQaSignIns() {
  for (const user of Object.values(QA_USERS)) {
    const client = createClient(QA_SUPABASE_URL, QA_SUPABASE_PUBLISHABLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const result = await client.auth.signInWithPassword({
      email: user.email,
      password: readKeychainPassword(user),
    })
    if (result.error || result.data.user?.email?.toLowerCase() !== user.email) {
      throw new Error(`QA ${user.role} sign-in verification failed`)
    }
    await client.auth.signOut()
  }
}

export async function ensureQaTenant(env) {
  requireEnv(env, ['DATABASE_URL'])

  await withDatabase(env.DATABASE_URL, async (sql) => assertQaIdentityPreflight(sql))
  const authUserIds = await ensureQaAuthUsers(env.DATABASE_URL)

  await withDatabase(env.DATABASE_URL, async (sql) => {
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${QA_SHOP_ID}, 0))`
      await assertQaIdentityPreflight(tx)
      await tx`
        insert into public.shops (
          id, name, next_ticket_number, labor_rate_cents, tax_rate_bps, parts_markup_bps
        ) values (
          ${QA_SHOP_ID}::uuid, ${QA_SHOP_NAME}, 1, 12000, 800, 2500
        )
        on conflict (id) do update set
          name = excluded.name,
          labor_rate_cents = excluded.labor_rate_cents,
          tax_rate_bps = excluded.tax_rate_bps,
          parts_markup_bps = excluded.parts_markup_bps
      `
      for (const user of Object.values(QA_USERS)) {
        await tx`
          insert into public.profiles (
            id, user_id, shop_id, full_name, role, skill_tier,
            membership_status, membership_activated_at, is_comp, is_curator, deactivated_at
          ) values (
            ${user.profileId}::uuid,
            ${authUserIds[user.role]}::uuid,
            ${QA_SHOP_ID}::uuid,
            ${user.fullName},
            ${user.role},
            ${user.skillTier},
            'active',
            now(),
            true,
            false,
            null
          )
          on conflict (id) do update set
            user_id = excluded.user_id,
            shop_id = excluded.shop_id,
            full_name = excluded.full_name,
            role = excluded.role,
            skill_tier = excluded.skill_tier,
            membership_status = 'active',
            membership_activated_at = coalesce(public.profiles.membership_activated_at, now()),
            is_comp = true,
            is_curator = false,
            deactivated_at = null
        `
      }
      await tx`
        insert into public.shop_entitlements (shop_id, diagnostics, stripe_price_id)
        values (${QA_SHOP_ID}::uuid, false, null)
        on conflict (shop_id) do update set
          diagnostics = false,
          stripe_price_id = null,
          updated_at = now()
      `
      await tx`delete from public.stripe_customers where shop_id = ${QA_SHOP_ID}::uuid`
    })
  })

  await verifyQaSignIns()
  return verifyQaContract(env)
}

export async function verifyQaContract(env) {
  return withDatabase(env.DATABASE_URL, async (sql) => {
    const [receipt] = await sql`
      select
        (select count(*)::int from public.shops
          where id = ${QA_SHOP_ID}::uuid and name = ${QA_SHOP_NAME}) as shops,
        (select count(*)::int from public.profiles
          where shop_id = ${QA_SHOP_ID}::uuid
            and membership_status = 'active'
            and deactivated_at is null
            and is_comp = true) as profiles,
        (select count(*)::int from public.shop_entitlements
          where shop_id = ${QA_SHOP_ID}::uuid and diagnostics = false) as diagnostics_off,
        (select count(*)::int from public.stripe_customers
          where shop_id = ${QA_SHOP_ID}::uuid) as stripe_customers
    `
    const roles = await sql`
      select role, skill_tier
      from public.profiles
      where shop_id = ${QA_SHOP_ID}::uuid
      order by case role when 'owner' then 1 when 'advisor' then 2 when 'tech' then 3 when 'parts' then 4 else 5 end
    `
    const roleReceipt = roles.map((row) => `${row.role}:${row.skill_tier ?? 'none'}`).join(',')
    if (
      receipt.shops !== 1
      || receipt.profiles !== 4
      || receipt.diagnostics_off !== 1
      || receipt.stripe_customers !== 0
      || roleReceipt !== 'owner:none,advisor:none,tech:3,parts:none'
    ) {
      throw new Error('QA tenant contract verification failed')
    }
    return { ...receipt, roles: roleReceipt }
  })
}

async function tableCounts(sql, tables) {
  const result = {}
  for (const table of tables) {
    const rows = table === 'vehicles'
      ? await sql.unsafe(
        'select count(*)::int as count from public.vehicles where customer_id in (select id from public.customers where shop_id = $1)',
        [QA_SHOP_ID],
      )
      : await sql.unsafe(`select count(*)::int as count from public.${table} where shop_id = $1`, [QA_SHOP_ID])
    result[table] = rows[0]?.count ?? -1
  }
  return result
}

export async function verifyQaClean(env) {
  return withDatabase(env.DATABASE_URL, async (sql) => {
    const counts = await tableCounts(sql, [...CLEANUP_TABLES, ...FORBIDDEN_OPERATIONAL_TABLES])
    const nonzero = Object.entries(counts).filter(([, count]) => count !== 0)
    if (nonzero.length > 0) {
      throw new Error(`QA cleanup verification failed: ${nonzero.map(([table, count]) => `${table}=${count}`).join(', ')}`)
    }
    return counts
  })
}

export async function cleanupQaOperationalData(env) {
  return withDatabase(env.DATABASE_URL, async (sql) => {
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended(${QA_SHOP_ID}, 0))`
      const forbidden = await tableCounts(tx, FORBIDDEN_OPERATIONAL_TABLES)
      const unexpected = Object.entries(forbidden).filter(([, count]) => count !== 0)
      if (unexpected.length > 0) {
        throw new Error(`QA cleanup stopped on unexpected dependencies: ${unexpected.map(([table, count]) => `${table}=${count}`).join(', ')}`)
      }
      const replicationGuard = cleanupReplicationGuard()
      await tx.unsafe(replicationGuard.enter)
      for (const statement of cleanupStatements(QA_SHOP_ID)) {
        await tx.unsafe(statement.sql, statement.values)
      }
      await tx`update public.shops set next_ticket_number = 1 where id = ${QA_SHOP_ID}::uuid`
      await tx.unsafe(replicationGuard.exit)
    })
    return verifyQaClean(env)
  })
}

function playwrightEnvironment(baseUrl, credentials, runId) {
  const result = {
    ...process.env,
    GOLDEN_QA_BASE_URL: baseUrl,
    GOLDEN_QA_RUN_ID: runId,
  }
  for (const [role, user] of Object.entries(QA_USERS)) {
    const credential = credentials[role]
    result[`${user.envPrefix}_EMAIL`] = credential.email
    result[`${user.envPrefix}_PASSWORD`] = credential.password
  }
  return result
}

async function runBrowserProjects(env, baseUrl, selectedProject = null) {
  await verifyQaContract(env)
  const credentials = readQaCredentials()
  const projects = selectedProject ? [selectedProject] : ['golden-phone', 'golden-desktop']
  for (const project of projects) {
    await cleanupQaOperationalData(env)
    const runId = `${randomUUID()}-${project}`
    try {
      const result = spawnSync(
        'pnpm',
        ['exec', 'playwright', 'test', '--config', 'playwright.golden.config.ts', '--project', project],
        {
          cwd: REPO_ROOT,
          env: playwrightEnvironment(baseUrl, credentials, runId),
          encoding: 'utf8',
          stdio: 'inherit',
        },
      )
      if (result.status !== 0) throw new Error(`${project} browser journey failed`)
    } finally {
      await cleanupQaOperationalData(env)
    }
  }
}

function parseCommand(argv) {
  const command = argv[2]
  const baseUrlIndex = argv.indexOf('--base-url')
  const baseUrl = baseUrlIndex >= 0 ? argv[baseUrlIndex + 1] : 'https://vyntechs.dev'
  const projectIndex = argv.indexOf('--project')
  const project = projectIndex >= 0 ? argv[projectIndex + 1] : null
  if (project !== null && !['golden-phone', 'golden-desktop'].includes(project)) {
    throw new Error('Golden browser QA project must be golden-phone or golden-desktop')
  }
  return { command, baseUrl, project }
}

async function main() {
  const { command, baseUrl, project } = parseCommand(process.argv)
  if (!['provision', 'test', 'clean', 'verify-clean'].includes(command)) {
    throw new Error('Usage: shop-os-golden-browser.mjs <provision|test|clean|verify-clean> [--base-url URL]')
  }
  const pulled = pullProductionEnv()
  try {
    if (command === 'provision') {
      const receipt = await ensureQaTenant(pulled.env)
      await cleanupQaOperationalData(pulled.env)
      process.stdout.write(`Golden QA provisioned: shops=${receipt.shops} profiles=${receipt.profiles} diagnostics_off=${receipt.diagnostics_off} stripe_customers=${receipt.stripe_customers}\n`)
      return
    }
    if (command === 'verify-clean') {
      const counts = await verifyQaClean(pulled.env)
      process.stdout.write(`Golden QA clean: ${Object.entries(counts).map(([table, count]) => `${table}=${count}`).join(' ')}\n`)
      return
    }
    if (command === 'clean') {
      const counts = await cleanupQaOperationalData(pulled.env)
      process.stdout.write(`Golden QA cleanup complete: ${Object.entries(counts).map(([table, count]) => `${table}=${count}`).join(' ')}\n`)
      return
    }
    const normalizedBaseUrl = validateBaseUrl(
      baseUrl,
      process.env.GOLDEN_QA_ALLOW_LOCALHOST === '1',
      process.env.GOLDEN_QA_ALLOW_VERCEL_PREVIEW === '1',
    )
    await runBrowserProjects(pulled.env, normalizedBaseUrl, project)
    process.stdout.write(project
      ? `Golden browser QA passed: ${project}=1 cleanup=clean\n`
      : 'Golden browser QA passed: phone=1 desktop=1 cleanup=clean\n')
  } finally {
    pulled.dispose()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`Golden browser QA failed: ${redactError(error)}\n`)
    process.exitCode = 1
  })
}
