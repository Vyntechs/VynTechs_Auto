import { render, screen } from '@testing-library/react'
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

  it('calls the browser print dialog and does not mutate application state', async () => {
    const print = vi.fn()
    vi.stubGlobal('print', print)
    render(<CustomerCopy copy={customerCopyFixture} canManageShopIdentity />)

    await userEvent.click(screen.getByRole('button', { name: 'Print customer copy' }))
    expect(print).toHaveBeenCalledTimes(1)
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
    render(<CustomerCopy copy={{
      ...customerCopyFixture,
      readyToPrint: false,
      blockers: ['pricing_unavailable'],
      jobs: [],
    }} canManageShopIdentity={false} />)

    expect(screen.getByRole('button', { name: 'Print customer copy' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Pricing must be repaired before this customer copy can print.')
    expect(screen.queryByRole('link', { name: 'Open Shop Settings' })).toBeNull()
  })

  it('defines global print isolation and non-breaking document hooks', () => {
    const css = readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8')
    expect(css).toMatch(/@media print[\s\S]*data-customer-copy-document/)
    expect(css).toMatch(/data-customer-copy-controls[\s\S]*display:\s*none/)
    expect(css).toMatch(/data-customer-copy-job[\s\S]*break-inside:\s*avoid/)
    expect(css).toMatch(/data-customer-copy-totals[\s\S]*break-inside:\s*avoid/)
  })
})
