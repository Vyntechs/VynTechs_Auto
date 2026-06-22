# Diagnostic Loop (Fuel-Rail) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the frozen topology screen into a live diagnostic *loop* on the seeded fuel-rail flow (P0087/P0088, 2017–22 Ford 6.7 PSD): tech enters a reading → engine derives a verdict → the check is recorded for real → confidence ticks up from that confirmed check → engine routes to the next highest-yield check → honest verdict with its story, or an honest hand-off.

**Architecture:** Half the engine already exists, unwired (`buildStepSequence`, `stepReducer`, `resolveFork`, `selectCurrentStep` in `lib/diagnostics/diagram/step-sequence.ts`). The screen `components/screens/topology-diagnostic.tsx` renders only step 0, static. We (1) fix three routing/data-integrity bugs that would make the "honest loop" silently mis-route, (2) add the small net-new pieces (reading entry, `verdictFromReading`, a record-check endpoint, a confidence accumulator, a gate evaluator), and (3) wire the screen to a live reducer + render honest progress + a verdict screen. Step/verdict state lives in client React state; only confirmed check results round-trip to the DB.

**Tech Stack:** Next.js (App Router, RSC) · TypeScript · Drizzle ORM + `postgres` (Supabase Postgres) · React client components · Vitest (unit + integration).

## Global Constraints

- **Never show a number to the tech.** No percent, no confidence value, no derived/fabricated "N causes left." Confidence is INTERNAL ONLY — the verdict-gate trigger + next-check selector. (See memory `no-user-facing-confidence`.)
- **Progress = the curator's authored words, and every progress line must name what the JUST-COMPLETED check ruled out** (not only what's next). If the curator did not author the "ruled out" half for a branch, **suppress the line entirely** — suppression over fabrication, always.
- **Verdict story uses only true data:** "your N checks line up" = a real count of checks the tech actually completed this session; "N techs confirmed this fix" = `priorFixCount` (`loadCachedDiagnostic`), rendered ONLY when `> 0`. The prototype's "41 techs" is dropped.
- **Confidence rises ONLY from real confirmed checks** (curator-seeded `confidence_boost` weights). Never AI self-grading, never fabricated. Missing data = "not captured yet," never invented.
- **Triage / next-step selection stays rule-based, ZERO AI calls** in render. (The 504 wound.)
- **Reconcile logic stays in shared functions used by BOTH intake and session-render.** (The slug-drift bug class.)
- **The diagnostic UX is the diagram itself** — never a wizard/chatbot.
- Branch: `feat/diagnostic-loop`. Commit per task. Verify each pure function with the project test command before moving on.

### Verified data facts (from live read-only DB inspection, 2026-06-21)

- Symptom slugs are the LONG form: `p0087-fuel-rail-pressure-too-low`, `p0088-fuel-rail-pressure-too-high`. Platform: `ford-super-duty-4th-gen-67-psd`.
- P0087: 13 implicated test actions, 52 branches. P0088: 12 / 38. Branch verdicts seeded: `ok`, `warn`, `fail` (no `impossible`).
- All 13 P0087 steps have `confidence_boost > 0` (values 4–20; sum 126 → clamp to 100).
- Only `sd4-67psd-test-frp-5v-ref-at-connector` has a numeric `expected_value` (5 V ± 0.2). The other 12 are observation/prose-only (`expected_value IS NULL`), including the headline pressure steps.
- `meter_mode` is seeded as `'DC volts'` / `'PSI'` (unit strings, NOT the `MeterMode` union value `'pressure'`).
- `tech_outcomes` table EXISTS in the DB (migration 0021) but is NOT a Drizzle `pgTable` in `lib/db/schema.ts`.
- `diagnostic_sessions.cumulative_confidence` CHECK is `BETWEEN 0 AND 100` (0–100 scale). `getGateThreshold` returns 0–1 (e.g. 0.85). These must be reconciled at the comparison.

---

## Phase 0 — Routing & data integrity (prerequisites; pure-function fixes)

