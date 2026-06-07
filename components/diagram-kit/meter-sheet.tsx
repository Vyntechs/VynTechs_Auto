'use client'

import { useReducer, type ReactNode } from 'react'
import type { ResolvedScene } from '@/lib/diagnostics/diagram/slot-interface'

/** Mobile bottom-sheet detents for the kept Meter/reading.
 *  peek      = reading band visible, the tested part stays above the sheet edge
 *  expanded  = full EXPECT/NOW + why/source + branch detail
 *  dismissed = sheet off-screen (tech swiped it away; canvas full-height)
 *  Brandon override: tap-to-toggle, NOT a free-drag sheet. */
export type MeterSheetDetent = 'peek' | 'expanded' | 'dismissed'

/** The only inputs are taps + lifecycle, never a drag delta. */
export type MeterSheetAction = 'toggle' | 'dismiss' | 'open'

export function nextDetent(
  current: MeterSheetDetent,
  action: MeterSheetAction,
): MeterSheetDetent {
  switch (action) {
    case 'dismiss':
      return 'dismissed'
    case 'open':
      return 'peek'
    case 'toggle':
      // From dismissed, a tap is a re-entry path: re-open to peek.
      if (current === 'dismissed') return 'peek'
      // peek <-> expanded.
      return current === 'expanded' ? 'peek' : 'expanded'
  }
}

/** The tap-driven reducer. No drag delta is ever an input (Brandon override). */
export function useMeterSheetDetent(initial: MeterSheetDetent = 'peek') {
  return useReducer(nextDetent, initial)
}

/** The frozen C3 verdict-bearing gauge payload: `{ reading, verdict } | null`. */
type GaugeSpec = ResolvedScene['gaugeSpec']

type MeterSheetProps = {
  /** Thin "now showing" strip text (scenario · step). NEVER "step N of M", never "AI". */
  nowShowing: string
  /** The C3 verdict-bearing gauge payload, forwarded UNTOUCHED. The kept Meter renders red;
   *  the sheet never re-decides a verdict (single source of truth = C3). */
  gaugeSpec?: GaugeSpec
  /** The kept Meter/reading. Either a plain node, or a render-prop receiving gaugeSpec verbatim. */
  children: ReactNode | ((gaugeSpec: GaugeSpec) => ReactNode)
}

/** Mobile-only bottom sheet around the kept Meter. Desktop renders the Meter inline
 *  (no MeterSheet); the screen (T6) mounts this only at the mobile breakpoint. */
export function MeterSheet({ children, nowShowing, gaugeSpec }: MeterSheetProps) {
  const [detent, dispatch] = useMeterSheetDetent('peek')
  const body =
    typeof children === 'function'
      ? (children as (g: GaugeSpec) => ReactNode)(gaugeSpec ?? null)
      : children

  return (
    <div className="meter-sheet" data-testid="meter-sheet" data-detent={detent}>
      <div className="meter-sheet__status" data-testid="meter-sheet-status">
        Now · {nowShowing}
      </div>
      <button
        type="button"
        className="meter-sheet__grabber"
        aria-label="Toggle reading detail"
        aria-expanded={detent === 'expanded'}
        onClick={() => dispatch('toggle')}
      />
      <button
        type="button"
        className="meter-sheet__close"
        aria-label="Dismiss reading"
        onClick={() => dispatch('dismiss')}
      >
        ✕
      </button>
      <div className="meter-sheet__body">{body}</div>
    </div>
  )
}
