import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Service-role Supabase client for server-side admin operations:
// - auth.admin.inviteUserByEmail (used by /api/team/invite)
// - storage uploads (already wired separately in lib/storage/client.ts)
//
// Never expose this client to the browser — it bypasses RLS.
//
// Lazy proxy so the client is constructed on first use, not at import time.
// This keeps the env-var read out of static bundling and lets tests mock
// the module entirely.

let _admin: SupabaseClient | undefined

function getAdminClient(): SupabaseClient {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
  }
  return _admin
}

export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const client = getAdminClient()
    const value = Reflect.get(client, prop, receiver)
    return typeof value === 'function' ? value.bind(client) : value
  },
})
