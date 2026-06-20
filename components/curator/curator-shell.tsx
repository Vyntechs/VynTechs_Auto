'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

// The curator console is two jobs in one shell: authoring the diagnostic
// guides techs run (Flows), and reviewing/tuning past sessions. Grouping the
// nav into named zones makes that split legible at a glance.
type NavItem = { href: string; label: string }
type NavSection = { heading: string; items: NavItem[] }

export const CURATOR_NAV: NavSection[] = [
  {
    heading: 'Diagnostic guides',
    items: [{ href: '/curator/flows', label: 'Flows' }],
  },
  {
    heading: 'Needs a decision',
    items: [
      { href: '/curator/drift', label: 'Needs review' },
      { href: '/curator/deferred', label: 'Incomplete' },
      { href: '/curator/novel', label: 'New problems' },
    ],
  },
  {
    heading: 'Browse & tune',
    items: [
      { href: '/curator/cases', label: 'All cases' },
      { href: '/curator/corpus', label: 'Solved cases' },
      { href: '/curator/founder-notes', label: 'Founder notes' },
      { href: '/curator/calibration', label: 'Calibrator' },
    ],
  },
]

export function CuratorShell({
  userName,
  children,
}: {
  userName: string
  children: ReactNode
}) {
  const pathname = usePathname()
  const [navOpen, setNavOpen] = useState(false)
  const close = useCallback(() => setNavOpen(false), [])

  // Close the mobile drawer on navigation.
  useEffect(() => {
    setNavOpen(false)
  }, [pathname])

  // Escape closes the drawer.
  useEffect(() => {
    if (!navOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setNavOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [navOpen])

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + '/')

  const initial = userName.trim().charAt(0).toUpperCase() || 'C'

  return (
    <div className="vt-app vt-curator">
      <header className="vt-topbar">
        <div className="vt-topbar__brand">
          <button
            type="button"
            className="vt-curator-menubtn"
            aria-label="Sections"
            aria-expanded={navOpen}
            aria-controls="curator-nav"
            onClick={() => setNavOpen((o) => !o)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
              <line x1="4" y1="7" x2="20" y2="7" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="17" x2="20" y2="17" />
            </svg>
          </button>
          <span className="vt-topbar__brand-mark" aria-hidden="true">▼</span>
          <span className="vt-topbar__brand-name">Vyntechs</span>
          <span className="vt-topbar__brand-sep" aria-hidden="true" />
          <span className="vt-topbar__product">Curator</span>
        </div>
        <div className="vt-topbar__center" />
        <div className="vt-topbar__right">
          <div className="vt-topbar__user">
            <span className="vt-topbar__avatar" aria-hidden="true">{initial}</span>
            <span className="vt-curator-username">{userName}</span>
          </div>
        </div>
      </header>

      <div className="vt-workspace">
        {navOpen && (
          <div className="vt-curator-scrim" aria-hidden="true" onClick={close} />
        )}
        <nav
          id="curator-nav"
          className={`vt-sidebar${navOpen ? ' vt-sidebar--open' : ''}`}
          aria-label="Curator sections"
        >
          <div className="vt-sidebar__section vt-sidebar__section--back">
            <Link href="/today" className="vt-curator-backlink" onClick={close}>
              ← My Jobs
            </Link>
          </div>
          {CURATOR_NAV.map((section) => (
            <div className="vt-sidebar__section" key={section.heading}>
              <div className="vt-sidebar__heading">{section.heading}</div>
              <div className="vt-sidebar__nav">
                {section.items.map((item) => {
                  const active = isActive(item.href)
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`vt-sidebar__item${active ? ' vt-sidebar__item--active' : ''}`}
                      aria-current={active ? 'page' : undefined}
                      onClick={close}
                    >
                      <span>{item.label}</span>
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        <main className="vt-main">{children}</main>
      </div>
    </div>
  )
}
