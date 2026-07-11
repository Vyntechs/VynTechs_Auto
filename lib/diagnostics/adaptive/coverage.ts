import {
  and,
  arrayContains,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  or,
} from 'drizzle-orm'
import type { AppDb } from '@/lib/db/queries'
import {
  architectureFacts,
  branchLogic,
  componentConnections,
  componentPins,
  components,
  observableProperties,
  platformEquivalents,
  platforms,
  researchRuns,
  symptoms,
  symptomTestImplications,
  systemScenarios,
  testActions,
} from '@/lib/db/schema'
import type { AdaptiveCoverage } from './contracts'

type InstructionProof = NonNullable<AdaptiveCoverage['instructionProof']>

type GraphProof = {
  hasGraph: boolean
  proof: InstructionProof | null
  reasons: string[]
}

const FIELD_VERIFIED = 'FIELD-VERIFIED'

function unsupported(
  symptomSlug: string,
  system: string,
  reason: string,
): AdaptiveCoverage {
  return {
    state: 'unsupported',
    system,
    symptomSlug,
    reasons: [reason],
    technicianInstructionsAvailable: false,
    instructionProof: null,
  }
}

async function verifiedArchitectureAxes(
  db: AppDb,
  platformId: string,
): Promise<string[] | null> {
  const rows = await db
    .select({
      slug: architectureFacts.slug,
      provenance: architectureFacts.sourceProvenance,
      fieldVerifyRequired: architectureFacts.fieldVerifyRequired,
    })
    .from(architectureFacts)
    .where(and(
      eq(architectureFacts.platformId, platformId),
      eq(architectureFacts.isRetired, false),
    ))
    .orderBy(asc(architectureFacts.slug))

  if (rows.length === 0) return null
  if (rows.some((row) => row.provenance !== FIELD_VERIFIED || row.fieldVerifyRequired)) {
    return null
  }
  return rows.map((row) => row.slug)
}

