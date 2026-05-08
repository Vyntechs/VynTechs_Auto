# Research-Grounded Diagnostic AI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add research-grounded operation to the diagnostic AI engine — vehicle-specific procedural output is grounded in retrieval evidence (corpus + web), with hedged language and explicit uncertainty admissions when retrieval is thin or contradictory.

**Architecture:** Orchestrator-driven retrieval (extending the existing `lib/retrieval/wire-into-tree.ts` pattern) into the intake route, plus a two-stage retrieval pattern (Stage 1 broad → Stage 2 aggressive exception probing) for high-leverage cases. The AI prompt grounds its output in injected retrieval prose; no new Claude tool-use plumbing is introduced.

**Tech Stack:** Next.js App Router, TypeScript, Drizzle ORM, Anthropic SDK (`claude-sonnet-4-6`), Vitest + happy-dom + PGlite (with `vector` extension) for tests.

**Spec:** [`docs/superpowers/specs/2026-05-08-research-grounded-diagnostic-ai-design.md`](../specs/2026-05-08-research-grounded-diagnostic-ai-design.md)

---

## Architecture note — model B over model A

The spec frames the change as *"the AI calls a research tool."* Two implementation paths:

- **Model A — Claude tool-use protocol.** AI decides when to research and what to query via Claude's tool-calling API. Requires fresh tool-loop plumbing in `tree-engine.ts`. **No existing tool plumbing.**
- **Model B — Orchestrator-driven retrieval.** Orchestrator runs retrieval BEFORE the AI call, validates results, injects them as prose in the user message. AI grounds output in the injected prose. **Matches `buildUpdateTreeWithRetrieval`.**

**This plan uses model B.** Same product outcome with significantly less novel infrastructure. Model A remains an option if AI-driven query selection proves needed later.

---

## Test patterns to reuse (canonical templates)

The implementing engineer should read these as templates BEFORE writing tests in this plan:

- **Anthropic mock pattern:** `tests/unit/tree-engine.test.ts:1-13` — `vi.hoisted` + `vi.mock('@/lib/ai/client', ...)` injecting `mockCreate`. Every AI test in the repo follows this shape.
- **Orchestration pattern:** `tests/unit/wire-into-tree.test.ts` — how `buildUpdateTreeWithRetrieval` is tested (mock retrieval + corpus + validate + tree-engine independently).
- **Intake route pattern:** `tests/unit/intake-submit-route.test.ts` — mocking corpus + tree-engine + auth/db at the API layer.
- **Prompt sanity pattern:** `tests/unit/prompts.test.ts` — string-content assertions on system prompts.
- **PGlite test setup:** `tests/helpers/db.ts:10-35` — `createTestDb()` + the `vector` extension; cold-cache flake noted in memory.

---

## File Structure (across all 5 PRs)

| Phase | Created | Modified |
|---|---|---|
| 1 | `lib/retrieval/wire-into-intake.ts`, `tests/unit/wire-into-intake.test.ts` | `lib/ai/tree-engine.ts`, `app/api/intake/submit/route.ts`, `app/api/sessions/route.ts`, `tests/unit/tree-engine.test.ts`, `tests/unit/intake-submit-route.test.ts` |
| 2 | `tests/integration/research-grounded-tree.test.ts` | `lib/ai/prompts.ts` (TREE_ENGINE_SYSTEM Rung 1), `tests/unit/prompts.test.ts` |
| 3 | `lib/retrieval/two-stage.ts`, `components/screens/research-first-card.tsx`, `tests/unit/two-stage-retrieval.test.ts`, `tests/integration/research-first-card.test.tsx`, `drizzle/migrations/00XX_research_evidence.sql` | `lib/retrieval/wire-into-intake.ts`, `app/(app)/sessions/[id]/page.tsx`, `lib/session-routing.ts`, `lib/db/schema.ts`, `app/api/intake/submit/route.ts`, `lib/intake/session.ts` |
| 4 | `lib/ai/citation-markup.ts`, `components/research/source-link.tsx`, `tests/unit/citation-markup.test.ts` | `lib/ai/prompts.ts`, `components/screens/active-step-form.tsx`, `components/screens/research-first-card.tsx`, `components/screens/repair-conversation.tsx` |
| 5 | — | `lib/ai/prompts.ts` (`updateTree` rules), `components/screens/active-step-form.tsx`, `tests/unit/prompts.test.ts` |

