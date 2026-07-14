import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseEvidenceReceipt } from '@/lib/autoeye/receipt/parse'

const FIXTURES_DIR = join(process.cwd(), 'lib/autoeye/receipt/fixtures')

const VALID_FIXTURES = [
  'valid_minimal.json',
  'valid_full.json',
  'valid_blocked.json',
  'valid_unsupported.json',
  'valid_synthetic_shop_platform_case.json',
] as const

function loadFixture(name: (typeof VALID_FIXTURES)[number]): unknown {
  // Raw bytes from disk: the vendored fixtures are consumed exactly as the
  // canonical AUTOEYE repo ships them, never re-serialized.
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf8'))
}

function tamper(mutate: (receipt: Record<string, any>) => void): unknown {
  const receipt = loadFixture('valid_full.json') as Record<string, any>
  mutate(receipt)
  return receipt
}

describe('parseEvidenceReceipt — vendored contract v0 fixtures', () => {
  it.each(VALID_FIXTURES)('accepts %s byte-for-byte', (name) => {
    const data = loadFixture(name)
    const result = parseEvidenceReceipt(data)

    expect(result).toEqual({ ok: true, receipt: data })
  })
})

describe('parseEvidenceReceipt — tampered receipts are rejected whole', () => {
  it('never yields a partial receipt on failure', () => {
    const result = parseEvidenceReceipt(tamper((receipt) => delete receipt.derived))

    expect(result.ok).toBe(false)
    expect('receipt' in result).toBe(false)
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(0)
  })

  it('rejects non-object inputs', () => {
    expect(parseEvidenceReceipt(null).ok).toBe(false)
    expect(parseEvidenceReceipt([]).ok).toBe(false)
    expect(parseEvidenceReceipt('{"contract_version":"0"}').ok).toBe(false)
    expect(parseEvidenceReceipt(undefined).ok).toBe(false)
  })

  it('rejects an unknown top-level key', () => {
    const result = parseEvidenceReceipt(tamper((receipt) => {
      receipt.vendor_extension = { anything: true }
    }))

    expect(result).toEqual({
      ok: false,
      errors: ['receipt: unknown key "vendor_extension"'],
    })
  })

  it('rejects a smuggled diagnosis key at the top level', () => {
    const result = parseEvidenceReceipt(tamper((receipt) => {
      receipt.diagnosis = 'restricted fuel supply'
    }))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toContain('receipt: unknown key "diagnosis"')
  })

  it('rejects a smuggled diagnosis key nested inside derived', () => {
    const result = parseEvidenceReceipt(tamper((receipt) => {
      receipt.derived.diagnosis = { ranked_causes: ['fuel pump'], confidence: 0.9 }
    }))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toContain('derived: unknown key "diagnosis"')
  })

  it('rejects an unknown key smuggled into an evidence item', () => {
    const result = parseEvidenceReceipt(tamper((receipt) => {
      receipt.evidence[0].confidence = 0.95
    }))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toContain('evidence[0]: unknown key "confidence"')
  })

  it('rejects any contract_version other than the const "0"', () => {
    for (const version of ['1', '0.1', 0, null]) {
      const result = parseEvidenceReceipt(tamper((receipt) => {
        receipt.contract_version = version
      }))
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.errors.some((e) => e.startsWith('contract_version: must be "0"'))).toBe(true)
      }
    }
  })

  it.each([
    'contract_version',
    'receipt_id',
    'tenant_id',
    'case_id',
    'created_from',
    'status',
    'evidence',
    'derived',
    'rights_summary',
    'blocked_or_unsupported',
  ])('rejects a receipt missing required section "%s"', (section) => {
    const result = parseEvidenceReceipt(tamper((receipt) => delete receipt[section]))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContain(`receipt: missing required section "${section}"`)
    }
  })

  it('rejects a missing derived subsection', () => {
    const result = parseEvidenceReceipt(tamper((receipt) => {
      delete receipt.derived.descriptive_absences
    }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContain('derived: missing required section "descriptive_absences"')
    }
  })

  it('rejects provenance carrying both observed_at and tested_at', () => {
    const result = parseEvidenceReceipt(tamper((receipt) => {
      receipt.evidence[0].provenance.tested_at = '2026-07-01T09:00:00Z'
    }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContain(
        'evidence[0].provenance: exactly one of observed_at or tested_at is required',
      )
    }
  })

  it('requires a measurement payload iff the category is first_party_measurement', () => {
    const missing = parseEvidenceReceipt(tamper((receipt) => {
      delete receipt.evidence[6].measurement
    }))
    expect(missing.ok).toBe(false)

    const smuggled = parseEvidenceReceipt(tamper((receipt) => {
      receipt.evidence[0].measurement = { value: '1', units: 'psi', conditions: 'idle' }
    }))
    expect(smuggled.ok).toBe(false)
    if (!smuggled.ok) {
      expect(smuggled.errors).toContain(
        'evidence[0]: only first_party_measurement may carry a measurement',
      )
    }
  })

  it('rejects a contradiction that references evidence not present in the receipt', () => {
    const result = parseEvidenceReceipt(tamper((receipt) => {
      receipt.derived.contradictions[0].evidence_ids = ['EV-SYNTH-005', 'EV-SYNTH-999']
    }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContain(
        'derived.contradictions[0].evidence_ids: "EV-SYNTH-999" is not an evidence item in this receipt',
      )
    }
  })

  it('rejects a contradiction with fewer than two evidence references', () => {
    const result = parseEvidenceReceipt(tamper((receipt) => {
      receipt.derived.contradictions[0].evidence_ids = ['EV-SYNTH-005']
    }))

    expect(result.ok).toBe(false)
  })

  it('rejects rights_status incoherent with the source class', () => {
    const result = parseEvidenceReceipt(tamper((receipt) => {
      // CUSTOMER_REPORT carries reported-not-observed clean-original rights.
      receipt.evidence[0].rights_status = 'RIGHTS.FIRST_PARTY_OBSERVED'
    }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(
        result.errors.some((e) => e.includes('rights_status incoherent with source_class')),
      ).toBe(true)
    }
  })

  it('rejects quarantined/rejected rights values inside evidence entirely', () => {
    const result = parseEvidenceReceipt(tamper((receipt) => {
      receipt.evidence[0].rights_status = 'RIGHTS.QUARANTINED'
    }))

    expect(result.ok).toBe(false)
  })

  it('rejects a non-completed receipt with no blocked_or_unsupported entry', () => {
    const blocked = loadFixture('valid_blocked.json') as Record<string, any>
    blocked.blocked_or_unsupported = []

    const result = parseEvidenceReceipt(blocked)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContain(
        'status "blocked": requires at least one blocked_or_unsupported entry',
      )
    }
  })

  it('rejects silent discard: dropped accounting no longer reconciles input_item_count', () => {
    const result = parseEvidenceReceipt(tamper((receipt) => {
      // valid_full: 7 evidence + 1 input_item blocked entry == 8 inputs.
      // Silently discarding the blocked entry breaks the arithmetic.
      receipt.blocked_or_unsupported = []
    }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('does not reconcile'))).toBe(true)
    }
  })

  it('rejects absences out of canonical (category, description) order', () => {
    const result = parseEvidenceReceipt(tamper((receipt) => {
      receipt.derived.descriptive_absences.reverse()
    }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(
        result.errors.some((e) => e.includes('not in canonical (category, description) sort order')),
      ).toBe(true)
    }
  })

  it('rejects a rights_summary that does not equal the evidence audit values', () => {
    const result = parseEvidenceReceipt(tamper((receipt) => {
      receipt.rights_summary.source_classes = ['CUSTOMER_REPORT']
    }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(
        result.errors.some((e) =>
          e.startsWith('rights_summary.source_classes: does not equal'),
        ),
      ).toBe(true)
    }
  })

  it('rejects an invalid absence category outside the closed enum', () => {
    const result = parseEvidenceReceipt(tamper((receipt) => {
      receipt.derived.descriptive_absences[0].category = 'recommended_next_test'
    }))

    expect(result.ok).toBe(false)
  })
})
