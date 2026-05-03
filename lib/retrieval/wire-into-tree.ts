import type { AppDb } from '@/lib/db/queries'
import type { TreeState, updateTree as updateTreeFn } from '@/lib/ai/tree-engine'
import type { RetrievalAdapter, RetrievalContext, RetrievalResult } from './types'
import type { runRetrieval as runRetrievalFn } from './orchestrator'
import type { validateRetrievalResults as validateResultsFn } from './validator'

type UpdateTreeInput = Parameters<typeof updateTreeFn>[0]

export type BuildUpdateTreeWithRetrievalDeps = {
  db: AppDb
  adapters: RetrievalAdapter[]
  updateTree: typeof updateTreeFn
  runRetrieval: typeof runRetrievalFn
  validateRetrievalResults: typeof validateResultsFn
}

/**
 * Wraps `updateTree` so it runs Rung-1 internet retrieval + LLM grading before
 * delegating to the real `updateTree`. Failures fall through with `retrieval: []`
 * and a `console.warn` — the advance flow should never block on optional
 * supporting evidence.
 *
 * Dependencies (`runRetrieval`, `validateRetrievalResults`) are injected so unit
 * tests can mock them without `vi.mock` plumbing.
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

    let retrieval: RetrievalResult[] = []
    try {
      const run = await deps.runRetrieval({ db: deps.db, adapters: deps.adapters, ctx })
      try {
        retrieval = await deps.validateRetrievalResults({ ctx, results: run.results })
      } catch (graderErr) {
        console.warn('retrieval validation failed:', graderErr)
        retrieval = run.results
      }
    } catch (err) {
      console.warn('retrieval failed:', err)
      retrieval = []
    }

    // Phase K (corpus) not built yet; intentionally omitted from updateTree input.
    return deps.updateTree({
      ...input,
      retrieval,
    })
  }
}
