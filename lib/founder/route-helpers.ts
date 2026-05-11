import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { getServerSupabase } from '@/lib/supabase-server'
import { db } from '@/lib/db/client'
import { profiles } from '@/lib/db/schema'
import { isFounder } from '@/lib/auth'

export type FounderAuth =
  | { kind: 'ok'; profileId: string; userId: string }
  | { kind: 'forbidden'; response: NextResponse }

/**
 * Founder gate for ingestion routes. The founder is the single user
 * identified by FOUNDER_EMAIL env var (their Supabase auth email).
 * Returns their profile id for inserts; mirrors requireCurator's shape
 * so route handlers stay symmetric.
 */
export async function requireFounder(): Promise<FounderAuth> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return {
      kind: 'forbidden',
      response: NextResponse.json({ error: 'unauthed' }, { status: 401 }),
    }
  }

  if (!isFounder(user.email)) {
    return {
      kind: 'forbidden',
      response: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
    }
  }

  const [profile] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.userId, user.id))
    .limit(1)

  if (!profile) {
    return {
      kind: 'forbidden',
      response: NextResponse.json({ error: 'no_profile' }, { status: 403 }),
    }
  }

  return { kind: 'ok', profileId: profile.id, userId: user.id }
}
