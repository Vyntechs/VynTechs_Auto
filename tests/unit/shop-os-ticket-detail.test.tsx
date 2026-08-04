import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TicketDetailScreen } from '@/components/screens/ticket-detail'
import type { TicketDetail } from '@/lib/tickets'
import { customerCopyFixture } from '@/tests/helpers/customer-copy'

const { routerRefreshMock } = vi.hoisted(() => ({ routerRefreshMock: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: routerRefreshMock, push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/tickets/ticket-1',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('next/image', () => ({
  default: ({
    priority: _priority,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean }) => <img {...props} />,
}))

vi.mock('@/components/vt/whats-new-badge', () => ({
  WhatsNewBadge: () => null,
}))

vi.mock('@/components/screens/inline-quote-workspace', () => ({
  inlineQuoteWorkspaceId: (ticketId: string) => `inline-quote-workspace-${ticketId}`,
  InlineQuoteWorkspace: ({ actorId, workspaceId, onClose, onProjection }: {
    actorId: string
    workspaceId: string
    onClose: () => void
    onProjection: (jobs: Array<{
      id: string
      workStatus: 'open'
      approvalState: 'quote_ready' | 'approved'
    }>) => void
  }) => (
    <section
      id={workspaceId}
      aria-label="Quote for this repair order"
      data-actor-id={actorId}
    >
      <button type="button" onClick={() => onProjection([{
        id: 'job-1',
        workStatus: 'open',
        approvalState: 'quote_ready',
      }])}>Publish quote state</button>
      <button type="button" onClick={() => onProjection([{
        id: 'job-1',
        workStatus: 'open',
        approvalState: 'approved',
      }])}>Publish approval state</button>
      <button type="button" onClick={onClose}>Close quote</button>
    </section>
  ),
}))

vi.mock('@/components/screens/inline-work-workspace', () => ({
  InlineWorkWorkspace: ({ onClose, onProjection, onEscalation }: {
    onClose: () => void
    onProjection: (work: {
      status: 'done'
      workNotes: string
      startedAt: string
      completedAt: string
      clockedOnSince: null
      activeSeconds: number
      updatedAt: string
    }) => void
    onEscalation: (job: {
      id: string
      title: string
      kind: 'repair'
      requiredSkillTier: number
      assignedTechId: null
      workStatus: 'open'
      approvalState: 'pending_quote'
      sessionId: null
    }) => void
  }) => (
    <section aria-label="Inline work workspace">
      <button type="button" onClick={() => onProjection({
        status: 'done',
        workNotes: 'Installed and torqued.',
        startedAt: '2026-07-11T12:00:00.000Z',
        completedAt: '2026-07-11T13:00:00.000Z',
        clockedOnSince: null,
        activeSeconds: 3600,
        updatedAt: '2026-07-11T13:00:00.000Z',
      })}>Publish work state</button>
      <button type="button" onClick={() => onEscalation({
        id: 'found-job',
        title: 'Found: steering clunk',
        kind: 'repair',
        requiredSkillTier: 2,
        assignedTechId: null,
        workStatus: 'open',
        approvalState: 'pending_quote',
        sessionId: null,
      })}>Publish found concern</button>
      <button type="button" onClick={onClose}>Close work</button>
    </section>
  ),
}))

vi.mock('@/components/screens/ticket-correction-workspace', () => ({
  TicketCorrectionWorkspace: ({ ticket, target, onApplied, onClose }: {
    ticket: TicketDetail
    target: { kind: 'identity' | 'concern' } | { kind: 'job'; jobId: string }
    onApplied: (result: {
      target: typeof target
      outcome: 'changed' | 'replayed' | 'unchanged'
      ticket: TicketDetail
      quote: { jobs: Array<{ id: string; workStatus: 'open'; approval: { state: 'quote_ready' } }>; activeVersion: null }
      invalidatedVersionNumber: number | null
      announcement: string
    }) => void
    onClose: () => void
  }) => {
    const correctedTicket = (remove = false): TicketDetail => ({
      ...ticket,
      customer: target.kind === 'identity' ? {
        id: 'customer-corrected', name: 'Jamie Reed', phone: '214-555-0101', email: null,
      } : ticket.customer,
      vehicle: target.kind === 'identity' ? {
        id: 'vehicle-corrected', year: 2021, make: 'Ram', model: '2500', engine: '6.7L',
        vin: null, mileage: 88300, plate: null,
      } : ticket.vehicle,
      concern: target.kind === 'concern' ? 'Steering wheel clunks over bumps.' : ticket.concern,
      jobs: ticket.jobs.map((job) => target.kind === 'job' && job.id === target.jobId
        ? {
            ...job,
            title: remove ? job.title : 'Inspect front suspension',
            workStatus: remove ? 'canceled' : job.workStatus,
          }
        : job),
      activities: remove && target.kind === 'job' ? [{
        id: 'activity-corrected', jobId: target.jobId, kind: 'ticket_corrected',
        actorName: 'Avery Advisor', summary: `${ticket.jobs.find((job) => job.id === target.jobId)?.title}: Removed from active work. It remains in History.`,
        correctionScope: 'job_removed', createdAt: new Date('2026-08-03T15:00:00Z'),
      }] : ticket.activities,
    })
    const publish = (
      outcome: 'changed' | 'replayed' | 'unchanged',
      remove = false,
    ) => {
      const next = correctedTicket(remove)
      const scope = remove ? 'job_removed' : target.kind
      const announcement = outcome === 'replayed'
        ? 'Already saved. The repair order is current.'
        : outcome === 'unchanged'
          ? 'No change needed'
          : remove
            ? 'Removed from active work. It remains in History.'
            : target.kind === 'identity'
              ? 'Customer or vehicle corrected.'
              : target.kind === 'concern'
                ? 'Concern corrected.'
                : 'Inspect front suspension corrected.'
      onApplied({
        target,
        outcome,
        ticket: outcome === 'unchanged' ? ticket : next,
        quote: {
          jobs: next.jobs.filter((job) => job.workStatus !== 'canceled').map((job) => ({
            id: job.id, workStatus: 'open' as const, approval: { state: 'quote_ready' as const },
          })),
          activeVersion: null,
        },
        invalidatedVersionNumber: outcome === 'unchanged' ? null : 1,
        announcement,
      })
    }
    return (
      <section aria-label={`Correction editor for ${target.kind}`} data-dirty="true">
        <button type="button" onClick={() => publish('changed')}>Apply corrected truth</button>
        <button type="button" onClick={() => publish('changed', true)}>Apply removal truth</button>
        <button type="button" onClick={() => publish('replayed')}>Apply replay truth</button>
        <button type="button" onClick={() => publish('unchanged')}>Apply no change</button>
        <button type="button" onClick={onClose}>Cancel correction</button>
      </section>
    )
  },
}))

