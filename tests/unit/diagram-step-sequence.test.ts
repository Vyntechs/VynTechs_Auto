import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type {
  SystemTopology,
  TopologyTestAction,
  TopologyComponent,
  TopologyBranch,
} from '@/lib/diagnostics/load-system-topology'
import {
  buildStepSequence,
  stepReducerInit,
  stepReducer,
  selectCurrentStep,
  stepKeyOf,
  resolveFork,
  type StepSequenceState,
  type ForkResolution,
} from '@/lib/diagnostics/diagram/step-sequence'

// ---------------------------------------------------------------------------
// Synthetic fixtures. scene-data.json is parts-only (no test_actions /
// branch_logic), so the step pipeline is exercised from hand-built actions
// in the real TopologyTestAction shape. We build three UNLIKE systems to
// prove the engine has zero system-specific behavior.
// ---------------------------------------------------------------------------

function action(over: Partial<TopologyTestAction> & { slug: string }): TopologyTestAction {
  return {
    slug: over.slug,
    description: over.description ?? 'test action',
    scenarioRequired: over.scenarioRequired ?? 'kp-eng-off',
    observationMethod: over.observationMethod ?? 'electrical_measurement_at_pin',
    expectedObservation: over.expectedObservation ?? null,
    invasiveness: over.invasiveness ?? 1,
    implicatedByCurrentSymptom: over.implicatedByCurrentSymptom ?? true,
    priority: over.priority ?? null,
    branches: over.branches ?? [],
  }
}

function topologyWith(actions: TopologyTestAction[]): SystemTopology {
  // Spread the actions across two components to prove buildStepSequence
  // flattens across components, not just within one.
  const half = Math.ceil(actions.length / 2)
  const mk = (id: string, ta: TopologyTestAction[]): TopologyComponent => ({
    id,
    slug: id,
    name: id,
    kind: 'sensor',
    location: null,
    function: null,
    electricalContract: null,
    subtitle: null,
    role: null,
    wireSummary: null,
    body: null,
    probingTactic: null,
    unknownNote: null,
    sourceProvenance: 'drafted',
    observableProperties: [],
    testActions: ta,
    pins: [],
  })
  return {
    platform: { slug: 'p', name: 'P' },
    symptom: { slug: 's', description: 'S' },
    system: 'fuel',
    components: [mk('c1', actions.slice(0, half)), mk('c2', actions.slice(half))],
    connections: [],
    scenarios: [],
    dataStatus: null,
    lastScenarioSlug: null,
  }
}

describe('buildStepSequence', () => {
  it('returns only implicated actions, ordered by priority ascending', () => {
    const topo = topologyWith([
      action({ slug: 'a-third', priority: 3 }),
      action({ slug: 'b-first', priority: 1 }),
      action({ slug: 'c-not-implicated', priority: 2, implicatedByCurrentSymptom: false }),
      action({ slug: 'd-second', priority: 2 }),
    ])
    const seq = buildStepSequence(topo)
    expect(seq.map((s) => s.slug)).toEqual(['b-first', 'd-second', 'a-third'])
  })

  it('sorts null priority last, preserving input order among nulls (stable)', () => {
    const topo = topologyWith([
      action({ slug: 'null-1', priority: null }),
      action({ slug: 'has-prio', priority: 5 }),
      action({ slug: 'null-2', priority: null }),
    ])
    const seq = buildStepSequence(topo)
    expect(seq.map((s) => s.slug)).toEqual(['has-prio', 'null-1', 'null-2'])
  })

  it('returns an empty list when the symptom implicates no actions (honest empty-state)', () => {
    const topo = topologyWith([
      action({ slug: 'x', implicatedByCurrentSymptom: false }),
      action({ slug: 'y', implicatedByCurrentSymptom: false }),
    ])
    expect(buildStepSequence(topo)).toEqual([])
  })

  it('is system-agnostic: a fuel, electrical, and DEF sequence order identically by priority', () => {
    const byPrio = (slugPrefix: string, method: string) =>
      topologyWith([
        action({ slug: `${slugPrefix}-2`, priority: 2, observationMethod: method }),
        action({ slug: `${slugPrefix}-1`, priority: 1, observationMethod: method }),
      ])
    const fuel = buildStepSequence(byPrio('fuel', 'pressure_test_with_gauge'))
    const elec = buildStepSequence(byPrio('elec', 'electrical_measurement_at_pin'))
    const def = buildStepSequence(byPrio('def', 'scan_tool_pid'))
    expect(fuel.map((s) => s.priority)).toEqual([1, 2])
    expect(elec.map((s) => s.priority)).toEqual([1, 2])
    expect(def.map((s) => s.priority)).toEqual([1, 2])
  })
})

