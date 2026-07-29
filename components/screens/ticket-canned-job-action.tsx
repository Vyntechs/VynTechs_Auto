'use client'

import { useRef, useState } from 'react'
import { parseCannedJobMutationResponse } from '@/lib/shop-os/canned-jobs-ui'
import styles from './ticket-detail.module.css'

type Notice = { kind: 'status' | 'error'; text: string }

// The domain hides an unapproved job behind `conflict`, so the surface only
// offers this once the job is approved. Everything left here is a genuine
// refusal the operator can act on.
function refusalText(status: number): string {
  if (status === 401) return 'Sign in again, then save it.'
  if (status === 402) return 'An active subscription is required.'
  if (status === 403 || status === 404) return 'Only an owner can add to the canned library.'
  if (status === 409) return 'Nothing to save yet — this job has no approved price.'
  if (status === 422) return 'This job cannot be saved as a canned job.'
  if (status === 429) return 'Too many saves at once. Wait a moment, then try again.'
  return 'Could not save it to the library. Try again.'
}

export function TicketCannedJobAction({
  jobId,
  onSaved,
}: {
  jobId: string
  onSaved?: () => void
}): React.JSX.Element {
  const [pending, setPending] = useState(false)
  const [saved, setSaved] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  // One key for this job, reused by every retry: a double tap or a repeat after
  // a lost response replays the same save instead of filing a second template.
  const clientKey = useRef<string | null>(null)

  async function save(): Promise<void> {
    if (pending || saved) return
    clientKey.current ??= crypto.randomUUID()
    setPending(true)
    setNotice({ kind: 'status', text: 'Saving as canned job…' })
    try {
      const response = await fetch('/api/shop/canned-jobs/from-job', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ clientKey: clientKey.current, jobId }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        setNotice({ kind: 'error', text: refusalText(response.status) })
        return
      }
      const parsed = parseCannedJobMutationResponse(response.status, payload)
      if (!parsed) {
        setNotice({
          kind: 'error',
          text: 'The library answered incompletely. Check Settings before saving again.',
        })
        return
      }
      setSaved(true)
      setNotice({
        kind: 'status',
        text: parsed.changed
          ? `Saved to the canned library as “${parsed.cannedJob.title}”.`
          : `Already saved to the canned library as “${parsed.cannedJob.title}”.`,
      })
      onSaved?.()
    } catch {
      setNotice({
        kind: 'error',
        text: 'Could not reach the server. The repair order is unchanged; try again.',
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className={styles.cannedJobAction}>
      {!saved && (
        <button
          type="button"
          className={styles.inlineAction}
          disabled={pending}
          onClick={() => void save()}
        >
          {pending ? 'Saving as canned job…' : 'Save as canned job'}
        </button>
      )}
      {notice && (
        <p
          className={notice.kind === 'error' ? styles.assignmentError : styles.assignmentNotice}
          role={notice.kind === 'error' ? 'alert' : 'status'}
          aria-live="polite"
        >
          {notice.text}
        </p>
      )}
    </div>
  )
}
