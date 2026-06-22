import { describe, it, expect } from 'vitest'
import { dedupBranchesByVerdict } from '@/lib/diagnostics/load-system-topology'
import type { TopologyBranch } from '@/lib/diagnostics/load-system-topology'

// Minimal branch-shaped objects — only the fields dedupBranchesByVerdict reads.
// TopologyBranch has no sourceProvenance; the helper reads it from the raw DB
// row shape, so we define a local type matching what's passed in.
type RawBranch = TopologyBranch & { sourceProvenance: string }

function make(verdict: string, provenance: string): RawBranch {
  return {
    condition: 'any',
    verdict,
    nextAction: 'none',
    routesToTestActionId: null,
    reasoning: null,
    sourceProvenance: provenance,
  }
}

describe('dedupBranchesByVerdict', () => {
  it('keeps a single branch unchanged', () => {
    const input = [make('pass', 'TRAINING-CONFIRMED')]
    const result = dedupBranchesByVerdict(input)
    expect(result).toHaveLength(1)
    expect(result[0].verdict).toBe('pass')
  })

  it('keeps two branches with different verdicts', () => {
    const input = [make('pass', 'TRAINING-CONFIRMED'), make('fail', 'TRAINING-INFERRED')]
    const result = dedupBranchesByVerdict(input)
    expect(result).toHaveLength(2)
    const verdicts = result.map((b) => b.verdict).sort()
    expect(verdicts).toEqual(['fail', 'pass'])
  })

  it('keeps the higher-provenance branch when two share a verdict (FIELD-VERIFIED > TRAINING-CONFIRMED)', () => {
    const lower = make('pass', 'TRAINING-CONFIRMED')
    const higher = make('pass', 'FIELD-VERIFIED')
    const result = dedupBranchesByVerdict([lower, higher])
    expect(result).toHaveLength(1)
    expect((result[0] as RawBranch).sourceProvenance).toBe('FIELD-VERIFIED')
  })

  it('keeps the higher-provenance branch regardless of input order (stable)', () => {
    const lower = make('fail', 'TRAINING-INFERRED')
    const higher = make('fail', 'TRAINING-CONFIRMED')
    // Try both orderings — result must be the same.
    const r1 = dedupBranchesByVerdict([lower, higher])
    const r2 = dedupBranchesByVerdict([higher, lower])
    expect(r1).toHaveLength(1)
    expect(r2).toHaveLength(1)
    expect((r1[0] as RawBranch).sourceProvenance).toBe('TRAINING-CONFIRMED')
    expect((r2[0] as RawBranch).sourceProvenance).toBe('TRAINING-CONFIRMED')
  })

  it('respects the full provenance order: FIELD-VERIFIED > TRAINING-CONFIRMED > TRAINING-INFERRED > GAP', () => {
    const gap = make('neutral', 'GAP')
    const inferred = make('neutral', 'TRAINING-INFERRED')
    const confirmed = make('neutral', 'TRAINING-CONFIRMED')
    const field = make('neutral', 'FIELD-VERIFIED')
    // Shuffle input
    const result = dedupBranchesByVerdict([gap, confirmed, field, inferred])
    expect(result).toHaveLength(1)
    expect((result[0] as RawBranch).sourceProvenance).toBe('FIELD-VERIFIED')
  })

  it('uses first-seen as stable tiebreak when provenance is equal', () => {
    const first = { ...make('pass', 'TRAINING-CONFIRMED'), condition: 'first' }
    const second = { ...make('pass', 'TRAINING-CONFIRMED'), condition: 'second' }
    const result = dedupBranchesByVerdict([first, second])
    expect(result).toHaveLength(1)
    expect(result[0].condition).toBe('first')
  })

  it('deduplicates across multiple verdicts independently', () => {
    const input = [
      make('pass', 'GAP'),
      make('pass', 'FIELD-VERIFIED'),
      make('fail', 'TRAINING-INFERRED'),
      make('fail', 'TRAINING-CONFIRMED'),
      make('neutral', 'GAP'),
    ]
    const result = dedupBranchesByVerdict(input)
    expect(result).toHaveLength(3)
    const byVerdict = Object.fromEntries(
      result.map((b) => [b.verdict, (b as RawBranch).sourceProvenance]),
    )
    expect(byVerdict['pass']).toBe('FIELD-VERIFIED')
    expect(byVerdict['fail']).toBe('TRAINING-CONFIRMED')
    expect(byVerdict['neutral']).toBe('GAP')
  })
})
