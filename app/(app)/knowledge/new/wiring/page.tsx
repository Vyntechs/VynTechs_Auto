import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { getServerSupabase } from '@/lib/supabase-server'
import { db } from '@/lib/db/client'
import { profiles } from '@/lib/db/schema'
import { canCurate } from '@/lib/curator/can-curate'
import { getKnowledgeItem } from '@/lib/knowledge/get-item'
import { WiringForm } from './wiring-form'

export const metadata = { title: 'New wiring diagram · Knowledge' }

export default async function NewWiringPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>
}) {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in?next=%2Fknowledge%2Fnew%2Fwiring')
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
  if (sp.id && (!existing || existing.type !== 'wiring_diagram')) redirect('/knowledge')

  return (
    <main className="vk-page">
      <header className="vk-page__head">
        <div>
          <p className="vk-page__eyebrow">{existing ? 'EDIT WIRING' : 'NEW WIRING'}</p>
          <h1 className="vk-page__title">{existing ? existing.title : 'New wiring diagram'}</h1>
        </div>
      </header>
      <WiringForm existing={existing} />
    </main>
  )
}
