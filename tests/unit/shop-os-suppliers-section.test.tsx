import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SuppliersSection, type SupplierAccount } from '@/components/vt/suppliers-section'

function account(over: Partial<SupplierAccount> = {}): SupplierAccount {
  return {
    id: '00000000-0000-4000-8000-00000000000a',
    displayName: "O'Reilly First Call",
    mode: 'manual',
    enabled: true,
    updatedAt: '2026-07-18T12:00:00.000Z',
    ...over,
  }
}

function mutationResponse(vendorAccount: SupplierAccount, changed: boolean, status: number) {
  return new Response(JSON.stringify({ changed, vendorAccount }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('SuppliersSection', () => {
  beforeEach(() => {
    let sequence = 10
    vi.stubGlobal('fetch', vi.fn())
    vi.spyOn(crypto, 'randomUUID').mockImplementation(
      () => `00000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}` as `${string}-${string}-${string}-${string}-${string}`,
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders the shop supplier list with off suppliers marked, and an honest empty state', () => {
    const { unmount } = render(
      <SuppliersSection
        initialAccounts={[
          account({ id: '00000000-0000-4000-8000-00000000000b', displayName: 'Tri-State Auto', enabled: false }),
          account(),
        ]}
      />,
    )
    expect(screen.getByText("O'Reilly First Call")).toBeInTheDocument()
    expect(screen.getByText('Tri-State Auto')).toBeInTheDocument()
    expect(screen.getByText('off')).toBeInTheDocument()
    expect(screen.getByText('1 on')).toBeInTheDocument()
    unmount()

    render(<SuppliersSection initialAccounts={[]} />)
    expect(screen.getByText(/No suppliers yet/)).toBeInTheDocument()
  })

  it('adds a supplier with a client key and shows it in the list', async () => {
    const created = account({ id: '00000000-0000-4000-8000-000000000010', displayName: '4M Auto Warehouse' })
    const fetchMock = vi.mocked(fetch).mockResolvedValueOnce(mutationResponse(created, true, 201))

    render(<SuppliersSection initialAccounts={[]} />)
    await userEvent.type(screen.getByLabelText('Add a supplier'), '4M Auto Warehouse')
    await userEvent.click(screen.getByRole('button', { name: 'Add supplier' }))

    expect(fetchMock).toHaveBeenCalledWith('/api/shop/vendor-accounts', expect.objectContaining({ method: 'POST' }))
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body).toEqual({
      clientKey: '00000000-0000-4000-8000-000000000010',
      displayName: '4M Auto Warehouse',
    })
    expect(await screen.findByText('Supplier added.')).toBeInTheDocument()
    expect(screen.getByText('4M Auto Warehouse')).toBeInTheDocument()
  })

  it('keeps one create key across a network retry and rotates it when the name changes', async () => {
    const created = account({ id: '00000000-0000-4000-8000-000000000010', displayName: 'NAPA plus' })
    const fetchMock = vi.mocked(fetch)
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(mutationResponse(created, true, 201))

    render(<SuppliersSection initialAccounts={[]} />)
    const field = screen.getByLabelText('Add a supplier')
    await userEvent.type(field, 'NAPA')
    await userEvent.click(screen.getByRole('button', { name: 'Add supplier' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add supplier' }))
    await userEvent.type(field, ' plus')
    await userEvent.click(screen.getByRole('button', { name: 'Add supplier' }))

    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)))
    expect(bodies[0].clientKey).toBe(bodies[1].clientKey)
    expect(bodies[2].clientKey).not.toBe(bodies[0].clientKey)
    expect(await screen.findByText('Supplier added.')).toBeInTheDocument()
  })

  it('turns a supplier off with the exact concurrency token and flips the row', async () => {
    const initial = account()
    const updated = { ...initial, enabled: false, updatedAt: '2026-07-18T12:05:00.000Z' }
    const fetchMock = vi.mocked(fetch).mockResolvedValueOnce(mutationResponse(updated, true, 200))

    render(<SuppliersSection initialAccounts={[initial]} />)
    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }))

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/shop/vendor-accounts/${initial.id}`,
      expect.objectContaining({ method: 'PATCH' }),
    )
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      displayName: "O'Reilly First Call",
      enabled: false,
      expectedUpdatedAt: '2026-07-18T12:00:00.000Z',
    })
    expect(await screen.findByText('Supplier turned off.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeInTheDocument()
    expect(screen.getByText('off')).toBeInTheDocument()
    expect(screen.getByText('0 on')).toBeInTheDocument()
  })

  it('renames a supplier without touching its enabled state', async () => {
    const initial = account()
    const updated = { ...initial, displayName: "O'Reilly", updatedAt: '2026-07-18T12:05:00.000Z' }
    const fetchMock = vi.mocked(fetch).mockResolvedValueOnce(mutationResponse(updated, true, 200))

    render(<SuppliersSection initialAccounts={[initial]} />)
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }))
    const field = screen.getByLabelText("Rename O'Reilly First Call")
    await userEvent.clear(field)
    await userEvent.type(field, "O'Reilly")
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      displayName: "O'Reilly",
      enabled: true,
      expectedUpdatedAt: '2026-07-18T12:00:00.000Z',
    })
    expect(await screen.findByText('Supplier renamed.')).toBeInTheDocument()
    expect(screen.getByText("O'Reilly")).toBeInTheDocument()
    expect(screen.queryByText("O'Reilly First Call")).not.toBeInTheDocument()
  })

  it('reports a same-window conflict plainly and leaves the row unchanged', async () => {
    const initial = account()
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'conflict' }), { status: 409 }),
    )

    render(<SuppliersSection initialAccounts={[initial]} />)
    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }))

    expect(
      await screen.findByText('This supplier changed in another window. Refresh the page and try again.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Turn off' })).toBeInTheDocument()
    expect(screen.getByText('1 on')).toBeInTheDocument()
  })
})
