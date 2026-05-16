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
})
