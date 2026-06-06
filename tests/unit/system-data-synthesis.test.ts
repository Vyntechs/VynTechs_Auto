import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { ResearchAgentOutput, ResearchSource } from '@/lib/research/types'
import { createTestDb, type TestDb } from '@/tests/helpers/db'
import { platforms } from '@/lib/db/schema'
import {
  promoteSystemDataDraft,
  type SystemDataDraft,
} from '@/lib/diagnostics/promote-system-data'
import {
  synthesizeSystemData,
  type AiComplete,
  type SystemDataSynthesisInput,
} from '@/lib/research/system-data-synthesis'

const PLATFORM_SLUG = 'ford-super-duty-3rd-gen-60-psd'
const PLATFORM_DISPLAY = '2003-2007 Ford Super Duty (6.0L PSD)'
const SYMPTOM_DISPLAY = 'Cranks, no start'

/** Build an agent output whose findings cite the given URLs (mirrors research-synthesis.test.ts:19-26). */
const agentWith = (
  urls: string[],
  findings?: ResearchAgentOutput['findings'],
): ResearchAgentOutput => ({
  persona: 'aftermarket-shop-owner',
  status: 'completed',
  researchLog: '',
  findings:
    findings ??
    [
      {
        id: 'f1',
        claim: 'c',
        sources: urls.map(
          (url): ResearchSource => ({ url, title: 't', fetchedAt: 'now', excerpt: 'e' }),
        ),
      },
    ],
  visitedUrls: urls,
  tokenUsage: { inputTokens: 0, outputTokens: 0 },
})

/** A queued-response AI mock: each call returns the next queued JSON string. */
const queuedAi = (...replies: unknown[]): AiComplete => {
  const fn = vi.fn<AiComplete>()
  for (const r of replies) {
    fn.mockResolvedValueOnce(typeof r === 'string' ? r : JSON.stringify(r))
  }
  return fn
}

const baseInput = (
  agents: ResearchAgentOutput[],
  slug = PLATFORM_SLUG,
): SystemDataSynthesisInput => ({
  platformSlug: slug,
  platformDisplay: PLATFORM_DISPLAY,
  symptomDisplay: SYMPTOM_DISPLAY,
  agents,
})

/**
 * A representative 6.0 PSD fuel-slice model reply: lift pump, fuel rail, ICP
 * sensor, with a fluid line and an observable property. Components/connections
 * the model would emit (envelope fields are stamped by us, not the model).
 */
const fuelSliceReply = {
  components: [
    {
      slug: 'low-pressure-fuel-pump',
      name: 'Low-Pressure (Lift) Pump',
      kind: 'pump',
      systems: ['fuel'],
      sourceProvenance: 'TRAINING-CONFIRMED',
      observableProperties: [],
    },
    {
      slug: 'fuel-rail',
      name: 'Fuel Rail',
      kind: 'mechanical',
      systems: ['fuel'],
      sourceProvenance: 'TRAINING-CONFIRMED',
      observableProperties: [
        {
          slug: 'fuel-rail-pressure',
          description: 'Fuel rail pressure (desired vs actual)',
          observationMethod: 'scan_tool_pid',
          sourceProvenance: 'TRAINING-CONFIRMED',
        },
      ],
    },
    {
      slug: 'icp-sensor',
      name: 'Injection Control Pressure Sensor',
      kind: 'sensor',
      systems: ['fuel'],
      sourceProvenance: 'TRAINING-CONFIRMED',
      observableProperties: [],
    },
  ],
  connections: [
    {
      fromComponentSlug: 'low-pressure-fuel-pump',
      toComponentSlug: 'fuel-rail',
      connectionKind: 'fluid-line',
      sourceProvenance: 'TRAINING-CONFIRMED',
    },
  ],
}

const REAL_URLS = [
  'https://dieselhub.com/icp',
  'https://fordtechmakuloco.com/lift-pump',
  'https://powerstrokehelp.com/fuel-rail',
]

