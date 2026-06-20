import type { ReactNode } from 'react'
import type { ResolvedScene } from '@/lib/diagnostics/diagram/slot-interface'
import { SlotBox } from './slot-box'
import './templates.css'

/** The generic fallback template — an unseen StepShape renders the device-under-test (if any)
 *  centered + an honest degrade note. Never blank, never crash. */
export default function Generic({
  scene,
  onInspect,
  selectedPartId,
}: {
  scene: ResolvedScene
  onInspect?: (partId: string) => void
  selectedPartId?: string | null
}): ReactNode {
  return (
    <div className="diagram-template tpl-generic" data-shape={scene.shape}>
      <SlotBox
        name="device-under-test"
        placement={{ x: 660, y: 380, anchor: 'center', tier: 'focus' }}
        fill={scene.slots['device-under-test'] ?? null}
        onInspect={onInspect}
        selectedPartId={selectedPartId}
      />
      <div
        className="slot-box is-degraded"
        data-slot="detail"
        style={{ left: '660px', top: '560px', transform: 'translate(-50%, -50%)' }}
      >
        needs field check
      </div>
    </div>
  )
}
