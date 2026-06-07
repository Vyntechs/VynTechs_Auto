import { describe, it, expect } from 'vitest'
import { nextDetent, type MeterSheetDetent } from '@/components/diagram-kit/meter-sheet'

describe('nextDetent — tap-to-toggle (Brandon override: no drag)', () => {
  it('toggles peek <-> expanded on a tap', () => {
    expect(nextDetent('peek', 'toggle')).toBe<MeterSheetDetent>('expanded')
    expect(nextDetent('expanded', 'toggle')).toBe<MeterSheetDetent>('peek')
  })

  it('a toggle from dismissed re-opens to peek (re-entry path)', () => {
    expect(nextDetent('dismissed', 'toggle')).toBe<MeterSheetDetent>('peek')
  })

  it('dismiss goes to dismissed from any detent', () => {
    expect(nextDetent('peek', 'dismiss')).toBe<MeterSheetDetent>('dismissed')
    expect(nextDetent('expanded', 'dismiss')).toBe<MeterSheetDetent>('dismissed')
  })

  it('open forces peek (used when a new step selects a part)', () => {
    expect(nextDetent('dismissed', 'open')).toBe<MeterSheetDetent>('peek')
    expect(nextDetent('expanded', 'open')).toBe<MeterSheetDetent>('peek')
  })
})
