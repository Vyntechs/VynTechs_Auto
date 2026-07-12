import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
    onAccessFailure: vi.fn(),
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

  it('focuses the first missing required field and traps forward and reverse focus in the panel', async () => {
    const user = userEvent.setup()
    render(<ManualPartSourcing {...props({ accounts: [ACCOUNT_ONE, ACCOUNT_TWO] })} />)

    expect(screen.getByRole('radio', { name: 'Northside Parts' })).toHaveFocus()
    const dialog = screen.getByRole('dialog')
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])'))
    focusable.at(-1)!.focus()
    await user.tab()
    expect(focusable[0]).toHaveFocus()
    focusable[0].focus()
    await user.tab({ shift: true })
    expect(focusable.at(-1)).toHaveFocus()
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

  it.each([
    {
      label: 'manager action',
      overrides: { accounts: [], canCreateVendorAccount: true },
      target: () => screen.getByRole('button', { name: 'Add supplier' }),
    },
    {
      label: 'non-manager notice',
      overrides: { accounts: [], canCreateVendorAccount: false },
      target: () => screen.getByText('An owner needs to add a supplier before this part can be sourced.'),
    },
    {
      label: 'catalog-unavailable notice',
      overrides: { accounts: [], catalogAvailable: false, canCreateVendorAccount: true },
      target: () => screen.getByText('Sourcing is temporarily unavailable. Manual quote entry still works.'),
    },
  ])('focuses the first honest zero-account $label when the panel opens', ({ overrides, target }) => {
    render(<ManualPartSourcing {...props(overrides)} />)
    expect(target()).toHaveFocus()
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

  it('opens the dirty confirmation from the close button, focuses Keep editing, traps focus, and makes the form inert', async () => {
    const user = userEvent.setup()
    render(<ManualPartSourcing {...props()} />)
    await user.type(screen.getByLabelText('Part description'), 'Pads')
    await user.click(screen.getByRole('button', { name: 'Close part sourcing' }))

    const confirmation = screen.getByRole('alertdialog', { name: 'Discard sourced part draft?' })
    const keepEditing = within(confirmation).getByRole('button', { name: 'Keep editing' })
    const discard = within(confirmation).getByRole('button', { name: 'Discard draft' })
    expect(keepEditing).toHaveFocus()
    expect(screen.getByTestId('manual-part-dialog-content')).toHaveAttribute('inert')
    discard.focus()
    await user.tab()
    expect(keepEditing).toHaveFocus()
    await user.tab({ shift: true })
    expect(discard).toHaveFocus()

    await user.click(keepEditing)
    expect(screen.getByRole('button', { name: 'Close part sourcing' })).toHaveFocus()
  })

  it('restores the field that owned focus before Escape after Keep editing', async () => {
    const user = userEvent.setup()
    render(<ManualPartSourcing {...props()} />)
    const description = screen.getByLabelText('Part description')
    await user.type(description, 'Pads')
    expect(description).toHaveFocus()

    fireEvent.keyDown(document, { key: 'Escape' })
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Keep editing' }))
    expect(description).toHaveFocus()
  })

  it('clears stale submitted status after a correction so the next required issue is announced', async () => {
    const user = userEvent.setup()
    render(<ManualPartSourcing {...props()} />)
    await user.click(screen.getByRole('button', { name: /^Add / }))
    expect(screen.getByRole('status')).toHaveTextContent('Part description')

    await user.type(screen.getByLabelText('Part description'), 'Pads')
    expect(screen.getByRole('status')).toHaveTextContent('Supplier unit cost')
    expect(screen.getByRole('status')).not.toHaveTextContent('Part description')
  })

  it('rejects quantities and money beyond the Task 1 safe bounds', async () => {
    const user = userEvent.setup()
    render(<ManualPartSourcing {...props()} />)
    await user.type(screen.getByLabelText('Part description'), 'Pads')
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '1000000000' } })
    await user.type(screen.getByLabelText('Supplier unit cost'), '1')
    await user.type(screen.getByLabelText('Customer line price'), '1')
    await user.click(screen.getByRole('button', { name: /^Add / }))
    expect(screen.getByRole('status')).toHaveTextContent('Quantity')
    expect(screen.getByLabelText('Quantity')).toHaveFocus()

    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '999999999.999' } })
    fireEvent.change(screen.getByLabelText('Supplier unit cost'), { target: { value: '90071992547409.92' } })
    await user.click(screen.getByRole('button', { name: /^Add / }))
    expect(screen.getByRole('status')).toHaveTextContent('Supplier unit cost')
    expect(screen.getByLabelText('Supplier unit cost')).toHaveFocus()
  })

  it('ignores a stale location label while fulfillment is unknown', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ changed: false, unavailable: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    render(<ManualPartSourcing {...props()} />)
    await user.type(screen.getByLabelText('Part description'), 'Pads')
    await user.type(screen.getByLabelText('Supplier unit cost'), '80')
    await user.type(screen.getByLabelText('Customer line price'), '120')
    await user.click(screen.getByRole('button', { name: 'Part details' }))
    await user.click(screen.getByRole('radio', { name: 'Pickup' }))
    fireEvent.change(screen.getByLabelText('Location label'), { target: { value: 'x'.repeat(501) } })
    await user.click(screen.getByRole('radio', { name: 'Unknown fulfillment' }))

    await user.click(screen.getByRole('button', { name: /Add 1 Pads/ }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).fulfillment).toEqual({
      method: 'unknown',
      locationLabel: null,
    })
    expect(screen.queryByLabelText('Location label')).toBeNull()
  })

  it('keeps retry identity for normalized-equivalent edits and rotates it for changed request intent', async () => {
    const user = userEvent.setup()
    let uuidSequence = 900
    vi.mocked(crypto.randomUUID).mockImplementation(() => (
      `00000000-0000-4000-8000-${String(++uuidSequence).padStart(12, '0')}`
    ))
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('offline'))
    vi.stubGlobal('fetch', fetchMock)
    render(<ManualPartSourcing {...props()} />)
    expect(screen.getByRole('dialog')).not.toHaveAttribute('data-client-key')
    await fillRequiredOffer(user)
    await user.click(screen.getByRole('button', { name: /Add 2 Brake pads/ }))
    fireEvent.change(screen.getByLabelText('Part description'), { target: { value: 'Brake pads ' } })
    await user.click(screen.getByRole('button', { name: /Add 2 Brake pads/ }))
    fireEvent.change(screen.getByLabelText('Part description'), { target: { value: 'Brake pad set' } })
    await user.click(screen.getByRole('button', { name: /Add 2 Brake pad set/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body as string))
    expect(bodies[1].clientKey).toBe(bodies[0].clientKey)
    expect(bodies[2].clientKey).not.toBe(bodies[1].clientKey)
  })

  it('creates a supplier separately, selects it, and never auto-submits the offer', async () => {
    const user = userEvent.setup()
    const created = { ...ACCOUNT_TWO, id: '00000000-0000-4000-8000-000000000901', displayName: 'Metro Supply' }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      changed: true,
      vendorAccount: created,
    }), { status: 201, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const onAccountCreated = vi.fn()
    render(<ManualPartSourcing {...props({ accounts: [], canCreateVendorAccount: true, onAccountCreated })} />)

    await user.type(screen.getByLabelText('Part description'), 'Brake pads')
    await user.type(screen.getByLabelText('Supplier unit cost'), '80')
    await user.type(screen.getByLabelText('Customer line price'), '120')
    await user.click(screen.getByRole('button', { name: 'Add supplier' }))
    await user.type(screen.getByLabelText('Supplier name'), '  Metro Supply  ')
    await user.click(screen.getByRole('button', { name: 'Save supplier' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    expect(fetchMock).toHaveBeenCalledWith('/api/shop/vendor-accounts', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        clientKey: '00000000-0000-4000-8000-000000000901',
        displayName: 'Metro Supply',
      }),
    })
    expect(onAccountCreated).toHaveBeenCalledWith(created)
    expect(screen.getByRole('radio', { name: 'Metro Supply' })).toBeChecked()
    expect(screen.getByLabelText('Part description')).toHaveValue('Brake pads')
    expect(screen.getByLabelText('Supplier unit cost')).toHaveValue('80')
    expect(screen.getByLabelText('Customer line price')).toHaveValue('120')
    expect(screen.getByRole('status')).toHaveTextContent('Supplier saved. Continue with the part details.')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('accepts an exact account-creation replay and selects the returned supplier without capturing an offer', async () => {
    const user = userEvent.setup()
    const replayed = { ...ACCOUNT_TWO, id: '00000000-0000-4000-8000-000000000901', displayName: 'Metro Supply' }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      changed: false,
      vendorAccount: replayed,
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const onAccountCreated = vi.fn()
    render(<ManualPartSourcing {...props({ accounts: [], canCreateVendorAccount: true, onAccountCreated })} />)

    await user.click(screen.getByRole('button', { name: 'Add supplier' }))
    fireEvent.change(screen.getByLabelText('Supplier name'), { target: { value: 'Metro Supply' } })
    await user.click(screen.getByRole('button', { name: 'Save supplier' }))

    await waitFor(() => expect(onAccountCreated).toHaveBeenCalledWith(replayed))
    expect(screen.getByRole('radio', { name: 'Metro Supply' })).toBeChecked()
    expect(screen.getByRole('status')).toHaveTextContent('Supplier saved. Continue with the part details.')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it.each([
    ['a different supplier id', { ...ACCOUNT_TWO, id: ACCOUNT_ONE.id }],
    ['a different supplier name', { ...ACCOUNT_TWO, id: '00000000-0000-4000-8000-000000000901', displayName: 'Hostile Supply' }],
  ])('rejects account creation returning %s before selection or announcement', async (_label, returnedAccount) => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      changed: true,
      vendorAccount: returnedAccount,
    }), { status: 201, headers: { 'content-type': 'application/json' } })))
    const onAccountCreated = vi.fn()
    render(<ManualPartSourcing {...props({ accounts: [], canCreateVendorAccount: true, onAccountCreated })} />)

    await user.click(screen.getByRole('button', { name: 'Add supplier' }))
    fireEvent.change(screen.getByLabelText('Supplier name'), { target: { value: 'Metro Supply' } })
    await user.click(screen.getByRole('button', { name: 'Save supplier' }))

    expect(await screen.findByRole('status')).toHaveTextContent('The saved response could not be verified. Refresh before continuing.')
    expect(onAccountCreated).not.toHaveBeenCalled()
    expect(screen.queryByRole('radio', { name: returnedAccount.displayName })).toBeNull()
  })

  it('uses separate request identities for account creation and the resulting offer capture', async () => {
    const user = userEvent.setup()
    let uuidSequence = 900
    vi.mocked(crypto.randomUUID).mockImplementation(() => (
      `00000000-0000-4000-8000-${String(++uuidSequence).padStart(12, '0')}`
    ))
    const created = { ...ACCOUNT_TWO, id: '00000000-0000-4000-8000-000000000903', displayName: 'Metro Supply' }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        changed: true,
        vendorAccount: created,
      }), { status: 201, headers: { 'content-type': 'application/json' } }))
      .mockRejectedValueOnce(new TypeError('offline'))
    vi.stubGlobal('fetch', fetchMock)
    render(<ManualPartSourcing {...props({ accounts: [], canCreateVendorAccount: true })} />)

    await user.click(screen.getByRole('button', { name: 'Add supplier' }))
    fireEvent.change(screen.getByLabelText('Supplier name'), { target: { value: 'Metro Supply' } })
    await user.click(screen.getByRole('button', { name: 'Save supplier' }))

    await waitFor(() => expect(screen.getByRole('radio', { name: 'Metro Supply' })).toBeChecked())
    await fillRequiredOffer(user)
    await user.click(screen.getByRole('button', { name: /Add 2 Brake pads/ }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const accountBody = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    const captureBody = JSON.parse(fetchMock.mock.calls[1][1].body as string)
    expect(accountBody.clientKey).toBe(created.id)
    expect(captureBody.vendorAccountId).toBe(created.id)
    expect(captureBody.clientKey).not.toBe(accountBody.clientKey)
  })

  it('captures the exact normalized offer, refreshes by saved line id, and closes only after refresh succeeds', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn(async () => true)
    const onClose = vi.fn()
    const onBusyChange = vi.fn()
    const lineId = '00000000-0000-4000-8000-000000000401'
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(manualOfferResponse({ lineId })), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    render(<ManualPartSourcing {...props({ onSaved, onClose, onBusyChange })} />)
    await fillRequiredOffer(user)
    await user.click(screen.getByRole('button', { name: /Add 2 Brake pads/ }))

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/tickets/00000000-0000-4000-8000-000000000201/quote/jobs/00000000-0000-4000-8000-000000000301/parts/manual-offers',
      {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({
          clientKey: '00000000-0000-4000-8000-000000000901',
          vendorAccountId: ACCOUNT_ONE.id,
          description: 'Brake pads',
          partNumber: null,
          brand: null,
          quantity: '2',
          priceCents: 24000,
          unitCostCents: 8000,
          coreChargeCents: 0,
          taxable: true,
          availability: 'unknown',
          fitment: null,
          fulfillment: { method: 'unknown', locationLabel: null },
          externalOfferId: null,
        }),
      },
    )
    expect(onBusyChange.mock.calls).toEqual([[true], [false]])
    expect(onSaved).toHaveBeenCalledWith(lineId)
  })

  it('retains retry identity after an ambiguous failure and rotates it after normalized quantity or price edits', async () => {
    const user = userEvent.setup()
    let uuidSequence = 900
    vi.mocked(crypto.randomUUID).mockImplementation(() => (
      `00000000-0000-4000-8000-${String(++uuidSequence).padStart(12, '0')}`
    ))
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('offline'))
    vi.stubGlobal('fetch', fetchMock)
    render(<ManualPartSourcing {...props()} />)
    await fillRequiredOffer(user)
    const commit = screen.getByRole('button', { name: /Add 2 Brake pads/ })
    await user.click(commit)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    await user.click(commit)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const first = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    const second = JSON.parse(fetchMock.mock.calls[1][1].body as string)
    expect(second.clientKey).toBe(first.clientKey)

    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '3' } })
    await user.click(screen.getByRole('button', { name: /Add 3 Brake pads/ }))
    fireEvent.change(screen.getByLabelText('Customer line price'), { target: { value: '250' } })
    await user.click(screen.getByRole('button', { name: /Customer price \$250/ }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))
    const third = JSON.parse(fetchMock.mock.calls[2][1].body as string)
    const fourth = JSON.parse(fetchMock.mock.calls[3][1].body as string)
    expect(third.clientKey).not.toBe(second.clientKey)
    expect(fourth.clientKey).not.toBe(third.clientKey)
  })

  it('keeps the draft when the supplier reports the part unavailable', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      changed: false,
      unavailable: true,
    }), { status: 200, headers: { 'content-type': 'application/json' } })))
    const onSaved = vi.fn(async () => true)
    render(<ManualPartSourcing {...props({ onSaved })} />)
    await fillRequiredOffer(user)
    await user.click(screen.getByRole('button', { name: /Add 2 Brake pads/ }))

    expect(await screen.findByRole('status')).toHaveTextContent('Supplier reports this part unavailable. No quote line was added.')
    expect(screen.getByLabelText('Part description')).toHaveValue('Brake pads')
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('hands off a saved-but-unrefreshed line to a dedicated refresh action without duplicate capture', async () => {
    const user = userEvent.setup()
    const lineId = '00000000-0000-4000-8000-000000000401'
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(manualOfferResponse({ lineId })), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const onSaved = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const onClose = vi.fn()
    render(<ManualPartSourcing {...props({ onSaved, onClose })} />)
    await fillRequiredOffer(user)
    await user.click(screen.getByRole('button', { name: /Add 2 Brake pads/ }))

    expect(await screen.findByRole('status')).toHaveTextContent('Part saved. Refresh the quote to see current totals.')
    expect(screen.queryByRole('button', { name: /Add 2 Brake pads/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Refresh quote' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(onSaved).toHaveBeenNthCalledWith(2, lineId)
  })

  it('keeps strict capture truth when the first refresh rejects and never reposts the saved offer', async () => {
    const user = userEvent.setup()
    const lineId = '00000000-0000-4000-8000-000000000401'
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(manualOfferResponse({ lineId })), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
    const onSaved = vi.fn()
      .mockRejectedValueOnce(new TypeError('refresh interrupted'))
      .mockResolvedValueOnce(true)
    const onClose = vi.fn()
    render(<ManualPartSourcing {...props({ onSaved, onClose })} />)
    await fillRequiredOffer(user)
    await user.click(screen.getByRole('button', { name: /Add 2 Brake pads/ }))

    expect(await screen.findByRole('status')).toHaveTextContent('Part saved. Refresh the quote to see current totals.')
    expect(screen.queryByRole('button', { name: /Add 2 Brake pads/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Refresh quote' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(onSaved).toHaveBeenNthCalledWith(2, lineId)
  })

  it('resets offer lifecycle before close so a controlled reopen is fresh without losing supplier choices', async () => {
    const user = userEvent.setup()
    let uuidSequence = 900
    vi.mocked(crypto.randomUUID).mockImplementation(() => (
      `00000000-0000-4000-8000-${String(++uuidSequence).padStart(12, '0')}`
    ))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(manualOfferResponse({
      vendorAccountId: ACCOUNT_TWO.id,
    })), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    })))
    const onClose = vi.fn()
    const controlledProps = props({ accounts: [ACCOUNT_ONE, ACCOUNT_TWO], onClose })
    const { rerender } = render(<ManualPartSourcing {...controlledProps} />)
    await user.click(screen.getByRole('radio', { name: 'Metro Supply' }))
    await fillRequiredOffer(user)
    await user.click(screen.getByRole('button', { name: /Add 2 Brake pads/ }))
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())

    rerender(<ManualPartSourcing {...controlledProps} open={false} />)
    rerender(<ManualPartSourcing {...controlledProps} open />)

    expect(screen.getByLabelText('Part description')).toHaveValue('')
    expect(screen.getByLabelText('Quantity')).toHaveValue('1')
    expect(screen.getByRole('radio', { name: 'Northside Parts' })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: 'Metro Supply' })).not.toBeChecked()
    expect(screen.queryByRole('button', { name: 'Refresh quote' })).toBeNull()
  })

  it('reports supplier partial success when later capture fails and preserves every offer field', async () => {
    const user = userEvent.setup()
    const created = { ...ACCOUNT_TWO, id: '00000000-0000-4000-8000-000000000901', displayName: 'Metro Supply' }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ changed: true, vendorAccount: created }), {
        status: 201, headers: { 'content-type': 'application/json' },
      }))
      .mockRejectedValueOnce(new TypeError('offline'))
    vi.stubGlobal('fetch', fetchMock)
    render(<ManualPartSourcing {...props({ accounts: [], canCreateVendorAccount: true })} />)
    await fillOfferWithoutSupplier(user)
    await user.click(screen.getByRole('button', { name: 'Add supplier' }))
    await user.type(screen.getByLabelText('Supplier name'), 'Metro Supply')
    await user.click(screen.getByRole('button', { name: 'Save supplier' }))
    await user.click(await screen.findByRole('button', { name: /Add 2 Brake pads/ }))

    expect(await screen.findByRole('status')).toHaveTextContent('Supplier saved. The part was not added yet.')
    expect(screen.getByLabelText('Part description')).toHaveValue('Brake pads')
    expect(screen.getByLabelText('Quantity')).toHaveValue('2')
    expect(screen.getByLabelText('Supplier unit cost')).toHaveValue('80')
    expect(screen.getByLabelText('Customer line price')).toHaveValue('240')
  })

  it.each([
    ['extra response key', () => ({ ...manualOfferResponse({}), secret: 'do-not-render' })],
    ['hostile line id', () => manualOfferResponse({ lineId: '<script>bad</script>' })],
    ['malformed money', () => manualOfferResponse({ priceCents: -1 })],
    ['wrong changed pairing', () => ({ ...manualOfferResponse({}), changed: false })],
    ['supplier id mismatch', () => manualOfferResponse({ vendorAccountId: ACCOUNT_TWO.id })],
    ['supplier name mismatch', () => manualOfferResponse({ displayName: 'Hostile Supply' })],
    ['description mismatch', () => manualOfferResponse({ description: 'Hostile pads' })],
    ['quantity mismatch', () => manualOfferResponse({ quantity: '3' })],
    ['customer price mismatch', () => manualOfferResponse({ priceCents: 24_001 })],
    ['taxable mismatch', () => manualOfferResponse({ taxable: false })],
    ['part number mismatch', () => manualOfferResponse({ partNumber: 'HOSTILE' })],
    ['brand mismatch', () => manualOfferResponse({ brand: 'Hostile' })],
    ['fitment mismatch', () => manualOfferResponse({ fitment: 'Rear' })],
    ['job id mismatch', () => manualOfferResponse({ jobId: '00000000-0000-4000-8000-000000000302' })],
    ['external offer mismatch', () => manualOfferResponse({ externalOfferId: 'HOSTILE' })],
    ['supplier cost mismatch', () => manualOfferResponse({ unitCostCents: 8_001 })],
    ['core charge mismatch', () => manualOfferResponse({ coreChargeCents: 1 })],
    ['availability mismatch', () => manualOfferResponse({ availability: 'in_stock' })],
    ['fulfillment mismatch', () => manualOfferResponse({ fulfillment: { method: 'pickup', locationLabel: null } })],
  ])('fails closed for %s', async (_label, responseBody) => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(responseBody()), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    })))
    const onSaved = vi.fn(async () => true)
    const onClose = vi.fn()
    render(<ManualPartSourcing {...props({ onSaved, onClose })} />)
    await fillRequiredOffer(user)
    await user.click(screen.getByRole('button', { name: /Add 2 Brake pads/ }))

    expect(await screen.findByRole('status')).toHaveTextContent('The saved response could not be verified. Refresh before continuing.')
    expect(onSaved).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(document.body).not.toHaveTextContent('do-not-render')
  })

  it.each([401, 403, 404] as const)('delegates %s access failures without rendering raw server fields', async (status) => {
    const user = userEvent.setup()
    const body = { error: 'secret-internal-error', feedback: 'hostile raw feedback' }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })))
    const onAccessFailure = vi.fn()
    render(<ManualPartSourcing {...props({ onAccessFailure })} />)
    await fillRequiredOffer(user)
    await user.click(screen.getByRole('button', { name: /Add 2 Brake pads/ }))

    await waitFor(() => expect(onAccessFailure).toHaveBeenCalledWith(status, body))
    expect(document.body).not.toHaveTextContent('secret-internal-error')
    expect(document.body).not.toHaveTextContent('hostile raw feedback')
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
    expect(css).toMatch(/\.panel\s*{[^}]*overflow:\s*hidden/s)
    expect(css).toMatch(/\.body\s*{[^}]*overflow-y:\s*auto/s)
    expect(css).toMatch(/@media\s*\(max-width:\s*800px\)/)
    expect(css).toMatch(/inset:\s*0/)
    expect(css).toMatch(/min-height:\s*100dvh/)
    expect(css).toMatch(/env\(safe-area-inset-bottom\)/)
    expect(css).toMatch(/position:\s*sticky/)
    expect(css).toMatch(/min-height:\s*44px/)
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/)
  })
})