---

## Phase 1 — PR 1: Wire retrieval into intake route

**Goal:** At intake submission, run internet retrieval (Stage 1) + corpus retrieval in parallel; inject results into `generateInitialTree`'s user message. Mirrors `buildUpdateTreeWithRetrieval`.

**Branch:** `feature/research-at-intake` from `origin/main`
**PR title:** `feat(research): wire retrieval into intake route (research-at-session-start plumbing)`

### Task 1.1: Extract reusable `buildRetrievalBlock` helper

The retrieval-block string builder lives inline inside `updateTree` (`lib/ai/tree-engine.ts:133-152`). Extract to module scope so `generateInitialTree` can reuse without duplication.

**Files:** `lib/ai/tree-engine.ts`, `tests/unit/tree-engine.test.ts`

- [ ] **Step 1:** Write a failing test asserting `buildRetrievalBlock(snippets)` is exported, formats validated snippets with source + URL + relevance, and returns empty string for `[]` or `undefined`.
- [ ] **Step 2:** Run the test — expect FAIL (not exported).
- [ ] **Step 3:** Promote the inline string-construction at lines 133-152 of `lib/ai/tree-engine.ts` into a top-level `export function buildRetrievalBlock(snippets?: ValidatedSnippet[]): string`. Replace the inline construction inside `updateTree` with a call to the new helper. Confirm `ValidatedSnippet` field names against `lib/retrieval/types.ts` and `lib/retrieval/validator.ts:7-44`.
- [ ] **Step 4:** Re-run tests — all pass, no regression.
- [ ] **Step 5:** Commit: `refactor(tree-engine): extract buildRetrievalBlock for reuse`

### Task 1.2: Extend `generateInitialTree` to accept retrieval

**Files:** `lib/ai/tree-engine.ts:61-79`, `tests/unit/tree-engine.test.ts`

- [ ] **Step 1:** Write two failing tests: (a) `generateInitialTree(intake, corpus, retrieval)` includes the retrieval block in the user message sent to Anthropic; (b) without retrieval, no `INTERNET RETRIEVAL` substring appears.
- [ ] **Step 2:** Run — expect FAIL (third parameter not accepted).
- [ ] **Step 3:** Update the signature to add `retrieval?: ValidatedSnippet[]`. Concatenate `buildRetrievalBlock(retrieval)` to the user message after `corpusBlock`.
- [ ] **Step 4:** Re-run tests — all pass.
- [ ] **Step 5:** Commit: `feat(tree-engine): generateInitialTree accepts retrieval block`

### Task 1.3: Build intake-time retrieval orchestrator

**Files:** Create `lib/retrieval/wire-into-intake.ts` and `tests/unit/wire-into-intake.test.ts`. Mirror the structure of `lib/retrieval/wire-into-tree.ts`.

- [ ] **Step 1:** Write two failing tests: (a) `buildInitialTreeWithRetrieval` runs `runRetrieval` and `retrieveCorpus` in parallel, validates, then calls `generateInitialTree(intake, corpus, validatedSnippets)`; (b) when `runRetrieval` rejects, the function falls back to empty retrieval and still calls `generateInitialTree`.
- [ ] **Step 2:** Run — expect FAIL (file does not exist).
- [ ] **Step 3:** Implement `buildInitialTreeWithRetrieval(deps)` taking `{ db, intake, adapters, runRetrieval, retrieveCorpus, validate, generateInitialTree }`. Build a `RetrievalContext` from intake (year/make/model/engine/symptom + DTC regex extraction `/\bP[0-9]{4}\b/gi`). Call `runRetrieval` and `retrieveCorpus` via `Promise.all` with `.catch` fail-soft to `{ results: [] }` and `[]` respectively. Validate via `validate({ ctx, results })` if any results returned.
- [ ] **Step 4:** Re-run tests — all pass.
- [ ] **Step 5:** Commit: `feat(research): intake-time retrieval orchestrator`