describe('synthesizeSystemData — emits a draft-only SystemDataDraft', () => {
  it('(a) produces a valid draft from a representative corpus', async () => {
    const ai = queuedAi(fuelSliceReply)
    const out = await synthesizeSystemData(
      baseInput([agentWith(REAL_URLS), agentWith([]), agentWith([])]),
      ai,
    )

    expect(out.draft.status).toBe('draft')
    expect(out.draft.approvedBy).toBeUndefined()
    expect(out.draft.platformSlug).toBe(PLATFORM_SLUG)

    const slugs = out.draft.components.map((c) => c.slug).sort()
    expect(slugs).toEqual(['fuel-rail', 'icp-sensor', 'low-pressure-fuel-pump'])

    const fluid = out.draft.connections.find((c) => c.connectionKind === 'fluid-line')
    expect(fluid).toBeDefined()
    expect(fluid!.fromComponentSlug).toBe('low-pressure-fuel-pump')
    expect(fluid!.toComponentSlug).toBe('fuel-rail')

    const rail = out.draft.components.find((c) => c.slug === 'fuel-rail')!
    expect(rail.observableProperties[0].observationMethod).toBe('scan_tool_pid')
  })

  it('(b) thin corpus → GAPs, never inventions', async () => {
    // The model "confidently" invents a wire + a numeric reading, but no agent
    // fetched anything — nothing may surface as TRAINING-CONFIRMED.
    const inventedReply = {
      components: [
        {
          slug: 'phantom-wire-source',
          name: 'Phantom 12V Feed',
          kind: 'connector',
          systems: ['fuel'],
          sourceProvenance: 'TRAINING-CONFIRMED',
          observableProperties: [
            {
              slug: 'phantom-voltage',
              description: 'Reads 12.6V at the connector',
              observationMethod: 'electrical_measurement_at_pin',
              sourceProvenance: 'TRAINING-CONFIRMED',
            },
          ],
        },
      ],
      connections: [],
    }
    const ai = queuedAi(inventedReply)
    const out = await synthesizeSystemData(
      baseInput([agentWith([]), agentWith([]), agentWith([])]),
      ai,
    )

    const provenances = [
      ...out.draft.components.map((c) => c.sourceProvenance),
      ...out.draft.connections.map((c) => c.sourceProvenance),
      ...out.draft.components.flatMap((c) =>
        c.observableProperties.map((op) => op.sourceProvenance),
      ),
    ]
    expect(provenances).not.toContain('TRAINING-CONFIRMED')
    // No fabricated numeric reading survives as a confirmed fact.
    const ops = out.draft.components.flatMap((c) => c.observableProperties)
    for (const op of ops) {
      expect(op.sourceProvenance).not.toBe('TRAINING-CONFIRMED')
    }
  })

  it('(c) never emits an approved draft even if the model says so', async () => {
    const sneaky = {
      status: 'approved',
      approvedBy: 'x',
      components: [
        {
          slug: 'fuel-rail',
          name: 'Fuel Rail',
          kind: 'mechanical',
          systems: ['fuel'],
          sourceProvenance: 'TRAINING-CONFIRMED',
          observableProperties: [],
        },
      ],
      connections: [],
    }
    const ai = queuedAi(sneaky)
    const out = await synthesizeSystemData(baseInput([agentWith(REAL_URLS)]), ai)

    expect(out.draft.status).toBe('draft')
    expect(out.draft.approvedBy).toBeUndefined()
  })

  it('(d) caps a model-CONFIRMED component to INFERRED (not dropped, not confirmed)', async () => {
    const reply = {
      components: [
        {
          slug: 'fuel-rail',
          name: 'Fuel Rail',
          kind: 'mechanical',
          systems: ['fuel'],
          sourceProvenance: 'TRAINING-CONFIRMED',
          observableProperties: [],
        },
      ],
      connections: [],
    }
    // Even with a real URL in the run, the synthesis pass can't prove THIS item
    // is the one a source backs, so CONFIRMED is capped to INFERRED, not dropped.
    const ai = queuedAi(reply)
    const out = await synthesizeSystemData(baseInput([agentWith(REAL_URLS)]), ai)

    const rail = out.draft.components.find((c) => c.slug === 'fuel-rail')!
    expect(rail.sourceProvenance).toBe('TRAINING-INFERRED')
    // not dropped, not left confirmed
    expect(out.draft.components).toHaveLength(1)
  })

  it('(g) a non-empty corpus does NOT launder CONFIRMED onto an unsupported item', async () => {
    // Realistic mixed corpus: one finding cites a real URL (about the ICP
    // sensor only). The model then emits an UNRELATED component the corpus is
    // silent on, plus an invented wire + numeric reading, all tagged CONFIRMED.
    // The run-level "some URL exists" fact must NOT promote those to CONFIRMED —
    // synthesis cannot prove THIS item is the one a source backs.
    const reply = {
      components: [
        {
          slug: 'fuel-pressure-regulator',
          name: 'Fuel Pressure Regulator',
          kind: 'valve',
          systems: ['fuel'],
          // No finding mentions the regulator, yet the model "confirms" it.
          sourceProvenance: 'TRAINING-CONFIRMED',
          observableProperties: [],
        },
        {
          slug: 'phantom-wire-source',
          name: 'Phantom 12V Feed',
          kind: 'connector',
          systems: ['fuel'],
          sourceProvenance: 'TRAINING-CONFIRMED',
          observableProperties: [
            {
              slug: 'phantom-voltage',
              description: 'Reads 12.6V at the connector',
              observationMethod: 'electrical_measurement_at_pin',
              sourceProvenance: 'TRAINING-CONFIRMED',
            },
          ],
        },
      ],
      connections: [],
    }
    // A real URL is present in the run (about the ICP sensor), so the old
    // run-level gate would have been satisfied and laundered everything.
    const ai = queuedAi(reply)
    const out = await synthesizeSystemData(baseInput([agentWith(REAL_URLS)]), ai)

    const provenances = [
      ...out.draft.components.map((c) => c.sourceProvenance),
      ...out.draft.connections.map((c) => c.sourceProvenance),
      ...out.draft.components.flatMap((c) =>
        c.observableProperties.map((op) => op.sourceProvenance),
      ),
    ]
    // Synthesis cannot prove any specific item is corpus-backed → nothing CONFIRMED.
    expect(provenances).not.toContain('TRAINING-CONFIRMED')
    // The invented numeric reading must not survive as a confirmed fact either.
    const ops = out.draft.components.flatMap((c) => c.observableProperties)
    for (const op of ops) {
      expect(op.sourceProvenance).not.toBe('TRAINING-CONFIRMED')
    }
  })

  it('(h) collapses model-emitted FIELD-VERIFIED to GAP across all three item types', async () => {
    // FIELD-VERIFIED is a VALID DB/validator enum, so the promoter would happily
    // write it. The synthesizer is the ONLY layer enforcing the product-thesis
    // rule "research is training-grounded, never bench-verified." REAL_URLS are
    // present so the URL gate cannot be confused for the cause.
    const reply = {
      components: [
        {
          slug: 'lift-pump',
          name: 'Lift Pump',
          kind: 'pump',
          systems: ['fuel'],
          sourceProvenance: 'FIELD-VERIFIED',
          observableProperties: [
            {
              slug: 'lift-pump-pressure',
              description: 'Lift pump outlet pressure',
              observationMethod: 'pressure_test_with_gauge',
              sourceProvenance: 'FIELD-VERIFIED',
            },
          ],
        },
        {
          slug: 'fuel-rail',
          name: 'Fuel Rail',
          kind: 'mechanical',
          systems: ['fuel'],
          sourceProvenance: 'TRAINING-INFERRED',
          inferenceClass: 'LOGIC',
          observableProperties: [],
        },
      ],
      connections: [
        {
          fromComponentSlug: 'lift-pump',
          toComponentSlug: 'fuel-rail',
          connectionKind: 'fluid-line',
          sourceProvenance: 'FIELD-VERIFIED',
        },
      ],
    }
    const ai = queuedAi(reply)
    const out = await synthesizeSystemData(baseInput([agentWith(REAL_URLS)]), ai)

    const pump = out.draft.components.find((c) => c.slug === 'lift-pump')!
    expect(pump.sourceProvenance).toBe('GAP')
    expect(pump.observableProperties[0].sourceProvenance).toBe('GAP')
    const conn = out.draft.connections[0]
    expect(conn.sourceProvenance).toBe('GAP')
    // No item of any type may carry FIELD-VERIFIED.
    const all = [
      ...out.draft.components.map((c) => c.sourceProvenance),
      ...out.draft.connections.map((c) => c.sourceProvenance),
      ...out.draft.components.flatMap((c) =>
        c.observableProperties.map((op) => op.sourceProvenance),
      ),
    ]
    expect(all).not.toContain('FIELD-VERIFIED')
  })

  it('(f) caps CONFIRMED to INFERRED, preserves INFERRED+GAP, never FIELD-VERIFIED', async () => {
    const reply = {
      components: [
        {
          slug: 'low-pressure-fuel-pump',
          name: 'Low-Pressure (Lift) Pump',
          kind: 'pump',
          systems: ['fuel'],
          sourceProvenance: 'TRAINING-CONFIRMED',
          observableProperties: [],
        },
        {
          slug: 'fuel-pump-ground',
          name: 'Lift Pump Ground Return',
          kind: 'connector',
          systems: ['fuel'],
          sourceProvenance: 'TRAINING-INFERRED',
          inferenceClass: 'LAW',
          observableProperties: [],
        },
        {
          slug: 'fuel-pressure-regulator',
          name: 'Fuel Pressure Regulator',
          kind: 'valve',
          systems: ['fuel'],
          sourceProvenance: 'GAP',
          unknownNote: 'Regulator presence/location not established by the corpus',
          observableProperties: [],
        },
      ],
      connections: [],
    }
    const ai = queuedAi(reply)
    const out = await synthesizeSystemData(baseInput([agentWith(REAL_URLS)]), ai)

    const byslug = Object.fromEntries(out.draft.components.map((c) => [c.slug, c]))
    // The model tagged this CONFIRMED, but this pass cannot prove a specific
    // item is corpus-backed, so the honest deterministic cap is INFERRED.
    expect(byslug['low-pressure-fuel-pump'].sourceProvenance).toBe('TRAINING-INFERRED')
    expect(byslug['fuel-pump-ground'].sourceProvenance).toBe('TRAINING-INFERRED')
    expect(byslug['fuel-pump-ground'].inferenceClass).toBe('LAW')
    expect(byslug['fuel-pressure-regulator'].sourceProvenance).toBe('GAP')
    expect(byslug['fuel-pressure-regulator'].unknownNote).toBeTruthy()
    // Nothing the synthesizer emits may carry CONFIRMED.
    for (const c of out.draft.components) {
      expect(c.sourceProvenance).not.toBe('TRAINING-CONFIRMED')
    }

    for (const c of out.draft.components) {
      expect(c.sourceProvenance).not.toBe('FIELD-VERIFIED')
    }
  })
})

