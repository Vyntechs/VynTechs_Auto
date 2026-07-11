import {
  and,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  ne,
  or,
  sql,
} from 'drizzle-orm'
import type { AppDb } from '@/lib/db/queries'
import {
  profiles,
  sessions,
  ticketJobs,
  tickets,
  vehicles,
  type IntakePayload,
  type TreeState,
} from '@/lib/db/schema'

export const DIAGNOSTIC_START_LEASE_MINUTES = 2

export type DiagnosticStartActor = {
  profileId: string
  shopId: string
}

type SafeFailure = { ok: false; status: 404 | 409; error: 'not found' | 'start unavailable' }
type Ready = { ok: true; state: 'ready'; sessionId: string }
type Waiting = { ok: true; state: 'initializing'; leaseAcquired: false }
type Acquired = {
  ok: true
  state: 'initializing'
  leaseAcquired: true
  attemptKey: string
  leaseUntil: Date
  context: { vehicleId: string; intake: IntakePayload }
}
type Ambiguous = { ok: true; state: 'ambiguous' }
type Failed = { ok: true; state: 'failed' }

export type AcquireDiagnosticStartResult = Ready | Waiting | Acquired | Ambiguous | SafeFailure
export type SettleDiagnosticStartResult = Ready | Waiting | Ambiguous | Failed | SafeFailure

type StartInput = {
  actor: DiagnosticStartActor
  ticketId: string
  jobId: string
  attemptKey: string
}

type StartSnapshot = {
  sessionId: string | null
  linkedSessionTechId: string | null
  state: string
  attemptKey: string | null
  workStatus: string
  vehicleId: string | null
  vehicleCustomerId: string | null
  ticketCustomerId: string | null
  vehicleYear: number | null
  vehicleMake: string | null
  vehicleModel: string | null
  vehicleEngine: string | null
  vehicleMileage: number | null
  concern: string
}

const notFound = (): SafeFailure => ({ ok: false, status: 404, error: 'not found' })
const unavailable = (): SafeFailure => ({ ok: false, status: 409, error: 'start unavailable' })
const waiting = (): Waiting => ({ ok: true, state: 'initializing', leaseAcquired: false })
const ambiguous = (): Ambiguous => ({ ok: true, state: 'ambiguous' })

function actorAuthorization(input: StartInput) {
  return and(
    eq(ticketJobs.shopId, input.actor.shopId),
    eq(ticketJobs.ticketId, input.ticketId),
    eq(ticketJobs.id, input.jobId),
    eq(ticketJobs.kind, 'diagnostic'),
    eq(ticketJobs.assignedTechId, input.actor.profileId),
    sql`exists (
      select 1 from ${tickets}
      where ${tickets.shopId} = ${ticketJobs.shopId}
        and ${tickets.id} = ${ticketJobs.ticketId}
        and ${tickets.status} = 'open'
    )`,
    sql`exists (
      select 1 from ${profiles}
      where ${profiles.shopId} = ${ticketJobs.shopId}
        and ${profiles.id} = ${input.actor.profileId}
        and ${profiles.membershipStatus} = 'active'
        and ${profiles.deactivatedAt} is null
        and ${profiles.role} in ('tech', 'advisor', 'parts', 'owner')
        and ${profiles.skillTier} between 1 and 3
        and ${profiles.skillTier} >= ${ticketJobs.requiredSkillTier}
    )`,
  )
}

async function loadAuthorizedSnapshot(db: AppDb, input: StartInput): Promise<StartSnapshot | null> {
  const [row] = await db
    .select({
      sessionId: ticketJobs.sessionId,
      linkedSessionTechId: sessions.techId,
      state: ticketJobs.diagnosticStartState,
      attemptKey: ticketJobs.diagnosticStartAttemptKey,
      workStatus: ticketJobs.workStatus,
      vehicleId: tickets.vehicleId,
      ticketCustomerId: tickets.customerId,
      vehicleCustomerId: vehicles.customerId,
      vehicleYear: vehicles.year,
      vehicleMake: vehicles.make,
      vehicleModel: vehicles.model,
      vehicleEngine: vehicles.engine,
      vehicleMileage: vehicles.mileage,
      concern: tickets.concern,
    })
    .from(ticketJobs)
    .innerJoin(
      tickets,
      and(eq(tickets.shopId, ticketJobs.shopId), eq(tickets.id, ticketJobs.ticketId)),
    )
    .innerJoin(
      profiles,
      and(eq(profiles.shopId, ticketJobs.shopId), eq(profiles.id, input.actor.profileId)),
    )
    .leftJoin(
      vehicles,
      and(eq(vehicles.id, tickets.vehicleId), eq(vehicles.customerId, tickets.customerId)),
    )
    .leftJoin(
      sessions,
      and(eq(sessions.shopId, ticketJobs.shopId), eq(sessions.id, ticketJobs.sessionId)),
    )
    .where(and(
      actorAuthorization(input),
      inArray(ticketJobs.workStatus, ['open', 'in_progress']),
    ))
    .limit(1)
  return row ?? null
}

