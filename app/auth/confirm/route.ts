import { NextResponse, type NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { getServerSupabase } from '@/lib/supabase-server'
import { safeNextPath } from '@/lib/safe-next-path'

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
