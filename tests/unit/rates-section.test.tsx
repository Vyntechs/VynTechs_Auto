import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RatesSection } from '@/components/vt/rates-section'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

function okResponse() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('RatesSection — parts markup', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders the stored markup as a percent', () => {
    render(
      <RatesSection
        initialTaxRateBps={null}
        initialLaborRateCents={null}
        initialPartsMarkupBps={4000}
      />,
    )
    expect(screen.getByLabelText('Default parts markup (%)')).toHaveValue('40')
  })

  it('saves only the markup, leaving untouched rate fields out of the payload', async () => {
    const fetchMock = vi.mocked(fetch).mockResolvedValueOnce(okResponse())
    render(
      <RatesSection
        initialTaxRateBps={825}
        initialLaborRateCents={12000}
        initialPartsMarkupBps={null}
      />,
    )
    await userEvent.type(screen.getByLabelText('Default parts markup (%)'), '40')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(fetchMock).toHaveBeenCalledWith('/api/shop', expect.objectContaining({ method: 'POST' }))
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ partsMarkupBps: 4000 })
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })

  it('keeps Save disabled and never calls the API for an out-of-range markup', async () => {
    const fetchMock = vi.mocked(fetch)
    render(
      <RatesSection
        initialTaxRateBps={null}
        initialLaborRateCents={null}
        initialPartsMarkupBps={null}
      />,
    )
    await userEvent.type(screen.getByLabelText('Default parts markup (%)'), '1001')
    expect(screen.getByText('Enter a percent between 0 and 1000, like 40.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
