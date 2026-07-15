import { Children, Fragment, isValidElement, type ReactNode } from 'react'
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
  return Children.toArray(content).some((child) => {
    if (typeof child === 'string') return child.trim().length > 0
    if (
      isValidElement<{ children?: ReactNode }>(child) &&
      child.type === Fragment
    ) {
      return hasMeaningfulContent(child.props.children)
    }

    return true
  })
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
