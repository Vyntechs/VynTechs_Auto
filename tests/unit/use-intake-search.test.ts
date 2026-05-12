import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useIntakeSearch } from '@/lib/intake/use-search'

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

describe('useIntakeSearch', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('starts in idle state', () => {
    const { result } = renderHook(() => useIntakeSearch())
    expect(result.current.state.kind).toBe('idle')
  })

  it('debounces 150 ms before firing fetch', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ customers: [], vehicles: [], latencyMs: 5 }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useIntakeSearch())
    act(() => {
      result.current.setQuery('smith')
    })

    expect(fetchMock).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(fetchMock).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('aborts in-flight request when query changes', async () => {
    vi.useFakeTimers()
    const abortSpies: AbortSignal[] = []
    const fetchMock = vi.fn(async (_url: string, init?: { signal?: AbortSignal }) => {
      if (init?.signal) abortSpies.push(init.signal)
      await new Promise((r) => setTimeout(r, 10_000)) // long-running, never resolves under fake clock
      return new Response(JSON.stringify({ customers: [], vehicles: [], latencyMs: 5 }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useIntakeSearch())
    act(() => {
      result.current.setQuery('smit')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(160)
    })
    act(() => {
      result.current.setQuery('smith')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(160)
    })

    expect(abortSpies[0]?.aborted).toBe(true)
  })

  it('transitions to "slow" after 5 s without response', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => new Promise(() => {})))
    const { result } = renderHook(() => useIntakeSearch())
    act(() => {
      result.current.setQuery('smith')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(160)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(result.current.state.kind).toBe('slow')
  })

  it('lands in "matched" with results on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              customers: [
                { id: 'c1', name: 'Smith', phone: null, email: null, vehicleCount: 0, lastVisit: null },
              ],
              vehicles: [],
              latencyMs: 42,
            }),
            { status: 200 },
          ),
      ),
    )
    const { result } = renderHook(() => useIntakeSearch())
    act(() => {
      result.current.setQuery('smith')
    })
    await wait(220)
    await waitFor(() => expect(result.current.state.kind).toBe('matched'))
    if (result.current.state.kind === 'matched') {
      expect(result.current.state.customers).toHaveLength(1)
    }
  })

  it('lands in "no-match" when both groups are empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ customers: [], vehicles: [], latencyMs: 7 }), { status: 200 }),
      ),
    )
    const { result } = renderHook(() => useIntakeSearch())
    act(() => {
      result.current.setQuery('xyz')
    })
    await wait(220)
    await waitFor(() => expect(result.current.state.kind).toBe('no-match'))
  })

  it('reverts to idle on empty query', async () => {
    const { result } = renderHook(() => useIntakeSearch())
    act(() => {
      result.current.setQuery('')
    })
    await wait(50)
    expect(result.current.state.kind).toBe('idle')
  })

  it('does not transition to "slow" when a stale slowTimer from a previous fire fires later', async () => {
    // Regression for the PR-27 preview bug: typing fast leaks slowTimers
    // from earlier queries; one fires 5s later and corrupts state to "slow"
    // even though the current query already came back fast.
    vi.useFakeTimers()
    let callCount = 0
    const fetchMock = vi.fn(async (_url: string, init?: { signal?: AbortSignal }) => {
      callCount += 1
      if (callCount === 1) {
        // First fetch never resolves on its own (simulates in-flight).
        // It will be aborted by the second setQuery.
        await new Promise<void>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        })
        // never reaches here
        return new Response('', { status: 200 })
      }
      // Second fetch resolves fast.
      return new Response(
        JSON.stringify({
          customers: [
            { id: 'c1', name: 'X', phone: null, email: null, vehicleCount: 0, lastVisit: null },
          ],
          vehicles: [],
          latencyMs: 5,
        }),
        { status: 200 },
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useIntakeSearch())
    // First query — fires fetch1 (pending forever until aborted)
    act(() => {
      result.current.setQuery('B')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(160)
    })
    // Second query — aborts fetch1, fires fetch2 (resolves fast → matched)
    act(() => {
      result.current.setQuery('Brand')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(160)
    })
    expect(result.current.state.kind).toBe('matched')
    // The slowTimer attached to fire1 must have been cleared. Walk past 5s
    // from the original fire1 start. Without the fix, the orphan timer fires
    // and corrupts state to 'slow'.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(result.current.state.kind).toBe('matched')
  })
})
