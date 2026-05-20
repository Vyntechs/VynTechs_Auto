# Phase 3 PR 1 — Platform Resolver + Cached Diagnostic Overview

**Date:** 2026-05-19
**Branch:** `staging-interactive-diagnostics`
**Phase:** 3 (user-facing) — PR 1 of 5
**Kickoff doc:** `docs/superpowers/handoffs/2026-05-19-orchestration-phase-3-kickoff.md`
**Claude Design handoff:** `docs/superpowers/handoffs/2026-05-19-claude-design-pr1-cached-diagnostic-overview.md`
**Design package extracted at:** `/tmp/vt-design-package/vyntechs-design-system/project/pr1-cached-overview/` (live mockups, primitives, CSS)

---

## TL;DR

Wire a cache-hit shortcut into the existing diagnosis flow. When a tech submits the intake form for a vehicle + complaint we already have a cached diagnostic for, skip the 30-60s AI tree generation and render a read-only "cached overview" screen showing the test plan instantly. Cache miss preserves today's AI flow unchanged.

PR 1 ships:

- **A platform resolver** — a code-level function mapping `(year, make, model, engine) → platform slug`. Covers the one platform we have (`ford-super-duty-4th-gen-67-psd`, 2017-2022 Ford Super Duty F-250/F-350/F-450/F-550 with 6.7L PSD).
- **Two new server endpoints + one cache-check shortcut** — list cached complaints for a platform (powers the chip picker), find cached diagnostic by symptom (powers the overview render), and a pre-flight cache check in `POST /api/sessions` that short-circuits AI generation on a hit.
- **Intake-form extension** — new optional DTC field + a progressive "common complaints for this vehicle" chip picker that appears after vehicle fields are filled.
- **A new cached-overview screen** at `/sessions/[id]` that renders for cache-hit sessions (V1 Ledger mobile design + DesktopOverview from Claude Design).
- **An empty-state component** built and tested but **NOT routed to in PR 1** — see open question below.

Out of scope: the interactive per-step walk (PR 2), AI-on-demand generation (PR 4), cross-platform inheritance (PR 5).

---

## Locked decisions (from brainstorming session 2026-05-19)

| Decision | Choice | Why |
|---|---|---|
| Integration point | **A** — intercept the existing `/sessions/[id]` route on cache hit; AI flow unchanged on miss | One entry point techs already use; cache-miss falls through to today's behavior; bounded regression risk |
| Symptom capture | **B** — DTC field + progressive "common complaints" chip picker | Explicit picking = zero false-positive risk; chips give self-discovery ("oh, we have these cases pre-built") |
| Resolver shape | **A** — code-level TypeScript function | One platform today; ~30-line function; zero migration; unit-testable; collapses to a table when 2nd platform lands |

---

## Architecture — the story of a submit

```
┌─────────────────────────┐
│ Tech opens /sessions/new │
└────────────┬─────────────┘
             │
             ↓
┌─────────────────────────────────────────────────────────┐
│ Intake form (existing, extended)                         │
│  • Tech fills year/make/model/engine                     │
│  • Form debounce-fires GET /api/diagnostics/             │
│    cached-complaints?year=…&make=…&model=…&engine=…     │
│      → server resolves platform                          │
│      → server queries cached symptoms for that platform  │
│      → returns chip list (possibly empty)                │
│  • Chip picker shows chips (or stays absent if empty)    │
│  • Tech picks a chip, types a DTC, fills complaint, both │
└────────────┬─────────────────────────────────────────────┘
             │
             ↓
┌──────────────────────────────────────────────────────────┐
│ POST /api/sessions  (existing handler, extended)         │
│  1. auth + paywall + open-session-limit (unchanged)      │
│  2. NEW: pre-flight cache check                          │
│       resolve platform from (year/make/model/engine)     │
│       resolve symptom from (selectedChipSlug || DTC      │
│           || complaint-keyword-fallback)                 │
│       if both resolve → look up cached diagnostic         │
│         HIT  → createSession({cacheHitSymptomId: …,       │
│                  cacheHitPlatformId: …, treeState: null}) │
│         MISS → fall through to existing AI tree gen      │
│  3. EXISTING: AI tree generation (only runs on miss)     │
│  4. createSession + return {id}                          │
└────────────┬─────────────────────────────────────────────┘
             │
             ↓
┌──────────────────────────────────────────────────────────┐
│ /sessions/[id] (existing route, extended)                │
│  routeForSession() — extended with new branch:           │
│    if session.cacheHitSymptomId → 'cached-overview'      │
│    else (existing branches: tree-generating,             │
│      active-session, closed-summary, redirect)           │
│                                                           │
│  cached-overview render path:                            │
│    server fetches cached diagnostic data                  │
│      (symptom + ordered test list + gate threshold)      │
│    renders <CachedOverview/> (V1 Ledger on mobile,        │
│      DesktopOverview at ≥1024px)                          │
└──────────────────────────────────────────────────────────┘
```

