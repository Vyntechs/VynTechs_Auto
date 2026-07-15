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

function hasMeaningfulContent(content: ReactNode): boolean {
  if (content == null || typeof content === 'boolean') return false
  if (typeof content === 'string') return content.trim().length > 0

  return true
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
  const hasNavigation = hasMeaningfulContent(navigation)
  const hasQueue = hasMeaningfulContent(queue)
  const hasContext = hasMeaningfulContent(context)

  return (
    <div className={styles.workbench}>
      <div
        className={styles.workbenchGrid}
        data-has-navigation={hasNavigation ? 'true' : undefined}
        data-has-queue={hasQueue ? 'true' : undefined}
        data-has-context={hasContext ? 'true' : undefined}
      >
        {hasNavigation ? (
          <nav
            className={styles.navigation}
            data-workbench-region="navigation"
            aria-label="Workspace navigation"
          >
            {navigation}
          </nav>
        ) : null}

        {hasQueue ? (
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

        {hasContext ? (
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
