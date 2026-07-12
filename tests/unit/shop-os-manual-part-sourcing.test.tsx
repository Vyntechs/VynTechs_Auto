import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ManualPartSourcing, type ManualPartSourcingProps } from '@/components/screens/manual-part-sourcing'
import type { SafeManualVendorAccount } from '@/lib/shop-os/parts-sourcing-ui'

const ACCOUNT_ONE = {
  id: '00000000-0000-4000-8000-000000000101',
  displayName: 'Northside Parts',
  mode: 'manual',
  enabled: true,
  updatedAt: '2026-07-12T12:00:00.000Z',
} satisfies SafeManualVendorAccount

const ACCOUNT_TWO = {
  ...ACCOUNT_ONE,
  id: '00000000-0000-4000-8000-000000000102',
  displayName: 'Metro Supply',
} satisfies SafeManualVendorAccount

function props(overrides: Partial<ManualPartSourcingProps> = {}): ManualPartSourcingProps {
  return {
    open: true,
    ticketId: '00000000-0000-4000-8000-000000000201',
    ticketLabel: 'RO 1042',
    vehicleLabel: '2019 Ford F-150',
    job: { id: '00000000-0000-4000-8000-000000000301', title: 'Replace front brakes' },
    accounts: [ACCOUNT_ONE],
    catalogAvailable: true,
    canCreateVendorAccount: false,
    diagnosisSeed: null,
    busy: false,
    onBusyChange: vi.fn(),
    onAccountCreated: vi.fn(),
    onSaved: vi.fn(async () => true),
    onClose: vi.fn(),
    ...overrides,
  }
}

