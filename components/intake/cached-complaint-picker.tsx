'use client'

import { useEffect, useRef, useState } from 'react'

type Complaint = { slug: string; description: string; category: string }

export function CachedComplaintPicker({
  vehicleYear,
  vehicleMake,
  vehicleModel,
  vehicleEngine,
  onPick,
  selectedSlug,
}: {
  vehicleYear: string
  vehicleMake: string
  vehicleModel: string
  vehicleEngine: string
  onPick: (slug: string | null) => void
  selectedSlug: string | null
}) {
  const [loading, setLoading] = useState(false)
  const [complaints, setComplaints] = useState<Complaint[] | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    // Route requires year, make, model — engine is optional
    const allFilled = vehicleYear && vehicleMake && vehicleModel
    if (!allFilled) {
      setComplaints(null)
      onPick(null)
      return
    }
    const timer = setTimeout(async () => {
      abortRef.current?.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl
      setLoading(true)
      try {
        const url = new URL('/api/diagnostics/cached-complaints', window.location.origin)
        url.searchParams.set('year', vehicleYear)
        url.searchParams.set('make', vehicleMake)
        url.searchParams.set('model', vehicleModel)
        if (vehicleEngine) url.searchParams.set('engine', vehicleEngine)
        const res = await fetch(url.toString(), { signal: ctrl.signal })
        if (!res.ok) {
          setComplaints([])
          setLoading(false)
          return
        }
        const body = await res.json()
        setComplaints(body.complaints ?? [])
      } catch (err) {
        // An aborted request was superseded by a newer one — leave the
        // loading state to that newer request, don't clear it here.
        if ((err as Error).name === 'AbortError') return
        setComplaints([])
        setLoading(false)
        return
      }
      setLoading(false)
    }, 350)
    return () => clearTimeout(timer)
  }, [vehicleYear, vehicleMake, vehicleModel, vehicleEngine, onPick])

  // While loading, show a subtle affordance
  if (loading) {
    return (
      <div className="field" style={{ opacity: 0.6 }}>
        <label>Common complaints</label>
        <span className="eyebrow" style={{ fontSize: 10 }}>
          Looking…
        </span>
      </div>
    )
  }

  // Silent absence when vehicle doesn't resolve or no complaints exist
  if (!complaints || complaints.length === 0) {
    return null
  }

  return (
    <div className="field">
      <label>Common complaints for this vehicle</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 4 }}>
        {complaints.map((c) => (
          <button
            key={c.slug}
            type="button"
            onClick={() => onPick(selectedSlug === c.slug ? null : c.slug)}
            style={{
              padding: '6px 10px',
              borderRadius: 4,
              border: '0.5px solid var(--vt-rule-strong)',
              background:
                selectedSlug === c.slug ? 'var(--vt-bone-900)' : 'transparent',
              color: selectedSlug === c.slug ? 'var(--vt-bone-50)' : 'var(--vt-fg-2)',
              fontFamily: 'var(--vt-font-serif)',
              fontSize: 13,
              cursor: 'pointer',
              transition: 'background 0.1s ease, color 0.1s ease',
            }}
          >
            {c.description}
          </button>
        ))}
      </div>
    </div>
  )
}
