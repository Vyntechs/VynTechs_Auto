'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Pill } from './pill'

export function WhatsNewBadge() {
  const pathname = usePathname()
  const [count, setCount] = useState<number>(0)

  // Refetch on every route change so the badge clears immediately after the
  // user visits /whats-new (which stamps last_seen = now() server-side).
  useEffect(() => {
    let cancelled = false
    fetch('/api/whats-new/unseen-count', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setCount(typeof j.count === 'number' ? j.count : 0)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [pathname])

  if (count === 0) return null

  return (
    <Link
      href="/whats-new"
      aria-label={`${count} new update${count === 1 ? '' : 's'}`}
      style={{ textDecoration: 'none', display: 'inline-flex' }}
    >
      <Pill kind="new">New</Pill>
    </Link>
  )
}
