import type { ReactNode } from 'react'
import type { ResolvedScene } from '@/lib/diagnostics/diagram/slot-interface'
import { SlotBox } from './slot-box'
import type { SlotSet, FramingHint } from './template-local-types'
import './templates.css'

/** Device centered + a 'good-vs-bad' compare panel beside it. NO gauge/overlay/ground key.
 *  v1 note: T3 fills 'good-vs-bad' with null (no data model carries that prose yet), so the slot
 *  renders the honest degrade. The slot stays STRUCTURALLY so populating it from richer data later
 *  is a pure data change — a FUTURE ENHANCEMENT, no template edit required. */
export const LOOK_SLOTS: SlotSet = {
  'device-under-test': { x: 520, y: 400, anchor: 'center', tier: 'focus' },
  'good-vs-bad': { x: 860, y: 400, anchor: 'center', tier: 'anchor' },
}

export const LOOK_FRAMING: FramingHint = {
  frameSlots: ['device-under-test', 'good-vs-bad'],
  maxScale: 1.4,
}

export default function LookInspect({
  scene,
  onInspect,
  selectedPartId,
}: {
  scene: ResolvedScene
  onInspect?: (partId: string) => void
  selectedPartId?: string | null
}): ReactNode {
  return (
    <div className="diagram-template tpl-look-inspect" data-shape={scene.shape}>
      <SlotBox
        name="device-under-test"
        placement={LOOK_SLOTS['device-under-test']!}
        fill={scene.slots['device-under-test']}
        onInspect={onInspect}
        selectedPartId={selectedPartId}
      />
      <SlotBox
        name="good-vs-bad"
        placement={LOOK_SLOTS['good-vs-bad']!}
        fill={scene.slots['good-vs-bad']}
        onInspect={onInspect}
        selectedPartId={selectedPartId}
      />
    </div>
  )
}
