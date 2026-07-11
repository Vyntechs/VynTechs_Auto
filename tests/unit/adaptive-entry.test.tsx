import fs from 'node:fs'
import path from 'node:path'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdaptiveCoverage } from '@/lib/diagnostics/adaptive/contracts'

const {
  refreshMock,
  authMock,
  sessionMock,
  routeMock,
  wizardMock,
  eligibilityMock,
  reconcileMock,
  coverageMock,
  topologyMock,
  dbMock,
} = vi.hoisted(() => {
  const eventQuery = {
    from: vi.fn(() => ({
      where: vi.fn(() => ({ orderBy: vi.fn(async () => []) })),
    })),
  }
  return {
    refreshMock: vi.fn(),
    authMock: vi.fn(),
    sessionMock: vi.fn(),
    routeMock: vi.fn(),
    wizardMock: vi.fn(),
    eligibilityMock: vi.fn(),
    reconcileMock: vi.fn(),
    coverageMock: vi.fn(),
    topologyMock: vi.fn(),
    dbMock: { select: vi.fn(() => eventQuery) },
  }
})

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
  notFound: vi.fn(() => { throw new Error('not-found') }),
  redirect: vi.fn((target: string) => { throw new Error(`redirect:${target}`) }),
}))
vi.mock('@/lib/db/client', () => ({ db: dbMock }))
vi.mock('@/lib/supabase-server', () => ({ getServerSupabase: vi.fn(async () => ({})) }))
vi.mock('@/lib/auth', () => ({ requireUserAndProfile: authMock }))
vi.mock('@/lib/sessions', () => ({ getSessionForUser: sessionMock }))
vi.mock('@/lib/session-routing', () => ({ routeForSession: routeMock }))
vi.mock('@/lib/flows/interception', () => ({ resolveWizardInterception: wizardMock }))
vi.mock('@/lib/diagnostics/adaptive/eligibility', () => ({ getAdaptiveEligibility: eligibilityMock }))
vi.mock('@/lib/diagnostics/reconcile-seeded-symptom', () => ({ reconcileSeededSymptom: reconcileMock }))
vi.mock('@/lib/diagnostics/adaptive/coverage', () => ({ resolveAdaptiveCoverage: coverageMock }))
vi.mock('@/lib/diagnostics/load-system-topology', () => ({ loadSystemTopology: topologyMock }))
vi.mock('@/lib/diagnostics/topology-layout', () => ({ layoutTopology: vi.fn(() => ({ nodes: [] })) }))
vi.mock('@/components/screens/active-session', () => ({
  ActiveSession: () => <div>Active session surface</div>,
}))
vi.mock('@/components/screens/curator-guided-wizard', () => ({
  CuratorGuidedWizard: () => <div>Published wizard surface</div>,
}))
vi.mock('@/components/screens/topology-diagnostic', () => ({
  TopologyDiagnostic: () => <div>Topology diagnostic surface</div>,
}))

import { AdaptiveDiagnosticEntry } from '@/components/screens/adaptive-diagnostic-entry'
import SessionPage from '@/app/(app)/sessions/[id]/page'

const proof = {
  componentIds: ['00000000-0000-4000-8000-000000000001'],
  testActionIds: ['00000000-0000-4000-8000-000000000002'],
  branchLogicIds: [],
  verifiedAxes: ['exact:engine'],
}

function coverage(overrides: Partial<AdaptiveCoverage> = {}): AdaptiveCoverage {
  return {
    state: 'exact',
    system: 'fuel',
    symptomSlug: 'p0087-fuel-rail-pressure-too-low',
    reasons: ['Direct topology and instructional proof are field-verified.'],
    technicianInstructionsAvailable: true,
    instructionProof: proof,
    ...overrides,
  }
}

function renderEntry(adaptiveCoverage = coverage(), onSelected = vi.fn()) {
  return {
    onSelected,
    ...render(
      <AdaptiveDiagnosticEntry
        sessionId="session-9"
        concern="Loses fuel pressure under load"
        vehicleName="2018 Ford F-250 · 6.7L Power Stroke"
        coverage={adaptiveCoverage}
        onSelected={onSelected}
      />,
    ),
  }
}