**Cache-miss behavior is unchanged.** Today's AI tree generation runs synchronously inside the POST handler, produces a `treeState`, the session is created, the user lands on `/sessions/[id]`, and `routeForSession` sends them to `active-session`. PR 1 only adds a pre-flight check at the top of the POST handler and a new branch in `routeForSession`.

---

## Symptom resolution — what triggers a cache lookup

The server's cache check tries three signals in priority order:

1. **`selectedSymptomSlug`** — set by the form when the tech clicks a chip. Direct match on `symptoms.slug`. Highest confidence.
2. **`dtcCodes`** — array of DTC strings from the new form field. For each code, look up `symptoms` rows where `slug = dtc.toLowerCase()` AND `category = 'dtc'`. We use lowercase DTC slugs in the DB (`p0087`, `p0088`).
3. **`customerComplaint` keyword match** — for PR 1, a tiny allowlist of patterns mapping free-text to symptom slugs. Specifically:
   - `/no.?start.*crank/i` → `no-start-cranks-normally-fuel-system-suspect`
   - (no other patterns in PR 1; we have only 3 cached symptoms and 2 are DTCs)

If any of the three resolves to a symptom that exists in `symptom_test_implications` for the resolved platform, that's a cache hit.

The chip-picker endpoint uses only signal #1's data source — it returns the symptoms that *could* be picked, deduped, for the resolved platform.

---

## Components — what's getting added

### Backend (server-side TypeScript, no migrations needed in PR 1)

| File | Purpose | Approx. LoC |
|---|---|---|
| `lib/diagnostics/resolve-platform.ts` | Code-level resolver. `resolvePlatformSlug({year, make, model, engine}): string \| null`. Rules for 2017-2022 Ford Super Duty 6.7L PSD. Unit-tested. | ~40 |
| `lib/diagnostics/symptom-resolver.ts` | `resolveSymptomSlug({platformSlug, selectedSymptomSlug?, dtcCodes?, complaintText?}): string \| null`. Tries the three signals in priority order. Returns slug only if it exists in `symptom_test_implications` for the platform. | ~50 |
| `lib/diagnostics/cached-lookup.ts` | Two queries: `listCachedSymptomsForPlatform(slug)` and `loadCachedDiagnostic({platformSlug, symptomSlug})`. The first returns `{slug, description, category}[]` for the chip picker. The second returns the full overview payload: `{platform, symptom, gateThreshold, tests: [...], priorFixCount}`. | ~80 |
| `app/api/diagnostics/cached-complaints/route.ts` | `GET ?year=...&make=...&model=...&engine=...` → calls resolver then `listCachedSymptomsForPlatform`. Returns `{platformSlug, complaints: [{slug, description, category}]}` or `{platformSlug: null, complaints: []}`. Auth-protected. | ~30 |
| `app/api/sessions/route.ts` (modified) | Extend `POST` handler: pre-flight cache check before AI generation. On hit, persist `cacheHitSymptomId` + `cacheHitPlatformId` on the new session row and skip AI; on miss, fall through unchanged. | ~50 new lines |
| `lib/db/schema.ts` (modified) | Add two nullable columns to `sessions`: `cacheHitPlatformId uuid` (FK platforms.id, nullable) and `cacheHitSymptomId uuid` (FK symptoms.id, nullable). Hand-written migration 0018 (drizzle-kit broken). | ~6 schema lines + migration |
| `lib/session-routing.ts` (modified) | Add new `'cached-overview'` branch returned when `session.cacheHitSymptomId` is set. | ~5 lines |
| `lib/types.ts` (modified) | Extend `intakeSchema` (zod) to accept optional `dtcCodes: string[]` and optional `selectedSymptomSlug: string`. | ~4 lines |

