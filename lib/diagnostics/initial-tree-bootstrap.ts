import { generateInitialTree } from '@/lib/ai/tree-engine'
import type { TreeState } from '@/lib/ai/tree-engine'
import { retrieveCorpus } from '@/lib/corpus/retrieval'
import type { AppDb } from '@/lib/db/queries'
import { reconcileSeededSymptom } from '@/lib/diagnostics/reconcile-seeded-symptom'
import { resolvePlatformSlug } from '@/lib/diagnostics/resolve-platform'
import { extractDtcCodes, resolveSymptomSlug } from '@/lib/diagnostics/symptom-resolver'
import { ForumAdapter } from '@/lib/retrieval/adapters/forum'
import { ManufacturerRecallAdapter } from '@/lib/retrieval/adapters/manufacturer-recall'
import { NHTSAAdapter } from '@/lib/retrieval/adapters/nhtsa'
import { RedditAdapter } from '@/lib/retrieval/adapters/reddit'
import { WebSearchAdapter } from '@/lib/retrieval/adapters/web-search'
import { YouTubeAdapter } from '@/lib/retrieval/adapters/youtube'
import { runRetrieval } from '@/lib/retrieval/orchestrator'
import type { RetrievalAdapter } from '@/lib/retrieval/types'
import { validateRetrievalResults } from '@/lib/retrieval/validator'
import { buildGenerateInitialTreeWithRetrieval } from '@/lib/retrieval/wire-into-tree'
import type { IntakePayload } from '@/lib/types'

export type InitialTreeBootstrapDependencies = {
  adapters: RetrievalAdapter[]
  resolvePlatformSlug: typeof resolvePlatformSlug
  extractDtcCodes: typeof extractDtcCodes
  resolveSymptomSlug: typeof resolveSymptomSlug
  reconcileSeededSymptom: typeof reconcileSeededSymptom
  generateInitialTree: typeof generateInitialTree
  runRetrieval: typeof runRetrieval
  validateRetrievalResults: typeof validateRetrievalResults
  retrieveCorpus: typeof retrieveCorpus
  buildGenerateInitialTreeWithRetrieval: typeof buildGenerateInitialTreeWithRetrieval
}

const PRODUCTION_DEPENDENCIES: InitialTreeBootstrapDependencies = {
  adapters: [
    new NHTSAAdapter(),
    new ManufacturerRecallAdapter(),
    new ForumAdapter(),
    new YouTubeAdapter(),
    new RedditAdapter(),
    new WebSearchAdapter(),
  ],
  resolvePlatformSlug,
  extractDtcCodes,
  resolveSymptomSlug,
  reconcileSeededSymptom,
  generateInitialTree,
  runRetrieval,
  validateRetrievalResults,
  retrieveCorpus,
  buildGenerateInitialTreeWithRetrieval,
}

function createTopologyTree(): TreeState {
  return {
    nodes: [{ id: '_topology', label: 'topology', status: 'active' }],
    currentNodeId: '_topology',
    message: '',
    done: true,
  }
}

/**
 * Builds the first persisted tree for any diagnostic creation path.
 *
 * Topology selection stays a render-time concern: this seam stores only the
 * same populated sentinel as counter intake. Non-topology cases use the
 * existing retrieval/corpus/tree pipeline unchanged.
 */
export async function generateInitialDiagnosticTree(
  db: AppDb,
  intake: IntakePayload,
  deps: InitialTreeBootstrapDependencies = PRODUCTION_DEPENDENCIES,
): Promise<TreeState> {
  const platformSlug = deps.resolvePlatformSlug({
    year: intake.vehicleYear,
    make: intake.vehicleMake,
    model: intake.vehicleModel,
    engine: intake.vehicleEngine ?? '',
  })
  const symptomSlug = deps.resolveSymptomSlug({
    dtcCodes: deps.extractDtcCodes(intake.customerComplaint),
    complaintText: intake.customerComplaint,
  })
  const reconciledSymptomSlug = platformSlug
    ? await deps.reconcileSeededSymptom(db, platformSlug, {
        candidateSlug: symptomSlug,
        complaintText: intake.customerComplaint,
      })
    : null

  if (reconciledSymptomSlug) return createTopologyTree()

  const generateWithRetrieval = deps.buildGenerateInitialTreeWithRetrieval({
    db,
    adapters: deps.adapters,
    generateInitialTree: deps.generateInitialTree,
    runRetrieval: deps.runRetrieval,
    validateRetrievalResults: deps.validateRetrievalResults,
    retrieveCorpus: deps.retrieveCorpus,
  })
  return generateWithRetrieval(intake)
}
