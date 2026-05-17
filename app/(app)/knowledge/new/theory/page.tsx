import Link from 'next/link'
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
      {!existing && <PasteHint />}
      <TheoryForm existing={existing} />
    </main>
  )
}

/**
 * Lower-friction shortcut for prose-heavy theory content. The manual form
 * below is fine when you're building a theory from scratch, but most theory
 * entries are pasted from an OEM source — and the paste flow's AI parser
 * extracts the heading/body sections for you. Shown only on the "new"
 * surface; hidden in edit mode where the form is already populated.
 */
function PasteHint() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 8,
        padding: '12px 16px',
        margin: '0 0 8px',
        border: '0.5px solid var(--vt-rule)',
        borderLeft: '2px solid var(--vt-fg-3)',
        background: 'var(--vt-bone-50)',
        borderRadius: 2,
        fontFamily: 'var(--vt-font-serif)',
        fontSize: 14,
        lineHeight: 1.5,
        color: 'var(--vt-fg-2)',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--vt-font-mono)',
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--vt-fg-3)',
          flexShrink: 0,
        }}
      >
        TIP
      </span>
      <span>
        Got OEM text to paste?{' '}
        <Link
          href="/knowledge"
          style={{
            color: 'var(--vt-fg)',
            fontWeight: 500,
            borderBottom: '1px solid var(--vt-fg-3)',
            textDecoration: 'none',
          }}
        >
          Use the paste path
        </Link>{' '}
        — AI extracts the heading/body sections for you. The manual form below
        stays as the fallback when you don&apos;t have OEM text in hand.
      </span>
    </div>
  )
}
