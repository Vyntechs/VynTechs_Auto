'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import {
  parseInlineSimpleWorkResponse,
  type SimpleWorkProjectionView,
  type SimpleWorkEscalationView,
  type SimpleWorkWorkspaceView,
} from '@/lib/shop-os/simple-work-ui'
import type { PartRequestView } from '@/lib/shop-os/part-requests-ui'
import { SimpleWorkWorkspace } from './simple-work-workspace'
import type { InterruptionJobView } from './ticket-interruption-action'
import styles from './inline-work-workspace.module.css'

type TicketIdentity = {
  id: string
  number: number
  customerName: string
  vehicle: string
}

type Loaded = {
  workspace: SimpleWorkWorkspaceView
  partRequests: PartRequestView[]
}

export function InlineWorkWorkspace({
  ticket,
  jobId,
  onClose,
  onProjection,
  onEscalation,
  onInterrupted,
}: {
  ticket: TicketIdentity
  jobId: string
  onClose: () => void
  onProjection: (work: SimpleWorkProjectionView) => void
  onEscalation?: (job: SimpleWorkEscalationView) => void
  onInterrupted?: (job: InterruptionJobView) => void
}): React.JSX.Element {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const workPath = `/tickets/${ticket.id}/jobs/${jobId}/work`

  useEffect(() => {
    let canceled = false
    async function load(): Promise<void> {
      setLoaded(null)
      setError(false)
      try {
        const response = await fetch(`/api/tickets/${ticket.id}/jobs/${jobId}/work`, {
          method: 'GET',
          cache: 'no-store',
        })
        const body = await response.json().catch(() => null)
        const result = response.ok ? parseInlineSimpleWorkResponse(body) : null
        if (!result || result.workspace.id.toLowerCase() !== jobId.toLowerCase()) {
          throw new Error('invalid_work')
        }
        if (!canceled) setLoaded(result)
      } catch {
        if (!canceled) setError(true)
      }
    }
    void load()
    return () => { canceled = true }
  }, [attempt, jobId, ticket.id])

  if (error) {
    return (
      <section className={styles.state} aria-label="Work workspace">
        <div role="alert">
          <strong>Work could not be opened here.</strong>
          <p>The repair order is safe. Retry this tool or use the full work page.</p>
        </div>
        <div className={styles.actions}>
          <button type="button" onClick={() => setAttempt((current) => current + 1)}>Retry work</button>
          <Link href={workPath}>Open the full work page</Link>
          <button type="button" onClick={onClose}>Close</button>
        </div>
      </section>
    )
  }

  if (!loaded) {
    return (
      <section className={styles.state} aria-label="Work workspace" aria-busy="true">
        <p role="status">Opening assigned work…</p>
      </section>
    )
  }

  return (
    <SimpleWorkWorkspace
      ticket={ticket}
      initialWorkspace={loaded.workspace}
      initialPartRequests={loaded.partRequests}
      embedded
      onClose={onClose}
      onProjection={onProjection}
      onEscalation={onEscalation}
      onInterrupted={onInterrupted}
    />
  )
}
