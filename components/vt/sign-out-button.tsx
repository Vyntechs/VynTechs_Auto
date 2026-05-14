'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { SignOut } from '@phosphor-icons/react'
import { getBrowserSupabase } from '@/lib/supabase-client'

export function SignOutButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function handleSignOut() {
    if (busy) return
    setBusy(true)
    const supabase = getBrowserSupabase()
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={busy}
      aria-label="Sign out"
      title="Sign out"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
        border: 0,
        background: 'transparent',
        color: 'var(--vt-fg-3)',
        cursor: busy ? 'wait' : 'pointer',
        padding: 0,
        borderRadius: 4,
      }}
    >
      <SignOut size={16} weight="regular" aria-hidden="true" />
    </button>
  )
}
