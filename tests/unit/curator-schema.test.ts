import { describe, it, expect } from 'vitest'
import { flows, flowVersions, flowOutcomes, researchRuns } from '@/lib/db/schema'

describe('curator schema exports', () => {
  it('exposes flows table keyed on platform_slug/symptom_slug TEXT (NOT uuid FKs)', () => {
    expect(flows).toBeDefined()
    expect(flows.id).toBeDefined()
    expect(flows.slug).toBeDefined()
    // SLUG REALIGNMENT: these are TEXT slug columns, not uuid platform_id/symptom_id.
    expect(flows.platformSlug).toBeDefined()
    expect(flows.symptomSlug).toBeDefined()
    expect(flows.displayTitle).toBeDefined()
    expect(flows.isRetired).toBeDefined()
    // Guard against regressing to FK columns.
    expect((flows as unknown as Record<string, unknown>).platformId).toBeUndefined()
    expect((flows as unknown as Record<string, unknown>).symptomId).toBeUndefined()
  })

  it('exposes flow_versions with the version-state enum + audit fields', () => {
    expect(flowVersions.state).toBeDefined()
    expect(flowVersions.versionNumber).toBeDefined()
    expect(flowVersions.body).toBeDefined()
    expect(flowVersions.bodySchemaVersion).toBeDefined()
    expect(flowVersions.publishedBy).toBeDefined()
    expect(flowVersions.archivedBy).toBeDefined()
    expect(flowVersions.researchRunId).toBeDefined()
    expect(flowVersions.forkedFromVersionId).toBeDefined()
  })

  it('exposes flow_outcomes with the outcome-kind enum + restrict FKs', () => {
    expect(flowOutcomes.outcome).toBeDefined()
    expect(flowOutcomes.sessionId).toBeDefined()
    expect(flowOutcomes.flowVersionId).toBeDefined()
    expect(flowOutcomes.taggedBy).toBeDefined()
  })

  it('exposes research_runs slug-keyed with dispatch-state enum + agent_outputs JSONB', () => {
    expect(researchRuns.status).toBeDefined()
    expect(researchRuns.errorMessage).toBeDefined()
    expect(researchRuns.agentOutputs).toBeDefined()
    expect(researchRuns.synthesisMd).toBeDefined()
    // SLUG REALIGNMENT here too.
    expect(researchRuns.platformSlug).toBeDefined()
    expect(researchRuns.symptomSlug).toBeDefined()
    expect((researchRuns as unknown as Record<string, unknown>).platformId).toBeUndefined()
    expect((researchRuns as unknown as Record<string, unknown>).symptomId).toBeUndefined()
  })
})
