'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CustomerHit, VehicleHit } from './search'

const DEBOUNCE_MS = 150
const SLOW_AFTER_MS = 5_000

export type SearchState =
  | { kind: 'idle' }
  | { kind: 'searching'; query: string; elapsedMs: number }
  | {
      kind: 'slow'
      query: string
      elapsedSec: number
      prev: { customers: CustomerHit[]; vehicles: VehicleHit[] } | null
    }
  | {
      kind: 'matched'
      query: string
      customers: CustomerHit[]
      vehicles: VehicleHit[]
      latencyMs: number
    }
  | { kind: 'no-match'; query: string; latencyMs: number }
  | { kind: 'error'; query: string; message: string }

export function useIntakeSearch() {
  const [state, setState] = useState<SearchState>({ kind: 'idle' })
  const lastResults = useRef<{ customers: CustomerHit[]; vehicles: VehicleHit[] } | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const slowTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimers = useCallback(() => {
    if (debounceTimer.current !== null) clearTimeout(debounceTimer.current)
    if (slowTimer.current !== null) clearTimeout(slowTimer.current)
    debounceTimer.current = null
    slowTimer.current = null
  }, [])

  const abort = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    clearTimers()
  }, [clearTimers])

  useEffect(() => () => abort(), [abort])

  const fire = useCallback(async (query: string) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const startedAt = Date.now()

    setState({ kind: 'searching', query, elapsedMs: 0 })

    slowTimer.current = setTimeout(() => {
      setState({
        kind: 'slow',
        query,
        elapsedSec: (Date.now() - startedAt) / 1000,
        prev: lastResults.current,
      })
    }, SLOW_AFTER_MS)

    try {
      const res = await fetch('/api/intake/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ q: query }),
        signal: controller.signal,
      })
      if (slowTimer.current !== null) clearTimeout(slowTimer.current)
      if (controller.signal.aborted) return
      if (!res.ok) {
        setState({ kind: 'error', query, message: 'Search unavailable' })
        return
      }
      const body = (await res.json()) as {
        customers: CustomerHit[]
        vehicles: VehicleHit[]
        latencyMs: number
      }
      lastResults.current = { customers: body.customers, vehicles: body.vehicles }
      const total = body.customers.length + body.vehicles.length
      if (total === 0) {
        setState({ kind: 'no-match', query, latencyMs: body.latencyMs })
      } else {
        setState({
          kind: 'matched',
          query,
          customers: body.customers,
          vehicles: body.vehicles,
          latencyMs: body.latencyMs,
        })
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      if (slowTimer.current !== null) clearTimeout(slowTimer.current)
      setState({ kind: 'error', query, message: 'Search unavailable' })
    }
  }, [])

  const setQuery = useCallback(
    (q: string) => {
      if (debounceTimer.current !== null) clearTimeout(debounceTimer.current)
      if (q.trim() === '') {
        abort()
        setState({ kind: 'idle' })
        return
      }
      debounceTimer.current = setTimeout(() => {
        void fire(q)
      }, DEBOUNCE_MS)
    },
    [abort, fire],
  )

  return { state, setQuery, abort }
}
