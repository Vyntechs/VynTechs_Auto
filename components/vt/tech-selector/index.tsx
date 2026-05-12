'use client'

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
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
  const { team, selectedId, onChange, workloadFailed = false } = props
  const labelId = useId()
  const listboxId = `${labelId}-listbox`
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onDocMouseDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [open])

  // Reset the keyboard-focused row whenever the popover opens or the filter
  // shrinks the list past the current index.
  useEffect(() => {
    if (open) setActiveIndex(0)
  }, [open])
  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  // Solo inert variant.
  if (team.length === 1) {
    return (
      <div
        ref={rootRef}
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

  const selected = selectedId ? team.find((m) => m.id === selectedId) ?? null : null
  const showSearch = team.length > 5
  const filteredTeam =
    showSearch && query.trim() !== ''
      ? team.filter((m) => m.name.toLowerCase().includes(query.trim().toLowerCase()))
      : team

  const optionIdOf = (memberId: string) => `${listboxId}-opt-${memberId}`

  function commit(id: string | null) {
    onChange(id)
    setOpen(false)
  }

  function onTriggerKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      return
    }
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        setOpen(true)
      }
      return
    }
    if (filteredTeam.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % filteredTeam.length)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (i - 1 + filteredTeam.length) % filteredTeam.length)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const m = filteredTeam[activeIndex]
      if (m) commit(m.id)
      return
    }
  }

  return (
    <div ref={rootRef} className="ts" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="ts__label">Assigned to</span>
      <button
        type="button"
        className="ts__trigger"
        role="combobox"
        aria-labelledby={labelId}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={
          open && filteredTeam[activeIndex]
            ? optionIdOf(filteredTeam[activeIndex].id)
            : undefined
        }
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
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

      {open && (
        <div className="ts__popover">
          {showSearch && (
            <div className="ts__search">
              <input
                type="search"
                role="searchbox"
                className="ts__search-input"
                placeholder="Filter techs"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <span className="ts__search-count">
                {filteredTeam.length} of {team.length}
              </span>
            </div>
          )}
          <span className="ts__eyebrow">Assigning to</span>
          <ul id={listboxId} className="ts__list" role="listbox">
            {filteredTeam.map((m, idx) => (
              <li
                key={m.id}
                id={optionIdOf(m.id)}
                role="option"
                aria-selected={selectedId === m.id}
                className={`ts__row${selectedId === m.id ? ' ts__row--selected' : ''}${
                  idx === activeIndex ? ' ts__row--active' : ''
                }`}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => commit(m.id)}
              >
                <span className="ts__avatar" aria-hidden="true">{initials(m.name)}</span>
                <span className="ts__name">{m.name}</span>
                {m.isCurrentUser && <span className="ts__tag">You</span>}
                {!workloadFailed && m.workload && (
                  <span
                    className={`ts__badge${m.workload.open >= 5 ? ' ts__badge--busy' : ''}`}
                  >
                    <span className="ts__badge-num ts__badge-num--open">
                      {m.workload.open} open
                    </span>
                    <span className="ts__badge-sep" aria-hidden="true">·</span>
                    <span className="ts__badge-num ts__badge-num--today">
                      {m.workload.today} today
                    </span>
                  </span>
                )}
              </li>
            ))}
            {selectedId !== null && (
              <li
                role="option"
                aria-selected="false"
                aria-label="Clear assignment, return to open queue"
                className="ts__row ts__row--clear"
                onClick={() => commit(null)}
              >
                <span className="ts__name">× Clear · Open queue</span>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
