import { z } from 'zod'

export type DiagnosticMode = 'guided' | 'manual'
export type CoverageState = 'exact' | 'verified_equivalent' | 'partial' | 'draft' | 'unsupported'

export type AdaptiveCoverage = {
  state: CoverageState
  system: string
  symptomSlug: string
  reasons: string[]
  sourcePlatformSlug?: string
  technicianInstructionsAvailable: boolean
  instructionProof: {
    componentIds: string[]
    testActionIds: string[]
    branchLogicIds: string[]
    verifiedAxes: string[]
  } | null
}

export type AdaptiveEvidencePayload = {
  schemaVersion: 1
  kind: 'observation' | 'measurement' | 'topology_result'
  text: string
  testActionId?: string
  scenarioSlug?: string
  value?: number
  unit?: string
  verdict?: 'ok' | 'warn' | 'fail' | 'impossible' | 'cannot_perform'
}

export type AdaptiveFindingDraft = {
  verdict: string
  recommendation: string
  expectedSignal?: string
  severity: 'fixable' | 'investigate' | 'next-system'
  confidence: number
  sourceEventIds: string[]
  sourceArtifactIds: string[]
  unresolvedGaps: string[]
}

export type AdaptiveDiagnosticState = {
  schemaVersion: 1
  mode: DiagnosticMode
  coverage: AdaptiveCoverage
  currentTestActionId: string | null
  finding: AdaptiveFindingDraft | null
}

const coverageSchema = z.object({
  state: z.enum(['exact', 'verified_equivalent', 'partial', 'draft', 'unsupported']),
  system: z.string().trim().min(1).max(100),
  symptomSlug: z.string().trim().min(1).max(200),
  reasons: z.array(z.string().trim().min(1).max(500)).max(20),
  sourcePlatformSlug: z.string().trim().min(1).max(200).optional(),
  technicianInstructionsAvailable: z.boolean().default(false),
  instructionProof: z.object({
    componentIds: z.array(z.uuid()).min(1),
    testActionIds: z.array(z.uuid()).min(1),
    branchLogicIds: z.array(z.uuid()),
    verifiedAxes: z.array(z.string().trim().min(1)).min(1),
  }).nullable().default(null),
}).superRefine((coverage, ctx) => {
  const nonInstructional = coverage.state === 'partial'
    || coverage.state === 'draft'
    || coverage.state === 'unsupported'

  if (nonInstructional && (coverage.technicianInstructionsAvailable || coverage.instructionProof)) {
    ctx.addIssue({
      code: 'custom',
      message: 'non-instructional coverage cannot instruct technicians',
    })
  }
  if (coverage.technicianInstructionsAvailable && !coverage.instructionProof) {
    ctx.addIssue({ code: 'custom', message: 'instruction availability requires proof' })
  }
  if (!coverage.technicianInstructionsAvailable && coverage.instructionProof) {
    ctx.addIssue({ code: 'custom', message: 'instruction proof requires availability' })
  }
})

export const adaptiveDiagnosticStateSchema = z.object({
  schemaVersion: z.literal(1),
  mode: z.enum(['guided', 'manual']),
  coverage: coverageSchema,
  currentTestActionId: z.uuid().nullable(),
  finding: z.object({
    verdict: z.string().trim().min(1).max(2_000),
    recommendation: z.string().trim().min(1).max(2_000),
    expectedSignal: z.string().trim().min(1).max(1_000).optional(),
    severity: z.enum(['fixable', 'investigate', 'next-system']),
    confidence: z.number().min(0).max(1),
    sourceEventIds: z.array(z.uuid()).max(100),
    sourceArtifactIds: z.array(z.uuid()).max(100),
    unresolvedGaps: z.array(z.string().trim().min(1).max(1_000)).max(50),
  }).nullable(),
})
