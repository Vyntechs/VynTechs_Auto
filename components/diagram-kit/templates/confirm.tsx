import type { ReactNode } from 'react'
import type { ResolvedScene, SlotName } from '@/lib/diagnostics/diagram/slot-interface'
import { SlotBox } from './slot-box'
import type { SlotSet, FramingHint } from './template-local-types'
import './templates.css'

/** One raised symptom part over a SINGLE quiet-field backdrop (the one allowed system glimpse),
 *  plus the detail (why/see-source/operational-theory) prose routed toward the Meter region.
 *  v1 note: T3 fills 'quiet-field' with null (no whole-spine backdrop data yet), so the slot
 *  renders the honest degrade. 'detail' carries REAL prose. Populating the quiet field from richer
 *  data is a FUTURE ENHANCEMENT — the slot stays STRUCTURALLY, no template edit needed. */
export const CONFIRM_SLOTS: SlotSet = {
  'quiet-field': { x: 660, y: 380, anchor: 'center', tier: 'recede' },
  'device-under-test': { x: 660, y: 360, anchor: 'center', tier: 'focus' },
  detail: { x: 660, y: 620, anchor: 'center', tier: 'anchor' },
}

export const CONFIRM_FRAMING: FramingHint = {
  frameSlots: [], // empty => frame the whole spine (proto: confirm frames all NODES)
  maxScale: 0.82,
}

/** Backdrop first so the raised part + detail paint on top. */
const ORDER: SlotName[] = ['quiet-field', 'device-under-test', 'detail']

export default function Confirm({
  scene,
  onInspect,
  selectedPartId,
}: {
  scene: ResolvedScene
  onInspect?: (partId: string) => void
  selectedPartId?: string | null
}): ReactNode {
  return (
    <div className="diagram-template tpl-confirm" data-shape={scene.shape}>
      {ORDER.map((name) => {
        const placement = CONFIRM_SLOTS[name]
        if (!placement) return null
        return (
          <SlotBox
            key={name}
            name={name}
            placement={placement}
            fill={scene.slots[name]}
            onInspect={onInspect}
            selectedPartId={selectedPartId}
          />
        )
      })}
    </div>
  )
}
