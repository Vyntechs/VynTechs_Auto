export const meta = {
  name: 'diagnostic-canvas-shape-exploration',
  description: 'Full exploration: design every diagnostic-canvas step shape (The Meter), synthesize one data model on the real schema, spec the visual vocabulary, adversarially prove no air gaps, build the updated prototype.',
  phases: [
    { title: 'Design', detail: '15 parallel agents — one per step shape + Tier-1/2 electrical sub-shape' },
    { title: 'Synthesize', detail: 'collapse all field needs into ONE data model on the real schema' },
    { title: 'Visual spec', detail: 'one coherent light-vocabulary contract reusing real --vt-* tokens' },
    { title: 'Adversarial', detail: 'prove every shape + every Tier-1/2 test has a screen + an honest incomplete-state; re-verify standing constraints' },
    { title: 'Build', detail: 'extend proto-meter.html with the new shapes, in vocabulary, desktop+mobile' },
  ],
}

// ----------------------------------------------------------------------------
// GROUNDING — the real schema/code reference (from a thorough code-map pass),
// the real scene, the chosen direction, the standing constraints, the paths.
// Every agent gets these so they map to REAL columns, not invention.
// ----------------------------------------------------------------------------

const ROOT = '/Volumes/Creativity/dev/projects/vyntechs/.claude/worktrees/system-data-ingest'

