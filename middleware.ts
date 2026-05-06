// Node runtime required — postgres-js (used by lib/db/client) does not run in
// the Edge runtime. This is consistent with the rest of the diagnostic app.
export const runtime = 'nodejs'

import { createServerClient } from '@supabase/ssr'
import { type NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { guardCuratorRoute } from '@/lib/curator/role-gate'

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

  // Curator role-gate (Phase P). Stage 3 will extend with an entitlement gate.
  if (req.nextUrl.pathname.startsWith('/curator')) {
    const { data: { user } } = await supabase.auth.getUser()
    const result = await guardCuratorRoute(db, user?.id ?? null, req.nextUrl.pathname)
    if (result.kind === 'redirect') {
      return NextResponse.redirect(new URL(result.to, req.url))
    }
  }

  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
