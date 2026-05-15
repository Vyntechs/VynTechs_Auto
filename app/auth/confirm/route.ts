import { NextResponse, type NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { getServerSupabase } from '@/lib/supabase-server'

/** Same-origin path validator, matching the one on /sign-in and /auth/callback.
 *  Only relative paths starting with `/` and not `//` (protocol-relative). A
 *  crafted `?next=` cannot bounce the user to an external URL after the OTP
 *  exchange completes. */
function safeNextPath(raw: string | null): string {
  if (!raw) return '/today'
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/today'
  return raw
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const tokenHash = url.searchParams.get('token_hash')
  const type = url.searchParams.get('type') as EmailOtpType | null
  const next = safeNextPath(url.searchParams.get('next'))

  if (!tokenHash || !type) {
    return NextResponse.redirect(
      new URL('/sign-in?error=missing_token', req.url),
    )
  }

  const supabase = await getServerSupabase()
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
  if (error) {
    return NextResponse.redirect(
      new URL('/sign-in?error=auth_failed', req.url),
    )
  }

  return NextResponse.redirect(new URL(next, req.url))
}
