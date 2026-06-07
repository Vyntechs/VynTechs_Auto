export const meta = {
  name: 'diagram-scope-dialin',
  description: 'Dial in the parallel-development decomposition for the diagnostic-diagram rebuild: scope each unit against the real repo, hunt overlaps + gaps + parallel-safety, synthesize a clean parallel work-order set with pinned contracts.',
  phases: [
    { title: 'Scope', detail: 'one agent per unit (3 contracts + 6 tracks + integration), grounded in the real code' },
    { title: 'Cross-check', detail: 'adversarial lenses: overlaps, gaps, parallel-safety' },
    { title: 'Synthesize', detail: 'tightened decomposition: pinned contracts, owners, dependency waves, resolved overlaps/gaps' },
  ],
}

const ROOT = '/Volumes/Creativity/dev/projects/vyntechs/.claude/worktrees/system-data-ingest'

const GROUNDING = [
  'GROUND YOURSELF IN THE REAL ARTIFACTS (read before scoping). Root: ' + ROOT,
  '- docs/superpowers/specs/2026-06-07-diagnostic-diagram-design.md — THE design spec (element kit + per-step show-rule + templated layout + Figma). This is the source of truth for what we are building.',
  '- docs/superpowers/handoffs/2026-06-06-diagnostic-canvas-shape-plan.md — the data-model plan (the deterministic driver: observationMethod->shape; the 4 dropped test_actions columns; branch_logic; ordering).',
  '- lib/db/schema.ts + drizzle/migrations/0021_*.sql, 0023_* — the real schema (test_actions, branch_logic, component_pins, system_scenarios, pin_scenario_readings, scenario_wire_states, components, component_connections).',
  '- lib/diagnostics/load-system-topology.ts (+ topology-layout.ts, cached-lookup.ts) — the LOADER CONTRACT (loadSystemTopology -> SystemTopology). Must stay additive.',
  '- components/screens/topology-diagnostic.tsx, components/topology/* (topology-node.tsx, topology-flow.ts, topology-diagram.tsx, wire-edge.tsx, scenario-bar.tsx, topology-detail-panel.tsx, topology.css) — the CURRENT dot-canvas built on @xyflow/react that the app-swap replaces.',
  '- app/globals.css (vt tokens), components/vt/v2.css, v2-instruments.css — the design system the Figma kit aligns to. NOTE: the six --role-* wire tokens, --vt-recede, --vt-amber-600 are referenced by topology.css but UNDEFINED in globals.css.',
  '- .design-shots/scene-data.json — the real 25-part 6.7L P0087 scene to scope against. .design-shots/mockups/proto-meter.html — the throwaway prototype (reference for the Meter/reading + the validated shapes; NOT the build target).',
].join('\n')

const KEY_FACTS = [
  'KEY FACTS (verified): observationMethod (9-enum) is already LOADED and is the shape selector. test_actions.expectedValue/expectedUnit/expectedTolerance/meterMode EXIST but the loader SELECT DROPS them. branch_logic.routesToTestActionId EXISTS but is dropped. There is NO stepKind column and NO per-(pin,scenario) isOutOfRange (both proposed-new). The loader contract (loadSystemTopology -> SystemTopology) must change ADDITIVELY only. A "step" = a test_action; order = symptom_test_implications.priority; fork = branch_logic. components.kind is an 8-enum (sensor|actuator|pump|valve|module|mechanical|splice|connector). componentConnections.electricalRole is a 6-enum (signal|5v-ref|low-ref|pwm|12v|ground).',
].join('\n')

const DECOMP = [
  'THE APPROVED PARALLEL DECOMPOSITION (your job is to dial it in, not re-invent it):',
  'CONTRACTS (the seams, land first, everything builds against them): (C1) data-contract — the additive loader/type shape each part + step reads; (C2) part-API — the prop interface every kit part component implements; (C3) slot-interface — how a step declares slots and parts fill them.',
  'PARALLEL TRACKS (fork once contracts exist): (T1) data — migration + loader surfacing (stepKind, the 4 expected-* columns, routesToTestActionId+reasoning, isOutOfRange); (T2) figma-kit — symbols designed once as components + export; (T3) assembly-engine — the show-rule + data->slot resolver; (T4) templates — per-step-shape layout templates; (T5) mobile — 375px variants; (T6) app-swap — replace the dot-canvas in the real app with the assembler.',
  'INTEGRATION: wire together, render the real 6.7L scene, validate (no element leaks, provenance honesty, no AI in the draw path, desktop + 375px).',
  'SCOPE BOUNDARY: v1 first-class shapes = confirm / electrical-probe(volts) / continuity-ground / single-PID / pressure-flow / look-inspect / locate / fork. v1 plain = duty-PWM, voltage-drop. LATER = scope/waveform (no waveform data in repo yet).',
].join('\n')

