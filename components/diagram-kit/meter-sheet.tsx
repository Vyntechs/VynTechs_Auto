'use client'

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