const SCHEMA_REF = [
  'REAL SCHEMA + CODE REFERENCE (exact identifiers; map to these, do not invent names).',
  '',
  'CRITICAL FACTS:',
  '- The loader DOES load test_actions and branch_logic (nested under each component). The .design-shots/scene-data.json slice is PARTIAL and omits them; that is the slice, not the loader.',
  '- A reading is keyed (pinId, scenarioId) -> reading: TEXT (free prose only). There is NO structured value/unit/in-range/band per (pin,scenario). pin.expectedReading is also free text.',
  '- BUT test_actions HAS structured columns expectedValue:real, expectedUnit:text, expectedTolerance:real, meterMode:text — and the loader DROPS all four (its SELECT omits them). Surfacing them is a loader-select change, not a new model.',
  '- There is NO step/walk/sequence table. A "step" = a test_action; ORDER = symptom_test_implications.priority (1-10, higher first); FORK = branch_logic.routesToTestActionId.',
  '- tech_outcomes (measured_value:real, measured_unit, measured_observation, verdict:text) is the structured measured-result table but is NOT loaded by the topology loader and not in Drizzle defs.',
  '- UNDEFINED IN APP (defined only in the prototype HTML today): the six --role-* wire tokens (--role-signal,--role-5v-ref,--role-low-ref,--role-pwm,--role-12v,--role-ground), --vt-recede, and --vt-amber-600 (topology.css references it; globals.css defines only --vt-amber-200/300/400/500).',
  '',
  'test_actions columns: id, slug, componentId, description(text, the instruction), scenarioRequired(enum), observationMethod(enum), meterMode(text,null), expectedValue(real,null), expectedUnit(text,null), expectedTolerance(real,null), expectedObservation(text,null — the ONLY expectation field the loader surfaces today), invasiveness(int 1-5), confidenceBoost, sourceCitation, sourceProvenance(enum), inferenceClass(enum,null).',
  '  observationMethod ENUM (9) — THIS IS ESSENTIALLY THE SHAPE SELECTOR: scan_tool_pid | pressure_test_with_gauge | electrical_measurement_at_pin | waveform_capture | direct_visual_internal | direct_visual_external | audible | touch | smell.',
  '  scenarioRequired ENUM (8): key-off | key-on | cranking | idle | medium-load | heavy-load | hot-soak | none.',
  '  NOTE: test_actions has NO column for electrical sub-quantity (volts/ohms/drop/duty/Hz/amps), NO hookup column (one-lead/across-two/clamp/scope), NO waveform-reference column, NO branches column (branches live in branch_logic).',
  'branch_logic columns: id, slug, testActionId, condition(text), verdict(enum: ok|warn|fail|impossible), nextAction(text), routesToTestActionId(uuid,null — the fork target), reasoning(text,null). Loader surfaces only {condition, verdict, nextAction}.',
  'component_pins columns: id, slug, componentId, name, roleAbbreviation(text — shown on pin chip), pinNumber(text,null), edge(enum: top|right|bottom|left), displayOrder(int), probeLocation(text), expectedReading(text), missingLogic(text — "if reading is wrong" prose), labelGap(text,null), sourceProvenance(text).',
  'system_scenarios columns: id, slug, platformId, system, label, sub, kind(enum: operation|fault), keyPosition(enum: off|on, null), engineState(enum: off|running, null), loadLevel(enum: idle|light|medium|heavy, null), isDefault, displayOrder. operation scenarios derive from the (keyPosition,engineState,loadLevel) tuple; fault scenarios have those NULL and are picked by slug.',
  'pin_scenario_readings: PK(pinId,scenarioId), reading:text NOT NULL.',
  'scenario_wire_states: PK(scenarioId,pinId), wireState enum (13): off|steady-12v|steady-5v|steady-gnd|signal-rest|signal-low|signal-med|signal-high|signal-pegged|pwm-low|pwm-med|pwm-high|pwm-max. (animation driver, NOT a reading.)',
  'components columns: id, slug, platformId, name, kind(enum: sensor|actuator|pump|valve|module|mechanical|splice|connector), electricalContract(text,null), location, function, systems(text[]), subtitle, role, wireSummary, body, probingTactic, unknownNote, sourceProvenance(enum: TRAINING-CONFIRMED|TRAINING-INFERRED|FIELD-VERIFIED|GAP).',
  'component_connections columns: id, fromComponentId, toComponentId, connectionKind(enum: electrical-wire|fluid-line|mechanical-linkage|can-bus|lin-bus|reports_to|controlled_by), direction(unidirectional|bidirectional), description, electricalRole(enum,null: signal|5v-ref|low-ref|pwm|12v|ground — non-null => animated wire edge), fromPinId(null), toPinId(null), sourceProvenance.',
  '',
  'LOADER CONTRACT (must NOT change without Brandon — propose deltas, do not apply): loadSystemTopology({db, platformSlug, symptomSlug, sessionId?}): Promise<SystemTopology|null>.',
  'SystemTopology = { platform{slug,name}, symptom{slug,description}, system, components[], connections[], scenarios[], dataStatus|null, lastScenarioSlug }.',
  '  TopologyComponent = { id,slug,name,kind,location,function,electricalContract,subtitle,role,wireSummary,body,probingTactic,unknownNote,sourceProvenance, observableProperties[], testActions[], pins[] }.',
  '  TopologyTestAction = { slug,description,scenarioRequired,observationMethod,expectedObservation(string|null),invasiveness,implicatedByCurrentSymptom, branches[] } ; branches item = {condition,verdict,nextAction}.',
  '  TopologyPin = { id,slug,name,roleAbbreviation,pinNumber,edge,displayOrder,probeLocation,expectedReading,missingLogic,labelGap,sourceProvenance }.',
  '  TopologyScenario = { id,slug,label,sub,kind,keyPosition,engineState,loadLevel,isDefault,displayOrder, pinStates:Record<pinId,wireState>, pinReadings:Record<pinId,string> }.',
  '',
  'CANVAS CODE: components/screens/topology-diagnostic.tsx (holds SelectionState + activeScenarioSlug). components/topology/topology-node.tsx (TopologyNode takes data{component,pins,selected,selectedPinId} — NO tier prop today; renders topo-node__gap "needs field check" chip when sourceProvenance===GAP). topology-flow.ts toFlowElements (builds nodes/edges + wire classes). topology-detail-panel.tsx PinBody computes reading=scenario.pinReadings[pin.id], renders expectedReading + missingLogic; PROVENANCE_LABEL = {TRAINING-CONFIRMED:"from theory", TRAINING-INFERRED:"inferred from theory", FIELD-VERIFIED:"field-verified", GAP:"needs field verification"}. scenario-bar.tsx deriveCompound/findOperationSlug are INTERNAL (not exported).',
  'CSS (topology.css): .wire.is-active = stroke-width:3.5 + drop-shadow(0 0 6px currentColor); .wire.off = opacity:0.16, animation:none; .wire.dim = opacity:0.25. .topo-node border = 1.4px solid var(--vt-fg) (brief wants this replaced with 0.5px engraved hairline).',
  'TOKENS available in app/globals.css (REUSE, do not reinvent): bone ramp --vt-bone-50..900 + --vt-bg/--vt-surface/--vt-fg/--vt-fg-2/--vt-fg-3; --vt-signal-200..800 (500 brand navy) + --vt-accent/--vt-accent-bg/--vt-focus-ring; --vt-amber-200..500 ONLY; --vt-elem-spark/fuel/coolant/voltage/oxygen/vacuum/brake/mech; --vt-risk-zero/low/medium/high/destructive; fonts --vt-font-serif (Instrument Serif) / --vt-font-sans (Inter Tight) / --vt-font-mono (JetBrains Mono); type --vt-fs-12..64; --vt-space-1..20; --vt-radius-0..4/pill; motion --vt-ease, --vt-ease-out, --vt-ease-instrument (cubic-bezier(.4,0,.2,1)), --vt-dur-1..4 (80/160/280/480ms).',
].join('\n')