### Task 1: DB→fork verdict normalization

**Why:** `resolveFork` (`lib/diagnostics/diagram/step-sequence.ts:126`) matches `branch.verdict` against `ForkVerdict = 'fail'|'pass'|'neutral'`, but the loader passes the raw DB verdict (`ok`/`warn`/`fail`) through verbatim. Today only `fail` accidentally matches — `ok` and `warn` branches NEVER resolve, so the loop is currently incapable of routing a passing check.

**Files:**
- Create: `lib/diagnostics/diagram/verdict-vocab.ts`
- Create: `tests/unit/verdict-vocab.test.ts`
- Modify: `lib/diagnostics/load-system-topology.ts` (branch assembly ~511–519)

**Interfaces:**
- Produces: `mapDbVerdictToFork(dbVerdict: string): ForkVerdict` (import `ForkVerdict` from `step-sequence.ts`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { mapDbVerdictToFork } from '@/lib/diagnostics/diagram/verdict-vocab'

describe('mapDbVerdictToFork', () => {
  it('maps the four schema-legal DB verdicts to fork vocabulary', () => {
    expect(mapDbVerdictToFork('ok')).toBe('pass')
    expect(mapDbVerdictToFork('warn')).toBe('neutral')
    expect(mapDbVerdictToFork('fail')).toBe('fail')
    expect(mapDbVerdictToFork('impossible')).toBe('neutral')
  })
  it('degrades an unknown/absent verdict to neutral (never throws, never fabricates a route)', () => {
    expect(mapDbVerdictToFork('')).toBe('neutral')
    expect(mapDbVerdictToFork('garbage')).toBe('neutral')
  })
  it('is case-insensitive and trims', () => {
    expect(mapDbVerdictToFork(' OK ')).toBe('pass')
  })
})
```

- [ ] **Step 2: Run it, see it fail** — `pnpm vitest run tests/unit/verdict-vocab.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
import type { ForkVerdict } from '@/lib/diagnostics/diagram/step-sequence'

/**
 * The branch_logic.verdict DB enum is ('ok','warn','fail','impossible') but the
 * engine's resolveFork matches ForkVerdict ('pass'|'fail'|'neutral'). Normalize
 * at load time so resolveFork can match. Unknown/absent → 'neutral' (honest
 * degrade: never fabricate a route). 'impossible' is schema-legal but unseeded;
 * treated as neutral.
 */
export function mapDbVerdictToFork(dbVerdict: string): ForkVerdict {
  switch ((dbVerdict ?? '').trim().toLowerCase()) {
    case 'ok': return 'pass'
    case 'fail': return 'fail'
    case 'warn': return 'neutral'
    case 'impossible': return 'neutral'
    default: return 'neutral'
  }
}
```

- [ ] **Step 4: Apply in the loader.** In `load-system-topology.ts` branch assembly, change `verdict: b.verdict,` to `verdict: mapDbVerdictToFork(b.verdict),` (add the import). NOTE: `computeVerdict` (`slot-resolver.ts:233`) compares `b.verdict === 'fail'` — still correct after normalization (`fail`→`fail`). Before committing, grep `\.verdict` for other `TopologyBranch` readers and confirm none rely on raw `ok`/`warn` strings.

- [ ] **Step 5: Run tests** — unit test PASS; run the loader test if present. Then `pnpm tsc --noEmit` on touched files.

- [ ] **Step 6: Commit** — `git commit -m "fix(diagnostics): normalize DB branch verdicts to fork vocab so passing checks route"`

---

### Task 2: Deterministic branch dedup per verdict

**Why:** Test actions shared across P0087/P0088 can have multiple branch rows for the same verdict, and the loader's branch query has NO `ORDER BY`, so `resolveFork`'s `.find(b => b.verdict === v)` is nondeterministic.

**Files:**
- Modify: `lib/diagnostics/load-system-topology.ts` (branch assembly)
- Modify/Create test: `tests/unit/load-system-topology-dedup.test.ts` (or extend existing loader test)

**Interfaces:**
- Produces: a local pure helper `dedupeBranchesByForkVerdict(branches)` keeping ONE branch per fork-verdict, preferring `sourceProvenance` priority (`FIELD-VERIFIED` > `TRAINING-CONFIRMED` > `TRAINING-INFERRED` > `GAP`), then first-seen as a stable tiebreak.

- [ ] **Step 1: Write the failing test** — given two `ok`-verdict branches for one test action with different `sourceProvenance`, assert the deduped result keeps exactly one, the higher-provenance one, and is stable across input order. (Build the input as a minimal `TopologyBranch[]`.)

- [ ] **Step 2: Run, see fail.**

- [ ] **Step 3: Implement** the helper + apply it right after `branchRows.filter(b => b.testActionId === t.id)` in the assembly. (The branch query must also select `sourceProvenance` if not already — add it to the select.)

- [ ] **Step 4: Run tests PASS + `tsc`.**

- [ ] **Step 5: Commit** — `git commit -m "fix(diagnostics): dedupe branch rows per verdict deterministically by provenance"`

---

### Task 3: Gate thresholds keyed to real symptom slugs

**Why:** `gate-thresholds.ts` keys on `'p0087'`/`'p0088'`, but the real slugs are `p0087-fuel-rail-pressure-too-low` / `p0088-fuel-rail-pressure-too-high`, so the intended 0.85 gate silently degrades to the 0.8 default.

**Files:**
- Modify: `lib/diagnostics/gate-thresholds.ts`
- Create: `tests/unit/gate-thresholds.test.ts`

- [ ] **Step 1: Failing test** — `getGateThreshold('p0087-fuel-rail-pressure-too-low')` === `0.85`; same for p0088; an unknown slug === `0.8`.

- [ ] **Step 2: Run, fail.**

- [ ] **Step 3: Implement** — replace the keys with the full slugs (keep the existing `no-start-cranks-normally-fuel-system-suspect`). Leave a comment noting the slugs are the long form per the DB.

- [ ] **Step 4: PASS + tsc.**

- [ ] **Step 5: Commit** — `git commit -m "fix(diagnostics): key gate thresholds to real long-form symptom slugs"`

---

## Phase 1 — Data layer

### Task 4: Register `tech_outcomes` + surface `confidence_boost`

**Why:** The per-check log table exists in the DB but is unreachable from Drizzle; the confidence accumulator needs each step's `confidence_boost`, which the loader does not currently select.

**Files:**
- Modify: `lib/db/schema.ts` (add `techOutcomes` pgTable; add `confidence_boost` to the `testActions` select usage)
- Modify: `lib/diagnostics/load-system-topology.ts` (SELECT `ta.confidence_boost`; add `confidenceBoost: number` to `TopologyTestAction`)
- Create: `tests/unit/tech-outcomes-schema.test.ts` (a light smoke test that the table object is exported with expected columns)

**Interfaces:**
- Produces: `techOutcomes` Drizzle table; `TopologyTestAction.confidenceBoost: number` (default 0).

- [ ] **Step 1: Add the pgTable** mirroring the migration DDL exactly:

```ts
export const techOutcomes = pgTable('tech_outcomes', {
  id: uuid('id').primaryKey().defaultRandom(),
  testActionId: uuid('test_action_id').references(() => testActions.id, { onDelete: 'restrict' }).notNull(),
  sessionId: uuid('session_id').references(() => diagnosticSessions.id, { onDelete: 'restrict' }).notNull(),
  shopId: uuid('shop_id').references(() => shops.id, { onDelete: 'restrict' }).notNull(),
  techId: uuid('tech_id').references(() => profiles.id, { onDelete: 'restrict' }).notNull(),
  measuredValue: real('measured_value'),
  measuredUnit: text('measured_unit'),
  measuredObservation: text('measured_observation'),
  verdict: text('verdict').notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
})
```
(Confirm the exact `testActions` export name in schema.ts; do NOT generate a new migration — the table already exists in the DB.)

- [ ] **Step 2: Surface `confidenceBoost`** in the loader SELECT + type (default `0` when null).

- [ ] **Step 3: Tests + `tsc` + `pnpm drizzle-kit check`** (ensure no drift / no spurious migration).

- [ ] **Step 4: Commit** — `git commit -m "feat(db): register tech_outcomes table + surface confidence_boost in topology loader"`

---

## Phase 2 — Pure engine (no React, no DB)

### Task 5: `verdictFromReading`

**Why:** Turn a tech's input into a `ForkVerdict`. Numeric auto-judge ONLY where the curator authored a threshold (1 of 13 steps); otherwise the tech taps the outcome against the shown expectation (honest — we never invent a threshold).

**Files:**
- Create: `lib/diagnostics/diagram/verdict-from-reading.ts`
- Create: `tests/unit/verdict-from-reading.test.ts`

**Interfaces:**
- Produces:
  - `type ReadingInput = { value: number | null; observedVerdict: ForkVerdict | null }`
  - `verdictFromReading(input: ReadingInput, step: TopologyTestAction): ForkVerdict | null` — when `step.expectedValue != null`, judge `value` numerically against `expectedValue ± (expectedTolerance ?? 0)` (in-tolerance → `pass`, else `fail`); otherwise return `observedVerdict` (the tech's tap), or `null` if neither is available (caller must not advance).

- [ ] **Step 1: Failing tests** — (a) numeric step: `value:5.1, tol 0.2` → `pass`; `value:5.5` → `fail`; (b) prose step (`expectedValue:null`): returns the `observedVerdict` tap; (c) prose step with no tap and no value → `null` (do-not-advance); (d) numeric step with `value:null` but a tap → falls back to the tap.
- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Implement** the pure function exactly to the interface above.
- [ ] **Step 4: PASS + tsc.**
- [ ] **Step 5: Commit** — `git commit -m "feat(diagnostics): verdictFromReading — numeric auto-judge where seeded, tech-tap otherwise"`

---

### Task 6: Confidence accumulator (internal only)

**Files:**
- Create: `lib/diagnostics/diagram/confidence.ts`
- Create: `tests/unit/confidence.test.ts`

**Interfaces:**
- Produces: `accumulateConfidence(confirmedBoosts: number[]): number` — `Math.min(100, sum)` clamped `[0,100]`; sums only the `confidence_boost` of checks the tech actually confirmed. (0–100 scale to match the DB CHECK.)

- [ ] **Step 1: Failing tests** — `[5,15,12]` → `32`; sum over 100 clamps to `100`; `[]` → `0`; negative/NaN inputs are ignored (treated as 0).
- [ ] **Step 2: Run, fail. Step 3: Implement. Step 4: PASS + tsc.**
- [ ] **Step 5: Commit** — `git commit -m "feat(diagnostics): internal confidence accumulator from confirmed-check boosts"`

---

### Task 7: Verdict-gate evaluator

**Files:**
- Create: `lib/diagnostics/diagram/verdict-gate.ts`
- Create: `tests/unit/verdict-gate.test.ts`

**Interfaces:**
- Consumes: `getGateThreshold` (returns 0–1), `accumulateConfidence` output (0–100).
- Produces: `hasReachedGate(confidence0to100: number, symptomSlug: string): boolean` = `confidence0to100 >= getGateThreshold(symptomSlug) * 100`.

- [ ] **Step 1: Failing tests** — for `p0087-fuel-rail-pressure-too-low` (gate 0.85): `84` → false, `85` → true, `90` → true; unknown slug uses 0.8 → `80` true.
- [ ] **Step 2–4: fail → implement → PASS + tsc.**
- [ ] **Step 5: Commit** — `git commit -m "feat(diagnostics): verdict-gate evaluator reconciling 0-100 confidence vs 0-1 threshold"`

---

## Phase 3 — API / persistence

### Task 8: Port `POST /api/sessions/[id]/scenario`

**Why:** `topology-diagnostic.tsx:195` already POSTs here to persist the viewed scenario; the route does not exist on this branch (silent 404). Reference implementation exists in `.worktrees/6.0-psd-cranks-no-start-seed/app/api/sessions/[id]/scenario/route.ts`.

**Files:**
- Create: `app/api/sessions/[id]/scenario/route.ts`
- Create: `tests/integration/sessions-scenario-route.test.ts` (or follow the existing route-test pattern, e.g. `wizard-state` route test)

- [ ] **Step 1:** Read the worktree reference + an existing route (`wizard-state/route.ts`) for the auth/ownership pattern (`getSessionForUser`).
- [ ] **Step 2: Failing test** — POST with `{ slug }` updates `sessions.lastScenarioSlug`; unauthorized/foreign session → 403/404 per existing pattern.
- [ ] **Step 3: Implement** — minimal: validate body, `getSessionForUser`, update `sessions.lastScenarioSlug`, return 200.
- [ ] **Step 4: Tests PASS + tsc.**
- [ ] **Step 5: Commit** — `git commit -m "feat(api): add sessions/[id]/scenario route to persist viewed scenario"`

---

### Task 9: `POST /api/sessions/[id]/topology-check` (record a confirmed check)

**Why:** The one write the loop needs: log the tech's check + recompute/persist internal confidence. Lazy create-or-update of the `diagnostic_sessions` row (it is otherwise only written at close).

**Files:**
- Create: `app/api/sessions/[id]/topology-check/route.ts`
- Create: `lib/diagnostics/record-topology-check.ts` (the testable core; keep the route thin)
- Create: `tests/integration/record-topology-check.test.ts`

**Interfaces:**
- Request body: `{ testActionId: string; verdict: 'pass'|'fail'|'neutral'; measuredValue?: number; measuredUnit?: string; measuredObservation?: string; confirmedBoosts: number[] }` (the client sends the running confirmed-boost list so the server is the single writer of `cumulative_confidence` via `accumulateConfidence`; the server re-derives, it does not trust a client number).
- Behavior: resolve `shopId`/`techId`/`symptomId`/`vehicleId` from the session; INSERT a `tech_outcomes` row (must satisfy the `measured_value IS NOT NULL OR measured_observation IS NOT NULL` CHECK — enforce in validation); upsert the `diagnostic_sessions` row for this session (create if absent, set `cumulative_confidence = accumulateConfidence(confirmedBoosts)`); return `{ cumulativeConfidence, gateReached }`.

- [ ] **Step 1:** Read `record-diagnostic-session.ts` for the insert pattern + how `shopId`/`techId` are resolved from a session.
- [ ] **Step 2: Failing test** (integration, real test DB) — posting a check inserts one `tech_outcomes` row and sets a nonzero `cumulative_confidence`; a second check accumulates; a check with neither value nor observation is rejected (400).
- [ ] **Step 3: Implement** `record-topology-check.ts` (pure-ish, takes db + payload) then the thin route. Reuse `accumulateConfidence` + `hasReachedGate`.
- [ ] **Step 4: Tests PASS + tsc.**
- [ ] **Step 5: Commit** — `git commit -m "feat(api): topology-check route — log confirmed check + persist internal confidence"`

---

## Phase 4 — UI: wire the live loop (frontend-design sub-skill applies)

> Before the first UI task, INVOKE `superpowers:frontend-design`. Render must match the approved prototype's *behavior* (honest progress + verdict-with-story), NOT a confidence widget. Verify in a real browser per memory `local-browser-verification` (Playwright MCP is broken locally; drive the bundled chromium via a Node @playwright/test script).

### Task 10: Live step reducer

**Files:** Modify `components/screens/topology-diagnostic.tsx`.
- [ ] Replace the static `stepReducerInit` memo with `useReducer(stepReducer, buildStepSequence(topology), stepReducerInit)`; derive `currentStep = selectCurrentStep(state)`; keep `assembleStepView` driven by the live current step. No "step N of M" surfaced. Commit.

### Task 11: Reading-entry surface
**Files:** Create `components/topology/reading-entry.tsx`; mount in the screen.
- [ ] For a numeric step (`expectedValue != null`): a number input + unit, showing the expected ("5 V ± 0.2"). For prose steps: show the curator's `expectedObservation` and offer outcome taps mapped to fork verdicts (e.g. "In spec" → pass, "Borderline" → neutral, "Out of spec / fault" → fail). Painless language; a safety line where the step is invasive. Commit.

### Task 12: Submit handler → verdict → advance → persist
**Files:** Modify the screen.
- [ ] `onReadingSubmit`: compute `ForkVerdict` via `verdictFromReading`; if `null`, do nothing (cannot advance honestly). Else: append the step's `confidenceBoost` to a local `confirmedBoosts` state; `resolveFork(currentStep, forkVerdict)` → if `kind:'route'` and the id resolves to a step `goTo`, else `advance`; POST `/topology-check` (fire-and-persist; failure must not block the UI). Map raw fork verdict here (the R9 single-mapping-point discipline). Commit.

### Task 13: Honest progress narrative
**Files:** Create `components/topology/progress-line.tsx`.
- [ ] After each confirmed check, render the matched branch's `nextAction`/`reasoning` prose. **MANDATORY:** the line must state what the just-completed check ruled out; if the curator's branch text lacks that, render NOTHING. No counts, ever. Unit-test the "suppress when ruled-out half absent" rule with a pure formatter. Commit.

### Task 14: Verdict screen with its story
**Files:** Create `components/topology/verdict-panel.tsx`; show when `hasReachedGate` (internal) is true OR a terminal `fail` branch resolves to a confirmed cause.
- [ ] Render the resolved cause + the curator's reasoning. Story line: "your N checks line up" where N = real count of confirmed checks this session; add "N techs have confirmed this fix" ONLY when `loadCachedDiagnostic().priorFixCount > 0`. No percentage. If the gate is reached by elimination with no confirmed cause → the honest "still narrowing / strongest next step or hand-off" state, never a fabricated answer. Commit.

### Task 15: Skip-ahead + honest hand-off
**Files:** Modify the screen.
- [ ] "I already know this — skip" affordance that advances without recording a confidence boost (a skip is not a confirmed check — honesty). Honest hand-off / "no authored plan" path reuses the existing empty state. Commit.

---

## Verification (run before declaring done — invoke `superpowers:verification-before-completion`)

- [ ] All new unit tests green in isolation; `pnpm tsc --noEmit` clean on touched files (full-suite flake is load noise per memory `full-suite-flaky-db-tests` — verify affected files, not a single full-suite count).
- [ ] **End-to-end on the real P0087 session in a browser:** enter a reading → see a cause ruled out in the curator's words → enter another → reach a verdict whose story matches the real confirmed-check count → confirm NO number/percent/compass appears anywhere. Capture before/after screenshots.
- [ ] Confirm a *passing* (`ok`) check now advances (proves Task 1 landed) and routing is deterministic across reloads (proves Task 2).
- [ ] `Verified by:` line documenting exactly what was run/observed.

## Self-review notes (author)

- Spec coverage: loop law (one elimination, accuracy-first, internal-only confidence, painless, honest hand-off) ↔ Phases 0–4. Confidence-never-shown ↔ Global Constraints + Tasks 6/7/14. Two panel landmines ↔ Tasks 1–2; third (gate slug) ↔ Task 3.
- Deferred (NOT in this plan, by approved decision): the literal "N causes left" counter (needs a curator-seeded suspect/elimination map; build only post-WTP-test). The `meter_mode = 'PSI'` data-quality mismatch (cosmetic; flag to curator, do not silently coerce). 2011–2016 6.7 (3rd-gen) platform support.