vi.mock('@/components/screens/ticket-interruption-action', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/components/screens/ticket-interruption-action')>(),
  TicketInterruptionAction: ({ action = 'resolve_hold', onApplied }: {
    action?: 'resolve_hold' | 'cancel_job'
    onApplied: (job: { workStatus: 'in_progress' | 'canceled' }) => void
  }) => (
    action === 'cancel_job'
      ? (
        <button type="button" onClick={() => onApplied({ workStatus: 'canceled' })}>
          Not doing this one
        </button>
      )
      : <button type="button" onClick={() => onApplied({ workStatus: 'in_progress' })}>Resolve hold</button>
  ),
}))

const timestamp = new Date('2026-07-10T14:30:00Z')

type TicketJob = TicketDetail['jobs'][number]

function job(overrides: Partial<TicketJob> = {}): TicketJob {
  return {
    id: 'job-1',
    title: 'Diagnose brake vibration',
    kind: 'diagnostic',
    requiredSkillTier: 3,
    assignedTechId: null,
    assignedTech: null,
    sessionId: null,
    workStatus: 'open',
    approvalState: 'pending_quote',
    customerSuppliedPartsNote: null,
    workNotes: null,
    diagnosticStartState: 'idle',
    diagnosticStartErrorCode: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  }
}

function ticket(overrides: Partial<TicketDetail> = {}): TicketDetail {
  return {
    id: 'ticket-1',
    ticketNumber: 42,
    source: 'counter',
    status: 'open',
    concern: 'Steering wheel shakes under braking from highway speed.',
    whenStarted: 'Three days ago',
    howOften: 'Every stop above 50 mph',
    diagnosticAuthorizedCents: 18750,
    diagnosticAuthorizationNote: 'Call before exceeding the authorized amount.',
    customer: {
      id: 'customer-1',
      name: 'Marisol Vega',
      phone: '(214) 555-0197',
      email: 'marisol@example.com',
    },
    vehicle: {
      id: 'vehicle-1',
      year: 2019,
      make: 'Ford',
      model: 'F-150',
      engine: '3.5L EcoBoost',
      vin: '1FTFW1E41KFA00001',
      mileage: 88420,
      plate: 'TEX-4192',
    },
    jobs: [job()],
    activities: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  }
}

