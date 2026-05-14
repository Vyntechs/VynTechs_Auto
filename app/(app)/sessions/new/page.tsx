import { redirect } from 'next/navigation'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile } from '@/lib/auth'
import { AppHeader } from '@/components/vt'
import { NewSessionForm } from '@/components/intake/new-session-form'

export default async function NewSessionPage() {
  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) redirect('/sign-in')

  return (
    <div className="app">
      <AppHeader
        title="New diagnosis"
        back={{ href: '/sessions', label: 'Sessions' }}
        meta={<span>{ctx.profile.fullName ?? 'Technician'}</span>}
      />
      <NewSessionForm />
    </div>
  )
}