async function fillOfferWithoutSupplier(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Part description'), 'Brake pads')
  fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '2' } })
  await user.type(screen.getByLabelText('Supplier unit cost'), '80')
  await user.type(screen.getByLabelText('Customer line price'), '240')
}

async function fillRequiredOffer(user: ReturnType<typeof userEvent.setup>) {
  await fillOfferWithoutSupplier(user)
}

function manualOfferResponse(overrides: {
  lineId?: string
  vendorAccountId?: string
  displayName?: string
  jobId?: string
  description?: string
  quantity?: string
  priceCents?: number
  taxable?: boolean
  partNumber?: string | null
  brand?: string | null
  fitment?: string | null
  externalOfferId?: string | null
  unitCostCents?: number
  coreChargeCents?: number
  availability?: 'in_stock' | 'special_order' | 'unknown'
  fulfillment?: { method: 'pickup' | 'delivery' | 'ship' | 'unknown'; locationLabel: string | null }
} = {}) {
  return {
    changed: true,
    line: {
      id: overrides.lineId ?? '00000000-0000-4000-8000-000000000401',
      jobId: overrides.jobId ?? '00000000-0000-4000-8000-000000000301',
      kind: 'part',
      description: overrides.description ?? 'Brake pads',
      quantity: overrides.quantity ?? '2',
      priceCents: overrides.priceCents ?? 24000,
      taxable: overrides.taxable ?? true,
      partNumber: overrides.partNumber ?? null,
      brand: overrides.brand ?? null,
      fitment: overrides.fitment ?? null,
      source: 'vendor_offer',
      mutable: false,
    },
    sourcing: {
      vendorAccountId: overrides.vendorAccountId ?? ACCOUNT_ONE.id,
      displayName: overrides.displayName
        ?? (overrides.vendorAccountId === ACCOUNT_TWO.id ? ACCOUNT_TWO.displayName : ACCOUNT_ONE.displayName),
      externalOfferId: overrides.externalOfferId ?? null,
      unitCostCents: overrides.unitCostCents ?? 8000,
      coreChargeCents: overrides.coreChargeCents ?? 0,
      availability: overrides.availability ?? 'unknown',
      fulfillment: overrides.fulfillment ?? { method: 'unknown', locationLabel: null },
      fetchedAt: '2026-07-12T12:00:00.000Z',
    },
  }
}
