import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InlineWorkWorkspace } from '@/components/screens/inline-work-workspace'

const TICKET = '00000000-0000-4000-8000-000000000020'
const JOB = '00000000-0000-4000-8000-000000000030'
const workspace = {
  id: JOB, title: 'Install lift kit', kind: 'repair' as const, workStatus: 'open' as const,
  workNotes: null, startedAt: null, completedAt: null, clockedOnSince: null, activeSeconds: 0,
  updatedAt: '2026-07-11T12:00:00.000Z', authorization: 'approved' as const,
  approvedScope: {
    authorizationPurpose: null,
    customerSuppliedPartsNote: null,
    lines: [{ kind: 'labor' as const, description: 'Install lift kit', hours: '4.0' }],
  },
}
const ticket = { id: TICKET, number: 7, customerName: 'Morgan Lee', vehicle: '2020 Jeep Wrangler' }

vi.mock('@/components/screens/simple-work-workspace', () => ({
  SimpleWorkWorkspace: (props: {
    initialWorkspace: typeof workspace
    initialPartRequests: unknown[]
    embedded: boolean
    onClose: () => void
    onProjection: (work: { status: 'in_progress' }) => void
    onStale?: () => void
  }) => (
    <section aria-label="Loaded work tool">
      <p>Work loaded {props.initialWorkspace.id}</p>
      <p>Requests {props.initialPartRequests.length}</p>
      <p>Embedded {String(props.embedded)}</p>
      <button type="button" onClick={props.onClose}>Close work</button>
      <button type="button" onClick={() => props.onProjection({ status: 'in_progress' })}>Publish work state</button>
      <button type="button" onClick={props.onStale}>Report stale work</button>
    </section>
  ),
}))

function response(body: unknown, status = 200) {
  return Response.json(body, { status })
}

describe('InlineWorkWorkspace', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('lazy-loads assigned work and text-only part requests through one bounded projection', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onProjection = vi.fn()
    const onStale = vi.fn()
    const fetchMock = vi.fn(async () => response({
      workspace,
      partRequests: [{
        id: '00000000-0000-4000-8000-000000000080', jobId: JOB,
        description: 'Track bar', preference: null, quantity: 1, status: 'requested',
        requestedAt: '2026-07-11T12:01:00.000Z', resolvedAt: null,
      }],
    }))
    vi.stubGlobal('fetch', fetchMock)

    render(<InlineWorkWorkspace
      ticket={ticket}
      jobId={JOB}
      onClose={onClose}
      onProjection={onProjection}
      onStale={onStale}
    />)

    expect(await screen.findByText(`Work loaded ${JOB}`)).toBeInTheDocument()
    expect(screen.getByText('Requests 1')).toBeInTheDocument()
    expect(screen.getByText('Embedded true')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/tickets/${TICKET}/jobs/${JOB}/work`,
      { method: 'GET', cache: 'no-store' },
    )
    await user.click(screen.getByRole('button', { name: 'Publish work state' }))
    expect(onProjection).toHaveBeenCalledWith({ status: 'in_progress' })
    await user.click(screen.getByRole('button', { name: 'Close work' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Report stale work' }))
    expect(onStale).toHaveBeenCalledTimes(1)
  })

  it('fails closed with the repair-order fallback when work truth is malformed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ workspace: { unsafe: true }, partRequests: [] })))

    render(<InlineWorkWorkspace ticket={ticket} jobId={JOB} onClose={vi.fn()} onProjection={vi.fn()} />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Work could not be opened here')
    expect(alert).toHaveFocus()
    expect(screen.getByRole('link', { name: 'Open the full work page' })).toHaveAttribute(
      'href',
      `/tickets/${TICKET}/jobs/${JOB}/work`,
    )
  })

  it('asks Today to refresh when the initial work read says access changed', async () => {
    const onStale = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async () => response({ error: 'not_found' }, 404)))

    render(<InlineWorkWorkspace
      ticket={ticket}
      jobId={JOB}
      onClose={vi.fn()}
      onProjection={vi.fn()}
      onStale={onStale}
    />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Work could not be opened here')
    expect(alert).toHaveFocus()
    expect(onStale).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Retry work' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open the full work page' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })
})
