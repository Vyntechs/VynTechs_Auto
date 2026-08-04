import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TicketCorrectionWorkspace } from '@/components/screens/ticket-correction-workspace'
import {
  encodeTicketCorrectionDraft,
  prepareTicketCorrectionRequest,
  ticketCorrectionDraftKey,
} from '@/lib/shop-os/ticket-correction-draft'
import type { TicketDetail } from '@/lib/tickets'

const IDS = {
  actor: '00000000-0000-4000-8000-000000000100',
  ticket: '00000000-0000-4000-8000-000000000101',
  customer: '00000000-0000-4000-8000-000000000102',
  vehicle: '00000000-0000-4000-8000-000000000103',
  job: '00000000-0000-4000-8000-000000000104',
  secondJob: '00000000-0000-4000-8000-000000000105',
  version: '00000000-0000-4000-8000-000000000106',
  requestOne: '00000000-0000-4000-8000-000000000107',
  requestTwo: '00000000-0000-4000-8000-000000000108',
} as const

const INITIAL_TIME = '2026-08-03T14:00:00.000Z'
const CURRENT_TIME = '2026-08-03T14:05:00.000Z'

function rawJob(overrides: Record<string, unknown> = {}) {
  return {
    id: IDS.job, title: 'Diagnose brake vibration', kind: 'diagnostic',
    requiredSkillTier: 3, assignedTechId: null, assignedTech: null, sessionId: null,
    workStatus: 'open', approvalState: 'quote_ready', customerSuppliedPartsNote: null,
    workNotes: null, diagnosticStartState: 'idle', diagnosticStartErrorCode: null,
    createdAt: INITIAL_TIME, updatedAt: INITIAL_TIME,
    ...overrides,
  }
}

function rawTicket(overrides: Record<string, unknown> = {}) {
  return {
    id: IDS.ticket, ticketNumber: 81, source: 'counter', status: 'open',
    concern: 'Steering wheel shakes under braking.', whenStarted: null, howOften: null,
    diagnosticAuthorizedCents: null, diagnosticAuthorizationNote: null,
    customer: { id: IDS.customer, name: 'Marisol Vega', phone: '214-555-0197', email: null },
    vehicle: {
      id: IDS.vehicle, year: 2019, make: 'Ford', model: 'F-150', engine: '3.5L',
      vin: '1FTFW1E41KFA00001', mileage: 88420, plate: null,
    },
    jobs: [rawJob()], activities: [], createdAt: INITIAL_TIME, updatedAt: INITIAL_TIME,
    ...overrides,
  }
}

function rawQuote(overrides: Record<string, unknown> = {}) {
  return {
    ticket: { id: IDS.ticket, status: 'open', reconciled: false },
    configuration: {
      laborRateCents: 15500, taxRateBps: 825, partsMarkupBps: 2500,
      laborRateConfigured: true, taxRateConfigured: true,
    },
    jobs: [{
      id: IDS.job, title: 'Diagnose brake vibration', kind: 'diagnostic',
      customerSuppliedPartsNote: null, workStatus: 'open',
      story: { content: null, source: null, reviewStatus: null, revision: 0 },
      storyMode: 'authorization_only', decisionEligible: true,
      approval: { state: 'quote_ready', quoteVersionId: null }, lines: [],
    }],
    capabilities: { canRecordCustomerApproval: true, canCreateCustomerApprovalLink: true },
    activeVersion: {
      id: IDS.version, versionNumber: 1, totalCents: 18750,
      jobs: [{ jobId: IDS.job, subtotalCents: 18750 }],
    },
    ...overrides,
  }
}

function ticketProp(): TicketDetail {
  const raw = rawTicket()
  return {
    ...raw,
    jobs: raw.jobs.map((job) => ({
      ...job,
      createdAt: new Date(job.createdAt),
      updatedAt: new Date(job.updatedAt),
    })),
    createdAt: new Date(raw.createdAt),
    updatedAt: new Date(raw.updatedAt),
  }
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status })
}

function pendingConcern(
  expectedTicketUpdatedAt = INITIAL_TIME,
  expectedActiveVersionId: string | null = IDS.version,
) {
  return prepareTicketCorrectionRequest({
    action: 'concern',
    expectedTicketUpdatedAt,
    expectedActiveVersionId,
    concern: 'Steering wheel clunks over bumps.',
  }, null, () => IDS.requestOne)
}

