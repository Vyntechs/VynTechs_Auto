import { redirect } from 'next/navigation'
import Link from 'next/link'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile } from '@/lib/auth'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) redirect('/sign-in')

  return (
    <div>
      <header>
        <Link href="/sessions">Vyntechs</Link>
        <nav>
          <Link href="/sessions">Sessions</Link>
          <Link href="/sessions/new">New</Link>
          <Link href="/billing">Billing</Link>
        </nav>
      </header>
      <main>{children}</main>
    </div>
  )
}
