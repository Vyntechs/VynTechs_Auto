import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ManualQuoteBuilder } from '@/components/screens/manual-quote-builder'
import type { QuoteBuilderResult } from '@/lib/shop-os/quotes'

vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={String(href)} {...props}>{children}</a> }))
const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }
vi.mock('next/navigation', () => ({ useRouter: () => router }))

type Builder = Extract<QuoteBuilderResult, { ok: true }>['builder']
const TICKET = '00000000-0000-4000-8000-000000000101'
const JOB = '00000000-0000-4000-8000-000000000201'
const EVENT = '00000000-0000-4000-8000-000000000301'
const ticket = { id: TICKET, ticketNumber: 42, concern: 'Battery warning appears while driving.', customer: { name: 'Marisol Vega' }, vehicle: { year: 2019, make: 'Ford', model: 'F-150' } }
const story = {
  whatYouToldUs: 'Battery warning appears while driving.',
  whatWeFound: 'Alternator output is below specification.',
  howWeKnow: [{ claim: 'Charging voltage dropped under load.', sourceEventIds: [EVENT], sourceArtifactIds: [] }],
  whatItMeansIfWaived: 'The vehicle may remain unreliable.',
  whatWeRecommend: 'Replace the alternator and verify output.',
}

function builder(mode: Builder['jobs'][number]['storyMode'], storyValue: Builder['jobs'][number]['story'] = { content: null, source: null, reviewStatus: null, revision: 0 }): Builder {
  return {
    ticket: { id: TICKET, status: 'open', reconciled: true },
    configuration: { laborRateCents: 12000, taxRateBps: 825, laborRateConfigured: true, taxRateConfigured: true },
    jobs: [{
      id: JOB, title: 'Charging system diagnosis', kind: 'diagnostic', workStatus: 'open',
      story: storyValue, storyMode: mode,
      decisionEligible: false,
      approval: { state: 'pending_quote', quoteVersionId: null }, lines: [],
    }],
    capabilities: { canRecordCustomerApproval: true }, activeVersion: null,
  }
}

