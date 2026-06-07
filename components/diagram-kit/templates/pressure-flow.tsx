import type { ReactNode } from 'react'
import type { ResolvedScene, SlotName } from '@/lib/diagnostics/diagram/slot-interface'
import { SlotBox } from './slot-box'
import { GaugeRegion } from './gauge-region'
import { OverlayRegion } from './slot-box-overlay'
import type { SlotSet, FramingHint } from './template-local-types'
import './templates.css'

/** Left→right fuel path. NO ground key and NO terminal-bearing electrical slot => 12V/GND pins are
 *  structurally impossible here. The one overlay region carries the pressure-gauge-tee hookup
 *  (the mechanical meter tap), NOT an electrical probe — its kind comes from the frozen OverlaySpec. */
export const PRESSURE_SLOTS: SlotSet = {
  'device-under-test': { x: 660, y: 380, anchor: 'center', tier: 'focus' },
  'downstream-anchor': { x: 1060, y: 380, anchor: 'center', tier: 'recede' },
  gauge: { x: 660, y: 200, anchor: 'center', tier: 'focus' },
  overlay: { x: 760, y: 380, anchor: 'left', tier: 'focus' },
  detail: { x: 660, y: 690, anchor: 'center', tier: 'anchor' },
}

export const PRESSURE_FRAMING: FramingHint = {
  frameSlots: ['device-under-test', 'downstream-anchor'],
  maxScale: 1.55,
}

const ORDER: SlotName[] = ['downstream-anchor', 'device-under-test', 'gauge', 'overlay', 'detail']

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
