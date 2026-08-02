import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { CustomerCopy } from '@/components/screens/customer-copy'
import { customerCopyFixture } from '@/tests/helpers/customer-copy'

describe('CustomerCopy', () => {
  it('renders the complete customer paperwork allowlist and no staff sentinel', () => {
    const { container } = render(<CustomerCopy copy={customerCopyFixture} canManageShopIdentity />)

    expect(screen.getByRole('heading', { name: 'Invoice' })).toBeInTheDocument()
    expect(screen.getByText('Honest Auto')).toBeInTheDocument()
    expect(screen.getByText('(214) 555-0197')).toBeInTheDocument()
    expect(screen.getByText('Ada Driver')).toBeInTheDocument()
    expect(screen.getByText('2020 Ford F-150')).toBeInTheDocument()
    expect(screen.getByText('1FTFW1E50LFA00001')).toBeInTheDocument()
    expect(screen.getByText('91,240 mi')).toBeInTheDocument()
    expect(screen.getByText('Brake pad set')).toBeInTheDocument()
    expect(screen.getByText('2 · PAD-42 · Northstar')).toBeInTheDocument()
    expect(screen.getByText('1.25 hr · $150.00/hr')).toBeInTheDocument()
    expect(screen.getByText(/Customer said yes · Phone · Aug 1, 2026/)).toBeInTheDocument()
    expect(screen.getByText(/Customer said no · Aug 1, 2026/)).toBeInTheDocument()
    expect(screen.getAllByText('$245.50')).toHaveLength(2)
    expect(container).toHaveTextContent('Card')
    expect(container.textContent).not.toContain('SENTINEL')
    expect(container.querySelector('[data-customer-copy-document]')).not.toBeNull()
  })

  it.each([
    ['estimate', 'Estimate'],
    ['invoice', 'Invoice'],
    ['paid_receipt', 'Paid receipt'],
  ] as const)('uses the exact %s document label', (documentKind, label) => {
    render(<CustomerCopy copy={{ ...customerCopyFixture, documentKind }} canManageShopIdentity />)
    expect(screen.getByRole('heading', { name: label })).toBeInTheDocument()
  })

  it('keeps a ready screen projection locked against native print before a fresh attempt', () => {
    const { container } = render(<CustomerCopy copy={customerCopyFixture} canManageShopIdentity />)

    expect(screen.getByText('Invoice ready')).toBeInTheDocument()
    expect(container.querySelector('[data-customer-copy-document]')).toHaveAttribute('data-print-ready', 'false')
    expect(container.querySelector('[data-customer-copy-print-blocker]')).toHaveTextContent('not ready to print')
  })

  it('grants print authorization only after refresh succeeds and the print sink observes it', async () => {
    const print = vi.fn(() => {
      expect(document.querySelector('[data-customer-copy-document]')).toHaveAttribute('data-print-ready', 'true')
    })
    vi.stubGlobal('print', print)
    const refreshCopy = vi.fn(async () => ({ ok: true as const, copy: customerCopyFixture }))
    render(<CustomerCopy
      copy={customerCopyFixture}
      canManageShopIdentity
      ticketId="ticket-1"
      refreshCopy={refreshCopy}
    />)

    await userEvent.click(screen.getByRole('button', { name: 'Print customer copy' }))
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1))
    expect(refreshCopy).toHaveBeenCalledWith('ticket-1')
    expect(document.querySelector('[data-customer-copy-document]')).toHaveAttribute('data-print-ready', 'true')
  })

  it('revokes the fresh print grant after the print attempt ends', async () => {
    const print = vi.fn()
    vi.stubGlobal('print', print)
    const refreshCopy = vi.fn(async () => ({ ok: true as const, copy: customerCopyFixture }))
    render(<CustomerCopy
      copy={customerCopyFixture}
      canManageShopIdentity
      ticketId="ticket-1"
      refreshCopy={refreshCopy}
    />)

    await userEvent.click(screen.getByRole('button', { name: 'Print customer copy' }))
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1))
    expect(document.querySelector('[data-customer-copy-document]')).toHaveAttribute('data-print-ready', 'true')

    act(() => window.dispatchEvent(new Event('afterprint')))

    await waitFor(() => expect(document.querySelector('[data-customer-copy-document]')).toHaveAttribute('data-print-ready', 'false'))
  })

  it('renders fresh authorized money before printing', async () => {
    const print = vi.fn()
    vi.stubGlobal('print', print)
    const fresh = {
      ...customerCopyFixture,
      totals: { ...customerCopyFixture.totals, balanceCents: 12_345 },
    }
    const refreshCopy = vi.fn(async () => ({ ok: true as const, copy: fresh }))
    render(<CustomerCopy
      copy={customerCopyFixture}
      canManageShopIdentity
      ticketId="ticket-1"
      refreshCopy={refreshCopy}
    />)

    await userEvent.click(screen.getByRole('button', { name: 'Print customer copy' }))

    await waitFor(() => expect(print).toHaveBeenCalledTimes(1))
    expect(screen.getAllByText('$123.45')).toHaveLength(2)
  })

  it.each([
    ['authorization or refresh failure', { ok: false as const, error: 'forbidden' as const }],
    ['a newly blocked projection', {
      ok: true as const,
      copy: { ...customerCopyFixture, readyToPrint: false, blockers: ['pricing_unavailable' as const], jobs: [] },
    }],
  ])('does not print after %s', async (_label, result) => {
    const print = vi.fn()
    vi.stubGlobal('print', print)
    const refreshCopy = vi.fn(async () => result)
    render(<CustomerCopy
      copy={customerCopyFixture}
      canManageShopIdentity
      ticketId="ticket-1"
      refreshCopy={refreshCopy}
    />)

    await userEvent.click(screen.getByRole('button', { name: 'Print customer copy' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be refreshed|must be repaired/i)
    expect(print).not.toHaveBeenCalled()
    expect(document.querySelector('[data-customer-copy-document]')).toHaveAttribute('data-print-ready', 'false')
  })

  it('blocks printing for incomplete shop identity and points an owner to existing Settings', () => {
    render(<CustomerCopy copy={{
      ...customerCopyFixture,
      readyToPrint: false,
      blockers: ['shop_phone', 'shop_city'],
    }} canManageShopIdentity />)

    expect(screen.getByRole('button', { name: 'Print customer copy' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Add the shop phone and city before printing.')
    expect(screen.getByRole('link', { name: 'Open Shop Settings' })).toHaveAttribute('href', '/settings/shop')
  })

  it('blocks printing instead of showing guessed money when pricing is unavailable', () => {
    const { container } = render(<CustomerCopy copy={{
      ...customerCopyFixture,
      readyToPrint: false,
      blockers: ['pricing_unavailable'],
      jobs: [],
    }} canManageShopIdentity={false} />)

    expect(screen.getByRole('button', { name: 'Print customer copy' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Pricing must be repaired before this customer copy can print.')
    expect(screen.queryByRole('link', { name: 'Open Shop Settings' })).toBeNull()
    expect(container.querySelector('[data-customer-copy-document]')).toHaveAttribute('data-print-ready', 'false')
  })

  it('defines global print isolation and non-breaking document hooks', () => {
    const css = readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8')
    expect(css).toMatch(/@page customer-copy/)
    expect(css).toMatch(/@media print[\s\S]*data-customer-copy-shell[\s\S]*display:\s*none/)
    expect(css).toMatch(/data-customer-copy-document[^\n]*data-print-ready=['"]false['"][\s\S]*display:\s*none/)
    expect(css).not.toMatch(/@media print[\s\S]*visibility:\s*hidden/)
    expect(css).toMatch(/data-customer-copy-controls[\s\S]*display:\s*none/)
    expect(css).toMatch(/data-customer-copy-job[\s\S]*break-inside:\s*avoid/)
    expect(css).toMatch(/data-customer-copy-totals[\s\S]*break-inside:\s*avoid/)
  })

  it('marks blocked paperwork as non-printable for native browser print', () => {
    const { container } = render(<CustomerCopy copy={{
      ...customerCopyFixture,
      readyToPrint: false,
      blockers: ['shop_phone'],
    }} canManageShopIdentity={false} />)

    expect(container.querySelector('[data-customer-copy-document]')).toHaveAttribute('data-print-ready', 'false')
    expect(container.querySelector('[data-customer-copy-print-blocker]')).toHaveTextContent('not ready to print')
  })

  it('prints the close date on a paid receipt', () => {
    render(<CustomerCopy copy={{
      ...customerCopyFixture,
      documentKind: 'paid_receipt',
      closedAt: '2026-08-01T14:00:00.000Z',
    }} canManageShopIdentity />)

    expect(screen.getByText(/Closed Aug 1, 2026/)).toBeInTheDocument()
  })

  it('does not reuse React keys for same-kind same-title jobs', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<CustomerCopy copy={{
      ...customerCopyFixture,
      jobs: [customerCopyFixture.jobs[0], customerCopyFixture.jobs[0]],
    }} canManageShopIdentity />)

    expect(error.mock.calls.flat().join(' ')).not.toMatch(/same key|unique "key"/i)
    error.mockRestore()
  })
})
