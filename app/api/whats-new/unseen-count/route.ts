import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { countUnseenWhatsNewForUser } from '@/lib/db/queries'

export async function GET() {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Response.json({ count: 0 })
  const count = await countUnseenWhatsNewForUser(db, user.id)
  return Response.json({ count })
}