### Task 1.4: Wire intake routes to the new orchestrator

**Files:** `app/api/intake/submit/route.ts:79-111`, `app/api/sessions/route.ts:51-77` (deprecated parity path), `tests/unit/intake-submit-route.test.ts`

- [ ] **Step 1:** Write a failing test asserting the intake submit route invokes `runRetrieval` exactly once when handling an intake POST.
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Replace the existing `corpus → generateInitialTree` block with a `buildInitialTreeWithRetrieval(...)` call. Pass `runRetrieval` from `@/lib/retrieval/orchestrator`, `validateRetrievalResults` from `@/lib/retrieval/validator`, `retrieveCorpus` from `@/lib/corpus/retrieval`, `generateInitialTree` from `@/lib/ai/tree-engine`. For `adapters`, locate the existing adapter list in `app/api/sessions/[id]/advance/route.ts:39-55` and either export it as `getInternetAdapters()` or duplicate inline. Apply the same change to the deprecated `app/api/sessions/route.ts:51-77` for parity.
- [ ] **Step 4:** Re-run tests — all pass.
- [ ] **Step 5:** Commit: `feat(research): intake routes call retrieval orchestrator`

### Task 1.5: PR-level validation + ship

- [ ] Full test suite: `pnpm test` (rerun once on PGlite cold-cache flake per memory).
- [ ] Typecheck: `pnpm typecheck` clean.
- [ ] Push branch + open PR: `git push -u origin feature/research-at-intake`, then `gh pr create --base main --title "..."`.
- [ ] **Live shop validation (Brandon):** open the 2020 F-250 P0087 case on the Vercel preview URL. Confirm the AI's tree-gen output now references retrieval evidence (forum threads, NHTSA recalls, manufacturer-recall pages). Verify the wrong "Schrader on top of filter housing" claim is corrected once retrieval context is injected.
- [ ] Merge: `gh pr merge --squash --delete-branch`. Production auto-deploys.

---

## Phase 2 — PR 2: Prompt update for research-grounded operation

**Goal:** Update `TREE_ENGINE_SYSTEM` so the AI grounds vehicle-specific procedural output in injected retrieval and explicitly admits uncertainty when evidence is thin or contradictory.

**Branch:** `feature/research-grounded-prompt` from `origin/main` (containing PR 1)
**PR title:** `feat(research): tree-engine prompt grounded in retrieval + uncertainty admission`

### Task 2.1: Add grounding rules to TREE_ENGINE_SYSTEM

**Files:** `lib/ai/prompts.ts:61-64`, `tests/unit/prompts.test.ts`

- [ ] **Step 1:** Write a failing test asserting the system prompt contains the strings: "vehicle-specific" + "procedural", "ground" or "cite" or "evidence", "no authoritative source" or "verify in the field" or "i don't know", "fragmented" or "contradictory".
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Replace the existing Rung 1 INTERNET RETRIEVAL block (lines 61-64) with expanded language covering five rules: (1) GROUND every vehicle-specific procedural claim in evidence (locations, test methods, specs, system layouts, repair procedures); (2) CITE inline using `[source: <url>]`; (3) ADMIT UNCERTAINTY when evidence is thin or contradictory ("one source reports X — verify in field" / "sources disagree A vs B" / "no authoritative source found"); (4) NEVER FILL IN vehicle-specific physical/procedural details from training when retrieval is available — training is for interpretation, retrieval is for facts; (5) CONFIDENCE flows from retrieval consensus — use hedged language ("looks like", "lots of people online say", "worth checking").
- [ ] **Step 4:** Re-run prompt tests — all pass.
- [ ] **Step 5:** Commit: `feat(research): TREE_ENGINE_SYSTEM grounding + uncertainty rules`

### Task 2.2: Integration test against the F-250 case

**Files:** Create `tests/integration/research-grounded-tree.test.ts`.

