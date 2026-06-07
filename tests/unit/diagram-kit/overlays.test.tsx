import { render } from '@testing-library/react'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { OVERLAY_KINDS } from '@/components/diagram-kit/overlays/overlay-api'
import { TestOverlay } from '@/components/diagram-kit/overlays/test-overlay'

afterEach(() => vi.unstubAllGlobals())

describe('TestOverlay primitives', () => {
  it('OVERLAY_KINDS is the canonical C3 set incl. deferred scope-clip', () => {
    expect([...OVERLAY_KINDS].sort()).toEqual(
      ['probe-lead', 'voltage-drop-bracket', 'amp-clamp', 'pressure-gauge-tee', 'test-point', 'scope-clip'].sort(),
    )
  })

  it('renders a distinct hookup for each kind', () => {
    for (const kind of OVERLAY_KINDS) {
      const { container } = render(<svg><TestOverlay kind={kind} /></svg>)
      expect(container.querySelector(`.dk-overlay[data-kind="${kind}"]`)).not.toBeNull()
    }
  })

  it('scope-clip is a deferred stub, not a waveform', () => {
    const { container } = render(<svg><TestOverlay kind="scope-clip" /></svg>)
    expect(container.querySelector('[data-deferred="true"]')).not.toBeNull()
    expect(container.querySelector('.dk-waveform')).toBeNull()
  })

  it('an unseen overlay kind degrades to a neutral test-point marker (never blank)', () => {
    const { container } = render(<svg><TestOverlay kind={'mystery' as never} /></svg>)
    expect(container.querySelector('.dk-overlay')).not.toBeNull()
  })

  it('amp-clamp (animated) suppresses motion under prefers-reduced-motion', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: true, media: '', addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    }))
    const { container } = render(<svg><TestOverlay kind="amp-clamp" /></svg>)
    expect(container.querySelector('.dk-overlay[data-reduced-motion="true"]')).not.toBeNull()
  })
})
