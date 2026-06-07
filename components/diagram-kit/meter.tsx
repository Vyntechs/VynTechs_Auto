import type { ReactNode } from 'react'
import type { GaugeSpec, VerdictSignal } from '@/lib/diagnostics/diagram/slot-interface'
import './meter.css'

/**
 * The Meter — EXPECT / NOW / VERDICT hero. A PURE presentational component:
 * no data fetch, no @xyflow, no verdict re-decision. It consumes the FROZEN C3
 * `GaugeSpec` ({ reading: PartReading; verdict }) and renders the kept Meter
 * reading band from the validated canon (`.design-shots/mockups/proto-meter.html`
 * `.meter-card` / `.m-instr` markup + `.m-expect` / `.m-now` / `.m-verdict` CSS).
 *
 * Red discipline (R7): the verdict chip is driven ONLY by the verdict signal —
 * red for `out-of-range` / `branch-fail`, neutral/graphite otherwise. The verdict
 * is read from `gauge.verdict` (which C3 mirrors from the scene-level verdict).
 * The Meter NEVER re-derives or re-decides red — C3 owns the single verdict.
 */
type MeterProps = {
  gauge: GaugeSpec
  /** Optional eyebrow, e.g. "LIFT PUMP · 12V POWER". */
  label?: string
  /** Optional "Now · <scenario>" strip text. */
  nowShowing?: string
}

/** Verdict signal → chip class. The ONLY place fault styling is applied, and it
 *  is a pure lookup on the signal — never a recomputation from the reading. */
const VERDICT_CHIP: Record<VerdictSignal, { cls: string; label: string; glyph: string }> = {
  'out-of-range': { cls: 'fail', label: 'out of range', glyph: '◑' },
  'branch-fail': { cls: 'fail', label: 'fail', glyph: '◑' },
  neutral: { cls: 'neutral', label: 'reading', glyph: '◐' },
}

export function Meter({ gauge, label, nowShowing }: MeterProps): ReactNode {
  const { reading, verdict } = gauge
  const chip = VERDICT_CHIP[verdict] ?? VERDICT_CHIP.neutral
  // Honest no-now state: never fabricate a number when there is no field reading.
  const hasNow = reading.now != null && reading.now !== ''

  return (
    <div className="meter-card" data-verdict={verdict}>
      {(label || nowShowing) && (
        <div className="m-head">
          {label && <span className="m-label">{label}</span>}
          {nowShowing && <span className="m-step">{nowShowing}</span>}
        </div>
      )}

      <div className="m-instr">
        <div className="m-expect">
          <span className="m-col-label">Expect</span>
          <div className="m-plate">
            <span className="big">
              {reading.expect ?? 'needs field check'}
              {reading.expect != null && reading.unit && (
                <span className="unit">{reading.unit}</span>
              )}
            </span>
          </div>
        </div>

        <div className="m-now">
          <span className="m-col-label">Now{nowShowing ? ` · ${nowShowing}` : ''}</span>
          <span className="m-now-val">
            {hasNow ? (
              <>
                {reading.now}
                {reading.unit && <span className="unit"> {reading.unit}</span>}
              </>
            ) : (
              <span className="m-now-empty">needs field check</span>
            )}
          </span>
        </div>

        <div className="m-verdict">
          <span className={`m-chip ${chip.cls}`}>
            <span className="gly">{chip.glyph}</span>
            <span>{chip.label}</span>
          </span>
        </div>
      </div>
    </div>
  )
}
