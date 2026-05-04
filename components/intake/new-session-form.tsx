'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { HairlineProgress } from '@/components/vt'

export function NewSessionForm() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setGenerating(true)
    const formData = new FormData(e.currentTarget)
    const yearRaw = formData.get('vehicleYear')
    const mileageRaw = formData.get('mileage')
    const engineRaw = String(formData.get('vehicleEngine') ?? '').trim()
    const payload: Record<string, unknown> = {
      vehicleYear: Number(yearRaw),
      vehicleMake: String(formData.get('vehicleMake') ?? '').trim(),
      vehicleModel: String(formData.get('vehicleModel') ?? '').trim(),
      customerComplaint: String(formData.get('customerComplaint') ?? '').trim(),
    }
    if (engineRaw) payload.vehicleEngine = engineRaw
    if (mileageRaw && String(mileageRaw).trim()) {
      payload.mileage = Number(mileageRaw)
    }

    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (res.status === 409) {
      const { openSessionId } = await res.json()
      router.push(`/sessions/${openSessionId}`)
      return
    }
    if (!res.ok) {
      setError(`Could not start session (${res.status}). Try again.`)
      setGenerating(false)
      return
    }
    const { id } = await res.json()
    router.push(`/sessions/${id}`)
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        padding: '14px 16px',
        flex: 1,
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <span className="eyebrow">Intake · vehicle + complaint required</span>

      <div className="field" style={{ marginTop: 10 }}>
        <label htmlFor="vehicleYear">Year</label>
        <input
          id="vehicleYear"
          name="vehicleYear"
          type="number"
          inputMode="numeric"
          required
          disabled={generating}
          style={{ fontFamily: 'var(--vt-font-mono)' }}
          placeholder="2018"
        />
      </div>

      <div className="field">
        <label htmlFor="vehicleMake">Make</label>
        <input
          id="vehicleMake"
          name="vehicleMake"
          type="text"
          required
          disabled={generating}
          autoCapitalize="words"
          placeholder="Ford"
        />
      </div>

      <div className="field">
        <label htmlFor="vehicleModel">Model</label>
        <input
          id="vehicleModel"
          name="vehicleModel"
          type="text"
          required
          disabled={generating}
          autoCapitalize="words"
          placeholder="F-150"
        />
      </div>

      <div className="field">
        <label htmlFor="vehicleEngine">Engine (optional)</label>
        <input
          id="vehicleEngine"
          name="vehicleEngine"
          type="text"
          disabled={generating}
          placeholder="3.5L EcoBoost"
        />
      </div>

      <div className="field">
        <label htmlFor="mileage">Mileage (optional)</label>
        <input
          id="mileage"
          name="mileage"
          type="number"
          inputMode="numeric"
          disabled={generating}
          style={{ fontFamily: 'var(--vt-font-mono)' }}
          placeholder="85,210"
        />
      </div>

      <div className="field">
        <label htmlFor="customerComplaint">Customer complaint</label>
        <textarea
          id="customerComplaint"
          name="customerComplaint"
          rows={3}
          required
          disabled={generating}
          placeholder="Loss of power up hills, intermittent wrench light."
        />
      </div>

      {error && (
        <div className="ai-reject" role="alert">
          {error}
        </div>
      )}

      {generating && (
        <div
          aria-live="polite"
          style={{
            marginTop: 14,
            padding: '14px 0',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <span
            className="eyebrow"
            style={{ color: 'var(--vt-signal-500)' }}
          >
            ● Building your diagnostic plan
          </span>
          <p
            style={{
              fontFamily: 'var(--vt-font-serif)',
              fontStyle: 'italic',
              fontSize: 14,
              color: 'var(--vt-fg-2)',
              lineHeight: 1.5,
              margin: 0,
            }}
          >
            Looking through past cases and pulling reference info. Usually 5–15 seconds.
          </p>
          <HairlineProgress />
        </div>
      )}

      <div
        style={{
          padding: '20px 0 4px',
          marginTop: 'auto',
          display: 'flex',
          gap: 8,
        }}
      >
        <button
          type="submit"
          className="btn btn-primary"
          disabled={generating}
          style={{ flex: 1 }}
        >
          {generating ? 'Generating…' : 'Start diagnosis'}
        </button>
      </div>
    </form>
  )
}
