'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export const CURATOR_NAV = [
  { href: '/curator/drift',        label: 'Needs review' },
  { href: '/curator/deferred',     label: 'Incomplete' },
  { href: '/curator/novel',        label: 'New problems' },
  { href: '/curator/corpus',       label: 'Solved cases' },
  { href: '/curator/founder-notes', label: 'Founder notes' },
  { href: '/curator/calibration',  label: 'Calibrator' },
]

export function CuratorSidebar() {
  const pathname = usePathname()
  return (
    <nav className="vt-curator-sidebar" aria-label="Reviewer">
      <p className="vt-curator-brand">Vyntechs Reviewer</p>
      <ul>
        <li>
          <Link href="/today" className="vt-curator-nav-back">
            ← My Jobs
          </Link>
        </li>
        {CURATOR_NAV.map(({ href, label }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <li key={href}>
              <Link href={href} aria-current={active ? 'page' : undefined}
                    className={active ? 'vt-curator-nav-active' : ''}>
                {label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