describe('AdaptiveDiagnosticEntry', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    refreshMock.mockReset()
  })

  it('renders the vehicle, customer concern, and honest coverage truth', () => {
    renderEntry()

    expect(screen.getByText('2018 Ford F-250 · 6.7L Power Stroke')).toBeInTheDocument()
    expect(screen.getByText('Loses fuel pressure under load')).toBeInTheDocument()
    expect(screen.getByText(/exact verified/i)).toBeInTheDocument()
    expect(screen.getByText(/fuel system/i)).toBeInTheDocument()
  })

  it.each(['draft', 'unsupported'] as const)(
    'offers only the equal-status manual path for %s coverage',
    (state) => {
      renderEntry(coverage({
        state,
        technicianInstructionsAvailable: false,
        instructionProof: null,
        reasons: ['Technician instructions are not published for this application.'],
      }))

      expect(screen.queryByRole('button', { name: /guide me/i })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /i've got it/i })).toBeInTheDocument()
    },
  )

  it('contains no AI branding or forced step counter', () => {
    renderEntry()
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/\bAI\b/i)
    expect(text).not.toMatch(/step\s+\d+\s+of\s+\d+/i)
  })

  it('does not interpolate an undefined CSS-module class', () => {
    const source = fs.readFileSync(path.join(
      process.cwd(),
      'components/screens/adaptive-diagnostic-entry.tsx',
    ), 'utf8')

    expect(source).not.toContain('styles.guided')
  })

  it('announces pending state and persists guided selection before refreshing', async () => {
    let resolveRequest!: (response: Response) => void
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => (
      new Promise<Response>((resolve) => { resolveRequest = resolve })
    ))
    const onSelected = vi.fn()
    renderEntry(coverage(), onSelected)

    fireEvent.click(screen.getByRole('button', { name: /guide me/i }))

    expect(screen.getByRole('status')).toHaveTextContent(/opening guided diagnosis/i)
    expect(screen.getByRole('button', { name: /guide me/i })).toBeDisabled()
    resolveRequest(new Response(JSON.stringify({ state: { mode: 'guided' }, revision: 1 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await waitFor(() => expect(refreshMock).toHaveBeenCalledOnce())
    expect(onSelected).toHaveBeenCalledWith('guided')
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body).toMatchObject({ mode: 'guided', expectedRevision: 0 })
    expect(body.requestKey).toMatch(/^[0-9a-f-]{36}$/i)
  })

  it('keeps a successful selection locked until refresh replaces the mounted surface', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ state: { mode: 'guided' }, revision: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    renderEntry()

    const guided = screen.getByRole('button', { name: /guide me/i })
    const manual = screen.getByRole('button', { name: /i've got it/i })
    fireEvent.click(guided)

    await waitFor(() => expect(refreshMock).toHaveBeenCalledOnce())
    expect(guided).toBeDisabled()
    expect(manual).toBeDisabled()

    fireEvent.click(guided)
    fireEvent.click(manual)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('announces a recoverable error and keeps one request key across retry', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: { mode: 'manual' }, revision: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
    renderEntry()

    const manual = screen.getByRole('button', { name: /i've got it/i })
    fireEvent.click(manual)
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not confirm/i)
    fireEvent.click(manual)

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(2))
    const first = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    const retry = JSON.parse(String(fetchMock.mock.calls[1][1]?.body))
    expect(retry.requestKey).toBe(first.requestKey)
  })

  it('reconciles an ambiguous guided failure and permits only the identical keyed retry', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: { mode: 'guided' }, revision: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
    renderEntry()

    const guided = screen.getByRole('button', { name: /guide me/i })
    fireEvent.click(guided)

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not confirm/i)
    expect(refreshMock).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: /i've got it/i })).toBeDisabled()
    expect(guided).toBeEnabled()

    fireEvent.click(guided)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const first = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    const retry = JSON.parse(String(fetchMock.mock.calls[1][1]?.body))
    expect(retry.mode).toBe('guided')
    expect(retry.requestKey).toBe(first.requestKey)
  })

  it('keeps both controls touch-sized, visibly focusable, responsive, and motion-safe', () => {
    const css = fs.readFileSync(path.join(
      process.cwd(),
      'components/screens/adaptive-diagnostic-entry.module.css',
    ), 'utf8')

    const choiceRule = css.match(/\.choice\s*\{([^}]*)\}/)?.[1] ?? ''
    const choiceMinHeight = Number(choiceRule.match(/min-height:\s*(\d+)px/)?.[1])
    expect(choiceMinHeight).toBeGreaterThanOrEqual(44)
    expect(css).toMatch(/:focus-visible/)
    expect(css).toMatch(/outline:/)
    expect(css).toMatch(/@media\s*\([^)]*max-width:\s*600px/)
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/)
  })

  it('runs the guided trace once and leaves reduced-motion users a resolved static trace', () => {
    const css = fs.readFileSync(path.join(
      process.cwd(),
      'components/screens/adaptive-diagnostic-entry.module.css',
    ), 'utf8')
    const traceRule = css.match(/\.trace path\s*\{([^}]*)\}/)?.[1] ?? ''
    const reducedMotion = css.match(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*)\}\s*$/,
    )?.[1] ?? ''

    expect(traceRule).toMatch(/animation:[^;]+\s1(?:\s|;)/)
    expect(traceRule).not.toMatch(/infinite/)
    expect(reducedMotion).toMatch(/\.trace path[\s\S]*animation:\s*none/)
    expect(reducedMotion).toMatch(/stroke-dashoffset:\s*0/)
  })
})

const baseSession = {
  id: 'session-9',
  status: 'open',
  intake: {
    vehicleYear: 2018,
    vehicleMake: 'Ford',
    vehicleModel: 'F-250',
    vehicleEngine: '6.7L Power Stroke',
    customerComplaint: 'P0087 loses fuel pressure under load',
  },
  wizardState: null,
  adaptiveDiagnosticState: null,
}

