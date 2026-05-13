'use client'

import { useState } from 'react'
import { AppHeader, Module } from '@/components/vt'

export function SubscribeClient() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function restart() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/stripe/checkout', { method: 'POST' })
      const payload = await res.json()
      if (!res.ok) {
        setError(payload.error ?? 'Could not start checkout.')
        setBusy(false)
        return
      }
      window.location.href = payload.url
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not start checkout.',
      )
      setBusy(false)
    }
  }

  return (
    <div className="app">
      <AppHeader
        title="Subscribe"
        meta={<span>Vyntechs · $100/month</span>}
      />
      <div
        style={{
          padding: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          flex: 1,
        }}
      >
        <Module num="01" label="Your subscription isn't active">
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
              Restart it to get back to diagnosing.
            </p>
            {error && (
              <div className="ai-reject" role="alert">
                {error}
              </div>
            )}
            <button
              type="button"
              className="btn btn-primary"
              onClick={restart}
              disabled={busy}
            >
              {busy ? 'Opening checkout…' : 'Restart subscription — $100/month'}
            </button>
          </div>
        </Module>
      </div>
    </div>
  )
}
