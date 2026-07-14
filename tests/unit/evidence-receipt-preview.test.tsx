import { render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EvidenceReceiptPreview } from '@/components/screens/evidence-receipt-preview'

const FIXTURES_DIR = join(process.cwd(), 'lib/autoeye/receipt/fixtures')

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf8'))
}

const BANNER = 'SYNTHETIC PREVIEW — not live data, not diagnostic guidance'

describe('EvidenceReceiptPreview — valid_full receipt', () => {
  it('shows the synthetic banner and the receipt envelope', () => {
    render(<EvidenceReceiptPreview receiptData={loadFixture('valid_full.json')} />)

    expect(screen.getByText(BANNER)).toBeVisible()
    expect(
      screen.getByRole('heading', { name: 'Evidence receipt (preview — synthetic data)' }),
    ).toBeVisible()
    expect(
      screen.getByText(
        'Receipt RCPT-SYNTH-002 · Case CAS-SYNTH-002 · Contract v0 · Status completed',
      ),
    ).toBeVisible()
  })

  it('renders typed evidence grouped by category with provenance', () => {
    render(<EvidenceReceiptPreview receiptData={loadFixture('valid_full.json')} />)
    const evidence = screen.getByRole('region', { name: 'Typed evidence' })

    for (const heading of [
      'Reported concern',
      'Operating context',
      'DTC family',
      'Scan observation',
      'Physical observation',
      'Completed test result',
      'First-party measurement',
    ]) {
      expect(within(evidence).getByRole('heading', { name: heading })).toBeInTheDocument()
    }
    expect(
      within(evidence).getByText('Customer reports rough running at idle after a cold start.'),
    ).toBeVisible()
    // Provenance: source class, reporter role, observed/tested time.
    expect(
      within(evidence).getByText(
        'EV-SYNTH-003 · scan tool output · technician · observed 2026-07-01T09:30:00Z',
      ),
    ).toBeVisible()
    expect(
      within(evidence).getByText(
        'EV-SYNTH-007 · first-party measurement · technician · tested 2026-07-01T10:15:00Z',
      ),
    ).toBeVisible()
    // Measurement preserved with units and conditions, never interpreted.
    expect(
      within(evidence).getByText('52 psi — engine idling at operating temperature; synthetic bench case'),
    ).toBeVisible()
    expect(within(evidence).queryByText(/within specification|pass|fail/i)).toBeNull()
  })

  it('renders known facts and contradictions with the evidence they reference', () => {
    render(<EvidenceReceiptPreview receiptData={loadFixture('valid_full.json')} />)

    const facts = screen.getByRole('region', { name: 'Known facts' })
    expect(
      within(facts).getByText(
        'A lean-family generic powertrain code and positive long-term fuel trim at idle were both recorded.',
      ),
    ).toBeVisible()
    expect(within(facts).getByText('evidence EV-SYNTH-003, EV-SYNTH-004')).toBeVisible()

    const contradictions = screen.getByRole('region', { name: 'Contradictions' })
    expect(
      within(contradictions).getByText(
        'The completed intake smoke test reports no leaks found, while a physical observation describes a hissing sound near the intake at idle.',
      ),
    ).toBeVisible()
    expect(within(contradictions).getByText('evidence EV-SYNTH-005, EV-SYNTH-006')).toBeVisible()
  })

  it('renders material unknowns and descriptive absences as plain bulleted text', () => {
    render(<EvidenceReceiptPreview receiptData={loadFixture('valid_full.json')} />)

    const unknowns = screen.getByRole('region', { name: 'Material unknowns' })
    expect(
      within(unknowns).getByText(
        /The fuel quality and recent refueling history for this synthetic case are unknown\./,
      ),
    ).toBeVisible()

    const absences = screen.getByRole('region', { name: 'Descriptive absences' })
    expect(within(absences).getAllByRole('listitem')).toHaveLength(2)
    expect(
      within(absences).getByText(
        /No completed-test evidence covering fuel-supply volume is present in the supplied inputs\./,
      ),
    ).toBeVisible()
  })

  it('displays absences alphabetically, independent of receipt position', () => {
    const receipt = loadFixture('valid_full.json') as Record<string, any>
    // Canonical contract order is (category, description); this pair makes
    // that order differ from alphabetical-by-description display order.
    receipt.derived.descriptive_absences = [
      {
        category: 'completed_test_evidence',
        description:
          'No completed-test evidence covering fuel-supply volume is present in the supplied inputs.',
      },
      {
        category: 'measurement_evidence',
        description: 'A reading of intake manifold vacuum is absent from the supplied inputs.',
      },
    ]
    render(<EvidenceReceiptPreview receiptData={receipt} />)

    const absences = screen.getByRole('region', { name: 'Descriptive absences' })
    const items = within(absences).getAllByRole('listitem').map((li) => li.textContent ?? '')
    expect(items[0]).toContain('A reading of intake manifold vacuum')
    expect(items[1]).toContain('No completed-test evidence covering fuel-supply volume')
  })

  it('gives absences no action semantics: no interactive roles, no ordering emphasis', () => {
    render(<EvidenceReceiptPreview receiptData={loadFixture('valid_full.json')} />)

    for (const name of ['Material unknowns', 'Descriptive absences']) {
      const section = screen.getByRole('region', { name })
      expect(within(section).queryAllByRole('button')).toHaveLength(0)
      expect(within(section).queryAllByRole('link')).toHaveLength(0)
      expect(within(section).queryAllByRole('checkbox')).toHaveLength(0)
      expect(within(section).queryAllByRole('textbox')).toHaveLength(0)
      expect(
        section.querySelectorAll('a, button, input, select, textarea, details, summary, ol'),
      ).toHaveLength(0)
      // Unordered bulleted text, uniform styling: every item is a <li> of a
      // single <ul>, with no numbering prefix.
      const lists = within(section).getAllByRole('list')
      expect(lists).toHaveLength(1)
      expect(lists[0].tagName).toBe('UL')
      for (const item of within(section).getAllByRole('listitem')) {
        expect(item.textContent).not.toMatch(/^\s*\d/)
      }
    }
  })

  it('contains no interactive element anywhere in the receipt section', () => {
    render(<EvidenceReceiptPreview receiptData={loadFixture('valid_full.json')} />)

    const receipt = screen.getByRole('region', {
      name: 'Evidence receipt (preview — synthetic data)',
    })
    expect(
      receipt.querySelectorAll('a, button, input, select, textarea, details, summary'),
    ).toHaveLength(0)
  })

  it('keeps blocked/unsupported entries visible with state and reason', () => {
    render(<EvidenceReceiptPreview receiptData={loadFixture('valid_full.json')} />)

    const blocked = screen.getByRole('region', { name: 'Blocked or unsupported' })
    expect(
      within(blocked).getByText('Unsupported — threshold interpretation requested'),
    ).toBeVisible()
    expect(
      within(blocked).getByText(
        'input item: typed input item asking whether the recorded fuel rail pressure reading is within specification',
      ),
    ).toBeVisible()
  })

  it('renders a fully blocked receipt with its reason still visible', () => {
    render(<EvidenceReceiptPreview receiptData={loadFixture('valid_blocked.json')} />)

    const blocked = screen.getByRole('region', { name: 'Blocked or unsupported' })
    expect(within(blocked).getByText('Blocked — rights unclear')).toBeVisible()
    expect(within(blocked).getByText('request: entire case input')).toBeVisible()
  })

  it('renders the rights/lifecycle summary line', () => {
    render(<EvidenceReceiptPreview receiptData={loadFixture('valid_full.json')} />)

    const region = screen.getByRole('region', {
      name: 'Evidence receipt (preview — synthetic data)',
    })
    expect(region).toHaveTextContent(
      'Rights RIGHTS.CLEAN_ORIGINAL, RIGHTS.FIRST_PARTY_OBSERVED · Sources customer report, ' +
        'first-party measurement, first-party observation, scan tool output, shop system record · ' +
        'Lifecycle NORMALIZED',
    )
  })
})

describe('EvidenceReceiptPreview — non-conforming receipt', () => {
  it('renders only the unavailable state, never a partial receipt', () => {
    const receipt = loadFixture('valid_full.json') as Record<string, any>
    receipt.diagnosis = 'restricted fuel supply'
    render(<EvidenceReceiptPreview receiptData={receipt} />)

    expect(screen.getByText(BANNER)).toBeVisible()
    expect(
      screen.getByText('Receipt unavailable — does not conform to contract v0.'),
    ).toBeVisible()
    expect(screen.queryByText(/RCPT-SYNTH-002/)).toBeNull()
    expect(screen.queryByText(/Customer reports rough running/)).toBeNull()
    expect(screen.queryByRole('region', { name: 'Typed evidence' })).toBeNull()
    // The smuggled guidance never renders.
    expect(screen.queryByText(/restricted fuel supply/)).toBeNull()
  })
})
