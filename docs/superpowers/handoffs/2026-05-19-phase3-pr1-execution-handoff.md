# Phase 3 PR 1 — Execution Handoff (resume at Work Item 1)

**Resume line for a fresh session:**

```
Resume from docs/superpowers/handoffs/2026-05-19-phase3-pr1-execution-handoff.md
```

---

## What this is

Mid-execution handoff for **Phase 3 PR 1 — Platform Resolver + Cached Diagnostic Overview**. The prior session brainstormed, wrote the spec + plan, and executed Tasks 1-7 of the 19-task plan. Context got heavy; this is a clean break so a fresh session resumes the remaining work.

**You are executing with the `superpowers:subagent-driven-development` skill.** Per work item: dispatch an implementer subagent → spec-compliance review subagent → code-quality review subagent → fix loop until both pass → mark complete. Don't pause between items. Dispatch implementers on `sonnet`; the final end-to-end review on `opus`.

## Current state

| Thing | Value |
|---|---|
| Branch | `feat/phase3-pr1-platform-resolver` (cut from `staging-interactive-diagnostics`) |
| HEAD commit | `19b8450` (Task 7) — this handoff + design files add one more docs commit on top |
| Migration 0018 | **APPLIED to live Supabase** (`ynmtszuybeenjbigxdyl`) and verified — `sessions` has `cache_hit_platform_id`, `cache_hit_symptom_id`, index `sessions_cache_hit_symptom_id_idx`. Do NOT re-apply. |
| Plan | `docs/superpowers/plans/2026-05-19-phase3-pr1-platform-resolver.md` |
| Spec | `docs/superpowers/specs/2026-05-19-phase3-pr1-platform-resolver-design.md` |
| Design package (in-repo copy) | `docs/superpowers/pr1-design-package/` — `Overview.jsx` (primitives + screens), `overview.css` (all `.cov-*` styles), `kit/Components.jsx` (existing primitives reused) |
| Claude Design handoff | `docs/superpowers/handoffs/2026-05-19-claude-design-pr1-cached-diagnostic-overview.md` |

## Tasks 1-7 — DONE

| Task | What | Commit(s) |
|---|---|---|
| 1 | Migration 0018: `sessions` cache-hit FK columns | `73496d7`, `d068cf9` |
| 2 | Migration 0018 applied to live Supabase + verified | (DB op — no commit) |
| 3 | `lib/diagnostics/resolve-platform.ts` — `resolvePlatformSlug` | `fe4b1de`, `eb588d3` |
| 4 | `lib/diagnostics/symptom-resolver.ts` — `resolveSymptomSlug` (also fixed missing `--> statement-breakpoint` markers in migrations 0017 + 0018) | `799e3214`, `1125968` |
| 5 | `lib/diagnostics/cached-lookup.ts` + `gate-thresholds.ts` | `4d130d3`, `0269958` |
| 6 | `app/api/diagnostics/cached-complaints/route.ts` | `e33b0aa` |
| 7 | `intakeSchema` + `createSessionForUser` cache-hit fields | `19b8450` |

Every task above passed an independent spec-compliance review AND a code-quality review.

## What already exists — signatures for your dispatches

Read these files directly for exact shapes; do NOT trust the plan's sketches (the plan has stale assumptions — see Corrections below).

- `lib/diagnostics/resolve-platform.ts` — `resolvePlatformSlug({year, make, model, engine}): string | null`
- `lib/diagnostics/symptom-resolver.ts` — `resolveSymptomSlug({db, platformSlug, selectedSymptomSlug?, dtcCodes?, complaintText?}): Promise<string | null>`
- `lib/diagnostics/cached-lookup.ts` — `listCachedSymptomsForPlatform({db, platformSlug}): Promise<CachedComplaint[]>` and `loadCachedDiagnostic({db, platformSlug, symptomSlug}): Promise<CachedDiagnostic | null>`. **Read this file for the exact `CachedDiagnostic` / `CachedComplaint` type — the test fields are named `scenario`, `expectedReading` etc., NOT the raw DB column names.**
- `lib/diagnostics/gate-thresholds.ts` — `getGateThreshold(symptomSlug): number`
- `app/api/diagnostics/cached-complaints/route.ts` — GET route, returns `{platformSlug, complaints}`
- `lib/types.ts` — `intakeSchema` now has optional `dtcCodes: string[]` and `selectedSymptomSlug: string`
- `lib/sessions.ts` — `createSessionForUser` accepts optional `cacheHitPlatformId`, `cacheHitSymptomId`
- `lib/db/schema.ts` — `sessions` has `cacheHitPlatformId`, `cacheHitSymptomId`

