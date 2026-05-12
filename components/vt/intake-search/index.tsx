'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useIntakeSearch } from '@/lib/intake/use-search'
import { tokensToPrefill, type CreateNewPrefill } from '@/lib/intake/tokens-to-prefill'
import { detectInputShape } from '@/lib/intake/input-shape'
import type { RecentCustomer } from '@/lib/intake/recent-customers'
import type { CustomerHit, VehicleHit } from '@/lib/intake/search'
import { Bar } from './bar'
import {
  DropdownEmpty,
  DropdownNoMatch,
  DropdownResults,
  DropdownSearching,
  DropdownSlow,
  DropdownWhichVehicle,
} from './dropdown'
import './intake-search.css'

export type PredictiveIntakeSearchProps = {
  recentCustomers: RecentCustomer[]
  onPickVehicle: (vehicleId: string) => void
  onCreateNew: (prefill: CreateNewPrefill) => void
}

export function PredictiveIntakeSearch({
  recentCustomers,
  onPickVehicle,
  onCreateNew,
}: PredictiveIntakeSearchProps) {
  const [value, setValue] = useState('')
  const [open, setOpen] = useState(false)
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null)
  const [tier, setTier] = useState<{ customer: CustomerHit; vehicles: VehicleHit[] } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownId = useId()

  const { state, setQuery } = useIntakeSearch()

  // ⌘K / / opens the search from anywhere on the page.
  useEffect(() => {
    const handler = (e: KeyboardEvent | globalThis.KeyboardEvent) => {
      const native = e as globalThis.KeyboardEvent
      if ((native.metaKey || native.ctrlKey) && native.key.toLowerCase() === 'k') {
        native.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
        return
      }
      if (
        native.key === '/' &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        native.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', handler as EventListener)
    return () => window.removeEventListener('keydown', handler as EventListener)
  }, [])

  // Click-outside to close.
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (inputRef.current?.parentElement?.parentElement?.contains(target)) return
      setOpen(false)
      setFocusedIdx(null)
      setTier(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Total row count for keyboard navigation wraparound.
  const rowCount = useMemo(() => {
    if (tier) return tier.vehicles.length + 1
    if (state.kind === 'matched') return state.customers.length + state.vehicles.length + 1
    if (
      state.kind === 'no-match' ||
      state.kind === 'slow' ||
      state.kind === 'searching' ||
      state.kind === 'error'
    )
      return 1
    if (state.kind === 'idle') return Math.min(recentCustomers.length, 5) + 1
    return 1
  }, [state, tier, recentCustomers.length])

  const onInputChange = useCallback(
    (v: string) => {
      setValue(v)
      setQuery(v)
      setOpen(true)
      setFocusedIdx(null)
      if (tier) setTier(null)
    },
    [setQuery, tier],
  )

  const fireCreateNew = useCallback(() => {
    const tokens = value.trim().split(/\s+/).filter((t) => t !== '')
    onCreateNew(tokensToPrefill(tokens))
    setOpen(false)
    setFocusedIdx(null)
  }, [value, onCreateNew])

  const pickCustomer = useCallback(
    (c: CustomerHit | RecentCustomer) => {
      if (c.vehicleCount === 0) {
        onCreateNew({
          name: c.name,
          phone: c.phone ?? undefined,
          email: c.email ?? undefined,
        })
        setOpen(false)
        return
      }
      // Find this customer's vehicles in the current matched results.
      if (state.kind === 'matched' && 'id' in c) {
        const owned = state.vehicles.filter((v) => v.ownerId === c.id)
        if (owned.length === 1) {
          onPickVehicle(owned[0].id)
          setOpen(false)
          return
        }
        if (owned.length > 1) {
          setTier({ customer: c as CustomerHit, vehicles: owned })
          setFocusedIdx(0)
          return
        }
      }
      // Recents path or matched-but-no-owned-vehicles-in-result fallback:
      // commit to create-new with the customer's known data prefilled.
      onCreateNew({
        name: c.name,
        phone: c.phone ?? undefined,
        email: c.email ?? undefined,
      })
      setOpen(false)
    },
    [state, onPickVehicle, onCreateNew],
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (!open) return
      if (e.key === 'Escape') {
        setOpen(false)
        setFocusedIdx(null)
        setTier(null)
        return
      }
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault()
        fireCreateNew()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setFocusedIdx((cur) => (cur === null ? 0 : (cur + 1) % rowCount))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusedIdx((cur) => (cur === null ? rowCount - 1 : (cur - 1 + rowCount) % rowCount))
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        if (focusedIdx === null) {
          fireCreateNew()
          return
        }
        if (tier) {
          if (focusedIdx < tier.vehicles.length) {
            onPickVehicle(tier.vehicles[focusedIdx].id)
            setOpen(false)
          } else {
            onCreateNew({
              name: tier.customer.name,
              phone: tier.customer.phone ?? undefined,
              email: tier.customer.email ?? undefined,
            })
            setOpen(false)
          }
          return
        }
        if (state.kind === 'matched') {
          const customerCount = state.customers.length
          if (focusedIdx < customerCount) {
            pickCustomer(state.customers[focusedIdx])
          } else if (focusedIdx < customerCount + state.vehicles.length) {
            onPickVehicle(state.vehicles[focusedIdx - customerCount].id)
            setOpen(false)
          } else {
            fireCreateNew()
          }
          return
        }
        if (state.kind === 'idle') {
          if (focusedIdx < Math.min(recentCustomers.length, 5)) {
            pickCustomer(recentCustomers[focusedIdx])
          } else {
            fireCreateNew()
          }
          return
        }
        fireCreateNew()
      }
    },
    [open, rowCount, focusedIdx, tier, state, recentCustomers, fireCreateNew, onPickVehicle, onCreateNew, pickCustomer],
  )

  const activeDescendantId = useMemo(() => {
    if (focusedIdx === null) return undefined
    if (tier) return focusedIdx >= tier.vehicles.length ? 'pis-row-create' : `pis-row-${focusedIdx}`
    if (state.kind === 'matched') {
      return focusedIdx >= state.customers.length + state.vehicles.length
        ? 'pis-row-create'
        : `pis-row-${focusedIdx}`
    }
    if (state.kind === 'idle') {
      return focusedIdx >= Math.min(recentCustomers.length, 5)
        ? 'pis-row-create'
        : `pis-row-${focusedIdx}`
    }
    return 'pis-row-create'
  }, [focusedIdx, tier, state, recentCustomers.length])

  const tokens = useMemo(() => value.trim().split(/\s+/).filter((t) => t !== ''), [value])
  const noMatchShape = useMemo(() => detectInputShape(value.trim()), [value])

  return (
    <div className="pis">
      <Bar
        value={value}
        focused={open}
        onChange={onInputChange}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        ariaControls={dropdownId}
        ariaExpanded={open}
        activeDescendant={activeDescendantId}
        inputRef={inputRef}
      />
      {open && (
        <>
          {tier ? (
            <DropdownWhichVehicle
              customerName={tier.customer.name}
              vehicles={tier.vehicles}
              focusedIdx={focusedIdx}
              onBack={() => {
                setTier(null)
                setFocusedIdx(null)
              }}
              onPickVehicle={(v) => {
                onPickVehicle(v.id)
                setOpen(false)
              }}
              onCreateNew={fireCreateNew}
            />
          ) : state.kind === 'idle' && value.trim() === '' ? (
            <DropdownEmpty
              recents={recentCustomers}
              focusedIdx={focusedIdx}
              onPickCustomer={pickCustomer}
              onCreateNew={fireCreateNew}
            />
          ) : state.kind === 'searching' ? (
            <DropdownSearching
              elapsedMs={state.elapsedMs}
              onCreateNew={fireCreateNew}
              focusedIdx={focusedIdx}
            />
          ) : state.kind === 'slow' ? (
            <DropdownSlow
              elapsedSec={state.elapsedSec}
              prev={state.prev}
              focusedIdx={focusedIdx}
              onCreateNew={fireCreateNew}
            />
          ) : state.kind === 'matched' ? (
            <DropdownResults
              customers={state.customers}
              vehicles={state.vehicles}
              latencyMs={state.latencyMs}
              focusedIdx={focusedIdx}
              onPickCustomer={pickCustomer}
              onPickVehicle={(v) => {
                onPickVehicle(v.id)
                setOpen(false)
              }}
              onCreateNew={fireCreateNew}
              highlightTokens={tokens}
            />
          ) : state.kind === 'no-match' || state.kind === 'error' ? (
            <DropdownNoMatch
              query={value}
              shape={noMatchShape}
              focusedIdx={focusedIdx}
              onCreateNew={fireCreateNew}
            />
          ) : null}
        </>
      )}
    </div>
  )
}
