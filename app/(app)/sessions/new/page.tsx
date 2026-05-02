import { redirect } from 'next/navigation'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile } from '@/lib/auth'
import { NewSessionForm } from '@/components/intake/new-session-form'

export default async function NewSessionPage() {
  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) redirect('/sign-in')

  return (
    <main>
      <header>
        <h1>New diagnosis</h1>
      </header>
      <NewSessionForm />
    </main>
  )
}
