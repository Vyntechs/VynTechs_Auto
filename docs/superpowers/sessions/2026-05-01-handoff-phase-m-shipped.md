# Vyntechs MVP — Session Handoff (Phase M shipped, 2026-05-01)

**For the next session: paste this file as the first message. It supersedes `2026-05-01-handoff-phase-fh-shipped.md`.**

---

## ⏵ START HERE — instructions for the next session

You are resuming the Vyntechs MVP build. Phase M (risk gating + Decline-or-Defer) just shipped. **Do this in order, no detours:**

1. **`cd` into the worktree:** `/Volumes/Creativity/dev/projects/vyntechs/.worktrees/mvp-implementation`. Branch is `feature/mvp-implementation`. Working tree is clean. **Do NOT switch branches; do NOT touch `main`; do NOT discard or reset anything.**
2. **Read `AGENTS.md` first** (top-level, new this session). It is the load-bearing conventions doc — handler-in-`lib/` + thin route shim, queries-take-`db`, preview-mode-safe wired components, plan-vs-reality reconciliation pattern, gating model.
3. **Verify the baseline before adding anything:** `pnpm test && pnpm exec tsc --noEmit && pnpm build`. Expected: 145/145 tests, exit 0, build succeeds. If anything is red, **stop and report — do not start new work on a broken baseline.**
4. **First task is the one piece skipped this session: a11y verification on the wired DeclineOrDefer flow.** Spin up `pnpm dev`, audit `/design` (static fixture, works without env) with `chrome-devtools-mcp:a11y-debugging` against the DeclineOrDefer surface specifically. Fix anything web.dev flags. Commit as `chore(a11y): Phase M follow-up — verify DeclineOrDefer surfaces`. This closes the only loose end from Phase M.
5. **Then ask the user which phase to ship next.** Do not pick unilaterally. Recommended priority is in the "Recommended next steps" section of this file (Phase G → I → N → J). If user picks anything else, follow them.
6. **Workflow discipline (the user enforces this strictly):**
   - `superpowers:executing-plans` once per phase
   - `superpowers:test-driven-development` every TDD cycle
   - `superpowers:systematic-debugging` the moment anything breaks
   - `superpowers:verification-before-completion` before declaring any phase done
   - `frontend-design` skill if any UI work
   - End every phase: `pnpm test && pnpm exec tsc --noEmit && pnpm build`, then `chrome-devtools-mcp:a11y-debugging` if UI was touched, then write a new handoff doc that supersedes this one and update `MEMORY.md` to point at it.
7. **Plan-vs-reality:** the inline plan code blocks are reference, not drop-in. Each phase has an "Implementation corrections" callout at the bottom that is authoritative. Mirror this style for any future phase that drifts.

**Do not begin any other work, ask any other question, or skip any of the above steps until step 4 is committed and step 5 is answered.**

---

## Where we are

- **Worktree:** `/Volumes/Creativity/dev/projects/vyntechs/.worktrees/mvp-implementation`
- **Branch:** `feature/mvp-implementation` (now **37 commits ahead** of `main`)
- **Plan:** `docs/superpowers/plans/2026-05-01-vyntechs-implementation-plan.md`
- **Spec:** `docs/superpowers/specs/2026-05-01-vyntechs-design.md`
- **Conventions:** `AGENTS.md` (new this session), `docs/superpowers/ui-design-toolkit.md`
- **Tests:** **145 passing** across 25 files. Typecheck clean (`pnpm exec tsc --noEmit` exit 0). Production build clean (`pnpm build`).

## What shipped this session

### Phase M — Risk gating + Decline-or-Defer (closes the trust loop)

Nine commits + an end-of-phase docs commit. Every action the AI proposes now passes through a two-stage risk classifier and a per-(risk_class × vehicle_family × symptom) confidence gate. When the gate blocks, the tech sees three customer-safe options instead of a destructive instruction.

