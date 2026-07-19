import { NextResponse, type NextRequest } from 'next/server'
import { getServerSupabase } from '@/lib/supabase-server'
import { safeNextPath } from '@/lib/safe-next-path'

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
