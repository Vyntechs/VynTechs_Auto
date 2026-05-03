import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { hrefSetter } = vi.hoisted(() => ({ hrefSetter: vi.fn() }))

beforeEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      get href() {
        return 'http://localhost/billing'
      },
      set href(v: string) {
        hrefSetter(v)
      },
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  hrefSetter.mockReset()
})

import { BillingClient } from '@/components/screens/billing-client'

describe('BillingClient', () => {
  it('renders an actionable manage-subscription button', () => {
    render(<BillingClient />)
    const btn = screen.getByRole('button', { name: /manage subscription/i })
    expect(btn).toBeEnabled()
  })

  it('POSTs to /api/stripe/portal and redirects to the returned URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://billing.stripe.com/p/session_xyz' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<BillingClient />)
    fireEvent.click(screen.getByRole('button', { name: /manage subscription/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/stripe/portal', {
        method: 'POST',
      })
    })
    await waitFor(() => {
      expect(hrefSetter).toHaveBeenCalledWith(
        'https://billing.stripe.com/p/session_xyz',
      )
    })
  })

  it('surfaces an error and re-enables the button when the portal call fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'no stripe customer' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<BillingClient />)
    const btn = screen.getByRole('button', { name: /manage subscription/i })
    fireEvent.click(btn)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/no stripe customer/i)
    })
    expect(btn).toBeEnabled()
    expect(hrefSetter).not.toHaveBeenCalled()
  })
})
