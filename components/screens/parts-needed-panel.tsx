'use client'

import { useEffect, useState } from 'react'
import { parsePartRequestResponse, type PartRequestView } from '@/lib/shop-os/part-requests-ui'
import type { SimpleWorkDraftValues } from '@/lib/shop-os/simple-work-draft'
import styles from './parts-needed-panel.module.css'

export type PartRequestDraft = SimpleWorkDraftValues['parts']

type Props = {
  ticketId: string
  jobId: string
  initialRequests: PartRequestView[]
  initialDraft?: PartRequestDraft
  onDraftChange?: (dirty: boolean) => void
  onDraft?: (draft: PartRequestDraft) => void
  onRequestSaved?: () => void
}

const STATUS_LABEL: Record<PartRequestView['status'], string> = {
  requested: 'Waiting on parts',
  sourced: 'Got it',
  dismissed: 'Not needed',
}

const EMPTY_DRAFT: PartRequestDraft = {
  description: '', preference: '', quantity: '1', requestKey: null,
}

export function PartsNeededPanel({
  ticketId,
  jobId,
  initialRequests,
  initialDraft = EMPTY_DRAFT,
  onDraftChange,
  onDraft,
  onRequestSaved,
}: Props) {
  const [requests, setRequests] = useState(initialRequests)
  const [description, setDescription] = useState(initialDraft.description)
  const [preference, setPreference] = useState(initialDraft.preference)
  const [quantity, setQuantity] = useState(initialDraft.quantity)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [requestKey, setRequestKey] = useState<string | null>(initialDraft.requestKey)

  useEffect(() => {
    if (pending) return
    setDescription(initialDraft.description)
    setPreference(initialDraft.preference)
    setQuantity(initialDraft.quantity)
    setRequestKey(initialDraft.requestKey)
  }, [initialDraft, pending])

  useEffect(() => {
    onDraftChange?.(
      pending
      || description.trim().length > 0
      || preference.trim().length > 0
      || quantity !== '1'
      || requestKey !== null,
    )
    onDraft?.({ description, preference, quantity, requestKey })
  }, [description, onDraft, onDraftChange, pending, preference, quantity, requestKey])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const part = description.trim()
    const qty = Number(quantity)
    if (part.length < 1 || part.length > 200 || !Number.isInteger(qty) || qty < 1 || qty > 99) {
      setError('Enter the part you need and how many (1–99).')
      return
    }
    const pref = preference.trim()
    if (pref.length > 200) {
      setError('Keep the brand or supplier note short.')
      return
    }
    const stableRequestKey = requestKey ?? crypto.randomUUID()
    if (!requestKey) setRequestKey(stableRequestKey)
    setPending(true)
    setError(null)
    try {
      const response = await fetch(`/api/tickets/${ticketId}/jobs/${jobId}/part-requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requestKey: stableRequestKey,
          description: part,
          preference: pref ? pref : null,
          quantity: qty,
        }),
      })
      const body = await response.json().catch(() => null)
      const created = response.ok ? parsePartRequestResponse(body) : null
      if (!created) throw new Error('request_failed')
      setRequests((current) =>
        current.some((item) => item.id === created.id) ? current : [...current, created],
      )
      setDescription('')
      setPreference('')
      setQuantity('1')
      setRequestKey(null)
      // The part is durable now, so the parent can immediately offer the
      // technician's next action instead of waiting for an effect round-trip.
      onRequestSaved?.()
    } catch {
      setError('Not sent — check your connection and try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="parts-needed-heading">
      <div className={styles.heading}><span>03</span><h2 id="parts-needed-heading">Parts I need</h2></div>
      <p className={styles.helper}>
        Flag a part and the parts desk gets it. You never see a price.
      </p>

      {requests.length > 0 && (
        <ul className={styles.list}>
          {requests.map((request) => (
            <li key={request.id} className={styles.item}>
              <div className={styles.itemMain}>
                <span className={styles.qty}>{request.quantity}×</span>
                <span className={styles.desc}>{request.description}</span>
              </div>
              {request.preference && <p className={styles.pref}>{request.preference}</p>}
              <span className={styles.status} data-status={request.status}>
                {STATUS_LABEL[request.status]}
              </span>
            </li>
          ))}
        </ul>
      )}

      <form className={styles.form} onSubmit={submit}>
        <label className={styles.label} htmlFor="part-desc">What part do you need?</label>
        <input id="part-desc" type="text" value={description} maxLength={200}
          placeholder="e.g. water pump"
          onChange={(event) => { setDescription(event.target.value); setRequestKey(null) }} />

        <label className={styles.label} htmlFor="part-pref">Brand or where to get it <span>(optional)</span></label>
        <input id="part-pref" type="text" value={preference} maxLength={200}
          placeholder="e.g. Motorcraft, AC Delco, dealer, or a supplier"
          onChange={(event) => { setPreference(event.target.value); setRequestKey(null) }} />

        <label className={styles.label} htmlFor="part-qty">How many?</label>
        <input id="part-qty" type="number" inputMode="numeric" min={1} max={99} value={quantity}
          onChange={(event) => { setQuantity(event.target.value); setRequestKey(null) }} />

        <button className={styles.submit} type="submit" disabled={pending || description.trim().length < 1}>
          {pending ? 'Sending…' : 'Send to parts'}
        </button>
      </form>

      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>
  )
}
