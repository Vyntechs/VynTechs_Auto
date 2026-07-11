import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { intakeSchema, outcomeSchema } from './types'
import type { AmbientConditions } from './types'
import {
  getProfileByUserId,
  getSessionById,
  appendSessionEvent,
  updateSessionTreeState,
  updateSessionIntake,
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
import { sessions, sessionEvents, ticketJobs, tickets } from './db/schema'
import {
  createTechQuickTicketInTransaction,
  type CreateTechQuickTicketInput,
} from './tickets'
import { gateProposedAction, type GateDecision } from './gating/gap-handler'
import { HIGH_SIGNAL_KINDS } from './ai/artifact-kinds'
import type { ProposedAction } from './ai/tree-engine'
import { inferSymptomTags, type CorpusPromotionInput } from './corpus/promotion'
import type {
  RecordDiagnosticSessionInput,
  RecordDiagnosticSessionResult,
} from './diagnostics/record-diagnostic-session'
import type { ScheduleFollowUpsFn } from './comeback/schedule'
import type { RepairGuidanceResult, RepairGuidancePromptInput } from './ai/repair-guidance'
import type { AdvanceStreamEvent } from './advance-stream-events'
import type { Finding, WizardState } from './flows/types'
import { synthesizeHandoffFromFinding } from './wizard-state'
import { isShopRole } from './shop-os/capabilities'
import {
  lockDiagnosticRepairAccess,
  resolveDiagnosticRepairAccess,
} from './shop-os/repair-authorization'
import { isLockUnavailable } from './shop-os/quotes'
type EnqueueIfNovelPatternFn = (db: AppDb, sessionId: string, maxSimilarity: number) => Promise<void>

export type PromoteToCorpusFn = (
  db: AppDb,
  input: CorpusPromotionInput,
) => Promise<string | null>

export type RecordDiagnosticOutcomeFn = (
  db: AppDb,
  input: RecordDiagnosticSessionInput,
) => Promise<RecordDiagnosticSessionResult>

export type CreateSessionResult =
  | { ok: true; id: string; ticketId: string; jobId: string }
  | { ok: false; status: 400 | 401 | 500; error: string }

const createSessionBodySchema = intakeSchema.extend({ requestKey: z.uuid() }).strict()

export type CreateSessionWrapper = (
  tx: AppDb,
  input: CreateTechQuickTicketInput,
) => Promise<{ ticketId: string; jobId: string }>

type ValidatedSessionCreation = {
  profileId: string
  shopId: string
  skillTier: 1 | 2 | 3
  requestKey: string
  intake: IntakePayload
}

async function validateSessionCreationRequest(opts: {
  db: AppDb
  userId: string
  body: unknown
}): Promise<
  | { ok: true; value: ValidatedSessionCreation }
  | { ok: false; status: 400; error: string }
> {
  const profile = await getProfileByUserId(opts.db, opts.userId)
  if (!profile) return { ok: false, status: 400, error: 'no profile' }
  if (!profile.shopId) return { ok: false, status: 400, error: 'no shop' }
  if (
    !isShopRole(profile.role) ||
    profile.membershipStatus !== 'active' ||
    profile.deactivatedAt ||
    profile.skillTier === null ||
    ![1, 2, 3].includes(profile.skillTier)
  ) {
    return { ok: false, status: 400, error: 'inactive wrenching profile' }
  }

  const parsed = createSessionBodySchema.safeParse(opts.body)
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.message }
  }
  const { requestKey, ...intake } = parsed.data
  return {
    ok: true,
    value: {
      profileId: profile.id,
      shopId: profile.shopId,
      skillTier: profile.skillTier as 1 | 2 | 3,
      requestKey,
      intake,
    },
  }
}

async function findCompletedSessionWrapper(
  db: AppDb,
  requestKey: string,
  profileId: string,
  shopId: string,
  incomingIntake: IntakePayload,
): Promise<
  | { kind: 'match'; ticketId: string; jobId: string }
  | { kind: 'collision' }
  | { kind: 'missing' }
