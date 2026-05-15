'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export const CURATOR_NAV = [
  { href: '/curator/cases',         label: 'All cases' },
  { href: '/curator/drift',         label: 'Needs review' },
  { href: '/curator/deferred',      label: 'Incomplete' },
  { href: '/curator/novel',         label: 'New problems' },
  { href: '/curator/corpus',        label: 'Solved cases' },
  { href: '/curator/founder-notes', label: 'Founder notes' },
  { href: '/curator/calibration',   label: 'Calibrator' },
]

export function CuratorSidebar() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLElement>(null)
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

  const activeLabel =
    CURATOR_NAV.find(
      ({ href }) => pathname === href || pathname.startsWith(href + '/'),
    )?.label ?? 'Reviewer'

  return (
    <nav
      ref={wrapRef}
      className={`vt-curator-sidebar${open ? ' vt-curator-sidebar--open' : ''}`}
      aria-label="Reviewer"
    >
      <button
        type="button"
        className="vt-curator-mobile-toggle"
        aria-label="Reviewer sections"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
      >
        <svg
          width="22"
          height="22"
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
        <span className="vt-curator-mobile-toggle-label">{activeLabel}</span>
      </button>
      <p className="vt-curator-brand">Vyntechs Reviewer</p>
      <ul>
        <li>
          <Link href="/today" className="vt-curator-nav-back" onClick={close}>
            ← My Jobs
          </Link>
        </li>
        {CURATOR_NAV.map(({ href, label }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={active ? 'vt-curator-nav-active' : ''}
                onClick={close}
              >
                {label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
