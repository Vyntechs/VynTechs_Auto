import type { ReactNode } from 'react'
import type { ResolvedScene, SlotName } from '@/lib/diagnostics/diagram/slot-interface'
import { SlotBox } from './slot-box'
import { GaugeRegion } from './gauge-region'
import type { SlotSet, FramingHint } from './template-local-types'
import './templates.css'

/** Left→right fuel path. NO ground/overlay key => terminals are structurally impossible here —
 *  a pressure step physically cannot place a 12V/GND pin because no slot exists for one. */
export const PRESSURE_SLOTS: SlotSet = {
  source: { x: 260, y: 380, anchor: 'center', tier: 'anchor' },
  'device-under-test': { x: 660, y: 380, anchor: 'center', tier: 'focus' },
  'downstream-anchor': { x: 1060, y: 380, anchor: 'center', tier: 'recede' },
  gauge: { x: 660, y: 200, anchor: 'center', tier: 'focus' },
}

export const PRESSURE_FRAMING: FramingHint = {
  frameSlots: ['source', 'device-under-test', 'downstream-anchor'],
  maxScale: 1.55,
}

const ORDER: SlotName[] = ['downstream-anchor', 'source', 'device-under-test', 'gauge']

export default function PressureFlow({
  scene,
  onInspect,
  selectedPartId,
}: {
  scene: ResolvedScene
  onInspect?: (partId: string) => void
  selectedPartId?: string | null
}): ReactNode {
  return (
    <div className="diagram-template tpl-pressure-flow" data-shape={scene.shape}>
      {ORDER.map((name) => {
        const placement = PRESSURE_SLOTS[name]
        if (!placement) return null
        if (name === 'gauge') {
          return <GaugeRegion key={name} placement={placement} gauge={scene.gaugeSpec} />
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
