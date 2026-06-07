import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { GaugeSpec } from '@/lib/diagnostics/diagram/slot-interface'
import type { PartReading } from '@/components/diagram-kit/part-api'
import { Meter } from '@/components/diagram-kit/meter'

// Frozen-shape fixture builder: a GaugeSpec is { reading: PartReading; verdict }.
// No `as` casts on the reading — it is the real PartReading shape (C2).
function gauge(
  reading: Partial<PartReading>,
  verdict: GaugeSpec['verdict'],
): GaugeSpec {
  return {
    reading: {
      expect: '12',
      now: '12.1',
      unit: 'V',
      mode: 'volts',
      verdict,
      ...reading,
    },
    verdict,
  }
}

describe('Meter — EXPECT / NOW / VERDICT hero', () => {
  it('renders EXPECT and NOW values from the GaugeSpec reading', () => {
    render(<Meter gauge={gauge({ expect: '5000', now: '5120', unit: 'psi' }, 'neutral')} />)
    // EXPECT column shows the expect value + unit.
    const expectCol = document.querySelector('.m-expect')
    expect(expectCol).not.toBeNull()
    expect(expectCol?.textContent).toContain('5000')
    expect(expectCol?.textContent).toContain('psi')
    // NOW column shows the now value.
    const nowCol = document.querySelector('.m-now')
    expect(nowCol).not.toBeNull()
    expect(nowCol?.textContent).toContain('5120')
  })

  it('shows an honest "needs field check" no-now state when reading.now is null', () => {
    render(<Meter gauge={gauge({ expect: '12', now: null, unit: 'V' }, 'neutral')} />)
    const nowCol = document.querySelector('.m-now')
    expect(nowCol).not.toBeNull()
    // No fabricated number — the honest no-reading copy instead.
    expect(nowCol?.textContent?.toLowerCase()).toContain('needs field check')
  })

  it('drives the verdict chip from gauge.verdict — fault class ONLY for out-of-range', () => {
    render(<Meter gauge={gauge({}, 'out-of-range')} />)
    const chip = document.querySelector('.m-chip')
    expect(chip).not.toBeNull()
    expect(chip?.className).toContain('fail')
    expect(chip?.className).not.toContain('neutral')
  })

  it('drives the verdict chip fault class for branch-fail', () => {
    render(<Meter gauge={gauge({}, 'branch-fail')} />)
    const chip = document.querySelector('.m-chip')
    expect(chip?.className).toContain('fail')
  })

  it('uses the neutral class (NOT fault) for a neutral verdict', () => {
    render(<Meter gauge={gauge({}, 'neutral')} />)
    const chip = document.querySelector('.m-chip')
    expect(chip).not.toBeNull()
    expect(chip?.className).toContain('neutral')
    expect(chip?.className).not.toContain('fail')
  })

  it('never prints the word "AI"', () => {
    render(<Meter gauge={gauge({}, 'out-of-range')} />)
    expect(document.body.textContent ?? '').not.toMatch(/\bAI\b/)
  })

  it('renders an optional label and nowShowing strip when provided', () => {
    render(
      <Meter
        gauge={gauge({}, 'neutral')}
        label="LIFT PUMP · 12V POWER"
        nowShowing="Engine Idle"
      />,
    )
    expect(screen.getByText(/LIFT PUMP · 12V POWER/)).toBeInTheDocument()
  })
})
