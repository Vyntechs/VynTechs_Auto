import type { SupabaseClient } from '@supabase/supabase-js'
import { ensureProfileAndShop } from './db/queries'
import type { AppDb } from './db/queries'
import type { Profile } from './db/schema'
import { ensureStripeCustomer } from './stripe'

export type AuthenticatedContext = {
  user: { id: string; email: string }
  profile: Profile
}

export type EnsureCustomerFn = (opts: {
  db: AppDb
  shopId: string
  email: string
}) => Promise<string>

export async function requireUserAndProfile(opts: {
  supabase: SupabaseClient
  db: AppDb
  ensureCustomer?: EnsureCustomerFn
}): Promise<AuthenticatedContext | null> {
  const {
    data: { user },
  } = await opts.supabase.auth.getUser()
  if (!user || !user.email) return null
  const profile = await ensureProfileAndShop(opts.db, user.id, user.email)
  if (profile.shopId) {
    const ensure: EnsureCustomerFn =
      opts.ensureCustomer ??
      ((args) => ensureStripeCustomer(args))
    await ensure({ db: opts.db, shopId: profile.shopId, email: user.email }).catch(
      (err) => {
        console.warn('stripe customer ensure failed:', err)
      },
    )
  }
  return { user: { id: user.id, email: user.email }, profile }
}