> {
  const [session] = await db
    .select({
      id: sessions.id,
      shopId: sessions.shopId,
      techId: sessions.techId,
      intake: sessions.intake,
    })
    .from(sessions)
    .where(eq(sessions.id, requestKey))
    .limit(1)
  if (!session) return { kind: 'missing' }
  const normalizedPersistedIntake = intakeSchema.safeParse(session.intake)
  if (
    session.techId !== profileId ||
    session.shopId !== shopId ||
    !normalizedPersistedIntake.success ||
    JSON.stringify(normalizedPersistedIntake.data) !== JSON.stringify(incomingIntake)
  ) {
    return { kind: 'collision' }
  }

  const [job] = await db
    .select({
      id: ticketJobs.id,
      ticketId: ticketJobs.ticketId,
      jobShopId: ticketJobs.shopId,
      sessionId: ticketJobs.sessionId,
      assignedTechId: ticketJobs.assignedTechId,
      title: ticketJobs.title,
      kind: ticketJobs.kind,
      requiredSkillTier: ticketJobs.requiredSkillTier,
      ticketShopId: tickets.shopId,
      source: tickets.source,
      customerId: tickets.customerId,
      vehicleId: tickets.vehicleId,
      concern: tickets.concern,
      createdByProfileId: tickets.createdByProfileId,
    })
    .from(ticketJobs)
    .innerJoin(tickets, eq(tickets.id, ticketJobs.ticketId))
    .where(
      and(
        eq(ticketJobs.shopId, shopId),
        eq(ticketJobs.sessionId, requestKey),
        eq(ticketJobs.assignedTechId, profileId),
      ),
    )
    .limit(1)
  if (
    !job ||
    job.jobShopId !== shopId ||
    job.ticketShopId !== shopId ||
    job.sessionId !== requestKey ||
    job.assignedTechId !== profileId ||
    job.kind !== 'diagnostic' ||
    ![1, 2, 3].includes(job.requiredSkillTier) ||
    job.title !== incomingIntake.customerComplaint ||
    job.source !== 'tech_quick' ||
    job.customerId !== null ||
    job.vehicleId !== null ||
    job.concern !== incomingIntake.customerComplaint ||
    job.createdByProfileId !== profileId
  ) {
    return { kind: 'collision' }
  }
  return { kind: 'match', ticketId: job.ticketId, jobId: job.id }
}

export type FindCompletedTechQuickSessionResult =
  | { ok: true; state: 'match'; id: string; ticketId: string; jobId: string }
  | { ok: true; state: 'missing' }
  | { ok: false; status: 400; error: string }

export async function findCompletedTechQuickSessionForUser(opts: {
  db: AppDb
  userId: string
  body: unknown
}): Promise<FindCompletedTechQuickSessionResult> {
  const validated = await validateSessionCreationRequest(opts)
  if (!validated.ok) return validated
  const { profileId, shopId, requestKey, intake } = validated.value
  const existing = await findCompletedSessionWrapper(
    opts.db,
    requestKey,
    profileId,
    shopId,
    intake,
  )
  if (existing.kind === 'missing') return { ok: true, state: 'missing' }
  if (existing.kind === 'collision') {
    return { ok: false, status: 400, error: 'request key unavailable' }
  }
  return {
    ok: true,
    state: 'match',
    id: requestKey,
    ticketId: existing.ticketId,
    jobId: existing.jobId,
  }
}

export async function createSessionForUser(opts: {
  db: AppDb
  userId: string
  body: unknown
  treeState: TreeState
  createWrapper?: CreateSessionWrapper
}): Promise<CreateSessionResult> {
  const validated = await validateSessionCreationRequest(opts)
  if (!validated.ok) return validated
  const { profileId, shopId, skillTier, requestKey, intake } = validated.value
  const existing = await findCompletedSessionWrapper(
    opts.db,
    requestKey,
    profileId,
    shopId,
    intake,
  )
  if (existing.kind === 'match') {
    return {
      ok: true,
      id: requestKey,
      ticketId: existing.ticketId,
      jobId: existing.jobId,
    }
  }
  if (existing.kind === 'collision') {
    return { ok: false, status: 400, error: 'request key unavailable' }
  }

  const createWrapper = opts.createWrapper ?? createTechQuickTicketInTransaction
  try {
    return await opts.db.transaction(async (tx) => {
      const [session] = await tx
        .insert(sessions)
        .values({
          id: requestKey,
          shopId,
          techId: profileId,
          intake,
          treeState: opts.treeState,
        })
        .returning()
      const wrapper = await createWrapper(tx as AppDb, {
        shopId,
        profileId,
        skillTier,
        sessionId: session.id,
        concern: intake.customerComplaint,
      })
      return { ok: true, id: session.id, ...wrapper }
    })
  } catch {
    const retry = await findCompletedSessionWrapper(
      opts.db,
      requestKey,
      profileId,
      shopId,
      intake,
    )
    if (retry.kind === 'match') {
      return {
        ok: true,
        id: requestKey,
        ticketId: retry.ticketId,
        jobId: retry.jobId,
      }
    }
    return retry.kind === 'collision'
      ? { ok: false, status: 400, error: 'request key unavailable' }
      : { ok: false, status: 500, error: 'session create failed' }
  }
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
  /** Optional. Called as the function moves through narratable stages
   *  (`Recording observation`, `Parsing photo · N frames` when photos exist,
   *  `Advancing to next step`). The retrieval wrapper emits its own stages.
   *  Default is no-op so the JSON `/advance` route and tests are unaffected. */
  onProgress?: (event: AdvanceStreamEvent) => void
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

  opts.onProgress?.({
    type: 'stage',
    idx: -1,
    label: 'Recording observation',
  })

  const photoArtifactCount = nodeArtifacts.filter((a) =>
    ['photo', 'scan_screen', 'wiring_diagram'].includes(a.kind),
  ).length
  if (photoArtifactCount > 0) {
    opts.onProgress?.({
      type: 'stage',
      idx: -1,
      label: `Parsing photo · ${photoArtifactCount} frames`,
    })
  }

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

  opts.onProgress?.({
    type: 'stage',
    idx: -1,
    label: 'Advancing to next step',
  })

  await appendSessionEvent(opts.db, {
    sessionId: opts.sessionId,
    nodeId: session.treeState.currentNodeId,
    eventType: 'observation',
    observationText: parsed.data.observation,
    aiResponse: {
      nextNodeId: nextTree.currentNodeId,
      messageText: nextTree.message,
    },
  })
  await updateSessionTreeState(opts.db, opts.sessionId, nextTree)

  return { ok: true, tree: nextTree }
}

