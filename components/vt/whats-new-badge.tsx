import Link from 'next/link'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { countUnseenWhatsNewForUser } from '@/lib/db/queries'
import { Pill } from './pill'

export async function WhatsNewBadge() {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const unseen = await countUnseenWhatsNewForUser(db, user.id)
  if (unseen === 0) return null

  return (
    <Link
      href="/whats-new"
      aria-label={`${unseen} new update${unseen === 1 ? '' : 's'}`}
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        zIndex: 50,
        textDecoration: 'none',
      }}
    >
      <Pill kind="new">New</Pill>
    </Link>
  )
}
