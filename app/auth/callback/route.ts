import { NextResponse, type NextRequest } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'

/** Same-origin path validator, matching the one on /sign-in. Only relative
 *  paths starting with `/` and not `//` (protocol-relative) — anything else
 *  falls through to /today so a crafted `?next=` can't bounce the user to
 *  an external URL after Google OAuth completes. */
function safeNextPath(raw: string | null): string {
  if (!raw) return '/today'
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/today'
  return raw
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const next = safeNextPath(url.searchParams.get('next'))

  if (!code) {
    return NextResponse.redirect(new URL('/sign-in?error=missing_code', req.url))
  }

  const supabase = await getServerSupabase()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    return NextResponse.redirect(
      new URL('/sign-in?error=oauth_failed', req.url),
    )
  }

  return NextResponse.redirect(new URL(next, req.url))
}
