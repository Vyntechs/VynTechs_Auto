'use client'

import { useState } from 'react'

type Props = {
  sessionId: string
  prompt: string
  onCaptured: () => void
}

type Phase = 'idle' | 'requesting' | 'looking-up' | 'review' | 'manual' | 'done'

type FetchedConditions = {
  temperatureF: number
  humidityPct?: number
  conditions?: string
  source: 'geolocation' | 'manual'
}

export function AmbientConditionsCapture({ sessionId, prompt, onCaptured }: Props) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [fetched, setFetched] = useState<FetchedConditions | null>(null)
  const [manualF, setManualF] = useState('')

  async function postBody(body: object): Promise<FetchedConditions> {
    const res = await fetch(`/api/sessions/${sessionId}/ambient`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(typeof json.error === 'string' ? json.error : `${res.status}`)
    }
    return json.conditions as FetchedConditions
  }

  async function handleUseLocation() {
    setError(null)
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('Geolocation not available on this device. Enter manually.')
      setPhase('manual')
      return
    }
    setPhase('requesting')
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setPhase('looking-up')
        try {
          const conditions = await postBody({
            source: 'geolocation',
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          })
          setFetched(conditions)
          setPhase('review')
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Lookup failed')
          setPhase('manual')
        }
      },
      (geoErr) => {
        const msg =
          geoErr.code === geoErr.PERMISSION_DENIED
            ? 'Location permission denied — enter manually.'
            : 'Could not get location — enter manually.'
        setError(msg)
        setPhase('manual')
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 },
    )
  }

  function handleAcceptFetched() {
    setPhase('done')
    onCaptured()
  }

  async function handleSubmitManual() {
    setError(null)
    const tempF = Number(manualF)
    if (!Number.isFinite(tempF) || tempF < -80 || tempF > 160) {
      setError('Enter a valid °F value between -80 and 160.')
      return
    }
    setPhase('looking-up')
    try {
      await postBody({ source: 'manual', temperatureF: tempF })
      setPhase('done')
      onCaptured()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
      setPhase('manual')
    }
  }

  if (phase === 'done') return null

  return (
    <div
      role="group"
      aria-label="Capture ambient conditions"
      style={{
        marginBottom: 12,
        padding: '14px 16px',
        border: '0.5px solid var(--vt-rule-strong)',
        borderRadius: 'var(--vt-radius-2)',
        background: 'var(--vt-bone-100)',
      }}
    >
      <p
        style={{
          fontFamily: 'var(--vt-font-serif)',
          fontSize: 14,
          color: 'var(--vt-fg)',
          lineHeight: 1.4,
          margin: '0 0 10px',
        }}
      >
        {prompt}
      </p>

      {phase === 'idle' && (
        <>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleUseLocation}
            style={{ minHeight: 48, width: '100%', marginBottom: 6 }}
          >
            Use my location
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setPhase('manual')}
            style={{ minHeight: 36, width: '100%' }}
          >
            Enter manually
          </button>
        </>
      )}

      {(phase === 'requesting' || phase === 'looking-up') && (
        <p
          style={{
            fontFamily: 'var(--vt-font-mono)',
            fontSize: 11,
            color: 'var(--vt-fg-3)',
            textAlign: 'center',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            margin: 0,
          }}
        >
          {phase === 'requesting' ? 'Requesting location…' : 'Looking up weather…'}
        </p>
      )}

      {phase === 'review' && fetched && (
        <>
          <p
            style={{
              fontFamily: 'var(--vt-font-serif)',
              fontSize: 16,
              color: 'var(--vt-fg)',
              margin: '0 0 4px',
              textAlign: 'center',
            }}
          >
            <strong>{fetched.temperatureF.toFixed(0)}°F</strong>
            {typeof fetched.humidityPct === 'number' && (
              <span style={{ color: 'var(--vt-fg-2)' }}>
                {' '}
                · {fetched.humidityPct}% RH
              </span>
            )}
            {fetched.conditions && (
              <span style={{ color: 'var(--vt-fg-2)' }}> · {fetched.conditions}</span>
            )}
          </p>
          <p
            style={{
              fontFamily: 'var(--vt-font-serif)',
              fontStyle: 'italic',
              fontSize: 12,
              color: 'var(--vt-fg-3)',
              textAlign: 'center',
              margin: '0 0 10px',
            }}
          >
            Fetched from your location. Off? Enter the bay value manually.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleAcceptFetched}
              style={{ minHeight: 44, flex: 1 }}
            >
              Looks right
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setManualF(fetched.temperatureF.toFixed(0))
                setPhase('manual')
              }}
              style={{ minHeight: 44, flex: 1 }}
            >
              Wrong
            </button>
          </div>
        </>
      )}

      {phase === 'manual' && (
        <>
          <label
            htmlFor={`ambient-f-${sessionId}`}
            style={{
              display: 'block',
              fontFamily: 'var(--vt-font-mono)',
              fontSize: 10,
              color: 'var(--vt-fg-3)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              marginBottom: 4,
            }}
          >
            Ambient °F
          </label>
          <input
            id={`ambient-f-${sessionId}`}
            inputMode="decimal"
            value={manualF}
            onChange={(e) => setManualF(e.target.value)}
            placeholder="e.g. 78"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              background: 'var(--vt-bone-100)',
              border: '0.5px solid var(--vt-rule-strong)',
              borderRadius: 'var(--vt-radius-2)',
              padding: '10px 12px',
              fontFamily: 'var(--vt-font-serif)',
              fontSize: 16,
              color: 'var(--vt-fg)',
              outline: 0,
              marginBottom: 8,
            }}
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSubmitManual}
            disabled={!manualF.trim()}
            style={{ minHeight: 44, width: '100%' }}
          >
            Save ambient temp
          </button>
        </>
      )}

      {error && (
        <p
          role="alert"
          style={{
            fontFamily: 'var(--vt-font-mono)',
            fontSize: 11,
            color: 'var(--vt-risk-destructive)',
            textAlign: 'center',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            margin: '8px 0 0',
          }}
        >
          {error}
        </p>
      )}
    </div>
  )
}