describe('ManualPartSourcing', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => '00000000-0000-4000-8000-000000000901') })
  })

  it('renders nothing while closed and one named dialog while open without progress theater', () => {
    const { rerender } = render(<ManualPartSourcing {...props({ open: false })} />)
    expect(screen.queryByRole('dialog')).toBeNull()

    rerender(<ManualPartSourcing {...props()} />)
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('dialog', { name: 'Source part for Replace front brakes' })).toBeInTheDocument()
    expect(screen.getByText('2019 Ford F-150 · RO 1042')).toBeInTheDocument()
    expect(screen.queryByText(/step|progress/i)).toBeNull()
  })

  it('visibly preselects exactly one supplier but requires a choice when two exist', () => {
    const { unmount } = render(<ManualPartSourcing {...props()} />)
    expect(screen.getByRole('radio', { name: 'Northside Parts' })).toBeChecked()

    unmount()
    render(<ManualPartSourcing {...props({ accounts: [ACCOUNT_ONE, ACCOUNT_TWO] })} />)
    expect(screen.getByRole('radio', { name: 'Northside Parts' })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: 'Metro Supply' })).not.toBeChecked()
  })

  it('shows only the authorized supplier path and degrades honestly when the catalog is unavailable', () => {
    const { rerender } = render(<ManualPartSourcing {...props({ accounts: [], canCreateVendorAccount: true })} />)
    expect(screen.getByRole('button', { name: 'Add supplier' })).toBeInTheDocument()

    rerender(<ManualPartSourcing {...props({ accounts: [], canCreateVendorAccount: false })} />)
    expect(screen.getByText('An owner needs to add a supplier before this part can be sourced.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add supplier' })).toBeNull()

    rerender(<ManualPartSourcing {...props({ accounts: [], catalogAvailable: false, canCreateVendorAccount: true })} />)
    expect(screen.getByText('Sourcing is temporarily unavailable. Manual quote entry still works.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add supplier' })).toBeNull()
  })

  it('starts with honest capture defaults and accessible decimal fields', () => {
    render(<ManualPartSourcing {...props()} />)
    expect(screen.getByLabelText('Quantity')).toHaveValue('1')
    fireEvent.click(screen.getByRole('button', { name: 'Part details' }))
    expect(screen.getByLabelText('Supplier core charge')).toHaveValue('0.00')
    expect(screen.getByRole('radio', { name: 'Unknown availability' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Unknown fulfillment' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Taxable' })).toBeChecked()

    for (const label of ['Quantity', 'Supplier unit cost', 'Customer line price', 'Supplier core charge']) {
      expect(screen.getByLabelText(label)).toHaveAttribute('inputmode', 'decimal')
    }
    const controls = [
      ...screen.getAllByRole('button'),
      ...screen.getAllByRole('checkbox'),
      ...screen.getAllByRole('radio'),
      ...screen.getAllByRole('textbox'),
    ]
    for (const control of controls) expect(control).toHaveAccessibleName()
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
  })

  it('preserves optional values across collapse and opens details for invalid optional input', async () => {
    const user = userEvent.setup()
    render(<ManualPartSourcing {...props()} />)
    const disclosure = screen.getByRole('button', { name: 'Part details' })
    expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    await user.click(disclosure)
    await user.type(screen.getByLabelText('Part number'), 'PAD-42')
    await user.click(disclosure)
    expect(screen.queryByLabelText('Part number')).toBeNull()
    await user.click(disclosure)
    expect(screen.getByLabelText('Part number')).toHaveValue('PAD-42')

    fireEvent.change(screen.getByLabelText('Part number'), { target: { value: 'x'.repeat(201) } })
    await user.click(disclosure)
    await user.type(screen.getByLabelText('Part description'), 'Pad set')
    await user.type(screen.getByLabelText('Supplier unit cost'), '80')
    await user.type(screen.getByLabelText('Customer line price'), '120')
    await user.click(screen.getByRole('button', { name: /Add 1 Pad set/ }))
    expect(disclosure).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByLabelText('Part number')).toHaveFocus()
    expect(screen.getByRole('status')).toHaveTextContent('Part number')
  })

  it('keeps a diagnosis suggestion inert until Use and fills only description', async () => {
    const user = userEvent.setup()
    render(<ManualPartSourcing {...props({ diagnosisSeed: { description: 'Front brake pad set' } })} />)
    const suggestion = screen.getByRole('complementary', { name: 'Starting point from locked diagnosis' })
    expect(within(suggestion).getByText('Front brake pad set')).toBeInTheDocument()
    expect(screen.getByLabelText('Part description')).toHaveValue('')
    await user.click(within(suggestion).getByRole('button', { name: 'Use' }))
    expect(screen.getByLabelText('Part description')).toHaveValue('Front brake pad set')
    await user.click(screen.getByRole('button', { name: 'Part details' }))
    expect(screen.getByLabelText('Part number')).toHaveValue('')
    expect(screen.getByLabelText('Brand')).toHaveValue('')
  })

  it('closes clean drafts immediately and confirms dirty close or Escape once', async () => {
    const user = userEvent.setup()
    const cleanClose = vi.fn()
    const { unmount } = render(<ManualPartSourcing {...props({ onClose: cleanClose })} />)
    await user.click(screen.getByRole('button', { name: 'Close part sourcing' }))
    expect(cleanClose).toHaveBeenCalledOnce()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    unmount()

    const dirtyClose = vi.fn()
    render(<ManualPartSourcing {...props({ onClose: dirtyClose })} />)
    await user.type(screen.getByLabelText('Part description'), 'Pads')
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.keyDown(document, { key: 'Escape' })
    const confirmation = screen.getByRole('alertdialog', { name: 'Discard sourced part draft?' })
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1)
    await user.click(within(confirmation).getByRole('button', { name: 'Keep editing' }))
    expect(dirtyClose).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'Escape' })
    await user.click(screen.getByRole('button', { name: 'Discard draft' }))
    expect(dirtyClose).toHaveBeenCalledOnce()
  })

  it('contains no fake persistence, provider, order, price, fitment, or visible step claims', () => {
    render(<ManualPartSourcing {...props()} />)
    expect(document.body).not.toHaveTextContent(/Autosaved|\bOrder\b|\bBuy\b|Live price|Verified fitment|\d+\s+of\s+\d+|\d+\s+steps?/i)
  })

  it('encodes the single-state responsive panel, safe area, sticky action, touch target, and reduced-motion contract', () => {
    const css = readFileSync(resolve(process.cwd(), 'components/screens/manual-part-sourcing.module.css'), 'utf8')
    expect(css).toMatch(/@media\s*\(min-width:\s*801px\)/)
    expect(css).toMatch(/width:\s*min\(440px,\s*42vw\)/)
    expect(css).toMatch(/height:\s*100vh/)
    expect(css).toMatch(/overflow-y:\s*auto/)
    expect(css).toMatch(/@media\s*\(max-width:\s*800px\)/)
    expect(css).toMatch(/inset:\s*0/)
    expect(css).toMatch(/min-height:\s*100dvh/)
    expect(css).toMatch(/env\(safe-area-inset-bottom\)/)
    expect(css).toMatch(/position:\s*sticky/)
    expect(css).toMatch(/min-height:\s*44px/)
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/)
  })
})