### Frontend (React/Next, new files except where noted)

| File | Purpose | Approx. LoC |
|---|---|---|
| `components/intake/cached-complaint-picker.tsx` | Renders the chip row. Takes `(year, make, model, engine)`, debounces on changes, calls `/api/diagnostics/cached-complaints`, renders chips. On click, sets a hidden form field `selectedSymptomSlug`. | ~70 |
| `components/intake/new-session-form.tsx` (modified) | Add DTC field (`<input name="dtcCodes">`) between engine and mileage. Mount `<CachedComplaintPicker/>` below engine. Submit payload now includes `dtcCodes` (parsed to array) and `selectedSymptomSlug`. | ~25 new lines |
| `components/vt/scenario-chip.tsx` | Port of `ScenarioChip` from design package. Operating-condition tag (IDLE / CRANKING / KOEO / etc). | ~10 |
| `components/vt/method-chip.tsx` | Port of `MethodChip` from design package. Phosphor icon + uppercase label. Method-icon map: PID/VISUAL/AUDIBLE/SMELL/MEASUREMENT/BENCH. | ~30 |
| `components/vt/invasiveness-dots.tsx` | Port of `InvasivenessDots` from design package. 5-dot scale with risk-color escalation at 4/5. | ~20 |
| `components/vt/confidence-gate.tsx` | Port of `ConfidenceGate` from design package. Horizontal bar with a needle marker — **separate** from existing `ConfidenceBlock` which is the big-number meter used elsewhere. | ~25 |
| `components/vt/symptom-hero.tsx` | Port of `SymptomHero` from design package. DTC chip + serif symptom name + corpus-match line + gate. | ~30 |
| `components/vt/cached-instant-badge.tsx` | The "cached · instant" eyebrow that replaces the timer slot in the vehicle strip. Small isolated component since it'll get reused. | ~12 |
| `components/vt/cta-bar.tsx` | Port of `CtaBar` from design package. Used at bottom of cached overview ("Start the walk"). | ~25 |
| `components/screens/cached-overview.tsx` | Port of `ScreenLedger` (mobile) + `DesktopOverview` (≥1024px). Uses all the above primitives. Receives the payload shape from `loadCachedDiagnostic()`. | ~120 |
| `components/screens/cached-empty.tsx` | Port of `ScreenEmpty` from design package. Built and exported but **not wired into a route in PR 1** (see open question). | ~80 |
| `app/(app)/sessions/[id]/page.tsx` (modified) | Add a branch for the new `'cached-overview'` route kind. Fetch the cached diagnostic payload server-side, pass to `<CachedOverview/>`. | ~15 new lines |
| `app/globals.css` (modified) | Append the `.cov-*` / `.scenario-chip` / `.method-chip` / `.inv-dots` / `.cov-gate` styles from `overview.css`. Translate `var(--vt-amber-500)` references (already exist in project tokens). Use existing `--vt-bone-*`, `--vt-fg-*`, `--vt-rule`, `--vt-font-*` tokens unchanged. **No new design tokens.** | ~600 lines appended |

### Tests (Vitest, no Playwright for PR 1 — see mobile validation section)

| File | Purpose |
|---|---|
| `lib/diagnostics/__tests__/resolve-platform.test.ts` | Unit tests for the resolver function: 2017/2018/2022 F-250 6.7L PSD → known slug; 2014 F-250 (out of year range) → null; 2018 F-150 → null; 2018 F-350 6.2L gas → null. |
| `lib/diagnostics/__tests__/symptom-resolver.test.ts` | Unit tests: chip slug priority over DTC over keyword; DTC normalization (P0087 vs p0087); keyword match only for the no-start pattern. |
| `lib/diagnostics/__tests__/cached-lookup.test.ts` | Integration test against PGlite: seed minimal platforms+symptoms+test_actions+symptom_test_implications, verify `loadCachedDiagnostic` returns expected payload shape with correct ordering. |
| `app/api/sessions/__tests__/cache-hit.test.ts` | Integration test for the POST handler's cache-hit branch: seed cached diagnostic, submit matching intake, assert session is created with `cacheHitSymptomId` set and `treeState` null. |

---

## Data shape — DB row → UI prop

