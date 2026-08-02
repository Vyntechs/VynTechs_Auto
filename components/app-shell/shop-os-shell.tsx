import type { ReactNode } from 'react'
import { ConnectionStatus } from '@/components/app-shell/connection-status'
import { LegalUpdateNotice } from '@/components/app-shell/legal-update-notice'
import { PwaUpdateStatus } from '@/components/app-shell/pwa-update-status'
import { StatusRegion } from '@/components/app-shell/status-region'
import styles from '@/components/app-shell/app-shell.module.css'

export function ShopOsShell({
  children,
  noticeAudienceKey,
}: {
  children: ReactNode
  noticeAudienceKey: string
}): React.ReactElement {
  return (
    <div className={styles.shell} data-customer-copy-app-shell>
      <a className={styles.skipLink} href="#shop-os-workspace">
        Skip to current work
      </a>

      <StatusRegion>
        <LegalUpdateNotice audienceKey={noticeAudienceKey} />
        <ConnectionStatus />
        <PwaUpdateStatus />
      </StatusRegion>

      <div id="shop-os-workspace" className={styles.workspace} tabIndex={-1} data-customer-copy-workspace>
        {children}
      </div>
    </div>
  )
}