function intakeFromSnapshot(snapshot: StartSnapshot): { vehicleId: string; intake: IntakePayload } | null {
  if (
    snapshot.vehicleId === null
    || snapshot.ticketCustomerId === null
    || snapshot.vehicleCustomerId !== snapshot.ticketCustomerId
    || snapshot.vehicleYear === null
    || snapshot.vehicleMake === null
    || snapshot.vehicleModel === null
  ) return null

  return {
    vehicleId: snapshot.vehicleId,
    intake: {
      vehicleYear: snapshot.vehicleYear,
      vehicleMake: snapshot.vehicleMake,
      vehicleModel: snapshot.vehicleModel,
      ...(snapshot.vehicleEngine ? { vehicleEngine: snapshot.vehicleEngine } : {}),
      ...(snapshot.vehicleMileage !== null ? { mileage: snapshot.vehicleMileage } : {}),
      customerComplaint: snapshot.concern,
    },
  }
}

function existingReady(snapshot: StartSnapshot, actor: DiagnosticStartActor): Ready | SafeFailure | null {
  if (!snapshot.sessionId) return null
  if (snapshot.linkedSessionTechId !== actor.profileId) return notFound()
  return { ok: true, state: 'ready', sessionId: snapshot.sessionId }
}

async function currentSafeState(
  db: AppDb,
  input: StartInput,
): Promise<Ready | Waiting | Ambiguous | SafeFailure> {
  const snapshot = await loadAuthorizedSnapshot(db, input)
  if (!snapshot) return notFound()
  const ready = existingReady(snapshot, input.actor)
  if (ready) return ready
  if (snapshot.state === 'ambiguous') return ambiguous()
  if (snapshot.state === 'initializing') return waiting()
  return unavailable()
}

async function expireOwnedLease(
  db: AppDb,
  input: StartInput,
  ownedAttemptKey: string,
): Promise<boolean> {
  const [updated] = await db
    .update(ticketJobs)
    .set({
      diagnosticStartState: 'ambiguous',
      diagnosticStartLeaseUntil: null,
      diagnosticStartErrorCode: 'lease_expired',
      updatedAt: sql`now()`,
    })
    .where(and(
      eq(ticketJobs.shopId, input.actor.shopId),
      eq(ticketJobs.ticketId, input.ticketId),
      eq(ticketJobs.id, input.jobId),
      eq(ticketJobs.diagnosticStartState, 'initializing'),
      eq(ticketJobs.diagnosticStartAttemptKey, ownedAttemptKey),
      or(
        isNull(ticketJobs.diagnosticStartLeaseUntil),
        lte(ticketJobs.diagnosticStartLeaseUntil, sql`now()`),
      ),
    ))
    .returning()
  return Boolean(updated)
}

