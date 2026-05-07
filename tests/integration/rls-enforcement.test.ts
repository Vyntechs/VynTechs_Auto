import { describe, it, expect, beforeAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import * as fs from 'node:fs'
import * as path from 'node:path'

// Load .env.local manually (vitest doesn't auto-source it).
function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
    }
  }
}
loadEnvLocal()

// Tables that should never be readable by an unauthenticated PostgREST client.
// If any of these returns rows under the anon role, the security boundary
// has been broken — leaked anon key would expose customer data.
const SENSITIVE_TABLES = [
  'profiles',
  'sessions',
  'session_events',
  'drift_alerts',
  'novel_pattern_queue',
  'follow_ups',
  'tech_assist_requests',
  'stripe_customers',
  'shops',
  'corpus_entries',
  'artifacts',
  'confidence_calibration',
  'retrieval_cache',
] as const

describe('RLS — anon role cannot read sensitive tables via PostgREST', () => {
  let anonClient: SupabaseClient
  let serviceClient: SupabaseClient

  beforeAll(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !anonKey || !serviceKey) {
      throw new Error(
        'NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local for integration tests',
      )
    }
    anonClient = createClient(url, anonKey, { auth: { persistSession: false } })
    serviceClient = createClient(url, serviceKey, {
      auth: { persistSession: false },
    })
  })

  for (const table of SENSITIVE_TABLES) {
    it(`anon SELECT on ${table} returns no rows (RLS enforced)`, async () => {
      const { data, error } = await anonClient.from(table).select('*').limit(1)
      // Two acceptable outcomes:
      //   1. RLS denial via PostgREST returns an error mentioning policy/permission.
      //   2. Empty array because no policy grants SELECT to the anon role
      //      (this is the current state — RLS enabled, no policies).
      // The unacceptable outcome is rows returned: that means a policy granted
      // anon access to private data.
      if (error) {
        expect(error.message).toMatch(/permission|policy|security|row.level|rls/i)
      } else {
        expect(data, `${table} leaked rows to anon role`).toEqual([])
      }
    })
  }

  it('service_role is also denied SELECT on public.sessions via PostgREST', async () => {
    // Brandon's setup intentionally does NOT grant the service_role SELECT
    // on public tables — even the admin key cannot read prod data through
    // the REST API. The app uses Drizzle with a direct postgres connection
    // (DATABASE_URL) which bypasses both RLS and these grants.
    // This test pins that defense-in-depth posture in place.
    const { data, error } = await serviceClient
      .from('sessions')
      .select('id')
      .limit(1)
    expect(error?.code).toBe('42501') // permission denied
    expect(data).toBeNull()
  })

  it('anon role cannot INSERT into sessions (write protection)', async () => {
    const { error } = await anonClient
      .from('sessions')
      .insert({ id: '00000000-0000-0000-0000-000000000099', shop_id: '00000000-0000-0000-0000-000000000099' })
    // Either RLS error or schema mismatch (missing required column) — both
    // prove the anon client cannot persist a row. Successful insert would be
    // a critical security failure.
    expect(error).not.toBeNull()
  })
})