export type CloseSessionResult =
  | { ok: true }
  | { ok: false; status: 400 | 404 | 409; error: string; retryable?: true }
  | { ok: false; status: 422; error: 'specificity_required'; feedback: string }

const declinedNoRepairSchema = z.object({
  mode: z.literal('declined_no_repair'),
  note: z.string().trim().min(1).max(2000).optional(),
})

export async function closeSessionForUser(opts: {
  db: AppDb
  userId: string
  sessionId: string
  body: unknown
  validateSpecificity: (input: { rootCause: string; notes?: string }) => Promise<ValidatorResult>
  /** Phase K corpus promotion. Optional — when omitted, no promotion runs.
   *  Failures are non-fatal; the session still closes successfully. */
  promoteToCorpus?: PromoteToCorpusFn
  /** Phase R comeback follow-up scheduling. Optional — when omitted, no
   *  follow-ups are written. Failures are non-fatal; the session still
   *  closes (and corpus promotion still runs) regardless. */
  scheduleFollowUps?: ScheduleFollowUpsFn
  /** Phase P novel-pattern trigger. Optional — when omitted, no queue entry
   *  is written. The caller pre-binds the max corpus similarity score for this
   *  session so the trigger can decide whether to enqueue. Failures are
   *  non-fatal; the session still closes regardless. */
  enqueueNovelPattern?: EnqueueIfNovelPatternFn
  /** Max corpus retrieval similarity score for this session (0–1). Required
   *  when enqueueNovelPattern is provided; ignored otherwise. Defaults to 0
   *  when not supplied (treats as no corpus hits). */
  maxCorpusSimilarity?: number
  /** Proof-of-fix writer. Optional — when omitted, no diagnostic_sessions row is
   *  written. Failures are non-fatal; the session still closes regardless. */
  recordDiagnosticOutcome?: RecordDiagnosticOutcomeFn
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

  const repairAccess = await resolveDiagnosticRepairAccess(opts.db, {
    shopId: session.shopId,
    sessionId: session.id,
  })
  const declinedNoRepair = declinedNoRepairSchema.safeParse(opts.body)

  if (declinedNoRepair.success) {
    if (repairAccess.state !== 'declined') {
      return { ok: false, status: 409, error: 'repair_not_authorized' }
    }
    const rootCause = session.treeState.rootCauseSummary?.trim()
    if (!rootCause || rootCause.length < 10) {
      return { ok: false, status: 409, error: 'repair_not_authorized' }
    }
    const outcome = outcomeSchema.parse({
      rootCause,
      actionType: 'no_fix',
      verification: {
        codesCleared: false,
        testDrive: false,
        symptomsResolved: 'no',
      },
      diagMinutes: Math.max(
        0,
        Math.floor((Date.now() - new Date(session.createdAt).getTime()) / 60_000),
      ),
      repairMinutes: 0,
      ...(declinedNoRepair.data.note ? { notes: declinedNoRepair.data.note } : {}),
      closeout: { kind: 'declined_no_repair' },
    })
    try {
      const committed = await opts.db.transaction(async (tx) => {
        const transactionDb = tx as AppDb
        const locked = await lockDiagnosticRepairAccess(transactionDb, {
          shopId: session.shopId,
          sessionId: session.id,
          actorProfileId: profile.id,
        })
        if (locked.state !== 'declined') return false
        await closeSession(transactionDb, session.id, outcome)
        await appendSessionEvent(transactionDb, {
          sessionId: session.id,
          nodeId: session.treeState.currentNodeId,
          eventType: 'close',
          aiResponse: {
            shopOsCloseout: { kind: 'declined_no_repair', jobId: locked.jobId },
          },
        })
        await transactionDb
          .update(ticketJobs)
          .set({ workStatus: 'canceled', updatedAt: new Date() })
          .where(and(
            eq(ticketJobs.shopId, session.shopId),
            eq(ticketJobs.id, locked.jobId),
            eq(ticketJobs.sessionId, session.id),
          ))
        return true
      })
      return committed
        ? { ok: true }
        : { ok: false, status: 409, error: 'repair_not_authorized' }
    } catch (error) {
      if (isLockUnavailable(error)) {
        return { ok: false, status: 409, error: 'conflict', retryable: true }
      }
      throw error
    }
  }

  if (repairAccess.state !== 'legacy' && repairAccess.state !== 'approved') {
    return { ok: false, status: 409, error: 'repair_not_authorized' }
  }

  const parsed = outcomeSchema.safeParse(opts.body)
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.message }
  }

  // Override path: tech retried after one rejection. Skip the validator entirely;
  // the override metadata is persisted on the outcome row for admin review.
  if (!parsed.data.override) {
    const validation = await opts.validateSpecificity({
      rootCause: parsed.data.rootCause,
      notes: parsed.data.notes,
    })
    if (!validation.ok) {
      return {
        ok: false,
        status: 422,
        error: 'specificity_required',
        feedback: validation.feedback ?? 'Be more specific.',
      }
    }
  }

  if (repairAccess.state === 'approved') {
    try {
      const committed = await opts.db.transaction(async (tx) => {
        const transactionDb = tx as AppDb
        const locked = await lockDiagnosticRepairAccess(transactionDb, {
          shopId: session.shopId,
          sessionId: session.id,
          actorProfileId: profile.id,
        })
        if (locked.state !== 'approved') return false
        await closeSession(transactionDb, opts.sessionId, parsed.data)
        await appendSessionEvent(transactionDb, {
          sessionId: opts.sessionId,
          nodeId: session.treeState.currentNodeId,
          eventType: 'close',
        })
        await transactionDb
          .update(ticketJobs)
          .set({ workStatus: 'done', updatedAt: new Date() })
          .where(and(
            eq(ticketJobs.shopId, session.shopId),
            eq(ticketJobs.id, locked.jobId),
            eq(ticketJobs.sessionId, session.id),
          ))
        return true
      })
      if (!committed) {
        return { ok: false, status: 409, error: 'repair_not_authorized' }
      }
    } catch (error) {
      if (isLockUnavailable(error)) {
        return { ok: false, status: 409, error: 'conflict', retryable: true }
      }
      throw error
    }
  } else {
    await closeSession(opts.db, opts.sessionId, parsed.data)
    await appendSessionEvent(opts.db, {
      sessionId: opts.sessionId,
      nodeId: session.treeState.currentNodeId,
      eventType: 'close',
    })
  }

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

  if (opts.scheduleFollowUps) {
    try {
      await opts.scheduleFollowUps(opts.db, {
        sessionId: opts.sessionId,
        shopId: session.shopId,
        techId: session.techId,
      })
    } catch (err) {
      console.warn('follow-up scheduling failed (session still closed):', err)
    }
  }

  if (opts.enqueueNovelPattern) {
    try {
      await opts.enqueueNovelPattern(
        opts.db,
        opts.sessionId,
        opts.maxCorpusSimilarity ?? 0,
      )
    } catch (err) {
      console.warn('novel-pattern queue enqueue failed (session still closed):', err)
    }
  }

  if (opts.recordDiagnosticOutcome) {
    try {
      await opts.recordDiagnosticOutcome(opts.db, {
        vehicleId: session.vehicleId,
        shopId: session.shopId,
        techId: session.techId,
        complaintText: session.intake.customerComplaint,
        outcome: parsed.data,
      })
    } catch (err) {
      console.warn('diagnostic-session record failed (session still closed):', err)
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

const ambientGeoSchema = z.object({
  source: z.literal('geolocation'),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
})

const ambientManualSchema = z.object({
  source: z.literal('manual'),
  temperatureF: z.number().finite().min(-80).max(160),
  humidityPct: z.number().min(0).max(100).optional(),
})

const ambientBodySchema = z.discriminatedUnion('source', [
  ambientGeoSchema,
  ambientManualSchema,
])

export type AmbientLookupFn = (input: {
  latitude: number
  longitude: number
}) => Promise<{
  temperatureC: number
  temperatureF: number
  humidityPct?: number
  windKph?: number
  conditions?: string
}>

export type RecordAmbientConditionsResult =
  | { ok: true; conditions: AmbientConditions; tree: TreeState }
  | { ok: false; status: 400 | 404 | 500 | 502; error: string }

/**
 * Capture ambient conditions for a session. Two paths:
 *   - source=geolocation: server-side weather lookup from the tech's lat/lon
 *     (Open-Meteo). Lat/lon are rounded to ~11km before persistence so the
 *     stored intake can't pinpoint the tech.
 *   - source=manual: tech-entered temperature override (used when the
 *     geolocation lookup looks wrong, e.g. VPN or data-center IP).
 *
 * In both cases the conditions are written to session.intake.ambientConditions
 * and the tree is advanced with a synthetic observation describing the
 * captured value, so the AI can incorporate it on the next turn instead of
 * generating a "look up the temp" step.
 */
export async function recordAmbientConditions(opts: {
  db: AppDb
  userId: string
  sessionId: string
  body: unknown
  lookupAmbient: AmbientLookupFn
  updateTree: (input: {
    intake: IntakePayload
    currentTree: TreeState
    observation: string
  }) => Promise<TreeState>
}): Promise<RecordAmbientConditionsResult> {
  const profile = await getProfileByUserId(opts.db, opts.userId)
  if (!profile) return { ok: false, status: 400, error: 'no profile' }

  const session = await getSessionById(opts.db, opts.sessionId)
  if (!session || session.techId !== profile.id) {
    return { ok: false, status: 404, error: 'not found' }
  }
  if (session.status !== 'open') {
    return { ok: false, status: 400, error: 'session is not open' }
  }

  const parsed = ambientBodySchema.safeParse(opts.body)
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.message }
  }

  let conditions: AmbientConditions
  if (parsed.data.source === 'geolocation') {
    try {
      const weather = await opts.lookupAmbient({
        latitude: parsed.data.latitude,
        longitude: parsed.data.longitude,
      })
      conditions = {
        temperatureF: round1(weather.temperatureF),
        humidityPct:
          weather.humidityPct !== undefined ? Math.round(weather.humidityPct) : undefined,
        windKph: weather.windKph !== undefined ? round1(weather.windKph) : undefined,
        conditions: weather.conditions,
        source: 'geolocation',
        capturedAt: new Date().toISOString(),
        approxLat: round1(parsed.data.latitude),
        approxLon: round1(parsed.data.longitude),
      }
    } catch (err) {
      console.error('ambient lookup failed:', err)
      return { ok: false, status: 502, error: 'ambient lookup failed' }
    }
  } else {
    conditions = {
      temperatureF: round1(parsed.data.temperatureF),
      humidityPct:
        parsed.data.humidityPct !== undefined
          ? Math.round(parsed.data.humidityPct)
          : undefined,
      source: 'manual',
      capturedAt: new Date().toISOString(),
    }
  }

  const nextIntake: IntakePayload = { ...session.intake, ambientConditions: conditions }
  await updateSessionIntake(opts.db, opts.sessionId, nextIntake)

  const observation = formatAmbientObservation(conditions)

  let nextTree: TreeState
  try {
    nextTree = await opts.updateTree({
      intake: nextIntake,
      currentTree: session.treeState,
      observation,
    })
  } catch (err) {
    console.error('tree update after ambient capture failed:', err)
    return { ok: false, status: 500, error: 'tree update failed' }
  }

  await appendSessionEvent(opts.db, {
    sessionId: opts.sessionId,
    nodeId: session.treeState.currentNodeId,
    eventType: 'observation',
    observationText: observation,
    aiResponse: { nextNodeId: nextTree.currentNodeId },
  })
  await updateSessionTreeState(opts.db, opts.sessionId, nextTree)

  return { ok: true, conditions, tree: nextTree }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function formatAmbientObservation(c: AmbientConditions): string {
  const parts = [`Ambient ${c.temperatureF.toFixed(0)}°F`]
  if (typeof c.humidityPct === 'number') parts.push(`${c.humidityPct}% RH`)
  if (typeof c.windKph === 'number') parts.push(`wind ${c.windKph.toFixed(0)} kph`)
  if (c.conditions) parts.push(c.conditions)
  const tag = c.source === 'geolocation' ? 'geolocation lookup' : 'tech-entered'
  return `${parts.join(', ')} (${tag}).`
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

// Tech-initiated gate release. The Decline screen calls this from every
// non-defer exit (Yes/No on the hero confirm card, Snap-it on the photo
// card, Gather more low-risk data) so that after the user takes an action,
// the session-routing layer doesn't redirect them right back to the same
// Decline screen on the next page load. The next observation re-runs gating
// naturally — this isn't a bypass, just a release of the *current displayed*
// gate so the tech can act on the AI's updated context.
export type ReleaseGateResult =
  | { ok: true }
  | { ok: false; status: 400 | 404; error: string }

export async function releaseGateForUser(opts: {
  db: AppDb
  userId: string
  sessionId: string
}): Promise<ReleaseGateResult> {
  const profile = await getProfileByUserId(opts.db, opts.userId)
  if (!profile) return { ok: false, status: 400, error: 'no profile' }

  const session = await getSessionById(opts.db, opts.sessionId)
  if (!session || session.techId !== profile.id) {
    return { ok: false, status: 404, error: 'not found' }
  }
  if (session.status !== 'open') {
    return { ok: false, status: 400, error: 'session is not open' }
  }

  const { gateDecision: _drop, ...nextTree } = session.treeState
  await updateSessionTreeState(opts.db, opts.sessionId, nextTree as TreeState)
  await appendSessionEvent(opts.db, {
    sessionId: opts.sessionId,
    nodeId: session.treeState.currentNodeId,
    eventType: 'tree_update',
  })
  return { ok: true }
}

// Decline-this-job was removed from the product 2026-05-09 — defer-for-curator
// is the only escalation path. Stale clients posting reason='decline' get a
// 400 from zod's literal('defer') here. The session.status enum still carries
// 'declined' for back-compat with existing closed rows; the curator case page
// reads them fine.
const declineOrDeferSchema = z.object({
  reason: z.literal('defer'),
  gap: z.string().min(5).max(2000),
  riskClass: z.enum(['low', 'medium', 'high', 'destructive']),
})

export type DeclineOrDeferSessionResult =
  | { ok: true; status: 'deferred'; language: DeclineLanguage }
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
      reason: 'defer',
    })
  } catch (err) {
    console.error('decline language generation failed:', err)
    return { ok: false, status: 500, error: 'language generation failed' }
  }

  await setSessionTerminalStatus(opts.db, opts.sessionId, 'deferred')
  await appendSessionEvent(opts.db, {
    sessionId: opts.sessionId,
    nodeId: session.treeState.currentNodeId,
    eventType: 'close',
    aiResponse: {
      declineOrDefer: {
        reason: 'defer',
        gap: parsed.data.gap,
        riskClass: parsed.data.riskClass,
        language,
      },
    },
  })

  return { ok: true, status: 'deferred', language }
}

