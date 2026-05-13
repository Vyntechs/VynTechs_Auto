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
  '/checkout/success',
  '/billing',
  '/whats-new',
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

export async function checkAccess(
  db: AppDb,
  userId: string,
): Promise<AccessResult> {
  const profile = await getProfileByUserId(db, userId)
  if (!profile) return { kind: 'paywall', reason: 'no_subscription' }
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
// paywalled requests, but per Option B this check ships inside the handler
// too: if the middleware matcher ever drops a route, the gate still holds.
// Returns null when access is allowed; a 403 NextResponse otherwise.
export async function paywallReject(
  db: AppDb,
  userId: string,
): Promise<NextResponse | null> {
  const access = await checkAccess(db, userId)
  if (access.kind === 'allow') return null
  return NextResponse.json(
    { error: 'paywall', reason: access.reason },
    { status: 403 },
  )
}