async function inspectGraphProof(
  db: AppDb,
  input: { platformId: string; symptomId: string; system: string },
): Promise<GraphProof> {
  const componentRows = await db
    .select({
      id: components.id,
      provenance: components.sourceProvenance,
      unknownNote: components.unknownNote,
    })
    .from(components)
    .where(and(
      eq(components.platformId, input.platformId),
      eq(components.isRetired, false),
      arrayContains(components.systems, [input.system]),
    ))
    .orderBy(asc(components.id))

  if (componentRows.length === 0) {
    return { hasGraph: false, proof: null, reasons: [] }
  }

  const componentIds = componentRows.map((row) => row.id)
  const reasons: string[] = []
  const axes = await verifiedArchitectureAxes(db, input.platformId)
  if (!axes) reasons.push('Application architecture facts are not field-verified and complete.')
  if (componentRows.some((row) => row.provenance !== FIELD_VERIFIED || row.unknownNote?.trim())) {
    reasons.push('One or more surfaced components are not field-verified and complete.')
  }

  const connectionRows = await db
    .select({
      id: componentConnections.id,
      kind: componentConnections.connectionKind,
      fromPinId: componentConnections.fromPinId,
      toPinId: componentConnections.toPinId,
      provenance: componentConnections.sourceProvenance,
    })
    .from(componentConnections)
    .where(and(
      eq(componentConnections.isRetired, false),
      inArray(componentConnections.fromComponentId, componentIds),
      inArray(componentConnections.toComponentId, componentIds),
    ))
    .orderBy(asc(componentConnections.id))

  if (connectionRows.some((row) => row.provenance !== FIELD_VERIFIED)) {
    reasons.push('One or more surfaced connections are not field-verified.')
  }

  const observableRows = await db
    .select({
      provenance: observableProperties.sourceProvenance,
    })
    .from(observableProperties)
    .where(and(
      eq(observableProperties.isRetired, false),
      inArray(observableProperties.componentId, componentIds),
    ))
  if (observableRows.some((row) => row.provenance !== FIELD_VERIFIED)) {
    reasons.push('One or more surfaced observations are not field-verified.')
  }

  const pinRows = await db
    .select({
      id: componentPins.id,
      expectedReading: componentPins.expectedReading,
      probeLocation: componentPins.probeLocation,
      missingLogic: componentPins.missingLogic,
      labelGap: componentPins.labelGap,
      provenance: componentPins.sourceProvenance,
    })
    .from(componentPins)
    .where(and(
      eq(componentPins.isRetired, false),
      inArray(componentPins.componentId, componentIds),
    ))
    .orderBy(asc(componentPins.id))
  const pinIds = pinRows.map((row) => row.id)
  const pinSet = new Set(pinIds)
  if (pinRows.some((row) => (
    row.provenance !== FIELD_VERIFIED
    || !row.expectedReading.trim()
    || !row.probeLocation.trim()
    || !row.missingLogic.trim()
    || Boolean(row.labelGap?.trim())
  ))) {
    reasons.push('One or more surfaced pins are not field-verified and complete.')
  }
  if (connectionRows.some((row) => row.kind === 'electrical-wire' && (
    !row.fromPinId
    || !row.toPinId
    || !pinSet.has(row.fromPinId)
    || !pinSet.has(row.toPinId)
  ))) {
    reasons.push('One or more electrical connections lack verified in-graph pin endpoints.')
  }

  const testRows = await db
    .select({
      id: testActions.id,
      provenance: testActions.sourceProvenance,
      scenarioRequired: testActions.scenarioRequired,
      expectedValue: testActions.expectedValue,
      expectedUnit: testActions.expectedUnit,
      expectedObservation: testActions.expectedObservation,
    })
    .from(testActions)
    .where(and(
      eq(testActions.isRetired, false),
      inArray(testActions.componentId, componentIds),
    ))
    .orderBy(asc(testActions.id))
  const testActionIds = testRows.map((row) => row.id)
  if (testRows.length === 0) reasons.push('The surfaced graph has no active test actions.')
  if (testRows.some((row) => {
    const hasNumericExpected = row.expectedValue !== null
    const numericExpectedComplete = !hasNumericExpected || Boolean(row.expectedUnit?.trim())
    const hasExpected = hasNumericExpected || Boolean(row.expectedObservation?.trim())
    return row.provenance !== FIELD_VERIFIED || !hasExpected || !numericExpectedComplete
  })) {
    reasons.push('One or more surfaced tests lack field-verified expected results.')
  }

  const branchRows = testActionIds.length === 0
    ? []
    : await db
        .select({
          id: branchLogic.id,
          provenance: branchLogic.sourceProvenance,
          routesToTestActionId: branchLogic.routesToTestActionId,
        })
        .from(branchLogic)
        .where(and(
          eq(branchLogic.isRetired, false),
          inArray(branchLogic.testActionId, testActionIds),
        ))
        .orderBy(asc(branchLogic.id))
  const testActionSet = new Set(testActionIds)
  if (branchRows.some((row) => (
    row.provenance !== FIELD_VERIFIED
    || Boolean(row.routesToTestActionId && !testActionSet.has(row.routesToTestActionId))
  ))) {
    reasons.push('One or more surfaced branches are not field-verified or route outside the graph.')
  }

  const implicationRows = testActionIds.length === 0
    ? []
    : await db
        .select({
          testActionId: symptomTestImplications.testActionId,
          provenance: symptomTestImplications.sourceProvenance,
        })
        .from(symptomTestImplications)
        .where(and(
          eq(symptomTestImplications.symptomId, input.symptomId),
          eq(symptomTestImplications.isRetired, false),
          inArray(symptomTestImplications.testActionId, testActionIds),
        ))
  if (implicationRows.length === 0) {
    reasons.push('No field-verified test is implicated by the requested concern.')
  } else if (implicationRows.some((row) => row.provenance !== FIELD_VERIFIED)) {
    reasons.push('One or more concern-to-test implications are not field-verified.')
  }

  const scenarioRows = await db
    .select({ id: systemScenarios.id })
    .from(systemScenarios)
    .where(and(
      eq(systemScenarios.platformId, input.platformId),
      eq(systemScenarios.system, input.system),
      eq(systemScenarios.isRetired, false),
    ))
    .orderBy(asc(systemScenarios.id))
  if (scenarioRows.length > 0 || testRows.some((row) => row.scenarioRequired !== 'none')) {
    reasons.push('Surfaced operating scenarios lack provenance and publication proof.')
  }

  if (reasons.length > 0 || !axes) {
    return { hasGraph: true, proof: null, reasons }
  }
  return {
    hasGraph: true,
    proof: {
      componentIds,
      testActionIds,
      branchLogicIds: branchRows.map((row) => row.id),
      verifiedAxes: axes.map((axis) => `exact:${axis}`),
    },
    reasons: [],
  }
}

