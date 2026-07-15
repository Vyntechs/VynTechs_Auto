import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SubscribeClient } from '@/components/screens/subscribe-client'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/subscribe',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/image', () => ({
  default: () => <span aria-hidden="true" />,
}))
vi.mock('@/components/vt/whats-new-badge', () => ({ WhatsNewBadge: () => null }))

describe('SubscribeClient', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('describes restoring ShopOS access at the approved price', () => {
    render(<SubscribeClient />)
    expect(screen.getByText(/work orders, assignments, quotes, and job status/i)).toBeInTheDocument()
    expect(screen.queryByText(/diagnos/i)).toBeNull()
    expect(screen.getByRole('button', { name: 'Restart subscription — $100/month' })).toBeEnabled()
  })

  it('preserves the checkout route and redirects to its returned URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://checkout.stripe.test/session' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { href: 'http://localhost/subscribe' },
    })

    render(<SubscribeClient />)
    fireEvent.click(screen.getByRole('button', { name: 'Restart subscription — $100/month' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/stripe/checkout',
      { method: 'POST' },
    ))
    await waitFor(() => expect(window.location.href).toBe('https://checkout.stripe.test/session'))
  })
})