const SCENE = [
  'REAL SCENE (the data the screens must render automatically): 2018 Ford F-250 6.7L Power Stroke, symptom P0087 fuel-rail-pressure-too-low.',
  'Counts: 25 components, 9 pins, 43 connections (23 fluid-line, 11 controlled_by, 5 electrical-wire, 3 reports_to, 1 mechanical-linkage), 8 scenarios, 72 pin-readings keyed (pinId,scenarioId).',
  'Scenarios: key-off, key-on, idle, light-load, medium-load, heavy-load, fault-high, fault-low. (operation x6, fault x2.)',
  'Provenance: ALL 25 components + ALL 9 pins are TRAINING-CONFIRMED -> render "from theory" (graphite, neutral, the DEFAULT — not an alarm). NO fabricated GAP component in this scene. The amber "needs field check" register comes ONLY from real label_gap facts ("wire color, connector pin number, prime duration — not yet captured") and electrical_contract notes ("voltage, current draw, connector type not yet captured" on 15 components).',
  'Canonical shape exemplars from THIS scene:',
  '  electrical/voltage-DC: Electric Lift Pump 12V power pin (2-wire: 12V + GND, target supply ~55 psi at idle). Readings: key-off "0V", key-on "12V briefly during prime then 0V", idle "12V steady", fault-low "12V steady — if pump silent suspect ground or motor".',
  '  electrical/resistance: Lift Pump ground continuity to chassis stud.',
  '  electrical/duty-PWM: FRP Regulator (2 wires to PCM, PWM-modulated) or Volume Control Valve pins A/B (PWM activity, duty varies with load).',
  '  fluid/pressure: lift-pump supply pressure ~55 psi (mechanical gauge on the supply line); CP4.2 rail pressure up to ~29,000 psi peak; passive return flow; filter restriction.',
  '  single-value PID: FRP sensor PID at idle (the symptom signal — rail pressure below PCM threshold).',
  '  look/inspect: CP4.2 debris in the fuel filter (catastrophic-pump signature), water-in-fuel separator, fuel leaks, connector corrosion.',
  '  fork/decision: after a reading, supply side (lift pump/filters) vs high-pressure side (CP4/rail/regulator) — branch_logic verdict + nextAction.',
  '  locate/orient: "find the lift pump ground stud, driver-side frame rail near tank" (suppress the reading band).',
  '  confirm-complaint: P0087 active, MIL on, low power under load; FRP PID below threshold.',
].join('\n')

const DIRECTION = [
  'CHOSEN DIRECTION — THE METER (locked; do not re-litigate). The READING is the hero (EXPECT vs NOW vs verdict), the diagram is the quiet proof of WHERE the number comes from.',
  'CORE PRINCIPLE (Brandon, locked): the screen IS the circuit you are testing, not the truck — a clean exact directed path from problem to part, drawn the way a tech reasons, composed automatically from whatever the current step needs. NOT a system map with one part highlighted; just the few elements the step involves.',
  'RECTANGLES/CARDS ARE OUT. Use light schematic marks: a small role-colored point + a one-line serif name; clean directed lines (flow/current with meaning); the meter hookup drawn where the leads actually go. Detail (type, location, probe text, theory) lives in the bottom tap-sheet ("The Meter") + the gauge, NEVER as paragraphs on the canvas.',
  'Per-step-TYPE fact budget (this is the thesis): the SAME tap is ordered by the step. PROBE leads with probeLocation then EXPECT/NOW + verdict; LOCATE suppresses the reading entirely (a number is noise when the job is "find the thing"); ORIENT names the circuit, elevates no pin; the failure tree (missingLogic) stays COLLAPSED on an in-range reading and unfolds only when out-of-range.',
  'GENERALIZATION (the scaling bet): the SHAPE of the screen depends on the step TYPE. "Circuit" is just the shape for an electrical test. Plan a defined screen for EVERY shape — no air gaps. Adding a make/system/symptom/step = drop in vetted data, the finished screen renders itself, ZERO per-case design.',
  'Three-color discipline: graphite = drafted/"from theory" (default, neutral), amber = "needs field check" (we-do-not-know-yet; only elevated at the moment of a probe), red = measured-wrong (out-of-range only). Provenance is quiet ink under the value; the word itself ("from theory · why?") is the see-source affordance (pull, not push), expands inline then folds away.',
  'Bottom Meter band (~30% desktop / detented sheet mobile) rises on tap, never covers the lit part (bottom-heavy framing), eases away on dismiss. Scenario folds INTO the NOW column ("NOW · Key On · Engine Off") + a recessed ribbon chip; no persistent scenario bar.',
].join('\n')

const CONSTRAINTS = [
  'STANDING CONSTRAINTS (hard gates): NO "AI" word anywhere in user-facing copy (frame around the source/the action). NO "step N of M" / no upcoming-work preview (show done + now only; the system computes next silently). Mobile 375-414px is a hard gate. Provenance honesty (from-theory / needs-field-check / field-verified; quiet see-source; never an oracle). Premium pro-tool aesthetic, NEVER default-AI (no dotted grids, no verdict pills, no emoji icon cards, no uniform-Tailwind spacing). Everything data-driven, zero per-case design. Do NOT change the loader contract / DB — PROPOSE schema changes, do not apply. This heads to staging-curator / V2, not prod.',
].join('\n')

