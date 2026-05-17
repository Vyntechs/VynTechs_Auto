'use client'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback } from 'react'
import { TYPE_LABELS, SYSTEM_CODES, type KnowledgeType } from '@/lib/knowledge/constants'

const TYPE_KEYS = Object.keys(TYPE_LABELS) as KnowledgeType[]

const STATUS_OPTIONS: Array<{ key: 'active' | 'retired' | 'all'; label: string }> = [
  { key: 'active', label: 'Active' },
  { key: 'retired', label: 'Retired' },
  { key: 'all', label: 'All' },
]

export function FilterBar() {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()

  const update = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(search.toString())
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === '') next.delete(key)
        else next.set(key, value)
      }
      next.delete('detail')
      const q = next.toString()
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false })
    },
    [router, pathname, search],
  )

  const status = (search.get('status') ?? 'active') as 'active' | 'retired' | 'all'
  const type = search.get('type') ?? ''
  const systemCode = search.get('systemCode') ?? ''
  const dtc = search.get('dtc') ?? ''
  const symptom = search.get('symptom') ?? ''
  const vehicleMake = search.get('vehicleMake') ?? ''

  const activeCount =
    (type ? 1 : 0) + (systemCode ? 1 : 0) + (dtc ? 1 : 0) + (symptom ? 1 : 0) +
    (vehicleMake ? 1 : 0) + (status !== 'active' ? 1 : 0)

  const clearAll = () => {
    router.replace(pathname, { scroll: false })
  }

  return (
    <div className="vk-filterbar">
      <div className="vk-filterbar__chips">
        <label className="vk-chip">
          Vehicle
          <input
            className="vk-chip__input"
            type="text"
            value={vehicleMake}
            placeholder="Make"
            onChange={e => update({ vehicleMake: e.target.value || null })}
          />
        </label>

        <label className="vk-chip">
          Type
          <select
            className="vk-chip__select"
            value={type}
            onChange={e => update({ type: e.target.value || null })}
          >
            <option value="">all</option>
            {TYPE_KEYS.map(k => (
              <option key={k} value={k}>{TYPE_LABELS[k]}</option>
            ))}
          </select>
        </label>

        <label className="vk-chip">
          System
          <select
            className="vk-chip__select"
            value={systemCode}
            onChange={e => update({ systemCode: e.target.value || null })}
          >
            <option value="">all</option>
            {SYSTEM_CODES.map(c => (
              <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </label>

        <label className="vk-chip">
          DTC
          <input
            className="vk-chip__input"
            type="text"
            value={dtc}
            placeholder="P0562"
            onChange={e => update({ dtc: e.target.value.toUpperCase() || null })}
          />
        </label>

        <label className="vk-chip">
          Symptom
          <input
            className="vk-chip__input"
            type="text"
            value={symptom}
            placeholder="hard_shift"
            onChange={e => update({ symptom: e.target.value || null })}
          />
        </label>

        <div className="vk-filterbar__status">
          {STATUS_OPTIONS.map(opt => (
            <button
              key={opt.key}
              type="button"
              className={`vk-chip ${status === opt.key ? 'vk-chip--active' : ''}`}
              onClick={() => update({ status: opt.key === 'active' ? null : opt.key })}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {activeCount > 0 && (
          <button type="button" className="vk-chip__clear" onClick={clearAll}>
            Clear filters
          </button>
        )}
      </div>
    </div>
  )
}
