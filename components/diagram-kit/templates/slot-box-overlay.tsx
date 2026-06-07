import type { ReactNode } from 'react'
import type { OverlaySpec } from '@/lib/diagnostics/diagram/slot-interface'
import type { SlotPlacement } from './template-local-types'

/** Renders the SINGLE test-overlay primitive (probe-lead / voltage-drop-bracket / amp-clamp /
 *  pressure-gauge-tee / test-point / scope-clip) at the template's one overlay attachment region.
 *  The OVERLAY KIND comes from the frozen C3 OverlaySpec (scene.overlay), resolved by T3 from
 *  electricalRole + meterMode + connectionKind — T4 does NOT re-derive it. */
export function OverlayRegion({
  placement,
  overlay,
}: {
  placement: SlotPlacement
  overlay: OverlaySpec | null
}): ReactNode {
  const style = {
    left: `${placement.x}px`,
    top: `${placement.y}px`,
    transform: 'translate(0, -50%)',
  }
  if (overlay == null) {
    return (
      <div className="slot-box is-degraded" data-slot="overlay" style={style}>
        needs field check
      </div>
    )
  }
  return (
    <div className="overlay-region" data-slot="overlay" data-overlay={overlay.kind} style={style}>
      {overlay.kind}
    </div>
  )
}
