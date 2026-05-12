import type { ReactNode } from 'react'
import Link from 'next/link'
import { WhatsNewBadge } from './whats-new-badge'

export function AppHeader({
  title,
  meta,
  right,
  back,
}: {
  title: string
  meta?: ReactNode
  right?: ReactNode
  back?: { href: string; label: string }
}) {
  return (
    <header className="app-header">
      <div>
        {back && (
          <Link
            href={back.href}
            className="app-header__back"
            aria-label={`Back to ${back.label}`}
          >
            ← {back.label}
          </Link>
        )}
        <div className="title">{title}</div>
        {meta && <div className="meta" style={{ marginTop: 2 }}>{meta}</div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <WhatsNewBadge />
        {right}
      </div>
    </header>
  )
}