const abandonSchema = z.object({
  reason: z.enum(['mistake', 'test', 'wrong_vehicle', 'customer_left', 'other']).optional(),
  note: z.string().max(500).optional(),
})

export type AbandonSessionResult =
  | { ok: true }
  | { ok: false; status: 400 | 404; error: string }

/**
 * User-initiated abandonment: closes an open session as 'deferred' without
 * the outcome form / AI specificity validation / corpus promotion. Use when
 * the tech started by mistake, it was a test, or the customer left without
 * finishing. The session lands in the curator's "Incomplete" bucket.
 *
 * Distinct from declineOrDeferSessionForUser, which closes a session that
 * the AI itself is gating (low confidence) and generates customer-facing
 * language. This path generates no language and runs no AI.
 */
export async function abandonSessionForUser(opts: {
  db: AppDb
  userId: string
  sessionId: string
  body: unknown
}): Promise<AbandonSessionResult> {
  const profile = await getProfileByUserId(opts.db, opts.userId)
  if (!profile) return { ok: false, status: 400, error: 'no profile' }

  const session = await getSessionById(opts.db, opts.sessionId)
  if (!session || session.techId !== profile.id) {
    return { ok: false, status: 404, error: 'not found' }
  }
  if (session.status !== 'open') {
    return { ok: false, status: 400, error: 'session is not open' }
  }

  const parsed = abandonSchema.safeParse(opts.body ?? {})
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.message }
  }

  await setSessionTerminalStatus(opts.db, opts.sessionId, 'deferred')
  await appendSessionEvent(opts.db, {
    sessionId: opts.sessionId,
    nodeId: session.treeState.currentNodeId,
    eventType: 'close',
    aiResponse: {
      abandon: {
        reason: parsed.data.reason ?? 'mistake',
        ...(parsed.data.note ? { note: parsed.data.note } : {}),
      },
    },
  })

  return { ok: true }
}

