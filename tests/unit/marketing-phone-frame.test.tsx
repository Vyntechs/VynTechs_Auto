import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { PhoneFrame } from '@/components/marketing/phone-frame'

describe('PhoneFrame', () => {
  it('renders a notch overlay in the empty/placeholder case so the device still reads as an iPhone', () => {
    const { container } = render(<PhoneFrame />)
    expect(container.querySelector('.mk__phone__notch')).toBeTruthy()
  })

  // Captured screenshots include the full app surface starting at the very top
  // (DASHBOARD bar / AppHeader V° lockup, depending on screen). With the notch
  // overlay drawn at `top:8px height:26px` and opaque graphite-1000 fill, it
  // sits ON TOP of those captured pixels and obscures them. The screenshots
  // were generated against the same retina geometry the frame uses; they're
  // not meant to be re-clipped by a synthetic notch. So whenever an image is
  // present, the frame must not draw the notch — let the screenshot's own top
  // region read through cleanly.
  it('omits the notch overlay when an image is supplied so the screenshot top is fully visible', () => {
    const image = { src: '/marketing/screenshots/hero.png', alt: 'test hero' }
    const { container } = render(<PhoneFrame image={image} />)
    expect(container.querySelector('.mk__phone__notch')).toBeNull()
  })

  it('still wraps the image in the rounded .mk__phone__screen so the corners stay clipped', () => {
    const image = { src: '/marketing/screenshots/hero.png', alt: 'test hero' }
    const { container } = render(<PhoneFrame image={image} />)
    expect(container.querySelector('.mk__phone__screen')).toBeTruthy()
    expect(container.querySelector('.mk__phone__screen img')).toBeTruthy()
  })

  // With `object-fit: cover` and the outer frame's fixed 9px padding, the inner
  // screen ends up at a SQUARER aspect than the image (0.442 vs 0.462), so
  // `cover` was zooming the image to fill height and clipping ~5px on each
  // side. Real iPhones display 1170×2532 captures edge-to-edge with no crop.
  // Fix: a --has-image modifier on the frame and screen that detaches the
  // inner aspect from the outer aspect, making the inner screen exactly match
  // the image's aspect ratio (1170/2532). The tiny remainder above and below
  // shows as natural phone-body bezel (Dynamic Island / home-indicator area).
  it('marks the frame with --has-image when an image is supplied so CSS can preserve image aspect', () => {
    const image = { src: '/marketing/screenshots/hero.png', alt: 'test hero' }
    const { container } = render(<PhoneFrame image={image} />)
    expect(container.querySelector('.mk__phone--has-image')).toBeTruthy()
    expect(container.querySelector('.mk__phone__screen--has-image')).toBeTruthy()
  })

  it('does not mark the frame with --has-image in the empty/placeholder case', () => {
    const { container } = render(<PhoneFrame />)
    expect(container.querySelector('.mk__phone--has-image')).toBeNull()
    expect(container.querySelector('.mk__phone__screen--has-image')).toBeNull()
  })
})
