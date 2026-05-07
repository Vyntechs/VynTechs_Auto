# Vyntechs — Handoff (2026-05-06, Session 12: Phase P 13/18 done, 5 tasks remain)

Slim per AGENTS.md. Phase P implementation in progress on `feature/phase-p-curator`. 13/18 tasks merged, 3 prod migrations applied, 5 tasks left (mostly UI). Production untouched.

## Resume

1. `cd /Volumes/Creativity/dev/projects/vyntechs && git checkout feature/phase-p-curator && git pull origin feature/phase-p-curator` (push first if local-only). HEAD should be `deab1fb`.
2. Verify baseline: `pnpm test && pnpm exec tsc --noEmit && pnpm build`. Expect **423/423**, tsc clean, build clean.
3. Read this handoff. Read `docs/superpowers/specs/2026-05-06-phase-p-curator-design.md`. Plan corrections section at top of `docs/superpowers/plans/2026-05-06-phase-p-curator-implementation.md` is authoritative for path translations and decisions.
4. Pick up at **Task 14** (Novel-pattern queue page, Screen 7). Plan text starts at line 2109. Continue through Tasks 15 → 16 → 17 → 18 → 19 (final review).
5. Use `superpowers:subagent-driven-development` for the remaining tasks (same pattern as 1–13).

## State

**Branch:** `feature/phase-p-curator` at `deab1fb` (16 commits ahead of `main`).
**Tests:** 423/423 passing.
**Schema (live, prod):** 3 Phase P migrations applied:
- `0011_drift_alerts_lifecycle` — 4 lifecycle cols + partial idx on `drift_alerts`; new `novel_pattern_queue` table with RLS curator-only.
- `0011a_session_curator_columns` — `curator_note`, `curator_override_action` on sessions.
- `0011b_session_max_corpus_similarity` — `max_corpus_similarity real` on sessions; written by `wire-into-tree.ts` during retrieval, read at close.

**Production (`vyntechs.dev`):** still on `main` head `5d7065b`. Untouched by this session.

## Tasks remaining (5 + final review)

- **14:** Novel-pattern queue page (Screen 7). UI list. Reads `novel_pattern_queue` JOIN `sessions` where `reviewed_at IS NULL`. Plan template at line 2109 — **NOTE the plan's flat session columns assumption is wrong; vehicle/complaint live in `intake` JSONB** (Task 4 lesson, repeats every UI task).
- **15:** Novel-pattern dismiss handler (TDD, 1 case). Pattern mirrors Task 7's drift handlers. New API route at `app/api/curator/novel/[id]/dismiss/route.ts`.
- **16:** Corpus authoring form + POST handler (TDD, 2 cases). Form pre-fills from `?fromCase=<sessionId>` query param. Insert into `corpus_entries` with `is_curator_entry=true`, `source_session_id=NULL`, `source_shop_id=NULL`.
- **17:** Corpus list (Screen 9) — read-only table.
- **18:** Pre-deploy verification. Brandon's call at session start was option (b) — extend Playwright smoke at `tests/e2e/landing.spec.ts` pattern with authed `/curator/*` routes. Also: grant Brandon's profile `role='curator'` in prod via MCP `execute_sql` (Brandon's UUID needed) before authed-flow verification.
- **19:** Final code reviewer subagent over the whole branch + `superpowers:finishing-a-development-branch` to open the PR.

## Pattern lessons baked into the codebase

These are now live conventions any new curator code follows:

- Path corrections are documented at top of the plan file. Apply them per task — drop `apps/diagnostic/`, use `@/` aliases.
- Session JSON fields: `intake` → vehicle/complaint, `outcome` → tech action/notes/rootCause, `treeState` → AI proposed action, `status` enum (no `'in_progress'` — use `'open'`).
- Tests use UUID-format strings only; the auth.uid stub for PGlite lives in `tests/helpers/db.ts`.
- `parseRisk` lives at `@/lib/curator/parse-risk` — reuse for any RiskClass URL param validation.
- vt design tokens: `--vt-fg-3` not `--vt-fg-muted`. `--vt-accent` for navigation emphasis. No invented tokens.
- `unwrapRows` at `@/lib/db/unwrap-rows`; cell-SQL fragments at `@/lib/calibration/cell-sql` — shared across calibration cron + curator drill-down.
- Form submits use `router.refresh()` not `window.location.reload()`; check `res.ok` and surface errors via `role="alert"`.
- Drizzle SQL templates render unqualified column names — for self-join EXISTS subqueries, write plain SQL identifiers (gotcha caught in Task 5).

## Code-review track record (worth knowing)

The two-stage review (spec compliance → code quality) caught **4 silent production bugs** during 1–13: 
1. Auth.uid CREATE OR REPLACE would have overwritten Supabase's real auth function (Task 1).
2. `closedAt IS NULL` filter on deferred queue would have returned zero rows (Task 11).
3. Crash path in case detail when `declineOrDefer.language` was structurally incomplete (Task 4).
4. Novel-pattern trigger was inert — route never passed the score (Task 13).

None would have been caught by tests-as-written. Continue running both review stages per task; consider single-stage review only for tasks 17 (read-only list) where risk is minimal.

## Carryovers from prior handoffs (still open)

- **Pre-existing race in `ensureProfileAndShop`** at `lib/db/queries.ts:71`. One-line `ON CONFLICT (user_id) DO NOTHING` fix as its own PR off main. Not Phase P scope.
- **Stripe env vars empty in `.env.local`.** Stage 3 will need them populated.
- **Test curator role grant** — Task 18 needs `UPDATE profiles SET role='curator' WHERE user_id='<brandon's auth uuid>'` via MCP. Required for any preview verification.

## Next session

**Recommended:** `/clear`, then resume with this handoff + plan + spec. Use subagent-driven-development. Estimated 1–2 sessions to wrap Phase P + open PR.

**After Phase P merges to main:** Stage 3 (entitlements) on the migration stack at `.claude/worktrees/monorepo-stage-1`. Plan corrections inline at commit `309fb16`.
