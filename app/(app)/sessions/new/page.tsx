import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft } from '@phosphor-icons/react/dist/ssr'
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
        meta={<span>{ctx.profile.fullName ?? 'Technician'}</span>}
        right={
          <Link
            href="/sessions"
            aria-label="Back to sessions"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              color: 'var(--vt-fg-2)',
              textDecoration: 'none',
              fontFamily: 'var(--vt-font-mono)',
              fontSize: 10,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
            }}
          >
            <ArrowLeft size={14} aria-hidden="true" />
            Back
          </Link>
        }
      />
      <NewSessionForm />
    </div>
  )
}
