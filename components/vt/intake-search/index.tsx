'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useIntakeSearch } from '@/lib/intake/use-search'
import { tokensToPrefill, type CreateNewPrefill } from '@/lib/intake/tokens-to-prefill'
import { detectInputShape } from '@/lib/intake/input-shape'
import type { RecentCustomer } from '@/lib/intake/recent-customers'
import type { CustomerHit, CustomerVehicle, VehicleHit } from '@/lib/intake/search'
import { Bar } from './bar'
import {
  DropdownEmpty,
  DropdownNoMatch,
  DropdownResults,
  DropdownSearching,
  DropdownSlow,
  DropdownUnavailable,
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
  const [tier, setTier] = useState<{
    customer: { id: string; name: string; phone: string | null; email: string | null }
    vehicles: CustomerVehicle[]
  } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownId = useId()

  const { state, setQuery, retry } = useIntakeSearch()

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
    if (state.kind === 'matched') return state.customers.length + state.vehicles.length
    if (state.kind === 'slow') {
      return (state.cached?.customers.length ?? 0) + (state.cached?.vehicles.length ?? 0) + 1
    }
    if (state.kind === 'error' || state.kind === 'no-match') return 1
    if (state.kind === 'searching') return 0
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
      if (c.vehicles.length === 0) {
        onCreateNew({
          name: c.name,
          phone: c.phone ?? undefined,
          email: c.email ?? undefined,
        })
        setOpen(false)
        setFocusedIdx(null)
        return
      }
      if (c.vehicles.length === 1) {
        onPickVehicle(c.vehicles[0].id)
        setOpen(false)
        setFocusedIdx(null)
        return
      }
      // 2+ vehicles → open the Which vehicle? tier carrying customer linkage.
      setTier({
        customer: { id: c.id, name: c.name, phone: c.phone, email: c.email },
        vehicles: c.vehicles,
      })
      setFocusedIdx(0)
    },
    [onPickVehicle, onCreateNew],
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
      const canCreate = state.kind === 'idle' || state.kind === 'no-match'
      if (e.key === 'Enter' && e.shiftKey && canCreate) {
        e.preventDefault()
        fireCreateNew()
        return
      }
      if (e.key === 'ArrowDown') {
        if (rowCount === 0) return
        e.preventDefault()
        setFocusedIdx((cur) => (cur === null ? 0 : (cur + 1) % rowCount))
        return
      }
      if (e.key === 'ArrowUp') {
        if (rowCount === 0) return
        e.preventDefault()
        setFocusedIdx((cur) => (cur === null ? rowCount - 1 : (cur - 1 + rowCount) % rowCount))
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        if (state.kind === 'searching') return
        if (state.kind === 'error') {
          retry()
          return
        }
        if (state.kind === 'slow') {
          const customerCount = state.cached?.customers.length ?? 0
          const vehicleCount = state.cached?.vehicles.length ?? 0
          if (focusedIdx !== null && focusedIdx < customerCount) {
            pickCustomer(state.cached!.customers[focusedIdx])
          } else if (focusedIdx !== null && focusedIdx < customerCount + vehicleCount) {
            onPickVehicle(state.cached!.vehicles[focusedIdx - customerCount].id)
            setOpen(false)
          } else {
            retry()
          }
          return
        }
        if (focusedIdx === null) {
          if (state.kind === 'idle' || state.kind === 'no-match') fireCreateNew()
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
        if (state.kind === 'no-match') fireCreateNew()
      }
    },
    [open, rowCount, focusedIdx, tier, state, recentCustomers, fireCreateNew, onPickVehicle, onCreateNew, pickCustomer, retry],
  )

  const activeDescendantId = useMemo(() => {
    if (focusedIdx === null) return undefined
    if (tier) return focusedIdx >= tier.vehicles.length ? 'pis-row-create' : `pis-row-${focusedIdx}`
    if (state.kind === 'matched') {
      return focusedIdx < state.customers.length + state.vehicles.length ? `pis-row-${focusedIdx}` : undefined
    }
    if (state.kind === 'idle') {
      return focusedIdx >= Math.min(recentCustomers.length, 5)
        ? 'pis-row-create'
        : `pis-row-${focusedIdx}`
    }
    if (state.kind === 'slow') {
      const cachedCount = (state.cached?.customers.length ?? 0) + (state.cached?.vehicles.length ?? 0)
      return focusedIdx >= cachedCount ? 'pis-row-retry' : `pis-row-${focusedIdx}`
    }
    if (state.kind === 'error') return 'pis-row-retry'
    if (state.kind === 'no-match') return 'pis-row-create'
    return undefined
  }, [focusedIdx, tier, state, recentCustomers.length])

  const tokens = useMemo(() => value.trim().split(/\s+/).filter((t) => t !== ''), [value])
  const noMatchShape = useMemo(() => detectInputShape(value.trim()), [value])
  const popupExpanded = open && state.kind !== 'searching'

  return (
    <div className="pis">
      <Bar
        value={value}
        focused={open}
        onChange={onInputChange}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        ariaControls={popupExpanded ? dropdownId : undefined}
        ariaExpanded={popupExpanded}
        activeDescendant={popupExpanded ? activeDescendantId : undefined}
        inputRef={inputRef}
      />
      {open && (
        <>
          {tier ? (
            <DropdownWhichVehicle
              dropdownId={dropdownId}
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
              onCreateNew={() => {
                onCreateNew({
                  name: tier.customer.name,
                  phone: tier.customer.phone ?? undefined,
                  email: tier.customer.email ?? undefined,
                })
                setOpen(false)
                setFocusedIdx(null)
                setTier(null)
              }}
            />
          ) : state.kind === 'idle' && value.trim() === '' ? (
            <DropdownEmpty
              dropdownId={dropdownId}
              recents={recentCustomers}
              focusedIdx={focusedIdx}
              onPickCustomer={pickCustomer}
              onCreateNew={fireCreateNew}
            />
          ) : state.kind === 'searching' ? (
            <DropdownSearching />
          ) : state.kind === 'slow' ? (
            <DropdownSlow
              dropdownId={dropdownId}
              elapsedSec={state.elapsedSec}
              cached={state.cached}
              focusedIdx={focusedIdx}
              onPickCustomer={pickCustomer}
              onPickVehicle={(v) => {
                onPickVehicle(v.id)
                setOpen(false)
              }}
              onRetry={retry}
            />
          ) : state.kind === 'matched' ? (
            <DropdownResults
              dropdownId={dropdownId}
              customers={state.customers}
              vehicles={state.vehicles}
              latencyMs={state.latencyMs}
              focusedIdx={focusedIdx}
              onPickCustomer={pickCustomer}
              onPickVehicle={(v) => {
                onPickVehicle(v.id)
                setOpen(false)
              }}
              highlightTokens={tokens}
            />
          ) : state.kind === 'no-match' ? (
            <DropdownNoMatch
              dropdownId={dropdownId}
              query={value}
              shape={noMatchShape}
              focusedIdx={focusedIdx}
              onCreateNew={fireCreateNew}
            />
          ) : state.kind === 'error' ? (
            <DropdownUnavailable dropdownId={dropdownId} focusedIdx={focusedIdx} onRetry={retry} />
          ) : null}
        </>
      )}
    </div>
  )
}