describe('stepReducer', () => {
  const seq = buildStepSequence(
    topologyWith([
      action({ slug: 'one', priority: 1 }),
      action({ slug: 'two', priority: 2 }),
      action({ slug: 'three', priority: 3 }),
    ]),
  )

  it('starts at the first step', () => {
    const s = stepReducerInit(seq)
    expect(s.index).toBe(0)
    expect(selectCurrentStep(s)?.slug).toBe('one')
  })

  it('advances and goes back, clamping at the ends', () => {
    let s: StepSequenceState = stepReducerInit(seq)
    s = stepReducer(s, { type: 'advance' })
    expect(selectCurrentStep(s)?.slug).toBe('two')
    s = stepReducer(s, { type: 'advance' })
    s = stepReducer(s, { type: 'advance' }) // past the end -> clamp at last
    expect(selectCurrentStep(s)?.slug).toBe('three')
    s = stepReducer(s, { type: 'back' })
    s = stepReducer(s, { type: 'back' })
    s = stepReducer(s, { type: 'back' }) // before the start -> clamp at 0
    expect(selectCurrentStep(s)?.slug).toBe('one')
  })

  it('goTo jumps to a step by its stable key; an unknown key is a no-op', () => {
    let s = stepReducerInit(seq)
    s = stepReducer(s, { type: 'goTo', stepKey: stepKeyOf(seq[2]) })
    expect(selectCurrentStep(s)?.slug).toBe('three')
    s = stepReducer(s, { type: 'goTo', stepKey: 'nonexistent-key' })
    expect(selectCurrentStep(s)?.slug).toBe('three') // unchanged
  })

  it('an empty sequence yields no current step and survives every action (no throw)', () => {
    let s = stepReducerInit([])
    expect(selectCurrentStep(s)).toBeNull()
    s = stepReducer(s, { type: 'advance' })
    s = stepReducer(s, { type: 'back' })
    s = stepReducer(s, { type: 'goTo', stepKey: 'whatever' })
    expect(selectCurrentStep(s)).toBeNull()
    expect(s.index).toBe(0)
  })
})

function branch(over: Partial<TopologyBranch> & { verdict: string }): TopologyBranch {
  return {
    condition: over.condition ?? 'if reading X',
    verdict: over.verdict,
    nextAction: over.nextAction ?? 'do the next thing in words',
    routesToTestActionId: over.routesToTestActionId ?? null,
    reasoning: over.reasoning ?? null,
  }
}

describe('resolveFork', () => {
  it('routes by the matching verdict branch when routesToTestActionId is present', () => {
    const step = action({
      slug: 'forky',
      branches: [
        branch({ verdict: 'pass', routesToTestActionId: 'ta-good', reasoning: 'all clear' }),
        branch({ verdict: 'fail', routesToTestActionId: 'ta-bad', reasoning: 'open circuit' }),
      ],
    })
    const r = resolveFork(step, 'fail')
    expect(r.kind).toBe('route')
    if (r.kind === 'route') {
      expect(r.toTestActionId).toBe('ta-bad')
      expect(r.reasoning).toBe('open circuit')
    }
  })

  it('degrades to words-only when the matched branch has no routesToTestActionId', () => {
    const step = action({
      slug: 'words-only',
      branches: [
        branch({ verdict: 'fail', routesToTestActionId: null, nextAction: 'check the harness for chafing' }),
      ],
    })
    const r = resolveFork(step, 'fail')
    expect(r.kind).toBe('words')
    if (r.kind === 'words') {
      expect(r.nextActionText).toBe('check the harness for chafing')
    }
  })

  it('degrades to words-only when routesToTestActionId is undefined (optional C1 field absent)', () => {
    // The C1 fork fields are OPTIONAL (string | null | undefined). An absent id
    // must degrade exactly like an explicit null — never be treated as a route.
    const step = action({
      slug: 'undef-route',
      branches: [{ condition: 'c', verdict: 'fail', nextAction: 'inspect connector' } as TopologyBranch],
    })
    const r = resolveFork(step, 'fail')
    expect(r.kind).toBe('words')
    if (r.kind === 'words') {
      expect(r.nextActionText).toBe('inspect connector')
    }
  })

  it('returns kind "none" when no branch matches the verdict (terminal step)', () => {
    const step = action({
      slug: 'terminal',
      branches: [branch({ verdict: 'pass', routesToTestActionId: 'ta-x' })],
    })
    expect(resolveFork(step, 'fail')).toEqual<ForkResolution>({ kind: 'none' })
  })

  it('returns kind "none" for a step with zero branches (no fork at all)', () => {
    const step = action({ slug: 'flat', branches: [] })
    expect(resolveFork(step, 'neutral')).toEqual<ForkResolution>({ kind: 'none' })
  })
})

describe('step-sequence purity', () => {
  const src = readFileSync(
    resolve(process.cwd(), 'lib/diagnostics/diagram/step-sequence.ts'),
    'utf8',
  )

  it('imports nothing from React, the DOM, the network, or any AI client', () => {
    expect(src).not.toMatch(/from ['"]react['"]/)
    expect(src).not.toMatch(/from ['"]next\//)
    expect(src).not.toMatch(/\bfetch\(/)
    expect(src).not.toMatch(/anthropic|openai|@\/lib\/ai/i)
  })

  it('contains no "AI" word and no "step N of M" framing', () => {
    expect(src).not.toMatch(/\bAI\b/)
    expect(src).not.toMatch(/step\s+\d*\s*of\s*\d/i)
    expect(src.toLowerCase()).not.toContain('step of')
  })

  it('only imports types from the C1 loader module (consumes C1, not C2/C3)', () => {
    expect(src).toMatch(/from ['"]@\/lib\/diagnostics\/load-system-topology['"]/)
    expect(src).not.toMatch(/diagram-kit|slot-interface|show-rule|slot-resolver/)
  })
})
