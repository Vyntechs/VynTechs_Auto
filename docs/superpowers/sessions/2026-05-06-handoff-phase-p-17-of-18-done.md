# Vyntechs — Handoff (2026-05-06, Session 13: Phase P 17/18 done, 1 task + final review remain)

Slim per AGENTS.md. Phase P implementation on `feature/phase-p-curator`. **17/18 tasks merged**, branch is 34 commits ahead of `main`. Schema is unchanged from Session 12 (no new migrations this session). Production untouched. Remaining work: Task 18 (pre-deploy verification) and Task 19 (final review + open PR).

This handoff is written specifically so you can `/clear` and pick up Tasks 18-19 with fresh eyes — they're operational/process-flavored tasks that need a different headspace than the implementation work that filled 14-17.

## Resume

1. `cd /Volumes/Creativity/dev/projects/vyntechs && git checkout feature/phase-p-curator && git pull origin feature/phase-p-curator`. HEAD should be `a6b029c` — that's this handoff commit on top of Task 17 (`ac0ca32`).
2. Verify baseline: `pnpm test && pnpm exec tsc --noEmit && pnpm build`. Expect **426/426**, tsc clean, build clean. (Cold-cache vitest fork-pool flake is a known false negative — rerun once if you see PGlite-closed errors on first run.)
3. Read this handoff, plus the relevant Task 18 + 19 sections of the plan: `docs/superpowers/plans/2026-05-06-phase-p-curator-implementation.md` (Task 18 starts at line 2531, Task 19 is the closeout). Spec at `docs/superpowers/specs/2026-05-06-phase-p-curator-design.md`.
4. Pick up at **Task 18** (Pre-deploy verification). It has two distinct chunks — see "Task 18 has two chunks" below. Decide whether to do them in series or parallel before starting.
5. Use `superpowers:subagent-driven-development` for Task 18 + 19 (same pattern as 14-17).

## State

