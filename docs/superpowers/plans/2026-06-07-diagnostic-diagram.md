# Diagnostic Diagram Rebuild — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Replace the xyflow/dagre node-graph diagnostic screen with a data-driven, self-rendering diagnostic diagram: a frozen building-block vocabulary (part kinds, wire roles, observation methods, step shapes, meter modes) flows through a pure assembly engine and a small set of per-shape layout templates so that adding a new system / symptom / make / concern is DATA-ONLY — the correct screen renders itself with no new design, no new code, no AI. The 6.7L fuel "cranks-no-start" scene is one fixture; generality is proven across multiple unlike systems.

**Architecture:** A four-layer pure-function pipeline. (1) **Data** — `loadSystemTopology` surfaces the curated graph additively (C1). (2) **Kit** — a Figma-sourced part/wire/overlay component library resolved by DATA via a registry, with a generic fallback (C2). (3) **Engine** — a show-rule (`selectStepShape`) + slot-resolver (`assembleScene`) that turns `(topology, step, scenario)` into a `ResolvedScene` of slots/elements, plus a React-free step-sequence/fork engine (C3 + T3 + T7). (4) **Presentation** — per-shape layout templates keyed only on `scene.shape`, a mobile tap-to-toggle Meter sheet, and the app swap that mounts the assembled diagram while keeping tap-to-inspect and the existing full faded-system "whole system" view (T4, T5, T6). INTEGRATION renders the real seeded route and runs the deterministic multi-system scalability gate (Wave 4).

**Tech Stack:** TypeScript, React 19, Next.js App Router, Drizzle ORM + Postgres (Supabase) / PGlite for unit migrations, Vitest (happy-dom), Playwright MCP for the visual gate. SVG part glyphs + CSS-variable design tokens in `app/globals.css`. No new runtime deps; `@xyflow/react` + `@dagrejs/dagre` are RETAINED (escape "whole system" view only).

---

## 1. THE SCALABILITY BAR

This is verbatim and is THE acceptance test. Every task is held to it. INTEGRATION (Wave 4) is the gate that proves it; every track's purity/leak/generality tests enforce it locally.

- Adding a new system/symptom/make/concern is DATA-ONLY: no new design, no new code, no AI. The correct screen renders itself.
- The kit + engine + templates contain ZERO system-specific or per-case branching — everything is a pure function of the building-block vocabulary: components.kind (8), connectionKind, electricalRole (6), observationMethod (9), system scenarios, stepKind, MeterMode.
- An UNSEEN part kind / role / connection type / test method renders via a generic FALLBACK — never a blank, never a crash.
- Templates key off the KIND OF TEST (pressure/electrical/reading/scope/look), never a system shape — an air-brake circuit or DEF line lays out as cleanly as fuel.
- Partial/incomplete data degrades honestly (the universal "needs field check" path); it is the steady state, not an error.
- The 6.7L fuel scene is ONE fixture. Generality is validated across multiple unlike systems (fuel + a purely-electrical case + one non-fuel system such as DEF/charging/air; synthetic fixtures are fine where real data is not authored yet).

---

## 2. WAVE 0 — CONTRACT FREEZE (type-only; lands + merges BEFORE any track forks)

Wave 0 is a single short-lived PR off the shared feature base that lands the three type-only contract modules **plus** the `app/globals.css` token block, and reconciles every cross-track name/shape mismatch the adversarial review surfaced. NOTHING in Wave 1 may fork until Wave 0 is merged. Wave 0 contains no runtime logic except the token CSS — it is types, unions, const tables, and the design tokens.

Wave 0 also resolves the test-collection question once (see Conventions §4): the frozen `vitest.config.ts` `include` is `tests/unit/**/*.test.ts(x)` ONLY (verified). Wave 0 widens it to also collect `lib/**/*.test.ts` and `components/**/*.test.{ts,tsx}` AND assigns ownership of `vitest.config.ts` to Wave 0 (no Wave 1 track may edit it). Every track that authors a runnable spec asserts a known test count so a non-collected suite fails loud instead of going vacuously green.

### C1 — data-contract (owner T1) `lib/diagnostics/load-system-topology.ts`

Extends `loadSystemTopology -> SystemTopology` **ADDITIVELY ONLY** (new optional keys; nothing renamed/removed):

