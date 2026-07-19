'use client'

import { useRef, useState } from 'react'
import { parsePartRequestResponse, type PartRequestView } from '@/lib/shop-os/part-requests-ui'
import styles from './parts-needed-panel.module.css'

type Props = {
  ticketId: string
  jobId: string
  initialRequests: PartRequestView[]
}

const STATUS_LABEL: Record<PartRequestView['status'], string> = {
  requested: 'Waiting on parts',
  sourced: 'Got it',
  dismissed: 'Not needed',
}

export function PartsNeededPanel({ ticketId, jobId, initialRequests }: Props) {
  const [requests, setRequests] = useState(initialRequests)
  const [description, setDescription] = useState('')
  const [preference, setPreference] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestKey = useRef<string | null>(null)

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
    if (!requestKey.current) requestKey.current = crypto.randomUUID()
    setPending(true)
    setError(null)
    try {
      const response = await fetch(`/api/tickets/${ticketId}/jobs/${jobId}/part-requests`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requestKey: requestKey.current,
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
      requestKey.current = null
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
          onChange={(event) => { setDescription(event.target.value); requestKey.current = null }} />

        <label className={styles.label} htmlFor="part-pref">Brand or where to get it <span>(optional)</span></label>
        <input id="part-pref" type="text" value={preference} maxLength={200}
          placeholder="e.g. Motorcraft, AC Delco, dealer, or a supplier"
          onChange={(event) => { setPreference(event.target.value); requestKey.current = null }} />

        <label className={styles.label} htmlFor="part-qty">How many?</label>
        <input id="part-qty" type="number" inputMode="numeric" min={1} max={99} value={quantity}
          onChange={(event) => { setQuantity(event.target.value); requestKey.current = null }} />

        <button className={styles.submit} type="submit" disabled={pending || description.trim().length < 1}>
          {pending ? 'Sending…' : 'Send to parts'}
        </button>
      </form>

      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>
  )
}
