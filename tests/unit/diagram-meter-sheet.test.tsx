import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  nextDetent,
  MeterSheet,
  type MeterSheetDetent,
} from '@/components/diagram-kit/meter-sheet'

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

describe('MeterSheet — tap toggles the detent, renders the kept Meter as a child', () => {
  it('renders children (the kept Meter/reading) and starts at peek', () => {
    render(
      <MeterSheet nowShowing="Idle · Probe">
        <div data-testid="kept-meter">EXPECT / NOW</div>
      </MeterSheet>,
    )
    expect(screen.getByTestId('kept-meter')).toBeInTheDocument()
    expect(screen.getByTestId('meter-sheet')).toHaveAttribute('data-detent', 'peek')
  })

  it('tapping the grabber toggles peek -> expanded -> peek', () => {
    render(<MeterSheet nowShowing="Idle · Probe"><div /></MeterSheet>)
    const sheet = screen.getByTestId('meter-sheet')
    const grabber = screen.getByRole('button', { name: /reading detail/i })

    fireEvent.click(grabber)
    expect(sheet).toHaveAttribute('data-detent', 'expanded')
    fireEvent.click(grabber)
    expect(sheet).toHaveAttribute('data-detent', 'peek')
  })

  it('the close control dismisses the sheet', () => {
    render(<MeterSheet nowShowing="Idle · Probe"><div /></MeterSheet>)
    fireEvent.click(screen.getByRole('button', { name: /dismiss reading/i }))
    expect(screen.getByTestId('meter-sheet')).toHaveAttribute('data-detent', 'dismissed')
  })

  it('shows the now-showing strip with no "step N of M" and no "AI"', () => {
    render(<MeterSheet nowShowing="Idle · Probe"><div /></MeterSheet>)
    const strip = screen.getByTestId('meter-sheet-status')
    expect(strip).toHaveTextContent('Idle · Probe')
    expect(strip.textContent ?? '').not.toMatch(/step \d+ of \d+/i)
    expect(strip.textContent ?? '').not.toMatch(/\bAI\b/)
  })
})
