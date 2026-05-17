import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { getServerSupabase } from '@/lib/supabase-server'
import { db } from '@/lib/db/client'
import { profiles } from '@/lib/db/schema'
import { canCurate } from './can-curate'

export async function requireCurator(): Promise<
  | { kind: 'ok'; profileId: string; shopId: string }
  | { kind: 'forbidden'; response: NextResponse }
> {
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

  const [profile] = await db
    .select({ id: profiles.id, role: profiles.role, shopId: profiles.shopId })
    .from(profiles)
    .where(eq(profiles.userId, user.id))
    .limit(1)

  if (!profile || !canCurate(profile.role) || !profile.shopId) {
    return {
      kind: 'forbidden',
      response: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
    }
  }

  return { kind: 'ok', profileId: profile.id, shopId: profile.shopId }
}
