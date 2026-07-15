import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectionStatus } from '@/components/app-shell/connection-status'

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    value,
  })
}

beforeEach(() => {
  setOnline(true)
})

afterEach(() => {
  vi.restoreAllMocks()
  setOnline(true)
})

describe('ConnectionStatus', () => {
  it('renders nothing while the browser reports an online connection', () => {
    const { container } = render(<ConnectionStatus />)

    expect(container.innerHTML).toBe('')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('announces an honest offline state and clears it after reconnection', () => {
    const { container } = render(<ConnectionStatus />)

    act(() => {
      setOnline(false)
      window.dispatchEvent(new Event('offline'))
    })

    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByRole('status')).toHaveTextContent(
      'Connection needed · Unsaved actions require a connection',
    )

    act(() => {
      setOnline(true)
      window.dispatchEvent(new Event('online'))
    })

    expect(container.innerHTML).toBe('')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('removes both browser-state listeners on unmount', () => {
    const addListener = vi.spyOn(window, 'addEventListener')
    const removeListener = vi.spyOn(window, 'removeEventListener')
    const { unmount } = render(<ConnectionStatus />)
    const onlineListener = addListener.mock.calls.find(
      ([type]) => type === 'online',
    )?.[1]
    const offlineListener = addListener.mock.calls.find(
      ([type]) => type === 'offline',
    )?.[1]

    expect(onlineListener).toEqual(expect.any(Function))
    expect(offlineListener).toEqual(expect.any(Function))

    unmount()

    expect(removeListener).toHaveBeenCalledWith('online', onlineListener)
    expect(removeListener).toHaveBeenCalledWith('offline', offlineListener)
  })

  it('never claims that offline actions were saved, synced, or queued', () => {
    render(<ConnectionStatus />)

    act(() => {
      setOnline(false)
      window.dispatchEvent(new Event('offline'))
    })

    expect(screen.getByRole('status').textContent).not.toMatch(
      /\b(saved|synced|queued)\b/i,
    )
  })
})