- `TopologyTestAction` gains: `meterMode: MeterMode|null`, `expectedValue: number|null`, `expectedUnit: string|null`, `expectedTolerance: number|null`, `stepKind: string|null`, `priority: number|null`. (`observationMethod`/`implicatedByCurrentSymptom`/`branches`/`expectedObservation`/`sourceProvenance` stay.)
- `TopologyBranch` gains: `routesToTestActionId: string|null`, `reasoning: string|null`. (`condition`/`verdict`/`nextAction` already surfaced — `verdict` ALREADY exists, do not re-add.)
- `TopologyScenario` gains a SIBLING map: `isOutOfRange: Record<string, boolean>` (pinId -> out-of-range; missing key => not-out-of-range => neutral). `pinReadings` stays `Record<string,string>` UNCHANGED.
- `MeterMode = 'volts'|'ohms'|'drop'|'duty'|'amps'|'pid'|'pressure'` (nullable, documented union). **Exported from this module** so C2/C3 import the name, never re-declare it.
- Verdict precedence: `isOutOfRange` authoritative -> branch `verdict==="fail"` -> neutral graphite default. NO prose-number parsing; numeric compare deferred (tech_outcomes not loaded).
- LOCKED FACTS (verified in this repo): `electricalRole`/`fromPinId`/`toPinId`/`connectionKind` ALREADY surfaced (loader lines 236-243) — DO NOT touch the connection SELECT. `routesToTestActionId`/`reasoning` (schema.ts 926/930) and `symptom_test_implications.priority` (schema.ts 1142) ALREADY exist in schema — they are loader-SELECT un-drops, not new columns. The ONLY genuine un-drops: the 4 meter fields + `routesToTestActionId`/`reasoning` + surfacing `priority` (implRows `Set` -> `Map`). The ONLY new columns: `test_actions.step_kind`, `pin_scenario_readings.is_out_of_range` (both nullable; migration breakpoint-marked).

### C2 — part-API (owner T2) `components/diagram-kit/part-api.ts`

- `DiagramPartProps` + unions: `PartKind` (the 8 components.kind), `PartRoleSpecial` (`ground|relay|fuse|power-source`), `WireRole` (the 6 electricalRole = `NonNullable<TopologyConnection['electricalRole']>`), `PartTier` (`focus|anchor|recede`), `PartProvenance` (`drafted|field-verified|needs-field-check`), `Terminal {id,role,edge,label,visible,active,selected}` (`visible` is ENGINE-controlled — the leak-lock: terminals never always-on; `edge = TopologyPin['edge']`), `PartReading` (thin handoff to the existing Meter; C2 does NOT re-own the gauge).
- A part-registry `(kind|roleSpecial) -> component` so consumers resolve by DATA, not a switch. A GENERIC FALLBACK part for any unseen kind/role. `DiagramPartProps.kind` is `PartKind | string` (open) so an unseen C1 kind type-checks to the fallback.
- REDUCED-MOTION is a contract requirement: any animated part gates on `prefers-reduced-motion` at the part level. `stepKind`/`isOutOfRange` optional so C2 typechecks with or without the migration. NO scope/waveform stub in v1 (documented deferral — see §Spec Coverage Gaps). Root dir: `components/diagram-kit/`.
- **PartReading is the canonical Meter handoff shape** and resolves the cross-track drift: `PartReading = { expect: string|null; now: string|null; unit: string|null; mode: MeterMode|null; verdict: VerdictSignal }`. (C2 adds `unit`/`mode` because the kept Meter needs them to render EXPECT vs NOW; `verdict` uses the SHARED `VerdictSignal` union imported from C3 — NOT a private `'fail'` spelling. See Reconciliation R5/R6.)
- C2 IMPORTS `OverlayKind` from C3 (does not re-declare `OVERLAY_KINDS`). See R4.

### C3 — slot-interface (owner T3) `lib/diagnostics/diagram/slot-interface.ts` (type-only module)