export type LockDiagnosisResult =
  | { ok: true }
  | { ok: false; status: 400 | 404; error: string }

/**
 * Tech-initiated diagnostic-phase lock-in. Transitions session from
 * phase=diagnosing (with done=true) to phase=repairing. After this:
 * - rootCauseSummary is frozen (the repair-guidance prompt explicitly
 *   instructs the AI not to revise it; server-side parser drops any
 *   attempt to set rootCauseSummary in the response)
 * - subsequent tech inputs go through /api/sessions/[id]/repair-observation
 * - the repair phase ends when the tech closes the case via /outcome OR
 *   marks it incomplete via abandon
 */
export async function lockDiagnosisForUser(opts: {
  db: AppDb
  userId: string
  sessionId: string
}): Promise<LockDiagnosisResult> {
  const profile = await getProfileByUserId(opts.db, opts.userId)
  if (!profile) return { ok: false, status: 400, error: 'no profile' }

  const session = await getSessionById(opts.db, opts.sessionId)
  if (!session || session.techId !== profile.id) {
    return { ok: false, status: 404, error: 'not found' }
  }
  if (session.status !== 'open') {
    return { ok: false, status: 400, error: 'session is not open' }
  }
  if (session.treeState.phase === 'repairing') {
    return { ok: false, status: 400, error: 'diagnosis already locked' }
  }
  if (!session.treeState.done) {
    return { ok: false, status: 400, error: 'diagnosis not done — cannot lock' }
  }

  const lockedAt = new Date().toISOString()
  const nextTree = {
    ...session.treeState,
    phase: 'repairing' as const,
    diagnosisLockedAt: lockedAt,
  }

  await updateSessionTreeState(opts.db, opts.sessionId, nextTree)
  await appendSessionEvent(opts.db, {
    sessionId: opts.sessionId,
    nodeId: session.treeState.currentNodeId,
    eventType: 'tree_update',
  })

  return { ok: true }
}

