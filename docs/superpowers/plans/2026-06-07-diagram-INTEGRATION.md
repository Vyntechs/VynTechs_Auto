# Diagram Rebuild — Track INTEGRATION (Wave 4: wire, render, validate — the scalability gate)

**Date:** 2026-06-07 · **Branch base:** `feat/system-data-ingest` · **Track:** INTEGRATION · **Runs:** LAST (after T1–T7 + T6 merge)

> ⚠️ **CONTRACT AUTHORITY — read before implementing.** The frozen C1/C2/C3 contracts in the **[master plan §2](./2026-06-07-diagnostic-diagram.md)** are the SINGLE SOURCE OF TRUTH. Where any type name, signature, or shape sketched in THIS file disagrees with master §2, **the master wins.** The 2026-06-07 adversarial self-review reconciled ~12 cross-track mismatches into that freeze (R1–R14, master §5). Required deltas for **INTEGRATION**:
> - Import the RUNTIME **`assembleScene` from `slot-resolver.ts`** — NOT the `AssembleScene` TYPE from `slot-interface.ts`. (The code below still CALLS `AssembleScene(...)` as a value; fix the import so the call resolves to the runtime function.) (R1).
> - ✅ **R3 already applied** — the leak filter uses `e.elementKind === 'terminal'` and the electrical-probe test asserts a **positive control** (`terminalCount > 0`).
> - ✅ **R12 already applied** — the dead branch-fail ternary is rewritten to `expect(['branch-fail','fork']).toContain(scene.verdict)`.
> - Read the **top-level `scene.verdict`** (R7).
> - Call `assembleScene` with a **`TopologyScenario | null`** third arg (R10).
> - Verify the focus-only `computeVerdict` scope against the DEF/charging fixtures; **report back** if out-of-range pins on source/ground are missed (R14).

## Goal

Prove the rebuilt diagram chain — `loadSystemTopology` (C1) → step engine (T7) → assembler (T3 `AssembleScene`) → templates (T4) → parts (C2) → mobile (T5), landed in the live screen by T6 — actually holds **the scalability bar** on the real 2018 F-250 6.7L Power Stroke P0087 scene **and** on unlike systems, at desktop **and** 375px. Two artifacts:

1. A **live-route walker** (`.design-shots/scene-walk.mjs`, forked from `sheet.mjs` + `cap-meter-walk.mjs`) that signs in, walks the P0087 step sequence on `/curator/topology`, and composes one contact sheet of desktop + 375px frames per step with console-error capture.
2. A **deterministic invariant test** (`tests/unit/diagnostic-scene-assembly.test.ts`) that feeds a loaded `SystemTopology` + synthetic `test_actions` through `AssembleScene` and asserts the leak/provenance/no-AI/zero-per-case invariants from `ResolvedScene.elements` per `StepShape` — and proves generality across fuel + a purely-electrical case + one non-fuel (DEF/charging/air) synthetic fixture.

The track is the **gate, not a participant**: it is READ-ONLY on every other track's files. Any required change is **reported back to the owning track in the text validation report**, never edited here.

## Architecture / how it fits the bar