function quoteForJob(job: ReturnType<typeof rawJob>) {
  const quote = rawQuote()
  return {
    ...quote,
    jobs: [{
      ...quote.jobs[0],
      title: String(job.title),
      kind: job.kind,
      workStatus: job.workStatus,
    }],
  }
}

describe('TicketCorrectionWorkspace', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    sessionStorage.clear()
  })

  it('announces fresh-truth loading before rendering any editable or confirmed state', async () => {
    let resolveTicket!: (value: Response) => void
    let resolveQuote!: (value: Response) => void
    const ticketResponse = new Promise<Response>((resolve) => { resolveTicket = resolve })
    const quoteResponse = new Promise<Response>((resolve) => { resolveQuote = resolve })
    vi.stubGlobal('fetch', vi.fn((url: string | URL | Request) => (
      String(url).endsWith('/quote') ? quoteResponse : ticketResponse
    )))

    render(<TicketCorrectionWorkspace
      actorId={IDS.actor}
      ticket={ticketProp()}
      target={{ kind: 'concern' }}
      onApplied={vi.fn()}
      onClose={vi.fn()}
    />)

    expect(screen.getByRole('status')).toHaveTextContent('Checking current repair-order truth…')
    expect(screen.queryByLabelText('Corrected concern')).toBeNull()
    expect(screen.getByRole('region', { name: 'Correct concern' }))
      .not.toHaveAttribute('data-correction-state', 'confirmed')

    await act(async () => {
      resolveTicket(json({ ticket: rawTicket() }))
      resolveQuote(json({ builder: rawQuote() }))
    })
    expect(await screen.findByLabelText('Corrected concern')).toHaveValue(
      'Steering wheel shakes under braking.',
    )
  })

  it('uses the real predictive intake search for the combined identity fact', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => (
      String(url).endsWith('/quote')
        ? json({ builder: rawQuote() })
        : json({ ticket: rawTicket() })
    )))

    render(<TicketCorrectionWorkspace
      actorId={IDS.actor}
      ticket={ticketProp()}
      target={{ kind: 'identity' }}
      onApplied={vi.fn()}
      onClose={vi.fn()}
    />)

    expect(await screen.findByRole('combobox')).toHaveAttribute(
      'placeholder',
      'Customer name, phone, VIN, plate, year/make/model…',
    )
    expect(screen.queryByText(/expectedTicketUpdatedAt|requestKey|activeVersion/i)).toBeNull()
  })

  it.each([
    ['in-progress work', { workStatus: 'in_progress' }, 'Finish or cancel that work before correcting repair-order truth.'],
    ['blocked work', { workStatus: 'blocked' }, 'Resolve or cancel that work before correcting repair-order truth.'],
    ['a linked session', { sessionId: IDS.secondJob }, 'Finish or cancel that diagnostic before correcting repair-order truth.'],
    ['diagnostic startup', { diagnosticStartState: 'initializing' }, 'Wait for startup to finish, then check current truth again.'],
    ['an ambiguous start', { diagnosticStartState: 'ambiguous' }, 'Resolve that diagnostic start before correcting repair-order truth.'],
  ])('does not mount job fields when fresh truth shows %s', async (_label, overrides, nextAction) => {
    const freshJob = rawJob(overrides)
    const fetchMock = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => (
      String(url).endsWith('/quote')
        ? json({ builder: quoteForJob(freshJob) })
        : json({ ticket: rawTicket({ jobs: [freshJob] }) })
    ))
    vi.stubGlobal('fetch', fetchMock)

    render(<TicketCorrectionWorkspace
      actorId={IDS.actor}
      ticket={ticketProp()}
      target={{ kind: 'job', jobId: IDS.job }}
      onApplied={vi.fn()}
      onClose={vi.fn()}
    />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      `Diagnose brake vibration: ${nextAction}`,
    )
    expect(screen.queryByLabelText('Job title')).toBeNull()
    expect(screen.getByRole('button', { name: 'Check current truth' })).toBeEnabled()
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST'))
      .toBe(false)
  })

  it.each(['identity', 'concern'] as const)(
    'does not mount %s fields when another non-canceled job is ineligible',
    async (kind) => {
      const first = rawJob()
      const blocked = rawJob({
        id: IDS.secondJob,
        title: 'Blocked tire repair',
        kind: 'repair',
        workStatus: 'blocked',
      })
      const quote = rawQuote()
      vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => (
        String(url).endsWith('/quote')
          ? json({ builder: {
              ...quote,
              jobs: [
                ...quote.jobs,
                {
                  ...quote.jobs[0], id: IDS.secondJob, title: blocked.title,
                  kind: 'repair', workStatus: 'blocked', storyMode: null,
                },
              ],
            } })
          : json({ ticket: rawTicket({ jobs: [first, blocked] }) })
      )))

      render(<TicketCorrectionWorkspace
        actorId={IDS.actor}
        ticket={ticketProp()}
        target={{ kind }}
        onApplied={vi.fn()}
        onClose={vi.fn()}
      />)

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Blocked tire repair: Resolve or cancel that work before correcting repair-order truth.',
      )
      expect(screen.queryByRole('combobox')).toBeNull()
      expect(screen.queryByLabelText('Corrected concern')).toBeNull()
      expect(screen.getByRole('button', { name: 'Check current truth' })).toBeEnabled()
    },
  )

  it('keeps an existing saved draft bounded and hidden when initial baseline truth fails', async () => {
    const storageKey = ticketCorrectionDraftKey(
      IDS.actor,
      IDS.ticket,
      { kind: 'concern' },
    )
    const raw = encodeTicketCorrectionDraft({
      version: 1,
      actorId: IDS.actor,
      ticketId: IDS.ticket,
      target: { kind: 'concern' },
      fields: { kind: 'concern', concern: 'Saved private typed concern' },
      pending: null,
      savedAt: Date.now(),
    })
    sessionStorage.setItem(storageKey, raw)
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => (
      String(url).endsWith('/quote')
        ? json({ builder: rawQuote() })
        : json({ error: 'unavailable' }, 503)
    )))

    render(<TicketCorrectionWorkspace
      actorId={IDS.actor}
      ticket={ticketProp()}
      target={{ kind: 'concern' }}
      onApplied={vi.fn()}
      onClose={vi.fn()}
    />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Current repair-order truth could not be checked.',
    )
    expect(sessionStorage.getItem(storageKey)).toBe(raw)
    expect(document.body).not.toHaveTextContent(raw)
    expect(document.body).not.toHaveTextContent('Saved private typed concern')
    expect(screen.queryByRole('button', { name: /save correction|retry correction/i })).toBeNull()
  })

  it('keeps exact pending intent through a failed quote refresh and confirms only after replay truth', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(IDS.requestOne)
    let quoteReads = 0
    const postBodies: string[] = []
    const onApplied = vi.fn()
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url)
      if (path.endsWith('/corrections') && init?.method === 'POST') {
        postBodies.push(String(init.body))
        return json({
          outcome: postBodies.length === 1 ? 'changed' : 'replayed',
          changed: postBodies.length === 1,
          scope: 'concern', invalidatedVersionNumber: 1,
          ticket: rawTicket({
            concern: 'Steering wheel clunks over bumps.',
            updatedAt: CURRENT_TIME,
          }),
        })
      }
      if (path.endsWith('/quote')) {
        quoteReads += 1
        if (quoteReads === 2) return json({ builder: { malformed: true } })
        return json({ builder: rawQuote({ activeVersion: quoteReads === 1 ? rawQuote().activeVersion : null }) })
      }
      return json({ ticket: rawTicket() })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<TicketCorrectionWorkspace
      actorId={IDS.actor}
      ticket={ticketProp()}
      target={{ kind: 'concern' }}
      onApplied={onApplied}
      onClose={vi.fn()}
    />)

    const field = await screen.findByLabelText('Corrected concern')
    await user.clear(field)
    await user.type(field, 'Steering wheel clunks over bumps.')
    await user.click(screen.getByRole('button', { name: 'Save correction' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The correction may be saved, but current quote truth could not be checked.',
    )
    expect(onApplied).not.toHaveBeenCalled()
    expect(screen.getByRole('region', { name: 'Correct concern' }))
      .toHaveAttribute('data-correction-state', 'recovery')
    expect(field).toHaveValue('Steering wheel clunks over bumps.')
    expect(screen.queryByText(postBodies[0])).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Retry correction' }))

    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1))
    expect(postBodies).toHaveLength(2)
    expect(postBodies[1]).toBe(postBodies[0])
    expect(JSON.parse(postBodies[1]).requestKey).toBe(IDS.requestOne)
    expect(onApplied).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'replayed',
      announcement: 'Already saved. The repair order is current.',
      invalidatedVersionNumber: 1,
      ticket: expect.objectContaining({ concern: 'Steering wheel clunks over bumps.' }),
      quote: expect.objectContaining({ activeVersion: null }),
    }))
    expect(sessionStorage.length).toBe(0)
  })

  it('retries a restored ambiguous request byte-for-byte before rebuilding against newer truth', async () => {
    const user = userEvent.setup()
    const pending = pendingConcern()
    const storageKey = ticketCorrectionDraftKey(IDS.actor, IDS.ticket, { kind: 'concern' })
    sessionStorage.setItem(storageKey, encodeTicketCorrectionDraft({
      version: 1,
      actorId: IDS.actor,
      ticketId: IDS.ticket,
      target: { kind: 'concern' },
      fields: { kind: 'concern', concern: 'Steering wheel clunks over bumps.' },
      pending,
      savedAt: Date.now(),
    }))
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(IDS.requestTwo)
    const postBodies: string[] = []
    const onApplied = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url)
      if (path.endsWith('/corrections') && init?.method === 'POST') {
        postBodies.push(String(init.body))
        return json({
          outcome: 'replayed', changed: false, scope: 'concern',
          invalidatedVersionNumber: 1,
          ticket: rawTicket({
            concern: 'Steering wheel clunks over bumps.',
            updatedAt: CURRENT_TIME,
          }),
        })
      }
      if (path.endsWith('/quote')) return json({ builder: rawQuote({ activeVersion: null }) })
      return json({ ticket: rawTicket({ updatedAt: CURRENT_TIME }) })
    }))

    render(<TicketCorrectionWorkspace
      actorId={IDS.actor}
      ticket={ticketProp()}
      target={{ kind: 'concern' }}
      onApplied={onApplied}
      onClose={vi.fn()}
    />)

    expect(await screen.findByLabelText('Corrected concern')).toHaveValue(
      'Steering wheel clunks over bumps.',
    )
    await user.click(screen.getByRole('button', { name: /Save correction|Retry correction/ }))

    await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1))
    expect(postBodies).toEqual([pending.body])
    expect(JSON.parse(postBodies[0]).requestKey).toBe(IDS.requestOne)
  })

  it('preserves the exact request through retryable lock contention without refreshing expectations', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(IDS.requestOne)
    let ticketReads = 0
    const postBodies: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url)
      if (path.endsWith('/corrections') && init?.method === 'POST') {
        postBodies.push(String(init.body))
        if (postBodies.length === 1) return json({ error: 'conflict', retryable: true }, 409)
        return json({
          outcome: 'replayed', changed: false, scope: 'concern',
          invalidatedVersionNumber: null,
          ticket: rawTicket(),
        })
      }
      if (path.endsWith('/quote')) return json({ builder: rawQuote() })
      ticketReads += 1
      return json({ ticket: rawTicket() })
    }))

    render(<TicketCorrectionWorkspace
      actorId={IDS.actor}
      ticket={ticketProp()}
      target={{ kind: 'concern' }}
      onApplied={vi.fn()}
      onClose={vi.fn()}
    />)

    await screen.findByLabelText('Corrected concern')
    await user.click(screen.getByRole('button', { name: 'Save correction' }))
    const retry = await screen.findByRole('button', { name: 'Retry correction' })
    expect(ticketReads).toBe(1)
    await user.click(retry)

    await waitFor(() => expect(postBodies).toHaveLength(2))
    expect(postBodies[1]).toBe(postBodies[0])
    expect(JSON.parse(postBodies[1]).requestKey).toBe(IDS.requestOne)
  })

  it('forces a new key after a definitive same-key conflict even when fresh truth is unchanged', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce(IDS.requestOne)
      .mockReturnValueOnce(IDS.requestTwo)
    const bodies: Array<Record<string, unknown>> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url)
      if (path.endsWith('/corrections') && init?.method === 'POST') {
        bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>)
        return bodies.length === 1
          ? json({ error: 'conflict', retryable: false }, 409)
          : json({
              outcome: 'unchanged', changed: false, scope: 'concern',
              invalidatedVersionNumber: null, ticket: rawTicket(),
            })
      }
      return path.endsWith('/quote')
        ? json({ builder: rawQuote() })
        : json({ ticket: rawTicket() })
    }))

    render(<TicketCorrectionWorkspace
      actorId={IDS.actor}
      ticket={ticketProp()}
      target={{ kind: 'concern' }}
      onApplied={vi.fn()}
      onClose={vi.fn()}
    />)

    await screen.findByLabelText('Corrected concern')
    await user.click(screen.getByRole('button', { name: 'Save correction' }))
    await user.click(await screen.findByRole('button', { name: 'Retry correction' }))

    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies.map((body) => body.requestKey)).toEqual([IDS.requestOne, IDS.requestTwo])
  })

  it('recovers a failed definitive-conflict refresh before enabling a forced-new retry', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce(IDS.requestOne)
      .mockReturnValueOnce(IDS.requestTwo)
    let ticketReads = 0
    const bodies: Array<Record<string, unknown>> = []
    const storageKey = ticketCorrectionDraftKey(IDS.actor, IDS.ticket, { kind: 'concern' })
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url)
      if (path.endsWith('/corrections') && init?.method === 'POST') {
        bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>)
        return bodies.length === 1
          ? json({ error: 'conflict' }, 409)
          : json({
              outcome: 'unchanged', changed: false, scope: 'concern',
              invalidatedVersionNumber: null, ticket: rawTicket(),
            })
      }
      if (path.endsWith('/quote')) return json({ builder: rawQuote() })
      ticketReads += 1
      if (ticketReads === 2) return json({ error: 'unavailable' }, 503)
      return json({ ticket: rawTicket() })
    }))

    render(<TicketCorrectionWorkspace
      actorId={IDS.actor}
      ticket={ticketProp()}
      target={{ kind: 'concern' }}
      onApplied={vi.fn()}
      onClose={vi.fn()}
    />)

    const field = await screen.findByLabelText('Corrected concern')
    await user.clear(field)
    await user.type(field, 'Retained typed correction')
    await user.click(screen.getByRole('button', { name: 'Save correction' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Current repair-order truth could not be refreshed.',
    )
    expect(field).toHaveValue('Retained typed correction')
    expect(screen.getByRole('button', { name: 'Check current truth' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: /Save correction|Retry correction/ })).toBeNull()
    expect(document.body).not.toHaveTextContent(sessionStorage.getItem(storageKey) ?? 'never')

    await user.click(screen.getByRole('button', { name: 'Check current truth' }))
    const retry = await screen.findByRole('button', { name: 'Retry correction' })
    expect(retry).toHaveFocus()
    await user.click(retry)

    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies.map((body) => body.requestKey)).toEqual([IDS.requestOne, IDS.requestTwo])
  })

  it('ignores a late correction response after the workspace unmounts', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(IDS.requestOne)
    let resolvePost!: (response: Response) => void
    const post = new Promise<Response>((resolve) => { resolvePost = resolve })
    const onApplied = vi.fn()
    vi.stubGlobal('fetch', vi.fn((url: string | URL | Request, init?: RequestInit) => {
      const path = String(url)
      if (path.endsWith('/corrections') && init?.method === 'POST') return post
      return Promise.resolve(path.endsWith('/quote')
        ? json({ builder: rawQuote() })
        : json({ ticket: rawTicket() }))
    }))

    const { unmount } = render(<TicketCorrectionWorkspace
      actorId={IDS.actor}
      ticket={ticketProp()}
      target={{ kind: 'concern' }}
      onApplied={onApplied}
      onClose={vi.fn()}
    />)

    await screen.findByLabelText('Corrected concern')
    await user.click(screen.getByRole('button', { name: 'Save correction' }))
    unmount()
    await act(async () => resolvePost(json({
      outcome: 'changed', changed: true, scope: 'concern', invalidatedVersionNumber: 1,
      ticket: rawTicket({ concern: 'Late truth', updatedAt: CURRENT_TIME }),
    })))

    expect(onApplied).not.toHaveBeenCalled()
  })

  it('refreshes a conflict beside retained typing, rotates the key, and focuses valid Retry', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce(IDS.requestOne)
      .mockReturnValueOnce(IDS.requestTwo)
    let ticketReads = 0
    let postReads = 0
    const bodies: Array<Record<string, unknown>> = []
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url)
      if (path.endsWith('/corrections') && init?.method === 'POST') {
        postReads += 1
        bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>)
        if (postReads === 1) return json({ error: 'conflict' }, 409)
        return json({
          outcome: 'unchanged', changed: false, scope: 'concern',
          invalidatedVersionNumber: null,
          ticket: rawTicket({ concern: 'Current server concern', updatedAt: CURRENT_TIME }),
        })
      }
      if (path.endsWith('/quote')) return json({ builder: rawQuote({ activeVersion: null }) })
      ticketReads += 1
      return json({ ticket: rawTicket(ticketReads === 1 ? {} : {
        concern: 'Current server concern', updatedAt: CURRENT_TIME,
      }) })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<TicketCorrectionWorkspace
      actorId={IDS.actor}
      ticket={ticketProp()}
      target={{ kind: 'concern' }}
      onApplied={vi.fn()}
      onClose={vi.fn()}
    />)

    const field = await screen.findByLabelText('Corrected concern')
    await user.clear(field)
    await user.type(field, 'Retained typed correction')
    await user.click(screen.getByRole('button', { name: 'Save correction' }))

    const retry = await screen.findByRole('button', { name: 'Retry correction' })
    expect(field).toHaveValue('Retained typed correction')
    expect(screen.getByText(/Current repair-order value: Current server concern/)).toBeInTheDocument()
    expect(retry).toHaveFocus()

    await user.click(retry)
    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies.map((body) => body.requestKey)).toEqual([IDS.requestOne, IDS.requestTwo])
    expect(bodies.map((body) => body.expectedTicketUpdatedAt)).toEqual([
      INITIAL_TIME, CURRENT_TIME,
    ])
    expect(bodies[1].concern).toBe('Retained typed correction')
  })

  it('reloads and strictly couples fresh quote truth before seating an unchanged result', async () => {
    const user = userEvent.setup()
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(IDS.requestOne)
    let quoteReads = 0
    const onApplied = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url)
      if (path.endsWith('/corrections') && init?.method === 'POST') {
        return json({
          outcome: 'unchanged', changed: false, scope: 'concern',
          invalidatedVersionNumber: null,
          ticket: rawTicket(),
        })
      }
      if (path.endsWith('/quote')) {
        quoteReads += 1
        return quoteReads === 1
          ? json({ builder: rawQuote() })
          : json({ builder: { malformed: true } })
      }
      return json({ ticket: rawTicket() })
    }))

    render(<TicketCorrectionWorkspace
      actorId={IDS.actor}
      ticket={ticketProp()}
      target={{ kind: 'concern' }}
      onApplied={onApplied}
      onClose={vi.fn()}
    />)

    await screen.findByLabelText('Corrected concern')
    await user.click(screen.getByRole('button', { name: 'Save correction' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'current quote truth could not be checked',
    )
    expect(quoteReads).toBe(2)
    expect(onApplied).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Retry correction' })).toBeEnabled()
  })

  it.each([
    ['forbidden', 403, 'Ask an advisor or owner to make this correction.'],
    ['job_not_open', 409, 'Finish or cancel the started work before correcting this fact.'],
    ['ticket_not_open', 409, 'Reopen the repair order before correcting its facts.'],
  ])('names the actual next action for %s without losing the editor', async (error, status, copy) => {
    const user = userEvent.setup()
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(IDS.requestOne)
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url)
      if (path.endsWith('/corrections') && init?.method === 'POST') {
        return json({ error }, status)
      }
      return path.endsWith('/quote')
        ? json({ builder: rawQuote() })
        : json({ ticket: rawTicket() })
    }))

    render(<TicketCorrectionWorkspace
      actorId={IDS.actor}
      ticket={ticketProp()}
      target={{ kind: 'concern' }}
      onApplied={vi.fn()}
      onClose={vi.fn()}
    />)
    const field = await screen.findByLabelText('Corrected concern')
    await user.type(field, ' retained')
    await user.click(screen.getByRole('button', { name: 'Save correction' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(copy)
    expect((field as HTMLTextAreaElement).value).toContain('retained')
    expect(screen.queryByRole('button', { name: 'Retry correction' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save correction' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
  })

  it('refuses final-active-job removal from fresh truth before submission', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => (
      String(url).endsWith('/quote')
        ? json({ builder: rawQuote() })
        : json({ ticket: rawTicket() })
    ))
    vi.stubGlobal('fetch', fetchMock)

    render(<TicketCorrectionWorkspace
      actorId={IDS.actor}
      ticket={ticketProp()}
      target={{ kind: 'job', jobId: IDS.job }}
      onApplied={vi.fn()}
      onClose={vi.fn()}
    />)
    await screen.findByLabelText('Job title')
    await user.click(screen.getByRole('button', { name: 'Remove from active work' }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      'This is the last active job. Add the replacement job before removing it.',
    )
    expect(screen.queryByRole('button', { name: /save correction|retry correction|confirm removal/i }))
      .toBeNull()
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST'))
      .toBe(false)
  })
})
