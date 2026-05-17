import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { getServerSupabase } from '@/lib/supabase-server'
import { db } from '@/lib/db/client'
import { profiles } from '@/lib/db/schema'
import { canCurate } from '@/lib/curator/can-curate'
import { getKnowledgeItem } from '@/lib/knowledge/get-item'
import { TheoryForm } from './theory-form'

export const metadata = { title: 'New theory · Knowledge' }

export default async function NewTheoryPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>
}) {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in?next=%2Fknowledge%2Fnew%2Ftheory')
  const [profile] = await db
    .select({ role: profiles.role, shopId: profiles.shopId })
    .from(profiles)
    .where(eq(profiles.userId, user.id))
    .limit(1)
  if (!canCurate(profile?.role) || !profile?.shopId) redirect('/')
  const sp = await searchParams
  const existing = sp.id
    ? await getKnowledgeItem(db, { id: sp.id, shopId: profile.shopId })
    : null
  if (sp.id && (!existing || existing.type !== 'theory_of_operation')) redirect('/knowledge')

  return (
    <main className="vk-page">
      <header className="vk-page__head">
        <div>
          <p className="vk-page__eyebrow">{existing ? 'EDIT THEORY' : 'NEW THEORY'}</p>
          <h1 className="vk-page__title">
            {existing ? existing.title : 'New theory of operation'}
          </h1>
        </div>
      </header>
      <TheoryForm existing={existing} />
    </main>
  )
}
