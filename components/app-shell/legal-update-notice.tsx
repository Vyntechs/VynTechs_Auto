'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import styles from '@/components/app-shell/app-shell.module.css'

const NOTICE_KEY_PREFIX = 'vyntechs:legal-update:2026-07-15'

export function LegalUpdateNotice({
  audienceKey,
}: {
  audienceKey: string
}): React.ReactElement | null {
  const [visible, setVisible] = useState(false)
  const noticeKey = `${NOTICE_KEY_PREFIX}:${audienceKey}`

  useEffect(() => {
    try {
      setVisible(localStorage.getItem(noticeKey) !== 'dismissed')
    } catch {
      setVisible(true)
    }
  }, [noticeKey])

  if (!visible) return null

  function dismiss(): void {
    try {
      localStorage.setItem(noticeKey, 'dismissed')
    } catch {}
    setVisible(false)
  }

  return (
    <section
      className={styles.legalNotice}
      role="region"
      aria-label="Terms and Privacy update"
    >
      <div>
        <p className={styles.legalNoticeTitle}>Terms and Privacy update</p>
        <p>
          We revised our Privacy Policy and proposed new Terms. The new Terms
          take effect for existing subscribers on October 15, 2026.
        </p>
      </div>
      <div className={styles.legalNoticeActions}>
        <Link href="/terms">Review Terms</Link>
        <Link href="/privacy">Review Privacy</Link>
        <button type="button" onClick={dismiss} aria-label="Dismiss legal update notice">
          Dismiss
        </button>
      </div>
    </section>
  )
}
