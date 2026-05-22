import type { AppDb } from '@/lib/db/queries'
import { updateSessionMaxCorpusSimilarity } from '@/lib/db/queries'
import type {
  TreeState,
  CorpusMatch,
  updateTree as updateTreeFn,
  generateInitialTree as generateInitialTreeFn,
} from '@/lib/ai/tree-engine'
import type { IntakePayload } from '@/lib/types'
import type { retrieveCorpus as retrieveCorpusFn } from '@/lib/corpus/retrieval'
import type { RetrievalAdapter, RetrievalContext, RetrievalResult } from './types'
import type { runRetrieval as runRetrievalFn } from './orchestrator'
import type { validateRetrievalResults as validateResultsFn } from './validator'
import type { AdvanceStreamEvent } from '@/lib/advance-stream-events'

type UpdateTreeInput = Parameters<typeof updateTreeFn>[0]

/**
 * Wall-clock ceiling for the optional supporting-evidence phase (internet
 * retrieval + AI grading + cross-shop corpus). The routes that call these
 * wrappers run on a 60s serverless limit; the only mandatory step is the LLM
 * tree call. When retrieval is slow — cold cache, a degraded upstream API —
 * letting it block the whole request pushes past that limit and surfaces as a
 * 504 at the edge. This ceiling makes the "never block on optional supporting
 * evidence" contract real: if the evidence isn't ready in time, generation
 * proceeds without it. A retried request then succeeds because each adapter
 * caches its result as it completes, so the second run reads warm cache.
 */
const OPTIONAL_EVIDENCE_DEADLINE_MS = 20_000

function withDeadline<T>(work: Promise<T>, fallback: T, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const deadline = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms)
  })
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer))
}

export type BuildUpdateTreeWithRetrievalDeps = {
  db: AppDb
  adapters: RetrievalAdapter[]
  updateTree: typeof updateTreeFn
  runRetrieval: typeof runRetrievalFn
  validateRetrievalResults: typeof validateResultsFn
  /** Phase K (Cross-Shop Corpus). Optional — when omitted, no corpus
   *  is passed to updateTree (back-compat). When provided, the wrapper
   *  fetches corpus matches in parallel with internet retrieval, falls
   *  through to [] on error, and forwards the result to updateTree. */
  retrieveCorpus?: typeof retrieveCorpusFn
  /** Phase P (novel-pattern fix). The session ID is needed to persist the max
   *  corpus similarity score after each retrieval call. Optional for
   *  back-compat — when omitted, the score is not persisted. */
  sessionId?: string
  /** Optional. Called with stage events when the wrapper enters retrieval
   *  ('Updating retrieval ladder') and when it exits retrieval before the
   *  LLM step ('Re-scoring confidence'). Defaults to no-op. The `idx` is a
   *  -1 sentinel; the streaming route remaps it to a canonical index. */
  onProgress?: (event: AdvanceStreamEvent) => void
}

/**
 * Wraps `updateTree` so it runs Rung-0 corpus retrieval AND Rung-1
 * internet retrieval + LLM grading before delegating to the real
 * `updateTree`. Both retrievals run in parallel; failures fall through
 * with empty arrays and a `console.warn` — the advance flow should
 * never block on optional supporting evidence.
 *
 * Dependencies are injected so unit tests can mock them without
 * `vi.mock` plumbing.
 */
