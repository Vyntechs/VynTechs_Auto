'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

export function SettingsGrid({
  list,
  children,
}: {
  list: ReactNode
  children: ReactNode
}) {
  const pathname = usePathname()
  const isList = pathname === '/settings'

  return (
    <div
      className="vt-settings-grid"
      data-mobile-pane={isList ? 'list' : 'detail'}
    >
      <aside className="vt-settings-list">{list}</aside>
      <section className="vt-settings-detail">
        <Link href="/settings" className="vt-settings-back">
          ← Back to Settings
        </Link>
        {children}
      </section>
    </div>
  )
}