Claude Design's component uses abbreviated keys (`{p, name, sc, m, exp, inv}`). Per Claude Design's own instruction in the README ("the schema wins — adjust the component props"), the ported components use the DB-shape keys. The mapping:

| Design package key | DB field | Notes |
|---|---|---|
| `p` | `symptom_test_implications.priority_order` | int, 1-indexed |
| `name` | `test_actions.description` | text |
| `sc` | `test_actions.scenario_required` | enum string; design caps in CSS |
| `m` | `test_actions.observation_method` | enum string; uppercase in UI (already enum-style) |
| `exp` | `test_actions.expected_reading_description` | text |
| `inv` | `test_actions.invasiveness_rating` | int 1-5 |

The `loadCachedDiagnostic` server function returns one already-shaped payload to keep the UI dumb:

```ts
type CachedDiagnostic = {
  platform: { slug: string; name: string }           // for header
  vehicle: { name: string; vin: string | null; mileage: number | null }
  symptom: {
    slug: string
    description: string
    category: string
    dtcDisplay: string | null    // "P0087" for DTCs, "NO-DTC" for drivability
  }
  gateThreshold: number           // 0.85 for P0087 (per Phase 2 spec)
  priorFixCount: number           // count of tech_outcomes for this symptom — see open Q
  tests: {
    priorityOrder: number
    description: string
    scenarioRequired: string
    observationMethod: string
    expectedReadingDescription: string
    invasivenessRating: number
  }[]
}
```

---

## Empty state behavior in PR 1 — open question for Brandon

Claude Design built a beautiful empty-state screen (`ScreenEmpty`) with a "Generate a diagnostic with AI" CTA. PR 4 will wire that CTA to invoke the orchestration-AI generator. PR 1's question: **where does the empty state render in PR 1?**

Two options, listed with their trade-offs:

- **(I) Build but don't wire it.** PR 1 doesn't change cache-miss behavior at all — the tech submits, the existing 60s AI tree generation runs, they land on the AI-built tree exactly as today. The `<CachedEmpty/>` component sits in the codebase, exported and tested, ready for PR 4 to wire it into the cache-miss route. **No regression risk; empty state is never user-visible in PR 1.**
- **(II) Wire it into cache-miss; CTA fires the legacy AI flow.** Cache miss now routes to a new `cached-empty` route kind on `/sessions/[id]`. The tech sees the empty state screen, clicks "Generate a diagnostic with AI", and *that* click kicks off today's AI tree generation. **Empty state is user-visible; one extra click for every cache-miss user (~99% of cases for now); but the screen gets real validation.**

My recommendation: **(I)** for PR 1. The empty state is a meaningful piece of UX that deserves to ship when it's load-bearing — and in PR 1 it isn't, because cache-miss is the same outcome (AI tree) regardless of whether we detour through the empty state. Adding the extra click for ~99% of submissions in PR 1 is friction with no benefit. PR 4 makes the empty state meaningful by making the CTA do something genuinely different (orchestration AI vs. legacy AI tree).

**Action:** Brandon to pick (I) or (II) in the review pass. If (II), I'll wire the route + CTA-to-existing-AI-flow plumbing.

---

## Out of scope (explicit non-goals for PR 1)

- The interactive per-step walk — PR 2 will let the tech enter readings, evaluate branch logic, and route to the next step. PR 1's "Start the walk" button is a stub: it renders, but clicking it shows a toast ("Walk view coming in PR 2 — for now the read-only plan above is the diagnostic.") or is disabled. Brandon to pick in review.
- AI-on-demand orchestration generation for new symptoms — PR 4's job.
- Cross-platform inheritance via `platform_equivalents` — PR 5's job.
- Recording tech outcomes back to `tech_outcomes` table — PR 3's job. PR 1 does no writes to the orchestration tables.
- Changes to the existing AI tree-generation path — PR 1 is purely additive; the existing flow runs unchanged on cache miss.
- Migrating other platform definitions or seeding additional cached diagnostics — only the existing F-250 platform and its 3 symptoms are reachable in PR 1.

---

## Open questions for Brandon (review-pass items)