export function buildUpdateTreeWithRetrieval(
  deps: BuildUpdateTreeWithRetrievalDeps,
): (input: UpdateTreeInput) => Promise<TreeState> {
  return async (input) => {
    // Prefer session-wide DTCs (from advanceSession) so retrieval keeps its DTC
    // anchor after the tree advances past `scan-codes`. Fall back to current-node
    // artifacts when the caller didn't supply session DTCs (e.g. direct callers
    // of updateTree that bypass advanceSession).
    const dtcs =
      input.sessionDtcs && input.sessionDtcs.length > 0
        ? input.sessionDtcs
        : (input.artifacts ?? []).flatMap((a) => {
            const codes = (a.structured as { dtcs?: Array<{ code?: string }> } | undefined)
              ?.dtcs
            return Array.isArray(codes)
              ? codes.map((d) => d?.code).filter((c): c is string => typeof c === 'string')
              : []
          })

    const ctx: RetrievalContext = {
      vehicleYear: input.intake.vehicleYear,
      vehicleMake: input.intake.vehicleMake,
      vehicleModel: input.intake.vehicleModel,
      vehicleEngine: input.intake.vehicleEngine,
      dtcs: dtcs.length ? dtcs : undefined,
      complaintText: input.intake.customerComplaint,
      observation: input.observation,
    }

    deps.onProgress?.({
      type: 'stage',
      idx: -1,
      label: 'Updating retrieval ladder',
    })

    const retrievalPromise = (async (): Promise<RetrievalResult[]> => {
      try {
        const run = await deps.runRetrieval({ db: deps.db, adapters: deps.adapters, ctx })
        try {
          return await deps.validateRetrievalResults({ ctx, results: run.results })
        } catch (graderErr) {
          console.warn('retrieval validation failed:', graderErr)
          return run.results
        }
      } catch (err) {
        console.warn('retrieval failed:', err)
        return []
      }
    })()

    const corpusPromise: Promise<CorpusMatch[] | undefined> = deps.retrieveCorpus
      ? (async () => {
          try {
            const matches = await deps.retrieveCorpus!(deps.db, {
              vehicleYear: ctx.vehicleYear,
              vehicleMake: ctx.vehicleMake,
              vehicleModel: ctx.vehicleModel,
              vehicleEngine: ctx.vehicleEngine,
              dtcs: ctx.dtcs,
              complaintText: ctx.complaintText,
            })
            // Phase P: persist max similarity score so close route can read it.
            if (matches.length > 0 && deps.sessionId) {
              const newMax = Math.max(...matches.map((m) => m.similarityScore))
              try {
                await updateSessionMaxCorpusSimilarity(deps.db, deps.sessionId, newMax)
              } catch (persistErr) {
                console.warn('failed to persist max corpus similarity:', persistErr)
              }
            }
            return matches
          } catch (err) {
            console.warn('corpus retrieval failed:', err)
            return []
          }
        })()
      : Promise.resolve(undefined)

    const evidenceFallback: [RetrievalResult[], CorpusMatch[] | undefined] = [
      [],
      deps.retrieveCorpus ? [] : undefined,
    ]
    const [retrieval, corpus] = await withDeadline(
      Promise.all([retrievalPromise, corpusPromise]),
      evidenceFallback,
      OPTIONAL_EVIDENCE_DEADLINE_MS,
    )

    deps.onProgress?.({
      type: 'stage',
      idx: -1,
      label: 'Re-scoring confidence',
    })

    return deps.updateTree({
      ...input,
      retrieval,
      ...(corpus !== undefined ? { corpus } : {}),
    })
  }
}

export type BuildGenerateInitialTreeWithRetrievalDeps = {
  db: AppDb
  adapters: RetrievalAdapter[]
  generateInitialTree: typeof generateInitialTreeFn
  runRetrieval: typeof runRetrievalFn
  validateRetrievalResults: typeof validateResultsFn
  /** Optional. When provided, corpus matches are fetched in parallel with
   *  retrieval and forwarded to generateInitialTree. */
  retrieveCorpus?: typeof retrieveCorpusFn
}

/**
 * Wraps `generateInitialTree` so it runs Rung-0 corpus retrieval AND Rung-1
 * internet retrieval + LLM grading before delegating to the real
 * `generateInitialTree`. Mirrors `buildUpdateTreeWithRetrieval` for the intake
 * (case-creation) path. Both retrievals run in parallel; failures fall through
 * with empty arrays — initial tree generation must never block on optional
 * supporting evidence.
 */
export function buildGenerateInitialTreeWithRetrieval(
  deps: BuildGenerateInitialTreeWithRetrievalDeps,
): (intake: IntakePayload) => Promise<TreeState> {
  return async (intake) => {
    const ctx: RetrievalContext = {
      vehicleYear: intake.vehicleYear,
      vehicleMake: intake.vehicleMake,
      vehicleModel: intake.vehicleModel,
      vehicleEngine: intake.vehicleEngine,
      complaintText: intake.customerComplaint,
    }

    const retrievalPromise = (async (): Promise<RetrievalResult[]> => {
      try {
        const run = await deps.runRetrieval({ db: deps.db, adapters: deps.adapters, ctx })
        try {
          return await deps.validateRetrievalResults({ ctx, results: run.results })
        } catch (graderErr) {
          console.warn('intake retrieval validation failed:', graderErr)
          return run.results
        }
      } catch (err) {
        console.warn('intake retrieval failed:', err)
        return []
      }
    })()

    const corpusPromise: Promise<CorpusMatch[] | undefined> = deps.retrieveCorpus
      ? (async () => {
          try {
            return await deps.retrieveCorpus!(deps.db, {
              vehicleYear: ctx.vehicleYear,
              vehicleMake: ctx.vehicleMake,
              vehicleModel: ctx.vehicleModel,
              vehicleEngine: ctx.vehicleEngine,
              complaintText: ctx.complaintText,
            })
          } catch (err) {
            console.warn('intake corpus retrieval failed:', err)
            return []
          }
        })()
      : Promise.resolve(undefined)

    const evidenceFallback: [RetrievalResult[], CorpusMatch[] | undefined] = [
      [],
      deps.retrieveCorpus ? [] : undefined,
    ]
    const [retrieval, corpus] = await withDeadline(
      Promise.all([retrievalPromise, corpusPromise]),
      evidenceFallback,
      OPTIONAL_EVIDENCE_DEADLINE_MS,
    )

    return deps.generateInitialTree(intake, corpus, retrieval)
  }
}