export type LockDiagnosisFromWizardResult =
  | { ok: true }
  | { ok: false; status: 400 | 404; error: 'not found' | 'session is not open' | 'diagnosis already locked' }

/**
 * Lock-in handoff from the curator-guided wizard to the existing repair surface.
 *
 * Merges the wizard's terminal Finding into the session's existing treeState
 * (phase -> 'repairing', rootCauseSummary, proposedAction, diagnosisLockedAt) so
 * ActiveSession -> RepairPhaseView renders WITH NO CHANGES to those components. The
 * merge preserves the session's real nodes[]/currentNodeId/message — we never fabricate
 * tree nodes (#98: nothing rendered downstream is invented). Clears sessions.wizardState.
 * Inserts exactly one 'wizard_lock_in' session_event. Idempotent: the already-locked
 * guard rejects a second call BEFORE any insert, so no duplicate event is written.
 *
 * Unlike lockDiagnosisForUser, this path does NOT require treeState.done — the wizard's
 * terminal Finding is itself the readiness signal (the wizard bypasses the AI tree).
 * Ownership failures (no profile / not the session's tech) intentionally collapse into a
 * single 404 'not found' so the response never leaks whether a profile or session exists;
 * this is why the result type omits the peers' 400 'no profile'.
 */
export async function lockDiagnosisFromWizard(opts: {
  db: AppDb
  userId: string
  sessionId: string
  finding: Finding
  // Forwarded from the route's lock-in payload; unused here in N4. Reserved for the
  // PR-N5 audit/outcome work, kept in the signature so the route call site stays flat.
  history: WizardState['history']
  flowVersionId: string
}): Promise<LockDiagnosisFromWizardResult> {
  const profile = await getProfileByUserId(opts.db, opts.userId)
  // Uniform 404 (not the peers' 400 'no profile') — see JSDoc: don't leak existence.
  if (!profile) return { ok: false, status: 404, error: 'not found' }

  const session = await getSessionById(opts.db, opts.sessionId)
  if (!session || session.techId !== profile.id) {
    return { ok: false, status: 404, error: 'not found' }
  }
  if (session.status !== 'open') {
    return { ok: false, status: 400, error: 'session is not open' }
  }
  if (session.treeState.phase === 'repairing' || session.treeState.diagnosisLockedAt) {
    return { ok: false, status: 400, error: 'diagnosis already locked' }
  }

  const handoff = synthesizeHandoffFromFinding({ finding: opts.finding })
  const mergedTreeState: TreeState = { ...session.treeState, ...handoff }

  await opts.db
    .update(sessions)
    .set({ treeState: mergedTreeState, wizardState: null })
    .where(eq(sessions.id, opts.sessionId))

  await appendSessionEvent(opts.db, {
    sessionId: opts.sessionId,
    nodeId: session.treeState.currentNodeId,
    eventType: 'wizard_lock_in',
    observationText: opts.finding.verdict,
    aiResponse: { wizardLockIn: { flowVersionId: opts.flowVersionId } },
  })

  return { ok: true }
}

