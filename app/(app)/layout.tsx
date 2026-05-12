import { redirect } from 'next/navigation'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile } from '@/lib/auth'
import { WhatsNewBadge } from '@/components/vt/whats-new-badge'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) redirect('/sign-in')

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {children}
      <WhatsNewBadge />
    </div>
  )
}
