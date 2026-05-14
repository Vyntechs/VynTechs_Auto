import type { ReactNode } from 'react'
import Link from 'next/link'
import Image from 'next/image'
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link
          href="/today"
          aria-label="Vyntechs home"
          style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}
        >
          <Image
            src="/icons/icon-512.png"
            alt=""
            width={24}
            height={24}
            priority
          />
        </Link>
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
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <WhatsNewBadge />
        {right}
      </div>
    </header>
  )
}
