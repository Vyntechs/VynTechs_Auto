import type { ReactNode } from 'react'
import type { ResolvedScene, SlotName } from '@/lib/diagnostics/diagram/slot-interface'
import { SlotBox } from './slot-box'
import { OverlayRegion } from './slot-box-overlay'
import type { SlotSet, FramingHint } from './template-local-types'
import './templates.css'

/** Source-top / device-under-test-center / ground-bottom + one overlay region on the tested
 *  terminal + a faint downstream anchor at the edge. Ported from proto applyStep/settleCamera.
 *  This is the ONLY template with terminal/overlay-bearing slots — every other shape omits the
 *  'overlay'/'ground' keys, so a non-electrical step cannot place a pin (structural leak-lock). */
export const ELECTRICAL_SLOTS: SlotSet = {
  source: { x: 660, y: 170, anchor: 'center', tier: 'anchor' },
  'device-under-test': { x: 660, y: 380, anchor: 'center', tier: 'focus' },
  ground: { x: 660, y: 600, anchor: 'center', tier: 'anchor' },
  'downstream-anchor': { x: 1140, y: 380, anchor: 'center', tier: 'recede' },
  overlay: { x: 760, y: 380, anchor: 'left', tier: 'focus' },
}

export const ELECTRICAL_FRAMING: FramingHint = {
  frameSlots: ['source', 'device-under-test', 'ground'],
  maxScale: 1.55,
}

/** Ordered render so source/ground/downstream draw under, DUT + overlay on top. */
const ORDER: SlotName[] = ['downstream-anchor', 'source', 'ground', 'device-under-test', 'overlay']

export default function Electrical({
  scene,
  onInspect,
  selectedPartId,
}: {
  scene: ResolvedScene
  onInspect?: (partId: string) => void
  selectedPartId?: string | null
}): ReactNode {
  return (
    <div className="diagram-template tpl-electrical" data-shape={scene.shape}>
      {ORDER.map((name) => {
        const placement = ELECTRICAL_SLOTS[name]
        if (!placement) return null
        if (name === 'overlay') {
          return <OverlayRegion key={name} placement={placement} overlay={scene.overlay} />
        }
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
