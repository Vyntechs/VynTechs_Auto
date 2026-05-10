import type { TreeState } from '@/lib/ai/tree-engine'

export type AdvanceStreamStage = { label: string }

export type AdvanceStreamEvent =
  | { type: 'init'; stages: AdvanceStreamStage[] }
  | { type: 'stage'; idx: number; label: string }
  | { type: 'done'; tree: TreeState }
  | { type: 'error'; status: number; message: string }

/** Encode one event as a single NDJSON line (with trailing newline). */
export function encodeEvent(event: AdvanceStreamEvent): string {
  return JSON.stringify(event) + '\n'
}

/** Parse a single NDJSON line. Throws if not a valid AdvanceStreamEvent shape. */
export function parseEvent(line: string): AdvanceStreamEvent {
  const obj = JSON.parse(line)
  if (
    !obj ||
    typeof obj !== 'object' ||
    typeof obj.type !== 'string' ||
    !['init', 'stage', 'done', 'error'].includes(obj.type)
  ) {
    throw new Error(`invalid stream event: ${line}`)
  }
  return obj as AdvanceStreamEvent
}