**Branch:** `feature/phase-p-curator` at `a6b029c` (35 commits ahead of `main` head `5d7065b`; handoff commit sits on top of Task 17's `ac0ca32`).

**Tests:** 426/426 passing. Test count progression this session: 423 → 424 (Task 15: +1 dismiss test) → 426 (Task 16: +2 corpus tests) → 426 (Task 17: no tests, read-only list).

**Schema:** Unchanged from Session 12. The 3 Phase P migrations were applied last session and are live in prod:
- `0011_drift_alerts_lifecycle` — 4 lifecycle cols + partial idx on `drift_alerts`; `novel_pattern_queue` table with curator-only RLS.
- `0011a_session_curator_columns` — `curator_note`, `curator_override_action` on sessions.
- `0011b_session_max_corpus_similarity` — `max_corpus_similarity real` on sessions.

**Production (`vyntechs.dev`):** still on `main` head `5d7065b`. Untouched.

## Commits added this session (Tasks 14-17)

```
ac0ca32 feat(curator): corpus list page (Screen 9)              ← Task 17
880e143 fix(curator): tighten corpus handler return type + clarify engine asymmetry  ← Task 16 review fixes
8d4fbc0 feat(curator): corpus authoring form + POST handler     ← Task 16
3f238de fix(curator): deterministic novel queue lookup + match deferred-actions divider  ← Task 15 review fixes
5be822e feat(curator): dismiss novel-pattern queue entries      ← Task 15
28215c1 feat(curator): novel-pattern queue page (Screen 7)      ← Task 14
```

Each task ran the full two-stage review (spec compliance → code quality), except Task 17 which got a single combined review per the prior handoff's authorization for that task ("read-only list, low risk").

## Tasks remaining

### Task 18: Pre-deploy verification — has two chunks

**Plan reference:** plan file line 2531+. Spec/design corrections at top of plan file lines 63-67.

**Chunk A — Production curator role grant + migration verify (operational, fast):**

1. Get Brandon's auth UUID from prod via Supabase MCP `execute_sql`. **Brandon's email is `brandon.james.nichols@gmail.com`** — the plan template's `brandon@vyntechs.com` is wrong.

   ```sql
   SELECT id, email FROM auth.users WHERE email = 'brandon.james.nichols@gmail.com';
   -- copy the auth_uid, then:
   SELECT id, role FROM profiles WHERE user_id = '<auth_uid>';
   -- if role != 'curator':
   UPDATE profiles SET role = 'curator' WHERE user_id = '<auth_uid>';
   -- verify:
   SELECT role FROM profiles WHERE user_id = '<auth_uid>';
   ```

2. Confirm the migrations are applied (defensive — they were applied in Session 11 but verify before any preview-flow work):
   ```sql
   SELECT * FROM drift_alerts LIMIT 1;            -- must show decision/decided_at/decided_by_user_id/decision_note
   SELECT count(*) FROM novel_pattern_queue;      -- table must exist (count likely 0)
   SELECT max_corpus_similarity FROM sessions LIMIT 1;  -- column must exist
   ```

**Chunk B — Playwright e2e for authed `/curator/*` routes (implementation work, slower):**

Brandon's call (Session 12) was option (b): extend the smoke-suite pattern. Specifics from the plan corrections preamble (line 63-67):
- Add `tests/e2e/curator.spec.ts` mirroring the `tests/e2e/landing.spec.ts` Playwright pattern.
- Cover all 9 read-only screens: drift queue, drift drill-down, calibration dashboard, per-category history, deferred queue, novel-pattern queue, corpus list, full case detail, console layout.
- Each test signs in as a curator-role test user, navigates, asserts the heading/key element renders without error.
- Auth setup: Playwright `storageState` (existing pattern) or grant role via SQL fixture in a `beforeAll`.
- **NOT** option (a): do not add `@testing-library/react`. Smoke-level catches "page broke" without component-test machinery.

Open question for the executor: how does the curator-role test user get provisioned in the e2e environment? Two paths — (1) seed a fixture user with role='curator' as part of the test setup, (2) use Brandon's prod-equivalent local user. Option 1 is more hermetic; option 2 is simpler but couples e2e to a real account. Read `tests/e2e/landing.spec.ts` first to see what pattern is already established before deciding.

### Task 19: Final code review + open PR

1. Dispatch a final code-reviewer subagent over the entire branch (BASE `5d7065b`, HEAD whatever Task 18's last commit is). Use the requesting-code-review template at `superpowers:requesting-code-review`. Address findings (probably small).
2. Use `superpowers:finishing-a-development-branch` to wrap up — opens the PR to `main`.
3. PR title suggestion: `feat(phase-p): curator console (5 surfaces, 9 screens)`. Body: short summary referencing the spec, plan, and lessons. The plan template at line 2577-2580 has a body skeleton.

## Pattern lessons baked into the codebase

These remain the load-bearing conventions; new code in Tasks 18-19 should follow them. (Carried forward from Session 12, plus this session's additions.)

- Path corrections at top of the plan file. Drop `apps/diagnostic/`, use `@/` aliases.
- Session JSON fields: `intake` → vehicle/complaint, `outcome` → tech action/notes/rootCause, `treeState` → AI proposed action, `status` enum values: `'open' | 'closed' | 'declined' | 'deferred'` (no `'in_progress'`).
- Tests use UUID-format strings only; auth.uid stub for PGlite at `tests/helpers/db.ts`.
- `parseRisk` at `@/lib/curator/parse-risk` for any `RiskClass` URL param validation.
- vt design tokens: `--vt-fg-3` (not `--vt-fg-muted`), `--vt-accent`, `--vt-border`, `--vt-risk-high`. No invented tokens.
- `unwrapRows` at `@/lib/db/unwrap-rows` — only for raw `sql\`...\`` queries, not typed Drizzle selects.
- Cell-SQL fragments at `@/lib/calibration/cell-sql` — shared across calibration cron + curator drill-down.
- Form submits use `router.refresh()` (mutation, stay on page) or `router.push('/path')` (navigation), never `window.location.reload()`. Errors surface via `<p role="alert">`.
- Drizzle SQL templates render unqualified column names — for self-join EXISTS subqueries, write plain SQL identifiers.
- Handler convention: `sql\`now()\`` for timestamps (NOT `new Date()`); `AppDb` *type* from `@/lib/db/queries`; `db` value from `@/lib/db/client`.
- Multi-write handlers wrap in `db.transaction(async (tx) => ...)` — every write inside must use `tx`, never `db`.
- Drizzle `.where(undefined)` is a no-op; use this to make optional filters readable instead of conditional query reassembly with `as any`.
- The schema column name **does not always match** what the plan template called it. Always grep `lib/db/schema.ts` for the actual column before writing values.

## Code-review track record (running tally)

The two-stage review caught **6 silent production bugs** across Tasks 1-17:
1. (Task 1) Auth.uid CREATE OR REPLACE would have overwritten Supabase's real auth function.
2. (Task 11) `closedAt IS NULL` filter on deferred queue would have returned zero rows.
3. (Task 4) Crash path in case detail when `declineOrDefer.language` was structurally incomplete.
4. (Task 13) Novel-pattern trigger was inert — route never passed the score.
5. (**Task 15, this session**) Cases-page novel queue lookup used `.limit(1)` without `.orderBy(...)` — non-deterministic when duplicate pending entries exist for one session. Fixed in `3f238de`.
6. (**Task 16, this session**) Handler return type included an unreachable `'error'` branch that the route mapped to 400, conflating validation with DB failures. Fixed in `880e143`.

None would have been caught by tests-as-written. **Continue running both review stages per task** through Tasks 18-19.

## Carryovers from prior handoffs (still open, none Phase-P scope)

- **Pre-existing race in `ensureProfileAndShop`** at `lib/db/queries.ts:71`. One-line `ON CONFLICT (user_id) DO NOTHING` fix, separate PR off main. Not Phase P.
- **Stripe env vars empty in `.env.local`.** Stage 3 will need them populated.

## Next session

**Recommended:** `/clear`, then read this handoff + the Task 18 plan section + the spec. Use subagent-driven-development. Estimated **1 session** to wrap Phase P (Task 18 has the most variability — Chunk B's e2e setup could surface unexpected work depending on existing Playwright config).

**After Phase P merges to main:** Stage 3 (entitlements) on the migration stack at `.claude/worktrees/monorepo-stage-1`. Plan corrections inline at commit `309fb16` (per Session 12's handoff).
