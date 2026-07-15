import type { ReactNode } from 'react'
import { ConnectionStatus } from '@/components/app-shell/connection-status'
import { LegalUpdateNotice } from '@/components/app-shell/legal-update-notice'
import { PwaUpdateStatus } from '@/components/app-shell/pwa-update-status'
import styles from '@/components/app-shell/app-shell.module.css'

export function ShopOsShell({
  children,
  noticeAudienceKey,
}: {
  children: ReactNode
  noticeAudienceKey: string
}): React.ReactElement {
  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#shop-os-workspace">
        Skip to current work
      </a>

      <div
        className={styles.statusRegion}
        role="region"
        aria-label="Application status"
      >
        <LegalUpdateNotice audienceKey={noticeAudienceKey} />
        <ConnectionStatus />
        <PwaUpdateStatus />
      </div>

      <div id="shop-os-workspace" className={styles.workspace} tabIndex={-1}>
        {children}
      </div>
    </div>
  )
}