const PATHS = [
  'FILES YOU MAY READ (root ' + ROOT + '):',
  '- .design-shots/scene-data.json (the real 25-part fuel scene — components/pins/connections/scenarios/pinReadings).',
  '- .design-shots/mockups/proto-meter.html (the CURRENT prototype — already implements The Meter light vocabulary for the ELECTRICAL shape: probe + locate steps, role-colored wires, tier fade, bottom Meter band, provenance, scenario chip).',
  '- .design-shots/mockups/direction-3-the-meter.json (the full chosen-direction spec).',
  '- .design-shots/mockups/lens-research.json (premium pro-tool patterns research, cited).',
  '- lib/db/schema.ts, drizzle/migrations/0021_*.sql + 0023_* (schema truth).',
  '- lib/diagnostics/load-system-topology.ts (the loader contract).',
  '- components/topology/topology.css, topology-node.tsx, topology-detail-panel.tsx (current canvas code + CSS).',
].join('\n')

// ----------------------------------------------------------------------------
// PHASE 1 — per-shape design (parallel)
// ----------------------------------------------------------------------------

const SHAPES = [
  { key: 'electrical-overview', name: 'Electrical circuit / path (PARENT shape)', note: 'The directed source->part->ground path with the probe point marked and the meter hookup drawn where the leads go. YOUR job: define the shared electrical canvas, and define exactly HOW the sub-shapes (volts / drop / ohms / duty / waveform / amps) vary that SAME canvas (what changes: the hookup drawing, the gauge type, the EXPECT format). Canonical case: lift-pump 12V.' },
  { key: 'elec-voltage-dc', name: 'Electrical sub-shape: Voltage DC (Tier 1, daily)', note: 'One lead to a point + ground reference; EXPECT a voltage value/band. Lift-pump 12V power pin is the canonical case.' },
  { key: 'elec-resistance', name: 'Electrical sub-shape: Resistance / Continuity (Tier 1)', note: 'Two-point across A<->B, key-off; EXPECT ohms / continuity. Lift-pump ground-to-chassis continuity.' },
  { key: 'elec-voltage-drop', name: 'Electrical sub-shape: Voltage drop (Tier 1 — the differentiator)', note: 'Across two points UNDER LOAD; EXPECT a small drop (e.g. <0.1V). The master-tech move; the drawing must show the two probe points spanning a load, not one point to ground.' },
  { key: 'elec-duty-pwm', name: 'Electrical sub-shape: Duty cycle / PWM (Tier 1)', note: 'One lead, engine running; EXPECT a duty%. FRP regulator / Volume Control Valve PWM (duty varies with load).' },
  { key: 'elec-voltage-waveform', name: 'Electrical sub-shape: Voltage waveform / scope (Tier 2)', note: 'Scope hookup; EXPECT a reference trace SHAPE to compare against (not a single number). The gauge becomes a trace window.' },
  { key: 'elec-current-waveform', name: 'Electrical sub-shape: Current waveform / clamp+scope (Tier 2 — diesel injector marquee)', note: 'Amp clamp around the wire + scope; EXPECT a current trace shape. The hookup drawing is a clamp ring around a wire, not probe leads on a pin.' },
  { key: 'elec-tier34-graceful', name: 'Electrical Tier 3-4 GRACEFUL (amps/clamp draw, bidirectional/active command, Hz, AC charging ripple, diode test, min/max capture)', note: 'These are situational/rare. Define how each degrades GRACEFULLY: never blank, never "I do not know" — at minimum name the test, the hookup, the expected, and honest gaps. Show how the same canvas handles them without first-class clutter.' },
  { key: 'fluid-pressure', name: 'Fluid / flow / pressure path', note: 'Same directed-line idea but fuel instead of current; a port/gauge with a PSI or volume TARGET. Lift-pump supply ~55 psi (mechanical gauge on supply line), CP4 rail pressure, return flow, restriction. observationMethod=pressure_test_with_gauge.' },
  { key: 'single-value-pid', name: 'Single-point value (scan-tool PID / sensor reading)', note: 'Barely a diagram: ONE part + its gauge. The Meter at its purest. FRP sensor PID at idle (the symptom signal). observationMethod=scan_tool_pid. No probe leads, no hookup — the value comes from the scan tool.' },
  { key: 'waveform-scope', name: 'Waveform (scope) — generic shape', note: 'One point + the SHAPE the trace should make, to compare captured-vs-reference (PicoScope known-good-waveform-fixed-on-screen convention). Define the trace window as the gauge.' },
  { key: 'look-inspect', name: 'Look / inspect (visual / physical — incl. audible / touch / smell)', note: 'No number, no path: the part, where it is, and what GOOD-vs-BAD looks like. CP4 debris in the filter, water-in-fuel, leaks, corrosion. observationMethod=direct_visual_internal|external|audible|touch|smell. The gauge is replaced by a good-vs-bad compare, not a number.' },
  { key: 'fork-decision', name: 'Fork / decision', note: 'The two (or more) ways it can go, pick one. Supply side vs high-pressure side. Driven by branch_logic (condition -> verdict -> nextAction, routesToTestActionId). Honor no-step-N-of-M: show the chosen next, not the whole tree.' },
  { key: 'locate-orient', name: 'Locate / orient', note: 'Find the part / set context; SUPPRESS the reading band entirely (already in the prototype as the LOCATE step). The lead fact is the location string.' },
  { key: 'confirm-complaint', name: 'Confirm complaint', note: 'State the symptom; maybe the single whole-system glimpse before narrowing. P0087 active, MIL on, low power under load, FRP PID below threshold. This is the entry screen.' },
]