- [ ] **Step 1:** Write a failing integration test that runs `generateInitialTree` with F-250 retrieval fixtures (forum sources documenting actual filter-housing port location + CP4 production-window match). Assert: (a) the captured user message includes the retrieval URLs; (b) the returned tree's node rationales reference the source URLs; (c) NO node references "top of filter housing" (the prior hallucination).
- [ ] **Step 2-4:** Standard TDD cycle.
- [ ] **Step 5:** Commit: `test(research): integration test for F-250 grounding`

### Task 2.3: PR-level validation + ship — the architectural thesis check

- [ ] Full test suite + typecheck.
- [ ] **Live shop validation:** on the Vercel preview URL: re-run **F-250 P0087** — confirm AI grounds Schrader port in retrieval, surfaces CP4 production-window match, admits uncertainty on anything not retrieval-covered. Re-run **2009 Ram P0171/P0174** — confirm AI surfaces brake-booster vacuum leak as a candidate when retrieval includes the documented forum threads.
- [ ] Push, open PR, merge after Brandon OK.

---

## Phase 3 — PR 3: Two-stage retrieval + research-first card

**Goal:** When intake-time Stage 1 retrieval shows strong consensus, run an aggressive Stage 2 expansion (probing for documented exceptions / TSBs / fix-not-holding patterns). Surface combined findings to the tech as a "Heads up — looks like a known thing" card BEFORE the diagnostic tree generates.

**Largest PR.** Multi-task, spans DB, orchestration, UI.

**Branch:** `feature/two-stage-research-first-card` from `origin/main` (containing PRs 1+2)
**PR title:** `feat(research): two-stage retrieval + research-first card surface`

### Task 3.1: Schema migration — `sessions.research_evidence`

**Files:** Create `drizzle/migrations/00XX_research_evidence.sql` (next sequential number). Modify `lib/db/schema.ts:90-104`. Add `tests/unit/db-schema.test.ts` if not present, otherwise extend.

- [ ] **Step 1:** Write a failing test inserting a session row with a populated `researchEvidence` jsonb (shape: `{ stage1, stage2, surfaced, acted, consensusSummary? }`).
- [ ] **Step 2:** Run — expect FAIL (column missing).
- [ ] **Step 3:** Add migration: `ALTER TABLE sessions ADD COLUMN research_evidence JSONB;`. Extend the Drizzle schema with `researchEvidence: jsonb('research_evidence').$type<ResearchEvidence | null>().default(null)`. Define and export the `ResearchEvidence` type with fields `stage1: ValidatedSnippet[]`, `stage2: ValidatedSnippet[] | null`, `surfaced: boolean`, `acted: boolean`, `consensusSummary?: string`.
- [ ] **Step 4:** Re-run tests — pass.
- [ ] **Step 5: Apply migration to live Supabase** *(critical, per memory `feedback_apply_migration_to_live_db.md`)*. Use Supabase MCP `apply_migration` with the same SQL. Verify column is live in production before merging the PR.
- [ ] **Step 6:** Commit: `feat(research): add sessions.research_evidence column`

### Task 3.2: Stage 2 expansion query generator

**Files:** Create `lib/retrieval/two-stage.ts` and `tests/unit/two-stage-retrieval.test.ts`.

Two functions: `hasConsensus(stage1: ValidatedSnippet[]): boolean` returning true when at least 3 snippets have relevance >= 0.7. `generateExpansionQueries(ctx: RetrievalContext, stage1): string[]` returning aggressive expansion queries when consensus is found, otherwise `[]`.

Templates for v1 (concrete strings, vehicle + symptom interpolated):
- `"<vehicle> <symptom> TSB recall"`
- `"<vehicle> <DTC> fix not holding deeper cause"`
- `"<vehicle> <symptom> brake booster"`
- `"<vehicle> <DTC> ground strap corroded"`
- `"<vehicle> <symptom> unusual cause uncommon"`

- [ ] **Step 1:** Write three failing tests: (a) `generateExpansionQueries` returns >= 2 queries when Stage 1 has consensus, with at least one matching `/(brake booster|TSB|deeper cause|not holding|fix failed)/i`; (b) returns `[]` when Stage 1 lacks consensus; (c) `hasConsensus` thresholds — empty fails, single high-relevance fails, three at >= 0.7 passes, three below 0.7 fails.
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Implement both functions per the templates above.
- [ ] **Step 4:** Re-run — pass.
- [ ] **Step 5:** Commit: `feat(research): two-stage expansion query generator`

