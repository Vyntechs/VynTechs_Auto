// Node runtime required — postgres-js (used by lib/db/client) does not run in
// the Edge runtime. This is consistent with the rest of the diagnostic app.
export const runtime = 'nodejs'

import { createServerClient } from '@supabase/ssr'
import { type NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { guardCuratorRoute } from '@/lib/curator/role-gate'
import { checkAccess, isApiRoute, isPaywallExempt } from '@/lib/auth-access'

async function refreshSession(req: NextRequest) {
  const res = NextResponse.next({ request: req })
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value, options }) => {
            // Both writes are load-bearing. The req mutation keeps the
            // in-flight request in sync so the route handler sees the
            // refreshed token; res sets the Set-Cookie header back to
            // the browser. Removing either causes random-logout bugs
            // on token refresh that are difficult to trace.
            req.cookies.set(name, value)
            res.cookies.set(name, value, options)
          })
        },
      },
    },
  )
  return { res, supabase }
}

export async function middleware(req: NextRequest) {
  const { res, supabase } = await refreshSession(req)
  const pathname = req.nextUrl.pathname
  const exempt = isPaywallExempt(pathname)
  const isCurator = pathname.startsWith('/curator')

  // Fast path: exempt-and-not-curator routes skip all auth/DB I/O.
  if (exempt && !isCurator) return res

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Curator role-gate (Phase P) — runs for any /curator/* request.
  if (isCurator) {
    const result = await guardCuratorRoute(
      db,
      user?.id ?? null,
      user?.email ?? null,
      pathname,
    )
    if (result.kind === 'redirect') {
      return NextResponse.redirect(new URL(result.to, req.url))
    }
  }

  // Paywall gate — closed by default. Exempt list lives in lib/auth-access.
  // Option B: API routes are gated too (defense against curl-bypass).
  if (exempt) return res

  if (!user) {
    if (isApiRoute(pathname)) {
      return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
    }
    const next = encodeURIComponent(pathname)
    return NextResponse.redirect(new URL(`/sign-in?next=${next}`, req.url))
  }

  const access = await checkAccess(db, user.id)
  if (access.kind === 'paywall') {
    if (isApiRoute(pathname)) {
      return NextResponse.json(
        { error: 'paywall', reason: access.reason },
        { status: 403 },
      )
    }
    return NextResponse.redirect(new URL('/subscribe', req.url))
  }

  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
