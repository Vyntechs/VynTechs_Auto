import type { ReactNode } from 'react'
import type { ResolvedScene } from '@/lib/diagnostics/diagram/slot-interface'
import { SlotBox } from './slot-box'
import { GaugeRegion } from './gauge-region'
import type { SlotSet, FramingHint } from './template-local-types'
import './templates.css'

/** Device centered + a single gauge. NO source/ground/overlay key => no electrical leak possible. */
export const SINGLE_PID_SLOTS: SlotSet = {
  'device-under-test': { x: 660, y: 420, anchor: 'center', tier: 'focus' },
  gauge: { x: 660, y: 210, anchor: 'center', tier: 'focus' },
}

export const SINGLE_PID_FRAMING: FramingHint = {
  frameSlots: ['device-under-test'],
  maxScale: 1.55,
}

export default function SinglePid({
  scene,
  onInspect,
  selectedPartId,
}: {
  scene: ResolvedScene
  onInspect?: (partId: string) => void
  selectedPartId?: string | null
}): ReactNode {
  return (
    <div className="diagram-template tpl-single-pid" data-shape={scene.shape}>
      <SlotBox
        name="device-under-test"
        placement={SINGLE_PID_SLOTS['device-under-test']!}
        fill={scene.slots['device-under-test']}
        onInspect={onInspect}
        selectedPartId={selectedPartId}
      />
      <GaugeRegion placement={SINGLE_PID_SLOTS.gauge!} gauge={scene.gaugeSpec} />
    </div>
  )
}
