export const meta = {
  name: 'diagram-plan-authoring',
  description: 'Author the parallel-development implementation plan for the diagnostic-diagram rebuild: one bite-sized TDD plan file per track (against pinned contracts + the scalability bar), cross-check for type/contract consistency + spec coverage + scalability, then write the master plan.',
  phases: [
    { title: 'Draft', detail: 'one agent per track writes its TDD plan file' },
    { title: 'Cross-check', detail: 'consistency / coverage / scalability lenses' },
    { title: 'Master', detail: 'write the master plan (header, contracts, waves, conventions, index)' },
  ],
}

const ROOT = '/Volumes/Creativity/dev/projects/vyntechs/.claude/worktrees/system-data-ingest'
const PLANS = 'docs/superpowers/plans'
const DATE = '2026-06-07'

const BAR = [
  'THE SCALABILITY BAR (every task is held to this — it is THE point):',
  '- Adding a new system/symptom/make/concern is DATA-ONLY: no new design, no new code, no AI. The correct screen renders itself.',
  '- The kit + engine + templates contain ZERO system-specific or per-case branching — everything is a pure function of the building-block vocabulary: components.kind (8), connectionKind, electricalRole (6), observationMethod (9), system scenarios, stepKind, MeterMode.',
  '- An UNSEEN part kind / role / connection type / test method renders via a generic FALLBACK — never a blank, never a crash.',
  '- Templates key off the KIND OF TEST (pressure/electrical/reading/scope/look), never a system shape — an air-brake circuit or DEF line lays out as cleanly as fuel.',
  '- Partial/incomplete data degrades honestly (the universal "needs field check" path); it is the steady state, not an error.',
  '- The 6.7L fuel scene is ONE fixture. Generality is validated across multiple unlike systems (fuel + a purely-electrical case + one non-fuel system such as DEF/charging/air; synthetic fixtures are fine where real data is not authored yet).',
].join('\n')

const OVERRIDES = [
  "BRANDON'S CONFIRMED INTERACTION CALLS (these OVERRIDE the scope-dial-in synthesis where they conflict):",
  '- KEEP tap-any-shown-part-to-inspect. The current step drives the default view, but the tech can tap any on-screen part to pull its detail. ADAPT the existing selection mechanism (components/topology/topology-selection-context.tsx) into the new diagram — do NOT delete free selection. (The synthesis C3 "no free node-click" line is overridden.)',
  '- "Whole system" button wires to the EXISTING full faded-system view, not a v1 placeholder.',
  '- Mobile reading sheet is TAP-TO-TOGGLE (peek <-> expanded), not a free-drag sheet.',
].join('\n')

