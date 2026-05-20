'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { HairlineProgress } from '@/components/vt'
import { CachedComplaintPicker } from './cached-complaint-picker'

export function NewSessionForm() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [openSessionId, setOpenSessionId] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)

  // Hoisted so the chip picker can react to vehicle changes
  const [vehicleYear, setVehicleYear] = useState('')
  const [vehicleMake, setVehicleMake] = useState('')
  const [vehicleModel, setVehicleModel] = useState('')
  const [vehicleEngine, setVehicleEngine] = useState('')
  const [dtcCodes, setDtcCodes] = useState('')
  const [selectedSymptomSlug, setSelectedSymptomSlug] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setOpenSessionId(null)
    setGenerating(true)
    const formData = new FormData(e.currentTarget)
    const mileageRaw = formData.get('mileage')
    const payload: Record<string, unknown> = {
      vehicleYear: Number(vehicleYear),
      vehicleMake: vehicleMake.trim(),
      vehicleModel: vehicleModel.trim(),
      customerComplaint: String(formData.get('customerComplaint') ?? '').trim(),
    }
    if (vehicleEngine.trim()) payload.vehicleEngine = vehicleEngine.trim()
    if (mileageRaw && String(mileageRaw).trim()) {
      payload.mileage = Number(mileageRaw)
    }
    // PR 1 additions
    const dtcArray = dtcCodes
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter((s) => /^[A-Z][0-9A-Z]{4}$/i.test(s))
    if (dtcArray.length > 0) payload.dtcCodes = dtcArray
    if (selectedSymptomSlug) payload.selectedSymptomSlug = selectedSymptomSlug

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
          value={vehicleYear}
          onChange={(e) => setVehicleYear(e.target.value)}
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
          value={vehicleMake}
          onChange={(e) => setVehicleMake(e.target.value)}
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
          value={vehicleModel}
          onChange={(e) => setVehicleModel(e.target.value)}
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
          value={vehicleEngine}
          onChange={(e) => setVehicleEngine(e.target.value)}
        />
      </div>

      <CachedComplaintPicker
        vehicleYear={vehicleYear}
        vehicleMake={vehicleMake}
        vehicleModel={vehicleModel}
        vehicleEngine={vehicleEngine}
        selectedSlug={selectedSymptomSlug}
        onPick={setSelectedSymptomSlug}
      />

      <div className="field">
        <label htmlFor="dtcCodes">DTC code(s) (optional)</label>
        <input
          id="dtcCodes"
          name="dtcCodes"
          type="text"
          disabled={generating}
          value={dtcCodes}
          onChange={(e) => setDtcCodes(e.target.value)}
          style={{ fontFamily: 'var(--vt-font-mono)' }}
          placeholder="P0087, P0088"
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
