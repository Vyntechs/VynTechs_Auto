'use client'

import { useState } from 'react'

export type InterruptionJobView = {
  id: string
  assignedTechId: string | null
  workStatus: 'open' | 'in_progress' | 'blocked' | 'done' | 'canceled'
  holdKind: 'parts' | 'customer' | 'schedule' | 'shop' | null
  holdNote: string | null
  holdResumeStatus: 'open' | 'in_progress' | null
  heldAt: string | null
  heldByProfileId: string | null
  clockedOnSince: string | null
  activeSeconds: number
  updatedAt: string
}

export function parseInterruptionJob(value: unknown): InterruptionJobView | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const job = value as Record<string, unknown>
  if (typeof job.id !== 'string'
    || !(typeof job.assignedTechId === 'string' || job.assignedTechId === null)
    || !['open', 'in_progress', 'blocked', 'done', 'canceled'].includes(String(job.workStatus))
    || !(typeof job.holdKind === 'string' || job.holdKind === null)
    || !(typeof job.holdNote === 'string' || job.holdNote === null)
    || !(job.holdResumeStatus === 'open' || job.holdResumeStatus === 'in_progress' || job.holdResumeStatus === null)
    || !(typeof job.heldAt === 'string' || job.heldAt === null)
    || !(typeof job.heldByProfileId === 'string' || job.heldByProfileId === null)
    || !(typeof job.clockedOnSince === 'string' || job.clockedOnSince === null)
    || !Number.isInteger(job.activeSeconds)
    || typeof job.updatedAt !== 'string') return null
  return job as InterruptionJobView
}

export function TicketInterruptionAction({
  ticketId,
  jobId,
  className,
  onApplied,
}: {
  ticketId: string
  jobId: string
  className?: string
  onApplied: (job: InterruptionJobView) => void
}): React.JSX.Element {
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'status' | 'error'; text: string } | null>(null)

  async function resolveHold(): Promise<void> {
    if (pending) return
    setPending(true)
    setNotice({ kind: 'status', text: 'Resolving hold…' })
    try {
      const response = await fetch(`/api/tickets/${ticketId}/jobs/${jobId}/interruption`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'resolve_hold', requestKey: crypto.randomUUID() }),
      })
      const body = await response.json().catch(() => null)
      const job = response.ok && body && typeof body === 'object'
        ? parseInterruptionJob((body as { job?: unknown }).job)
        : null
      if (!job) throw new Error('resolve_failed')
      onApplied(job)
      setNotice({ kind: 'status', text: 'Hold resolved.' })
    } catch {
      setNotice({ kind: 'error', text: 'Hold was not changed. Check the connection and retry.' })
    } finally {
      setPending(false)
    }
  }

  return (
    <div>
      <button className={className} type="button" disabled={pending} onClick={() => void resolveHold()}>
        {pending ? 'Resolving hold…' : 'Resolve hold'}
      </button>
      {notice && <p role={notice.kind === 'error' ? 'alert' : 'status'} aria-live="polite">{notice.text}</p>}
    </div>
  )
}
