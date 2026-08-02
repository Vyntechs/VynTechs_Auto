import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ShopSection } from '@/components/vt/shop-section'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const initialIdentity = {
  initialPhone: '(214) 555-0197',
  initialAddressLine1: '415 Industrial Way',
  initialAddressLine2: null,
  initialCity: 'Garland',
  initialRegion: 'TX',
  initialPostalCode: '75040',
}

describe('ShopSection customer paperwork identity', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders the saved phone and complete postal address', () => {
    render(<ShopSection initialName="Honest Auto" {...initialIdentity} />)

    expect(screen.getByLabelText('Shop phone')).toHaveValue('(214) 555-0197')
    expect(screen.getByLabelText('Address line 1')).toHaveValue('415 Industrial Way')
    expect(screen.getByLabelText('Address line 2')).toHaveValue('')
    expect(screen.getByLabelText('City')).toHaveValue('Garland')
    expect(screen.getByLabelText('State or region')).toHaveValue('TX')
    expect(screen.getByLabelText('Postal code')).toHaveValue('75040')
  })

  it('saves trimmed identity through the existing shop endpoint', async () => {
    const fetchMock = vi.mocked(fetch)
    render(<ShopSection initialName="Honest Auto" {...initialIdentity} />)

    await userEvent.clear(screen.getByLabelText('Shop phone'))
    await userEvent.type(screen.getByLabelText('Shop phone'), '  972-555-0123  ')
    await userEvent.clear(screen.getByLabelText('Address line 2'))
    await userEvent.type(screen.getByLabelText('Address line 2'), '   ')
    await userEvent.click(screen.getByRole('button', { name: 'Save customer paperwork' }))

    expect(fetchMock).toHaveBeenCalledWith('/api/shop', expect.objectContaining({ method: 'POST' }))
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      phone: '972-555-0123',
      addressLine1: '415 Industrial Way',
      addressLine2: null,
      city: 'Garland',
      region: 'TX',
      postalCode: '75040',
    })
    expect(await screen.findByText('Customer paperwork saved')).toBeInTheDocument()
  })

  it('keeps the save unavailable when a required field is empty or over its bound', async () => {
    render(<ShopSection initialName="Honest Auto" {...initialIdentity} />)

    await userEvent.clear(screen.getByLabelText('City'))
    expect(screen.getByRole('button', { name: 'Save customer paperwork' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'x'.repeat(81) } })
    expect(screen.getByRole('button', { name: 'Save customer paperwork' })).toBeDisabled()
    expect(screen.getByText('City must be 1–80 characters.')).toBeInTheDocument()
  })
})
