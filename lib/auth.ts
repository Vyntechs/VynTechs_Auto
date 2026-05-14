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
 * Founder gate. Founders are a small set of hardcoded users (typically the
 * shop owner and any co-founders) identified by FOUNDER_EMAILS — a
 * comma-separated list of their Supabase auth emails. Used to gate the
 * founder-notes ingestion path AND the curator (super-admin) gate: only
 * founders author notes and only founders pass canCurate via the email path.
 *
 * Backward compatibility: if FOUNDER_EMAILS is unset, falls back to the
 * legacy single-value FOUNDER_EMAIL env var so a transition can be made
 * without locking anyone out.
 *
 * Email is compared case-insensitively — Supabase normalizes user emails
 * to lowercase on signup, but we lowercase both sides to be safe against
 * mixed-case env-var values. Empty entries are ignored. Returns false when
 * no env var is set so the gate stays closed in any environment where it
 * hasn't been deliberately configured.
 */
export function isFounder(email: string | null | undefined): boolean {
  if (!email) return false
  // Prefer the plural list, but only when it has content — an explicit
  // empty string should fall through to the singular legacy var, not block it.
  const raw =
    process.env.FOUNDER_EMAILS?.trim() ||
    process.env.FOUNDER_EMAIL?.trim() ||
    ''
  const needle = email.toLowerCase().trim()
  if (!needle) return false
  for (const entry of raw.split(',')) {
    const candidate = entry.toLowerCase().trim()
    if (candidate && candidate === needle) return true
  }
  return false
}
