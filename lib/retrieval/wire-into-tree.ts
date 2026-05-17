import type { AppDb } from '@/lib/db/queries'
import { updateSessionMaxCorpusSimilarity } from '@/lib/db/queries'
import type {
  CorpusMatch,
  TreeEngineResult,
  updateTree as updateTreeFn,
  generateInitialTree as generateInitialTreeFn,
} from '@/lib/ai/tree-engine'
import type { IntakePayload } from '@/lib/types'
import type { retrieveCorpus as retrieveCorpusFn } from '@/lib/corpus/retrieval'
import type { RetrievalAdapter, RetrievalContext, RetrievalResult } from './types'
import type { runRetrieval as runRetrievalFn } from './orchestrator'
import type { validateRetrievalResults as validateResultsFn } from './validator'
import type { AdvanceStreamEvent } from '@/lib/advance-stream-events'
import { KNOWLEDGE_TOOLS } from '@/lib/knowledge/tools'
import {
  lookupKnowledge,
  getConnectorPinout,
  getTheoryOfOperation,
  getWiringPath,
  getComponentLocation,
  getSpec,
  incrementFireCount,
  type MatchedKnowledgeItem,
} from '@/lib/knowledge/retrieval'

type UpdateTreeInput = Parameters<typeof updateTreeFn>[0]

/** PR 4. Dispatches an Anthropic tool call to the matching knowledge SQL fn,
 *  scoped to the caller's shopId. Throws on unknown tool name (defensive —
 *  the tools we pass to the AI come from KNOWLEDGE_TOOLS, so any unknown
 *  name means the AI invented one). */
export type KnowledgeDispatcher = (
  toolName: string,
  toolInput: Record<string, unknown>,
) => Promise<{ items: MatchedKnowledgeItem[] }>

function toStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  return v.filter((x): x is string => typeof x === 'string')
}

function vehicleFromInput(toolInput: Record<string, unknown>) {
  const raw = toolInput.vehicle as
    | { year?: unknown; make?: unknown; model?: unknown; engine?: unknown }
    | undefined
  return {
    year: Number(raw?.year),
    make: String(raw?.make ?? ''),
    model: String(raw?.model ?? ''),
    engine: typeof raw?.engine === 'string' ? raw.engine : undefined,
  }
}

export function defaultBuildKnowledgeDispatcher(args: {
  db: AppDb
  shopId: string
}): KnowledgeDispatcher {
  return async (toolName, toolInput) => {
    const v = vehicleFromInput(toolInput)
    let items: MatchedKnowledgeItem[] = []
    switch (toolName) {
      case 'lookup_knowledge':
        items = await lookupKnowledge(args.db, {
          shopId: args.shopId,
          vehicle: v,
          dtcs: toStringArray(toolInput.dtcs),
          systemCodes: toStringArray(toolInput.system_codes),
          symptoms: toStringArray(toolInput.symptoms),
          typeFilter:
            typeof toolInput.type_filter === 'string'
              ? (toolInput.type_filter as Parameters<typeof lookupKnowledge>[1]['typeFilter'])
              : undefined,
          limit: typeof toolInput.limit === 'number' ? toolInput.limit : undefined,
        })
        break
      case 'get_connector_pinout':
        items = await getConnectorPinout(args.db, {
          shopId: args.shopId,
          vehicle: v,
          connectorRef: String(toolInput.connector_ref ?? ''),
        })
        break
      case 'get_theory_of_operation':
        items = await getTheoryOfOperation(args.db, {
          shopId: args.shopId,
          vehicle: v,
          systemCode: String(toolInput.system_code ?? ''),
        })
        break
      case 'get_wiring_path':
        items = await getWiringPath(args.db, {
          shopId: args.shopId,
          vehicle: v,
          fromComponent: String(toolInput.from_component ?? ''),
          toComponent: String(toolInput.to_component ?? ''),
        })
        break
      case 'get_component_location':
        items = await getComponentLocation(args.db, {
          shopId: args.shopId,
          vehicle: v,
          componentName: String(toolInput.component_name ?? ''),
        })
        break
      case 'get_spec':
        items = await getSpec(args.db, {
          shopId: args.shopId,
          vehicle: v,
          specName: String(toolInput.spec_name ?? ''),
        })
        break
      default:
        console.warn(`unknown knowledge tool: ${toolName}`)
        return { items: [] }
    }
    if (items.length > 0) {
      // Fire-and-forget — telemetry must never block retrieval.
      incrementFireCount(args.db, items.map((i) => i.id)).catch((e) =>
        console.warn('fire_count increment failed:', e),
      )
    }
    return { items }
  }
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
  /** PR 4 knowledge wiring. Both fields together (factory + shopId) bind a
   *  scoped dispatcher into the tree-engine call. Either omitted = AI sees
   *  no knowledge tools (back-compat). */
  buildKnowledgeDispatcher?: (args: { db: AppDb; shopId: string }) => KnowledgeDispatcher
  shopId?: string
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
): (input: UpdateTreeInput) => Promise<TreeEngineResult> {
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

    const [retrieval, corpus] = await Promise.all([retrievalPromise, corpusPromise])

    deps.onProgress?.({
      type: 'stage',
      idx: -1,
      label: 'Re-scoring confidence',
    })

    const tools =
      deps.buildKnowledgeDispatcher && deps.shopId ? KNOWLEDGE_TOOLS : undefined
    const dispatcher =
      deps.buildKnowledgeDispatcher && deps.shopId
        ? deps.buildKnowledgeDispatcher({ db: deps.db, shopId: deps.shopId })
        : undefined

    return deps.updateTree({
      ...input,
      retrieval,
      ...(corpus !== undefined ? { corpus } : {}),
      ...(tools && dispatcher ? { tools, dispatcher } : {}),
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
  /** PR 4 knowledge wiring (mirrors updateTree wrapper). */
  buildKnowledgeDispatcher?: (args: { db: AppDb; shopId: string }) => KnowledgeDispatcher
  shopId?: string
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
): (intake: IntakePayload) => Promise<TreeEngineResult> {
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

    const [retrieval, corpus] = await Promise.all([retrievalPromise, corpusPromise])

    const tools =
      deps.buildKnowledgeDispatcher && deps.shopId ? KNOWLEDGE_TOOLS : undefined
    const dispatcher =
      deps.buildKnowledgeDispatcher && deps.shopId
        ? deps.buildKnowledgeDispatcher({ db: deps.db, shopId: deps.shopId })
        : undefined

    return deps.generateInitialTree(
      intake,
      corpus,
      retrieval,
      tools && dispatcher ? { tools, dispatcher } : {},
    )
  }
}