const CONSTRAINTS = 'CONSTRAINTS: additive loader-contract only (propose DB deltas, do not break consumers); zero per-case AND zero per-system layout work; no AI in the drawing path; no "AI" word in UI; no "step N of M"; mobile 375px hard gate; reuse vt tokens; this targets staging/V2, not prod.'

const UNITS = [
  { key: 'C1-data-contract', kind: 'contract', name: 'C1 Data contract', brief: 'The additive loader/type shape every part + step reads. Extend SystemTopology / TopologyTestAction / TopologyScenario additively to carry: meterMode, expectedValue/Unit/Tolerance, sourceProvenance (per action), stepKind, branch routesToTestActionId+reasoning, isOutOfRange. Define the EXACT TS shape the kit + engine consume.' },
  { key: 'C2-part-api', kind: 'contract', name: 'C2 Part component API', brief: 'The single prop interface EVERY kit part implements (component-by-kind, terminal, wire-by-role, ground, relay, hookups, gauge) — e.g. kind/role, state (from scenario wireState/reading), provenance, terminals[], tier(focus/anchor/recede), active/selected. So the engine + templates build against STUBS while Figma supplies the real art.' },
  { key: 'C3-slot-interface', kind: 'contract', name: 'C3 Slot/template interface', brief: 'How a step-shape declares its named slots (source/device/ground/downstream/...) and how resolved parts fill them. The contract between the assembly-engine (fills slots from data) and the templates (place slots). Define slot names + the fill protocol.' },
  { key: 'T1-data', kind: 'track', name: 'T1 Data deltas (migration + loader)', brief: 'The additive migration (breakpoint-marked) + loader SELECT/type changes to surface C1. stepKind + isOutOfRange are new nullable columns; the 4 expected-* + routesToTestActionId are un-droppings. Must not break the PGlite suite or current consumers.' },
  { key: 'T2-figma-kit', kind: 'track', name: 'T2 Figma part kit + export', brief: 'Design each symbol once as a Figma component aligned to vt tokens (define the six --role-* + --vt-recede + --vt-amber-600); the export pipeline (SVG/React) into the app implementing C2.' },
  { key: 'T3-engine', kind: 'track', name: 'T3 Assembly engine', brief: 'The pure show-rule (per step-shape, what may render — incl. the lock: pins only on electrical steps) + the deterministic data->slot resolver (assign device/source/ground/downstream from components/connections/electricalRole/the focus). No per-case logic; pure function of (data, step).' },
  { key: 'T4-templates', kind: 'track', name: 'T4 Per-shape layout templates', brief: 'One template per v1 step-shape (confirm/electrical/PID/pressure/look/fork/locate): named slots + placement geometry; parts drop in via C3. Each template independently buildable + screenshot-checkable.' },
  { key: 'T5-mobile', kind: 'track', name: 'T5 Mobile (375px)', brief: '375-414px variants of the templates + bottom-sheet detents; tested part stays above the sheet; >=48px targets. Consumes C3 + the templates.' },
  { key: 'T6-app-swap', kind: 'track', name: 'T6 App integration / swap', brief: 'Replace the dot-canvas (components/topology/* + topology-diagnostic.tsx, @xyflow/react) with the assembler composing kit parts, driven by the loader. Keep the loader contract + the Meter/reading + scenario chip + whole-system escape.' },
  { key: 'INT-integration', kind: 'integration', name: 'Integration + validation', brief: 'Wire all tracks; render the real 6.7L P0087 scene end-to-end; screenshot desktop + 375px; verify no element leaks (pressure step shows no 12V/GND), provenance honesty, no AI in the draw path, zero per-case logic.' },
]

