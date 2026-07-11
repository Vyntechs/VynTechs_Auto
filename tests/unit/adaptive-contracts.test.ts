import { describe, expect, it } from 'vitest'
import { adaptiveDiagnosticStateSchema } from '@/lib/diagnostics/adaptive/contracts'

const proof = {
  componentIds: ['10000000-0000-4000-8000-000000000001'],
  testActionIds: ['10000000-0000-4000-8000-000000000002'],
  branchLogicIds: ['10000000-0000-4000-8000-000000000003'],
  verifiedAxes: ['fuel-system'],
}

function state(coverage: Record<string, unknown>) {
  return {
    schemaVersion: 1,
    mode: 'guided',
    coverage: {
      state: 'exact',
      system: 'fuel',
      symptomSlug: 'p0087',
      reasons: [],
      ...coverage,
    },
    currentTestActionId: null,
    finding: null,
  }
}

describe('adaptive diagnostic contracts', () => {
  it('accepts one versioned guided state', () => {
    expect(adaptiveDiagnosticStateSchema.parse(state({})).mode).toBe('guided')
  })

  it.each(['partial', 'draft', 'unsupported']) (
    'rejects %s coverage that claims technician instructions are available',
    (coverageState) => {
      expect(() => adaptiveDiagnosticStateSchema.parse(state({
        state: coverageState,
        technicianInstructionsAvailable: true,
        instructionProof: proof,
      }))).toThrow(/non-instructional coverage cannot instruct technicians/)
    },
  )

  it('rejects instruction availability without proof', () => {
    expect(() => adaptiveDiagnosticStateSchema.parse(state({
      technicianInstructionsAvailable: true,
      instructionProof: null,
    }))).toThrow(/instruction availability requires proof/)
  })

  it('rejects instruction proof when instructions are unavailable', () => {
    expect(() => adaptiveDiagnosticStateSchema.parse(state({
      technicianInstructionsAvailable: false,
      instructionProof: proof,
    }))).toThrow(/instruction proof requires availability/)
  })

  it('accepts proof-closed exact coverage', () => {
    const parsed = adaptiveDiagnosticStateSchema.parse(state({
      technicianInstructionsAvailable: true,
      instructionProof: proof,
    }))

    expect(parsed.coverage.instructionProof).toEqual(proof)
  })
})
