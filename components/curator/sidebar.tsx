'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export const CURATOR_NAV = [
  { href: '/curator/drift',        label: 'Needs review' },
  { href: '/curator/deferred',     label: 'Incomplete' },
  { href: '/curator/novel',        label: 'New problems' },
  { href: '/curator/corpus',       label: 'Solved cases' },
  { href: '/curator/calibration',  label: 'Calibrator' },
]

export function CuratorSidebar() {
  const pathname = usePathname()
  return (
    <nav className="vt-curator-sidebar" aria-label="Curator console">
      <p className="vt-curator-brand">Vyntechs Curator</p>
      <ul>
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