const SCOPECARD_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['unit', 'kind', 'purpose', 'ownsContract', 'consumesContracts', 'inputs', 'outputs', 'filesAndAreas', 'dependsOn', 'enables', 'definitionOfDone', 'dataOrAssetNeeds', 'parallelSafety', 'risksOrUnknowns'],
  properties: {
    unit: { type: 'string' }, kind: { type: 'string' },
    purpose: { type: 'string', description: 'One tight paragraph: what this unit delivers and its boundary.' },
    ownsContract: { type: 'string', description: 'Which contract (C1/C2/C3) this unit OWNS/defines, or "none".' },
    consumesContracts: { type: 'array', items: { type: 'string' } },
    inputs: { type: 'array', items: { type: 'string' }, description: 'What it needs to start (data, contracts, other units\' outputs).' },
    outputs: { type: 'array', items: { type: 'string' }, description: 'Concrete artifacts it produces.' },
    filesAndAreas: { type: 'array', items: { type: 'string' }, description: 'REAL repo paths/symbols it would create or modify (be exact — this is how overlaps are found).' },
    dependsOn: { type: 'array', items: { type: 'string' }, description: 'Other unit keys it depends on.' },
    enables: { type: 'array', items: { type: 'string' }, description: 'Other unit keys it unblocks.' },
    definitionOfDone: { type: 'string' },
    dataOrAssetNeeds: { type: 'array', items: { type: 'string' }, description: 'DB columns, Figma components, tokens, or fixtures it needs.' },
    parallelSafety: { type: 'string', description: 'Can it run concurrently with the others without shared mutable state? What it shares/touches that others might.' },
    risksOrUnknowns: { type: 'array', items: { type: 'string' } },
  },
}

phase('Scope')
const cards = (await parallel(UNITS.map(u => () =>
  agent(
    'You are a senior staff engineer scoping ONE unit of a parallel-development effort to rebuild the Vyntechs diagnostic diagram (replace an ad-hoc dot-canvas with a Figma part-kit composed deterministically from data). Scope it PRECISELY against the REAL repo so we can detect overlaps + gaps before building.\n\n' +
    'SCOPE THIS UNIT:\n- ' + u.name + ' [' + u.kind + ']\n- ' + u.brief + '\n\n' +
    DECOMP + '\n\n' + KEY_FACTS + '\n\n' + CONSTRAINTS + '\n\n' + GROUNDING + '\n\n' +
    'Read the spec + the data-model plan + the real code your unit touches. Then return a precise scope card: purpose/boundary, which contract it OWNS vs CONSUMES, inputs, outputs, the EXACT real files/symbols it creates or modifies (so overlaps with other units are detectable), dependsOn/enables (other unit keys), definition of done, data/asset needs, parallel-safety (shared mutable state?), and risks/unknowns. Be exact with paths and identifiers. Return STRICT structured output.',
    { label: 'scope:' + u.key, phase: 'Scope', schema: SCOPECARD_SCHEMA }
  )
))).filter(Boolean)

const LENS_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['lens', 'findings', 'summary'],
  properties: {
    lens: { type: 'string' },
    findings: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['type', 'where', 'severity', 'detail', 'resolution', 'owner'], properties: {
      type: { type: 'string', description: 'overlap | gap | parallel-risk' },
      where: { type: 'string', description: 'the unit(s)/file/contract involved' },
      severity: { type: 'string', description: 'blocker | major | minor' },
      detail: { type: 'string' },
      resolution: { type: 'string', description: 'the concrete fix (assign owner, split, add unit, pin contract, sequence).' },
      owner: { type: 'string', description: 'which unit should own the resolution (or "new unit: <name>").' },
    } } },
    summary: { type: 'string' },
  },
}

const LENSES = [
  { key: 'overlaps', focus: 'OVERLAPS. Find every pair of units that would touch the SAME file, symbol, responsibility, or contract — i.e. would collide or duplicate in parallel development. For each: exactly what collides, why, and which SINGLE unit should own it (the other consumes via a contract). Pay special attention to: topology.css / globals.css token edits, the loader file, the topology components, and any responsibility claimed by two units.' },
  { key: 'gaps', focus: 'GAPS. Find work that NO unit owns; contracts left under-specified; v1 step-shapes / test-types / data-cases / edge-cases unhandled (e.g. a shape with no source node, a part kind with no symbol, a step with no stepKind, the whole-system escape, provenance states, reduced-motion, error/empty states); and missing validation/tests. For each: the gap + which unit should absorb it (or propose a new unit).' },
  { key: 'parallel-safety', focus: 'PARALLEL-SAFETY. Find shared mutable state, hidden sequencing, or interface ambiguity that breaks "full parallel". Confirm the foundation-first order: which contracts (C1/C2/C3) MUST land before which tracks can truly fork, and verify the remaining tracks can run concurrently without stepping on each other. Output the minimal dependency waves.' },
]

