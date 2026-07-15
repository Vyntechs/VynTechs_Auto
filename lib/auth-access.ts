import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import type { AppDb } from './db/queries'
import { getProfileByUserId } from './db/queries'
import { stripeCustomers } from './db/schema'
import { resolveShopEntitlements, type ShopEntitlements } from './entitlements'
import {
  isDiagnosticsReleaseEnabled,
  OPERATIONAL_MEDIA_UNAVAILABLE,
} from './release-policy'

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
  // Self-serve "I forgot my password" entry point — locked-out users have
  // no session, so the auth gate must let them through to request the
  // recovery email.
  '/forgot-password',
  // Deactivated landing — a deactivated user with a live session must be
  // able to reach this page without bouncing through the paywall or back
  // through the deactivation gate (which would loop).
  '/deactivated',
  // Privacy policy — must be reachable signed-out (GDPR Article 12) and
  // by deactivated users; sits in the fast-path exempt set so middleware
  // never bounces a public-policy reader to /sign-in.
  '/privacy',
  // Terms of Service — same public-reachability requirement as /privacy;
  // also signs the contract every shop accepts on sign-up, so it must be
  // readable without auth at any point.
  '/terms',
  // The browser must fetch the service worker before any session exists.
  '/sw.js',
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

// Diagnostic-engine surfaces gated by the per-shop diagnostics entitlement
// (plan §3.4). Mirrors the guardCuratorRoute per-surface pattern: middleware
// checks these after the paywall gate, and entitlementReject() repeats the
// check inside the route handlers as defense-in-depth. Everything else
// (tickets, quotes, invoices, history) stays entitlement-free.
const DIAGNOSTICS_GATED_PREFIXES = ['/sessions', '/api/sessions', '/api/artifacts']

export function isDiagnosticsGatedRoute(pathname: string): boolean {
  if (pathname === '/api/intake/submit') return true
  return DIAGNOSTICS_GATED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}

export type PaywallReason =
  | 'no_subscription'
  | 'past_due'
  | 'canceled'
  | 'unpaid'

export type AccessResult =
  | { kind: 'allow'; entitlements: ShopEntitlements }
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
  // Comp bypasses billing, not global release policy.
  if (profile.isComp) {
    return {
      kind: 'allow',
      entitlements: await resolveShopEntitlements(db, {
        shopId: profile.shopId,
        isComp: true,
      }),
    }
  }
  if (!profile.shopId) return { kind: 'paywall', reason: 'no_subscription' }

  const [customer] = await db
    .select()
    .from(stripeCustomers)
    .where(eq(stripeCustomers.shopId, profile.shopId))
    .limit(1)
  if (!customer) return { kind: 'paywall', reason: 'no_subscription' }

  const allow = async (): Promise<AccessResult> => ({
    kind: 'allow',
    entitlements: await resolveShopEntitlements(db, { shopId: profile.shopId }),
  })

  const status = customer.subscriptionStatus
  if (status === 'active' || status === 'trialing') return allow()

  if (status === 'canceled') {
    if (
      customer.currentPeriodEnd &&
      customer.currentPeriodEnd.getTime() > Date.now()
    ) {
      return allow()
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

// Twin of paywallReject for the diagnostics add-on: same defense-in-depth
// posture, one extra check. A strict superset — paywalled or deactivated
// requests reject exactly as paywallReject would, and an allowed request
// from a shop without the diagnostics entitlement rejects 403 with error
// code 'entitlement'. Route handlers under /api/sessions/* and /api/intake/*
// use this INSTEAD of paywallReject so a single checkAccess round-trip
// covers both gates. Fail closed.
export async function entitlementReject(
  db: AppDb,
  userId: string,
): Promise<NextResponse | null> {
  const access = await checkAccess(db, userId)
  if (access.kind === 'deactivated') {
    return NextResponse.json({ error: 'deactivated' }, { status: 403 })
  }
  if (access.kind === 'paywall') {
    return NextResponse.json(
      { error: 'paywall', reason: access.reason },
      { status: 403 },
    )
  }
  if (!isDiagnosticsReleaseEnabled()) {
    return NextResponse.json(
      OPERATIONAL_MEDIA_UNAVAILABLE.body,
      { status: OPERATIONAL_MEDIA_UNAVAILABLE.status },
    )
  }
  if (!access.entitlements.diagnostics) {
    return NextResponse.json(
      { error: 'entitlement', entitlement: 'diagnostics' },
      { status: 403 },
    )
  }
  return null
}
