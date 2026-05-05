import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { ViewportGate } from '@/components/vt/desktop/viewport-gate'

function setWidth(value: number) {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value })
}

describe('ViewportGate (gap #4 desktop-only counter screens)', () => {
  beforeEach(() => {
    setWidth(1440) // assume desktop default before each test
  })

  it('renders children when viewport is >= 1280', async () => {
    render(
      <ViewportGate>
        <div>desktop content</div>
      </ViewportGate>,
    )
    expect(await screen.findByText('desktop content')).toBeInTheDocument()
    expect(screen.queryByText(/use a desktop or laptop/i)).not.toBeInTheDocument()
  })

  it('renders the gate message instead of children when viewport is < 1280', async () => {
    setWidth(390)
    render(
      <ViewportGate>
        <div>desktop content</div>
      </ViewportGate>,
    )
    expect(await screen.findByText(/use a desktop or laptop/i)).toBeInTheDocument()
    expect(screen.queryByText('desktop content')).not.toBeInTheDocument()
  })

  it('flips on window resize from desktop to mobile', async () => {
    render(
      <ViewportGate>
        <div>desktop content</div>
      </ViewportGate>,
    )
    expect(await screen.findByText('desktop content')).toBeInTheDocument()

    act(() => {
      setWidth(700)
      window.dispatchEvent(new Event('resize'))
    })
    expect(await screen.findByText(/use a desktop or laptop/i)).toBeInTheDocument()
    expect(screen.queryByText('desktop content')).not.toBeInTheDocument()
  })

  it('flips on window resize from mobile back to desktop', async () => {
    setWidth(390)
    render(
      <ViewportGate>
        <div>desktop content</div>
      </ViewportGate>,
    )
    expect(await screen.findByText(/use a desktop or laptop/i)).toBeInTheDocument()

    act(() => {
      setWidth(1500)
      window.dispatchEvent(new Event('resize'))
    })
    expect(await screen.findByText('desktop content')).toBeInTheDocument()
    expect(screen.queryByText(/use a desktop or laptop/i)).not.toBeInTheDocument()
  })
})
