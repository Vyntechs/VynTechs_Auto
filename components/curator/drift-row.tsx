'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { PendingDriftAlertRow } from '@/lib/curator/queries'
import type { RiskClass } from '@/lib/db/schema'

const RISK_LABELS: Record<RiskClass, string> = {
  zero: 'Zero', low: 'Low', medium: 'Medium', high: 'High', destructive: 'Destructive',
}

export function DriftRow({ row }: { row: PendingDriftAlertRow }) {
  const router = useRouter()
  const [open, setOpen] = useState<'apply' | 'dismiss' | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const arrowDir = row.newThreshold > row.oldThreshold ? '↑' : '↓'
  const ageHours = Math.floor((Date.now() - new Date(row.createdAt).getTime()) / 3_600_000)
  const ageLabel = ageHours < 24 ? `${ageHours}h ago` : `${Math.floor(ageHours / 24)}d ago`

  return (
    <li className="vt-drift-row">
      <div className="vt-drift-cell">
        <Link href={`/curator/drift/${row.id}`} className="vt-drift-slice">
          {RISK_LABELS[row.riskClass]}-risk × {row.vehicleFamily} × {row.symptomClass}
        </Link>
        <div className="vt-drift-change">
          {row.oldThreshold.toFixed(2)} {arrowDir} {row.newThreshold.toFixed(2)}
        </div>
        <div className="vt-drift-evidence">
          {row.sampleSize} samples, {(row.comebackRate * 100).toFixed(0)}% comeback
        </div>
        <div className="vt-drift-age">{ageLabel}</div>
        {row.wasDismissedRecently && (
          <span className="vt-drift-tag-prev-dismissed">Previously dismissed</span>
        )}
      </div>
      <div className="vt-drift-actions">
        <button onClick={() => setOpen('apply')}>Apply</button>
        <button onClick={() => setOpen('dismiss')}>Dismiss</button>
      </div>
      {open && (
        <form
          className="vt-drift-confirm"
          onSubmit={async (e) => {
            e.preventDefault()
            setError(null)
            const res = await fetch(`/api/curator/drift/${row.id}/${open}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ note: note || null }),
            })
            if (!res.ok) {
              setError(`Failed to ${open} (${res.status}). Try again.`)
              return
            }
            setOpen(null)
            setNote('')
            router.refresh()
          }}
        >
          <textarea
            placeholder="Note (optional)"
            value={note}
            onChange={e => setNote(e.target.value)}
          />
          {error && <p role="alert" className="vt-drift-confirm-error">{error}</p>}
          <button type="submit">Confirm {open}</button>
          <button type="button" onClick={() => { setOpen(null); setError(null) }}>Cancel</button>
        </form>
      )}
    </li>
  )
}
