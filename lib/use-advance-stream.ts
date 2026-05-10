'use client'

import { useCallback, useState } from 'react'
import { flushSync } from 'react-dom'
import type { TreeState } from '@/lib/ai/tree-engine'
import {
  parseEvent,
  type AdvanceStreamEvent,
  type AdvanceStreamStage,
} from '@/lib/advance-stream-events'

export type AdvanceStreamState = {
  stages: AdvanceStreamStage[] | null
  stageIdx: number | null
  isLoading: boolean
  isDone: boolean
  error: string | null
  tree: TreeState | null
}

const INITIAL_STATE: AdvanceStreamState = {
  stages: null,
  stageIdx: null,
  isLoading: false,
  isDone: false,
  error: null,
  tree: null,
}

function describeFetchError(err: unknown): string {
  if (err instanceof TypeError) {
    return 'AI took too long or your connection dropped — tap again to retry.'
  }
  return err instanceof Error ? err.message : 'Network error'
}

async function* readEvents(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<AdvanceStreamEvent> {
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let idx: number
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      if (line.length === 0) continue
      yield parseEvent(line)
    }
  }

  buffer += decoder.decode()
  const last = buffer.trim()
  if (last.length > 0) yield parseEvent(last)
}

export function useAdvanceStream() {
  const [state, setState] = useState<AdvanceStreamState>(INITIAL_STATE)

  const submit = useCallback(
    async (input: { sessionId: string; observation: string }) => {
      setState({ ...INITIAL_STATE, isLoading: true })
      try {
        const res = await fetch(
          `/api/sessions/${input.sessionId}/advance/stream`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ observation: input.observation }),
          },
        )

        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          setState({
            ...INITIAL_STATE,
            error: body.error ?? `Failed (${res.status})`,
          })
          return
        }

        if (!res.body) {
          setState({ ...INITIAL_STATE, error: 'empty response' })
          return
        }

        const reader = res.body.getReader()
        for await (const event of readEvents(reader)) {
          // flushSync forces React to commit this update before we await the
          // next chunk, otherwise React 19's automatic batching collapses
          // every event's setState into one final render and the user sees
          // the LogButton's internal timer cycling for the entire request
          // (freezeStage stays null until the very end).
          flushSync(() => {
            if (event.type === 'init') {
              setState((s) => ({ ...s, stages: event.stages }))
            } else if (event.type === 'stage') {
              setState((s) => ({ ...s, stageIdx: event.idx }))
            } else if (event.type === 'done') {
              setState((s) => ({
                ...s,
                isLoading: false,
                isDone: true,
                tree: event.tree,
              }))
            } else if (event.type === 'error') {
              setState((s) => ({
                ...s,
                isLoading: false,
                error: event.message,
              }))
            }
          })
        }
      } catch (err) {
        setState({
          ...INITIAL_STATE,
          error: describeFetchError(err),
        })
      }
    },
    [],
  )

  const reset = useCallback(() => setState(INITIAL_STATE), [])

  return { state, submit, reset }
}
