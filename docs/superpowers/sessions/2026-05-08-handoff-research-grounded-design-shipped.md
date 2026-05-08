# Handoff — Research-Grounded Diagnostic AI Design + Plan Shipped

**Date:** 2026-05-08 (afternoon session)
**For:** The next Claude Code session that picks up vyntechs development.
**Reason for handoff:** Brainstorm → spec → plan flow complete. PR #12 (docs only) is being merged. Brandon is clearing context to start **inline execution** of PR 1.

## TL;DR

A multi-spike brainstorm on the diagnostic AI engine converged on a single architectural change — *the AI grounds every vehicle-specific claim in research, not training* — and a 5-piece implementation plan. The design spec and the implementation plan are in the repo at:

- Spec: `docs/superpowers/specs/2026-05-08-research-grounded-diagnostic-ai-design.md`
- Plan: `docs/superpowers/plans/2026-05-08-research-grounded-diagnostic-ai.md`

PR #12 lands the kickoff + spec + plan + this handoff into main.

## What was decided this session

The original kickoff (`docs/superpowers/kickoffs/2026-05-07-diagnostic-research-first.md`) was broadened during the brainstorm into a doctrine: **research-grounded operation across the entire diagnostic engine, not just at session start.** That conclusion came from four spike tests:

1. **Spike 1 (4 invented cases)** — simplest single-search test. 3.5 of 4 correct. Camry was the failure that proved Stage 2 must always run when Stage 1 has consensus.
2. **Spike 2 (7 real shop cases from Brandon's DB)** — universal-applicability test. 5 of 6 correct with proper queries.
3. **Spike 3 (re-test obscure-cause cases)** — brake-booster pattern WAS findable with sharper queries → 6+ independent sources → would have shortcut a 168-min Ram diagnosis. Proved **query strategy is its own engineering work**.
4. **Spike 4 (live F-250 P0087 — actively in Brandon's shop)** — caught three wrong physical-layout claims, surfaced CP4 production-window match, surfaced documented BJB burnt-terminal alternative cause.

The architectural answer in one sentence: *"The AI calls a research tool before producing any vehicle-specific procedural output. Output is grounded in what research returns. If research is fragmented or contradictory, AI says so. If no relevant data, AI says 'no authoritative source found — verify in the field.'"*

## The 5 PRs

Each branches from current `origin/main`, validated on Vercel preview, merged independently. Listed in dependency order:

1. **PR 1 — `feature/research-at-intake`** — wire retrieval into the intake API route (mirror the existing `wire-into-tree.ts` pattern that already runs on observations). Plumbing only.
2. **PR 2 — `feature/research-grounded-prompt`** — update `TREE_ENGINE_SYSTEM` with grounding + uncertainty rules. *The architectural thesis check.* Validates by re-running the F-250 case live and watching the wrong-Schrader claim disappear.
3. **PR 3 — `feature/two-stage-research-first-card`** — two-stage retrieval (Stage 1 broad → Stage 2 aggressive expansion when consensus found) + the "Heads up — looks like a known thing" card BEFORE diagnostic tree generates. Largest PR. Includes a schema migration for `sessions.research_evidence`.
4. **PR 4 — `feature/source-link-affordance`** — inline `[source: <url>]` citation parsing + clickable rendering across all AI surfaces.
5. **PR 5 — `feature/mid-session-research-polish`** — apply grounding rules to `updateTree` flow + AI-confidence badges (verified / uncertain).

## Mode: inline execution

Brandon chose inline execution over subagent-driven. Next session works through PR 1 tasks in its main context using the `superpowers:executing-plans` skill, batched with checkpoints. Brandon validates on the Vercel preview URL after each task or at logical breakpoints.

## Architectural decisions in the plan (already approved by Brandon — don't relitigate)

- **Model B over Model A.** Orchestrator-driven retrieval (extending `wire-into-tree.ts`) instead of introducing Claude tool-use protocol. Simpler; matches existing patterns.
- **Stage 2 expansion = templates in v1.** Hard-coded query templates (`<vehicle> <symptom> brake booster`, `<vehicle> <DTC> ground strap corroded`, etc.). Upgradeable later if real-shop validation shows gaps.
- **Confidence threshold = 3 snippets at >= 0.7 relevance** for Stage 2 firing. Calibrate during PR 3 validation; tune in a follow-up if needed.
- **No feature flags.** Each PR ships full rollout per Brandon's marathon discipline. Add a flag *inside* a PR only if preview validation reveals scale concerns.

## Memory rules saved this session (durable across all future sessions)

- `feedback_no_invented_problems.md` — don't introduce hypothetical future-state risks as design constraints during brainstorm
- `feedback_ai_as_tool_not_truth.md` — frame AI output as evidence-with-sources, not authoritative conclusions
- `feedback_research_not_training.md` — AI must research vehicle-specific claims; consensus = trust, fragmented = doubt → fact-check, no data = honest "I don't know"
- `feedback_let_the_test_answer.md` — never pre-classify cases as "rare/unsearchable" before running the test
- `project_vyntechs_product_goal.md` — north-star: AI a master tech actually trusts; trust = moat
- `feedback_no_jargon_in_decision_summaries.md` — plan/decision summaries to Brandon must be plain-English user-impact, never architecture talk
- Updated `feedback_subagent_model_choice.md` + `feedback_research_phase_zero.md` — **Sonnet (not Haiku)** for web research subagents going forward

## Branch state

- `docs/handoff-pr1-shipped`: this branch. PR #12 contains:
  - `2fbbd12` — earlier today's PR-1-shipped handoff + 3 deferred-work kickoffs
  - `ccd330c` — research-grounded AI design spec
  - `e794e7f` — research-grounded AI implementation plan
  - + this handoff doc (next commit)
- `main`: PR-1 (counter intake persistence) at `6792e81`. Production.
- `preview-curator`: **deprecated for new feature work** (`feedback_branch_from_main_for_new_work.md`).

## Things you must NOT do without Brandon's explicit go

- Do not merge PR #12 yourself; Brandon merges.
- Do not start ANY of the 5 feature PRs until PR #12 is merged to main.
- Do not push `preview-curator`.
- Do not skip the live shop validation step on each PR. Brandon validates on real cases from his shop DB (F-250 / Camry / Ram / Silverado / etc.) — that's the architectural thesis check.
- Do not change the agreed Model-B architectural choice without his go.
- Do not touch the in-progress F-250 session row (`1ee26bcd`) — that's Brandon's real diagnostic in progress.

## Suggested first actions for the next session

1. **Read `MEMORY.md` fully.** Several new rules from this session, including the "no jargon in summaries" rule and the Sonnet-not-Haiku research model choice.
2. **Verify PR #12 is merged to main.** Use `gh pr view 12` or `git log origin/main` to confirm.
3. **Read the spec and the plan:**
   - `docs/superpowers/specs/2026-05-08-research-grounded-diagnostic-ai-design.md`
   - `docs/superpowers/plans/2026-05-08-research-grounded-diagnostic-ai.md`
4. **Branch correctly per the rule:** `git fetch origin && git checkout main && git pull && git checkout -b feature/research-at-intake`. Confirm SHA matches origin/main.
5. **Invoke the `superpowers:executing-plans` skill** to work through PR 1's 5 tasks task-by-task with checkpoints.
6. **PR 1 Task 1.1 first:** extract a reusable `buildRetrievalBlock` helper out of `lib/ai/tree-engine.ts:133-152` so `generateInitialTree` can reuse it. Standard TDD cycle per the plan.

## Quick numbers

- Memory file count: now 25 entries in MEMORY.md (was 19 at session start).
- Spike subagent runs: 4 (Sonnet/Haiku web research + Opus codebase mapping).
- New docs committed this session: spec (208 lines) + plan (342 lines) + this handoff.

## Brandon's signaled next task

PR 1 of the 5-piece plan: wire retrieval into the intake route. Inline execution. Validate on Vercel preview before merge. Then PR 2 in the same session if context allows, or fresh session per PR — Brandon's call.
