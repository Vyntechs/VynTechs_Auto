import { z } from 'zod'
import { intakeSchema, outcomeSchema } from './types'
import {
  createSession,
  getProfileByUserId,
  getSessionById,
  appendSessionEvent,
  updateSessionTreeState,
  closeSession,
  setSessionTerminalStatus,
  recordTechAssistRequest,
  listArtifactsForSession,
} from './db/queries'
import type { AppDb } from './db/queries'
import type { TreeState } from './ai/tree-engine'
import type { IntakePayload } from './types'
import type { ValidatorResult } from './ai/outcome-validator'
import type {
  DeclineLanguage,
  DeclineLanguageInput,
} from './gating/decline-language'
import type { Artifact, NewArtifact } from './db/schema'
import { gateProposedAction, type GateDecision } from './gating/gap-handler'
import { HIGH_SIGNAL_KINDS } from './ai/artifact-kinds'
import type { ProposedAction } from './ai/tree-engine'
import { inferSymptomTags, type CorpusPromotionInput } from './corpus/promotion'

export type PromoteToCorpusFn = (
  db: AppDb,
  input: CorpusPromotionInput,
) => Promise<string | null>

export type CreateSessionResult =
  | { ok: true; id: string }
  | { ok: false; status: 400 | 401 | 500; error: string }

export async function createSessionForUser(opts: {
  db: AppDb
  userId: string
  body: unknown
  treeState: TreeState
}): Promise<CreateSessionResult> {
  const profile = await getProfileByUserId(opts.db, opts.userId)
  if (!profile) return { ok: false, status: 400, error: 'no profile' }
  if (!profile.shopId) return { ok: false, status: 400, error: 'no shop' }
  const parsed = intakeSchema.safeParse(opts.body)
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.message }
  }
  const session = await createSession(opts.db, {
    shopId: profile.shopId,
    techId: profile.id,
    intake: parsed.data,
    treeState: opts.treeState,
  })
  return { ok: true, id: session.id }
}

export type GetSessionResult =
  | { ok: true; session: NonNullable<Awaited<ReturnType<typeof getSessionById>>> }
  | { ok: false; status: 400 | 404; error: string }

export async function getSessionForUser(opts: {
  db: AppDb
  userId: string
  sessionId: string
}): Promise<GetSessionResult> {
  const profile = await getProfileByUserId(opts.db, opts.userId)
  if (!profile) return { ok: false, status: 400, error: 'no profile' }
  const session = await getSessionById(opts.db, opts.sessionId)
  if (!session || session.techId !== profile.id) {
    return { ok: false, status: 404, error: 'not found' }
  }
  return { ok: true, session }
}

const advanceSchema = z.object({
  observation: z.string().min(1).max(5000),
})

export type AdvanceSessionResult =
  | { ok: true; tree: TreeState }
  | { ok: false; status: 400 | 401 | 404 | 500; error: string }

export type GateActionFn = (input: {
  db: AppDb
  action: ProposedAction
  vehicleFamily?: string
  symptomClass?: string
}) => Promise<GateDecision>

export type ListArtifactsFn = (db: AppDb, sessionId: string) => Promise<Artifact[]>

