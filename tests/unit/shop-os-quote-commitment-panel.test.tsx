import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { QuoteCommitmentPanel } from '@/components/screens/quote-commitment-panel'
import {
  parseQuoteBuilderProjection,
  summarizeQuoteMoney,
  type QuotePreparationState,
} from '@/lib/shop-os/quote-builder-ui'

const JOB_ID = '00000000-0000-4000-8000-000000000201'
const VERSION_ID = '00000000-0000-4000-8000-000000000401'
const COMMITMENT = {
  algorithm: 'quote-draft-v1-sha256' as const,
  fingerprint: 'a'.repeat(64),
  totalCents: 10_825,
  jobCount: 1,
  lineCount: 1,
}

function draftBuilder() {
  return parseQuoteBuilderProjection({
    ticket: { id: '00000000-0000-4000-8000-000000000101', status: 'open', reconciled: true },
    configuration: {
      laborRateCents: null, taxRateBps: 825, partsMarkupBps: null,
      laborRateConfigured: false, taxRateConfigured: true,
    },
    jobs: [{
      id: JOB_ID, title: 'Brake service', kind: 'repair', workStatus: 'open',
      canEdit: true,
      story: { content: null, source: null, reviewStatus: null, revision: 0 },
      storyMode: null,
      decisionEligible: false,
      approval: { state: 'pending_quote', quoteVersionId: null },
      lines: [{
        id: '00000000-0000-4000-8000-000000000301', kind: 'part', description: 'Front pads',
        sort: 0, quantity: '1', priceCents: 10_000, taxable: true,
        partNumber: null, brand: null, coreChargeCents: null, fitment: null,
        laborHours: null, laborRateCents: null, source: 'manual', mutable: true,
        lineFingerprint: 'c'.repeat(64),
      }],
    }],
    capabilities: {
      canPrepareQuote: true,
      canRecordCustomerApproval: true,
      canCreateCustomerApprovalLink: true,
    },
    activeVersion: null,
    lastPreparedVersion: null,
    draftCommitment: COMMITMENT,
  })!
}

function preparedBuilder() {
  const draft = draftBuilder()
  return {
    ...draft,
    activeVersion: {
      id: VERSION_ID,
      versionNumber: 3,
      totalCents: 10_825,
      contentFingerprint: 'b'.repeat(64),
      jobs: [{ jobId: JOB_ID, subtotalCents: 10_000 }],
    },
    lastPreparedVersion: {
      id: VERSION_ID,
      versionNumber: 3,
      totalCents: 10_825,
      contentFingerprint: 'b'.repeat(64),
      state: 'current' as const,
    },
    draftCommitment: null,
  }
}

function renderPanel(overrides: Partial<React.ComponentProps<typeof QuoteCommitmentPanel>> = {}) {
  const builder = draftBuilder()
  const props: React.ComponentProps<typeof QuoteCommitmentPanel> = {
    builder,
    totals: summarizeQuoteMoney(builder.jobs[0].lines, 825),
    preparation: { kind: 'ready', reasons: [] },
    editorDirty: false,
    preparing: false,
    confirmation: null,
    preparedFocusRef: vi.fn(),
    onOpenPrepare: vi.fn(),
    onCancelPrepare: vi.fn(),
    onConfirmPrepare: vi.fn(),
    ...overrides,
  }
  return { ...render(<QuoteCommitmentPanel {...props} />), props }
}

function primaryActions(): HTMLElement[] {
  return screen.queryAllByRole('button').filter((button) => (
    button.getAttribute('data-primary-action') === 'true'
  ))
}