- `SlotName` union: `'source'|'device-under-test'|'ground'|'downstream-anchor'|'overlay'|'gauge'|'good-vs-bad'|'route'|'location'|'detail'|'quiet-field'`. (`'detail'` carries the why/see-source/Operational-Theory prose payload; `'quiet-field'` is the confirm-shape whole-spine backdrop.)
- `StepShape` union (10 v1 shapes): `confirm|electrical-probe|continuity-ground|single-pid|pressure-flow|look-inspect|locate|fork|duty-pwm|voltage-drop`.
- `selectStepShape` SIGNATURE (body in T3): `(observationMethod, meterMode|null, stepKind|null, hasBranches) -> StepShape`. Keys ONLY on these; templates/registry must NOT re-derive from observationMethod.
- `SlotFill` (one of: C2 part-ref+props | wire-set | the single overlay primitive | gauge/Meter payload | a content payload for "detail" | a degraded text-only route arm | null). **Discriminant is `fillKind`** with arms `'part'|'wire-set'|'overlay'|'gauge'|'detail'|'route'|null`; the part arm is FLAT (`{fillKind:'part', partId, kind, name, roleSpecial, tier, provenance, terminals, active, selected}`) — it carries everything `DiagramPartProps` requires (incl. `name`/`active`, resolved by T3 from the focus component + active scenario) so a template renders the part from the scene ALONE, with no topology access. (Wave-0 freeze correction R15.) There is NO `'text'` arm — prose is `DetailSlotFill {fillKind:'detail',...}`, degraded route text is `RouteSlotFill.nextActionText`. (See R2 — this is the single highest-coupling break; T4 builds against THIS verbatim.)
- `VerdictSignal = 'out-of-range'|'branch-fail'|'neutral'` — the ONE scene-level verdict union, exported from C3 and re-used by C2's `PartReading.verdict`. (See R5/R6.)
- `OverlayKind = 'probe-lead'|'voltage-drop-bracket'|'amp-clamp'|'pressure-gauge-tee'|'test-point'|'scope-clip'` — the ONE overlay vocabulary, exported from C3; T2 and T4 import it. (See R4.)
- `ResolvedElement` discriminates on **`elementKind`** (`'part'|'wire'|'terminal'|'overlay'`). (See R3 — the leak test MUST filter on `elementKind`, not `kind`.)
- `ResolvedScene = { shape, slots: Record<SlotName,SlotFill>, activeWireIds, overlay|null, gaugeSpec|null, forkRoute|null, focus:{selectedPartId}, pinsAllowed: boolean, verdict: VerdictSignal, elements: ResolvedElement[] }`. **`verdict` is a TOP-LEVEL field** computed for every shape (even gauge-less look/locate/confirm/fork); `gaugeSpec.verdict` mirrors it. `elements` is the FLAT enumerable rendered set (parts+wires+terminals+overlay) so the leak test asserts deterministically (e.g. `terminals.length===0` on a pressure step). (See R3/R7.)
- `AssembleScene = (topology, step, activeScenario: TopologyScenario | null) => ResolvedScene` — third param is **nullable** (the loader can legitimately have zero scenarios; `computeVerdict` guards null -> neutral). The runtime implementation is exported as **`assembleScene`** from `slot-resolver.ts`; T3 ALSO exports `export const resolveSlots = assembleScene` so the card/T6 verb resolves. INTEGRATION imports the runtime `assembleScene` from `slot-resolver.ts`, NEVER the type from `slot-interface.ts`. (See R1.)
- `StepTemplate = (props: { scene: ResolvedScene; onInspect?: (partId: string) => void; selectedPartId?: string | null }) => ReactNode`. The `onInspect`/`selectedPartId` props are the typed channel for Brandon's KEEP-tap-to-inspect override; T4 templates thread `onInspect` onto each placed element. (See R8.)
- A typed per-shape const table (`SHAPE_SLOT_RULES`) of required/optional/FORBIDDEN slots encoding the hard rule (terminals/overlay ONLY on electrical shapes; pressure-flow forbids electrical slots — `source`/`ground` — but the overlay PRIMITIVE is generic so pressure-flow REQUIRES `overlay` for the gauge-tee; locate suppresses gauge; fork = one route slot). The leak-lock asserts on `source`/`ground` forbidden + `terminals.length`, not on overlay presence.
- No "AI" string, no "step N of M" anywhere.

---

## 3. DEPENDENCY WAVES

