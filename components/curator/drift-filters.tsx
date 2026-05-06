'use client'

import { useRouter, useSearchParams } from 'next/navigation'

const RISKS = ['zero', 'low', 'medium', 'high', 'destructive'] as const

export function DriftFilters({ current }: { current: { risk?: string; vehicle?: string; symptom?: string } }) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function update(key: 'risk' | 'vehicle' | 'symptom', value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    router.push(`/curator/drift${params.toString() ? '?' + params.toString() : ''}`)
  }

  return (
    <div className="vt-drift-filters">
      <select value={current.risk ?? ''} onChange={e => update('risk', e.target.value)}>
        <option value="">All risks</option>
        {RISKS.map(r => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}
      </select>
      <input
        type="text"
        placeholder="Vehicle family"
        defaultValue={current.vehicle ?? ''}
        onBlur={e => update('vehicle', e.target.value)}
      />
      <input
        type="text"
        placeholder="Symptom class"
        defaultValue={current.symptom ?? ''}
        onBlur={e => update('symptom', e.target.value)}
      />
    </div>
  )
}
