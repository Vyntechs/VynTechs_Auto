import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Motion } from '@/components/marketing/motion'

// jsdom doesn't fire scroll events naturally, but we can still assert the DOM
// structure that drives the snap behavior. The visual correctness (snap actually
// happening) is verified in the browser; the test guards the structural
// contract that the CSS hooks into.

describe('Motion section — scroll-snap targets', () => {
  // Scroll inertia on mobile flicks the page past multiple progress thresholds
  // in one gesture, cycling the phone-screen image rapidly during deceleration.
  // The fix is CSS scroll-snap: 5 invisible anchor elements at the step
  // thresholds, each marked with data-snap. Each tells the browser "this is a
  // place scroll can land," so a flick-and-release lands on the next step
  // instead of coasting through several.
  it('renders five scroll-snap anchors inside the track, one per motion step', () => {
    const { container } = render(<Motion />)
    const snaps = container.querySelectorAll('[data-mk-snap]')
    expect(snaps).toHaveLength(5)
  })

  it('places the snap anchors inside the motion track (so snap only applies in this section)', () => {
    const { container } = render(<Motion />)
    const track = container.querySelector('.mk__motion-track')
    expect(track).toBeTruthy()
    const snapsInTrack = track!.querySelectorAll('[data-mk-snap]')
    expect(snapsInTrack).toHaveLength(5)
  })

  it('numbers the snap anchors 1..5 so each one corresponds to a step', () => {
    const { container } = render(<Motion />)
    const snaps = Array.from(container.querySelectorAll('[data-mk-snap]'))
    const values = snaps.map((el) => el.getAttribute('data-mk-snap'))
    expect(values).toEqual(['1', '2', '3', '4', '5'])
  })
})