export async function advanceSession(opts: {
  db: AppDb
  userId: string
  sessionId: string
  body: unknown
  updateTree: (input: {
    intake: IntakePayload
    currentTree: TreeState
    observation: string
    artifacts?: Array<{
      kind: string
      summary?: string
      structured?: Record<string, unknown>
      text?: string
    }>
    sessionDtcs?: string[]
  }) => Promise<TreeState>
  gateAction?: GateActionFn
  listArtifacts?: ListArtifactsFn
}): Promise<AdvanceSessionResult> {
  const profile = await getProfileByUserId(opts.db, opts.userId)
  if (!profile) return { ok: false, status: 400, error: 'no profile' }

  const session = await getSessionById(opts.db, opts.sessionId)
  if (!session || session.techId !== profile.id) {
    return { ok: false, status: 404, error: 'not found' }
  }
  if (session.status !== 'open') {
    return { ok: false, status: 400, error: 'session is not open' }
  }

  const parsed = advanceSchema.safeParse(opts.body)
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.message }
  }

  // Fetch artifacts for the current node that have completed extraction
  const currentNodeId = session.treeState.currentNodeId
  const listFn = opts.listArtifacts ?? listArtifactsForSession
  const allArtifacts = await listFn(opts.db, opts.sessionId)
  const nodeArtifacts = allArtifacts
    .filter((a) => a.nodeId === currentNodeId && a.extractionStatus === 'done')
    .map((a) => ({
      kind: a.kind,
      summary: a.extraction?.summary,
      structured: a.extraction?.structured,
      text: a.extraction?.text,
    }))

  // Compile DTCs across the whole session (not just the current node) so retrieval
  // keeps its DTC anchor after the tree advances past `scan-codes`. Without this,
  // every observation after scan-codes resolves loses its DTC token, halving cache
  // reuse and degrading Reddit/YouTube/forum retrieval quality.
  const sessionDtcs = allArtifacts
    .filter((a) => a.kind === 'scan_screen' && a.extractionStatus === 'done')
    .flatMap((a) => {
      const codes = (
        a.extraction?.structured as { dtcs?: Array<{ code?: string }> } | undefined
      )?.dtcs
      return Array.isArray(codes)
        ? codes.map((d) => d?.code).filter((c): c is string => typeof c === 'string')
        : []
    })

  let nextTree: TreeState
  try {
    nextTree = await opts.updateTree({
      intake: session.intake,
      currentTree: session.treeState,
      observation: parsed.data.observation,
      artifacts: nodeArtifacts.length > 0 ? nodeArtifacts : undefined,
      sessionDtcs: sessionDtcs.length > 0 ? sessionDtcs : undefined,
    })
  } catch (err) {
    console.error('tree update failed:', err)
    return { ok: false, status: 500, error: 'tree update failed' }
  }

  if (nextTree.proposedAction) {
    const gateFn = opts.gateAction ?? gateProposedAction
    nextTree = {
      ...nextTree,
      gateDecision: await gateFn({
        db: opts.db,
        action: nextTree.proposedAction,
        vehicleFamily: vehicleFamilyKey(session.intake),
        symptomClass: primarySymptomClass(session.intake.customerComplaint),
      }),
    }
  }

  if (
    nextTree.requestedArtifact &&
    (nextTree.requestedArtifact.kind === 'wiring_diagram' ||
      nextTree.requestedArtifact.kind === 'scan_screen')
  ) {
    const audit = await recordTechAssistRequest(opts.db, {
      sessionId: opts.sessionId,
      nodeId: session.treeState.currentNodeId,
      artifactKind: nextTree.requestedArtifact.kind,
      requestPrompt: nextTree.requestedArtifact.prompt,
      gapDescription: nextTree.message.slice(0, 1000),
    })
    if (audit.exhausted) {
      nextTree = {
        ...nextTree,
        requestedArtifact: undefined,
        message: `${nextTree.message} (Rung-2 budget exhausted — consider Decline-or-Defer.)`,
      }
    }
  }

  await appendSessionEvent(opts.db, {
    sessionId: opts.sessionId,
    nodeId: session.treeState.currentNodeId,
    eventType: 'observation',
    observationText: parsed.data.observation,
    aiResponse: { nextNodeId: nextTree.currentNodeId },
  })
  await updateSessionTreeState(opts.db, opts.sessionId, nextTree)

  return { ok: true, tree: nextTree }
}

export type CloseSessionResult =
  | { ok: true }
  | { ok: false; status: 400 | 404; error: string }
  | { ok: false; status: 422; error: 'specificity_required'; feedback: string }