const CONTRACTS = [
  'PINNED CONTRACTS (Wave 0 — type-only freeze; every track builds against these EXACT names/signatures). Use these identifiers verbatim.',
  '',
  'C1 data-contract (owner T1) — extends loadSystemTopology -> SystemTopology ADDITIVELY ONLY (new optional keys; nothing renamed/removed):',
  '  TopologyTestAction gains: meterMode: MeterMode|null, expectedValue: number|null, expectedUnit: string|null, expectedTolerance: number|null, stepKind: string|null, priority: number|null. (observationMethod/implicatedByCurrentSymptom/branches/expectedObservation/sourceProvenance stay.)',
  '  TopologyBranch gains: routesToTestActionId: string|null, reasoning: string|null. (condition/verdict/nextAction already surfaced — verdict ALREADY exists, do not re-add.)',
  '  TopologyScenario gains a SIBLING map: isOutOfRange: Record<string, boolean> (pinId -> out-of-range; missing key => not-out-of-range => neutral). pinReadings stays Record<string,string> UNCHANGED.',
  "  MeterMode = 'volts'|'ohms'|'drop'|'duty'|'amps'|'pid'|'pressure' (nullable, documented union).",
  '  Verdict precedence: isOutOfRange authoritative -> branch verdict==="fail" -> neutral graphite default. NO prose-number parsing; numeric compare deferred (tech_outcomes not loaded).',
  '  LOCKED FACTS: electricalRole/fromPinId/toPinId/connectionKind ALREADY surfaced (loader ~236-243) — DO NOT touch the connection SELECT. The ONLY genuine un-drops: the 4 meter fields + routesToTestActionId/reasoning + surfacing priority (implRows Set -> Map). The ONLY new columns: test_actions.step_kind, pin_scenario_readings.is_out_of_range (both nullable; migration breakpoint-marked).',
  '',
  'C2 part-API (owner T2) — components/diagram-kit/part-api.ts:',
  '  DiagramPartProps + unions: PartKind (the 8 components.kind), PartRoleSpecial (ground|relay|fuse|power-source), WireRole (the 6 electricalRole), PartTier (focus|anchor|recede), PartProvenance (drafted|field-verified|needs-field-check), Terminal {id,role,edge,label,visible,active,selected} (visible is ENGINE-controlled — the leak-lock: terminals never always-on), PartReading (thin handoff to the existing Meter; C2 does NOT re-own the gauge).',
  '  A part-registry (kind|roleSpecial) -> component so consumers resolve by DATA, not a switch. A GENERIC FALLBACK part for any unseen kind/role.',
  '  REDUCED-MOTION is a contract requirement: any animated part gates on prefers-reduced-motion at the part level. stepKind/isOutOfRange optional so C2 typechecks with or without the migration. NO scope/waveform stub in v1. Root dir: components/diagram-kit/.',
  '',
  'C3 slot-interface (owner T3) — lib/diagnostics/diagram/slot-interface.ts (type-only module):',
  "  SlotName union: 'source'|'device-under-test'|'ground'|'downstream-anchor'|'overlay'|'gauge'|'good-vs-bad'|'route'|'location'|'detail'|'quiet-field'. ('detail' carries the why/see-source/Operational-Theori prose payload; 'quiet-field' is the confirm-shape whole-spine backdrop.)",
  '  StepShape union (10 v1 shapes): confirm|electrical-probe|continuity-ground|single-pid|pressure-flow|look-inspect|locate|fork|duty-pwm|voltage-drop.',
  '  selectStepShape SIGNATURE (body in T3): (observationMethod, meterMode|null, stepKind|null, hasBranches) -> StepShape. Keys ONLY on these; templates/registry must NOT re-derive from observationMethod.',
  '  SlotFill (one of: C2 part-ref+props | wire-set | the single overlay primitive | gauge/Meter payload | a content payload for "detail" | a degraded text-only route arm | null).',
  '  ResolvedScene = { shape, slots: Record<SlotName,SlotFill>, activeWireIds, overlay|null, gaugeSpec|null, forkRoute|null, focus:{selectedPartId}, pinsAllowed: boolean, elements: ResolvedElement[] }. elements is the FLAT enumerable rendered set (parts+wires+terminals+overlay) so the leak test asserts deterministically (e.g. terminals.length===0 on a pressure step).',
  '  AssembleScene = (topology, step, activeScenario) => ResolvedScene ; StepTemplate = (scene) => ReactNode.',
  '  A typed per-shape const table of required/optional/FORBIDDEN slots encoding the hard rule (terminals/overlay ONLY on electrical shapes; pressure-flow forbids electrical slots; locate suppresses gauge; fork = one route slot).',
  '  No "AI" string, no "step N of M" anywhere.',
].join('\n')

const PATHS = [
  'READ TO GROUND YOURSELF (root ' + ROOT + '):',
  '- docs/superpowers/specs/2026-06-07-diagnostic-diagram-design.md — THE spec (scalability bar, kit, show-rule, templates, interactions).',
  '- .design-shots/tracks.json — every track\'s scope/consumes/produces/dependsOn/filesOwned/definitionOfDone (find YOUR track).',
  '- .design-shots/scope-dialin-result.json — full scope cards + adversarial findings if you need detail (large file; grep your track).',
  '- The REAL code your files touch: lib/diagnostics/load-system-topology.ts, lib/db/schema.ts, drizzle/migrations/*, components/topology/*, components/screens/topology-diagnostic.tsx, app/curator/topology/page.tsx, app/globals.css, tests/unit/promote-system-data.test.ts.',
  '- Test/migration norms: hand-written Drizzle migrations need statement-breakpoint markers or the PGlite unit suite breaks; rerun pnpm test once on cold cache before trusting failures.',
].join('\n')

const TRACKS = [
  { key: 'T1', name: 'data deltas (migration + loader surfacing)', wave: 1, owns: 'C1' },
  { key: 'T2', name: 'Figma part kit + export + tokens', wave: 1, owns: 'C2' },
  { key: 'T3', name: 'assembly engine (show-rule + slot-resolver)', wave: 1, owns: 'C3' },
  { key: 'T7', name: 'step engine (sequence + current-step + fork routing)', wave: 1, owns: 'none' },
  { key: 'T4', name: 'per-shape layout templates', wave: 1, owns: 'none' },
  { key: 'T5', name: 'mobile (375px) + Meter bottom-sheet (tap-to-toggle)', wave: 2, owns: 'none' },
  { key: 'T6', name: 'app integration / swap (keep tap-to-inspect; whole-system -> existing full view)', wave: 3, owns: 'none' },
  { key: 'INTEGRATION', name: 'wire, render multiple systems, validate (the scalability gate)', wave: 4, owns: 'none' },
]