describe('TicketDetailScreen', () => {
  beforeEach(() => routerRefreshMock.mockClear())

  it('reveals Customer Copy in place for an advisor and moves focus to its heading', async () => {
    render(
      <TicketDetailScreen
        ticket={ticket()}
        role="advisor"
        currentProfileId="advisor-1"
        customerCopy={customerCopyFixture}
      />,
    )

    const opener = screen.getByRole('button', { name: 'Customer copy' })
    expect(opener).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(opener)

    expect(opener).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('region', { name: 'Customer copy preview' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Invoice' })).toHaveFocus()
    expect(screen.getByText('Steering wheel shakes under braking from highway speed.')).toBeInTheDocument()
  })

  it('does not render the Customer Copy control when the server withheld its projection', () => {
    render(<TicketDetailScreen ticket={ticket()} role="tech" currentProfileId="tech-1" />)
    expect(screen.queryByRole('button', { name: 'Customer copy' })).toBeNull()
  })

  it('closes and disables stale Customer Copy after quote approval while refreshing server truth', async () => {
    const user = userEvent.setup()
    render(<TicketDetailScreen
      ticket={ticket()}
      role="advisor"
      canBuildQuote
      currentProfileId="advisor-1"
      customerCopy={customerCopyFixture}
    />)

    await user.click(screen.getByRole('button', { name: 'Customer copy' }))
    expect(screen.getByRole('region', { name: 'Customer copy preview' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Build quote' }))
    await user.click(screen.getByRole('button', { name: 'Publish approval state' }))

    expect(screen.queryByRole('region', { name: 'Customer copy preview' })).toBeNull()
    expect(screen.getByRole('button', { name: /customer copy/i })).toBeDisabled()
    expect(routerRefreshMock).toHaveBeenCalledTimes(1)
  })

  it('renders a complete counter ticket from the safe projection with real links', () => {
    render(<TicketDetailScreen ticket={ticket()} />)

    expect(screen.getAllByText('RO 000042').length).toBeGreaterThan(0)
    expect(screen.getByText('Open · Written up')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to My work' })).toHaveAttribute(
      'href',
      '/today',
    )
    expect(
      screen.getByText('Steering wheel shakes under braking from highway speed.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Three days ago')).toBeInTheDocument()
    expect(screen.getByText('Every stop above 50 mph')).toBeInTheDocument()
    expect(screen.queryByText('$187.50')).toBeNull()
    expect(screen.queryByText('Call before exceeding the authorized amount.')).toBeNull()

    expect(screen.getAllByText('Marisol Vega')).toHaveLength(2)
    expect(screen.getByRole('link', { name: '(214) 555-0197' })).toHaveAttribute(
      'href',
      'tel:+12145550197',
    )
    expect(screen.getByRole('link', { name: 'marisol@example.com' })).toHaveAttribute(
      'href',
      'mailto:marisol@example.com',
    )
    expect(screen.getAllByText('2019 Ford F-150')).toHaveLength(2)
    expect(screen.getAllByText('3.5L EcoBoost')).toHaveLength(2)
    expect(screen.getByText('1FTFW1E41KFA00001')).toBeInTheDocument()
    expect(screen.getByText('88,420 mi')).toBeInTheDocument()
    expect(screen.getByText('TEX-4192')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View vehicle history' })).toHaveAttribute(
      'href',
      '/vehicles/vehicle-1',
    )
  })

  it('shows durable interruption truth as a compact repair-order record', () => {
    render(<TicketDetailScreen ticket={ticket({
      activities: [{
        id: 'activity-1', jobId: 'job-1', kind: 'job_blocked', actorName: 'Taylor Tech',
        summary: 'Diagnose brake vibration: Put on hold — Awaiting pads.', createdAt: timestamp,
      }],
    })} />)

    expect(screen.getByRole('heading', { name: 'History' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'History' }).closest('details')).not.toHaveAttribute('open')
    expect(screen.getByText('Diagnose brake vibration: Put on hold — Awaiting pads.')).toBeInTheDocument()
    expect(screen.getByText(/Taylor Tech/)).toBeInTheDocument()
  })

  it('renders an honest provisional tech-quick state without invented actions or identity', () => {
    render(
      <TicketDetailScreen
        canBuildQuote
        ticket={ticket({
          source: 'tech_quick',
          customer: null,
          vehicle: null,
          whenStarted: null,
          howOften: null,
          diagnosticAuthorizedCents: null,
          diagnosticAuthorizationNote: null,
        })}
      />,
    )

    expect(screen.getByText('Open · Started by a tech')).toBeInTheDocument()
    const provisional = screen.getByRole('region', {
      name: 'No customer or vehicle yet',
    })
    expect(
      within(provisional).getByText(
        /You can price the work now\..*stay locked until the customer and vehicle are on here\./,
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Build quote' })).toHaveAttribute(
      'href',
      '/tickets/ticket-1/quote',
    )
    expect(within(provisional).queryByRole('button')).toBeNull()
    expect(screen.queryByText('Marisol Vega')).toBeNull()
    expect(screen.queryByText('2019 Ford F-150')).toBeNull()
  })

  it('offers one 44px quote entry only for an authorized open ticket', () => {
    const { rerender } = render(
      <TicketDetailScreen ticket={ticket()} canBuildQuote />,
    )

    expect(screen.getByRole('link', { name: 'Build quote' })).toHaveAttribute(
      'href',
      '/tickets/ticket-1/quote',
    )

    rerender(<TicketDetailScreen ticket={ticket()} canBuildQuote={false} />)
    expect(screen.queryByRole('link', { name: 'Build quote' })).toBeNull()

    rerender(
      <TicketDetailScreen
        ticket={ticket({ status: 'closed' })}
        canBuildQuote
      />,
    )
    expect(screen.queryByRole('link', { name: 'Build quote' })).toBeNull()
  })

  it('opens the role-shaped quote tool in place, reconciles ledger truth, and restores focus', async () => {
    const user = userEvent.setup()
    render(
      <TicketDetailScreen
        ticket={ticket()}
        canBuildQuote
        currentProfileId="advisor-1"
        role="advisor"
      />,
    )

    const opener = screen.getByRole('button', { name: 'Build quote' })
    expect(screen.queryByRole('link', { name: 'Build quote' })).toBeNull()
    expect(opener).toHaveAttribute('aria-controls', 'inline-quote-workspace-ticket-1')
    await user.click(opener)

    const workspace = screen.getByRole('region', { name: 'Quote for this repair order' })
    expect(workspace).toHaveAttribute('id', 'inline-quote-workspace-ticket-1')
    expect(workspace).toHaveAttribute('data-actor-id', 'advisor-1')
    expect(opener).toBeDisabled()
    expect(screen.getByText('Steering wheel shakes under braking from highway speed.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Publish quote state' }))
    expect(screen.getByText('Priced')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close quote' }))
    expect(screen.queryByRole('region', { name: 'Quote for this repair order' })).toBeNull()
    expect(opener).toHaveFocus()
  })

  it('mounts one correction entry at identity, concern, and only eligible job facts', () => {
    render(<TicketDetailScreen
      ticket={ticket({ jobs: [
        job({ id: 'job-1', title: 'Diagnose brake vibration' }),
        job({ id: 'job-2', title: 'Replace front pads', kind: 'repair' }),
        job({ id: 'job-3', title: 'Started alignment', kind: 'maintenance', workStatus: 'in_progress' }),
        job({ id: 'job-4', title: 'Blocked tire repair', kind: 'repair', workStatus: 'blocked' }),
        job({ id: 'job-5', title: 'Session-linked diagnosis', sessionId: 'session-1' }),
        job({ id: 'job-6', title: 'Initializing diagnosis', diagnosticStartState: 'initializing' }),
        job({ id: 'job-7', title: 'Ambiguous diagnosis', diagnosticStartState: 'ambiguous' }),
      ] })}
      canCorrectTicket
      currentProfileId="advisor-1"
      role="advisor"
    />)

    expect(screen.getByRole('button', { name: 'Correct customer or vehicle' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Correct concern' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Correct job 01: Diagnose brake vibration' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Correct job 02: Replace front pads' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Correct job 03: Started alignment' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Correct job 04: Blocked tire repair' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Correct job 05: Session-linked diagnosis' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Correct job 06: Initializing diagnosis' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Correct job 07: Ambiguous diagnosis' })).toBeNull()

    expect(document.querySelector('[data-correction-target="identity"]'))
      .toHaveAccessibleName('Customer and vehicle correction target')
    expect(document.querySelector('[data-correction-target="concern"]'))
      .toHaveAccessibleName('Concern correction target')
    expect(document.querySelector('[data-correction-target="job:job-1"]'))
      .toHaveAccessibleName('Job correction target 01')
    expect(document.querySelector('[data-correction-target="job:job-2"]'))
      .toHaveAccessibleName('Job correction target 02')
  })

  it('uses an accurate identity action when the repair order is still provisional', () => {
    render(<TicketDetailScreen
      ticket={ticket({ customer: null, vehicle: null })}
      canCorrectTicket
      currentProfileId="advisor-1"
      role="advisor"
    />)

    expect(screen.getByRole('button', { name: 'Add customer or vehicle' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Correct customer or vehicle' })).toBeNull()
  })

  it('mounts the editor directly under its fact and never silently discards another open tool', async () => {
    const user = userEvent.setup()
    render(<TicketDetailScreen
      ticket={ticket()}
      canBuildQuote
      canCorrectTicket
      currentProfileId="advisor-1"
      role="advisor"
    />)

    const concernOpener = screen.getByRole('button', { name: 'Correct concern' })
    await user.click(screen.getByRole('button', { name: 'Build quote' }))
    expect(concernOpener).toBeDisabled()
    expect(screen.getByRole('region', { name: 'Quote for this repair order' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close quote' }))

    await user.click(concernOpener)
    const editor = screen.getByRole('region', { name: 'Correction editor for concern' })
    expect(screen.getByRole('button', { name: 'Build quote' })).toBeDisabled()
    expect(editor.closest('[data-correction-target="concern"]')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: 'Cancel correction' }))
    expect(screen.queryByRole('region', { name: 'Correction editor for concern' })).toBeNull()
    expect(concernOpener).toHaveFocus()
  })

  it('arbitrates lifecycle mutation against mounted tools while preserving a typed reason', async () => {
    const user = userEvent.setup()
    let resolveLifecycle!: (response: Response) => void
    const lifecycleRequest = new Promise<Response>((resolve) => { resolveLifecycle = resolve })
    vi.stubGlobal('fetch', vi.fn((url: string | URL | Request) => (
      String(url).endsWith('/lifecycle')
        ? lifecycleRequest
        : Promise.resolve(new Response(JSON.stringify({ error: 'unexpected' }), { status: 500 }))
    )))
    render(<TicketDetailScreen
      ticket={ticket()}
      canBuildQuote
      canCorrectTicket
      currentProfileId="advisor-1"
      role="advisor"
    />)

    await user.click(screen.getAllByText('Cancel repair order')[0])
    const reason = screen.getByLabelText('Cancellation reason')
    await user.type(reason, 'Customer needs another week.')

    await user.click(screen.getByRole('button', { name: 'Correct concern' }))
    expect(screen.getByRole('button', { name: 'Cancel repair order' })).toBeDisabled()
    expect(reason).toHaveValue('Customer needs another week.')
    await user.click(screen.getByRole('button', { name: 'Cancel correction' }))

    await user.click(screen.getByRole('button', { name: 'Cancel repair order' }))
    expect(screen.getByRole('button', { name: 'Correct concern' })).toBeDisabled()
    expect(reason).toHaveValue('Customer needs another week.')

    resolveLifecycle(new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The repair order was not changed.')
    expect(screen.getByRole('button', { name: 'Correct concern' })).toBeEnabled()
    expect(reason).toHaveValue('Customer needs another week.')
  })

  it('atomically seats validated ticket and quote truth without a page refresh', async () => {
    const user = userEvent.setup()
    render(<TicketDetailScreen
      ticket={ticket()}
      canCorrectTicket
      currentProfileId="advisor-1"
      role="advisor"
    />)

    await user.click(screen.getByRole('button', { name: 'Correct concern' }))
    await user.click(screen.getByRole('button', { name: 'Apply corrected truth' }))

    const corrected = screen.getByText('Steering wheel clunks over bumps.').closest(
      '[data-correction-target="concern"]',
    ) as HTMLElement
    expect(corrected).toHaveAttribute('data-correction-state', 'confirmed')
    expect(corrected).toHaveFocus()
    expect(within(corrected).getByText('Concern corrected.')).toHaveAttribute('role', 'status')
    expect(within(corrected).getByTestId('correction-signal-rail')).toBeInTheDocument()
    expect(within(corrected).getByText('Current draft · V1 no longer current')).toBeInTheDocument()
    expect(screen.getByText('Priced')).toBeInTheDocument()
    expect(routerRefreshMock).not.toHaveBeenCalled()
  })

  it('keeps replay and removal truth local while a new no-op receives no detent rail', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<TicketDetailScreen
      ticket={ticket({ jobs: [
        job(),
        job({ id: 'job-2', title: 'Replace front pads', kind: 'repair' }),
      ] })}
      canCorrectTicket
      currentProfileId="advisor-1"
      role="advisor"
    />)

    await user.click(screen.getByRole('button', { name: 'Correct job 01: Diagnose brake vibration' }))
    await user.click(screen.getByRole('button', { name: 'Apply replay truth' }))
    const replayed = screen.getByRole('heading', { name: 'Inspect front suspension' }).closest('li')!
    expect(replayed).toHaveAttribute('data-correction-state', 'confirmed')
    expect(within(replayed).getByText('Already saved. The repair order is current.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Correct job 02: Replace front pads' }))
    await user.click(screen.getByRole('button', { name: 'Apply removal truth' }))
    const removed = screen.getByRole('heading', { name: 'Replace front pads' }).closest('li')!
    expect(within(removed).getByText('Removed')).toBeInTheDocument()
    expect(within(removed).getByText('Removed from active work. It remains in History.')).toBeInTheDocument()

    rerender(<TicketDetailScreen
      ticket={ticket()}
      canCorrectTicket
      currentProfileId="advisor-1"
      role="advisor"
    />)
    await user.click(screen.getByRole('button', { name: 'Correct concern' }))
    await user.click(screen.getByRole('button', { name: 'Apply no change' }))
    const unchanged = screen.getByText('Steering wheel shakes under braking from highway speed.').closest(
      '[data-correction-target="concern"]',
    ) as HTMLElement
    expect(within(unchanged).getByText('No change needed')).toBeInTheDocument()
    expect(within(unchanged).queryByTestId('correction-signal-rail')).toBeNull()
    expect(unchanged).not.toHaveAttribute('data-correction-state', 'confirmed')
  })

  it('labels only a validated job_removed correction as Removed after reload', () => {
    const ordinary = job({ id: 'ordinary', title: 'Customer declined pads', kind: 'repair', workStatus: 'canceled', approvalState: 'declined' })
    const corrected = job({ id: 'corrected', title: 'Duplicate inspection', kind: 'repair', workStatus: 'canceled' })
    render(<TicketDetailScreen ticket={ticket({
      jobs: [ordinary, corrected],
      activities: [{
        id: 'activity-removed', jobId: 'corrected', kind: 'ticket_corrected',
        actorName: 'Avery Advisor', summary: 'Duplicate inspection: Removed from active work. It remains in History.',
        correctionScope: 'job_removed', createdAt: timestamp,
      }],
    })} />)

    expect(screen.getByRole('heading', { name: 'Customer declined pads' }).closest('li'))
      .toHaveTextContent('Not doing it')
    expect(screen.getByRole('heading', { name: 'Customer declined pads' }).closest('li'))
      .not.toHaveTextContent('Removed')
    expect(screen.getByRole('heading', { name: 'Duplicate inspection' }).closest('li'))
      .toHaveTextContent('Removed')
  })

  it('keeps the Removed label when its correction receipt has aged out of recent activity', () => {
    const corrected = job({
      id: 'corrected',
      title: 'Duplicate inspection',
      kind: 'repair',
      workStatus: 'canceled',
    })
    render(<TicketDetailScreen ticket={ticket({
      jobs: [corrected],
      activities: [],
      correctedRemovedJobIds: ['corrected'],
    })} />)

    expect(screen.getByRole('heading', { name: 'Duplicate inspection' }).closest('li'))
      .toHaveTextContent('Removed')
  })

  it('keeps the correction controls and detent accessible without decorative motion', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'components/screens/ticket-detail.module.css'),
      'utf8',
    )

    expect(css).toMatch(/\.correctionAction[\s\S]*min-block-size:\s*44px/)
    expect(css).toMatch(/\.correctionAction:focus-visible[\s\S]*outline:/)
    expect(css).toMatch(/\[data-correction-state=['"]confirmed['"]\][\s\S]*200ms var\(--vt-ease-out\)/)
    expect(css).toMatch(/@keyframes correction-detent[\s\S]*translateY\(-2px\)[\s\S]*opacity:\s*\.92[\s\S]*translateY\(0\)[\s\S]*opacity:\s*1/)
    expect(css).toMatch(/\.correctionRail[\s\S]*(inline-size|width):\s*2px/)
    expect(css).toMatch(/scroll-margin/)
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation:\s*none[\s\S]*transform:\s*none[\s\S]*transition:\s*none/)
    expect(css).not.toMatch(/bounce|sparkle|gradient|confetti/i)
  })

  it('keeps the quote entry at least 44px with a visible focus treatment', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'components/screens/ticket-detail.module.css'),
      'utf8',
    )

    expect(css).toMatch(/\.quoteAction[\s\S]*min-block-size:\s*44px/)
    expect(css).toMatch(/\.quoteAction:focus-visible[\s\S]*outline:/)
  })

  it('labels quick_quote source as Quick ticket, not a completed quote', () => {
    render(<TicketDetailScreen ticket={ticket({ source: 'quick_quote' })} />)

    expect(screen.getByText('Open · Quick ticket')).toBeInTheDocument()
    expect(screen.queryByText('Open · Quick quote')).toBeNull()
  })

  it('fails closed for ambiguous contact actions and omits absent optional facts', () => {
    render(
      <TicketDetailScreen
        ticket={ticket({
          customer: {
            id: 'customer-1',
            name: 'Legacy Customer',
            phone: 'Call shop / ask for Lee',
            email: 'lee@example.com?subject=Override',
          },
          vehicle: {
            id: 'vehicle-1',
            year: 2004,
            make: 'Honda',
            model: 'Accord',
            engine: null,
            vin: null,
            mileage: null,
            plate: null,
          },
          diagnosticAuthorizedCents: null,
          diagnosticAuthorizationNote: null,
        })}
      />,
    )

    expect(screen.getByText('Call shop / ask for Lee')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Call shop / ask for Lee' })).toBeNull()
    expect(screen.getByText('lee@example.com?subject=Override')).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'lee@example.com?subject=Override' }),
    ).toBeNull()
    expect(screen.queryByText('VIN')).toBeNull()
    expect(screen.queryByText('Mileage')).toBeNull()
    expect(screen.queryByText('Plate')).toBeNull()
    expect(screen.queryByText('Diagnostic authorization')).toBeNull()
  })

  it('preserves a deliberate phone extension in the dial target', () => {
    render(
      <TicketDetailScreen
        ticket={ticket({
          customer: {
            id: 'customer-1',
            name: 'Marisol Vega',
            phone: '(214) 555-0197 ext. 42',
            email: null,
          },
        })}
      />,
    )

    expect(
      screen.getByRole('link', { name: '(214) 555-0197 ext. 42' }),
    ).toHaveAttribute('href', 'tel:+12145550197;ext=42')
  })

  it('keeps the mobile AppHeader back target at least 44px', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'components/screens/ticket-detail.module.css'),
      'utf8',
    )

    expect(css).toMatch(/:global\(\.app-header__back\)[\s\S]*min-inline-size:\s*44px/)
    expect(css).toMatch(/:global\(\.app-header__back\)[\s\S]*min-block-size:\s*44px/)
  })

  it('preserves job ownership while hiding diagnostic links by default', () => {
    render(
      <TicketDetailScreen
        ticket={ticket({
          jobs: [
            job(),
            job({
              id: 'job-2',
              title: 'Diagnose front brake pulsation',
              kind: 'diagnostic',
              requiredSkillTier: 3,
              assignedTechId: 'tech-1',
              assignedTech: {
                id: 'tech-1',
                fullName: 'Angel Rivera',
                role: 'tech',
                skillTier: 3,
              },
              sessionId: 'session-1',
              workStatus: 'in_progress',
              approvalState: 'approved',
            }),
          ],
        })}
      />,
    )

    const jobs = screen.getAllByRole('listitem')
    expect(jobs).toHaveLength(2)
    expect(within(jobs[0]).getByRole('heading', { name: 'Diagnose brake vibration' })).toBeInTheDocument()
    expect(within(jobs[0]).getByText('Diagnostic · A-tech')).toBeInTheDocument()
    expect(within(jobs[0]).getByText('Open — no technician assigned')).toBeInTheDocument()
    expect(within(jobs[0]).queryByRole('link', { name: 'Open diagnosis' })).toBeNull()

    expect(within(jobs[1]).getByRole('heading', { name: 'Diagnose front brake pulsation' })).toBeInTheDocument()
    expect(within(jobs[1]).getByText('Diagnostic · A-tech')).toBeInTheDocument()
    expect(within(jobs[1]).getByText('Assigned · Angel Rivera')).toBeInTheDocument()
    expect(within(jobs[1]).queryByRole('link', { name: 'Open diagnosis' })).toBeNull()
  })

  it('labels every persisted work and approval state without collapsing them', () => {
    const states = [
      ['open', 'pending_quote', 'Not started', 'No price yet'],
      ['in_progress', 'quote_ready', 'Being worked', 'Priced'],
      ['blocked', 'sent', 'On hold', 'Link opened'],
      ['done', 'approved', 'Finished', 'Approved'],
      ['canceled', 'declined', 'Not doing it', 'Declined'],
    ] as const

    render(
      <TicketDetailScreen
        ticket={ticket({
          jobs: states.map(([workStatus, approvalState], index) =>
            job({
              id: `job-${index + 1}`,
              title: `Job ${index + 1}`,
              workStatus,
              approvalState,
            }),
          ),
        })}
      />,
    )

    const jobs = screen.getAllByRole('listitem')
    states.forEach(([, , workLabel, approvalLabel], index) => {
      expect(within(jobs[index]).getByText(workLabel)).toBeInTheDocument()
      expect(within(jobs[index]).getByText(approvalLabel)).toBeInTheDocument()
    })
  })

  it('links only the assigned actor with complete identity to eligible simple work and history', () => {
    render(<TicketDetailScreen currentProfileId="tech-1" ticket={ticket({
      jobs: [
        job({ id: 'repair-open', title: 'Install lift kit', kind: 'repair', assignedTechId: 'tech-1', workStatus: 'open' }),
        job({ id: 'maintenance-done', title: 'Rotate tires', kind: 'maintenance', assignedTechId: 'tech-1', workStatus: 'done' }),
        job({ id: 'other-work', title: 'Other tech work', kind: 'repair', assignedTechId: 'tech-2', workStatus: 'in_progress' }),
      ],
    })} />)
    expect(screen.getByRole('link', { name: 'Open work' })).toHaveAttribute('href', '/tickets/ticket-1/jobs/repair-open/work')
    expect(screen.getByRole('link', { name: 'View work history' })).toHaveAttribute('href', '/tickets/ticket-1/jobs/maintenance-done/work')
    expect(screen.getByText('Other tech work').closest('li')).not.toHaveTextContent('Continue work')
  })

  it('performs assigned approved work in place and folds confirmed completion into the ledger', async () => {
    const user = userEvent.setup()
    render(<TicketDetailScreen
      role="tech"
      skillTier={2}
      currentProfileId="tech-1"
      currentProfileName="Toni Tech"
      ticket={ticket({ jobs: [job({
        id: 'repair-open',
        title: 'Install lift kit',
        kind: 'repair',
        requiredSkillTier: 2,
        assignedTechId: 'tech-1',
        approvalState: 'approved',
      })] })}
    />)

    expect(screen.queryByRole('link', { name: 'Open work' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Start work' }))
    expect(screen.getByRole('region', { name: 'Inline work workspace' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start work' })).toBeDisabled()
    expect(screen.getByText('Steering wheel shakes under braking from highway speed.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Publish found concern' }))
    expect(screen.getByRole('heading', { name: 'Found: steering clunk' })).toBeInTheDocument()
    expect(screen.getByText('2 jobs')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Publish work state' }))
    expect(screen.getByText('Finished')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^(Start|Continue) work$/ })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Close work' }))
    expect(screen.queryByRole('region', { name: 'Inline work workspace' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Install lift kit' }).closest('li')).toHaveFocus()
  })

  it('keeps a technician’s blocked assigned work on the mounted repair order until it is resolved', async () => {
    const user = userEvent.setup()
    render(<TicketDetailScreen
      role="tech"
      skillTier={2}
      currentProfileId="tech-1"
      ticket={ticket({ jobs: [job({
        id: 'blocked-repair',
        title: 'Install lift kit',
        kind: 'repair',
        assignedTechId: 'tech-1',
        approvalState: 'approved',
        workStatus: 'blocked',
      })] })}
    />)

    const row = screen.getByRole('heading', { name: 'Install lift kit' }).closest('li')!
    expect(within(row).getByRole('button', { name: 'Resolve hold' })).toBeInTheDocument()
    await user.click(within(row).getByRole('button', { name: 'Resolve hold' }))
    expect(within(row).getByText('Being worked')).toBeInTheDocument()
    // Succeeding retires the control that offered it, so the row — not the
    // control — has to be the one that says so.
    expect(within(row).queryByRole('button', { name: 'Resolve hold' })).not.toBeInTheDocument()
    expect(within(row).getByText('Hold resolved.')).toBeInTheDocument()
  })

  it('says a declined line was retired on the row, which outlives the control that retired it', async () => {
    const user = userEvent.setup()
    render(<TicketDetailScreen
      role="advisor"
      skillTier={null}
      currentProfileId="advisor-1"
      ticket={ticket({ jobs: [job({
        id: 'declined-tires',
        title: 'Replace all four tires',
        kind: 'repair',
        approvalState: 'declined',
        workStatus: 'open',
      })] })}
    />)

    const row = screen.getByRole('heading', { name: 'Replace all four tires' }).closest('li')!
    await user.click(within(row).getByRole('button', { name: 'Not doing this one' }))
    expect(within(row).getByText('Not doing it')).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: 'Not doing this one' })).not.toBeInTheDocument()
    expect(within(row).getByText('Dropped. This job was declined.')).toBeInTheDocument()
  })

  it('performs an approved sessionless manual diagnostic in place only while diagnostics are unavailable', () => {
    render(<TicketDetailScreen
      role="tech"
      skillTier={3}
      currentProfileId="tech-1"
      currentProfileName="Toni Tech"
      diagnosticsEntitled={false}
      ticket={ticket({ jobs: [job({
        id: 'manual-diagnostic',
        assignedTechId: 'tech-1',
        approvalState: 'approved',
      })] })}
    />)

    expect(screen.getByRole('button', { name: 'Start work' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /diagnosis/i })).toBeNull()
  })

  it('keeps entitled and session-backed diagnostics out of manual work', () => {
    const diagnostic = job({
      id: 'entitled-diagnostic',
      assignedTechId: 'tech-1',
      approvalState: 'approved',
    })
    const { rerender } = render(<TicketDetailScreen
      role="tech"
      skillTier={3}
      currentProfileId="tech-1"
      diagnosticsEntitled
      ticket={ticket({ jobs: [diagnostic] })}
    />)
    expect(screen.queryByRole('button', { name: 'Start work' })).toBeNull()

    rerender(<TicketDetailScreen
      role="tech"
      skillTier={3}
      currentProfileId="tech-1"
      diagnosticsEntitled={false}
      ticket={ticket({ jobs: [{ ...diagnostic, sessionId: 'session-1' }] })}
    />)
    expect(screen.queryByRole('button', { name: 'Start work' })).toBeNull()
  })

  it('exposes no dead simple-work link when customer or vehicle identity is incomplete', () => {
    render(<TicketDetailScreen currentProfileId="tech-1" ticket={ticket({
      vehicle: null,
      jobs: [job({ title: 'Install lift kit', kind: 'repair', assignedTechId: 'tech-1' })],
    })} />)
    expect(screen.queryByRole('link', { name: 'Open work' })).toBeNull()
  })

  it('exposes no active-work link on a closed ticket while preserving done history', () => {
    render(<TicketDetailScreen currentProfileId="tech-1" ticket={ticket({
      status: 'closed',
      jobs: [
        job({ id: 'stale-open', title: 'Stale open work', kind: 'repair', assignedTechId: 'tech-1', workStatus: 'open' }),
        job({ id: 'closed-history', title: 'Completed work', kind: 'repair', assignedTechId: 'tech-1', workStatus: 'done' }),
      ],
    })} />)
    expect(screen.getByText('Stale open work').closest('li')).not.toHaveTextContent('Open work')
    expect(screen.getByRole('link', { name: 'View work history' })).toHaveAttribute('href', '/tickets/ticket-1/jobs/closed-history/work')
  })

  it('assigns an open job inside its ledger row and reconciles only returned truth', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async () => Response.json({
      assignment: {
        ticketId: 'ticket-1',
        jobId: 'repair-open',
        workStatus: 'open',
        state: 'team',
        assignedTechName: 'Angel Rivera',
        approvalState: 'pending_quote',
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    render(<TicketDetailScreen
      role="advisor"
      currentProfileId="advisor-1"
      currentProfileName="Avery Advisor"
      team={[{ id: 'tech-1', name: 'Angel Rivera', skillTier: 2, isCurrentUser: false }]}
      ticket={ticket({
        jobs: [
          job({ id: 'repair-open', title: 'Install lift kit', kind: 'repair', requiredSkillTier: 2 }),
          job({ id: 'other-open', title: 'Replace wipers', kind: 'maintenance', requiredSkillTier: 1 }),
        ],
      })}
    />)

    const target = screen.getByRole('heading', { name: 'Install lift kit' }).closest('li')!
    const untouched = screen.getByRole('heading', { name: 'Replace wipers' }).closest('li')!
    await user.click(within(target).getByRole('button', { name: 'Assign work' }))
    await user.click(within(target).getByRole('button', { name: /Angel Rivera.*B-tech/i }))

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/tickets/ticket-1/jobs/repair-open/assignment',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringMatching(/^\{"action":"reassign","assignedTechId":"tech-1","requestKey":"[0-9a-f-]+"\}$/),
      }),
    )
    expect(within(target).getByText('Assigned · Angel Rivera')).toBeInTheDocument()
    expect(within(untouched).getByText('Open — no technician assigned')).toBeInTheDocument()
    expect(within(target).queryByRole('button', { name: 'Assign work' })).toBeNull()
    expect(target).toHaveFocus()
  })

  it('lets an eligible technician claim in one tap without exposing the shop roster', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async () => Response.json({
      assignment: {
        ticketId: 'ticket-1',
        jobId: 'repair-open',
        workStatus: 'open',
        state: 'mine',
        assignedTechName: 'Toni Tech',
        approvalState: 'approved',
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    render(<TicketDetailScreen
      role="tech"
      skillTier={2}
      currentProfileId="tech-1"
      currentProfileName="Toni Tech"
      team={[{ id: 'other-tech', name: 'Not visible', skillTier: 3, isCurrentUser: false }]}
      ticket={ticket({ jobs: [job({ id: 'repair-open', title: 'Install lift kit', kind: 'repair', requiredSkillTier: 2, approvalState: 'approved' })] })}
    />)

    await user.click(screen.getByRole('button', { name: 'Claim work' }))

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/tickets/ticket-1/jobs/repair-open/assignment',
      expect.objectContaining({
        body: expect.stringMatching(/^\{"action":"claim","expectedApprovalState":"approved","requestKey":"[0-9a-f-]+"\}$/),
      }),
    )
    expect(screen.getByText('Assigned · Toni Tech')).toBeInTheDocument()
    expect(screen.queryByText('Not visible')).toBeNull()
  })

  it('requires an explicit compact confirmation before a below-tier handoff', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async () => Response.json({
      assignment: {
        ticketId: 'ticket-1',
        jobId: 'repair-open',
        workStatus: 'open',
        state: 'team',
        assignedTechName: 'Casey Climber',
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    render(<TicketDetailScreen
      role="owner"
      currentProfileId="owner-1"
      currentProfileName="Olivia Owner"
      team={[{ id: 'tech-1', name: 'Casey Climber', skillTier: 2, isCurrentUser: false }]}
      ticket={ticket({ jobs: [job({ id: 'repair-open', kind: 'repair', requiredSkillTier: 3 })] })}
    />)

    await user.click(screen.getByRole('button', { name: 'Assign work' }))
    await user.click(screen.getByRole('button', { name: /Casey Climber.*B-tech/i }))

    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByText(/requires an A-tech/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Assign anyway' }))
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/tickets/ticket-1/jobs/repair-open/assignment',
      expect.objectContaining({
        body: expect.stringMatching(/^\{"action":"reassign","assignedTechId":"tech-1","confirmBelowTier":true,"requestKey":"[0-9a-f-]+"\}$/),
      }),
    )
  })

  it('hands active work to an eligible relief technician without making a new page or discarding its state', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async () => Response.json({
      changed: true,
      job: {
        id: 'repair-active', assignedTechId: 'relief-1', workStatus: 'in_progress',
        holdKind: null, holdNote: null, holdResumeStatus: null, heldAt: null,
        heldByProfileId: null, clockedOnSince: null, activeSeconds: 180,
        updatedAt: '2026-07-21T17:00:00.000Z',
      },
    }))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('crypto', { randomUUID: () => '00000000-0000-4000-8000-000000000099' })

    render(<TicketDetailScreen
      role="advisor"
      currentProfileId="advisor-1"
      currentProfileName="Avery Advisor"
      team={[{ id: 'relief-1', name: 'Riley Relief', skillTier: 2, isCurrentUser: false }]}
      ticket={ticket({ jobs: [job({
        id: 'repair-active', title: 'Install lift kit', kind: 'repair', requiredSkillTier: 2,
        assignedTechId: 'tech-1', workStatus: 'in_progress', approvalState: 'approved',
      })] })}
    />)

    const row = screen.getByRole('heading', { name: 'Install lift kit' }).closest('li')!
    await user.click(within(row).getByRole('button', { name: 'Hand off' }))
    await user.click(within(row).getByRole('button', { name: /Riley Relief.*B-tech/i }))

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/tickets/ticket-1/jobs/repair-active/interruption',
      expect.objectContaining({ method: 'POST' }),
    )
    const options = (fetchMock.mock.calls as unknown as [string, RequestInit][])[0][1]
    expect(JSON.parse(String(options.body))).toEqual({
      action: 'handoff', assignedTechId: 'relief-1', requestKey: '00000000-0000-4000-8000-000000000099',
    })
    expect(within(row).getByText('Assigned · Riley Relief')).toBeInTheDocument()
    expect(within(row).getByText('Being worked')).toBeInTheDocument()
  })

  it('lets an advisor cancel and reopen the mounted repair order while reconciling every returned job state', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('crypto', { randomUUID: () => '00000000-0000-4000-8000-000000000098' })
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json({
        changed: true,
        ticket: { id: 'ticket-1', status: 'canceled', jobs: [{ id: 'repair-active', workStatus: 'canceled' }] },
      }))
      .mockResolvedValueOnce(Response.json({
        changed: true,
        ticket: { id: 'ticket-1', status: 'open', jobs: [{ id: 'repair-active', workStatus: 'in_progress' }] },
      })))
    render(<TicketDetailScreen
      role="advisor"
      currentProfileId="advisor-1"
      ticket={ticket({ jobs: [job({
        id: 'repair-active', title: 'Install lift kit', kind: 'repair', assignedTechId: 'tech-1',
        approvalState: 'approved', workStatus: 'in_progress',
      })] })}
    />)

    await user.click(screen.getAllByText('Cancel repair order')[0])
    await user.type(screen.getByLabelText('Cancellation reason'), 'Customer rescheduled.')
    await user.click(screen.getByRole('button', { name: 'Cancel repair order' }))
    expect(await screen.findByText('Canceled · Written up')).toBeInTheDocument()
    expect(screen.getByText('Not doing it')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Reopen repair order' }))
    expect(await screen.findByText('Open · Written up')).toBeInTheDocument()
    expect(screen.getByText('Being worked')).toBeInTheDocument()
  })

  it('keeps the row mounted and shows only the safe winner after a claim race', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      error: 'assignment_conflict',
      currentAssignee: { fullName: 'Morgan Master' },
    }, { status: 409 })))

    render(<TicketDetailScreen
      role="tech"
      skillTier={3}
      currentProfileId="tech-1"
      currentProfileName="Toni Tech"
      ticket={ticket({ jobs: [job({ id: 'repair-open', title: 'Install lift kit', kind: 'repair', requiredSkillTier: 2, approvalState: 'approved' })] })}
    />)

    await user.click(screen.getByRole('button', { name: 'Claim work' }))

    expect(screen.getByRole('heading', { name: 'Install lift kit' })).toBeInTheDocument()
    expect(screen.getByText('Assigned · Morgan Master')).toBeInTheDocument()
    expect(screen.getByText('Morgan Master claimed it first. The repair order is current.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Claim work' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Install lift kit' }).closest('li')).toHaveFocus()
  })

  it('moves zero-dollar closeout into view and folds the returned receipt into the mounted ticket', async () => {
    const user = userEvent.setup()
    const ticketId = '00000000-0000-4000-8000-000000000020'
    const jobId = '00000000-0000-4000-8000-000000000030'
    const ringOut = {
      ticketId,
      status: 'open' as const,
      owed: { subtotalCents: 0, taxCents: 0, totalCents: 0, jobs: [] },
      paidCents: 0,
      balanceCents: 0,
      payments: [],
      canRecordPayment: false,
      canClose: true,
      closedAt: null,
    }
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      ringOut: {
        ...ringOut,
        status: 'closed',
        canClose: false,
        closedAt: '2026-07-20T14:00:00.000Z',
      },
    })))

    render(<TicketDetailScreen
      role="advisor"
      currentProfileId="00000000-0000-4000-8000-000000000010"
      ticket={ticket({
        id: ticketId,
        jobs: [job({
          id: jobId,
          kind: 'repair',
          workStatus: 'done',
          approvalState: 'approved',
        })],
      })}
      ringOut={ringOut}
      customerCopy={customerCopyFixture}
    />)

    await user.click(screen.getByRole('button', { name: 'Customer copy' }))
    await user.click(screen.getByRole('button', { name: 'Close it out' }))
    expect(screen.getByRole('region', { name: 'The bill' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Close repair order' }))

    expect(await screen.findByText('Closed · Written up')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Receipt' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close repair order' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Customer copy preview' })).toBeNull()
    expect(routerRefreshMock).toHaveBeenCalledTimes(1)
  })

  it('closes and disables stale Customer Copy after recording a payment', async () => {
    const user = userEvent.setup()
    const ringOut = {
      ticketId: '00000000-0000-4000-8000-000000000020',
      status: 'open' as const,
      owed: {
        subtotalCents: 10_000,
        taxCents: 0,
        totalCents: 10_000,
        jobs: [{
          jobId: '00000000-0000-4000-8000-000000000030',
          title: 'Brake service',
          subtotalCents: 10_000,
        }],
      },
      paidCents: 0,
      balanceCents: 10_000,
      payments: [],
      canRecordPayment: true,
      canClose: false,
      closedAt: null,
    }
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      ringOut: {
        ...ringOut,
        paidCents: 10_000,
        balanceCents: 0,
        canRecordPayment: false,
        canClose: true,
        payments: [{
          id: '00000000-0000-4000-8000-000000000040', amountCents: 10_000, method: 'cash', note: null,
          recordedAt: '2026-08-02T14:00:00.000Z',
        }],
      },
    })))
    render(<TicketDetailScreen
      role="advisor"
      currentProfileId="advisor-1"
      ticket={ticket({ id: ringOut.ticketId, jobs: [job({ approvalState: 'approved', workStatus: 'done' })] })}
      ringOut={ringOut}
      customerCopy={customerCopyFixture}
    />)

    await user.click(screen.getByRole('button', { name: 'Customer copy' }))
    await user.click(screen.getByRole('button', { name: 'Record payment' }))

    expect(screen.queryByRole('region', { name: 'Customer copy preview' })).toBeNull()
    expect(screen.getByRole('button', { name: /customer copy/i })).toBeDisabled()
    expect(routerRefreshMock).toHaveBeenCalledTimes(1)
  })

  const CANNED_JOB_ID = '00000000-0000-4000-8000-000000000040'
  const CANNED_CLIENT_KEY = '00000000-0000-4000-8000-000000000041'
  const cannedTemplate = {
    id: '00000000-0000-4000-8000-000000000042',
    title: 'Front brake service',
    kind: 'repair',
    defaultRequiredSkillTier: 2,
    sort: 0,
    lines: [{ kind: 'fee', description: 'Shop supplies', sort: 0, priceCents: 500, taxable: true }],
    fingerprint: 'a'.repeat(64),
    summary: { subtotalCents: 500, taxableSubtotalCents: 500, taxCents: 41, totalCents: 541 },
  }
  const cannedTicket = () => ticket({
    jobs: [
      job({
        id: CANNED_JOB_ID, title: 'Front brake service', kind: 'repair',
        requiredSkillTier: 2, approvalState: 'approved', workStatus: 'done',
      }),
      job({
        id: 'unapproved-job', title: 'Replace wipers', kind: 'maintenance',
        requiredSkillTier: 1, approvalState: 'quote_ready',
      }),
    ],
  })

  it('offers the canned-library save only on the approved job, and never to a technician', () => {
    const { rerender } = render(<TicketDetailScreen
      role="owner"
      canManageCannedJobs
      currentProfileId="owner-1"
      currentProfileName="Olivia Owner"
      ticket={cannedTicket()}
    />)

    const approved = screen.getByRole('heading', { name: 'Front brake service' }).closest('li')!
    const unapproved = screen.getByRole('heading', { name: 'Replace wipers' }).closest('li')!
    expect(within(approved).getByRole('button', { name: 'Save as canned job' })).toBeInTheDocument()
    expect(within(unapproved).queryByRole('button', { name: 'Save as canned job' })).toBeNull()

    rerender(<TicketDetailScreen
      role="tech"
      skillTier={2}
      currentProfileId="tech-1"
      currentProfileName="Toni Tech"
      ticket={cannedTicket()}
    />)
    expect(screen.queryByRole('button', { name: 'Save as canned job' })).toBeNull()
  })

  it('files the approved job into the canned library without leaving the repair order', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('crypto', { randomUUID: () => CANNED_CLIENT_KEY })
    const fetchMock = vi.fn(async () => Response.json(
      { changed: true, cannedJob: cannedTemplate },
      { status: 201 },
    ))
    vi.stubGlobal('fetch', fetchMock)

    render(<TicketDetailScreen
      role="owner"
      canManageCannedJobs
      currentProfileId="owner-1"
      currentProfileName="Olivia Owner"
      ticket={cannedTicket()}
    />)

    const row = screen.getByRole('heading', { name: 'Front brake service' }).closest('li')!
    await user.click(within(row).getByRole('button', { name: 'Save as canned job' }))

    expect(fetchMock).toHaveBeenCalledWith('/api/shop/canned-jobs/from-job', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ clientKey: CANNED_CLIENT_KEY, jobId: CANNED_JOB_ID }),
    }))
    expect(await within(row).findByText('Saved to the canned library as “Front brake service”.'))
      .toHaveAttribute('role', 'status')
    expect(within(row).queryByRole('button', { name: 'Save as canned job' })).toBeNull()
    expect(screen.getAllByText('RO 000042').length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { name: 'Replace wipers' })).toBeInTheDocument()
    expect(row).toHaveFocus()
  })

  it('replays one key so a repeat save reads as already saved instead of a second template', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('crypto', { randomUUID: () => CANNED_CLIENT_KEY })
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(Response.json({ changed: false, cannedJob: cannedTemplate }, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    render(<TicketDetailScreen
      role="owner"
      canManageCannedJobs
      currentProfileId="owner-1"
      currentProfileName="Olivia Owner"
      ticket={cannedTicket()}
    />)

    const row = screen.getByRole('heading', { name: 'Front brake service' }).closest('li')!
    await user.click(within(row).getByRole('button', { name: 'Save as canned job' }))
    expect(await within(row).findByText(
      'Could not reach the server. The repair order is unchanged; try again.',
    )).toBeInTheDocument()

    await user.click(within(row).getByRole('button', { name: 'Save as canned job' }))
    expect(await within(row).findByText('Already saved to the canned library as “Front brake service”.'))
      .toBeInTheDocument()

    const keys = (fetchMock.mock.calls as unknown as [string, RequestInit][])
      .map((call) => JSON.parse(String(call[1].body)).clientKey)
    expect(keys).toEqual([CANNED_CLIENT_KEY, CANNED_CLIENT_KEY])
  })

  it('states an owner-only refusal without disturbing the mounted repair order', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('crypto', { randomUUID: () => CANNED_CLIENT_KEY })
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'not_found' }, { status: 404 })))

    render(<TicketDetailScreen
      role="owner"
      canManageCannedJobs
      currentProfileId="owner-1"
      currentProfileName="Olivia Owner"
      ticket={cannedTicket()}
    />)

    const row = screen.getByRole('heading', { name: 'Front brake service' }).closest('li')!
    await user.click(within(row).getByRole('button', { name: 'Save as canned job' }))

    expect(await within(row).findByRole('alert'))
      .toHaveTextContent('Only an owner can add to the canned library.')
    expect(within(row).getByRole('button', { name: 'Save as canned job' })).toBeEnabled()
    expect(screen.getByRole('heading', { name: 'Front brake service' })).toBeInTheDocument()
  })
})