const PERSHAPE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['shapeKey', 'shapeName', 'triggeredBy', 'screenContents', 'lightVocabDrawing', 'meterBlock', 'dataFields', 'schemaMapping', 'gaps', 'incompleteState', 'mobile', 'sceneExample'],
  properties: {
    shapeKey: { type: 'string' },
    shapeName: { type: 'string' },
    triggeredBy: { type: 'string', description: 'Exactly which data value(s) make code pick this shape automatically (observationMethod value, plus any electrical sub-quantity/state). Cite real enum values.' },
    screenContents: { type: 'string', description: 'What the screen shows EXACTLY: the hero element, the supporting marks, what leads, what is dimmed/below-fold.' },
    lightVocabDrawing: { type: 'string', description: 'How it is drawn in the light vocabulary: the marks, the directed lines, the meter-hookup overlay (where the leads/clamp/port sit), the gauge/trace. No rectangles.' },
    meterBlock: { type: 'string', description: 'What the bottom Meter shows for this shape: EXPECT / NOW / verdict format — or "suppressed" (locate) / "good-vs-bad compare" (look) / "trace window" (waveform).' },
    dataFields: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['field', 'source', 'purpose'], properties: { field: { type: 'string' }, source: { type: 'string', description: 'EXISTING column (name it) OR "MISSING — propose: <name:type on table>"' }, purpose: { type: 'string' } } } },
    schemaMapping: { type: 'string', description: 'Map this shape to the real columns: test_actions.observationMethod/expectedValue/expectedUnit/expectedTolerance/meterMode/expectedObservation, component_pins.*, branch_logic.*, scenario_wire_states, pin_scenario_readings, etc.' },
    gaps: { type: 'array', items: { type: 'string' }, description: 'What is genuinely MISSING from the schema to auto-drive this shape. Be specific and minimal.' },
    incompleteState: { type: 'string', description: 'What the screen shows HONESTLY when data is incomplete — never a fabricated number; "needs field check" honesty.' },
    mobile: { type: 'string', description: '375-414px layout for this shape.' },
    sceneExample: { type: 'string', description: 'A concrete instance rendered from THIS 6.7L fuel scene.' },
  },
}

phase('Design')
const perShape = (await parallel(SHAPES.map(s => () =>
  agent(
    'You are a senior product/UX designer on Vyntechs, a premium diagnostic tool for master diesel techs. You are designing ONE step-shape screen for the diagnostic canvas in the chosen direction THE METER.\n\n' +
    'DESIGN THIS SHAPE:\n- ' + s.name + '\n- ' + s.note + '\n\n' +
    DIRECTION + '\n\n' + CONSTRAINTS + '\n\n' + SCHEMA_REF + '\n\n' + SCENE + '\n\n' + PATHS + '\n\n' +
    'Read scene-data.json, the current proto-meter.html, and direction-3-the-meter.json to ground yourself. Then define this shape against the REAL columns. Requirements:\n' +
    '(a) what the screen shows EXACTLY, (b) how it is drawn in the LIGHT vocabulary (marks + directed lines + meter-hookup overlay + gauge/trace — NO rectangles, no paragraphs on canvas), (c) the data fields that auto-drive it mapped to REAL columns (mark anything genuinely missing as "MISSING — propose"), (d) the honest incomplete-data state, (e) mobile.\n' +
    'Pick the shape automatically from data (lead with observationMethod). Keep proposed-new fields MINIMAL — prefer surfacing the 4 dropped test_actions columns over inventing new ones. Honor every standing constraint. Return STRICT structured output.',
    { label: 'design:' + s.key, phase: 'Design', schema: PERSHAPE_SCHEMA }
  )
))).filter(Boolean)

// ----------------------------------------------------------------------------
// PHASE 2 — data-model synthesis (single agent, needs ALL per-shape designs)
// ----------------------------------------------------------------------------

