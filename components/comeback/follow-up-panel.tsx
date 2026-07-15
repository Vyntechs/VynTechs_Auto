'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Module } from '@/components/vt'
import { formatVehicleName } from '@/lib/format'
import type { DueFollowUp } from '@/lib/comeback/list'

export function FollowUpPanel({ items }: {
  items: DueFollowUp[]
}) {
  if (items.length === 0) return null
  return (
    <Module num="—" label={`Check-ins · ${items.length}`}>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {items.map((it) => (
          <FollowUpRow key={it.id} item={it} />
        ))}
      </ul>
    </Module>
  )
}

function FollowUpRow({ item }: {
  item: DueFollowUp
}) {
  const router = useRouter()
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState<'held' | 'comeback' | null>(null)
  const [done, setDone] = useState(false)

  const kindLabel = item.kind === '7d' ? '7-day check-in' : '30-day check-in'

  async function resolve(comebackRecorded: boolean) {
    setBusy(comebackRecorded ? 'comeback' : 'held')
    try {
      const res = await fetch(`/api/follow-ups/${item.id}/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ comebackRecorded, notes: notes || undefined }),
      })
      if (res.ok) {
        setDone(true)
        router.refresh()
      } else {
        setBusy(null)
      }
    } catch {
      setBusy(null)
    }
  }

  if (done) {
    return (
      <li style={{ fontFamily: 'var(--vt-font-serif)', fontStyle: 'italic', color: 'var(--vt-fg-2)', fontSize: 14 }}>
        Saved.
      </li>
    )
  }

  return (
    <li style={{ borderTop: '0.5px solid var(--vt-rule)', paddingTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <div className="queue-vehicle" style={{ fontWeight: 500 }}>
          {formatVehicleName(item.intake)}
        </div>
        <span
          style={{
            fontFamily: 'var(--vt-font-mono)',
            fontSize: 9,
            color: 'var(--vt-fg-3)',
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
          }}
        >
          {kindLabel}
        </span>
      </div>
      <div
        style={{
          fontFamily: 'var(--vt-font-serif)',
          fontStyle: 'italic',
          fontSize: 14,
          color: 'var(--vt-fg-2)',
          lineHeight: 1.5,
          marginBottom: 10,
        }}
      >
        Did the fix hold up? "{truncate(item.intake.customerComplaint, 80)}"
      </div>
      <textarea
        rows={2}
        placeholder="What happened? (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        style={{
          width: '100%',
          fontFamily: 'var(--vt-font-serif)',
          fontSize: 14,
          padding: 8,
          border: '0.5px solid var(--vt-rule)',
          background: 'var(--vt-bone-50)',
          color: 'var(--vt-fg)',
          resize: 'vertical',
          marginBottom: 10,
          boxSizing: 'border-box',
        }}
      />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy !== null}
          onClick={() => resolve(false)}
          style={{ minHeight: 44 }}
        >
          {busy === 'held' ? 'Saving…' : 'Held'}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy !== null}
          onClick={() => resolve(true)}
          style={{ minHeight: 44 }}
        >
          {busy === 'comeback' ? 'Saving…' : 'Came back'}
        </button>
      </div>
    </li>
  )
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n - 1).trimEnd() + '…'
}
