import { render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TodayJobsBoard } from '@/components/screens/today-jobs-board'
import { isEvidenceReceiptPreviewEnabled } from '@/lib/feature-flags'
import type { TodayTicketJob } from '@/lib/tickets'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

const RECEIPT_REGION = 'Evidence receipt (preview — synthetic data)'
const BANNER = 'SYNTHETIC PREVIEW — not live data, not diagnostic guidance'

const diagnosticJob: TodayTicketJob = {
  id: 'job-diag',
  ticketId: 'ticket-51',
  ticketNumber: 51,
  customerName: 'Morgan Lee',
  vehicle: { year: 2018, make: 'Honda', model: 'Accord' },
  title: 'Trace intermittent no-start',
  kind: 'diagnostic',
  requiredSkillTier: 2,
  sessionId: null,
  workStatus: 'open',
  diagnosticStartState: 'idle',
  diagnosticStartErrorCode: null,
}

const repairJob: TodayTicketJob = {
  ...diagnosticJob,
  id: 'job-repair',
  ticketId: 'ticket-52',
  ticketNumber: 52,
  title: 'Replace front brake pads',
  kind: 'repair',
}

describe('evidence-receipt preview in the diagnostic action slot', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('renders nothing when the flag is off (default): zero behavior change', () => {
    render(<TodayJobsBoard myJobs={[diagnosticJob]} openJobs={[]} />)

    expect(screen.queryByText(BANNER)).toBeNull()
    expect(screen.queryByRole('region', { name: RECEIPT_REGION })).toBeNull()
    // The existing slot action is untouched.
    expect(screen.getByRole('button', { name: 'Start diagnosis' })).toBeInTheDocument()
  })

  it('renders the read-only preview inside the diagnostic job card when flag on and entitled', () => {
    render(
      <TodayJobsBoard
        myJobs={[diagnosticJob]}
        openJobs={[]}
        evidenceReceiptPreview
      />,
    )

    const row = screen.getByRole('article', { name: 'Ticket 51: Trace intermittent no-start' })
    const receipt = within(row).getByRole('region', { name: RECEIPT_REGION })
    expect(within(row).getByText(BANNER)).toBeVisible()
    // Fed from the vendored valid_full.json fixture via the parser.
    expect(receipt).toHaveTextContent('Receipt RCPT-SYNTH-002')
    // The existing action still owns the slot; the preview adds no actions.
    expect(within(row).getByRole('button', { name: 'Start diagnosis' })).toBeInTheDocument()
    expect(
      receipt.querySelectorAll('a, button, input, select, textarea, details, summary'),
    ).toHaveLength(0)
  })

  it('renders nothing without the diagnostics entitlement, and adds no new upsell', () => {
    render(
      <TodayJobsBoard
        myJobs={[diagnosticJob]}
        openJobs={[]}
        diagnosticsEntitled={false}
        evidenceReceiptPreview
      />,
    )

    expect(screen.queryByText(BANNER)).toBeNull()
    expect(screen.queryByRole('region', { name: RECEIPT_REGION })).toBeNull()
    // The only upsell affordance stays the existing Phase 0 line, once.
    expect(screen.getAllByText('Diagnose with AI — add-on')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Record findings' })).toBeInTheDocument()
  })

  it('renders nothing for non-diagnostic jobs and for open (unclaimed) rows', () => {
    render(
      <TodayJobsBoard
        myJobs={[repairJob]}
        openJobs={[{ ...diagnosticJob, id: 'job-open', ticketId: 'ticket-53', ticketNumber: 53 }]}
        evidenceReceiptPreview
      />,
    )

    expect(screen.queryByText(BANNER)).toBeNull()
    expect(screen.queryByRole('region', { name: RECEIPT_REGION })).toBeNull()
  })

  it('makes no fetch/network calls: the fixture is imported statically', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    render(
      <TodayJobsBoard myJobs={[diagnosticJob]} openJobs={[]} evidenceReceiptPreview />,
    )

    expect(screen.getByRole('region', { name: RECEIPT_REGION })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()

    // Belt and braces: no network surface exists anywhere in the feature's
    // source — fixtures reach the UI only through a static import.
    const featureSources = [
      'lib/autoeye/receipt/parse.ts',
      'lib/autoeye/receipt/types.ts',
      'components/screens/evidence-receipt-preview.tsx',
    ].map((file) => readFileSync(join(process.cwd(), file), 'utf8'))
    for (const source of featureSources) {
      expect(source).not.toMatch(/fetch\(|XMLHttpRequest|WebSocket|axios|https?:\/\//)
      expect(source).not.toMatch(/import\(/)
    }
    const board = readFileSync(
      join(process.cwd(), 'components/screens/today-jobs-board.tsx'),
      'utf8',
    )
    expect(board).toMatch(
      /import syntheticReceiptFixture from '@\/lib\/autoeye\/receipt\/fixtures\/valid_full\.json'/,
    )
  })

  it('spans the full job-card width in every responsive layout', () => {
    const css = readFileSync(
      join(process.cwd(), 'components/screens/today-jobs-board.module.css'),
      'utf8',
    )

    expect(css).toMatch(/\.receiptSlot\s*{[^}]*grid-column:\s*1 \/ -1/s)
  })
})

describe('EVIDENCE_RECEIPT_PREVIEW flag convention', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is off by default and only "true" enables it', () => {
    vi.stubEnv('EVIDENCE_RECEIPT_PREVIEW', undefined)
    expect(isEvidenceReceiptPreviewEnabled()).toBe(false)
    vi.stubEnv('EVIDENCE_RECEIPT_PREVIEW', '1')
    expect(isEvidenceReceiptPreviewEnabled()).toBe(false)
    vi.stubEnv('EVIDENCE_RECEIPT_PREVIEW', 'TRUE')
    expect(isEvidenceReceiptPreviewEnabled()).toBe(false)
    vi.stubEnv('EVIDENCE_RECEIPT_PREVIEW', 'true')
    expect(isEvidenceReceiptPreviewEnabled()).toBe(true)
  })
})
