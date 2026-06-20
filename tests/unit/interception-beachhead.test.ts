/**
 * Gate A (NON-NEGOTIABLE #1) — interception logic, proven deterministically.
 *
 * page.tsx renders the sourced CuratorGuidedWizard instead of the AI ActiveSession
 * iff resolveWizardInterception() returns non-null. This proves the whole chain
 * composes for the first-shop beachhead: a 2011-2016 F-250/350 6.7 PSD with a
 * DEF/limp-mode complaint resolves BOTH slugs and finds the published flow — and
 * every adversarial near-miss correctly falls through to the (honest) AI path.
 *
 * Both intake paths (legacy /api/intake/submit and new /api/sessions) persist the
 * same flat intake shape, and interception runs at render time off that stored
 * intake — so this one decision covers BOTH paths.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb, type TestDb } from '@/tests/helpers/db'
import { flows, flowVersions, profiles } from '@/lib/db/schema'
import type { Session } from '@/lib/db/schema'
import type { Flow } from '@/lib/flows/types'
import { resolveWizardInterception } from '@/lib/flows/interception'

const PLATFORM = 'ford-super-duty-3rd-gen-67-psd'
const SYMPTOM = 'reduced-power-limp-mode-emissions-suspect'

const body: Flow = {
  startStepId: 's1',
  steps: {
    s1: {
      kind: 'question',
      n: 1,
      of: 1,
      title: 't',
      question: 'q',
      answers: [{ id: 'a1', label: 'x', finding: { verdict: 'v', action: 'a', severity: 'fixable' } }],
    },
  },
}

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

async function seedPublishedDefFlow(): Promise<string> {
  const [profile] = await db
    .insert(profiles)
    .values({ userId: crypto.randomUUID() })
    .returning({ id: profiles.id })
  const [flow] = await db
    .insert(flows)
    .values({
      slug: 'sd-67psd-2011-2016-def-limp',
      platformSlug: PLATFORM,
      symptomSlug: SYMPTOM,
      displayTitle: '2011-2016 F-250/350 6.7 PSD — DEF/emissions limp mode',
    })
    .returning({ id: flows.id })
  const [ver] = await db
    .insert(flowVersions)
    .values({
      flowId: flow.id,
      versionNumber: 1,
      state: 'published',
      body,
      authoredBy: profile.id,
      publishedBy: profile.id,
      publishedAt: new Date(),
      changeNote: 'beachhead',
    })
    .returning({ id: flowVersions.id })
  return ver.id
}

function makeSession(overrides: {
  intake?: Record<string, unknown>
  treeState?: Record<string, unknown>
  wizardState?: unknown
}): Session {
  return {
    id: crypto.randomUUID(),
    intake: {
      vehicleYear: 2014,
      vehicleMake: 'Ford',
      vehicleModel: 'F-250',
      vehicleEngine: '6.7L Power Stroke',
      customerComplaint: 'reduced engine power, DEF light on',
      ...(overrides.intake ?? {}),
    },
    treeState: {
      phase: 'diagnosing',
      diagnosisLockedAt: null,
      nodes: [],
      ...(overrides.treeState ?? {}),
    },
    wizardState: overrides.wizardState ?? null,
  } as unknown as Session
}

describe('resolveWizardInterception — 2011-2016 6.7 DEF beachhead (Gate A)', () => {
  it('intercepts a 2014 F-250 6.7 PSD DEF/limp-mode session to the published wizard', async () => {
    const versionId = await seedPublishedDefFlow()
    const result = await resolveWizardInterception(db, makeSession({}))
    expect(result).not.toBeNull()
    expect(result?.flowVersionId).toBe(versionId)
    expect(result?.body.startStepId).toBe('s1')
  })

  it('intercepts even with messy model + mixed-case complaint (real shop input)', async () => {
    await seedPublishedDefFlow()
    const result = await resolveWizardInterception(
      db,
      makeSession({
        intake: { vehicleModel: 'F250 Super Duty', customerComplaint: 'Truck went into LIMP MODE on the highway' },
      }),
    )
    expect(result).not.toBeNull()
  })

  it('does NOT intercept when no flow is published for the slug pair (uncovered)', async () => {
    // No seed — covered platform + symptom resolve, but there is no published flow.
    const result = await resolveWizardInterception(db, makeSession({}))
    expect(result).toBeNull()
  })

  it('does NOT intercept a gas vehicle (platform resolves null)', async () => {
    await seedPublishedDefFlow()
    const result = await resolveWizardInterception(
      db,
      makeSession({ intake: { vehicleMake: 'Toyota', vehicleModel: 'Camry', vehicleEngine: '2.5L Gas' } }),
    )
    expect(result).toBeNull()
  })

  it('does NOT intercept a covered 6.7 truck with a non-emissions (crank) complaint — wrong symptom, no flow', async () => {
    await seedPublishedDefFlow()
    const result = await resolveWizardInterception(
      db,
      makeSession({ intake: { customerComplaint: 'cranks but will not start' } }),
    )
    expect(result).toBeNull()
  })

  it('does NOT intercept a 2017 (4th-gen) DEF session — different platform, no flow seeded', async () => {
    await seedPublishedDefFlow()
    const result = await resolveWizardInterception(db, makeSession({ intake: { vehicleYear: 2017 } }))
    expect(result).toBeNull()
  })

  it('does NOT intercept once the diagnosis is locked into repair', async () => {
    await seedPublishedDefFlow()
    const result = await resolveWizardInterception(
      db,
      makeSession({ treeState: { phase: 'repairing', diagnosisLockedAt: '2026-06-16T10:00:00Z' } }),
    )
    expect(result).toBeNull()
  })
})