- `feat(gating): M1 — confidence_calibration table + spec §8.3 baseline` (`3857b82`) — `confidence_calibration` table keyed on (risk × vehicle × symptom), `getThreshold(db, input)` with most-specific-row preference and spec §8.3 hardcoded fallback so the function works pre-seed. Migration `0002_wakeful_microchip.sql`. Seed file `drizzle/seed/calibration-seed.ts` is committed but deferred (no `tsx` in deps; runs once `DATABASE_URL` is wired).
- `feat(gating): M2 — two-stage risk classifier (rules + Haiku LLM judge)` (`c3038ed`) — `classifyAction(text)` tries hardcoded rules first (zero/low/medium/high/destructive, **destructive-first ordering** so cuts/reflashes never get downgraded), falls back to a Haiku LLM judge with cached system prompt for novel actions. LLM failures default to `high` (safety bias). Caught a regex bug in the plan: `/\bb\+\b/` doesn't match `B+ ` because `\b` after `+` won't transition against a following space — fixed.
- `feat(ai): M3 — tree engine emits proposedAction with confidence for risk gating` (`35b3300`) — `TreeState` extended with `proposedAction` + `requestedArtifact`. `TREE_ENGINE_SYSTEM` prompt now requires honest confidence on every physical action.
- `feat(gating): M4 — gap handler enforces per-(risk_class × vehicle × symptom) thresholds` (`96f559d`) — `gateProposedAction({db, action, vehicleFamily?, symptomClass?})` returns a `GateDecision` with `allow/threshold/confidence/rationale`. On block, emits the spec §8.4 options `['gather_more_low_risk', 'decline', 'defer']` in that exact order.
- `feat(gating): M5 — decline-or-defer handler with DI language generator` (`e2ff4e2`) — Plan-vs-reality fix: `declineOrDeferSessionForUser` handler in `lib/sessions.ts` (DI'd `generateLanguage`), 30-line route shim at `/api/sessions/[id]/decline-or-defer`. `setSessionTerminalStatus` is the race-safe `UPDATE … WHERE status='open' RETURNING` query. `aiResponse` JSONB type extended for the `declineOrDefer` payload. `DECLINE_LANGUAGE_SYSTEM` uses Sonnet (customer-facing copy quality matters).
- `feat(gating): M6 — tech-assist (Rung 2) audit trail with 1+2 follow-up bound` (`b155ff0`) — `tech_assist_requests` table + migration `0003_sour_mathemanic.sql`. `recordTechAssistRequest` is the audit primitive (find existing → bump count or insert). Audit logic lives **inside `advanceSession`** (not the route, per Phase D/F convention). Third follow-up strips `requestedArtifact` and appends a Rung-2 budget exhausted notice to `message`.
- `feat(gating): M7 — wire Phase E DeclineOrDefer screen to live API` (`b7f5ba7`) — Plan-vs-reality fix: wired the existing `components/screens/decline-or-defer.tsx` (added `'use client'`, optional `onSelectOption`/`pending`/`error` props — preview-mode-safe). New `decline-or-defer-live.tsx` client wrapper handles fetch + redirect. `(app)/sessions/[id]/page.tsx` redirects to `/decline` when `gateDecision` blocks. `advanceSession` computes `gateDecision` when `proposedAction` exists (DI'd `gateAction` for testability).
- `test(gating): M8 — contract test for risk-class × confidence gating` (`ec8edf2`) — Pins the spec §8.3/§8.4 contract: destructive @ 90% blocks, @ 96% passes, options surface in exact order.
- `docs(gating): M9 — AGENTS.md + Phase M implementation corrections` (`d0bb9c1`) — Created `AGENTS.md` (didn't exist) with conventions doc + the gating section. Appended "Phase M — Implementation corrections" callout (13 items) to the plan, mirroring Phase F + H style.

## Conventions established / reinforced this session

- **All Phase D + E + F + H + M conventions still apply.** New ones from M:
- **Plan-vs-reality fixes documented in a "Phase X — Implementation corrections" callout** at the end of each phase section. Now done for D, F, H, M. The inline plan blocks remain reference; the callouts are authoritative. Mirror this for any future phase that drifts.
- **Routes stay thin shims; business logic in `lib/sessions.ts` handlers** with DI for AI calls / external deps. M5 (`declineOrDeferSessionForUser`) and M7 (`advanceSession` `gateAction?` param) added two more handlers in this style. Pattern:
  - Handler signature: `({ db, userId, sessionId, body, ...injectedDeps }) => Promise<DiscriminatedResult>`
  - Route shim: read user via `getServerSupabase`, call handler with prod deps (e.g. `generateDeclineLanguage`), map result to `NextResponse`.
  - Tests: pglite + injected mock dep, no Next.js mocking.
- **Queries always take `db: AppDb` as first arg.** Verified across all 9 query helpers added/touched this session (`getThreshold`, `setSessionTerminalStatus`, `recordTechAssistRequest`).
- **Risk-rule ordering is destructive-first** in `classifyAction` so safety-critical matches can't be shadowed by softer incidental matches.
- **Hardcoded safety fallbacks** in two places: `getThreshold` falls back to spec §8.3 values when calibration is empty; `classifyAction` defaults to `high` on LLM failure. Both are by design — the gate must work even when DB/LLM is degraded.
- **Preview-mode-safe wired components.** `DeclineOrDefer` follows the same pattern as `OutcomeCapture` from Phase F: optional callback ⇒ inert/preview when absent. Means `/design` keeps rendering every screen with no env, while `/decline` route uses the live wrapper. Apply this whenever a screen needs both story and live forms.
- **Server-side redirect for gate-blocked surfacing**, not in-place rendering inside the active screen. Keeps the active session component dumb; reuses the `/decline` route for both Rung-2-exhausted and confidence-blocked cases.
- **`TreeState` is duplicated** in `lib/db/schema.ts` (JSONB column type) and `lib/ai/tree-engine.ts` (runtime contract). Both updated for new fields each session. **Future cleanup:** collapse to a single source of truth (pick `tree-engine.ts` as canonical, schema imports via `import type`).

## Open env values still needed

Same as before — none of the in-flight code is gated, but live testing requires:

- `SUPABASE_SERVICE_ROLE_KEY`
- `[YOUR-PASSWORD]` placeholder in `DATABASE_URL` and `DATABASE_URL_DIRECT`
- `ANTHROPIC_API_KEY` for live tree generation, outcome validation, **risk classifier (Haiku judge), and decline-language generation (Sonnet)**

The `/design` route still works with no env — fixture-driven, preview-mode-safe.

Once `DATABASE_URL` is wired:
1. `pnpm drizzle-kit migrate` to apply migrations 0002 (calibration) + 0003 (tech-assist).
2. Run the calibration seed (file at `drizzle/seed/calibration-seed.ts`; needs a tsx-equivalent runner).

## Recommended next steps

In priority order:

1. **A11y verification on the `/decline` route.** Not done in this session — see "Skipped this session" below. Quick win: spin up `pnpm dev`, hit `/design` (the static DeclineOrDefer is fixture-rendered there), audit with `chrome-devtools-mcp:a11y-debugging`. Then rerun on `/sessions/[id]/decline` once env is wired.
2. **Phase G — Stripe Billing Skeleton (3 tasks).** Small, foundational. Spec calls for $700/mo flat SaaS pricing.
3. **Phase I — Multi-Modal Capture (10 tasks).** Wires the four `CaptureBar` buttons to actual capture flows. Largest of the remaining short phases.
4. **Phase N — Tablet layout (6 tasks).** Same design system, two-pane layout. Tokens already support all viewports.
5. **Phase J — Playwright e2e.** Now valuable: outcome flow + decline-or-defer flow + PWA install + offline behavior all need browser-level coverage.
6. **TreeState consolidation cleanup.** ~15 minutes — collapse the schema/tree-engine duplication noted above. Can ride along with any phase that touches `TreeState`.

## Skipped this session

- **`chrome-devtools-mcp:a11y-debugging` on the wired DeclineOrDefer route.** Per the handoff workflow, UI-touching phases should have an a11y check. Not run here — would need either a live dev server (env not wired) or a `/design` route audit. Recommended first task next session before any other UI work.

## Recommended resumption flow

1. `/clear`.
2. Paste this file as the first message.
3. Read `AGENTS.md` (new) for conventions; latest handoff for current state.
4. Read `docs/superpowers/ui-design-toolkit.md` if the chosen phase has any UI work.
5. Pick the next phase. A11y verification is the recommended default — closes the only loose end from Phase M.
6. Use `superpowers:executing-plans` (once per phase) and `superpowers:test-driven-development` (every cycle).
7. End of phase: run `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm build`, then `chrome-devtools-mcp:a11y-debugging` if touching UI.

## Key files added this session

**Phase M:**
- `lib/db/schema.ts` — `confidence_calibration`, `tech_assist_requests` tables + `RiskClass` type + `gateDecision`/`proposedAction`/`requestedArtifact` on `TreeState` + `declineOrDefer` on `aiResponse`
- `lib/db/queries.ts` — `getThreshold`, `setSessionTerminalStatus`, `recordTechAssistRequest`, `TECH_ASSIST_RUNG_2_BUDGET` const
- `lib/ai/prompts.ts` — `RISK_CLASSIFIER_SYSTEM`, `DECLINE_LANGUAGE_SYSTEM`; extended `TREE_ENGINE_SYSTEM` (proposedAction + RISK GATING principle)
- `lib/ai/tree-engine.ts` — `ProposedAction`, `RequestedArtifact` types; `gateDecision` field
- `lib/gating/risk-classifier.ts` — `classifyAction` (rules + Haiku judge)
- `lib/gating/gap-handler.ts` — `gateProposedAction`, `GateDecision`, `GateOption`
- `lib/gating/decline-language.ts` — `generateDeclineLanguage`, `DeclineLanguage`, `DeclineLanguageInput`
- `lib/sessions.ts` — `declineOrDeferSessionForUser` + `gateAction?` DI on `advanceSession` + audit logic + `vehicleFamilyKey`/`primarySymptomClass` helpers
- `app/api/sessions/[id]/decline-or-defer/route.ts` — thin shim
- `app/(app)/sessions/[id]/page.tsx` — redirect to `/decline` when `gateDecision.allow === false`
- `app/(app)/sessions/[id]/decline/page.tsx` — live data (was static fixture)
- `components/screens/decline-or-defer.tsx` — wired ('use client', optional callbacks, preview-mode-safe)
- `components/screens/decline-or-defer-live.tsx` — fetch + redirect wrapper
- `drizzle/migrations/0002_wakeful_microchip.sql`, `0003_sour_mathemanic.sql`
- `drizzle/seed/calibration-seed.ts` — deferred-run
- `tests/unit/risk-classifier.test.ts` (5)
- `tests/unit/gap-handler.test.ts` (3)
- `tests/unit/queries.test.ts` — `getThreshold` block (3)
- `tests/unit/decline-or-defer-handler.test.ts` (6)
- `tests/unit/advance-session-handler.test.ts` — gate + audit blocks (5 added)
- `tests/unit/decline-or-defer-screen.test.tsx` (8)
- `tests/unit/gating-flow.test.ts` (2)
- `AGENTS.md` (new, top-level conventions doc)
- `docs/superpowers/plans/2026-05-01-vyntechs-implementation-plan.md` — Phase M corrections callout (13 items)

## Plan callouts

The Phase D corrections (line 2312), Phase F corrections (after F7), Phase H corrections (after H3), and Phase M corrections (after M9) sections of the plan are the authoritative pattern. The inline plan code blocks remain as reference but are not drop-in correct. Mirror the corrections-callout style for any future phase that drifts from its plan.
