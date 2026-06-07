import type { ReactNode } from 'react'
import type { ResolvedScene } from '@/lib/diagnostics/diagram/slot-interface'
import { SlotBox } from './slot-box'
import type { SlotSet, FramingHint } from './template-local-types'
import './templates.css'

/** Cleared run (dimmed route) -> the one next device. EXACTLY one route slot (the chosen road).
 *  The 'route' fill is a RouteSlotFill (T3) — its nextActionText is the honest words-only arm
 *  when routesToTestActionId is null; SlotBox renders that prose. */
export const FORK_SLOTS: SlotSet = {
  route: { x: 360, y: 380, anchor: 'center', tier: 'recede' },
  'device-under-test': { x: 880, y: 380, anchor: 'center', tier: 'focus' },
  detail: { x: 660, y: 690, anchor: 'center', tier: 'anchor' },
}

export const FORK_FRAMING: FramingHint = {
  frameSlots: ['route', 'device-under-test'],
  maxScale: 1.55,
}

export default function Fork({
  scene,
  onInspect,
  selectedPartId,
}: {
  scene: ResolvedScene
  onInspect?: (partId: string) => void
  selectedPartId?: string | null
}): ReactNode {
  return (
    <div className="diagram-template tpl-fork" data-shape={scene.shape}>
      <SlotBox
        name="route"
        placement={FORK_SLOTS.route!}
        fill={scene.slots.route}
        onInspect={onInspect}
        selectedPartId={selectedPartId}
      />
      <SlotBox
        name="device-under-test"
        placement={FORK_SLOTS['device-under-test']!}
        fill={scene.slots['device-under-test']}
        onInspect={onInspect}
        selectedPartId={selectedPartId}
      />
      <SlotBox
        name="detail"
        placement={FORK_SLOTS.detail!}
        fill={scene.slots.detail}
        onInspect={onInspect}
        selectedPartId={selectedPartId}
      />
    </div>
  )
}