```
Wave 0  CONTRACT FREEZE  ── C1 (type) + C2 (type) + C3 (type) + app/globals.css tokens + vitest.config include widen
   │                          (single PR; merges before ANY Wave 1 fork)
   ▼
Wave 1  PARALLEL          ── T1  data deltas (migration + loader surfacing)   [implements C1]
   │                         T2  Figma part kit + export + tokens             [implements C2]
   │                         T3  assembly engine (show-rule + slot-resolver)  [implements C3]
   │                         T4  per-shape layout templates
   │                         T7  step engine (sequence + fork routing)
   ▼
Wave 2  T5  mobile (375px) + Meter bottom-sheet (tap-to-toggle)   [depends T2, T3, T4]
   ▼
Wave 3  T6  app integration / swap (mount assembled diagram; keep tap-to-inspect; whole-system -> existing full view)
   │           [depends T1, T3, T4, T5, T7]
   ▼
Wave 4  INTEGRATION  wire, render the real scene, validate (THE SCALABILITY GATE)   [depends ALL]
```

Wave 1 forks five branches in parallel off the shared feature base, each having already merged Wave 0. They share no files (see §4 exclusive ownership). T4 depends on the C2+C3 type freeze (Wave 0) only, not on T2/T3 runtime — so it forks in parallel and reconciles against the frozen types. T7 is a pure upstream module depending only on the C1 type freeze.

---

## 4. SHARED CONVENTIONS

**Branch / PR model.** Each track is its own branch and its own PR off the SHARED FEATURE BASE (the branch that already contains the merged Wave 0 freeze). No track branches off another track. Wave order is the merge order: a wave's tracks must be merged (or rebased onto each other's merged state) before the next wave forks. T4/T7 build against frozen TYPES, so they may be authored concurrently with T1/T2/T3 and merged in any order within Wave 1.

**Exclusive file ownership (no two tracks edit the same file).**

| Owner | Files |
|---|---|
| Wave 0 | `vitest.config.ts` (include widen + ownership lock), and the type-only skeletons of `lib/diagnostics/load-system-topology.ts` types, `components/diagram-kit/part-api.ts`, `lib/diagnostics/diagram/slot-interface.ts`, `app/globals.css` token block. (Wave 0 hands each module to its Wave 1 owner for the runtime body.) |
| T1 | `lib/diagnostics/load-system-topology.ts` (runtime SELECTs), `lib/db/schema.ts` (2 new columns), `lib/db/migrations/0024_*.sql` + journal entry, related migration test. |
| T2 | `components/diagram-kit/part-api.ts` (runtime), `components/diagram-kit/parts/**`, `components/diagram-kit/overlays/**`, `components/diagram-kit/catalog.tsx`, `app/globals.css` (`--role-*`, `--vt-recede`, `--vt-amber-600` token block), `tests/unit/diagram-kit/**`. |
| T3 | `lib/diagnostics/diagram/slot-interface.ts` (types), `lib/diagnostics/diagram/show-rule.ts`, `lib/diagnostics/diagram/slot-resolver.ts`, `tests/unit/diagram-show-rule.test.ts`, `tests/unit/diagram-slot-resolver.test.ts`. |
| T4 | `components/diagram-kit/templates/**` (all per-shape TSX, `registry.ts`, `slot-box.tsx`, `slot-box-overlay.tsx`, `gauge-region.tsx`, `generic.tsx`, `template-local-types.ts`, `templates.css`), `tests/unit/diagram-templates/**`. |
| T5 | `components/diagram-kit/meter-sheet.tsx`, `components/diagram-kit/diagram-mobile.css`, `tests/unit/diagram-meter-sheet.test.tsx`. |
| T6 | `components/screens/topology-diagnostic.tsx`, `app/curator/topology/page.tsx` (escape-view wiring only), additive `.topo__*` rules in `topology.css`, `tests/unit/topology-diagnostic.test.tsx`. (RETAINS — does not delete — `topology-diagram.tsx`, `topology-flow.ts`, `topology-node.tsx`, `wire-edge.tsx`, `topology-layout.ts`, `topology-selection-context.tsx`, and both `@xyflow`/`@dagrejs` deps; see Brandon overrides.) |
| T7 | `lib/diagnostics/diagram/step-sequence.ts`, `tests/unit/diagram-step-sequence.test.ts`. |
| INTEGRATION | `.design-shots/scene-walk.mjs`, `tests/unit/diagnostic-scene-assembly.test.ts`, generated artifact `.design-shots/out/scene-walk-sheet.png`. READ-ONLY on every other track's files — reports gaps back, never edits. |

`app/globals.css` is T2-owned (token block). T5 CONSUMES `--role-*`/`--vt-*` tokens and never writes globals.css. No other track writes globals.css.

