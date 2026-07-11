import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ManualQuoteBuilder } from '@/components/screens/manual-quote-builder'
import type { QuoteBuilderResult } from '@/lib/shop-os/quotes'

vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={String(href)} {...props}>{children}</a> }))
const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }
vi.mock('next/navigation', () => ({ useRouter: () => router }))

type Builder = Extract<QuoteBuilderResult, { ok: true }>['builder']
const TICKET = '00000000-0000-4000-8000-000000000101'
const JOB = '00000000-0000-4000-8000-000000000201'
const EVENT = '00000000-0000-4000-8000-000000000301'
const ticket = { id: TICKET, ticketNumber: 42, customer: { name: 'Marisol Vega' }, vehicle: { year: 2019, make: 'Ford', model: 'F-150' } }
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
})