(*v1 uses templates. If real-shop validation shows templates miss patterns — e.g., diesel-only ground-strap probes — upgrade later to a small AI call that generates expansion queries from Stage 1 content.*)

### Task 3.3: Wire two-stage retrieval into intake orchestrator

**Files:** `lib/retrieval/wire-into-intake.ts`, `tests/unit/wire-into-intake.test.ts`

- [ ] **Step 1:** Write two failing tests: (a) when Stage 1 has consensus, the orchestrator calls `runRetrieval` twice (Stage 1 + Stage 2 expansion), and `generateInitialTree` receives combined snippets; (b) when Stage 1 lacks consensus, only one `runRetrieval` call.
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Extend `buildInitialTreeWithRetrieval` to call `hasConsensus(validated)` after Stage 1; if true, call `generateExpansionQueries` + `runRetrieval` again with `additionalQueries`, validate, merge into combined retrieval. Change return signature to `Promise<{ tree: TreeState; evidence: ResearchEvidence }>` so the caller can persist evidence to the session row.
- [ ] **Step 4:** Re-run — pass.
- [ ] **Step 5:** Commit: `feat(research): two-stage retrieval — Stage 2 fires on Stage 1 consensus`

### Task 3.4: Persist research evidence to session row

**Files:** `app/api/intake/submit/route.ts`, `lib/intake/session.ts` (the `createSessionFromIntake` helper — *implementing engineer should read first to understand customer/vehicle upsert flow*), `tests/unit/intake-submit-route.test.ts`

- [ ] **Step 1:** Write a failing test asserting that after a successful intake POST with Stage 2-surfaced findings, the resulting session row has `researchEvidence.surfaced === true` and `researchEvidence.stage2` populated.
- [ ] **Step 2-4:** Standard TDD cycle. The intake route captures the `evidence` from `buildInitialTreeWithRetrieval` and passes it through `createSessionFromIntake` to write the new column.
- [ ] **Step 5:** Commit: `feat(research): persist research evidence to session row`

### Task 3.5: Research-first card component

**Files:** Create `components/screens/research-first-card.tsx` and `tests/integration/research-first-card.test.tsx`.

The card renders: a "Heads up — looks like a known thing" headline; the consensus summary if present; a collapsible "See source links" listing all `stage1` + `stage2` URLs with `[<source>] <title>` + relevance badge; two action buttons (`Run verification`, `Skip — walk the tree`).

- [ ] **Step 1:** Write a failing integration test rendering the component with fixture evidence (one Stage 1 snippet + one Stage 2 snippet representing the Camry pulled-threads case). Assert headline, consensus text, both source links present, both action buttons present + clickable (calling `onVerify` / `onSkip` mocks respectively).
- [ ] **Step 2-4:** Implement the component using the project's existing UI primitives — read `components/ui/` first for established button/card patterns; replace inline Tailwind with the project pattern.
- [ ] **Step 5:** Commit: `feat(research): research-first card component`

### Task 3.6: Wire card into session routing

**Files:** `lib/session-routing.ts:25-41`, `app/(app)/sessions/[id]/page.tsx:14-58`, `tests/unit/session-routing.test.ts`. Add server action `markResearchActed(sessionId, action)` likely in `app/(app)/sessions/[id]/actions.ts` (*implementing engineer locates the existing pattern*).

- [ ] **Step 1:** Write two failing tests: (a) `routeForSession` returns `{ kind: 'research-first-card' }` when `researchEvidence.surfaced === true && acted === false`; (b) returns `{ kind: 'tree-generating' }` after `acted === true`.
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Add `'research-first-card'` to the `SessionRoute` union. Extend `routeForSession` to check the surfaced/acted gate before falling through to `tree-generating`. In the page component, render `ResearchFirstCard` when `route.kind === 'research-first-card'`. The card's `onVerify` / `onSkip` handlers call the `markResearchActed` server action which sets `acted: true` and reloads.
- [ ] **Step 4:** Re-run — pass.
- [ ] **Step 5:** Commit: `feat(research): route to research-first card when evidence surfaced`

