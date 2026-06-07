import type { ReactNode } from 'react'
import type { GaugeSpec } from '@/lib/diagnostics/diagram/slot-interface'
import type { SlotPlacement } from './template-local-types'

/** Places the gauge slot. The gauge VISUAL is the kept Meter (rendered by the screen/T6 in the
 *  sheet region); on desktop the template marks the gauge anchor + a thin inline reading summary.
 *  Reads EXPECT/NOW from the frozen GaugeSpec.reading (PartReading), never gauge.expect/now. */
export function GaugeRegion({
  placement,
  gauge,
}: {
  placement: SlotPlacement
  gauge: GaugeSpec | null
}): ReactNode {
  const style = { left: `${placement.x}px`, top: `${placement.y}px`, transform: 'translate(-50%, -50%)' }
  if (gauge == null) {
    return (
      <div className="slot-box is-degraded" data-slot="gauge" style={style}>
        needs field check
      </div>
    )
  }
  const { expect: expectVal, now } = gauge.reading
  return (
    <div className="gauge-region" data-slot="gauge" data-verdict={gauge.verdict} style={style}>
      <span className="gr-expect">{expectVal ?? 'needs field check'}</span>
      <span className="gr-now">{now ?? '—'}</span>
    </div>
  )
}
