'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getBrowserSupabase } from '@/lib/supabase-client'
import { useAppHeader } from './app-header-context'

export function AppHeaderMenu() {
  const { isFounder } = useAppHeader()
  const [open, setOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function handleSignOut() {
    if (signingOut) return
    setSigningOut(true)
    const supabase = getBrowserSupabase()
    await supabase.auth.signOut()
    setOpen(false)
    router.push('/')
    router.refresh()
  }

  return (
    <div ref={wrapRef} className="app-header__menu-wrap">
      <button
        type="button"
        className="app-header__menu-trigger"
        aria-label="Menu"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <line x1="4" y1="7" x2="20" y2="7" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="17" x2="20" y2="17" />
        </svg>
      </button>
      {open && (
        <div className="app-header__menu" role="menu">
          <Link
            href="/today"
            role="menuitem"
            className="app-header__menu-item"
            onClick={close}
          >
            My Jobs
          </Link>
          <Link
            href="/settings"
            role="menuitem"
            className="app-header__menu-item"
            onClick={close}
          >
            Settings
          </Link>
          {isFounder && (
            <Link
              href="/curator"
              role="menuitem"
              className="app-header__menu-item"
              onClick={close}
            >
              Curator
            </Link>
          )}
          <button
            type="button"
            role="menuitem"
            className="app-header__menu-item app-header__menu-item--button"
            onClick={handleSignOut}
            disabled={signingOut}
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}
    </div>
  )
}