### Task 3.7: PR-level validation + ship

- [ ] Full test suite + typecheck.
- [ ] **Apply migration to live Supabase BEFORE merge** (critical per memory).
- [ ] **Live shop validation:** on the Vercel preview URL, re-run the **2004 Camry valve cover oil leak** case. Confirm Stage 1 returns valve-cover gasket consensus, Stage 2 expansion finds the pulled-threads TSB, the tech lands on the research-first card with both surfaced, source-link click-through works, both `Run verification` and `Skip — walk the tree` advance correctly. Re-run the **2009 Ram P0171/P0174** case — confirm Stage 2 surfaces the brake-booster pattern.
- [ ] Push, open PR, merge after approval.

---

## Phase 4 — PR 4: Source-link affordance on all research outputs

**Goal:** Make AI-emitted source citations clickable everywhere (research-first card, tree steps, repair guidance).

**Branch:** `feature/source-link-affordance` from `origin/main` (containing PRs 1-3)
**PR title:** `feat(research): source-link affordance on all research outputs`

### Task 4.1: Citation markup parser

**Files:** Create `lib/ai/citation-markup.ts` and `tests/unit/citation-markup.test.ts`.

Parser exports `parseCitations(text: string): CitationSegment[]` where each segment is `{ kind: 'text'; text } | { kind: 'cite'; url }`. Recognizes inline `[source: <url>]` markers and splits text accordingly.

- [ ] **Step 1:** Write two failing tests: (a) text with two markers returns alternating text and cite segments in order; (b) plain text with no markers returns a single text segment.
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Implement using `String.matchAll` over the pattern `\[source:\s*([^\]]+)\]` — split into segments by index, push remaining text after the last match.
- [ ] **Step 4:** Re-run — pass.
- [ ] **Step 5:** Commit: `feat(research): citation markup parser`

### Task 4.2: Citation rendering component

**Files:** Create `components/research/source-link.tsx`. Component `SourceLinkText({ text })` parses citations and renders text segments inline + cite segments as small `[src]` external-target links with the URL as the `title` attribute.

Standard TDD cycle. Commit: `feat(research): SourceLinkText rendering component`

### Task 4.3: Update prompt to emit citation markup

**Files:** `lib/ai/prompts.ts`, `tests/unit/prompts.test.ts`. Add an explicit instruction inside TREE_ENGINE_SYSTEM: *"When citing a source for a vehicle-specific fact, use the format `[source: <full-url>]` inline immediately after the claim. Render only the URL, not the title."* Add a prompt assertion test for the format string.

Commit: `feat(research): TREE_ENGINE_SYSTEM emits inline source citations`

### Task 4.4: Render citations everywhere they appear

**Files:**
- `components/screens/research-first-card.tsx` — wrap snippet display with `SourceLinkText`
- `components/screens/active-step-form.tsx` — wrap `currentNode.label` and `proposedAction.description`
- `components/screens/repair-conversation.tsx` — wrap AI message bodies

Integration tests for each surface; verify citation links render and click through correctly. Commit: `feat(research): render inline source links across all AI surfaces`

### Task 4.5: PR-level validation + ship

Live shop validation: open any case from the F-250 / Camry / Ram set on preview, confirm `[src]` links appear inline next to vehicle-specific claims and click through to real evidence pages.

---

## Phase 5 — PR 5: Mid-session research-on-demand UI polish

**Goal:** Apply the research-grounded prompt rules to `updateTree` (already retrieval-wired). Enforce hedged language and uncertainty admissions. Surface "I'm not sure on this generation" cleanly in the active session UI.

**Branch:** `feature/mid-session-research-polish` from `origin/main` (containing PRs 1-4)
**PR title:** `feat(research): mid-session research-on-demand UI polish`

### Task 5.1: Update `updateTree` prompt rules

