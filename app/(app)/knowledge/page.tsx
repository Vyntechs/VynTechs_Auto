import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { getServerSupabase } from '@/lib/supabase-server'
import { db } from '@/lib/db/client'
import { profiles } from '@/lib/db/schema'
import { canCurate } from '@/lib/curator/can-curate'
import { KnowledgePasteForm } from './paste-form'

// PR 2 placeholder. Claude Design's PR 5 package replaces this with the real
// Knowledge page (list view, filters, detail drawer). For now the page exists
// so the paste/save APIs are exercisable on the preview deploy.
export const metadata = { title: 'Knowledge (preview)' }

export default async function KnowledgePage() {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in?next=%2Fknowledge')
  const [profile] = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.userId, user.id))
    .limit(1)
  if (!canCurate(profile?.role)) redirect('/')

  return (
    <main style={{ maxWidth: 720, margin: '24px auto', padding: '0 16px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>Knowledge (preview)</h1>
      <p style={{ color: '#666', marginBottom: 24, fontSize: 14 }}>
        Placeholder for PR 5. Paste reference text below; the AI proposes structured
        fields; review and save.
      </p>
      <KnowledgePasteForm />
    </main>
  )
}