const repairObservationSchema = z.object({
  observation: z.string().min(1).max(2000),
})

export type SubmitRepairObservationResult =
  | { ok: true; guidance: RepairGuidanceResult }
  | { ok: false; status: 400 | 404 | 409 | 502; error: string; retryable?: true }

export type GetRepairGuidanceFn = (
  input: RepairGuidancePromptInput,
) => Promise<RepairGuidanceResult>

/**
 * Tech-submitted observation during the repair phase. Persists the
 * observation as a session_event, then calls the repair-guidance AI
 * prompt for a reply, and persists the AI's reply as a separate
 * session_event. Both events are queryable via session_events for the
 * chat-thread render.
 *
 * On AI failure: observation is persisted, guidance is NOT persisted,
 * caller receives 502. UI surfaces this as "AI unavailable, retry?"
 * without losing the tech's input.
 */
export async function submitRepairObservationForUser(opts: {
  db: AppDb
  userId: string
  sessionId: string
  body: unknown
  /** Injected for testability. Production wires this to lib/ai/repair-guidance#getRepairGuidance. */
  getGuidance: GetRepairGuidanceFn
}): Promise<SubmitRepairObservationResult> {
  const profile = await getProfileByUserId(opts.db, opts.userId)
  if (!profile) return { ok: false, status: 400, error: 'no profile' }

  const session = await getSessionById(opts.db, opts.sessionId)
  if (!session || session.techId !== profile.id) {
    return { ok: false, status: 404, error: 'not found' }
  }
  if (session.status !== 'open') {
    return { ok: false, status: 400, error: 'session is not open' }
  }
  if (session.treeState.phase !== 'repairing') {
    return { ok: false, status: 400, error: 'session is not in repair phase' }
  }

  const parsed = repairObservationSchema.safeParse(opts.body)
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.message }
  }

  try {
    const committed = await opts.db.transaction(async (tx) => {
      const transactionDb = tx as AppDb
      const access = await lockDiagnosticRepairAccess(transactionDb, {
        shopId: session.shopId,
        sessionId: session.id,
        actorProfileId: profile.id,
      })
      if (access.state !== 'legacy' && access.state !== 'approved') return false
      // Persist the tech's observation FIRST so it is retained if guidance fails.
      await appendSessionEvent(transactionDb, {
        sessionId: opts.sessionId,
        nodeId: session.treeState.currentNodeId,
        eventType: 'repair_observation',
        observationText: parsed.data.observation,
      })
      return true
    })
    if (!committed) {
      return { ok: false, status: 409, error: 'repair_not_authorized' }
    }
  } catch (error) {
    if (isLockUnavailable(error)) {
      return { ok: false, status: 409, error: 'conflict', retryable: true }
    }
    throw error
  }

  // Fetch prior repair events for AI context (the just-inserted observation is excluded).
  const allEvents = await opts.db
    .select()
    .from(sessionEvents)
    .where(eq(sessionEvents.sessionId, opts.sessionId))
    .orderBy(sessionEvents.createdAt)
  const priorEvents = allEvents.slice(0, -1)

  let guidance: RepairGuidanceResult
  try {
    guidance = await opts.getGuidance({
      tree: session.treeState,
      recentEvents: priorEvents,
      observation: parsed.data.observation,
    })
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: `repair-guidance failed: ${(err as Error).message}`,
    }
  }

  await appendSessionEvent(opts.db, {
    sessionId: opts.sessionId,
    nodeId: session.treeState.currentNodeId,
    eventType: 'repair_guidance',
    aiResponse: { repairGuidance: guidance },
  })

  return { ok: true, guidance }
}
