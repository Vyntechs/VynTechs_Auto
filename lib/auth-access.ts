import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import type { AppDb } from './db/queries'
import { getProfileByUserId } from './db/queries'
import { stripeCustomers } from './db/schema'

const EXEMPT_EXACT = new Set<string>([
  '/',
  '/sign-in',
  '/sign-up',
  '/subscribe',
  '/auth/callback',
  // Server route that verifies the recovery OTP from the password-reset
  // email; sets cookies, then redirects to /reset-password. Always reached
  // by an unauthenticated user landing from email.
  '/auth/confirm',
  '/checkout/success',
  '/billing',
  '/whats-new',
  // The Supabase password-reset email lands an unauthenticated user here
  // with a PKCE `?code=` query param; the page itself does the
  // exchangeCodeForSession on mount. If middleware redirected to /sign-in,
  // the code would be lost and the reset flow would silently break.
  '/reset-password',
  // Deactivated landing — a deactivated user with a live session must be
  // able to reach this page without bouncing through the paywall or back
  // through the deactivation gate (which would loop).
  '/deactivated',
  '/api/health',
])

const EXEMPT_PREFIXES = [
  '/api/stripe/',
  '/api/cron/',
  '/api/auth/',
  '/api/whats-new/',
]

export function isPaywallExempt(pathname: string): boolean {
  if (EXEMPT_EXACT.has(pathname)) return true
  return EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

export function isApiRoute(pathname: string): boolean {
  return pathname.startsWith('/api/')
}

export type PaywallReason =
  | 'no_subscription'
  | 'past_due'
  | 'canceled'
  | 'unpaid'

export type AccessResult =
  | { kind: 'allow' }
  | { kind: 'paywall'; reason: PaywallReason }
  | { kind: 'deactivated' }

export async function checkAccess(
  db: AppDb,
  userId: string,
): Promise<AccessResult> {
  const profile = await getProfileByUserId(db, userId)
  if (!profile) return { kind: 'paywall', reason: 'no_subscription' }
  // Deactivation gate runs ahead of every other access check. A deactivated
  // user with isComp:true must still be locked out — the shop admin's
  // intent overrides any subscription override.
  if (profile.deactivatedAt) return { kind: 'deactivated' }
  if (profile.isComp) return { kind: 'allow' }
  if (!profile.shopId) return { kind: 'paywall', reason: 'no_subscription' }

  const [customer] = await db
    .select()
    .from(stripeCustomers)
    .where(eq(stripeCustomers.shopId, profile.shopId))
    .limit(1)
  if (!customer) return { kind: 'paywall', reason: 'no_subscription' }

  const status = customer.subscriptionStatus
  if (status === 'active' || status === 'trialing') return { kind: 'allow' }

  if (status === 'canceled') {
    if (
      customer.currentPeriodEnd &&
      customer.currentPeriodEnd.getTime() > Date.now()
    ) {
      return { kind: 'allow' }
    }
    return { kind: 'paywall', reason: 'canceled' }
  }

  if (status === 'past_due') return { kind: 'paywall', reason: 'past_due' }
  if (status === 'unpaid') return { kind: 'paywall', reason: 'unpaid' }

  return { kind: 'paywall', reason: 'no_subscription' }
}

// Defense-in-depth helper for API route handlers. Middleware already blocks
// paywalled / deactivated requests, but per Option B this check ships inside
// the handler too: if the middleware matcher ever drops a route, the gate
// still holds. Returns null when access is allowed; a 403 NextResponse
// otherwise (with error code 'paywall' or 'deactivated' for the caller).
export async function paywallReject(
  db: AppDb,
  userId: string,
): Promise<NextResponse | null> {
  const access = await checkAccess(db, userId)
  if (access.kind === 'allow') return null
  if (access.kind === 'deactivated') {
    return NextResponse.json({ error: 'deactivated' }, { status: 403 })
  }
  return NextResponse.json(
    { error: 'paywall', reason: access.reason },
    { status: 403 },
  )
}
