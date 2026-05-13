import { redirect } from 'next/navigation'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { checkAccess } from '@/lib/auth-access'
import { SubscribeClient } from '@/components/screens/subscribe-client'

export const dynamic = 'force-dynamic'

export default async function SubscribePage() {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in?next=/subscribe')

  const access = await checkAccess(db, user.id)
  if (access.kind === 'allow') redirect('/today')

  return <SubscribeClient />
}
