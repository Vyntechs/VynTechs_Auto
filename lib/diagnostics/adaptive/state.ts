import { and, eq, TransactionRollbackError } from 'drizzle-orm'
import { z } from 'zod'
import type { TopologyTestAction } from '@/lib/diagnostics/load-system-topology'
import type { AppDb } from '@/lib/db/queries'
import { sessionEvents, sessions } from '@/lib/db/schema'
import { reconcileSeededSymptom } from '@/lib/diagnostics/reconcile-seeded-symptom'
import { resolvePlatformSlug } from '@/lib/diagnostics/resolve-platform'
import { extractDtcCodes, resolveSymptomSlug } from '@/lib/diagnostics/symptom-resolver'
import {
  adaptiveMutationDependencies,
  adaptiveRequestFingerprint,
  authorizeAdaptiveMutation,
  type AdaptiveMutationActor,
} from './actor'
import type {
  AdaptiveCoverage,
  AdaptiveDiagnosticState,
  DiagnosticMode,
} from './contracts'
import { adaptiveDiagnosticStateSchema } from './contracts'
import { resolveAdaptiveCoverage } from './coverage'
import { adaptiveStepId } from './step-adapter'

const updateAdaptiveModeSchema = z.object({
  requestKey: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
  mode: z.enum(['guided', 'manual']),
}).strict()

const adaptiveModeResponseSchema = z.object({
  schemaVersion: z.literal(1),
  from: z.enum(['guided', 'manual']),
  to: z.enum(['guided', 'manual']),
  state: adaptiveDiagnosticStateSchema,
  revision: z.number().int().nonnegative(),
})

export type UpdateAdaptiveModeResult =
  | { ok: true; state: AdaptiveDiagnosticState; revision: number }
  | { ok: false; status: 400 | 404 | 409; error: 'invalid_input' | 'not_found' | 'not_eligible' }

export function initialAdaptiveState(
  coverage: AdaptiveCoverage,
): AdaptiveDiagnosticState {
  let mode: DiagnosticMode
  switch (coverage.state) {
    case 'exact':
    case 'verified_equivalent':
      mode = coverage.technicianInstructionsAvailable ? 'guided' : 'manual'
      break
    case 'partial':
    case 'draft':
    case 'unsupported':
      mode = 'manual'
      break
  }

  return {
    schemaVersion: 1,
    mode,
    coverage,
    currentTestActionId: null,
    finding: null,
  }
}

export function changeDiagnosticMode(
  state: AdaptiveDiagnosticState,
  mode: DiagnosticMode,
): AdaptiveDiagnosticState {
  switch (mode) {
    case 'guided':
      return { ...state, mode: 'guided' }
    case 'manual':
      return { ...state, mode: 'manual' }
  }
}

export function selectCurrentAdaptiveTest(
  state: AdaptiveDiagnosticState,
  steps: readonly TopologyTestAction[],
): TopologyTestAction | null {
  const fallback = steps[0] ?? null
  if (state.currentTestActionId === null) return fallback

  return steps.find(
    (step) => adaptiveStepId(step) === state.currentTestActionId,
  ) ?? fallback
}

async function initializeAdaptiveState(
  db: AppDb,
  intake: {
    vehicleYear: number
    vehicleMake: string
    vehicleModel: string
    vehicleEngine?: string
    customerComplaint: string
  },
): Promise<AdaptiveDiagnosticState> {
  const platformSlug = resolvePlatformSlug({
    year: intake.vehicleYear,
    make: intake.vehicleMake,
    model: intake.vehicleModel,
    engine: intake.vehicleEngine ?? '',
  })
  const candidateSlug = resolveSymptomSlug({
    dtcCodes: extractDtcCodes(intake.customerComplaint),
    complaintText: intake.customerComplaint,
  })
  const symptomSlug = platformSlug
    ? await reconcileSeededSymptom(db, platformSlug, {
        candidateSlug,
        complaintText: intake.customerComplaint,
      })
    : null
  const coverage = await resolveAdaptiveCoverage(db, { platformSlug, symptomSlug })
  return initialAdaptiveState(coverage)
}

function canUseGuidedMode(state: AdaptiveDiagnosticState): boolean {
  return (state.coverage.state === 'exact' || state.coverage.state === 'verified_equivalent')
    && state.coverage.technicianInstructionsAvailable
    && state.coverage.instructionProof !== null
}

