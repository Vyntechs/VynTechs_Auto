import type { ReactNode } from 'react'
import type { ResolvedScene } from '@/lib/diagnostics/diagram/slot-interface'
import { SlotBox } from './slot-box'
import type { SlotSet, FramingHint } from './template-local-types'
import './templates.css'

/** Mark the part-to-find + its location context. NO gauge key => gauge suppressed (spec §4).
 *  v1 note: T3 fills 'location' with null (no data model carries that prose yet), so the slot
 *  renders the honest degrade. Keeping the slot STRUCTURALLY makes populating location from richer
 *  data a pure data change later — a FUTURE ENHANCEMENT, no template edit. */
export const LOCATE_SLOTS: SlotSet = {
  'device-under-test': { x: 660, y: 360, anchor: 'center', tier: 'focus' },
  location: { x: 660, y: 540, anchor: 'center', tier: 'anchor' },
  detail: { x: 660, y: 700, anchor: 'center', tier: 'anchor' },
}

export const LOCATE_FRAMING: FramingHint = {
  frameSlots: ['device-under-test'],
  maxScale: 1.4,
}

export default function Locate({
  scene,
  onInspect,
  selectedPartId,
}: {
  scene: ResolvedScene
  onInspect?: (partId: string) => void
  selectedPartId?: string | null
}): ReactNode {
  return (
    <div className="diagram-template tpl-locate" data-shape={scene.shape}>
      <SlotBox
        name="device-under-test"
        placement={LOCATE_SLOTS['device-under-test']!}
        fill={scene.slots['device-under-test']}
        onInspect={onInspect}
        selectedPartId={selectedPartId}
      />
      <SlotBox
        name="location"
        placement={LOCATE_SLOTS.location!}
        fill={scene.slots.location}
        onInspect={onInspect}
        selectedPartId={selectedPartId}
      />
      <SlotBox
        name="detail"
        placement={LOCATE_SLOTS.detail!}
        fill={scene.slots.detail}
        onInspect={onInspect}
        selectedPartId={selectedPartId}
      />
    </div>
  )
}