const DATAMODEL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['shapeSelector', 'existingColumnsToSurface', 'newFieldsProposed', 'forkModel', 'verdictAndRangeModel', 'orderingModel', 'hookupModel', 'loaderContractDelta', 'migrationSketch', 'scalesWithZeroPerCaseDesign', 'openQuestionsForBrandon'],
  properties: {
    shapeSelector: { type: 'string', description: 'EXACTLY how code picks the right shape per step automatically. Lead with test_actions.observationMethod; state how electrical SUB-shapes (volts/drop/ohms/duty/Hz/amps/waveform) and hookup are distinguished and what (if anything) new is needed.' },
    existingColumnsToSurface: { type: 'array', items: { type: 'string' }, description: 'Real columns that exist but the loader drops/ignores and should be surfaced (e.g. test_actions.expectedValue/expectedUnit/expectedTolerance/meterMode).' },
    newFieldsProposed: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'table', 'type', 'why', 'tier'], properties: { name: { type: 'string' }, table: { type: 'string' }, type: { type: 'string' }, why: { type: 'string' }, tier: { type: 'string', description: 'must-have | nice-to-have' } } }, description: 'The MINIMAL set of genuinely new fields. Justify each; prefer none.' },
    forkModel: { type: 'string', description: 'How a fork/decision step is driven by branch_logic (condition/verdict/nextAction/routesToTestActionId) without violating no-step-N-of-M.' },
    verdictAndRangeModel: { type: 'string', description: 'How in-range/out-of-range (red) + the failure-tree-unfold trigger are determined. Resolve direction risk #1 here: use expectedValue+expectedTolerance vs tech_outcomes.measured_value, branch_logic.verdict, and the NEUTRAL-when-ambiguous default. State precisely.' },
    orderingModel: { type: 'string', description: 'How the step ORDER + which step is current is driven (symptom_test_implications.priority + branch_logic graph). No new step table.' },
    hookupModel: { type: 'string', description: 'How the meter-lead / clamp / port / scope drawing endpoints are derived (component_pins as endpoints, fromPinId/toPinId on connections, edge) and what is missing for two-point/clamp hookups.' },
    loaderContractDelta: { type: 'string', description: 'The exact additive change to SystemTopology / TopologyTestAction needed to surface the above — additive only, framed as a PROPOSAL (do not apply).' },
    migrationSketch: { type: 'string', description: 'Plain sketch of any DB migration needed (additive, breakpoint-marked). If none needed, say so.' },
    scalesWithZeroPerCaseDesign: { type: 'string', description: 'Argue that with this model, adding a new make/system/symptom/step renders a finished screen with zero per-case design.' },
    openQuestionsForBrandon: { type: 'array', items: { type: 'string' }, description: 'The few real decisions for Brandon (e.g. authoring the range flag as curator data). Concrete, plain-English, user-visible — not abstract trade-offs.' },
  },
}

phase('Synthesize')
const dataModel = await agent(
  'You are a senior data-model architect on Vyntechs. Collapse the per-shape design field needs below into ONE coherent data-model proposal on the REAL schema. The goal: code picks the right SHAPE and renders a finished screen automatically from vetted data, with ZERO per-case design.\n\n' +
  'Anchor on these facts: observationMethod (9-enum) is already the shape selector and is already loaded; test_actions.expectedValue/expectedUnit/expectedTolerance/meterMode EXIST but the loader DROPS them; branch_logic drives forks; symptom_test_implications.priority drives order; there is NO structured per-(pin,scenario) in-range flag. PREFER surfacing existing columns over inventing new ones; keep new fields minimal and tiered must-have vs nice-to-have. Do NOT change the loader contract — frame deltas as additive proposals.\n\n' +
  SCHEMA_REF + '\n\n' + SCENE + '\n\n' + DIRECTION + '\n\n' + CONSTRAINTS + '\n\n' +
  'THE PER-SHAPE DESIGNS (their dataFields + gaps are your raw material):\n' +
  JSON.stringify(perShape, null, 1) + '\n\n' +
  'Return STRICT structured output. Be exact with column names. Resolve the verdict/range data dependency precisely (direction risk #1).',
  { label: 'synthesize:data-model', phase: 'Synthesize', schema: DATAMODEL_SCHEMA }
)

// ----------------------------------------------------------------------------
// PHASE 3 — visual-vocabulary spec (single agent, needs phase 1 + 2)
// ----------------------------------------------------------------------------

const VISUALSPEC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['marks', 'wireVocab', 'meterHookupOverlay', 'gauge', 'waveformTrace', 'forkUI', 'locateAndLook', 'provenance', 'scenarioChrome', 'tokensToAdd', 'mobile', 'motion', 'wholeSystemEscape'],
  properties: {
    marks: { type: 'string', description: 'The light schematic mark for a part: the role-colored point + one-line serif name; focus/anchor/recede tiers; active (navy halo); how provenance modulates the draw (drafted vs field-verified vs gap edge). NO rectangles.' },
    wireVocab: { type: 'string', description: 'Directed lines with meaning: role color per electricalRole, flow/current animation tied to scenario_wire_states, what receded wires do, the hairline leader from pin to Meter.' },
    meterHookupOverlay: { type: 'string', description: 'How the meter connection is DRAWN per hookup: one-lead-to-ground, across-two-points, clamp-around-wire, scope, fluid-port/gauge. The literal lead/clamp/port marks.' },
    gauge: { type: 'string', description: 'The EXPECT/NOW/verdict instrument block: mono tnum, expected band frame, the in-range/low/out chip, the three-color discipline.' },
    waveformTrace: { type: 'string', description: 'The trace window that replaces the numeric gauge for waveform shapes: reference-vs-captured, fixed known-good.' },
    forkUI: { type: 'string', description: 'The fork/decision UI: the two+ branches, how the chosen next part lights up, honoring no-step-N-of-M.' },
    locateAndLook: { type: 'string', description: 'Locate (suppress reading) + Look/inspect (good-vs-bad compare instead of a number) treatments.' },
    provenance: { type: 'string', description: 'Provenance-as-ink + inline "why?" pull; three-color discipline; reconcile GAP wording ("needs field verification" per the shipped map vs "needs field check"). Kill the standing topo-node__gap chip.' },
    scenarioChrome: { type: 'string', description: 'Scenario folded into NOW column + recessed ribbon chip; no persistent bar; curator-only completeness gated.' },
    tokensToAdd: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['token', 'value', 'why'], properties: { token: { type: 'string' }, value: { type: 'string' }, why: { type: 'string' } } }, description: 'The exact tokens to DEFINE in globals.css (the six --role-*, --vt-recede, --vt-amber-600). Real oklch values on the existing ramp.' },
    mobile: { type: 'string', description: 'The mobile (375-414px) contract: ribbon, bottom-sheet detents, >=48px targets, canvas-pan-on-sheet-move.' },
    motion: { type: 'string', description: 'Calm damped motion on --vt-ease-instrument; step reframe, Meter rise, value settle; reduced-motion branch.' },
    wholeSystemEscape: { type: 'string', description: 'The explicit whole-system escape hatch (not the default).' },
  },
}