export async function updateAdaptiveModeForUser(opts: {
  db: AppDb
  actor: AdaptiveMutationActor
  sessionId: string
  requestKey: string
  expectedRevision: number
  body: unknown
}): Promise<UpdateAdaptiveModeResult> {
  const parsed = updateAdaptiveModeSchema.safeParse(opts.body)
  if (
    !parsed.success
    || parsed.data.requestKey !== opts.requestKey
    || parsed.data.expectedRevision !== opts.expectedRevision
  ) {
    return { ok: false, status: 400, error: 'invalid_input' }
  }

  const input = parsed.data
  const fingerprint = adaptiveRequestFingerprint('mode', input)

  try {
    return await opts.db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          intake: sessions.intake,
          state: sessions.adaptiveDiagnosticState,
          revision: sessions.adaptiveRevision,
        })
        .from(sessions)
        .where(eq(sessions.id, opts.sessionId))
        .for('update')
        .limit(1)

      if (!row) return { ok: false, status: 404, error: 'not_found' } as const

      const authorized = await authorizeAdaptiveMutation(tx, {
        actor: opts.actor,
        sessionId: opts.sessionId,
        expectedRevision: row.revision,
      }, adaptiveMutationDependencies)

      if (!authorized) {
        return { ok: false, status: 409, error: 'not_eligible' } as const
      }

      const [priorEvent] = await tx
        .select({
          actorProfileId: sessionEvents.requestActorProfileId,
          fingerprint: sessionEvents.requestFingerprint,
          aiResponse: sessionEvents.aiResponse,
        })
        .from(sessionEvents)
        .where(and(
          eq(sessionEvents.sessionId, opts.sessionId),
          eq(sessionEvents.requestKey, input.requestKey),
        ))
        .limit(1)

      const canonicalReplay = priorEvent?.actorProfileId === opts.actor.profileId
        && priorEvent.fingerprint === fingerprint
      if (priorEvent && !canonicalReplay) {
        return { ok: false, status: 409, error: 'not_eligible' } as const
      }

      if (canonicalReplay) {
        const snapshot = adaptiveModeResponseSchema.safeParse(
          priorEvent.aiResponse?.adaptiveModeChange,
        )
        if (!snapshot.success) {
          return { ok: false, status: 409, error: 'not_eligible' } as const
        }
        return {
          ok: true,
          state: snapshot.data.state,
          revision: snapshot.data.revision,
        } as const
      }

      if (row.revision !== input.expectedRevision) {
        return { ok: false, status: 409, error: 'not_eligible' } as const
      }

      const storedState = row.state === null
        ? await initializeAdaptiveState(tx, row.intake)
        : adaptiveDiagnosticStateSchema.safeParse(row.state).data
      if (!storedState) {
        return { ok: false, status: 409, error: 'not_eligible' } as const
      }
      if (input.mode === 'guided' && !canUseGuidedMode(storedState)) {
        return { ok: false, status: 409, error: 'not_eligible' } as const
      }

      const nextState = changeDiagnosticMode(storedState, input.mode)
      const inserted = await tx.insert(sessionEvents).values({
        sessionId: opts.sessionId,
        nodeId: 'adaptive-mode',
        eventType: 'tree_update',
        aiResponse: {
          adaptiveModeChange: {
            schemaVersion: 1,
            from: storedState.mode,
            to: input.mode,
            state: nextState,
            revision: input.expectedRevision + 1,
          },
        },
        requestKey: input.requestKey,
        requestActorProfileId: opts.actor.profileId,
        requestFingerprint: fingerprint,
      }).onConflictDoNothing().returning()

      if (inserted.length === 0) {
        const [winner] = await tx
          .select({
            actorProfileId: sessionEvents.requestActorProfileId,
            fingerprint: sessionEvents.requestFingerprint,
            aiResponse: sessionEvents.aiResponse,
          })
          .from(sessionEvents)
          .where(and(
            eq(sessionEvents.sessionId, opts.sessionId),
            eq(sessionEvents.requestKey, input.requestKey),
          ))
          .limit(1)
        if (
          winner?.actorProfileId === opts.actor.profileId
          && winner.fingerprint === fingerprint
        ) {
          const snapshot = adaptiveModeResponseSchema.safeParse(
            winner.aiResponse?.adaptiveModeChange,
          )
          if (snapshot.success) {
            return {
              ok: true,
              state: snapshot.data.state,
              revision: snapshot.data.revision,
            } as const
          }
        }
        return { ok: false, status: 409, error: 'not_eligible' } as const
      }

      const updated = await tx
        .update(sessions)
        .set({
          adaptiveDiagnosticState: nextState,
          adaptiveRevision: input.expectedRevision + 1,
        })
        .where(and(
          eq(sessions.id, opts.sessionId),
          eq(sessions.adaptiveRevision, input.expectedRevision),
        ))
        .returning()

      if (updated.length === 0) {
        tx.rollback()
      }

      return { ok: true, state: nextState, revision: updated[0].adaptiveRevision } as const
    })
  } catch (error) {
    if (error instanceof TransactionRollbackError) {
      return { ok: false, status: 409, error: 'not_eligible' }
    }
    throw error
  }
}