- **Validation is itself vocabulary-driven.** The invariant test does NOT enumerate "the P0087 fuel parts." It loops over the **closed `StepShape` union** and asserts the per-shape forbidden-slot rule (C3's table) from `ResolvedScene.elements` — so a new system that produces those same shapes is covered with zero new assertions. The only per-case literals allowed anywhere in this track are *fixture inputs* (synthetic component/test_action rows), never branching in the assertions.
- **Generality is proven, not assumed.** The test runs the SAME assertions over three unlike `SystemTopology` fixtures: the real fuel scene (from the DB seed via the loader), a purely-electrical synthetic case, and one non-fuel synthetic case. If the assembler had any system-specific branch, one of the three breaks.
- **Honest degrade is asserted as CORRECT.** Null `electricalRole`/`fromPinId`, 9 pins, empty `expectedValue` on today's data yield neutral verdicts + empty source/ground — the test asserts that as the intended state, never flags it as a bug.
- **No-AI / zero-per-case are grep invariants**, run as part of the report, over the draw path (`components/diagram-kit/**`, `lib/diagnostics/diagram/**`).

## What it CONSUMES (contracts — verbatim names)

- **C1** (`lib/diagnostics/load-system-topology.ts`): `loadSystemTopology`, `SystemTopology`, `TopologyComponent`, `TopologyConnection`, `TopologyTestAction`, `TopologyBranch`, `TopologyScenario`, `TopologyPin`, `MeterMode`. Additive fields consumed in fixtures: `TopologyTestAction.meterMode`, `.expectedValue`, `.expectedUnit`, `.expectedTolerance`, `.stepKind`, `.priority`; `TopologyBranch.routesToTestActionId`, `.reasoning`; `TopologyScenario.isOutOfRange`.
- **C3** (`lib/diagnostics/diagram/slot-interface.ts`): `AssembleScene`, `ResolvedScene`, `ResolvedElement`, `SlotName`, `StepShape`, `SlotFill`. From `show-rule.ts` (T3): `selectStepShape`. From T7 (`lib/diagnostics/diagram/step-sequence.ts`): `buildStepSequence`.
- **C2** (`components/diagram-kit/part-api.ts`): consumed transitively through `ResolvedScene.elements`; this track asserts on `ResolvedElement` shape only (no direct part import needed for the invariant test).
- The live screen produced by **T6** at route `/curator/topology` (consumed only by the walker over HTTP).

## What it PRODUCES / exclusively-owned files

- `.design-shots/scene-walk.mjs` — the live-route step-walker + contact-sheet composer (375 hard gate).
- `.design-shots/out/scene-walk-sheet.png` — the produced contact sheet (generated artifact, committed).
- `tests/unit/diagnostic-scene-assembly.test.ts` — the deterministic invariant + generality test.
- The **validation report** — returned as TEXT in the final handoff message, NOT a committed `.md`.

**Owns nothing else. READ-ONLY on all T1–T7 files.** If a contract name differs from what is pinned here, STOP and report it — do not adapt by editing another track.

---

## TASK 1 — Invariant scaffold: AssembleScene typechecks + enumerates elements

Stand up the deterministic test file against the real C1 loader + C3 assembler, proving `AssembleScene` returns a `ResolvedScene` whose `elements` is a flat enumerable array. This is the smallest possible red→green that wires C1→C3 in a unit test.

**Files**
- create + test: `tests/unit/diagnostic-scene-assembly.test.ts`
- read-only deps: `lib/diagnostics/diagram/slot-interface.ts` (C3), `lib/diagnostics/diagram/show-rule.ts` (T3), `lib/diagnostics/load-system-topology.ts` (C1), `tests/helpers/db.ts`

### Step 1.1 — Failing test: the assembler yields an enumerable element set

Write the test. It seeds a minimal one-component fuel topology in PGlite, loads it, builds a synthetic implicated `TopologyTestAction` (since `scene-data.json` and the seed carry no `test_actions` wired for the step pipeline), and asserts `AssembleScene` returns `elements` as an array.

```ts
// tests/unit/diagnostic-scene-assembly.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb, type TestDb } from '@/tests/helpers/db'
import { platforms, symptoms, components } from '@/lib/db/schema'
import {
  loadSystemTopology,
  type SystemTopology,
  type TopologyTestAction,
} from '@/lib/diagnostics/load-system-topology'
import { AssembleScene } from '@/lib/diagnostics/diagram/slot-interface'

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

/** A synthetic step in the C1 vocabulary — not tied to any one system. */
function syntheticStep(over: Partial<TopologyTestAction> = {}): TopologyTestAction {
  return {
    slug: 'synthetic-step',
    description: 'synthetic step',
    scenarioRequired: 'key-on-engine-off',
    observationMethod: 'pressure_test_with_gauge',
    expectedObservation: null,
    invasiveness: 1,
    implicatedByCurrentSymptom: true,
    branches: [],
    meterMode: null,
    expectedValue: null,
    expectedUnit: null,
    expectedTolerance: null,
    stepKind: null,
    priority: 1,
    ...over,
  }
}

async function seedMinimalFuelTopology(): Promise<SystemTopology> {
  const [p] = await db
    .insert(platforms)
    .values({
      slug: 'ford-super-duty-4th-gen-67-psd',
      yearRange: '2017-2022',
      parentMake: 'Ford',
      parentModelFamily: 'Super Duty',
      generation: '4th Gen',
    })
    .returning({ id: platforms.id })
  await db.insert(symptoms).values({
    slug: 'p0087-fuel-rail-pressure-too-low',
    system: 'fuel',
    category: 'dtc',
    description: 'P0087 low rail pressure',
  })
  await db.insert(components).values({
    platformId: p.id,
    slug: 'cp4-pump',
    name: 'CP4.2 Pump',
    kind: 'pump',
    systems: ['fuel'],
    sourceProvenance: 'drafted',
  })
  const topo = await loadSystemTopology({
    db,
    platformSlug: 'ford-super-duty-4th-gen-67-psd',
    symptomSlug: 'p0087-fuel-rail-pressure-too-low',
  })
  if (!topo) throw new Error('seed produced null topology')
  return topo
}

describe('diagnostic scene assembly — invariant gate', () => {
  it('AssembleScene returns a flat enumerable element set', async () => {
    const topo = await seedMinimalFuelTopology()
    const focus = topo.components[0]
    const step = syntheticStep()
    const scene = AssembleScene(topo, step, topo.scenarios[0] ?? null)
    expect(Array.isArray(scene.elements)).toBe(true)
    expect(scene.focus.selectedPartId).toBe(focus.id)
  })
})
```

### Step 1.2 — Run it, expect FAIL

```bash
pnpm vitest run tests/unit/diagnostic-scene-assembly.test.ts
```
Expected FAIL: until T1+T3 land, this fails on import resolution (`AssembleScene` / additive C1 field types not exported) or on the assert. That is the correct red — INTEGRATION runs LAST, so on the merged tree this should go green with NO production edits.

### Step 1.3 — Make it pass WITHOUT editing other tracks

There is no implementation step here — the gate must pass against merged T1/T3 code. If it fails because a contract member is missing/misnamed, DO NOT patch another track's file. Instead record the gap verbatim in the validation report (Task 6) and stop. Only fix THIS file (e.g. a wrong import path) if the cause is local to the test.

Confirm green:
```bash
pnpm vitest run tests/unit/diagnostic-scene-assembly.test.ts
```
Expected PASS.

### Step 1.4 — Commit

```bash
git add tests/unit/diagnostic-scene-assembly.test.ts
git commit -m "test(diagram): INTEGRATION invariant scaffold — AssembleScene enumerable elements

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## TASK 2 — Leak invariant: forbidden slots per StepShape from ResolvedScene.elements

The core gate. Loop over the closed `StepShape` union; for the non-electrical shapes (`pressure-flow`, `single-pid`, `look-inspect`, `locate`, `confirm`) assert `ResolvedScene.elements` contains ZERO terminal elements; for `fork` assert exactly one route arm. Vocabulary-driven — no per-system literals in the assertions.

**Files**
- modify + test: `tests/unit/diagnostic-scene-assembly.test.ts`
- read-only deps: `lib/diagnostics/diagram/slot-interface.ts` (`StepShape`, `ResolvedElement`), `lib/diagnostics/diagram/show-rule.ts` (`selectStepShape`)

### Step 2.1 — Failing test: pressure / PID / look / locate / confirm leak no terminals

Add to the file. `elements` is the flat set of parts+wires+terminals+overlay; a terminal element is identified by `elementKind === 'terminal'` on `ResolvedElement` (C3 contract — the discriminant is `elementKind`, NOT `kind`; `kind` is the PartKind value, so filtering on `kind` passes VACUOUSLY and defeats the entire leak gate. See master §2 C3 / R3). The test drives each shape via a synthetic step whose `observationMethod`/`meterMode`/`stepKind` makes `selectStepShape` pick that shape, so we never hardcode the shape behind the engine's back.

```ts
// append to tests/unit/diagnostic-scene-assembly.test.ts
import { selectStepShape } from '@/lib/diagnostics/diagram/show-rule'
import type { StepShape, ResolvedElement } from '@/lib/diagnostics/diagram/slot-interface'

const terminalCount = (els: ResolvedElement[]) =>
  els.filter((e) => e.elementKind === 'terminal').length

/** Inputs that deterministically drive selectStepShape to each non-electrical shape. */
const NON_ELECTRICAL_DRIVERS: Array<{
  shape: Extract<StepShape, 'pressure-flow' | 'single-pid' | 'look-inspect' | 'locate' | 'confirm'>
  step: Partial<TopologyTestAction>
}> = [
  { shape: 'pressure-flow', step: { observationMethod: 'pressure_test_with_gauge' } },
  { shape: 'single-pid', step: { observationMethod: 'scan_tool_pid' } },
  { shape: 'look-inspect', step: { observationMethod: 'direct_visual_inspection' } },
  { shape: 'locate', step: { observationMethod: 'direct_visual_inspection', stepKind: 'locate' } },
  { shape: 'confirm', step: { observationMethod: 'symptom_confirmation' } },
]

describe('diagnostic scene assembly — leak invariant (per StepShape)', () => {
  it.each(NON_ELECTRICAL_DRIVERS)(
    'shape $shape renders ZERO terminals (no 12V/GND leak)',
    async ({ shape, step }) => {
      const topo = await seedMinimalFuelTopology()
      const ta = syntheticStep(step)
      // Guard: the engine must actually classify this step as the shape we test.
      const resolved = selectStepShape(
        ta.observationMethod,
        ta.meterMode,
        ta.stepKind,
        ta.branches.length > 0,
      )
      expect(resolved).toBe(shape)
      const scene = AssembleScene(topo, ta, topo.scenarios[0] ?? null)
      expect(scene.shape).toBe(shape)
      expect(terminalCount(scene.elements)).toBe(0)
      expect(scene.pinsAllowed).toBe(false)
    },
  )

  it('electrical-probe is the ONLY shape allowed terminals', async () => {
    const topo = await seedMinimalFuelTopology()
    const ta = syntheticStep({
      observationMethod: 'electrical_measurement_at_pin',
      meterMode: 'volts',
    })
    const scene = AssembleScene(topo, ta, topo.scenarios[0] ?? null)
    expect(scene.shape).toBe('electrical-probe')
    expect(scene.pinsAllowed).toBe(true)
    // POSITIVE CONTROL (R3): an electrical shape MUST yield terminals. Without this,
    // a broken `terminalCount` accessor (e.g. filtering on `kind` not `elementKind`)
    // would pass every leak assertion VACUOUSLY. This makes a wrong accessor fail loud.
    expect(terminalCount(scene.elements)).toBeGreaterThan(0)
  })

  it('fork emits exactly one route arm', async () => {
    const topo = await seedMinimalFuelTopology()
    const ta = syntheticStep({
      observationMethod: 'scan_tool_pid',
      branches: [
        { condition: 'low', verdict: 'fail', nextAction: 'inspect pump',
          routesToTestActionId: null, reasoning: null },
      ],
    })
    const scene = AssembleScene(topo, ta, topo.scenarios[0] ?? null)
    expect(scene.shape).toBe('fork')
    expect(scene.forkRoute).not.toBeNull()
  })
})
```

### Step 2.2 — Run it, expect FAIL (then PASS on merged tree)

```bash
pnpm vitest run tests/unit/diagnostic-scene-assembly.test.ts
```
Expected FAIL first run (engine not yet merged or a real leak). On a merged-correct tree it PASSES. A genuine `terminalCount > 0` on `pressure-flow` is a **T3 (or T4) leak bug → report it, do not patch here.**

### Step 2.3 — Commit (test-only)

```bash
git add tests/unit/diagnostic-scene-assembly.test.ts
git commit -m "test(diagram): leak invariant — zero terminals on non-electrical shapes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## TASK 3 — Generality: same assertions across fuel + electrical + one non-fuel system

Prove the bar's core claim: the leak invariant holds on **three unlike `SystemTopology` fixtures** with the SAME assertion loop. Fuel = the seeded real-ish scene; electrical = a purely-electrical synthetic case; non-fuel = a DEF (or charging/air) synthetic case. No per-system branch in the test body — only the fixture data differs.

**Files**
- modify + test: `tests/unit/diagnostic-scene-assembly.test.ts`
- read-only deps: C1 types only

### Step 3.1 — Failing test: parametrize the leak invariant over three systems

Add synthetic builders that produce a `SystemTopology` directly (no DB needed for the electrical/non-fuel cases — they are pure C1-shaped objects), then run the non-electrical leak loop over all three.

```ts
// append to tests/unit/diagnostic-scene-assembly.test.ts
import type { TopologyComponent } from '@/lib/diagnostics/load-system-topology'

function component(over: Partial<TopologyComponent>): TopologyComponent {
  return {
    id: over.id ?? 'c1',
    slug: over.slug ?? 'c1',
    name: over.name ?? 'Part',
    kind: over.kind ?? 'sensor',
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
    testActions: [],
    pins: [],
    ...over,
  }
}

/** A C1-shaped topology in any system — fixture input only, no branching. */
function syntheticTopology(system: string, focus: TopologyComponent): SystemTopology {
  return {
    platform: { slug: 'synthetic', name: 'Synthetic Platform' },
    symptom: { slug: `${system}-fault`, description: `${system} fault` },
    system,
    components: [focus],
    connections: [],
    scenarios: [],
    dataStatus: null,
    lastScenarioSlug: null,
  }
}

describe('diagnostic scene assembly — generality across unlike systems', () => {
  const SYSTEMS: Array<{ label: string; topo: () => SystemTopology }> = [
    { label: 'electrical (NOx sensor circuit)', topo: () =>
        syntheticTopology('emissions', component({ id: 'nox', slug: 'nox', kind: 'sensor' })) },
    { label: 'non-fuel (DEF dosing line)', topo: () =>
        syntheticTopology('def', component({ id: 'def-inj', slug: 'def-inj', kind: 'actuator' })) },
  ]

  it.each(SYSTEMS)('$label: pressure step leaks zero terminals', ({ topo }) => {
    const t = topo()
    const ta = syntheticStep({ observationMethod: 'pressure_test_with_gauge' })
    const scene = AssembleScene(t, ta, null)
    expect(terminalCount(scene.elements)).toBe(0)
    expect(scene.pinsAllowed).toBe(false)
  })

  it.each(SYSTEMS)('$label: look step renders no wires/pins', ({ topo }) => {
    const t = topo()
    const ta = syntheticStep({ observationMethod: 'direct_visual_inspection' })
    const scene = AssembleScene(t, ta, null)
    expect(scene.activeWireIds).toEqual([])
    expect(terminalCount(scene.elements)).toBe(0)
  })
})
```

### Step 3.2 — Run, expect FAIL→PASS on merged tree

```bash
pnpm vitest run tests/unit/diagnostic-scene-assembly.test.ts
```
A failure on ONE of the three systems = the assembler has a system-specific branch → **report to T3**, do not patch.

### Step 3.3 — Commit

```bash
git add tests/unit/diagnostic-scene-assembly.test.ts
git commit -m "test(diagram): generality — leak invariant holds on fuel + electrical + DEF

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## TASK 4 — Provenance honesty + fallback + unseen-vocab degrade

Assert the three-color discipline as PURE DATA: nothing carries a `fail`/red verdict unless `isOutOfRange` is true OR a branch `verdict==='fail'`; default is neutral (graphite). And an UNSEEN `kind`/`observationMethod` renders via the generic fallback — never empty `elements`, never throw.

**Files**
- modify + test: `tests/unit/diagnostic-scene-assembly.test.ts`
- read-only deps: C1 (`TopologyScenario.isOutOfRange`, `TopologyBranch.verdict`), C3 (`ResolvedScene`)

### Step 4.1 — Failing test: verdict precedence + fallback never blank/crash

```ts
// append to tests/unit/diagnostic-scene-assembly.test.ts
describe('diagnostic scene assembly — provenance & verdict honesty', () => {
  it('neutral by default — no red without isOutOfRange or branch fail', async () => {
    const topo = await seedMinimalFuelTopology()
    const ta = syntheticStep({ observationMethod: 'scan_tool_pid', branches: [] })
    const scene = AssembleScene(topo, ta, topo.scenarios[0] ?? null)
    // verdict signal lives on the scene as pure data, not a color.
    expect(scene.verdict).toBe('neutral')
  })

  it('out-of-range scenario flips the verdict to out-of-range', () => {
    const focus = component({ id: 'frp', slug: 'frp', kind: 'sensor',
      pins: [{ id: 'p1', slug: 'sig', name: 'SIG', roleAbbreviation: 'SIG',
        pinNumber: '1', edge: 'right', displayOrder: 0, probeLocation: '',
        expectedReading: '', missingLogic: '', labelGap: null, sourceProvenance: 'drafted' }] })
    const t = syntheticTopology('fuel', focus)
    t.scenarios = [{
      id: 's1', slug: 'koeo', label: 'KOEO', sub: '', kind: 'fault',
      keyPosition: 'on', engineState: 'off', loadLevel: null, isDefault: true,
      displayOrder: 0, pinStates: {}, pinReadings: { p1: 'low' },
      isOutOfRange: { p1: true },
    }]
    const ta = syntheticStep({ observationMethod: 'electrical_measurement_at_pin', meterMode: 'volts' })
    const scene = AssembleScene(t, ta, t.scenarios[0])
    expect(scene.verdict).toBe('out-of-range')
  })

  it('branch verdict==="fail" flips the verdict without out-of-range', async () => {
    const topo = await seedMinimalFuelTopology()
    const ta = syntheticStep({
      observationMethod: 'scan_tool_pid',
      branches: [{ condition: 'x', verdict: 'fail', nextAction: 'replace',
        routesToTestActionId: null, reasoning: null }],
    })
    const scene = AssembleScene(topo, ta, topo.scenarios[0] ?? null)
    // R12: the previous `expect(...) ? : ...` form evaluated expect()'s (truthy)
    // return and NEVER ran the else arm — a dead assertion. A real disjunction:
    expect(['branch-fail', 'fork']).toContain(scene.verdict)
  })

  it('UNSEEN kind + observationMethod render via fallback — never blank, never throw', () => {
    const focus = component({ id: 'x', slug: 'x', kind: 'flux-capacitor' })
    const t = syntheticTopology('warp', focus)
    const ta = syntheticStep({ observationMethod: 'tachyon_scan_never_seen' })
    let scene: ReturnType<typeof AssembleScene> | null = null
    expect(() => { scene = AssembleScene(t, ta, null) }).not.toThrow()
    expect(scene!.elements.length).toBeGreaterThan(0)
    expect(scene!.focus.selectedPartId).toBe('x')
  })
})
```

> NOTE: the branch-fail assertion tolerates either a `branch-fail` verdict or the `fork` shape (a branched PID may resolve to `fork`); both are honest non-fabricated outcomes. If neither holds, that is a real T3 verdict-precedence gap → report.

### Step 4.2 — Run, expect FAIL→PASS

```bash
pnpm vitest run tests/unit/diagnostic-scene-assembly.test.ts
```

### Step 4.3 — Commit

```bash
git add tests/unit/diagnostic-scene-assembly.test.ts
git commit -m "test(diagram): provenance honesty + unseen-vocab fallback never blank/crash

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## TASK 5 — Live-route walker: scene-walk.mjs (375 hard gate + console-error capture)

Fork `sheet.mjs` (Supabase sign-in + cookie + contact sheet) and `cap-meter-walk.mjs` (per-step walk + per-frame error capture). Drive the LIVE `/curator/topology` route (scene-data.json is parts-only and insufficient for the step pipeline), stepping the P0087 sequence via the screen's advance control, capturing desktop (1440) + **375** frames per step into one contact sheet.

**Files**
- create: `.design-shots/scene-walk.mjs`
- generated artifact: `.design-shots/out/scene-walk-sheet.png`
- read-only refs: `.design-shots/sheet.mjs`, `.design-shots/cap-meter-walk.mjs`, the T6 screen (over HTTP)

### Step 5.1 — Write the walker

It reuses `sheet.mjs`'s `loadEnvLocal` + `buildAuthCookie` verbatim (proven), uses `cap-meter-walk.mjs`'s per-frame error listeners + contact-sheet composer, and adds the **375** viewport `sheet.mjs` lacks. The advance control is the T6-owned silent "next" affordance; the walker clicks it by a stable role/text selector and stops when no further advance is possible (zero-step / end-of-sequence both terminate cleanly).

```js
// .design-shots/scene-walk.mjs
// INTEGRATION live-route walker. Signs in (sheet.mjs cookie), walks the P0087
// step sequence on the LIVE /curator/topology route at 1440 + 375, captures a
// frame + console errors per step, composes ONE contact sheet. 375 is the HARD gate.
// Usage: node .design-shots/scene-walk.mjs   (BASE=http://localhost:3210 default)
import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import * as fs from 'node:fs'
import * as path from 'node:path'

const BASE = process.env.BASE || 'http://localhost:3210'
const OUT_DIR = path.resolve(process.cwd(), '.design-shots/out')
const ROUTE = '/curator/topology?symptom=p0087-fuel-rail-pressure-too-low'
const SECOND = '/curator/topology?symptom=no-start-cranks-normally-fuel-system-suspect'
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile-375', width: 375, height: 812 }, // HARD gate; sheet.mjs only did 390
]
const MAX_STEPS = 12

function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
    }
  }
}

async function buildAuthCookie() {
  const email = process.env.TEST_USER_EMAIL
  const password = process.env.TEST_USER_PASSWORD
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!email || !password || !url || !anon) {
    throw new Error('Missing TEST_USER_EMAIL/PASSWORD or SUPABASE url/anon in .env.local')
  }
  const supabase = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`signInWithPassword failed: ${error.message}`)
  const ref = url.match(/^https?:\/\/([^.]+)\./)[1]
  return {
    name: `sb-${ref}-auth-token`,
    value: 'base64-' + Buffer.from(JSON.stringify(data.session)).toString('base64'),
    domain: 'localhost', path: '/', httpOnly: false, secure: false, sameSite: 'Lax',
  }
}

// Advance through the silent step control until it is gone/disabled.
async function walkRoute(browser, cookie, route, label, cells, allErrs) {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2 })
    await ctx.addCookies([cookie])
    const page = await ctx.newPage()
    const errs = []
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()) })
    page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message))
    try {
      await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 45000 })
      await page.waitForTimeout(1500)
    } catch (e) {
      errs.push(`GOTO ${e.message}`)
    }
    const snap = async (n) => {
      const f = path.join(OUT_DIR, `walk_${label}_${vp.name}_step${n}.png`)
      await page.screenshot({ path: f })
      cells.push({ label: `${label} · ${vp.name} · step ${n}`, file: f })
    }
    let n = 1
    await snap(n)
    // The advance control is T6-owned and silent (no "step N of M").
    const advance = page.getByRole('button', { name: /next|advance|continue/i })
    while (n < MAX_STEPS) {
      const visible = await advance.first().isVisible().catch(() => false)
      const enabled = visible && (await advance.first().isEnabled().catch(() => false))
      if (!enabled) break
      await advance.first().click().catch(() => {})
      await page.waitForTimeout(900)
      n += 1
      await snap(n)
    }
    if (errs.length) allErrs.push(`${label}/${vp.name}: ` + errs.slice(0, 8).join(' | '))
    console.log(`${label} ${vp.name}: ${n} steps · consoleErrors=${errs.length}`)
    await ctx.close()
  }
}

async function main() {
  loadEnvLocal()
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const cookie = await buildAuthCookie()
  const browser = await chromium.launch()
  const cells = []
  const allErrs = []
  await walkRoute(browser, cookie, ROUTE, 'P0087', cells, allErrs)
  await walkRoute(browser, cookie, SECOND, 'no-start', cells, allErrs) // second seeded symptom

  const sp = await (await browser.newContext({ viewport: { width: 2200, height: 1400 } })).newPage()
  const html = `<html><body style="margin:0;background:#0b0b0c;font-family:ui-monospace,monospace;padding:16px">
    <div style="color:#9aa;font:600 12px ui-monospace;padding:0 0 12px">SCENE walk — ${cells.length} frames · console errors: ${allErrs.length ? allErrs.join('  ||  ') : 'NONE'}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
    ${cells.map((c) => {
      const b64 = fs.readFileSync(c.file).toString('base64')
      return `<div style="background:#161618;border:1px solid #2a2a2e;border-radius:8px;overflow:hidden">
        <div style="color:#e6e6e6;font-size:12px;padding:7px 10px;border-bottom:1px solid #2a2a2e">${c.label}</div>
        <img src="data:image/png;base64,${b64}" style="width:100%;display:block"/></div>`
    }).join('')}
    </div></body></html>`
  await sp.setContent(html, { waitUntil: 'networkidle' })
  await sp.waitForTimeout(400)
  const out = path.join(OUT_DIR, 'scene-walk-sheet.png')
  await sp.screenshot({ path: out, fullPage: true })
  await browser.close()
  console.log(`\nCONTACT SHEET: ${out}`)
  console.log(allErrs.length ? `CONSOLE ERRORS:\n${allErrs.join('\n')}` : 'NO CONSOLE ERRORS')
  if (allErrs.length) process.exitCode = 1 // 375/desktop console errors fail the gate
}
main().catch((e) => { console.error(e); process.exit(1) })
```

### Step 5.2 — Run the walker against the live dev server, expect a clean sheet

Assumes T6's merged screen is running on `BASE`. From a separate shell start `pnpm dev` (or point `BASE` at the running instance), then:
```bash
node .design-shots/scene-walk.mjs
```
Expected: prints `NO CONSOLE ERRORS`, exit 0, and writes `.design-shots/out/scene-walk-sheet.png`. If it prints console errors / nonzero exit, that is a **T6/T2/T4/T5 runtime gap → report**, do not patch.

### Step 5.3 — Judge the contact sheet as a user

```bash
open .design-shots/out/scene-walk-sheet.png
```
Read every cell: only the current step's parts present (no `12V`/`GND` on the pressure step), 375 reads clean with no horizontal overflow, the device-under-test stays above the sheet at peek, no `step N of M`, no "AI" word. Capture findings for the report (Task 6). Any visual leak/overflow → report to the owning track.

### Step 5.4 — Commit walker + sheet

```bash
git add .design-shots/scene-walk.mjs .design-shots/out/scene-walk-sheet.png
git commit -m "test(diagram): INTEGRATION live-route walker + P0087 contact sheet (1440 + 375)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## TASK 6 — Grep proofs + reduced-motion frame + the text validation report

Run the no-AI / zero-per-case grep proofs over the draw path, capture a reduced-motion frame, run the full invariant suite cold, and assemble the **text** validation report (NOT a committed `.md`). This task produces no committed file beyond what Tasks 1–5 already created; its output is the handoff message.

**Files**
- read-only: `components/diagram-kit/**`, `lib/diagnostics/diagram/**` (grep targets)
- modify (only if reduced-motion needs a flag): `.design-shots/scene-walk.mjs` (own file)

### Step 6.1 — Grep proof: no AI in the draw path

```bash
grep -rniE "anthropic|@anthropic|aiClient|generateText|callModel|\"AI\"|'AI'" components/diagram-kit lib/diagnostics/diagram || echo "CLEAN: no AI in draw path"
```
Expected: `CLEAN`. Any hit is a hard gate failure → report to the owning track. (The word "AI" must also not appear in any captured frame — verified visually in Task 5.3.)

### Step 6.2 — Grep proof: zero per-case / per-system literals in kit + engine

```bash
grep -rniE "p0087|no-start|cp4|6\.7|power *stroke|f-?250|ford|fuel-rail|def|scr|nox" components/diagram-kit lib/diagnostics/diagram || echo "CLEAN: no per-case/per-system literals"
```
Expected: `CLEAN` (vocabulary enums like `'fuel'`/`'def'` as scenario *values* are data, not branches — but they must NOT appear as `if (system === ...)` switches; eyeball any hit). A literal driving a code branch is a bar violation → report.

### Step 6.3 — Grep proof: no "step N of M" surface text

```bash
grep -rniE "step [0-9]+ of|of [0-9]+ steps|step \$\{" components/diagram-kit components/screens/topology-diagnostic.tsx || echo "CLEAN: no step N of M"
```
Expected: `CLEAN`.

### Step 6.4 — Reduced-motion frame

Capture one frame under `prefers-reduced-motion: reduce` to prove animated parts/sheet gate honestly. Add a one-shot flag path to the walker's own context (this edits ONLY `.design-shots/scene-walk.mjs`):

```bash
RM=1 node -e "process.env.RM && console.log('reduced-motion capture run')"
```
Then run the walker with the reduced-motion context (the walker reads `process.env.RM` and passes `reducedMotion: 'reduce'` to `newContext`). Confirm the frame renders identically minus motion, no errors.

> Implementation note for the walker edit: in `walkRoute`, when `process.env.RM` is set, pass `reducedMotion: 'reduce'` to `browser.newContext(...)` and suffix the frame label with `· reduced-motion`. This is the ONLY allowed edit in this task and only to this track's own file.

### Step 6.5 — Full invariant suite, cold cache (not tail-masked)

```bash
pnpm vitest run tests/unit/diagnostic-scene-assembly.test.ts
```
Run it twice (cold-cache caveat). Expected: all green, full output read (never `| tail`).

### Step 6.6 — Assemble + return the text validation report

Produce the report as the final handoff TEXT (do NOT write a `.md`). It MUST cover, with verdicts:
- **Leak check** — deterministic (terminals.length===0 on pressure/PID/look/locate/confirm from `ResolvedScene.elements`) AND visual (contact sheet), per shape.
- **Provenance honesty** — nothing red unless `isOutOfRange` OR branch `verdict==='fail'`; amber only from `labelGap`/`electricalContract`; default graphite.
- **No-AI** — grep result (Step 6.1) verbatim.
- **Zero per-case/per-system** — grep result (Step 6.2/6.3) verbatim.
- **375 mobile pass** — device-under-test above the sheet at peek, no overflow, ≥48px targets (visual).
- **Reduced-motion frame** — captured, clean.
- **Second-seeded-symptom pass** — the no-start walk frames.
- **Generality** — fuel + electrical + DEF invariant all green (Task 3).
- **Honest degrade validated as CORRECT** — null roles → qualitative bands + neutral verdicts, flagged as intended, not a bug.
- **Gaps → owning track** — every failure attributed to T1/T2/T3/T4/T5/T6/T7 with the exact assertion/frame, NEVER patched here.

### Step 6.7 — Commit any walker reduced-motion edit (if made)

```bash
git add .design-shots/scene-walk.mjs
git commit -m "test(diagram): reduced-motion capture path in scene-walk

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Cross-track contract assumptions (must hold; mismatch → STOP + report, never adapt)

- C3 exports `AssembleScene(topology, step, activeScenario) => ResolvedScene` and `ResolvedScene` has `{ shape, elements, activeWireIds, forkRoute, focus:{selectedPartId}, pinsAllowed, verdict }`.
- `ResolvedElement` has a discriminant `kind` with a `'terminal'` member (the leak assertion's hook). **If C3 names this field/value differently, that is the only thing to reconcile — by reading C3 and report, not editing C3.**
- `ResolvedScene.verdict` is a pure-data union `'out-of-range' | 'branch-fail' | 'neutral'` (+ possibly `'fork'`); INTEGRATION asserts on it, never colors anything.
- `selectStepShape(observationMethod, meterMode, stepKind, hasBranches) => StepShape` (T3) drives the test's shape selection so the test never hardcodes shape behind the engine.
- C1 additive fields (`meterMode`, `expectedValue`, `expectedUnit`, `expectedTolerance`, `stepKind`, `priority`, `routesToTestActionId`, `reasoning`, `TopologyScenario.isOutOfRange`) are all present (T1 merged) — fixtures populate them.
- T6's advance control exposes an accessible button matched by `/next|advance|continue/i` and emits no "step N of M". If the accessible name differs, update the walker selector (own file) — that is a permitted local fix.