## ⚠️ CRITICAL — Plan corrections (the plan doc has stale assumptions)

The plan was written before the schema was fully verified. These were discovered and corrected during Tasks 1-7. **Apply them when composing every remaining dispatch. Always instruct implementers to verify column names against `lib/db/schema.ts`.**

1. **`symptom_test_implications` has NO `platformId` column.** Platform scoping is done by joining `symptoms → symptom_test_implications → test_actions → components` and filtering `components.platformId`. (Already correct in the shipped Task 4/5 code — match that pattern.)
2. **The STI priority column is `priority`** (integer), NOT `priorityOrder`.
3. **`test_actions` real columns:** `description`, `scenarioRequired`, `observationMethod`, `expectedObservation` (NOT `expectedReadingDescription`), `invasiveness` (NOT `invasivenessRating`).
4. **`isRetired`** exists on `symptom_test_implications`, `test_actions`, `components` — NOT on `symptoms`. Filter `isRetired = false` in any reachability query.
5. **`AppDb`** type is exported from `lib/db/queries.ts`, NOT `lib/db/client.ts` (which exports `Database`).
6. **DB-backed tests** use `createTestDb()` from `tests/helpers/db.ts` with a `beforeEach`/`afterEach` pattern. The plan's references to `withTestDb` / `./helpers/test-db` are WRONG. `createTestDb` runs all migrations on an in-memory PGlite, so the full orchestration schema (incl. migration 0018) exists.
7. **Migrations need `--> statement-breakpoint` markers** between statements or the PGlite test migrator batches them and errors. (Informational — no new migrations in the remaining work.)
8. **`TreeState` shape — CRITICAL for Work Item 1.** The real `TreeState` (from `lib/ai/tree-engine`) is `{nodes, currentNodeId, message}` — NOT `{nodes, gateDecision}` as the plan's Task 8 assumed. A cache-hit session still needs a structurally-valid `treeState`. The W1 implementer must read the real `TreeState` type and build a minimal valid empty sentinel (key requirement: `nodes: []`). `routeForSession` must check `cacheHitSymptomId` BEFORE its existing `treeState.nodes.length === 0 → tree-generating` branch, so the empty sentinel routes to `cached-overview` not the loading screen. Confirm `getSessionForUser` / `active-session` consumers tolerate an empty-nodes treeState (they should never see a cache-hit session, but verify).
9. **`diagnosticSessions.finalVerdict`** is a text enum: `['commit-allowed', 'commit-refused', 'incomplete']`.

## Remaining work — CONSOLIDATED into 6 work items

The plan's Tasks 8-19 are consolidated here into 6 larger work items to cut review round-trips. Each work item is still one implementer dispatch + spec review + quality review. Pull the detailed step text from the plan's corresponding tasks, but apply the Corrections above.

### W1 — Backend cache routing (plan Tasks 8 + 9)
- `app/api/sessions/route.ts`: pre-flight cache check before AI tree generation — resolve platform + symptom, on hit create the session with `cacheHitPlatformId`/`cacheHitSymptomId` set and a valid empty-sentinel `treeState`, skipping AI; on miss fall through unchanged.
- `lib/session-routing.ts`: add a `'cached-overview'` branch to `routeForSession`, checked BEFORE the `tree-generating` branch.
- Tests for both. See Correction #8 — the TreeState sentinel is the tricky part.