phase('Visual spec')
const visualSpec = await agent(
  'You are the design-systems lead on Vyntechs. Write ONE coherent visual-vocabulary contract for the diagnostic canvas (THE METER) that every step shape reuses — so the canvas is indistinguishable in palette/type/density from the in-repo Workshop Instrument kit, never a parallel system, never default-AI.\n\n' +
  'Reuse the real --vt-* tokens (do not reinvent). DEFINE the genuinely-missing tokens with real oklch values on the existing ramp: the six --role-* wire tokens, --vt-recede (~0.16), --vt-amber-600. Replace the 1.4px node border with a 0.5px engraved hairline. Kill the standing topo-node__gap chip (provenance modulates the draw instead).\n\n' +
  SCHEMA_REF + '\n\n' + DIRECTION + '\n\n' + CONSTRAINTS + '\n\n' +
  'THE PER-SHAPE DESIGNS:\n' + JSON.stringify(perShape, null, 1) + '\n\n' +
  'THE DATA MODEL:\n' + JSON.stringify(dataModel, null, 1) + '\n\n' +
  'Read direction-3-the-meter.json (visualLanguage/motionSpec) and the current proto-meter.html for the established vocabulary. Return STRICT structured output — a buildable contract, not prose.',
  { label: 'spec:visual-vocabulary', phase: 'Visual spec', schema: VISUALSPEC_SCHEMA }
)

// ----------------------------------------------------------------------------
// PHASE 4 — adversarial no-air-gaps + constraint check (parallel lenses)
// ----------------------------------------------------------------------------

const ADVERSARIAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['lens', 'airGaps', 'constraintViolations', 'dataModelHoles', 'verdict'],
  properties: {
    lens: { type: 'string' },
    airGaps: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['where', 'severity', 'fix'], properties: { where: { type: 'string' }, severity: { type: 'string', description: 'blocker | major | minor' }, fix: { type: 'string' } } }, description: 'Any step shape OR Tier-1/2 electrical test that lacks a defined screen OR a defined honest incomplete-state. An air gap is a place the tool would not know what to draw.' },
    constraintViolations: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['constraint', 'where', 'fix'], properties: { constraint: { type: 'string' }, where: { type: 'string' }, fix: { type: 'string' } } }, description: 'Any breach of: no-AI-word, no-step-N-of-M, mobile gate, provenance honesty, premium-not-default-AI, scales-zero-per-case, do-not-change-loader-contract.' },
    dataModelHoles: { type: 'array', items: { type: 'string' }, description: 'Places the proposed data model cannot actually drive the screen from data (a shape that secretly needs per-case authoring).' },
    verdict: { type: 'string', description: 'no-air-gaps | air-gaps-found — one line.' },
  },
}

const LENSES = [
  { key: 'air-gap-coverage', focus: 'Coverage completeness. Enumerate EVERY step shape AND every Tier-1 and Tier-2 electrical sub-shape; for each, confirm there is BOTH a defined screen AND a defined honest "data incomplete" state. Flag any missing one as an air gap. Also confirm Tier-3/4 degrade gracefully (never blank).' },
  { key: 'constraints', focus: 'Standing constraints. Hunt for any leak of the word "AI", any "step N of M" / upcoming-work preview, any mobile failure, any dishonest provenance (a fabricated number where data is absent), any default-AI aesthetic, and any place that secretly requires per-case design. Verify the loader contract is only PROPOSED-additive, not changed.' },
  { key: 'data-drivability', focus: 'Data-drivability. For each shape, can the screen REALLY be rendered automatically from the proposed model + real columns, with zero per-case design? Find shapes that secretly need hand-authoring (e.g. waveform reference traces, two-point hookup endpoints, the in-range flag). Pressure-test the verdict/range model hardest.' },
]