export async function closeSessionForUser(opts: {
  db: AppDb
  userId: string
  sessionId: string
  body: unknown
  validateSpecificity: (text: string) => Promise<ValidatorResult>
  /** Phase K corpus promotion. Optional — when omitted, no promotion runs.
   *  Failures are non-fatal; the session still closes successfully. */
  promoteToCorpus?: PromoteToCorpusFn
}): Promise<CloseSessionResult> {
  const profile = await getProfileByUserId(opts.db, opts.userId)
  if (!profile) return { ok: false, status: 400, error: 'no profile' }

  const session = await getSessionById(opts.db, opts.sessionId)
  if (!session || session.techId !== profile.id) {
    return { ok: false, status: 404, error: 'not found' }
  }
  if (session.status !== 'open') {
    return { ok: false, status: 400, error: 'session is not open' }
  }

  const parsed = outcomeSchema.safeParse(opts.body)
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.message }
  }

  const validation = await opts.validateSpecificity(parsed.data.rootCause)
  if (!validation.ok) {
    return {
      ok: false,
      status: 422,
      error: 'specificity_required',
      feedback: validation.feedback ?? 'Be more specific.',
    }
  }

  await closeSession(opts.db, opts.sessionId, parsed.data)
  await appendSessionEvent(opts.db, {
    sessionId: opts.sessionId,
    nodeId: session.treeState.currentNodeId,
    eventType: 'close',
  })

  if (opts.promoteToCorpus) {
    try {
      const arts = await listArtifactsForSession(opts.db, opts.sessionId)
      const extractedDtcs = arts.flatMap((a) => {
        if (a.extractionStatus !== 'done') return []
        const structured = a.extraction?.structured as
          | { dtcs?: Array<{ code?: string }> }
          | undefined
        return structured?.dtcs?.map((d) => d.code).filter((c): c is string => Boolean(c)) ?? []
      })
      const extractedSymptomTags = inferSymptomTags(session.intake.customerComplaint)
      await opts.promoteToCorpus(opts.db, {
        sessionId: opts.sessionId,
        shopId: session.shopId,
        intake: session.intake,
        outcome: parsed.data,
        extractedDtcs,
        extractedSymptomTags,
      })
    } catch (err) {
      console.warn('corpus promotion failed (session still closed):', err)
    }
  }

  return { ok: true }
}

type CaptureKind = Artifact['kind']
const ALLOWED_CAPTURE_KINDS = ['photo', 'video', 'audio', 'scan_screen', 'wiring_diagram'] as Array<CaptureKind>
export const MAX_CAPTURE_BYTES = 25 * 1024 * 1024 // 25 MB

export type CaptureArtifactResult =
  | { ok: true; artifactId: string; storageKey: string; kind: CaptureKind; extractionStatus: 'pending' | 'done' | 'failed' }
  | { ok: false; status: 400 | 404; error: string }

export async function captureArtifact(opts: {
  db: AppDb
  userId: string
  sessionId: string
  kind: string
  nodeId?: string
  file: { bytes: Uint8Array; mimeType: string; size: number }
  durationMs?: number
  uploadArtifact: (input: {
    sessionId: string
    kind: CaptureKind
    bytes: Uint8Array
    mimeType: string
  }) => Promise<string>
  createArtifact: (db: AppDb, input: NewArtifact) => Promise<string>
  /** Optional: auto-run extraction for high-signal kinds inline after capture.
   *  Injected so existing tests remain unaffected (omit = no auto-extraction). */
  processExtraction?: (db: AppDb, artifactId: string) => Promise<void>
}): Promise<CaptureArtifactResult> {
  const profile = await getProfileByUserId(opts.db, opts.userId)
  if (!profile) return { ok: false, status: 400, error: 'no profile' }

  const session = await getSessionById(opts.db, opts.sessionId)
  if (!session || session.techId !== profile.id) {
    return { ok: false, status: 404, error: 'not found' }
  }
  if (session.status !== 'open') {
    return { ok: false, status: 400, error: 'session not open' }
  }

  if (!ALLOWED_CAPTURE_KINDS.includes(opts.kind as CaptureKind)) {
    return { ok: false, status: 400, error: 'invalid kind' }
  }
  const kind = opts.kind as CaptureKind

  if (opts.file.size === 0 || opts.file.size > MAX_CAPTURE_BYTES) {
    return { ok: false, status: 400, error: 'invalid size' }
  }

  const nodeId = opts.nodeId ?? session.treeState.currentNodeId

  // Upload receives the FULL mimeType (with codec) so storage object metadata is accurate.
  const storageKey = await opts.uploadArtifact({
    sessionId: opts.sessionId,
    kind,
    bytes: opts.file.bytes,
    mimeType: opts.file.mimeType,
  })

  // DB column stores only the base MIME type — codec parameters (e.g. ;codecs=opus)
  // are stripped so consumers (vision.ts MIME gate, etc.) see a clean value.
  const baseMimeType = opts.file.mimeType.split(';')[0].trim()
  const artifactId = await opts.createArtifact(opts.db, {
    sessionId: opts.sessionId,
    nodeId,
    kind,
    storageKey,
    mimeType: baseMimeType,
    bytes: opts.file.size,
    durationMs: opts.durationMs,
    extractionStatus: 'pending',
  })

  // Auto-extract inline for high-signal kinds when a processor is injected.
  // On failure: log and continue — the artifact exists; the tech can retry
  // via POST /api/artifacts/:id/extract.
  let extractionStatus: 'pending' | 'done' | 'failed' = 'pending'
  if (opts.processExtraction && HIGH_SIGNAL_KINDS.has(kind)) {
    try {
      await opts.processExtraction(opts.db, artifactId)
      extractionStatus = 'done'
    } catch (err) {
      console.error(`[captureArtifact] inline extraction failed for ${artifactId}:`, err)
      extractionStatus = 'failed'
    }
  }

  return { ok: true, artifactId, storageKey, kind, extractionStatus }
}

