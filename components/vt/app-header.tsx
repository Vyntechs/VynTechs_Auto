import type { ReactNode } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { WhatsNewBadge } from './whats-new-badge'
import { SignOutButton } from './sign-out-button'
import { AppHeaderMenu } from './app-header-menu'
import { AppHeaderShopName } from './app-header-shop-name'

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
      <div className="app-header__left">
        <AppHeaderMenu />
        <div className="app-header__brand">
          <Link
            href="/today"
            aria-label="Vyntechs home"
            className="app-header__lockup"
          >
            <Image
              src="/brand/lockup.png"
              alt="Vyntechs"
              width={57}
              height={48}
              priority
            />
          </Link>
          <AppHeaderShopName />
        </div>
        {back && (
          <Link
            href={back.href}
            className="app-header__back"
            aria-label={`Back to ${back.label}`}
          >
            ← <span className="app-header__back-label">{back.label}</span>
          </Link>
        )}
      </div>
      <div className="app-header__right">
        <div style={{ textAlign: 'right' }}>
          <div className="title">{title}</div>
          {meta && <div className="meta" style={{ marginTop: 2 }}>{meta}</div>}
        </div>
        <WhatsNewBadge />
        <SignOutButton />
        {right}
      </div>
    </header>
  )
}
