'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { HairlineProgress } from '@/components/vt'

export function NewSessionForm() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [openSessionId, setOpenSessionId] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const attemptRef = useRef<{ fingerprint: string; key: string } | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setOpenSessionId(null)
    setGenerating(true)
    const formData = new FormData(e.currentTarget)
    const yearRaw = formData.get('vehicleYear')
    const mileageRaw = formData.get('mileage')
    const engineRaw = String(formData.get('vehicleEngine') ?? '').trim()
    const intake: Record<string, unknown> = {
      vehicleYear: Number(yearRaw),
      vehicleMake: String(formData.get('vehicleMake') ?? '').trim(),
      vehicleModel: String(formData.get('vehicleModel') ?? '').trim(),
      customerComplaint: String(formData.get('customerComplaint') ?? '').trim(),
    }
    if (engineRaw) intake.vehicleEngine = engineRaw
    if (mileageRaw && String(mileageRaw).trim()) {
      intake.mileage = Number(mileageRaw)
    }
    const fingerprint = JSON.stringify(intake)
    if (attemptRef.current?.fingerprint !== fingerprint) {
      attemptRef.current = { fingerprint, key: crypto.randomUUID() }
    }
    const payload = { ...intake, requestKey: attemptRef.current.key }

    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (res.status === 409) {
        const { openSessionId: existingId, limit } = await res.json()
        setOpenSessionId(existingId)
        const cap = typeof limit === 'number' ? limit : 5
        setError(
          `You already have ${cap} open diagnoses. Resume or close one before starting a new one.`,
        )
        setGenerating(false)
        return
      }
      if (!res.ok) {
        setError(`Could not start session (${res.status}). Try again.`)
        setGenerating(false)
        return
      }
      const { id } = await res.json()
      if (typeof id !== 'string' || !id) {
        setError('Could not start session. Try again.')
        setGenerating(false)
        return
      }
      router.push(`/sessions/${id}`)
    } catch {
      setError('Could not start session. Try again.')
      setGenerating(false)
    }
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
          {openSessionId && (
            <div style={{ marginTop: 8 }}>
              <Link
                href={`/sessions/${openSessionId}`}
                style={{ fontWeight: 600 }}
              >
                Resume open diagnosis →
              </Link>
            </div>
          )}
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
            ● Putting together your steps
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