**Drizzle breakpoint-markers + cold-cache pnpm test note.** The hand-written migration `0024` MUST keep the `--> statement-breakpoint` between the two `ALTER`s or the PGlite unit migrator (`tests/helpers/db.ts`) splits wrong and the whole unit suite breaks; T1's migration test exercises this. The journal `when` timestamp is hand-picked to continue the monotonic 0021-0023 sequence. Cold-cache PGlite can emit spurious "PGlite is closed" noise on first run — rerun once and read vitest's exit code directly (no `| tail` masking). The `Set -> Map` swap for `implicatedIds` must remove ALL references to the old symbol (grep gate).

**The deterministic leak test (`ResolvedScene.elements` / `pinsAllowed`).** The single most important invariant. INTEGRATION (`tests/unit/diagnostic-scene-assembly.test.ts`) loops over the CLOSED `StepShape` union and asserts the per-shape forbidden-slot rule from `ResolvedScene.elements`: on a non-electrical shape (`pressure-flow`/`single-pid`/`look-inspect`/`locate`/`confirm`) `elements.filter(e => e.elementKind === 'terminal').length === 0` AND no `source`/`ground` slot fill. **The filter MUST use `e.elementKind`, NOT `e.kind`** (R3) — `kind` is the PartKind value, so a `kind` filter passes vacuously and defeats the whole gate. INTEGRATION MUST also include a POSITIVE CONTROL: an `electrical-probe` scene asserts `terminalCount > 0`, so a wrong accessor fails loud instead of green. `pinsAllowed` mirrors the rule: false on non-electrical shapes, true on electrical.

**The multi-system validation fixtures.** Generality is proven by running the IDENTICAL assertion loop over at least three unlike `SystemTopology` fixtures: (1) the real 6.7L fuel `pressure-flow`/`single-pid` scene, (2) a purely-electrical case (NOx/charging `electrical-probe`/`voltage-drop`), (3) a non-fuel system (`DEF`/PID or air). Synthetic fixtures are fine where real data is not authored (`scene-data.json` is parts-only, no `test_actions`). An UNSEEN kind/observationMethod (`flux-capacitor`/`tachyon_scan`) MUST render via the generic fallback (`elements.length > 0`, no throw). Any system-specific branch in the assembler breaks one of the three. The same trio is independently exercised in T3 Task 10, T4 Task 8, and T7's fixtures so each track proves generality before INTEGRATION.

**Verdict / fork token discipline (R5/R6/R9 — read before wiring T6).** There are three layers and they MUST NOT be conflated:
- **Scene verdict** (`VerdictSignal = 'out-of-range'|'branch-fail'|'neutral'`) — C3-owned, computed once by T3 `computeVerdict`, carried on `ResolvedScene.verdict` AND mirrored on `gaugeSpec.verdict`. C2 `PartReading.verdict` uses this SAME union. This is the ONLY thing that decides red; T3 decides it once, the Meter just renders it.
- **Raw branch verdict** — the free-form string in `branch_logic.verdict` that T7 `resolveFork` matches by exact equality. T7's `ForkVerdict = 'fail'|'pass'|'neutral'` reflects the RAW branch values.
- **The bridge** — T6 maps the raw branch verdict to `resolveFork`, NOT the scene `VerdictSignal`. T6 owns this single mapping point; do not feed `'branch-fail'` into `resolveFork` (it would never equal `'fail'` and the fork would silently vanish). Whether `'fork'` is a distinct scene outcome is resolved as: `'fork'` is NOT a `VerdictSignal` member — INTEGRATION asserts `expect(['branch-fail','fork']).toContain(...)` only against the resolved SHAPE/route, and reads `scene.verdict` for the verdict-honesty check.

**observationMethod slugs (R10).** Before Wave 1 implementation, T1 greps the real `test_actions.observation_method` distinct values (live staging or curator seed) and publishes them; T3 aligns `OBSERVATION_METHODS`/`LOOK_METHODS`/`LOCATE_STEP_KINDS` and T1's fixtures to the actual slugs. Kept as DATA LISTS (not switch arms) so any mismatch is a data fix, not code.

**No-AI / no-step-counter / purity.** No "AI" string, no "step N of M" framing, no `@xyflow`/`dagre`/`fetch`/`loadSystemTopology` import in any draw path (the kit, engine, and templates). Each track ships a static-source purity guard test. The xyflow/dagre RETENTION is confined to the escape "whole system" view (`TopologyDiagram` and its dependencies) — a `grep -r @xyflow` gate that hard-asserts removal would WRONGLY flag T6 and MUST be relaxed per Brandon's override.