export async function acquireDiagnosticStart(
  db: AppDb,
  input: StartInput & { confirmAmbiguousRetry?: boolean },
): Promise<AcquireDiagnosticStartResult> {
  try {
    return await db.transaction(async (tx) => {
      const transactionDb = tx as AppDb
      const snapshot = await loadAuthorizedSnapshot(transactionDb, input)
      if (!snapshot) return notFound()
      const ready = existingReady(snapshot, input.actor)
      if (ready) return ready
      if (snapshot.workStatus !== 'open') return notFound()

      if (snapshot.state === 'initializing') {
        if (!snapshot.attemptKey) return unavailable()
        if (await expireOwnedLease(transactionDb, input, snapshot.attemptKey)) return ambiguous()
        return currentSafeState(transactionDb, input)
      }

      if (snapshot.state === 'ambiguous') {
        if (
          input.confirmAmbiguousRetry !== true
          || !snapshot.attemptKey
          || snapshot.attemptKey === input.attemptKey
        ) return ambiguous()
      } else if (!['idle', 'failed'].includes(snapshot.state)) {
        return unavailable()
      }

      const context = intakeFromSnapshot(snapshot)
      if (!context) return notFound()
      const allowedState = snapshot.state as 'idle' | 'failed' | 'ambiguous'
      const [leased] = await transactionDb
        .update(ticketJobs)
        .set({
          diagnosticStartState: 'initializing',
          diagnosticStartAttemptKey: input.attemptKey,
          diagnosticStartLeaseUntil:
            sql`now() + (${DIAGNOSTIC_START_LEASE_MINUTES} * interval '1 minute')`,
          diagnosticStartErrorCode: null,
          updatedAt: sql`now()`,
        })
        .where(and(
          actorAuthorization(input),
          eq(ticketJobs.workStatus, 'open'),
          eq(ticketJobs.diagnosticStartState, allowedState),
          allowedState === 'ambiguous' && snapshot.attemptKey
            ? and(
                eq(ticketJobs.diagnosticStartAttemptKey, snapshot.attemptKey),
                ne(ticketJobs.diagnosticStartAttemptKey, input.attemptKey),
              )
            : undefined,
        ))
        .returning()
      if (!leased?.diagnosticStartLeaseUntil) return currentSafeState(transactionDb, input)

      return {
        ok: true,
        state: 'initializing',
        leaseAcquired: true,
        attemptKey: input.attemptKey,
        leaseUntil: leased.diagnosticStartLeaseUntil,
        context,
      }
    })
  } catch {
    return unavailable()
  }
}

type FinalizeInput = StartInput & {
  sessionId: string
  treeState: TreeState
  context: { vehicleId: string; intake: IntakePayload }
  maxCorpusSimilarity?: number | null
}

type FinalizeDependencies = {
  beforeLink?: (tx: AppDb) => Promise<void>
}

class FinalizeOwnershipLost extends Error {}

function sameAcquiredContext(
  acquired: FinalizeInput['context'],
  persisted: { vehicleId: string; intake: IntakePayload },
): boolean {
  return acquired.vehicleId === persisted.vehicleId
    && acquired.intake.vehicleYear === persisted.intake.vehicleYear
    && acquired.intake.vehicleMake === persisted.intake.vehicleMake
    && acquired.intake.vehicleModel === persisted.intake.vehicleModel
    && acquired.intake.vehicleEngine === persisted.intake.vehicleEngine
    && acquired.intake.mileage === persisted.intake.mileage
    && acquired.intake.customerComplaint === persisted.intake.customerComplaint
}

async function settleOwnedAttempt(
  db: AppDb,
  input: StartInput & {
    state: 'failed' | 'ambiguous'
    errorCode: string
  },
): Promise<boolean> {
  const [updated] = await db
    .update(ticketJobs)
    .set({
      diagnosticStartState: input.state,
      diagnosticStartLeaseUntil: null,
      diagnosticStartErrorCode: input.errorCode,
      updatedAt: sql`now()`,
    })
    .where(and(
      eq(ticketJobs.shopId, input.actor.shopId),
      eq(ticketJobs.ticketId, input.ticketId),
      eq(ticketJobs.id, input.jobId),
      eq(ticketJobs.diagnosticStartState, 'initializing'),
      eq(ticketJobs.diagnosticStartAttemptKey, input.attemptKey),
      gt(ticketJobs.diagnosticStartLeaseUntil, sql`now()`),
    ))
    .returning()
  return Boolean(updated)
}

async function safeStateAfterWorkerLoss(
  db: AppDb,
  input: StartInput,
): Promise<SettleDiagnosticStartResult> {
  const safe = await currentSafeState(db, input)
  if (safe.ok || safe.status !== 404) return safe

  const [row] = await db
    .select({
      sessionId: ticketJobs.sessionId,
      state: ticketJobs.diagnosticStartState,
      attemptKey: ticketJobs.diagnosticStartAttemptKey,
    })
    .from(ticketJobs)
    .where(and(
      eq(ticketJobs.shopId, input.actor.shopId),
      eq(ticketJobs.ticketId, input.ticketId),
      eq(ticketJobs.id, input.jobId),
    ))
    .limit(1)
  if (!row || row.sessionId) return safe
  if (row.state === 'ambiguous' && row.attemptKey === input.attemptKey) return ambiguous()
  if (row.state === 'initializing' && row.attemptKey !== input.attemptKey) return waiting()
  return safe
}

