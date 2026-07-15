'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import styles from '@/components/app-shell/app-shell.module.css'

const NOTICE_KEY = 'vyntechs:legal-update:2026-07-15'

export function LegalUpdateNotice(): React.ReactElement | null {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    try {
      setVisible(localStorage.getItem(NOTICE_KEY) !== 'dismissed')
    } catch {
      setVisible(true)
    }
  }, [])

  if (!visible) return null

  function dismiss(): void {
    try {
      localStorage.setItem(NOTICE_KEY, 'dismissed')
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
          We revised our Privacy Policy and proposed new Terms. Existing
          subscribers keep their prior Terms until 30 days after this notice
          first appears.
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
