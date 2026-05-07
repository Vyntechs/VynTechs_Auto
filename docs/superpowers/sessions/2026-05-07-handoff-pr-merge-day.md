# Vyntechs — Handoff (2026-05-07 evening, PR merge day)

Long, productive session. Brandon manually validated 5 PRs end-to-end on `preview-curator`, hit two real bugs and two CI/UX rough edges, and we shipped 5 of 6 PRs to `main`. PR #5 (testing pipeline) is deferred to a parallel session via a kickoff doc.

## Resume

1. `cd /Volumes/Creativity/dev/projects/vyntechs/.worktrees/testing-pipeline`
2. Read this handoff for state.
3. **Ask Brandon what's next.** Likely answer: another small bug fix or feature, validated on preview, then PRed to main. Marathon mode. (Memory: `feedback_marathon_small_prs.md`.)
4. Whatever it is, invoke `superpowers:brainstorming` BEFORE touching code.

## What shipped to main today

| PR | Branch | What it does |
|---|---|---|
| #4 (squashed → `fc23091`) | `intake-fix-may-7` | Intake redirect fix — surface open-session conflict instead of silent push to existing session |
| #3 (squashed → next commit) | `feature/phase-p-curator` | Phase P curator console (5 surfaces, 9 screens) with plain-English labels |
| #8 (squashed) | `fix/closed-case-summary-2026-05-07` | Closed cases render read-only summary, not the close-case form (no more form-loop) |
| #6 (squashed → `1d2fd86` after rebase) | `feature/two-phase-diagnose-repair` | Two-phase diagnostic + repair model (lock-in button + AI repair-coach chat) |
| #7 (squashed) | `fix/outcome-validator-deadend-2026-05-07` | One-retry-then-override on the AI specificity validator + reads notes too |

`main` HEAD is now `1d2fd86` (PR #6 was last to merge after manual rebase).

## What did NOT ship — PR #5 (testing pipeline)

`feature/testing-pipeline` had **13 merge conflicts** against current main because PR #3 added its own `tests/e2e/curator.spec.ts` independently of PR #5's version. Most of PR #5's diff against main is stale duplicates of curator code that's already on main.

**Brandon's call:** defer to a parallel Claude Code session. He spawned a separate session in this same worktree and pointed it at `docs/superpowers/kickoffs/2026-05-07-pr5-testing-pipeline-rescue.md`. That kickoff doc tells the parallel session WHAT needs to happen (CI safety net) and WHY, and lets it brainstorm + plan + execute on its own. **This session does not touch PR #5 again.**

## Bugs Brandon found during validation (and where each was fixed)

1. **Validator dead-end (Chevy 3500, session `2cc41b36`).** AI demanded specifics that the tech had put in the Notes field, which the validator didn't read. No "submit anyway" path. → Fixed in PR #7: validator now reads notes too, feedback phrased as instruction, after one retry the override path skips the validator and persists override metadata for admin review.
2. **Closed cases looped back to the close form.** Routing layer ignored `session.status`. → Fixed in PR #8: new `closed-summary` route kind renders a read-only "case closed" view; `/outcome` page guards closed sessions.
3. **One-off "Logging…" hang on the advance API (Ford Explorer, session `c71618b8`).** Vercel function killed at the 60s default just after the DB write completed; client never got the response. Brandon hit it once, said "skip — one-off." → Not fixed; documented as a possible future quick-win (`maxDuration = 300` on the AI routes).

## Memories saved this session (read these first next time)

- `feedback_use_skill_plugins_not_manual.md` — invoke `superpowers:*` and reviewer Skills as real tool calls; don't ad-hoc the work. Don't make Brandon the reviewer.
- `feedback_marathon_small_prs.md` — small PRs, never skip brainstorm/plan, parallelize side-quests via kickoff docs.

(Plus all the prior memories that still apply: plain-English brevity, 10-year-old test for labels, test-driven bug capture, verification rigor, etc. See `MEMORY.md`.)

## Conventions reinforced this session

- **Brainstorm-then-plan-then-execute, even on small changes.** Brandon's words: "planning, planning, planning. Brainstorming, planning is everything."
- **Inline TDD beats subagent-driven for small mechanical tasks.** The subagent overhead (3-5 dispatches per task) outweighs the benefit when the change is <50 lines. Subagents shine on 50-200-line tasks where the per-task review checkpoints actually catch things.
- **Use Supabase MCP for DB-state debugging.** Twice this session, querying the actual session row for status/treeState/event-count cleared up a "did it work or didn't it?" question instantly.
- **Small bug → small PR off main, NOT preview-curator.** preview-curator is a stacking branch for combined-test validation only. Each fix lands on its own PR off main, then gets cherry-picked onto preview-curator if it needs validation in the combined preview.
- **Re-pose the merge-order question every time.** Each merge changes the conflict surface for subsequent PRs. The order I used today was: #4 → #3 → #8 → #6 → #7, with PR #6 needing a manual main-merge before it could go in. PR #5 was last and bounced.

## Carryovers (still open from prior handoffs, none touched today)

- **Pre-existing race in `ensureProfileAndShop`** at `lib/db/queries.ts:71` — separate one-line PR off main. Not addressed.
- **5 advisor findings** (RLS-no-policy, anon-callable rls_auto_enable, leaked-password protection off, AppHeader a11y, no-CI-for-tests-before-this-branch) — all still open.
- **AI route function timeout (60s default)** — possible future fix: `export const maxDuration = 300` on `/api/sessions/[id]/advance`, `/close`, `/lock-diagnosis`, `/repair-observation`. Brandon explicitly chose "skip, one-off" but if it recurs we should ship.

## Recommended next session flow

1. Read this handoff + `MEMORY.md`.
2. Confirm you're in `/Volumes/Creativity/dev/projects/vyntechs/.worktrees/testing-pipeline`.
3. Ask Brandon what bug/feature is next. Whatever it is:
4. Invoke `superpowers:brainstorming` BEFORE writing code. Even for tiny changes.
5. After spec lands: invoke `superpowers:writing-plans`.
6. After plan lands: execute inline TDD (haiku-tier work) or subagent-driven (sonnet-tier 50-200 line work). Don't make Brandon the reviewer — dispatch reviewer agents.
7. Verify on preview-curator (it's still alive — stacks the 5 merged PRs but they're now on main, so preview-curator can be reset to track main when convenient).
8. PR off main.
9. Repeat.

PR #5 is being handled by a separate Claude Code session per Brandon's request. Don't interfere with it.