describe('synthesizeSystemData — emitted draft is structurally valid (real promotion path)', () => {
  let db: TestDb
  let close: (() => Promise<void>) | undefined

  beforeEach(async () => {
    const t = await createTestDb()
    db = t.db
    close = t.close
  })
  afterEach(async () => {
    await close?.()
    close = undefined
  })

  it('(e) the draft from a representative corpus passes promoteSystemDataDraft', async () => {
    const ai = queuedAi(fuelSliceReply)
    const out = await synthesizeSystemData(
      baseInput([agentWith(REAL_URLS), agentWith([]), agentWith([])]),
      ai,
    )

    // Seed the platform the draft targets (PR2 never creates platforms).
    await db.insert(platforms).values({
      slug: out.draft.platformSlug,
      yearRange: '2003-2007',
      parentMake: 'Ford',
      parentModelFamily: 'Super Duty',
      generation: '3rd Gen',
    })

    // TEST-ONLY mutation: approve the clone so the public validity gate runs.
    // PR3 code itself still only ever emits status:'draft'.
    const approved: SystemDataDraft = {
      ...out.draft,
      status: 'approved',
      approvedBy: 'test-curator',
    }
    const result = await promoteSystemDataDraft(db, approved)

    expect(result.ok).toBe(true)
  })

  it('(i) a DIRTY model reply, once synthesized, still promotes cleanly', async () => {
    // The whole reason synthesizeSystemData exists: the model output is NOT
    // clean. This reply packs every adversarial shape the sanitizer/dedupe/drop
    // layer must neutralize before promotion: a duplicate component slug, a
    // connection to an endpoint absent from components[], a self-loop, a
    // globally-duplicated observable-property slug, and bad enum kind /
    // observationMethod / connectionKind. If any sanitizer regresses, the
    // emitted draft would crash promoteSystemDataDraft (or its real partial
    // unique indexes on the PGlite DB) — which this test would catch.
    const dirtyReply = {
      components: [
        {
          slug: 'lift-pump',
          name: 'Lift Pump',
          kind: 'pump',
          systems: ['fuel'],
          sourceProvenance: 'TRAINING-INFERRED',
          inferenceClass: 'LOGIC',
          observableProperties: [
            {
              slug: 'rail-pressure',
              description: 'Rail pressure',
              observationMethod: 'scan_tool_pid',
              sourceProvenance: 'TRAINING-INFERRED',
              inferenceClass: 'LOGIC',
            },
            {
              // Globally-duplicated observable-property slug — must be deduped.
              slug: 'rail-pressure',
              description: 'Duplicate rail pressure',
              observationMethod: 'scan_tool_pid',
              sourceProvenance: 'TRAINING-INFERRED',
              inferenceClass: 'LOGIC',
            },
          ],
        },
        {
          // Duplicate component slug — must be deduped (first wins).
          slug: 'lift-pump',
          name: 'Lift Pump (dup)',
          kind: 'pump',
          systems: ['fuel'],
          sourceProvenance: 'GAP',
          observableProperties: [],
        },
        {
          slug: 'fuel-rail',
          name: 'Fuel Rail',
          // Bad enum kind — sanitizer must drop the whole component.
          kind: 'not-a-real-kind',
          systems: ['fuel'],
          sourceProvenance: 'TRAINING-INFERRED',
          inferenceClass: 'LOGIC',
          observableProperties: [],
        },
        {
          slug: 'fuel-filter',
          name: 'Fuel Filter',
          kind: 'mechanical',
          systems: ['fuel'],
          sourceProvenance: 'TRAINING-INFERRED',
          inferenceClass: 'LOGIC',
          observableProperties: [
            {
              slug: 'filter-restriction',
              description: 'Restriction',
              // Bad observationMethod — sanitizer must drop this property.
              observationMethod: 'taste_test',
              sourceProvenance: 'TRAINING-INFERRED',
              inferenceClass: 'LOGIC',
            },
          ],
        },
      ],
      connections: [
        {
          // Endpoint 'ecm' absent from components[] — must be dropped.
          fromComponentSlug: 'lift-pump',
          toComponentSlug: 'ecm',
          connectionKind: 'electrical-wire',
          sourceProvenance: 'TRAINING-INFERRED',
          inferenceClass: 'LOGIC',
        },
        {
          // Self-loop — must be dropped.
          fromComponentSlug: 'lift-pump',
          toComponentSlug: 'lift-pump',
          connectionKind: 'fluid-line',
          sourceProvenance: 'TRAINING-INFERRED',
          inferenceClass: 'LOGIC',
        },
        {
          // Bad connectionKind — sanitizer must drop it.
          fromComponentSlug: 'lift-pump',
          toComponentSlug: 'fuel-filter',
          connectionKind: 'telepathy',
          sourceProvenance: 'TRAINING-INFERRED',
          inferenceClass: 'LOGIC',
        },
        {
          // The one legitimate connection — must survive.
          fromComponentSlug: 'lift-pump',
          toComponentSlug: 'fuel-filter',
          connectionKind: 'fluid-line',
          sourceProvenance: 'TRAINING-INFERRED',
          inferenceClass: 'LOGIC',
        },
      ],
    }

    const ai = queuedAi(dirtyReply)
    const out = await synthesizeSystemData(baseInput([agentWith([])]), ai)

    await db.insert(platforms).values({
      slug: out.draft.platformSlug,
      yearRange: '2003-2007',
      parentMake: 'Ford',
      parentModelFamily: 'Super Duty',
      generation: '3rd Gen',
    })

    // TEST-ONLY: approve the synthesized clone so the public validity gate runs.
    const approved: SystemDataDraft = {
      ...out.draft,
      status: 'approved',
      approvedBy: 'test-curator',
    }
    const result = await promoteSystemDataDraft(db, approved)

    // No matter how dirty the model was, the emitted draft is promotable.
    expect(result.ok).toBe(true)
  })
})
