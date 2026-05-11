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

/**
 * Founder gate. The founder is a single hardcoded user (the shop owner)
 * identified by FOUNDER_EMAIL — their Supabase auth email. Used to gate
 * the founder-notes ingestion path: only the founder can submit free-form
 * knowledge into the queue. Curators (general role) can still review the
 * queue, but only the founder authors entries.
 *
 * Email is compared case-insensitively — Supabase normalizes user emails
 * to lowercase on signup, but we lowercase both sides to be safe against
 * mixed-case env-var values. Returns false when the env var is unset so
 * the gate stays closed in any environment where it hasn't been
 * deliberately configured.
 */
export function isFounder(email: string | null | undefined): boolean {
  const founderEmail = process.env.FOUNDER_EMAIL
  if (!founderEmail || !email) return false
  return email.toLowerCase().trim() === founderEmail.toLowerCase().trim()
}
