// Live-stream timing test for useAdvanceStream. Unlike the main test
// (which feeds all events into a stream and closes synchronously), this
// uses real setTimeout gaps between enqueues so we can observe whether
// the hook re-renders with each intermediate state, or only the final
// one (which would mean React batches them and the user sees a "snap").

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import { useAdvanceStream } from '@/lib/use-advance-stream'
import { encodeEvent, type AdvanceStreamEvent } from '@/lib/advance-stream-events'

function delayedStream(events: Array<AdvanceStreamEvent>, gapMs = 50): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      for (const e of events) {
        controller.enqueue(encoder.encode(encodeEvent(e)))
        await new Promise((r) => setTimeout(r, gapMs))
      }
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

describe('useAdvanceStream — live streaming behavior', () => {
  it('renders intermediate stageIdx values via a render-tracking probe', async () => {
    const renderHistory: Array<{ stageIdx: number | null; tree: unknown }> = []

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        delayedStream(
          [
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
            { type: 'done', tree: { final: true } as never },
          ],
          50,
        ),
      ),
    )

    // Probe inside renderHook so EVERY commit lands a snapshot
    const { result } = renderHook(() => {
      const hook = useAdvanceStream()
      renderHistory.push({
        stageIdx: hook.state.stageIdx,
        tree: hook.state.tree,
      })
      return hook
    })

    await act(async () => {
      await result.current.submit({ sessionId: 's1', observation: 'x' })
    })

    const stageIdxSeen = renderHistory.map((s) => s.stageIdx)
    // Intermediate renders must include stageIdx=0 (not just null then 3)
    expect(stageIdxSeen).toContain(0)
    expect(stageIdxSeen).toContain(1)
    expect(stageIdxSeen).toContain(2)
  })
})