describe('Shop OS diagnostic story UI', () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.stubGlobal('crypto', { randomUUID: vi.fn(() => '00000000-0000-4000-8000-000000000901') }) })

  it('lazy-loads ordinary-tree evidence, generates, and reviews only editable narrative', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({
        story: null, storyMeta: null, storyRevision: 0,
        evidence: { events: [{ id: EVENT, kind: 'observation', createdAt: '2026-07-11T12:00:00.000Z', label: 'Charging voltage dropped to 11.4V.' }], artifacts: [], nextEventCursor: null, nextArtifactCursor: null },
      }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({
        changed: true, story,
        storyMeta: { source: 'ai', sessionId: '00000000-0000-4000-8000-000000000801', generatedAt: '2026-07-11T12:00:00.000Z', lastEditedAt: '2026-07-11T12:01:00.000Z', reviewStatus: 'pending', storyRevision: 1 },
        storyRevision: 1,
      }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({
        changed: true, story: { ...story, whatWeFound: 'Alternator failed the load test.' },
        storyMeta: { source: 'ai', sessionId: '00000000-0000-4000-8000-000000000801', generatedAt: '2026-07-11T12:00:00.000Z', lastEditedAt: '2026-07-11T12:02:00.000Z', reviewStatus: 'reviewed', storyRevision: 2, reviewedAt: '2026-07-11T12:02:00.000Z' },
        storyRevision: 2,
      }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ builder: builder('ordinary_locked_tree', { content: { ...story, whatWeFound: 'Alternator failed the load test.' }, source: 'ai', reviewStatus: 'reviewed', revision: 2 }) }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<ManualQuoteBuilder ticket={ticket} builder={builder('ordinary_locked_tree')} />)

    expect(fetchMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Open diagnostic story' }))
    expect(await screen.findByText('Charging voltage dropped to 11.4V.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: /Charging voltage/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Generate customer story' }))
    const card = await screen.findByRole('region', { name: 'Diagnostic story for Charging system diagnosis' })
    expect(within(card).getByText('Pending human review')).toBeInTheDocument()
    expect(within(card).getByText('Battery warning appears while driving.')).toBeInTheDocument()
    expect(within(card).getByText('The vehicle may remain unreliable.')).toBeInTheDocument()
    expect(within(card).getByText('Charging voltage dropped under load.')).toBeInTheDocument()
    fireEvent.change(within(card).getByLabelText('What we found'), { target: { value: 'Alternator failed the load test.' } })
    fireEvent.click(within(card).getByRole('button', { name: 'Save reviewed story' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({
      clientKey: '00000000-0000-4000-8000-000000000901', expectedStoryRevision: 1,
      whatWeFound: 'Alternator failed the load test.', whatWeRecommend: story.whatWeRecommend,
    })
  })

  it('renders topology as honest manual story and published wizard as unsupported', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { rerender } = render(<ManualQuoteBuilder ticket={ticket} builder={builder('topology_manual')} />)
    expect(screen.getByText('Human-authored topology story')).toBeInTheDocument()
    expect(screen.getByLabelText('What we found')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Generate customer story/ })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()

    rerender(<ManualQuoteBuilder ticket={ticket} builder={builder('published_wizard_unsupported')} />)
    expect(screen.getByText('Published-wizard stories are not supported yet.')).toBeInTheDocument()
    expect(screen.queryByLabelText('What we found')).toBeNull()
  })

  it('blocks preparation for pending or unavailable diagnostic truth without inventing an action', () => {
    const pending = builder('ordinary_locked_tree', { content: story, source: 'ai', reviewStatus: 'pending', revision: 1 })
    pending.jobs[0].lines = [{ id: '00000000-0000-4000-8000-000000000701', kind: 'fee', description: 'Diagnosis', sort: 0, quantity: '1', priceCents: 10000, taxable: false, partNumber: null, brand: null, coreChargeCents: null, fitment: null, laborHours: null, laborRateCents: null }]
    const { rerender } = render(<ManualQuoteBuilder ticket={ticket} builder={pending} />)
    expect(screen.getByText('Review every diagnostic story.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Prepare quote' })).toBeDisabled()

    rerender(<ManualQuoteBuilder ticket={ticket} builder={builder('unavailable')} />)
    expect(screen.getByText('Finish and lock this diagnosis before preparing its customer story.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Generate customer story|Save reviewed story/ })).toBeNull()
  })

  it('does not block a priced repair for an unpriced diagnostic story', () => {
    const mixed = builder('unavailable')
    mixed.jobs.unshift({ id: '00000000-0000-4000-8000-000000000202', title: 'Replace battery', kind: 'repair', workStatus: 'open', story: { content: null, source: null, reviewStatus: null, revision: 0 }, storyMode: null, decisionEligible: false, approval: { state: 'pending_quote', quoteVersionId: null }, lines: [{ id: '00000000-0000-4000-8000-000000000702', kind: 'fee', description: 'Battery replacement', sort: 0, quantity: '1', priceCents: 20000, taxable: false, partNumber: null, brand: null, coreChargeCents: null, fitment: null, laborHours: null, laborRateCents: null }] })
    render(<ManualQuoteBuilder ticket={ticket} builder={mixed} />)
    expect(screen.getByRole('button', { name: 'Prepare quote' })).toBeEnabled()
    expect(screen.queryByText('Review every diagnostic story.')).toBeNull()
  })

  it('allows a short locked-fact story with no selected proof', async () => {
    const noProofStory = { ...story, howWeKnow: [] }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ story: null, storyMeta: null, storyRevision: 0, evidence: { events: [], artifacts: [], nextEventCursor: null, nextArtifactCursor: null } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ changed: true, story: noProofStory, storyMeta: { source: 'ai', sessionId: '00000000-0000-4000-8000-000000000801', generatedAt: '2026-07-11T12:00:00.000Z', lastEditedAt: '2026-07-11T12:01:00.000Z', reviewStatus: 'pending', storyRevision: 1 }, storyRevision: 1 }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<ManualQuoteBuilder ticket={ticket} builder={builder('ordinary_locked_tree')} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open diagnostic story' }))
    expect(await screen.findByText('No proof selected. The short story will use locked diagnosis facts only.')).toBeInTheDocument()
    const generateButton = screen.getByRole('button', { name: 'Generate customer story' })
    expect(generateButton).toBeEnabled()
    fireEvent.click(generateButton)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({ sourceEventIds: [], sourceArtifactIds: [] })
  })

  it('caps each evidence type at twenty and announces the bounded selection', async () => {
    const items = Array.from({ length: 21 }, (_, index) => ({ id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, kind: 'observation', createdAt: '2026-07-11T12:00:00.000Z', label: `Observation ${index + 1}` }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ story: null, storyMeta: null, storyRevision: 0, evidence: { events: items, artifacts: [], nextEventCursor: null, nextArtifactCursor: null } }) }))
    render(<ManualQuoteBuilder ticket={ticket} builder={builder('ordinary_locked_tree')} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open diagnostic story' }))
    await screen.findByText('Observation 21')
    const checks = screen.getAllByRole('checkbox')
    checks.slice(0, 20).forEach((check) => fireEvent.click(check))
    expect(screen.getByRole('status', { name: 'Evidence selection' })).toHaveTextContent('Events selected · 20 of 20')
    expect(checks[20]).toBeDisabled()
    expect(checks[0]).toBeEnabled()
    fireEvent.click(checks[0])
    expect(checks[20]).toBeEnabled()
  })

  it('rebases stale server-owned truth while preserving the edited draft and retry identity', async () => {
    const changedStory = { ...story, whatYouToldUs: 'Updated concern from the ticket.', howWeKnow: [{ claim: 'New server proof.', sourceEventIds: [EVENT], sourceArtifactIds: [] }] }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ story, storyMeta: { source: 'ai', sessionId: '00000000-0000-4000-8000-000000000801', generatedAt: '2026-07-11T12:00:00.000Z', lastEditedByProfileId: '00000000-0000-4000-8000-000000000901', lastEditedAt: '2026-07-11T12:01:00.000Z', reviewStatus: 'pending' }, storyRevision: 1, evidence: { events: [], artifacts: [], nextEventCursor: null, nextArtifactCursor: null } }) })
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: 'conflict' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ story: changedStory, storyMeta: { source: 'ai', sessionId: '00000000-0000-4000-8000-000000000801', generatedAt: '2026-07-11T12:00:00.000Z', lastEditedByProfileId: '00000000-0000-4000-8000-000000000902', lastEditedAt: '2026-07-11T12:02:00.000Z', reviewStatus: 'pending' }, storyRevision: 2, evidence: { events: [], artifacts: [], nextEventCursor: null, nextArtifactCursor: null } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ changed: true, story: { ...changedStory, whatWeFound: 'My preserved draft.' }, storyMeta: { source: 'ai', sessionId: '00000000-0000-4000-8000-000000000801', generatedAt: '2026-07-11T12:00:00.000Z', lastEditedAt: '2026-07-11T12:03:00.000Z', reviewStatus: 'reviewed', storyRevision: 3, reviewedAt: '2026-07-11T12:03:00.000Z' }, storyRevision: 3 }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ builder: builder('ordinary_locked_tree', { content: { ...changedStory, whatWeFound: 'My preserved draft.' }, source: 'ai', reviewStatus: 'reviewed', revision: 3 }) }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<ManualQuoteBuilder ticket={ticket} builder={builder('ordinary_locked_tree', { content: story, source: 'ai', reviewStatus: 'pending', revision: 1 })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open diagnostic story' }))
    const found = await screen.findByLabelText('What we found')
    fireEvent.change(found, { target: { value: 'My preserved draft.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save reviewed story' }))
    expect(await screen.findByText('Story refreshed. Your draft is preserved; review current proof and retry.')).toBeInTheDocument()
    expect(found).toHaveValue('My preserved draft.')
    expect(screen.getByText('Updated concern from the ticket.')).toBeInTheDocument()
    expect(screen.getByText('New server proof.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save reviewed story' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5))
    const firstKey = JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).clientKey
    const retryBody = JSON.parse(String(fetchMock.mock.calls[3][1]?.body))
    expect(retryBody).toMatchObject({ clientKey: firstKey, expectedStoryRevision: 2, whatWeFound: 'My preserved draft.' })
  })

  it('rebases a generation conflict, keeps valid selection, and rotates only the conflicted identity', async () => {
    vi.mocked(crypto.randomUUID)
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000911')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000912')
    const workspace = (revision: number) => ({ story: null, storyMeta: null, storyRevision: revision, evidence: { events: [{ id: EVENT, kind: 'observation', createdAt: '2026-07-11T12:00:00.000Z', label: 'Charging voltage dropped to 11.4V.' }], artifacts: [], nextEventCursor: null, nextArtifactCursor: null } })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => workspace(0) })
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: 'conflict' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => workspace(1) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ changed: true, story: { ...story, howWeKnow: [] }, storyMeta: { source: 'ai', sessionId: '00000000-0000-4000-8000-000000000801', generatedAt: '2026-07-11T12:00:00.000Z', lastEditedAt: '2026-07-11T12:01:00.000Z', reviewStatus: 'pending', storyRevision: 2 }, storyRevision: 2 }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<ManualQuoteBuilder ticket={ticket} builder={builder('ordinary_locked_tree')} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open diagnostic story' }))
    const selected = await screen.findByRole('checkbox', { name: /Charging voltage/ })
    fireEvent.click(selected)
    fireEvent.click(screen.getByRole('button', { name: 'Generate customer story' }))
    expect(await screen.findByText('Story refreshed. Your selected proof is preserved; retry generation.')).toBeInTheDocument()
    expect(selected).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Generate customer story' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))
    const first = JSON.parse(String(fetchMock.mock.calls[1][1]?.body))
    const retry = JSON.parse(String(fetchMock.mock.calls[3][1]?.body))
    expect(first).toMatchObject({ clientKey: '00000000-0000-4000-8000-000000000911', expectedStoryRevision: 0, sourceEventIds: [EVENT] })
    expect(retry).toMatchObject({ clientKey: '00000000-0000-4000-8000-000000000912', expectedStoryRevision: 1, sourceEventIds: [EVENT] })
  })

  it('retains generation identity after an ambiguous network failure', async () => {
    vi.mocked(crypto.randomUUID).mockReturnValue('00000000-0000-4000-8000-000000000921')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ story: null, storyMeta: null, storyRevision: 0, evidence: { events: [], artifacts: [], nextEventCursor: null, nextArtifactCursor: null } }) })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ changed: true, story: { ...story, howWeKnow: [] }, storyMeta: { source: 'ai', sessionId: '00000000-0000-4000-8000-000000000801', generatedAt: '2026-07-11T12:00:00.000Z', lastEditedAt: '2026-07-11T12:01:00.000Z', reviewStatus: 'pending', storyRevision: 1 }, storyRevision: 1 }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<ManualQuoteBuilder ticket={ticket} builder={builder('ordinary_locked_tree')} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open diagnostic story' }))
    const generate = await screen.findByRole('button', { name: 'Generate customer story' })
    fireEvent.click(generate)
    await screen.findByText('Connection interrupted. Retry with the same evidence.')
    fireEvent.click(generate)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).clientKey).toBe('00000000-0000-4000-8000-000000000921')
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body)).clientKey).toBe('00000000-0000-4000-8000-000000000921')
  })

  it('shows exact concern and neutral waiver before deliberate first topology review', () => {
    render(<ManualQuoteBuilder ticket={ticket} builder={builder('topology_manual')} />)
    expect(screen.getByText(ticket.concern)).toBeInTheDocument()
    expect(screen.getByText('If you choose not to proceed, the diagnosed issue remains unresolved.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Review and save story' })).toBeInTheDocument()
  })

  it('declares story-editor mobile overlay demotion', () => {
    const css = readFileSync(resolve(process.cwd(), 'components/screens/manual-quote-builder.module.css'), 'utf8')
    expect(css).toMatch(/\.workspace:has\(\.storyEditor:focus-within\) \.prepareAction/)
  })
})