1. **Empty-state wiring — (I) or (II) above?** Recommendation: (I).
2. **"Start the walk" button stub behavior.** Three options: (a) disabled with "Coming in PR 2" tooltip, (b) renders normally but click shows a toast/inline message, (c) hidden entirely until PR 2. Recommendation: (b) — the button is visually part of the design and hiding it leaves an obvious gap.
3. **`priorFixCount` — how to display when count is 0 or small.** The design shows "47 prior fixes · cross-shop corpus" — but real data right now is 12 outcomes for P0087 (simulated) and 0 for the others. Options: (a) show real count even when small/zero, (b) hide the count line when 0, (c) show real count + a "(simulated)" tag for outcomes flagged as simulated. Recommendation: (b) for PR 1 — the line shows only when count > 0. PR 2 / PR 3 can refine as real outcomes accumulate.
4. **Empty state "4,200+ shop records" copy.** Same problem. Recommendation: hide that specific sub-line in PR 1's empty state (or replace with a generic "from our cross-shop corpus" string with no number). Real corpus-size copy can land in PR 4 when generation is live.
5. **Resolver scope — explicit truck variants only, or pattern-permissive?** Recommendation: explicit list — `["F-250", "F-350", "F-450", "F-550"]` for now. F-650/F-750/E-Series cutaways listed in the kickoff's coverage tracker as candidates can land via `platform_equivalents` in PR 5.
6. **Chip picker debounce.** Recommendation: 350ms after last keystroke in any of the four vehicle fields; fires only when all four have non-empty values. Don't fire on partial input.

---

## Mobile validation plan

- **Viewports:** 375px (iPhone SE), 414px (iPhone Pro Max), 768px (iPad), 1024px (desktop breakpoint), 1440px (desktop default).
- **What's validated:** the new cached overview screen (V1 Ledger at <1024, DesktopOverview at ≥1024); the modified intake form with chip picker; the (built-but-not-wired) empty state component.
- **How:** Playwright screenshots at each viewport via the existing dev server. Saved to `validation-pr3pr1-*.png` (consistent with prior PR-numbered screenshot convention). Brandon's preview-URL pass is the final gate, but I run the Playwright pass first per `feedback_claude_validates_first` memory.
- **What constitutes "passes":** no horizontal scroll on the cached overview at 375; chip picker chips wrap cleanly without overflow; "Start the walk" CTA bar stays sticky at the bottom on mobile; long-list stress test (19-test no-start diagnostic) scrolls without losing the header or CTA.

---

## Files to create / modify (concrete list, in execution order)

### Phase A — backend foundations (no UI changes yet)

1. CREATE `lib/diagnostics/resolve-platform.ts` + test
2. CREATE `lib/diagnostics/symptom-resolver.ts` + test
3. CREATE `lib/diagnostics/cached-lookup.ts` + test
4. MODIFY `lib/db/schema.ts` — add `cacheHitPlatformId`, `cacheHitSymptomId` to sessions
5. HAND-WRITE migration `lib/db/migrations/0018_add_session_cache_hit_fks.sql` + journal entry
6. APPLY migration to live Supabase (per `feedback_apply_migration_to_live_db`) **— requires Brandon's explicit per-op approval at execution time**
7. CREATE `app/api/diagnostics/cached-complaints/route.ts` + smoke test
8. MODIFY `lib/types.ts` — extend `intakeSchema` with optional dtcCodes + selectedSymptomSlug
9. MODIFY `app/api/sessions/route.ts` — pre-flight cache check
10. MODIFY `lib/sessions.ts` (`createSessionForUser`) — accept new cache-hit fields
11. MODIFY `lib/session-routing.ts` — add `cached-overview` branch + test

### Phase B — frontend primitives

12. CREATE all new `components/vt/` primitives (`scenario-chip`, `method-chip`, `invasiveness-dots`, `confidence-gate`, `symptom-hero`, `cached-instant-badge`, `cta-bar`)
13. APPEND `.cov-*` / chip / dots / gate styles to `app/globals.css`
14. CREATE `components/intake/cached-complaint-picker.tsx`
15. MODIFY `components/intake/new-session-form.tsx` — add DTC field + mount picker

### Phase C — frontend screens

