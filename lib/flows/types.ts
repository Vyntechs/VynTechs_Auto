/**
 * Flow content types — authored by the curator UI (PR-N2), pre-filled by the
 * research pipeline (PR-N3), served by the wizard runner (PR-N4).
 *
 * Architecture:
 *  - `Flow` is the immutable body of a `flow_versions` row (the `body` jsonb).
 *  - When the shape changes non-additively, bump `flow_versions.body_schema_version`.
 *
 * Anti-fabrication (PR #98 trust-sweep doctrine + agent-06 pre-mortem):
 *  - Every `Citation` MUST have a non-empty `excerpt` — a real fetched quote.
 *    This is the honest replacement for the fabricated citation ledger #98
 *    removed. PR-N3 synthesis enforces non-empty; PR-N2 renders it inline.
 *  - `Finding.confidence` defaults to 1.0 for deterministic curator findings;
 *    it is a real authored value, NEVER rendered as a fabricated 73/100 dial.
 */

export type EvidenceGrade = 'confirmed' | 'plausible' | 'unverified'

export type Citation = {
  sourceUrl: string
  title: string
  fetchedAt: string // ISO 8601
  /** A direct quote from the source page supporting the claim. Required non-empty UNLESS evidenceGrade==='unverified', in which case it may be empty. */
  excerpt: string
  evidenceGrade: EvidenceGrade
}

export type Conflict = {
  description: string
  sides: Array<{ stance: string; citations: Citation[] }>
}

export type Severity = 'fixable' | 'investigate' | 'next-system'

export type Finding = {
  verdict: string
  action: string
  /** Optional one-sentence observable that confirms the repair worked. */
  expectedSignal?: string
  severity: Severity
  /**
   * 0–1 confidence. Defaults to 1.0 for deterministic curator-authored
   * findings. A real stored value — NOT a rendered confidence dial (#98).
   */
  confidence?: number
}

/**
 * `Answer` is a discriminated union: every answer specifies exactly one of
 * `next` (advance) or `finding` (terminate). The compiler rejects the "stuck
 * answer" (neither) and the ambiguous answer (both).
 */
export type Answer = {
  id: string
  label: string
  /** Optional fragment for the FINDING "how we got here" trail. */
  captured?: string
} & ({ next: string; finding?: never } | { finding: Finding; next?: never })

/**
 * Step kinds (spec §7.1):
 *  - 'question': renders a question + answer buttons.
 *  - 'procedure': renders instructions + a single Next (e.g. "set up the air test").
 */
export type QuestionStep = {
  kind: 'question'
  n: number
  of: number
  title: string
  question: string
  /** Optional animation hint for the wizard's contextual diagram (V2.0 chrome). */
  animation?: StepAnimation
  /** Inline source attribution supporting this step's claims. */
  citations?: Citation[]
  /** Inline AI-source conflicts surfaced for Brandon to arbitrate. */
  conflicts?: Conflict[]
  answers: Answer[]
}

export type ProcedureStep = {
  kind: 'procedure'
  n: number
  of: number
  title: string
  instructions: string
  /** Optional warning/note that must be displayed alongside the procedure. */
  note?: string
  animation?: StepAnimation
  citations?: Citation[]
  conflicts?: Conflict[]
  next: string
}

export type Step = QuestionStep | ProcedureStep

export type StepAnimation = {
  kind:
    | 'wire-pulse'
    | 'wire-glitch'
    | 'snap-throttle'
    | 'pin-focus'
    | 'disconnect'
    | 'highlight'
  target: {
    wire?: string
    comp?: string
    pin?: string
    state?: string
    duration?: number
    interval?: number
    goodState?: string
    badState?: string
  }
  /** When set, the wizard's multimeter overlay renders for this pin. */
  pin?: string
}

export type Flow = {
  startStepId: string
  steps: Record<string, Step>
}

/**
 * Per-session wizard state. Carries flowVersionId so a running session is
 * version-PINNED (spec §3.2) even if a newer version publishes mid-session.
 *
 * NOTE: main's `sessions` table has NO `wizard_state` column today. This type
 * is the shape PR-N4 will persist; N1 only DEFINES it. Do NOT write
 * wizard_state in N1.
 */
export type WizardState = {
  /** The specific flow_versions row this session runs. NEVER changes mid-session. */
  flowVersionId: string
  stepId: string
  history: Array<{
    stepId: string
    answerId: string
    label: string
    title: string
    captured?: string
  }>
  finding: Finding | null
}