phase('Cross-check')
const lenses = (await parallel(LENSES.map(l => () =>
  agent(
    'You are an adversarial parallel-development reviewer. Your job is to BREAK this decomposition before we commit to building it in parallel — find where tracks collide or where work falls through the cracks. Be specific; cite unit keys + real files.\n\n' +
    'YOUR LENS: ' + l.focus + '\n\n' +
    DECOMP + '\n\n' + KEY_FACTS + '\n\n' + CONSTRAINTS + '\n\n' +
    'THE SCOPE CARDS (the units as scoped against the real repo):\n' + JSON.stringify(cards, null, 1) + '\n\n' +
    'Return every finding with a concrete resolution + the owning unit. Return STRICT structured output.',
    { label: 'lens:' + l.key, phase: 'Cross-check', schema: LENS_SCHEMA }
  )
))).filter(Boolean)

const SYNTH_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['contracts', 'tracks', 'dependencyWaves', 'overlapsResolved', 'gapsClosed', 'changesFromOriginal', 'openQuestionsForBrandon', 'readyForPlan'],
  properties: {
    contracts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'definition', 'owner'], properties: { name: { type: 'string' }, definition: { type: 'string', description: 'the pinned contract — exact enough to build against' }, owner: { type: 'string' } } } },
    tracks: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'scope', 'consumes', 'produces', 'dependsOn', 'filesOwned', 'definitionOfDone'], properties: { name: { type: 'string' }, scope: { type: 'string' }, consumes: { type: 'array', items: { type: 'string' } }, produces: { type: 'array', items: { type: 'string' } }, dependsOn: { type: 'array', items: { type: 'string' } }, filesOwned: { type: 'array', items: { type: 'string' }, description: 'files this track exclusively owns (no other track edits them) — the key to collision-free parallel work' }, definitionOfDone: { type: 'string' } } } },
    dependencyWaves: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: 'ordered waves of unit keys that can run in parallel within a wave' },
    overlapsResolved: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['overlap', 'resolution'], properties: { overlap: { type: 'string' }, resolution: { type: 'string' } } } },
    gapsClosed: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['gap', 'owner'], properties: { gap: { type: 'string' }, owner: { type: 'string' } } } },
    changesFromOriginal: { type: 'array', items: { type: 'string' }, description: 'how the decomposition changed vs the approved 3-contracts + 6-tracks (units added/split/merged, ownership moved).' },
    openQuestionsForBrandon: { type: 'array', items: { type: 'string' }, description: 'concrete, plain-English, user-visible decisions only.' },
    readyForPlan: { type: 'boolean' },
  },
}

phase('Synthesize')
const synthesis = await agent(
  'You are the tech lead. Merge the scope cards + the adversarial findings into ONE tightened parallel work-order set that is genuinely collision-free and gap-free, ready to become an implementation plan.\n\n' +
  'Requirements: pin each contract (C1/C2/C3) precisely enough to build against; for each track give scope/consumes/produces/dependsOn and the files it EXCLUSIVELY owns (no two tracks edit the same file — resolve every overlap by assigning a single owner or introducing a contract); close every gap by assigning an owner (or adding a unit); give the dependency waves (what lands first, what forks in parallel). Keep it faithful to the spec + data-model plan + constraints. Flag only the few real decisions for Brandon (plain English).\n\n' +
  DECOMP + '\n\n' + KEY_FACTS + '\n\n' + CONSTRAINTS + '\n\n' +
  'SCOPE CARDS:\n' + JSON.stringify(cards, null, 1) + '\n\n' +
  'ADVERSARIAL FINDINGS:\n' + JSON.stringify(lenses, null, 1) + '\n\n' +
  'Return STRICT structured output.',
  { label: 'synthesize:decomposition', phase: 'Synthesize', schema: SYNTH_SCHEMA }
)

return { cards, lenses, synthesis }
