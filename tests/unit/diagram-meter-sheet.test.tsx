import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  nextDetent,
  MeterSheet,
  type MeterSheetDetent,
} from '@/components/diagram-kit/meter-sheet'
import type { ResolvedScene } from '@/lib/diagnostics/diagram/slot-interface'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

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

describe('MeterSheet — verdict signal passes through untouched (C3 owns the verdict)', () => {
  it('forwards scene.gaugeSpec verbatim to the render-prop child', () => {
    const scene = {
      gaugeSpec: { verdict: 'out-of-range' },
    } as unknown as ResolvedScene

    let received: ResolvedScene['gaugeSpec'] | undefined
    render(
      <MeterSheet nowShowing="Idle · Probe" gaugeSpec={scene.gaugeSpec}>
        {(gaugeSpec) => {
          received = gaugeSpec
          return <div data-testid="kept-meter" />
        }}
      </MeterSheet>,
    )
    // Same reference — the sheet did not clone, re-map, or re-decide the verdict.
    expect(received).toBe(scene.gaugeSpec)
  })

  it('the sheet itself carries NO verdict attribute (no second red-decider)', () => {
    render(
      <MeterSheet nowShowing="Idle · Probe" gaugeSpec={{ verdict: 'out-of-range' } as never}>
        {() => <div />}
      </MeterSheet>,
    )
    const sheet = screen.getByTestId('meter-sheet')
    expect(sheet).not.toHaveAttribute('data-verdict')
    expect(sheet.className).not.toMatch(/fault|fail|out-of-range|red/i)
  })
})

describe('diagram-mobile.css — sheet detent contract', () => {
  const css = readFileSync(
    resolve(process.cwd(), 'components/diagram-kit/diagram-mobile.css'),
    'utf8',
  )

  it('drives detents off [data-detent] with translateY (no JS height math)', () => {
    expect(css).toMatch(/\[data-detent='dismissed'\][^{]*\{[^}]*translateY\(100%\)/s)
    expect(css).toMatch(/\[data-detent='expanded'\][^{]*\{[^}]*translateY\(0\)/s)
  })

  it('honors env(safe-area-inset-bottom)', () => {
    expect(css).toContain('env(safe-area-inset-bottom)')
  })

  it('gates the sheet transition on prefers-reduced-motion', () => {
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/)
  })
})

describe('focus-part-above-sheet is shape-generic (the scalability bar)', () => {
  // Drive the same assertion across unlike systems' shapes + one unseen shape.
  // The CSS reserves the peek height for ANY [data-shape] — no per-case branch.
  const shapes = ['electrical-probe', 'pressure-flow', 'never-before-seen-shape']

  it.each(shapes)(
    'the template root carries the [data-shape] seam T5 reserves space against (%s)',
    (shape) => {
      const { container } = render(
        <div data-shape={shape} data-testid="template-root">
          <div data-testid="focus-part" />
        </div>,
      )
      const root = container.querySelector('[data-shape]')
      // The seam exists for every shape (JSDOM does not apply @media CSS, so we
      // assert the contract surface the CSS rule keys on, not computed px).
      expect(root).toHaveAttribute('data-shape', shape)
      expect(screen.getByTestId('focus-part')).toBeInTheDocument()
    },
  )

  it('the [data-shape] padding rule in CSS is unconditional (no per-shape selector)', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'components/diagram-kit/diagram-mobile.css'),
      'utf8',
    )
    // A bare [data-shape] selector reserves the peek height — proves no
    // [data-shape='pressure-flow'] special-case exists for the guarantee.
    expect(css).toMatch(/\[data-shape\]\s*\{[^}]*padding-bottom:\s*calc\(var\(--meter-sheet-peek/s)
    expect(css).not.toMatch(/\[data-shape='[^']+'\][^{]*padding-bottom/)
  })
})