export async function finalizeDiagnosticStart(
  db: AppDb,
  input: FinalizeInput,
  dependencies: FinalizeDependencies = {},
): Promise<SettleDiagnosticStartResult> {
  if (input.treeState.nodes.length === 0) {
    const snapshot = await loadAuthorizedSnapshot(db, input)
    const ready = snapshot ? existingReady(snapshot, input.actor) : null
    if (ready) return ready
    if (await settleOwnedAttempt(db, {
      ...input,
      state: 'ambiguous',
      errorCode: 'empty_initial_tree',
    })) return ambiguous()
    if (await expireOwnedLease(db, input, input.attemptKey)) return ambiguous()
    return safeStateAfterWorkerLoss(db, input)
  }

  try {
    const result = await db.transaction(async (tx) => {
      const transactionDb = tx as AppDb
      const snapshot = await loadAuthorizedSnapshot(transactionDb, input)
      if (!snapshot) throw new FinalizeOwnershipLost()
      const ready = existingReady(snapshot, input.actor)
      if (ready) return ready
      if (
        snapshot.workStatus !== 'open'
        || snapshot.state !== 'initializing'
        || snapshot.attemptKey !== input.attemptKey
      ) return currentSafeState(transactionDb, input)

      const context = intakeFromSnapshot(snapshot)
      if (!context) throw new FinalizeOwnershipLost()
      if (!sameAcquiredContext(input.context, context)) throw new FinalizeOwnershipLost()
      await transactionDb.insert(sessions).values({
        id: input.sessionId,
        shopId: input.actor.shopId,
        techId: input.actor.profileId,
        vehicleId: input.context.vehicleId,
        intake: input.context.intake,
        treeState: input.treeState,
        maxCorpusSimilarity: input.maxCorpusSimilarity ?? null,
      })
      await dependencies.beforeLink?.(transactionDb)
      const [linked] = await transactionDb
        .update(ticketJobs)
        .set({
          sessionId: input.sessionId,
          workStatus: 'in_progress',
          diagnosticStartState: 'ready',
          diagnosticStartAttemptKey: null,
          diagnosticStartLeaseUntil: null,
          diagnosticStartErrorCode: null,
          updatedAt: sql`now()`,
        })
        .where(and(
          actorAuthorization(input),
          eq(ticketJobs.workStatus, 'open'),
          eq(ticketJobs.diagnosticStartState, 'initializing'),
          eq(ticketJobs.diagnosticStartAttemptKey, input.attemptKey),
          gt(ticketJobs.diagnosticStartLeaseUntil, sql`now()`),
          isNull(ticketJobs.sessionId),
        ))
        .returning()
      if (!linked?.sessionId) throw new FinalizeOwnershipLost()
      return { ok: true, state: 'ready', sessionId: linked.sessionId } as const
    })
    return result
  } catch {
    const snapshot = await loadAuthorizedSnapshot(db, input)
    const ready = snapshot ? existingReady(snapshot, input.actor) : null
    if (ready) return ready
    if (await settleOwnedAttempt(db, {
      ...input,
      state: 'ambiguous',
      errorCode: 'persistence_outcome_uncertain',
    })) return ambiguous()
    if (await expireOwnedLease(db, input, input.attemptKey)) return ambiguous()
    return safeStateAfterWorkerLoss(db, input)
  }
}

export async function recordDiagnosticStartFailure(
  db: AppDb,
  input: StartInput & {
    certainty: 'certain' | 'uncertain'
    errorCode: string
  },
): Promise<SettleDiagnosticStartResult> {
  const snapshot = await loadAuthorizedSnapshot(db, input)
  const ready = snapshot ? existingReady(snapshot, input.actor) : null
  if (ready) return ready

  const nextState = input.certainty === 'certain' ? 'failed' : 'ambiguous'
  if (await settleOwnedAttempt(db, {
    ...input,
    state: nextState,
    errorCode: input.errorCode,
  })) return { ok: true, state: nextState }
  if (await expireOwnedLease(db, input, input.attemptKey)) return ambiguous()
  return safeStateAfterWorkerLoss(db, input)
}
