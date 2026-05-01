import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile } from '@/lib/auth'
import { listSessionsForShop } from '@/lib/db/queries'

export default async function SessionsPage() {
  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) redirect('/sign-in')

  const items = ctx.profile.shopId
    ? await listSessionsForShop(db, ctx.profile.shopId)
    : []

  return (
    <main>
      <header>
        <h1>Sessions</h1>
        <Link href="/sessions/new">New diagnosis</Link>
      </header>
      {items.length === 0 ? (
        <p>No sessions yet. Start your first diagnosis.</p>
      ) : (
        <ul>
          {items.map((s) => (
            <li key={s.id}>
              <Link href={`/sessions/${s.id}`}>
                <div>
                  <span>
                    {s.intake.vehicleYear} {s.intake.vehicleMake} {s.intake.vehicleModel}
                  </span>
                  <span>{s.status}</span>
                </div>
                <p>{s.intake.customerComplaint}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