const DRAFT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['track', 'fileWritten', 'taskCount', 'typesDefined', 'typesConsumed', 'crossTrackAssumptions', 'deviationsFromSynthesis', 'scalabilityNotes', 'risks'],
  properties: {
    track: { type: 'string' }, fileWritten: { type: 'string' }, taskCount: { type: 'number' },
    typesDefined: { type: 'array', items: { type: 'string' }, description: 'exact type/function names this track DEFINES (others consume).' },
    typesConsumed: { type: 'array', items: { type: 'string' }, description: 'exact type/function names from contracts/other tracks this track CONSUMES.' },
    crossTrackAssumptions: { type: 'array', items: { type: 'string' } },
    deviationsFromSynthesis: { type: 'array', items: { type: 'string' }, description: 'where the plan deviates from the scope-dial-in synthesis and why (e.g. Brandon overrides).' },
    scalabilityNotes: { type: 'string', description: 'how this track stays data-only / vocabulary-driven / fallback-safe.' },
    risks: { type: 'array', items: { type: 'string' } },
  },
}

phase('Draft')
const drafts = (await parallel(TRACKS.map(t => () =>
  agent(
    'You are writing a bite-sized, TDD implementation plan FILE for ONE track of a parallel-development effort (rebuild the Vyntechs diagnostic diagram: replace an ad-hoc dot-canvas with a Figma part-kit composed deterministically from data). PLAN ONLY — do not implement, do not run the app/tests; you are authoring the plan document.\n\n' +
    'YOUR TRACK: ' + t.key + ' — ' + t.name + (t.owns !== 'none' ? ' (owns contract ' + t.owns + ')' : '') + ' (Wave ' + t.wave + ').\n\n' +
    'WRITE the plan to: ' + ROOT + '/' + PLANS + '/' + DATE + '-diagram-' + t.key + '.md\n\n' +
    'Follow the writing-plans rules EXACTLY: a short header (Goal / Architecture / what it consumes+produces / its exclusively-owned files); then ordered TASKS, each with **Files** (exact create/modify/test paths), and bite-sized STEPS — write the failing test (real test code), run it (exact command + expected FAIL), minimal implementation (real code), run to PASS, commit. NO placeholders ("TBD"/"add error handling"/"similar to Task N"); show the actual code in every code step; use the EXACT contract type names. TDD, DRY, YAGNI, frequent commits.\n\n' +
    'Hold every task to THE SCALABILITY BAR below — no per-case/system-specific branching, vocabulary-driven, generic fallback, honest degrade. Build against the PINNED CONTRACTS verbatim. Respect BRANDON\'S OVERRIDES.\n\n' +
    BAR + '\n\n' + OVERRIDES + '\n\n' + CONTRACTS + '\n\n' + PATHS + '\n\n' +
    'Read the spec + .design-shots/tracks.json (your track\'s entry) + the real code your files touch BEFORE writing. Then write the file and return a STRICT structured summary (types defined/consumed must be exact so cross-track consistency can be checked).',
    { label: 'draft:' + t.key, phase: 'Draft', schema: DRAFT_SCHEMA }
  )
))).filter(Boolean)

const LENS_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['lens', 'findings', 'summary'],
  properties: {
    lens: { type: 'string' },
    findings: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['type', 'where', 'severity', 'fix'], properties: {
      type: { type: 'string', description: 'consistency | coverage | scalability | placeholder' },
      where: { type: 'string' }, severity: { type: 'string', description: 'blocker | major | minor' }, fix: { type: 'string' },
    } } },
    summary: { type: 'string' },
  },
}

const LENSES = [
  { key: 'consistency', focus: 'CONTRACT/TYPE CONSISTENCY across tracks. Compare every typesDefined vs typesConsumed against the PINNED CONTRACTS. Find any mismatch: a type/signature/path used by one track but named differently by its owner; a consumer assuming a shape the owner did not define; selectStepShape signature drift; SlotName/StepShape/MeterMode value drift; file-path collisions. Read the actual plan files if needed. Each finding: exact identifiers + the fix + which track changes.' },
  { key: 'coverage', focus: 'SPEC COVERAGE + the overrides. Skim the spec; for each requirement (the kit covering the FULL vocabulary + fallback; the per-step show-rule/leak-lock; the 7 templates incl. fork/locate/look; the detail slot / why-see-source prose; provenance 3-color; the scenario chip; mobile tap-toggle; KEEP tap-to-inspect; whole-system -> existing full view) point to a task that implements it, or flag the GAP + which track owns it. Critically: is the MULTI-SYSTEM scalability validation present in INTEGRATION (fuel + electrical + a non-fuel fixture), not just the fuel scene?' },
  { key: 'scalability', focus: 'SCALABILITY-BAR + plan quality. Hunt any per-case or system-specific branching (e.g. "if fuel"/hardcoded part lists/symptom-specific layout), any missing generic FALLBACK path, any template that keys off a system instead of the test-kind, any place adding a new system would need code not data. Plus a placeholder scan (TBD/"add error handling"/"similar to Task N"/missing code in a code step) across the plan files. Each finding: where + the fix.' },
]