describe('QuoteCommitmentPanel', () => {
  it('shows exact never-prepared draft truth with one filled action', () => {
    renderPanel()

    expect(screen.getByRole('complementary', { name: 'Quote totals' })).toHaveAttribute('data-rail-static', 'false')
    expect(screen.getByRole('heading', { name: 'Current draft' })).toBeInTheDocument()
    expect(screen.getByText('Customer has not received this')).toBeInTheDocument()
    expect(screen.getByText('$108.25')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Prepare quote' })).toBeEnabled()
    expect(primaryActions()).toEqual([screen.getByRole('button', { name: 'Prepare quote' })])
  })

  it('omits every Prepare affordance when the server denies ticket-wide preparation', () => {
    const builder = {
      ...draftBuilder(),
      capabilities: { ...draftBuilder().capabilities, canPrepareQuote: false },
    }
    renderPanel({ builder, confirmation: COMMITMENT })

    expect(screen.queryByRole('button', { name: /Prepare/i })).toBeNull()
    expect(screen.queryByRole('dialog', { name: 'Prepare this exact quote?' })).toBeNull()
    expect(primaryActions()).toHaveLength(0)
  })

  it('shows only immutable current prepared truth and current-version actions', () => {
    const preparedActions = <button type="button">Copy V3 customer link</button>
    renderPanel({
      builder: preparedBuilder(),
      preparation: { kind: 'prepared', version: { id: VERSION_ID, versionNumber: 3 } },
      preparedActions,
    })

    expect(screen.getByRole('heading', { name: 'Prepared V3' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Quote totals' })).toHaveAttribute('data-rail-static', 'false')
    expect(screen.getByText('$108.25')).toBeInTheDocument()
    expect(screen.queryByText(/Current draft|Customer has not received/i)).toBeNull()
    expect(screen.getByRole('button', { name: 'Copy V3 customer link' })).toBeInTheDocument()
  })

  it('keeps the prepared version current while local editor intent is unsaved', () => {
    renderPanel({
      builder: preparedBuilder(),
      preparation: { kind: 'prepared', version: { id: VERSION_ID, versionNumber: 3 } },
      editorDirty: true,
    })

    expect(screen.getByRole('heading', { name: 'Prepared V3 remains current' })).toBeInTheDocument()
    expect(screen.getByText('Unsaved line changes')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Prepare/i })).toBeNull()
  })

  it('separates a durable revised draft from its last prepared history', () => {
    const builder = {
      ...draftBuilder(),
      lastPreparedVersion: {
        id: VERSION_ID,
        versionNumber: 3,
        totalCents: 9_000,
        contentFingerprint: 'b'.repeat(64),
        state: 'superseded' as const,
      },
    }
    renderPanel({ builder })

    expect(screen.getByRole('heading', { name: 'Current draft' })).toBeInTheDocument()
    expect(screen.getByText('V3 no longer current')).toBeInTheDocument()
    expect(screen.getByText('Current total')).toBeInTheDocument()
    expect(screen.getByText('$108.25')).toBeInTheDocument()
    expect(screen.getByText('Last prepared total')).toBeInTheDocument()
    expect(screen.getByText('$90.00')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /V3 customer/i })).toBeNull()
    expect(screen.getByRole('complementary', { name: 'Quote totals' })).toHaveAttribute('data-rail-static', 'false')
  })

  it('keeps the phone rail static only while an occluding surface owns the action', () => {
    const { rerender, props } = renderPanel({ railStatic: true })
    expect(screen.getByRole('complementary', { name: 'Quote totals' })).toHaveAttribute('data-rail-static', 'true')

    rerender(<QuoteCommitmentPanel {...props} railStatic={false} confirmation={COMMITMENT} />)
    expect(screen.getByRole('complementary', { name: 'Quote totals' })).toHaveAttribute('data-rail-static', 'true')
  })

  it('restates frozen composition before explicit preparation', () => {
    const onCancelPrepare = vi.fn()
    const onConfirmPrepare = vi.fn()
    renderPanel({
      confirmation: COMMITMENT,
      onCancelPrepare,
      onConfirmPrepare,
    })

    const dialog = screen.getByRole('dialog', { name: 'Prepare this exact quote?' })
    expect(within(dialog).getByText('1 job · 1 line')).toBeInTheDocument()
    expect(within(dialog).getByText('Customer will see $108.25')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Prepare $108.25' }))
    expect(onCancelPrepare).toHaveBeenCalledOnce()
    expect(onConfirmPrepare).toHaveBeenCalledOnce()
    expect(primaryActions()).toEqual([within(dialog).getByRole('button', { name: 'Prepare $108.25' })])
  })

  it('keeps the confirmed amount visible without claiming a version while pending', () => {
    renderPanel({ confirmation: COMMITMENT, preparing: true })

    expect(screen.getByText('Customer will see $108.25')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Preparing $108.25…' })).toBeDisabled()
    expect(screen.queryByText(/Prepared V/)).toBeNull()
  })

  it('lists every preparation blocker without rendering disabled primary theater', () => {
    const preparation: QuotePreparationState = {
      kind: 'blocked',
      reasons: ['Add customer and vehicle.', 'Review stored quote amounts.'],
    }
    renderPanel({ preparation })

    expect(screen.getByText('Add customer and vehicle.')).toBeInTheDocument()
    expect(screen.getByText('Review stored quote amounts.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Prepare quote' })).toBeNull()
    expect(primaryActions()).toHaveLength(0)
  })
})
