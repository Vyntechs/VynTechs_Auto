'use client'

import { useState } from 'react'
import { Module } from '@/components/vt'

export default function SettingsBillingPage() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function openPortal() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' })
      const payload = await res.json()
      if (!res.ok) {
        setError(payload.error ?? 'Could not open the billing portal.')
        setBusy(false)
        return
      }
      window.location.href = payload.url
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not open the billing portal.',
      )
      setBusy(false)
    }
  }

  return (
    <Module label="Billing">
      <div
        style={{
          padding: '14px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 14,
            lineHeight: 1.5,
            color: 'var(--vt-fg-2)',
          }}
        >
          Manage your subscription, payment method, and invoices in the
          Stripe customer portal.
        </p>
        {error && (
          <div className="ai-reject" role="alert">
            {error}
          </div>
        )}
        <button
          type="button"
          className="btn btn-primary"
          onClick={openPortal}
          disabled={busy}
        >
          {busy ? 'Opening portal…' : 'Manage subscription'}
        </button>
      </div>
    </Module>
  )
}
