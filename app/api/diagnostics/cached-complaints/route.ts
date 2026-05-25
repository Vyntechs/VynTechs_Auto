import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { resolvePlatformSlug } from '@/lib/diagnostics/resolve-platform'
import { listCachedSymptomsForPlatform } from '@/lib/diagnostics/cached-lookup'

export async function GET(req: Request) {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const yearRaw = url.searchParams.get('year')
  const make = url.searchParams.get('make')?.trim()
  const model = url.searchParams.get('model')?.trim()
  const engine = url.searchParams.get('engine')?.trim() ?? ''

  if (!yearRaw || !make || !model) {
    return NextResponse.json({ error: 'missing required vehicle params' }, { status: 400 })
  }
  const year = Number(yearRaw)
  if (!Number.isFinite(year)) {
    return NextResponse.json({ error: 'invalid year' }, { status: 400 })
  }

  const platformSlug = resolvePlatformSlug({ year, make, model, engine })
  if (!platformSlug) {
    return NextResponse.json({ platformSlug: null, complaints: [] })
  }

  const complaints = await listCachedSymptomsForPlatform({ db, platformSlug })
  return NextResponse.json({ platformSlug, complaints })
}
