# Testing Pipeline — Implementation Plan

> **For agentic workers:** this plan is being executed by an autonomous Claude session on `feature/testing-pipeline`. The session is working in worktree `.worktrees/testing-pipeline`. Brandon is asleep; no questions, use spec defaults.

**Goal:** ship the "must-have" deliverables from `docs/superpowers/specs/2026-05-07-testing-pipeline-design.md` so Brandon can run `pnpm test:all` in the morning and see clear pass/fail across every layer.

**Tech stack:** Vitest 4, Playwright 1.59, @supabase/supabase-js 2.105, Lighthouse 12 (to add), pnpm 10.

**Branch:** `feature/testing-pipeline` off `feature/phase-p-curator` (which is PR #3, awaiting Brandon's eyeball + merge). When PR #3 merges, this branch rebases cleanly onto main.

**Worktree:** `/Volumes/Creativity/dev/projects/vyntechs/.worktrees/testing-pipeline`. All file paths below are relative to this.

---

## Files created (planned: 14)

```
docs/superpowers/specs/2026-05-07-testing-pipeline-design.md         (✓ written first)
docs/superpowers/plans/2026-05-07-testing-pipeline-implementation.md (this file)
docs/testing/manual-checklist.md                                     (printable scripts, 4 personas)
tests/e2e/auth.spec.ts                                               (sign-in form, redirect-when-authed)
tests/e2e/sessions.spec.ts                                           (today, sessions, intake, billing)
tests/integration/rls-enforcement.test.ts                            (multi-tenant guarantee)
tests/setup-integration.ts                                           (vitest config wires this for tests/integration/)
scripts/smoke-prod.ts                                                (post-deploy smoke against any URL)
scripts/lighthouse-check.ts                                          (Lighthouse CI wrapper with budgets)
scripts/test-audit.sh                                                (npm audit + grep for committed secrets)
scripts/test-all.sh                                                  (sequential wrapper, fails fast)
.github/workflows/ci.yml                                             (typecheck + unit + build + e2e on PRs)
docs/superpowers/sessions/2026-05-07-handoff-testing-pipeline.md     (morning summary)
```

## Files modified (planned: 3)

```
package.json            — add scripts: test:all, test:smoke, test:perf, test:audit, test:integration
vitest.config.ts        — add tests/integration/ project for tests that need real Supabase
playwright.config.ts    — (no change planned; existing config supports new specs)
```

---

## Task list

### Task 1: Spec + plan docs ✓

Already done. This file and the spec are the deliverables.

### Task 2: tests/e2e/auth.spec.ts

**Files:** `tests/e2e/auth.spec.ts`

Coverage:
- (anonymous) `/sign-in` form renders with email/password fields and a submit button.
- (anonymous) `/sign-up` form renders.
- (curator project — already authed) navigating to `/sign-in` redirects to `/today` (already-authed redirect).
- (anonymous) navigating to `/today` redirects to `/sign-in` (anon-redirect).
- (anonymous) navigating to `/sessions` redirects to `/sign-in`.
- (anonymous) navigating to `/billing` redirects to `/sign-in`.

Pattern: extend the two existing playwright projects (`anonymous`, `curator`) with explicit `testMatch` for the new spec where appropriate. The anonymous tests go under the `anonymous` project; the already-authed redirect goes under `curator`.

Verification:
```bash
cd .worktrees/testing-pipeline
pnpm test:e2e -- tests/e2e/auth.spec.ts
```

### Task 3: tests/e2e/sessions.spec.ts

**Files:** `tests/e2e/sessions.spec.ts`

Coverage (signed in as Brandon, owner role):
- `/today` renders a heading or empty-state.
- `/sessions` renders the sessions list (or empty state if Brandon has no open sessions).
- `/sessions/new` renders the intake form.
- `/billing` renders (Stripe checkout button OR "no plan" state — both acceptable).
- `/intake` renders.

Pattern: same as `tests/e2e/curator.spec.ts`. Use `page.locator('main').getByText(...)` to scope past the sidebar/nav.

Mutations: **none.** This pipeline is read-only against prod data. Mutation paths are unit-tested.

Edge case: `/sessions/[id]` is *not* tested with a placeholder UUID here because it doesn't have a curator-style `notFound()` — it might 500 or render an error boundary. That nuance is unit-tested at the handler level.

Verification:
```bash
pnpm test:e2e -- tests/e2e/sessions.spec.ts
```

### Task 4: tests/integration/rls-enforcement.test.ts

**Files:** `tests/integration/rls-enforcement.test.ts`, `tests/setup-integration.ts`, `vitest.config.ts` (modified)

Coverage:
- **Confirms anon role cannot read sessions, profiles, drift_alerts, novel_pattern_queue without a JWT.** Service-role can; anon cannot.
- Optional follow-up (not in this run): seed two test shops via service role, confirm a JWT for shop A's user returns only shop A's rows. Skipped because seeding requires write access we don't want to commit to.

Pattern: vitest test that creates two `@supabase/supabase-js` clients (one with `SUPABASE_SERVICE_ROLE_KEY`, one with `NEXT_PUBLIC_SUPABASE_ANON_KEY`). Queries the same table with each. Asserts the anon client returns 0 rows or an RLS error; service-role returns >= 0 rows.

Tables to verify:
- `profiles` (private user data)
- `sessions` (per-shop diagnostic state)
- `drift_alerts` (curator-only)
- `novel_pattern_queue` (curator-only)
- `corpus_entries` (read-allowed for authed users? verify spec)
- `tech_assist_requests` (per-shop)
- `stripe_customers` (private billing)

This is its own vitest project (`tests/integration/`) because it talks to live Supabase and shouldn't run in the same isolation as the PGlite-backed unit tests.

Verification:
```bash
pnpm test:integration
```

### Task 5: scripts/smoke-prod.ts

**Files:** `scripts/smoke-prod.ts`, `package.json` (script)

Behavior:
- Reads `SMOKE_URL` env var (or first CLI arg). Defaults to `https://vyntechs.dev`.
- Hits `${url}/api/health` — expects 200 + `{ok: true}` (or whatever the existing health endpoint returns).
- Hits `${url}/` — expects 200 + html with `<h1>` containing "AI master tech for the bay."
- Hits `${url}/sign-in` — expects 200 + form HTML.
- Optional: hits `${url}/curator/drift` — expects 307 redirect to `/sign-in`.

Output: ✓/✗ per check + final exit code (0 = all green, 1 = any failure).

Verification:
```bash
pnpm test:smoke https://vyntechs.dev
# OR after preview deploys:
pnpm test:smoke https://<branch-preview>.vercel.app
```

### Task 6: scripts/lighthouse-check.ts

**Files:** `scripts/lighthouse-check.ts`, `package.json`

Behavior:
- Imports `lighthouse` programmatically.
- Runs against 2-3 URLs:
  - `http://localhost:3000/` (landing)
  - `http://localhost:3000/today` (authed; uses cookies from `tests/e2e/.auth/curator.json` if present, otherwise warns and skips)
- Asserts:
  - LCP < 2500ms
  - CLS < 0.1
  - INP < 200ms
  - Performance score >= 90 (landing) / >= 75 (authed)
- Outputs the failing metric on red.

Cost: adds `lighthouse` to dev deps (~80MB). Acceptable for a dev tool.

Verification:
```bash
pnpm dev &  # in another terminal
pnpm test:perf
```

### Task 7: scripts/test-audit.sh

**Files:** `scripts/test-audit.sh`, `package.json`

Behavior:
- `pnpm audit --audit-level=high` (fails on high or critical CVEs).
- Greps the working tree for committed secrets:
  - `git ls-files | xargs grep -E '(NEXT_PUBLIC_|SUPABASE_SERVICE_ROLE|STRIPE_SECRET|ANTHROPIC_API_KEY|VOYAGE_API_KEY)' | grep -v '\.env\.example' | grep -v 'AGENTS.md'`
  - If anything matches, fail.
- Greps for `.env.local` accidentally committed:
  - `git ls-files | grep -E '\.env(\.local)?$' && exit 1`

Verification:
```bash
pnpm test:audit
```

### Task 8: scripts/test-all.sh + package.json scripts

**Files:** `scripts/test-all.sh`, `package.json` (modified)

`test:all` sequence:
```bash
#!/bin/bash
set -e
echo "→ typecheck..."  ; pnpm exec tsc --noEmit
echo "→ unit tests..." ; pnpm test
echo "→ build..."      ; pnpm build
echo "→ e2e..."        ; pnpm test:e2e
echo "→ audit..."      ; pnpm test:audit
echo ""
echo "✓ all green"
```

Skips `test:perf` and `test:smoke` because those need either a running dev server or a deployed URL — they're separate.

Adds these `package.json` scripts:
```json
"test:all": "scripts/test-all.sh",
"test:smoke": "tsx scripts/smoke-prod.ts",
"test:perf": "tsx scripts/lighthouse-check.ts",
"test:audit": "scripts/test-audit.sh",
"test:integration": "vitest run --config vitest.integration.config.ts"
```

### Task 9: .github/workflows/ci.yml

**Files:** `.github/workflows/ci.yml`

Triggers: PRs targeting `main`, pushes to `main`.

Steps:
1. Checkout, install pnpm + Node 20.
2. `pnpm install --frozen-lockfile`.
3. `pnpm exec tsc --noEmit`.
4. `pnpm test`.
5. `pnpm build`.
6. `pnpm exec playwright install chromium`.
7. `pnpm test:e2e --project=anonymous` — only the anonymous tests, because curator tests need real Supabase auth which CI doesn't have.

Skipped in CI: `test:integration` (needs real Supabase), `test:perf` (needs running app), `test:audit` (separate workflow on schedule).

Status badge gets added to README in a follow-up.

### Task 10: docs/testing/manual-checklist.md

**Files:** `docs/testing/manual-checklist.md`

Format: markdown with 4 sections (one per persona). Each section has 3-7 numbered steps. Each step has:
- **Persona:** who you're acting as
- **Action:** what to click / type
- **Expected:** what you should see
- **Notes:** anything weird, or how to recover

Personas:
1. **Customer (sign-up flow)** — sign up with a fresh email, see a welcome state.
2. **User (tech, daily)** — start a session, walk the AI through symptoms, capture an artifact, close the session, see it in history.
3. **Owner (curator, weekly)** — review drift queue, dismiss one alert, approve a deferred case.
4. **Tester (regression sweep)** — `pnpm test:all` green, manually verify the failing/skipped items.

Special section: **Stripe test cards** for billing flow checkout (4242, 4000 0000 0000 0002 declined, etc.).

### Task 11: Verification

Run each new test/script. Record outcomes. Anything that doesn't work → either fix or document as known gap with reason.

Verify:
- [ ] `pnpm test:e2e -- tests/e2e/auth.spec.ts` green
- [ ] `pnpm test:e2e -- tests/e2e/sessions.spec.ts` green (or expected skips)
- [ ] `pnpm test:integration` green (RLS enforcement)
- [ ] `pnpm test:smoke https://vyntechs.dev` green
- [ ] `pnpm test:perf` runs (may not pass budgets — acceptable, document)
- [ ] `pnpm test:audit` green
- [ ] `pnpm test:all` end-to-end green
- [ ] CI workflow yaml is valid (use `gh workflow view` or actionlint if available)

### Task 12: Morning summary

`docs/superpowers/sessions/2026-05-07-handoff-testing-pipeline.md`

Short (target 50-80 lines). Format like the AGENTS.md slim handoff convention. Sections:
- What got built (file list + line counts)
- How to run each piece (one command per layer)
- What worked end-to-end (green check)
- What's flaky / skipped / deferred (with reason)
- Recommended next session

---

## Out-of-scope (documented for future work)

- Visual regression
- Load tests
- Stripe webhook integration test (needs `stripe-cli` setup outside the worktree)
- AI failure mode tests (needs response-mocking strategy decision)
- Component tests for new pages (e2e covers smoke; component covers state-machine semantics — different concern)
- Chaos engineering
- Mobile-viewport e2e (the curator console is desktop-only by design)

## Rollback

If anything in this branch breaks main, revert all commits with `git revert <sha>` in reverse order. The branch is additive — no destructive changes to existing tests, handlers, or schema.

The only risky modification is `vitest.config.ts` (adding the integration project). If that breaks `pnpm test`, the revert is one file.

## Self-review checklist

Plan author runs this before declaring done:
- [ ] Every task has a Verification step
- [ ] No task duplicates an existing script
- [ ] Test wrapper sequences fail-fast (set -e), don't swallow errors
- [ ] CI workflow doesn't try to run authed e2e (no Supabase credentials in CI)
- [ ] Manual checklist is printable + has Stripe test cards section
