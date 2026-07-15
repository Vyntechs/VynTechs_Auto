import type { ReactNode } from 'react'
import styles from '@/components/app-shell/app-shell.module.css'

export type AdaptiveWorkbenchProps = {
  navigation?: ReactNode
  queue?: ReactNode
  main: ReactNode
  context?: ReactNode
  queueLabel?: string
  mainLabel: string
  contextLabel?: string
}

export function AdaptiveWorkbench({
  navigation,
  queue,
  main,
  context,
  queueLabel = 'Work queue',
  mainLabel,
  contextLabel = 'Work context',
}: AdaptiveWorkbenchProps): React.ReactElement {
  return (
    <div className={styles.workbench}>
      <div className={styles.workbenchGrid}>
        {navigation != null ? (
          <nav
            className={styles.navigation}
            data-workbench-region="navigation"
            aria-label="Workspace navigation"
          >
            {navigation}
          </nav>
        ) : null}

        {queue != null ? (
          <section
            className={styles.queue}
            data-workbench-region="queue"
            aria-label={queueLabel || 'Work queue'}
          >
            {queue}
          </section>
        ) : null}

        <section
          className={styles.workbenchMain}
          data-workbench-region="main"
          aria-label={mainLabel}
        >
          {main}
        </section>

        {context != null ? (
          <section
            className={styles.context}
            data-workbench-region="context"
            aria-label={contextLabel || 'Work context'}
          >
            {context}
          </section>
        ) : null}
      </div>
    </div>
  )
}