phase('Adversarial')
const adversarial = (await parallel(LENSES.map(l => () =>
  agent(
    'You are an adversarial design+data reviewer for Vyntechs. Your job is to BREAK this plan, not praise it. Default to finding gaps. Be specific and cite the shape/field.\n\n' +
    'YOUR LENS: ' + l.focus + '\n\n' +
    DIRECTION + '\n\n' + CONSTRAINTS + '\n\n' + SCHEMA_REF + '\n\n' + SCENE + '\n\n' +
    'THE PLAN UNDER REVIEW:\nPER-SHAPE DESIGNS:\n' + JSON.stringify(perShape, null, 1) + '\n\nDATA MODEL:\n' + JSON.stringify(dataModel, null, 1) + '\n\nVISUAL SPEC:\n' + JSON.stringify(visualSpec, null, 1) + '\n\n' +
    'Prove whether there are NO AIR GAPS: every step shape and every Tier-1/2 electrical test must have a defined screen AND a defined honest incomplete-state. Report every gap and every constraint breach with a concrete fix. Return STRICT structured output.',
    { label: 'adversarial:' + l.key, phase: 'Adversarial', schema: ADVERSARIAL_SCHEMA }
  )
))).filter(Boolean)

// ----------------------------------------------------------------------------
// PHASE 5 — build the updated prototype (single agent; file backed up already)
// ----------------------------------------------------------------------------

const BUILD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['fileWritten', 'shapesInWalk', 'changelog', 'selfReview', 'knownRisks'],
  properties: {
    fileWritten: { type: 'string' },
    shapesInWalk: { type: 'array', items: { type: 'string' }, description: 'The ordered list of step shapes now demonstrated in the walk.' },
    changelog: { type: 'string', description: 'What changed vs the prior proto-meter.html.' },
    selfReview: { type: 'string', description: 'Honest self-review: what is solid, what is rough, what still uses rectangles or violates the light vocabulary if anything.' },
    knownRisks: { type: 'array', items: { type: 'string' } },
  },
}

phase('Build')
const adversarialFixes = adversarial.flatMap(a => [...(a.airGaps || []), ...(a.constraintViolations || [])])
const build = await agent(
  'You are a senior frontend engineer + designer building a high-fidelity, self-contained HTML/CSS/JS PROTOTYPE (no framework) for Vyntechs THE METER diagnostic canvas. Avoid generic AI aesthetics; this must look like a premium pro instrument.\n\n' +
  'TASK: extend the EXISTING prototype at .design-shots/mockups/proto-meter.html so it demonstrates MORE step shapes end-to-end, in the established light vocabulary, desktop + mobile. The current file already does the ELECTRICAL shape (probe-12v, locate-ground, probe-ground). KEEP those working and ADD, as new steps in the walk:\n' +
  '  1) a SINGLE-VALUE (scan-tool PID) step — FRP sensor PID at idle: barely a diagram (the FRP sensor mark + the gauge), the value is the hero, no probe leads. This is the symptom signal.\n' +
  '  2) a LOOK / INSPECT step — water-in-fuel separator OR CP4 debris in the filter: NO number; the gauge is replaced by a good-vs-bad compare; provenance honest.\n' +
  '  3) a FORK / DECISION step — after a reading, supply side (lift pump/filters) vs high-pressure side (CP4/rail/regulator): show the chosen next part lighting up, honor no-step-N-of-M (do NOT show the whole tree or any "step N of M").\n' +
  'Wire them into the existing STEPS[] model + the demo NEXT/BACK controls so Brandon can walk: confirm-complaint? -> electrical probe -> locate -> single-value PID -> look/inspect -> fork. Reuse the existing tier/fade, role-colored wires, bottom Meter, provenance, scenario chip. Each shape must redraw the canvas to exactly that step\'s shape (compose-from-data feel).\n\n' +
  'BUILD EXACTLY TO THIS VISUAL SPEC:\n' + JSON.stringify(visualSpec, null, 1) + '\n\n' +
  'AND THIS DATA MODEL (the screens must read as if auto-driven by these fields):\n' + JSON.stringify(dataModel, null, 1) + '\n\n' +
  'FIX THESE ISSUES the adversarial review found (where they apply to the prototype):\n' + JSON.stringify(adversarialFixes, null, 1) + '\n\n' +
  DIRECTION + '\n\n' + CONSTRAINTS + '\n\n' + SCENE + '\n\n' + SCHEMA_REF + '\n\n' +
  'Read the current proto-meter.html fully first (it is backed up at proto-meter.v1.bak.html, so you may rewrite the whole file). Then WRITE the complete updated file back to ' + ROOT + '/.design-shots/mockups/proto-meter.html. It must be valid standalone HTML that opens via file:// with no build step, no console errors, and pass a 375px mobile viewport. Use ONLY the established vocabulary (light marks, NO rectangles/cards). Keep all copy in plain shop English; never the word "AI"; never "step N of M". Return STRICT structured output describing what you built.',
  { label: 'build:proto-meter', phase: 'Build', schema: BUILD_SCHEMA }
)

return { perShape, dataModel, visualSpec, adversarial, build }
