import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { StatusRegion } from '@/components/app-shell/status-region'

/* Regression: the status region floats over the bottom of the viewport, and the
   sticky form footer puts Cancel and the submit button in the same place. On a
   390x844 phone the legal notice covered 99% of both, so intake could not be
   submitted until the notice was dismissed. */

const CLEARANCE = '--vt-status-region-clearance'

function stubRect(height: number): () => void {
  const original = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function stub(this: Element) {
    const isRegion = (this as HTMLElement).dataset?.statusRegionStub === 'true'
    if (!isRegion) return original.call(this)
    return {
      top: window.innerHeight - height,
      bottom: window.innerHeight,
      height,
      width: 300,
      left: 0,
      right: 300,
      x: 0,
      y: window.innerHeight - height,
      toJSON: () => ({}),
    } as DOMRect
  }
  return () => {
    Element.prototype.getBoundingClientRect = original
  }
}

afterEach(() => {
  document.documentElement.style.removeProperty(CLEARANCE)
})

describe('status region clearance', () => {
  it('publishes how much of the viewport bottom it occupies', () => {
    const restore = stubRect(139)
    try {
      const { container, unmount } = render(
        <StatusRegion>
          <p>Terms and Privacy update</p>
        </StatusRegion>,
      )
      // Mark the region so only it reports a stubbed rect, then re-measure.
      const region = container.querySelector('[aria-label="Application status"]')
      expect(region).not.toBeNull()
      ;(region as HTMLElement).dataset.statusRegionStub = 'true'
      window.dispatchEvent(new Event('resize'))

      expect(document.documentElement.style.getPropertyValue(CLEARANCE)).toBe('139px')

      unmount()
      expect(document.documentElement.style.getPropertyValue(CLEARANCE)).toBe('')
    } finally {
      restore()
    }
  })

  it('publishes zero clearance when nothing is showing', () => {
    render(<StatusRegion>{null}</StatusRegion>)
    expect(document.documentElement.style.getPropertyValue(CLEARANCE)).toBe('0px')
  })

  it('lifts the sticky form footer by that clearance', () => {
    const css = readFileSync(resolve(process.cwd(), 'components/vt/v2.css'), 'utf8')
    const footer = css.slice(css.indexOf('.vt-form__footer {'))
    const block = footer.slice(0, footer.indexOf('}'))

    expect(block).toMatch(/position:\s*sticky/)
    expect(block).toMatch(/bottom:\s*var\(--vt-status-region-clearance,\s*0px\)/)
  })

  it('keeps the region mounted through the shell so every screen gets the offset', () => {
    const shell = readFileSync(
      resolve(process.cwd(), 'components/app-shell/shop-os-shell.tsx'),
      'utf8',
    )

    expect(shell).toContain(
      "import { StatusRegion } from '@/components/app-shell/status-region'",
    )
    expect(shell).toMatch(/<StatusRegion>[\s\S]*<LegalUpdateNotice[\s\S]*<\/StatusRegion>/)
    expect(shell).not.toMatch(/className=\{styles\.statusRegion\}/)
  })
})