async function hasResearchDraft(
  db: AppDb,
  input: { platformSlug: string; symptomSlug: string },
): Promise<boolean> {
  const [row] = await db
    .select({ id: researchRuns.id })
    .from(researchRuns)
    .where(and(
      eq(researchRuns.platformSlug, input.platformSlug),
      eq(researchRuns.symptomSlug, input.symptomSlug),
      isNotNull(researchRuns.systemDataDraft),
    ))
    .orderBy(desc(researchRuns.startedAt), desc(researchRuns.id))
    .limit(1)
  return Boolean(row)
}

export async function resolveAdaptiveCoverage(
  db: AppDb,
  input: { platformSlug: string | null; symptomSlug: string | null },
): Promise<AdaptiveCoverage> {
  if (!input.platformSlug || !input.symptomSlug) {
    return unsupported(
      input.symptomSlug ?? 'unresolved',
      'unresolved',
      'Application or concern scope is not resolved.',
    )
  }

  const [[platform], [symptom]] = await Promise.all([
    db
      .select({ id: platforms.id })
      .from(platforms)
      .where(eq(platforms.slug, input.platformSlug))
      .limit(1),
    db
      .select({ id: symptoms.id, system: symptoms.system })
      .from(symptoms)
      .where(eq(symptoms.slug, input.symptomSlug))
      .limit(1),
  ])
  const system = symptom?.system ?? 'unresolved'

  if (platform && symptom?.system) {
    const direct = await inspectGraphProof(db, {
      platformId: platform.id,
      symptomId: symptom.id,
      system: symptom.system,
    })
    if (direct.hasGraph) {
      return {
        state: 'exact',
        system: symptom.system,
        symptomSlug: input.symptomSlug,
        reasons: direct.proof
          ? ['Direct topology and instructional proof are field-verified.']
          : direct.reasons,
        technicianInstructionsAvailable: Boolean(direct.proof),
        instructionProof: direct.proof,
      }
    }

    const equivalenceSystem = platformEquivalents.system.enumValues.find(
      (value) => value === symptom.system,
    )
    const equivalenceRows = equivalenceSystem
      ? await db
          .select({ verdict: platformEquivalents.verdict })
          .from(platformEquivalents)
          .where(and(
            eq(platformEquivalents.system, equivalenceSystem),
            eq(platformEquivalents.isRetired, false),
            or(
              eq(platformEquivalents.platformAId, platform.id),
              eq(platformEquivalents.platformBId, platform.id),
            ),
          ))
          .orderBy(asc(platformEquivalents.id))
      : []

    const hasPartialCandidate = equivalenceRows.some((edge) => edge.verdict !== 'NOT')

    if (hasPartialCandidate) {
      return {
        state: 'partial',
        system: symptom.system,
        symptomSlug: input.symptomSlug,
        reasons: ['Equivalent content exists, but applicability or instructional proof is incomplete.'],
        technicianInstructionsAvailable: false,
        instructionProof: null,
      }
    }
  }

  if (await hasResearchDraft(db, {
    platformSlug: input.platformSlug,
    symptomSlug: input.symptomSlug,
  })) {
    return {
      state: 'draft',
      system,
      symptomSlug: input.symptomSlug,
      reasons: ['Research draft exists but is not published as technician instruction.'],
      technicianInstructionsAvailable: false,
      instructionProof: null,
    }
  }

  return unsupported(
    input.symptomSlug,
    system,
    'No verified direct or equivalent diagnostic content is available.',
  )
}