async function renderSessionPage() {
  render(await SessionPage({ params: Promise.resolve({ id: 'session-9' }) }))
}

describe('adaptive session-page routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue({
      user: { id: 'user-9' },
      profile: { id: 'profile-9', shopId: 'shop-9' },
    })
    sessionMock.mockResolvedValue({ ok: true, session: { ...baseSession } })
    routeMock.mockReturnValue({ kind: 'active' })
    wizardMock.mockResolvedValue(null)
    eligibilityMock.mockResolvedValue({ eligible: true, jobId: 'job-9', ticketId: 'ticket-9' })
    reconcileMock.mockResolvedValue('p0087-fuel-rail-pressure-too-low')
    coverageMock.mockResolvedValue(coverage())
    topologyMock.mockResolvedValue({ system: 'fuel' })
  })

  it('keeps the published wizard first and does not evaluate adaptive eligibility', async () => {
    wizardMock.mockResolvedValue({
      flowVersionId: 'flow-version-9',
      versionNumber: 1,
      body: {},
      newerVersionAvailable: false,
    })
    await renderSessionPage()

    expect(screen.getByText('Published wizard surface')).toBeInTheDocument()
    expect(eligibilityMock).not.toHaveBeenCalled()
    expect(topologyMock).not.toHaveBeenCalled()
  })

  it('preserves the legacy topology branch when adaptive mode is off or ineligible', async () => {
    eligibilityMock.mockResolvedValue({ eligible: false, reason: 'flag_off' })
    await renderSessionPage()

    expect(screen.getByText('Topology diagnostic surface')).toBeInTheDocument()
    expect(coverageMock).not.toHaveBeenCalled()
    expect(topologyMock).toHaveBeenCalledOnce()
  })

  it('preserves the legacy ActiveSession fallthrough when legacy topology is absent', async () => {
    eligibilityMock.mockResolvedValue({ eligible: false, reason: 'not_ticket_backed' })
    topologyMock.mockResolvedValue(null)
    await renderSessionPage()

    expect(screen.getByText('Active session surface')).toBeInTheDocument()
    expect(topologyMock).toHaveBeenCalledOnce()
  })

  it('renders entry for eligible null state without loading topology', async () => {
    await renderSessionPage()

    expect(screen.getByText('Diagnostic orientation')).toBeInTheDocument()
    expect(topologyMock).not.toHaveBeenCalled()
  })

  it.each([
    ['draft', 'p0087-fuel-rail-pressure-too-low'],
    ['unsupported', 'p0087-fuel-rail-pressure-too-low'],
    ['unsupported', null],
  ] as const)('routes persisted manual %s coverage with symptom %s to ActiveSession', async (state, symptom) => {
    sessionMock.mockResolvedValue({
      ok: true,
      session: { ...baseSession, adaptiveDiagnosticState: { mode: 'manual' } },
    })
    reconcileMock.mockResolvedValue(symptom)
    coverageMock.mockResolvedValue(coverage({
      state,
      symptomSlug: symptom ?? 'unresolved',
      technicianInstructionsAvailable: false,
      instructionProof: null,
    }))
    await renderSessionPage()

    expect(screen.getByText('Active session surface')).toBeInTheDocument()
    expect(topologyMock).not.toHaveBeenCalled()
  })

  it('does not load topology for proof-open persisted guided state', async () => {
    sessionMock.mockResolvedValue({
      ok: true,
      session: { ...baseSession, adaptiveDiagnosticState: { mode: 'guided' } },
    })
    coverageMock.mockResolvedValue(coverage({
      technicianInstructionsAvailable: false,
      instructionProof: null,
    }))
    await renderSessionPage()

    expect(screen.getByText('Active session surface')).toBeInTheDocument()
    expect(topologyMock).not.toHaveBeenCalled()
  })

  it('loads topology only for proof-closed persisted guided state', async () => {
    sessionMock.mockResolvedValue({
      ok: true,
      session: { ...baseSession, adaptiveDiagnosticState: { mode: 'guided' } },
    })
    await renderSessionPage()

    expect(screen.getByText('Topology diagnostic surface')).toBeInTheDocument()
    expect(topologyMock).toHaveBeenCalledOnce()
  })

  it('resolves eligibility and coverage before any adaptive topology load while retaining a legacy branch', () => {
    const source = fs.readFileSync(path.join(
      process.cwd(),
      'app/(app)/sessions/[id]/page.tsx',
    ), 'utf8')

    expect(source.indexOf('getAdaptiveEligibility(')).toBeLessThan(source.indexOf('resolveAdaptiveCoverage('))
    expect(source.indexOf('resolveAdaptiveCoverage(')).toBeLessThan(source.indexOf('loadSystemTopology('))
    expect(source).toMatch(/adaptiveDiagnosticState[^\n]*===?\s*null[\s\S]*<AdaptiveDiagnosticEntry/)
    expect(source).toMatch(/mode\s*===\s*['"]guided['"][\s\S]*loadSystemTopology\([\s\S]*<ActiveSession/)
    expect(source.match(/loadSystemTopology\(/g)).toHaveLength(2)
  })
})
