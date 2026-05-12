'use client'

import { useId } from 'react'
import './tech-selector.css'

export type TeamMember = {
  id: string
  name: string
  isCurrentUser: boolean
  workload?: { open: number; today: number }
}

export type TechSelectorProps = {
  currentUserId: string
  team: TeamMember[]
  workloadFailed?: boolean
  selectedId: string | null
  onChange: (id: string | null) => void
}

export function TechSelector(props: TechSelectorProps) {
  const { team, selectedId } = props
  const labelId = useId()

  // Solo inert variant.
  if (team.length === 1) {
    return (
      <div
        className="ts ts--solo"
        role="group"
        aria-labelledby={labelId}
        aria-disabled="true"
      >
        <span id={labelId} className="ts__label">Assigned to</span>
        <div className="ts__trigger ts__trigger--inert">
          <span className="ts__avatar" aria-hidden="true">
            {initials(team[0].name)}
          </span>
          <span className="ts__name">You</span>
          <span className="ts__tag">Only tech</span>
        </div>
      </div>
    )
  }

  // Active multi-member variant.
  const selected = selectedId ? team.find((m) => m.id === selectedId) ?? null : null
  return (
    <div className="ts" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="ts__label">Assigned to</span>
      <button
        type="button"
        className="ts__trigger"
        role="combobox"
        aria-labelledby={labelId}
        aria-haspopup="listbox"
        aria-expanded={false}
      >
        {selected ? (
          <>
            <span className="ts__avatar" aria-hidden="true">{initials(selected.name)}</span>
            <span className="ts__name">{selected.name}</span>
          </>
        ) : (
          <span className="ts__name ts__name--placeholder">Open queue</span>
        )}
        <span className="ts__caret" aria-hidden="true">▾</span>
      </button>
    </div>
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