**Files:** `lib/ai/prompts.ts`, `tests/unit/prompts.test.ts`. Apply the same grounding/uncertainty rules from PR 2 to the `updateTree` call path. Confirm hedged language is the default; "no authoritative source found" is the explicit option.

Standard TDD cycle. Commit: `feat(research): updateTree prompt enforces hedged language + uncertainty`

### Task 5.2: Surface uncertainty admissions visibly

**Files:** `components/screens/active-step-form.tsx`. Helper `confidenceBadge(text)` returns:
- `'verified'` (green badge: *"AI verified evidence"*) when text contains `[source:` markers
- `'uncertain'` (amber badge: *"AI uncertain — verify in the field"*) when text contains `"no authoritative source found"` or `"verify in the field"`, or when text starts with hedged markers (`looks like`, `lots of people online say`, `worth checking`)
- `null` (no badge) otherwise

TDD cycle for the rendering logic on `currentNode.label` and `proposedAction.description`. Commit: `feat(research): inline AI-confidence badge based on grounding signals`

### Task 5.3: PR-level validation + ship

Live shop validation: re-run F-250 mid-session on preview. Generate observations, confirm `proposedAction.description` either cites sources (verified badge) or admits uncertainty (uncertain badge). Confirm Brandon's "Schrader port" complaint disappears entirely from any future generations of the tree.

---

## Out-of-scope deferrals (future PRs after v1)

Captured here so the spec's deferred list is preserved:

- **Source-quality filtering** (forums + TSB pages > generic SEO clutter). The validator already filters on `relevance >= 0.4`; future PR adds source-type weighting.
- **Cross-shop corpus integration** ("From your shop" line). Today's corpus is per-shop; cross-shop anonymized sharing requires privacy posture decisions.
- **Curator review of research-grounded outputs.** Phase P curator exists; integrating research outputs into the curator flow is future.
- **Cost / latency budgeting.** Caching, rate-limits, request throttling are future.

---

## Open decisions for in-task implementation

These are concrete decisions the engineer makes during implementation:

1. **Stage 2 query templates vs AI-generated queries.** Task 3.2 implements templates. If validation shows templates miss patterns (e.g., the high-resistance ground-strap pattern only surfacing for diesels), upgrade to a small AI call that generates expansion queries from Stage 1 results.
2. **Caching of Stage 1 + Stage 2 results.** `lib/retrieval/cache.ts` already exists for adapter-level caching. Whether to also cache the validated combined output keyed on `(vehicle, symptom, dtcs)` is an in-task call once latency is measured.
3. **Confidence thresholds.** Task 3.2 uses consensus = 3 snippets at >= 0.7 relevance. Calibrate against real shop sessions during PR 3 validation; tune in a follow-up PR if needed.
4. **Feature flag rollout vs full ship.** Each PR ships behind no flag (full rollout) per Brandon's marathon discipline. If preview validation reveals scale concerns, add a feature flag inside that PR rather than as a follow-on.

---

## Self-review

- ✅ **Spec coverage** — every numbered section in the spec maps to at least one PR/task above (doctrine → PR 2 prompt; problem → PR 1+2 corrects existing failures; one universal change → PR 1+2 implements; two-stage pattern → PR 3; three surfaces → PRs 3+5+4 respectively; confidence behavior → PR 2+3+5; out-of-scope → captured above).
- ✅ **Placeholder scan** — no "TBD" / "implement later" / "similar to Task N" without code; each task names concrete file paths and points at canonical test patterns the engineer reuses.
- ✅ **Type consistency** — `ValidatedSnippet`, `ResearchEvidence`, `RetrievalContext`, `IntakeInput`, `TreeState`, `CorpusMatch` referenced consistently across phases. `ResearchEvidence` defined in PR 3 Task 3.1.
- ✅ **Scope check** — single architectural plan (research-grounded operation), 5 sequential PRs, each shippable on its own; not multiple subsystems requiring decomposition.

---

## Execution

Plan saved. Two execution options per the writing-plans skill:

1. **Subagent-Driven (recommended)** — fresh subagent per task with two-stage review between tasks. Best for marathon discipline; matches Brandon's "small PRs, validate each" preference.
2. **Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batched with checkpoints.

Brandon to choose.
