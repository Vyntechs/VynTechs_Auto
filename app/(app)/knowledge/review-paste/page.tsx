import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { getServerSupabase } from '@/lib/supabase-server'
import { db } from '@/lib/db/client'
import { profiles } from '@/lib/db/schema'
import { canCurate } from '@/lib/curator/can-curate'
import { ReviewForm } from './review-form'

export const metadata = { title: 'Review · Knowledge' }

export default async function ReviewPastePage() {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in?next=%2Fknowledge%2Freview-paste')

  const [profile] = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.userId, user.id))
    .limit(1)
  if (!canCurate(profile?.role)) redirect('/')

  return (
    <main className="vk-page">
      <header className="vk-page__head">
        <div>
          <p className="vk-page__eyebrow">REVIEW</p>
          <h1 className="vk-page__title">Review AI sort</h1>
        </div>
      </header>
      <ReviewForm />
    </main>
  )
}