---

## 5. RECONCILED CROSS-TRACK FIXES (apply during Wave 0 freeze — already folded into the contracts above)

These are the adversarial findings resolved. Each is a one-or-two-line change made ONCE in Wave 0 so no Wave 1 track forks against a stale shape. Listed here as the authoritative reconciliation; the `crossTrackFixes` in the structured output restate the per-track residual work.

- **R1 (blocker) — assembler runtime name.** ONE runtime entry: `assembleScene` exported from `slot-resolver.ts`, with `export const resolveSlots = assembleScene`. INTEGRATION imports runtime `assembleScene` from `slot-resolver` (not the type from `slot-interface`); T6 imports `assembleScene` (or `resolveSlots`) — not a type. Owners changed: INTEGRATION, T6 (consumers); T3 adds the alias.
- **R2 (blocker) — SlotFill shape.** C3's `fillKind` + FLAT part arm + `detail`/`route` arms is authoritative; there is NO `'text'` arm. T4 rewrites `slot-box.tsx` + all 9 templates + fixtures: `fill.kind` -> `fill.fillKind`; nested `fill.part`/`fill.props` -> flat `fill.{partId,kind,roleSpecial,tier,provenance,terminals,selected}` passed to `resolvePart(fill.kind, fill.roleSpecial)`; `'text'` -> `'detail'` (read `DetailSlotFill` payload) and `RouteSlotFill.nextActionText` for degraded route arms; gauge arm reads `fill.gauge: GaugeSpec`. Owner changed: T4.
- **R3 (blocker) — ResolvedElement discriminant.** `elementKind` is authoritative. T6's leak test AND INTEGRATION's central gate filter `e.elementKind === 'terminal'`. Add a positive-control test (electrical-probe -> terminalCount > 0). Owners changed: T6, INTEGRATION (own test files).
- **R4 (blocker) — OverlayKind vocabulary.** ONE union in C3: `probe-lead`, `voltage-drop-bracket`, `amp-clamp`, `pressure-gauge-tee`, `test-point`, `scope-clip`. T2's `overlay-api.ts` IMPORTS it (drops its own `OVERLAY_KINDS` spellings `voltage-drop`/`pressure-tee`); T4 fixtures replace `drop-bracket`/`gauge-tee` with the canonical names. Owners changed: T2, T4.
- **R5 (blocker) — PartReading shape.** C2 freezes `PartReading = { expect, now, unit, mode, verdict }` (adds `unit`/`mode` for the real Meter). T3 `buildReading` emits EXACTLY these keys (drops `expectText`/`nowText`; maps to `expect`/`now`, supplies `unit`/`mode` from the step's `expectedUnit`/`meterMode`). Owners changed: T2 (add `unit`/`mode`), T3 (rename + drop the `as PartReading` cast).
- **R6 (blocker) — verdict union.** ONE union `VerdictSignal = 'out-of-range'|'branch-fail'|'neutral'` in C3; C2 `PartReading.verdict` re-uses it (drops `'fail'`). `GaugeSpec.reading.verdict` and `GaugeSpec.verdict` are the SAME union and set consistently. Owners changed: T2, T3.
- **R7 (blocker) — top-level scene verdict.** `ResolvedScene.verdict: VerdictSignal` added (computed for every shape, even gauge-less); `gaugeSpec.verdict` mirrors it. INTEGRATION/T5/T6 read `scene.verdict`. Owner changed: T3 (field), consumers align.
- **R8 (blocker) — StepTemplate tap-to-inspect channel.** `StepTemplate = (props:{scene; onInspect?; selectedPartId?}) => ReactNode`. T4 threads `onInspect` onto each placed part (`data-inspect-part-id` + handler). T6 mounts `<Template scene onInspect selectedPartId />` legally. Owners changed: T3 (type), T4 (thread).
- **R9 (major) — fork-token mapping.** Documented in §4 Verdict discipline: T6 feeds the RAW branch verdict to `resolveFork`, never the scene `VerdictSignal`. Owners: T6 (mapping), T3/T7 (doc alignment).
- **R10 (major) — AssembleScene null scenario.** Third param `TopologyScenario | null`; `computeVerdict` guards null -> neutral. Owner changed: T3.
- **R11 (major) — vitest collection.** Wave 0 widens `vitest.config.ts` include to `lib/**/*.test.ts` + `components/**/*.test.{ts,tsx}` + `tests/unit/**`, AND locks ownership to Wave 0. Every track asserts a known test count. T3's specs live at `tests/unit/diagram-show-rule.test.ts` / `tests/unit/diagram-slot-resolver.test.ts` (impl stays under `lib/diagnostics/diagram/`). Owner: Wave 0.
- **R12 (major) — INTEGRATION dead ternary.** The branch-fail test must be `expect(['branch-fail','fork']).toContain(scene.verdict)` — not the `expect(...) ? : ...` form that never runs the else arm. Owner changed: INTEGRATION.
- **R13 (minor) — T3 `__activeWireIds` placeholder.** T3 ships the CLEAN `let activeWireIds: string[] = []` form, NOT the `(slots as any).__activeWireIds` hack. Owner: T3.
- **R14 (minor) — computeVerdict scope.** v1 scopes out-of-range to the focus component's pins; T3 adds a test documenting the limitation + a TODO to widen to ALL walked-scene pins. INTEGRATION verifies against the DEF/charging fixtures (which routinely read out-of-range on source/ground side) and reports back if the scope is too narrow. Owners: T3 (test + TODO), INTEGRATION (verify).

### Brandon's confirmed interaction overrides (override the synthesis where they conflict)

- **KEEP tap-any-shown-part-to-inspect.** The current step drives the default view; the tech can tap any on-screen part to pull its detail. ADAPT `components/topology/topology-selection-context.tsx` into the new diagram — do NOT delete free selection. The synthesis C3 "no free node-click" line is OVERRIDDEN. Structurally enabled by R8 (`StepTemplate.onInspect`) + `DiagramPartProps.selected`/`Terminal.selected` + `ResolvedScene.focus.selectedPartId` + the full `elements` set.
- **"Whole system" button -> the EXISTING full faded-system view** (`<TopologyDiagram>`, xyflow+dagre), not a v1 placeholder. T6 RETAINS all five graph files + both deps behind the escape; the assembled diagram becomes the DEFAULT (that IS the swap). The card's delete-set + dep-removal are intentionally skipped (future escape-rebuild cleanup PR).
- **Mobile reading sheet is TAP-TO-TOGGLE** (peek <-> expanded), not a free-drag sheet. T5's reducer takes NO drag delta as input.

---

## 6. SPEC COVERAGE GAPS (accepted v1 deferrals — recorded, not silent)

- **Scope/waveform.** Spec §3 lists `scope clip` as a primitive and §4 names an electrical waveform/scope test as pins-allowed, but `waveform_capture` degrades to `single-pid` in v1 and the scope-clip glyph is a stub (C2: "NO scope/waveform stub in v1"). This is an ACCEPTED deferral — a scope step renders as `single-pid` (no terminals). Recorded so it is a known non-goal, not a coverage hole. Revisit when real scope `test_actions` are authored.
- **computeVerdict scope (R14).** v1 checks out-of-range against focus-component pins only. Documented limitation with a widen-TODO; INTEGRATION's DEF/charging fixtures are the trip-wire.
- **PartReading vs the real Meter.** The kept Meter is currently proto-meter.html, not yet a React component; its exact prop contract is unverified. C2's `PartReading` (`expect/now/unit/mode/verdict`) is the freeze, but the actual Meter wiring is confirmed at T6 integration — flagged as a STOP-and-reconcile gate, not a silent pass.
- **`scene-data.json` has no `test_actions`.** The full step pipeline (overlays/terminals per step) is validated only via SYNTHETIC `test_action` fixtures in T3/T4/T7/INTEGRATION plus the LIVE seeded route walk. Parts-only coverage is real; step-pipeline-on-real-data coverage is the live-walk + synthetic combo.
- **Live-staging Supabase apply (T1) + live dev server (INTEGRATION walker).** Both are environment-dependent (prod-adjacent write gated on Brandon's per-op approval; merged dev server + live creds for the walker). If access is blocked, the track records an approved-task note and fails loud rather than claiming done. The deterministic vitest half of the gate is hermetic (PGlite) and always runs.

---

## 7. PER-TRACK INDEX

Each track's full task list lives in its own file — NOT re-pasted here. Implement each via the required sub-skill.

| Track | Goal (one line) | Wave | Owned files (summary) | Depends on | Plan |
|---|---|---|---|---|---|
| **T1** | Surface the curated data additively: migration (`step_kind`, `is_out_of_range`) + loader un-drops (4 meter fields, `routesToTestActionId`/`reasoning`, `priority` Set->Map). | 1 | `load-system-topology.ts`, `schema.ts`, `0024_*.sql` + journal, migration test | C1 (Wave 0) | [`2026-06-07-diagram-T1.md`](./2026-06-07-diagram-T1.md) |
| **T2** | Figma part/wire/overlay kit resolved by DATA via a registry with a generic fallback; the `--role-*`/`--vt-*` token block. | 1 | `components/diagram-kit/part-api.ts` + `parts/**` + `overlays/**` + `catalog.tsx`, `app/globals.css` tokens | C2 (Wave 0); C1 type names | [`2026-06-07-diagram-T2.md`](./2026-06-07-diagram-T2.md) |
| **T3** | The assembly engine: `selectStepShape` (show-rule) + `assembleScene` (slot-resolver) + the leak-lock + verdict. | 1 | `slot-interface.ts`, `show-rule.ts`, `slot-resolver.ts`, the two `tests/unit/diagram-*.test.ts` | C3 (Wave 0); C1+C2 type names | [`2026-06-07-diagram-T3.md`](./2026-06-07-diagram-T3.md) |
| **T4** | Per-shape layout templates keyed ONLY on `scene.shape`; structural leak-lock by slot OMISSION; generic fallback template. | 1 | `components/diagram-kit/templates/**`, `tests/unit/diagram-templates/**` | C2+C3 (Wave 0) types | [`2026-06-07-diagram-T4.md`](./2026-06-07-diagram-T4.md) |
| **T7** | React-free step engine: `buildStepSequence` + reducer + `resolveFork` (raw-branch-verdict routing). | 1 | `lib/diagnostics/diagram/step-sequence.ts`, `tests/unit/diagram-step-sequence.test.ts` | C1 (Wave 0) types | [`2026-06-07-diagram-T7.md`](./2026-06-07-diagram-T7.md) |
| **T5** | Mobile 375px layout + Meter bottom-sheet, TAP-TO-TOGGLE (no drag); consumes tokens + `data-shape` seam. | 2 | `components/diagram-kit/meter-sheet.tsx`, `diagram-mobile.css`, its test | T2, T3, T4 | [`2026-06-07-diagram-T5.md`](./2026-06-07-diagram-T5.md) |
| **T6** | App swap: mount the assembled diagram as DEFAULT; KEEP tap-to-inspect; "whole system" -> existing full faded view; zero-step honest degrade. | 3 | `components/screens/topology-diagnostic.tsx`, `page.tsx` wiring, additive `.topo__*` CSS, its test | T1, T3, T4, T5, T7 | [`2026-06-07-diagram-T6.md`](./2026-06-07-diagram-T6.md) |
| **INTEGRATION** | Wire + render the REAL seeded scene; run the deterministic multi-system leak/generality gate; report gaps (read-only on track files). | 4 | `.design-shots/scene-walk.mjs`, `tests/unit/diagnostic-scene-assembly.test.ts`, the contact-sheet artifact | ALL | [`2026-06-07-diagram-INTEGRATION.md`](./2026-06-07-diagram-INTEGRATION.md) |

---

## 8. DEFINITION OF DONE (the gate)

- Wave 0 merged: C1/C2/C3 type-only modules + token block + vitest include widen all land in one PR; R1-R13 reconciliations are baked into the frozen contracts.
- Every track's PR: `pnpm test` green WITH a confirmed non-zero collected test count for that track's specs; its purity/leak/generality tests pass; no "AI" string, no "step N of M", no draw-path `@xyflow`/`fetch`/`loadSystemTopology` import.
- INTEGRATION: the deterministic suite passes the leak-lock (`elementKind==='terminal'` count === 0 on non-electrical shapes + positive control > 0 on electrical) and the identical assertion loop across the fuel + electrical + DEF fixtures; an unseen kind/method renders via fallback (no throw). The live walker produces a contact sheet of the real seeded route showing the assembled diagram, tap-to-inspect affordance present, "whole system" dropping into the existing full view, and the 375px tap-to-toggle sheet — OR a recorded environment-blocked note if live access is unavailable (the hermetic half still passes).
- Brandon eyeballs the first real symbols (T2 §9), the per-shape contact sheet, and the 375px frame.
