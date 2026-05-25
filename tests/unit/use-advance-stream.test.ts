import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import { useAdvanceStream } from '@/lib/use-advance-stream'
import { encodeEvent, type AdvanceStreamEvent } from '@/lib/advance-stream-events'

function streamFromEvents(events: AdvanceStreamEvent[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      for (const e of events) controller.enqueue(encoder.encode(encodeEvent(e)))
      controller.close()
    },
  })
  return new Response(stream, { status: 200 })
}

beforeEach(() => {
  vi.unstubAllGlobals()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useAdvanceStream', () => {
  it('happy path: parses init -> stages -> done', async () => {
    const tree = { nodes: [], currentNodeId: 'n2', message: 'ok' }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        streamFromEvents([
          {
            type: 'init',
            stages: [
              { label: 'Recording observation' },
              { label: 'Updating retrieval ladder' },
              { label: 'Re-scoring confidence' },
              { label: 'Advancing to next step' },
            ],
          },
          { type: 'stage', idx: 0, label: 'Recording observation' },
          { type: 'stage', idx: 1, label: 'Updating retrieval ladder' },
          { type: 'stage', idx: 2, label: 'Re-scoring confidence' },
          { type: 'stage', idx: 3, label: 'Advancing to next step' },
          { type: 'done', tree: tree as never },
        ]),
      ),
    )

    const { result } = renderHook(() => useAdvanceStream())

    await act(async () => {
      await result.current.submit({ sessionId: 's1', observation: 'x' })
    })

    expect(result.current.state.stages).toHaveLength(4)
    expect(result.current.state.stageIdx).toBe(3)
    expect(result.current.state.isDone).toBe(true)
    expect(result.current.state.error).toBeNull()
    expect(result.current.state.tree).toEqual(tree)
  })

  it('error event sets error and isDone=false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        streamFromEvents([
          { type: 'init', stages: [{ label: 'Recording observation' }] },
          { type: 'stage', idx: 0, label: 'Recording observation' },
          { type: 'error', status: 500, message: 'tree update failed' },
        ]),
      ),
    )

    const { result } = renderHook(() => useAdvanceStream())

    await act(async () => {
      await result.current.submit({ sessionId: 's1', observation: 'x' })
    })

    expect(result.current.state.error).toBe('tree update failed')
    expect(result.current.state.isDone).toBe(false)
  })

  it('HTTP error before stream sets error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    const { result } = renderHook(() => useAdvanceStream())

    await act(async () => {
      await result.current.submit({ sessionId: 's1', observation: 'x' })
    })

    expect(result.current.state.error).toBe('unauthorized')
    expect(result.current.state.isLoading).toBe(false)
  })

  it('network drop (TypeError on fetch) sets error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Load failed')))

    const { result } = renderHook(() => useAdvanceStream())

    await act(async () => {
      await result.current.submit({ sessionId: 's1', observation: 'x' })
    })

    expect(result.current.state.error).toMatch(/dropped|connection|too long/i)
  })

  it('reset clears state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        streamFromEvents([
          { type: 'init', stages: [{ label: 'Recording observation' }] },
          { type: 'stage', idx: 0, label: 'Recording observation' },
          { type: 'done', tree: {} as never },
        ]),
      ),
    )

    const { result } = renderHook(() => useAdvanceStream())

    await act(async () => {
      await result.current.submit({ sessionId: 's1', observation: 'x' })
    })
    expect(result.current.state.isDone).toBe(true)

    act(() => result.current.reset())

    expect(result.current.state.stages).toBeNull()
    expect(result.current.state.stageIdx).toBeNull()
    expect(result.current.state.isDone).toBe(false)
    expect(result.current.state.tree).toBeNull()
  })
})
