import type { SupabaseClient } from '@supabase/supabase-js'
import { ensureProfileAndShop } from './db/queries'
import type { AppDb } from './db/queries'
import type { Profile } from './db/schema'

export type AuthenticatedContext = {
  user: { id: string; email: string }
  profile: Profile
}

export async function requireUserAndProfile(opts: {
  supabase: SupabaseClient
  db: AppDb
}): Promise<AuthenticatedContext | null> {
  const {
    data: { user },
  } = await opts.supabase.auth.getUser()
  if (!user || !user.email) return null
  const profile = await ensureProfileAndShop(opts.db, user.id, user.email)
  return { user: { id: user.id, email: user.email }, profile }
}