phase('Cross-check')
const lenses = (await parallel(LENSES.map(l => () =>
  agent(
    'You are an adversarial plan reviewer. The per-track TDD plan files have been written to ' + ROOT + '/' + PLANS + '/' + DATE + '-diagram-*.md. Your job: find what is inconsistent, uncovered, or off-the-scalability-bar BEFORE execution.\n\n' +
    'YOUR LENS: ' + l.focus + '\n\n' +
    BAR + '\n\n' + OVERRIDES + '\n\n' + CONTRACTS + '\n\n' +
    'THE DRAFT SUMMARIES:\n' + JSON.stringify(drafts, null, 1) + '\n\n' +
    'Read the plan files + the spec (docs/superpowers/specs/' + DATE + '-diagnostic-diagram-design.md) as needed. Return STRICT structured findings, each with a concrete fix + the owning track.',
    { label: 'lens:' + l.key, phase: 'Cross-check', schema: LENS_SCHEMA }
  )
))).filter(Boolean)

const MASTER_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['masterFileWritten', 'crossTrackFixes', 'specCoverageGaps', 'readyToExecute', 'summaryForBrandon'],
  properties: {
    masterFileWritten: { type: 'string' },
    crossTrackFixes: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['track', 'fix'], properties: { track: { type: 'string' }, fix: { type: 'string' } } }, description: 'fixes the lenses surfaced that the per-track files still need (for the human to apply or verify).' },
    specCoverageGaps: { type: 'array', items: { type: 'string' } },
    readyToExecute: { type: 'boolean' },
    summaryForBrandon: { type: 'string', description: 'plain-English, non-technical: what the plan builds, the waves, and that it is held to the scalability bar. 4-6 sentences.' },
  },
}

phase('Master')
const master = await agent(
  'You are the tech lead. WRITE the MASTER implementation plan that ties the per-track plans together, to ' + ROOT + '/' + PLANS + '/' + DATE + '-diagnostic-diagram.md.\n\n' +
  'It MUST start with this header:\n' +
  '# Diagnostic Diagram Rebuild — Implementation Plan\n\n> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.\n\n**Goal:** ...\n**Architecture:** ...\n**Tech Stack:** ...\n\n---\n\n' +
  'Then sections: (1) THE SCALABILITY BAR (verbatim — it is the acceptance test). (2) The Wave 0 CONTRACT FREEZE, with C1/C2/C3 specified EXACTLY as below (type-only; lands + merges before any track forks). (3) Dependency WAVES: Wave 0 (C1+C2+C3 type freeze + app/globals.css tokens) -> Wave 1 (T1,T2,T3,T4,T7 parallel) -> Wave 2 (T5) -> Wave 3 (T6) -> Wave 4 (INTEGRATION). (4) Shared CONVENTIONS: each track is its own branch/PR off a shared feature base; exclusive file ownership (list which track owns which files; no two tracks edit the same file); Drizzle breakpoint-markers + cold-cache pnpm test note; the deterministic leak test (ResolvedScene.elements / pinsAllowed); the multi-system validation fixtures. (5) A per-track INDEX linking each ' + DATE + '-diagram-<track>.md with its one-line goal, wave, owned files, and depends-on. Do NOT re-paste each track\'s tasks — link them.\n\n' +
  BAR + '\n\n' + CONTRACTS + '\n\n' + OVERRIDES + '\n\n' +
  'THE DRAFT SUMMARIES:\n' + JSON.stringify(drafts, null, 1) + '\n\nADVERSARIAL FINDINGS:\n' + JSON.stringify(lenses, null, 1) + '\n\n' +
  'Reconcile the findings: list the cross-track fixes still needed (per track), and any spec-coverage gaps. Write the master file, then return STRICT structured output incl. a plain-English summaryForBrandon.',
  { label: 'master:plan', phase: 'Master', schema: MASTER_SCHEMA }
)

return { drafts, lenses, master }