function vehicleFamilyKey(intake: IntakePayload): string {
  return `${intake.vehicleMake.toLowerCase()}-${intake.vehicleModel.toLowerCase()}`
}

function primarySymptomClass(complaint: string): string {
  const text = complaint.toLowerCase()
  if (/power|stall|hesit|sluggish|underboost|boost/.test(text)) return 'power_loss'
  if (/start|crank|no.?start/.test(text)) return 'starting_issue'
  if (/misfire|rough/.test(text)) return 'misfire'
  if (/overheat|temp/.test(text)) return 'overheat'
  return '*'
}

const declineOrDeferSchema = z.object({
  reason: z.enum(['decline', 'defer']),
  gap: z.string().min(5).max(2000),
  riskClass: z.enum(['low', 'medium', 'high', 'destructive']),
})

export type DeclineOrDeferSessionResult =
  | { ok: true; status: 'declined' | 'deferred'; language: DeclineLanguage }
  | { ok: false; status: 400 | 404 | 500; error: string }

export async function declineOrDeferSessionForUser(opts: {
  db: AppDb
  userId: string
  sessionId: string
  body: unknown
  generateLanguage: (input: DeclineLanguageInput) => Promise<DeclineLanguage>
}): Promise<DeclineOrDeferSessionResult> {
  const profile = await getProfileByUserId(opts.db, opts.userId)
  if (!profile) return { ok: false, status: 400, error: 'no profile' }

  const session = await getSessionById(opts.db, opts.sessionId)
  if (!session || session.techId !== profile.id) {
    return { ok: false, status: 404, error: 'not found' }
  }
  if (session.status !== 'open') {
    return { ok: false, status: 400, error: 'session is not open' }
  }

  const parsed = declineOrDeferSchema.safeParse(opts.body)
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.message }
  }

  const engine = session.intake.vehicleEngine ? ` (${session.intake.vehicleEngine})` : ''
  const vehicleSummary = `${session.intake.vehicleYear} ${session.intake.vehicleMake} ${session.intake.vehicleModel}${engine}`

  let language: DeclineLanguage
  try {
    language = await opts.generateLanguage({
      vehicleSummary,
      complaint: session.intake.customerComplaint,
      gap: parsed.data.gap,
      riskClass: parsed.data.riskClass,
      reason: parsed.data.reason,
    })
  } catch (err) {
    console.error('decline language generation failed:', err)
    return { ok: false, status: 500, error: 'language generation failed' }
  }

  const terminalStatus = parsed.data.reason === 'decline' ? 'declined' : 'deferred'
  await setSessionTerminalStatus(opts.db, opts.sessionId, terminalStatus)
  await appendSessionEvent(opts.db, {
    sessionId: opts.sessionId,
    nodeId: session.treeState.currentNodeId,
    eventType: 'close',
    aiResponse: {
      declineOrDefer: {
        reason: parsed.data.reason,
        gap: parsed.data.gap,
        riskClass: parsed.data.riskClass,
        language,
      },
    },
  })

  return { ok: true, status: terminalStatus, language }
}
