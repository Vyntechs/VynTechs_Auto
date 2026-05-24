// One-shot: provision a dedicated e2e test user in live Supabase.
//
// Run once with `node scripts/setup-e2e-user.mjs`. Idempotent guard at the top
// errors out if the user already exists, so re-runs can't double-write.
//
// Writes (all additive — nothing existing is mutated):
//   1. supabase admin createUser → e2e@vyntechs.com with random pw, email_confirm:true
//   2. INSERT shops          → "Vyntechs E2E Test Shop"
//   3. INSERT profiles       → role=tech, attached to test shop
//   4. INSERT sessions       → clone of the F-350 / P0087 fixture, owned by test user
//
// Then patches .env.local in place: TEST_USER_EMAIL + TEST_USER_PASSWORD.
//
// Why a clone instead of reassigning the original session: per the standing
// "additive only" rule for prod writes, the existing F-350 session must stay
// owned by Brandon so it's available for his manual visual sign-off and isn't
// pulled out from under any other consumer.

import { createClient } from '@supabase/supabase-js'
import postgres from 'postgres'
import { randomBytes } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'

function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) {
    throw new Error('.env.local not found — run from repo root.')
  }
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
    }
  }
}

const E2E_EMAIL = 'e2e@vyntechs.com'
const ORIGINAL_SESSION_ID = '681de115-5de9-474e-9721-263f65066e08'

function generatePassword() {
  // 32 url-safe base64 chars from 24 random bytes (~192 bits of entropy).
  return randomBytes(24).toString('base64url')
}

function patchEnvLocal(email, password) {
  const envPath = path.resolve(process.cwd(), '.env.local')
  const before = fs.readFileSync(envPath, 'utf8')
  let after = before
  // Replace existing lines, or append if missing.
  if (/^TEST_USER_EMAIL=.*$/m.test(after)) {
    after = after.replace(/^TEST_USER_EMAIL=.*$/m, `TEST_USER_EMAIL=${email}`)
  } else {
    after += `\nTEST_USER_EMAIL=${email}`
  }
  if (/^TEST_USER_PASSWORD=.*$/m.test(after)) {
    after = after.replace(
      /^TEST_USER_PASSWORD=.*$/m,
      `TEST_USER_PASSWORD=${password}`,
    )
  } else {
    after += `\nTEST_USER_PASSWORD=${password}`
  }
  if (!after.endsWith('\n')) after += '\n'
  fs.writeFileSync(envPath, after)
}

async function main() {
  loadEnvLocal()

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const dbUrl = process.env.DATABASE_URL
  if (!supabaseUrl || !serviceKey || !dbUrl) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / DATABASE_URL in .env.local',
    )
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const sql = postgres(dbUrl, { prepare: false })

  try {
    // ──────────────────────────────────────────────────────────────────
    // Idempotency guard: if e2e user already exists, bail loudly.
    // listUsers paginates; for our small user set, page 1 is sufficient.
    const { data: existing, error: listErr } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    })
    if (listErr) throw new Error(`admin.listUsers failed: ${listErr.message}`)
    const dup = existing.users.find((u) => u.email === E2E_EMAIL)
    if (dup) {
      throw new Error(
        `User ${E2E_EMAIL} already exists (id ${dup.id}). Refusing to double-write. ` +
          `If you need to reset: delete the user via Supabase dashboard then re-run.`,
      )
    }

    // ──────────────────────────────────────────────────────────────────
    // Sanity check: the original session exists and has cache-hit refs
    // (the topology page needs these to render its scenario simulator).
    const [orig] = await sql`
      SELECT * FROM sessions WHERE id = ${ORIGINAL_SESSION_ID}
    `
    if (!orig) {
      throw new Error(`Original session ${ORIGINAL_SESSION_ID} not found.`)
    }
    if (!orig.cache_hit_platform_id || !orig.cache_hit_symptom_id) {
      throw new Error(
        `Original session is missing cache_hit_platform_id or cache_hit_symptom_id — ` +
          `topology page won't wire up. Aborting.`,
      )
    }

    // ──────────────────────────────────────────────────────────────────
    // 1. Create auth user.
    const password = generatePassword()
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email: E2E_EMAIL,
      password,
      email_confirm: true,
    })
    if (createErr || !created.user) {
      throw new Error(`admin.createUser failed: ${createErr?.message ?? 'no user'}`)
    }
    const userId = created.user.id
    console.log(`✓ created auth user: ${E2E_EMAIL} (id ${userId})`)

    // ──────────────────────────────────────────────────────────────────
    // 2–4. INSERT shop, profile, cloned session (single transaction so a
    // partial failure rolls back). If this throws after createUser succeeded,
    // we delete the auth user in the catch block to avoid an orphan.
    try {
      const result = await sql.begin(async (tx) => {
        const [shop] = await tx`
          INSERT INTO shops (name)
          VALUES ('Vyntechs E2E Test Shop')
          RETURNING id, name
        `
        // is_comp:true bypasses the Stripe-subscription paywall in
        // lib/auth-access.ts → checkAccess(). Without this, the test shop
        // has no Stripe customer and every authed page renders the
        // "Restart subscription" paywall instead of the requested view.
        const [profile] = await tx`
          INSERT INTO profiles (user_id, shop_id, full_name, role, is_comp)
          VALUES (${userId}, ${shop.id}, 'E2E Test User', 'tech', true)
          RETURNING id, user_id, shop_id, role, is_comp
        `
        // Clone only the columns we want to carry over. `vehicle_id` is left
        // NULL on the clone to avoid coupling the test shop's session to a
        // real customer/vehicle in Brandon's shop. `created_at` defaults to
        // now(). `closed_at`, `curator_*`, `max_corpus_similarity` stay NULL.
        const [cloned] = await tx`
          INSERT INTO sessions (
            shop_id, tech_id, intake, tree_state, status,
            cache_hit_platform_id, cache_hit_symptom_id,
            last_scenario_slug, outcome
          )
          SELECT
            ${shop.id}, ${profile.id}, intake, tree_state, status,
            cache_hit_platform_id, cache_hit_symptom_id,
            last_scenario_slug, outcome
          FROM sessions
          WHERE id = ${ORIGINAL_SESSION_ID}
          RETURNING id
        `
        return { shop, profile, cloned }
      })

      console.log(`✓ created shop: ${result.shop.name} (id ${result.shop.id})`)
      console.log(`✓ created profile: id ${result.profile.id}, role ${result.profile.role}`)
      console.log(`✓ cloned session: ${result.cloned.id} (from ${ORIGINAL_SESSION_ID})`)

      // ──────────────────────────────────────────────────────────────
      // 5. Patch .env.local in place.
      patchEnvLocal(E2E_EMAIL, password)
      console.log(`✓ updated .env.local with TEST_USER_EMAIL + TEST_USER_PASSWORD`)

      console.log('')
      console.log('───────────────────────────────────────────────────────')
      console.log('  DONE. Cloned session UUID (paste into topology.spec.ts):')
      console.log(`  ${result.cloned.id}`)
      console.log('───────────────────────────────────────────────────────')
    } catch (txErr) {
      console.error('DB transaction failed — cleaning up auth user…', txErr)
      const { error: delErr } = await supabase.auth.admin.deleteUser(userId)
      if (delErr) {
        console.error(
          `WARNING: failed to delete orphan auth user ${userId}: ${delErr.message}. ` +
            `Delete manually via Supabase dashboard.`,
        )
      } else {
        console.error(`✓ deleted orphan auth user ${userId}`)
      }
      throw txErr
    }
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((err) => {
  console.error('FAILED:', err.message)
  process.exit(1)
})