16. CREATE `components/screens/cached-overview.tsx` (mobile + desktop)
17. CREATE `components/screens/cached-empty.tsx` (built; routing decision pending open question)
18. MODIFY `app/(app)/sessions/[id]/page.tsx` — handle `cached-overview` route kind
19. (Optionally — per open Q #1) wire cache-miss to `cached-empty` route kind

### Phase D — validation

20. Vitest run — full test suite must stay green
21. Playwright screenshots at 5 viewports
22. Manual smoke on local dev: intake → cache-hit → overview renders + intake → cache-miss → existing AI flow works
23. (After Brandon's preview pass) merge to `staging-interactive-diagnostics` via Brandon's GitHub UI

---

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| **Pre-flight cache check adds latency to every POST /api/sessions even on miss.** | Resolver is in-memory string matching (no DB). Symptom lookup is two indexed queries (`symptoms` by slug, then `symptom_test_implications` join). Both well under 50ms. Negligible relative to existing 30-60s AI generation. |
| **Schema change to `sessions` table breaks the deploy on cache-miss legacy sessions.** | Both new columns nullable. Existing session rows (millions of pretend rows but realistically <500 today) get NULL; their `routeForSession` continues to return the existing branches because the `cached-overview` branch only fires when `cacheHitSymptomId IS NOT NULL`. Backwards-compatible by construction. |
| **Chip picker false-empty on first paint (resolver runs while engine is being typed).** | Debounce 350ms; only fire when all four vehicle fields are non-empty; render an inline "Looking…" indicator during fetch. |
| **The keyword-match path for no-start can false-match unexpected complaints.** | Pattern is `/no.?start.*crank/i` — both "no start" / "no-start" AND "crank" must appear. Brandon to add additional patterns via spec self-review if needed. |
| **`priorFixCount` queries `tech_outcomes` which currently has only simulated data.** | Open Q #3 covers display behavior. Underlying query is correct; it's a UX-copy question. |
| **PGlite test flake (per `feedback_vitest_pglite_flake` memory).** | Re-run vitest once after a fresh shell before treating a failure as regression. |
| **Existing AI flow regressions on cache-miss path.** | Cache-miss path is purely fall-through: if cache check returns null, the code path past the new check is byte-identical to today's. Add one integration test that submits a known-cache-miss intake and asserts AI generation ran. |

### Self-review notes (added 2026-05-19 after first-pass review)

- **`createSessionForUser` signature requires non-null `treeState`.** Current signature is `{db, userId, body, treeState: TreeState}` (not nullable). For cache-hit sessions, pass an empty sentinel `treeState = {nodes: [], gateDecision: null}` and ensure `routeForSession` checks `cacheHitSymptomId` BEFORE the existing `treeState.nodes.length === 0 → tree-generating` branch. Plan to verify in implementation: confirm the empty sentinel doesn't break any downstream `treeState` consumers (e.g., `getSessionForUser`, the `active-session` view's tree rendering).
- **Per-symptom gate threshold storage location TBD at implementation time.** The spec assumes "per-symptom gate threshold" exists in the data layer; the schema grep shows `confidenceCalibration.thresholdPct` and `confidence_score` columns on the diagnostic-walk tables, but no obvious `symptoms.gate_threshold` column. Plan task: locate where the P0087 0.85 gate value would come from — either an existing column I missed, a derived value, or it needs to be added as a default constant in `lib/diagnostics/cached-lookup.ts` (with a TODO to relocate to DB when calibration data exists). If it must be hard-coded for PR 1, the constant lives in one place and the spec is otherwise accurate.

---

## What this unlocks for the next PRs

- **PR 2** can read the same cached payload structure that PR 1's overview consumes — the per-step walk is built on top of the same query function. No reshape needed.
- **PR 3 (outcome recording)** can hook into the `cacheHitSymptomId` on `sessions` to know which symptom to write outcomes against.
- **PR 4 (AI-on-demand)** replaces (or augments) the cache-miss fall-through with orchestration AI generation that writes to the orchestration tables, then re-uses the same cached-overview screen for the result.
- **PR 5 (cross-platform)** changes only the resolver path — when no direct platform match is found, the resolver consults `platform_equivalents` and finds an applicable cached diagnostic on a related platform.

---

*Spec written 2026-05-19 by the orchestrating Claude session during Phase 3 PR 1 brainstorming. Brainstorming dialogue archived at `.superpowers/brainstorm/6510-1779236125/content/`. Next step after Brandon approves this spec: invoke `superpowers:writing-plans` to produce the implementation plan.*
