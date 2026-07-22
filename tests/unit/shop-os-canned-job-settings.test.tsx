import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CannedJobsSection } from '@/components/vt/canned-jobs-section'
import type { CannedJobProjection } from '@/lib/shop-os/canned-jobs-ui'

const { auth, access, getShop, list, listVendors, notFound } = vi.hoisted(() => ({ auth: vi.fn(), access: vi.fn(), getShop: vi.fn(), list: vi.fn(), listVendors: vi.fn(), notFound: vi.fn(() => { throw new Error('not-found') }) }))
vi.mock('next/navigation', () => ({ redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`) }), notFound, useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@/lib/supabase-server', () => ({ getServerSupabase: vi.fn(async () => ({})) }))
vi.mock('@/lib/auth', () => ({ requireUserAndProfile: auth, isFounder: (email: string) => email === 'founder@test.dev' }))
vi.mock('@/lib/auth-access', () => ({ checkAccess: access }))
vi.mock('@/lib/db/queries', () => ({ getShopById: getShop }))
vi.mock('@/lib/shop-os/canned-jobs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/shop-os/canned-jobs')>()
  return { ...actual, listCannedJobs: list }
})
vi.mock('@/lib/shop-os/parts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/shop-os/parts')>()
  return { ...actual, listVendorAccounts: listVendors }
})

import SettingsShopPage from '@/app/(app)/settings/shop/page'

const job: CannedJobProjection = {
  id: '00000000-0000-4000-8000-000000000001', title: 'Brake service', kind: 'repair', defaultRequiredSkillTier: 2,
  sort: 10, fingerprint: 'a'.repeat(64), lines: [{ kind: 'fee', description: 'Shop supplies', sort: 0, priceCents: 500, taxable: true }],
  summary: { subtotalCents: 500, taxableSubtotalCents: 500, taxCents: 40, totalCents: 540 },
}

function success(changed = true, cannedJob = job) { return new Response(JSON.stringify({ changed, cannedJob }), { status: changed ? 201 : 200, headers: { 'content-type': 'application/json' } }) }

describe('protected canned job settings page', () => {
  beforeEach(() => {
    vi.clearAllMocks(); access.mockResolvedValue({ kind: 'allow', entitlements: { diagnostics: false } }); getShop.mockResolvedValue({ id: 'shop-1', name: 'Honest Auto' }); list.mockResolvedValue({ ok: true, cannedJobs: [job], taxRateBps: 800 }); listVendors.mockResolvedValue({ ok: true, vendorAccounts: [] })
  })

  it.each([{ role: 'owner', email: 'owner@test.dev' }, { role: 'tech', email: 'founder@test.dev' }])('loads persisted library for $role founder/owner authority', async ({ role, email }) => {
    auth.mockResolvedValue({ user: { id: 'user-1', email }, profile: { id: 'profile-1', role, shopId: 'shop-1' } })
    render(await SettingsShopPage())
    expect(screen.getByText('Brake service')).toBeInTheDocument()
    expect(list).toHaveBeenCalledWith({}, { actor: expect.objectContaining({ profileId: 'profile-1', ...(email.startsWith('founder') ? { founderOverride: true } : {}) }) })
  })

  it('denies unsupported roles before reading the library', async () => {
    auth.mockResolvedValue({ user: { id: 'user-2', email: 'tech@test.dev' }, profile: { id: 'profile-2', role: 'tech', shopId: 'shop-1' } })
    await expect(SettingsShopPage()).rejects.toThrow('not-found')
    expect(list).not.toHaveBeenCalled()
  })

  it.each([
    [{ kind: 'deactivated' }, '/deactivated'],
    [{ kind: 'paywall', reason: 'unpaid' }, '/subscribe'],
  ] as const)('redirects denied owners before reading shop data', async (result, destination) => {
    auth.mockResolvedValue({
      user: { id: 'user-1', email: 'owner@test.dev' },
      profile: { id: 'profile-1', role: 'owner', shopId: 'shop-1' },
    })
    access.mockResolvedValue(result)

    await expect(SettingsShopPage()).rejects.toThrow(`redirect:${destination}`)
    expect(getShop).not.toHaveBeenCalled()
    expect(list).not.toHaveBeenCalled()
    expect(listVendors).not.toHaveBeenCalled()
  })
})

describe('CannedJobsSection', () => {
  beforeEach(() => {
    let sequence = 10
    vi.stubGlobal('fetch', vi.fn())
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => `00000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`)
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('offers diagnostic authorization in the existing work-type control', async () => {
    render(<CannedJobsSection initialJobs={[]} initialTaxRateBps={800} />)
    await userEvent.click(screen.getByRole('button', { name: 'New canned job' }))
    expect(screen.getByRole('option', { name: 'Diagnostic' })).toBeInTheDocument()
  })

  it('keeps one create key across a network retry and rotates when normalized input changes', async () => {
    const fetchMock = vi.mocked(fetch)
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ changed: true, cannedJob: job }), { status: 201 }))
    render(<CannedJobsSection initialJobs={[]} initialTaxRateBps={800} />)
    await userEvent.click(screen.getByRole('button', { name: 'New canned job' }))
    await userEvent.type(screen.getByLabelText('Title'), 'Brake service')
    await userEvent.type(screen.getByLabelText('Line 1 description'), 'Shop supplies')
    await userEvent.type(screen.getByLabelText('Line 1 customer price'), '5.00')
    await userEvent.click(screen.getByRole('button', { name: 'Save canned job' }))
    await userEvent.type(screen.getByLabelText('Title'), ' plus')
    await userEvent.click(screen.getByRole('button', { name: 'Save canned job' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save canned job' }))
    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)))
    expect(bodies[0].clientKey).not.toBe(bodies[1].clientKey)
    expect(bodies[1].clientKey).toBe(bodies[2].clientKey)
    expect(await screen.findByText('Canned job saved.')).toBeInTheDocument()
  })

  it('sends exact fingerprint for replacement and retirement', async () => {
    const fetchMock = vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ changed: true, cannedJob: job }), { status: 200 }))
    render(<CannedJobsSection initialJobs={[job]} initialTaxRateBps={800} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await userEvent.clear(screen.getByLabelText('Title')); await userEvent.type(screen.getByLabelText('Title'), 'Updated brakes')
    await userEvent.click(screen.getByRole('button', { name: 'Save canned job' }))
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).expectedFingerprint).toBe(job.fingerprint)

    render(<CannedJobsSection initialJobs={[job]} initialTaxRateBps={800} />)
    await userEvent.click(screen.getAllByRole('button', { name: 'Retire' }).at(-1)!)
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await userEvent.click(screen.getByRole('button', { name: 'Retire canned job' }))
    expect(JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body)).expectedFingerprint).toBe(job.fingerprint)
  })

  it('requires explicit discard for dirty switching and supports Escape focus return', async () => {
    render(<CannedJobsSection initialJobs={[job]} initialTaxRateBps={800} />)
    const edit = screen.getByRole('button', { name: 'Edit' }); await userEvent.click(edit)
    await userEvent.type(screen.getByLabelText('Title'), ' changed')
    const close = screen.getByRole('button', { name: 'Close' }); await userEvent.click(close)
    expect(screen.getByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' })
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveFocus())
    expect(screen.getByLabelText(/Edit Brake service/)).toBeInTheDocument()
  })

  it('returns retirement cancel and Escape to the Retire launcher', async () => {
    render(<CannedJobsSection initialJobs={[job]} initialTaxRateBps={800} />)
    const retire = screen.getByRole('button', { name: 'Retire' })
    await userEvent.click(retire)
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(retire).toHaveFocus())

    await userEvent.click(retire)
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' })
    await waitFor(() => expect(retire).toHaveFocus())
  })

  it('moves focus to the surviving target after confirming discard', async () => {
    render(<CannedJobsSection initialJobs={[job]} initialTaxRateBps={800} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await userEvent.type(screen.getByLabelText('Title'), ' changed')
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'New canned job' })).toHaveFocus())

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await userEvent.type(screen.getByLabelText('Title'), ' changed')
    await userEvent.click(screen.getByRole('button', { name: 'New canned job' }))
    await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveFocus())
    expect(screen.getByLabelText('Title')).toHaveValue('')
  })

  it('refreshes a stale editor fingerprint without losing its draft before retry', async () => {
    const refreshed = { ...job, fingerprint: 'b'.repeat(64) }
    const fetchMock = vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'conflict' }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ cannedJobs: [refreshed], taxRateBps: 800 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ changed: true, cannedJob: refreshed }), { status: 200 }))
    render(<CannedJobsSection initialJobs={[job]} initialTaxRateBps={800} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await userEvent.clear(screen.getByLabelText('Title')); await userEvent.type(screen.getByLabelText('Title'), 'Updated brakes')
    await userEvent.click(screen.getByRole('button', { name: 'Save canned job' }))
    expect(await screen.findByText(/library changed.*refresh/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(screen.getByLabelText('Title')).toHaveValue('Updated brakes')
    await userEvent.click(screen.getByRole('button', { name: 'Save canned job' }))
    const putBodies = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT').map(([, init]) => JSON.parse(String(init?.body)))
    expect(putBodies.map((body) => body.expectedFingerprint)).toEqual([job.fingerprint, refreshed.fingerprint])
  })

  it('acquires refresh, save, and retire operations synchronously', async () => {
    let release!: (response: Response) => void
    const pending = new Promise<Response>((resolve) => { release = resolve })
    const fetchMock = vi.mocked(fetch).mockReturnValue(pending)
    const { unmount } = render(<CannedJobsSection initialJobs={[job]} initialTaxRateBps={800} />)
    const refresh = screen.getByRole('button', { name: 'Refresh' })
    fireEvent.click(refresh); fireEvent.click(refresh)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    release(new Response(JSON.stringify({ cannedJobs: [job], taxRateBps: 800 }), { status: 200 }))
    await screen.findByText('Library refreshed.')
    unmount()

    let releaseSave!: (response: Response) => void
    const pendingSave = new Promise<Response>((resolve) => { releaseSave = resolve })
    fetchMock.mockClear().mockReturnValue(pendingSave)
    const saveView = render(<CannedJobsSection initialJobs={[job]} initialTaxRateBps={800} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await userEvent.clear(screen.getByLabelText('Title')); await userEvent.type(screen.getByLabelText('Title'), 'Changed')
    const save = screen.getByRole('button', { name: 'Save canned job' })
    fireEvent.click(save); fireEvent.click(save)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    releaseSave(new Response(JSON.stringify({ changed: true, cannedJob: job }), { status: 200 }))
    await screen.findByText('Canned job saved.')
    saveView.unmount()

    let releaseRetire!: (response: Response) => void
    const pendingRetire = new Promise<Response>((resolve) => { releaseRetire = resolve })
    fetchMock.mockClear().mockReturnValue(pendingRetire)
    render(<CannedJobsSection initialJobs={[job]} initialTaxRateBps={800} />)
    await userEvent.click(screen.getByRole('button', { name: 'Retire' }))
    const confirm = screen.getByRole('button', { name: 'Retire canned job' })
    fireEvent.click(confirm); fireEvent.click(confirm)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    releaseRetire(new Response(JSON.stringify({ changed: true, cannedJob: job }), { status: 200 }))
    await screen.findByText(/Canned job retired/i)
  })

  it('gives repeated line controls indexed accessible names', async () => {
    render(<CannedJobsSection initialJobs={[]} initialTaxRateBps={800} />)
    await userEvent.click(screen.getByRole('button', { name: 'New canned job' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add line' }))
    expect(screen.getByRole('group', { name: /Line 1: part/i })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /Line 2: part/i })).toBeInTheDocument()
    expect(screen.getByLabelText('Line 1 description')).toBeInTheDocument()
    expect(screen.getByLabelText('Line 2 description')).toBeInTheDocument()
  })

  it('keeps malformed, stale, and network failures honest without optimistic removal', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ changed: true, cannedJob: { ...job, hidden: true } }), { status: 200 }))
    render(<CannedJobsSection initialJobs={[job]} initialTaxRateBps={800} />)
    await userEvent.click(screen.getByRole('button', { name: 'Retire' })); await userEvent.click(screen.getByRole('button', { name: 'Retire canned job' }))
    expect(await screen.findByText(/response was incomplete/i)).toBeInTheDocument()
    expect(screen.getByText('Brake service')).toBeInTheDocument()
  })

  it('ships mobile, safe-area, focus, reduced-motion, 44px and forbidden-copy guardrails', () => {
    const css = readFileSync(resolve(process.cwd(), 'components/vt/canned-jobs-section.module.css'), 'utf8')
    const source = readFileSync(resolve(process.cwd(), 'components/vt/canned-jobs-section.tsx'), 'utf8')
    expect(css).toMatch(/@media \(max-width: 520px\)/)
    expect(css).toMatch(/safe-area-inset-bottom/)
    expect(css).toMatch(/min-height: 44px/)
    expect(css).toMatch(/:focus-visible/)
    expect(css).toMatch(/prefers-reduced-motion/)
    expect(source).toMatch(/inputMode="decimal"/)
    expect(source).not.toMatch(/unit cost|core charge|vendor|send quote|approve|authorized|start work/i)
  })
})