### W2 — Styling + UI primitives (plan Tasks 10 + 11)
- Append `docs/superpowers/pr1-design-package/overview.css` to `app/globals.css` (all `.cov-*`, `.scenario-chip`, `.method-chip`, `.inv-dots`, `.cov-gate` etc.). Uses existing `--vt-*` tokens — no new tokens.
- Port the 7 new `components/vt/` primitives from `docs/superpowers/pr1-design-package/Overview.jsx`: `ScenarioChip`, `MethodChip` (Phosphor icons — `@phosphor-icons/react` is installed), `InvasivenessDots`, `ConfidenceGate`, `SymptomHero`, `CachedInstantBadge` (the "cached · instant" badge), `CtaBar`. Export from `components/vt/index.ts`.

### W3 — Intake form (plan Tasks 12 + 13)
- `components/intake/cached-complaint-picker.tsx` — debounced (350ms) chip picker calling `GET /api/diagnostics/cached-complaints`.
- Modify `components/intake/new-session-form.tsx` — hoist vehicle fields to React state, add optional DTC input, mount the picker, include `dtcCodes` + `selectedSymptomSlug` in the submit payload.

### W4 — Screens (plan Tasks 14 + 15)
- `components/screens/cached-overview.tsx` — port `ScreenLedger` (mobile, V1 Ledger — the chosen variant, NOT V2 Tape / V3 Rung) + `DesktopOverview` from `Overview.jsx`. Bind to the REAL `CachedDiagnostic` type from `cached-lookup.ts`.
- `components/screens/cached-empty.tsx` — port `ScreenEmpty`.

### W5 — Integration (plan Task 16)
- Modify `app/(app)/sessions/[id]/page.tsx` — handle the `cached-overview` route kind: fetch the cached diagnostic via `loadCachedDiagnostic` and render `<CachedOverview/>`.

### W6 — Validation & finalize (plan Tasks 17 + 18 + 19)
- Full `pnpm test` (re-run once if PGlite cold-cache flake — known), `pnpm tsc --noEmit`, lint.
- Playwright screenshots at 375 / 414 / 768 / 1024 / 1440 px — cached overview + intake form. Save as `validation-pr3pr1-*.png`.
- Dispatch a final end-to-end code review (`opus`).
- Push the branch; surface validation state + the open questions below to Brandon.

## Open questions — pending Brandon's input (from the spec)

Not blocking, but the answers refine W4/W5/W6. Either ask Brandon or follow the recommendation:
1. **Empty-state wiring** — recommended **(I)**: build `CachedEmpty` but do NOT route cache-miss through it in PR 1 (cache-miss keeps today's AI flow). PR 4 wires it.
2. **"Start the walk" button stub** — recommended **(b)**: button renders, click shows a toast/inline "Walk view coming in PR 2."
3. **`priorFixCount` display when 0** — recommended: hide the prior-fix line when count is 0.
4. **Empty-state corpus-count copy** — recommended: drop the hard-coded "4,200+ records" number, use a generic phrase.

## Constraints (carry forward)

- **Brandon is a non-engineer founder.** Plain-English check-ins in chat; no SQL/TS jargon when surfacing decisions.
- **No live-DB writes without explicit per-op approval.** (Migration 0018 is already done — nothing else in the remaining work touches the live DB.)
- **Never push to `main`.** Brandon merges PRs himself. The branch is `feat/phase3-pr1-platform-resolver` → PR into `staging-interactive-diagnostics`. Confirm the PR-vs-direct-commit choice with Brandon at W6 (he hasn't finalized it).
- **Mobile validation required** — every UI surface must pass 375-414px before "done."
- First `pnpm test` after a fresh shell can show PGlite cold-cache flake — re-run once before treating a failure as real.

## Definition of PR 1 done

All 6 work items complete, full test suite green, mobile validation passed, branch pushed, and Brandon has the validation summary + open-question answers. Then Brandon reviews and merges.

---

*Handoff written 2026-05-19 by the prior orchestrating session after completing Tasks 1-7.*
