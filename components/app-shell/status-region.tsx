'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import styles from '@/components/app-shell/app-shell.module.css'

/* The region floats over the bottom of the viewport, which is also where a
   sticky form footer puts Cancel and the submit button. Publish how much of the
   viewport bottom it occupies so those footers can sit above it rather than
   underneath it. Empty region publishes 0px. */
export function StatusRegion({
  children,
}: {
  children: ReactNode
}): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const root = document.documentElement

    function publish(): void {
      if (!node) return
      const rect = node.getBoundingClientRect()
      const clearance =
        rect.height > 0 ? Math.ceil(window.innerHeight - rect.top) : 0
      root.style.setProperty('--vt-status-region-clearance', `${clearance}px`)
    }

    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(node)
    window.addEventListener('resize', publish)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', publish)
      root.style.removeProperty('--vt-status-region-clearance')
    }
  }, [])

  return (
    <div
      ref={ref}
      className={styles.statusRegion}
      role="region"
      aria-label="Application status"
    >
      {children}
    </div>
  )
}
