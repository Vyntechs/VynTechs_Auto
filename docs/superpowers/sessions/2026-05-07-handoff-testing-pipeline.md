# Vyntechs — Handoff (2026-05-07, autonomous overnight: full testing pipeline)

You asked for a full senior-staff-grade testing pipeline so you can verify everything (wiring, backend, frontend, database, flows) without burning Claude session time. **Done — `pnpm test:all` runs green in 158s.** Branch lives at `.worktrees/testing-pipeline` (branch `feature/testing-pipeline`). **Not pushed, no PR opened** — per your instruction.

## Read this first

1. The branch is **stacked on top of PR #3** (Phase P curator console). When PR #3 merges to main, this branch rebases cleanly. Don't merge this one before PR #3.
2. Worktree path: `/Volumes/Creativity/dev/projects/vyntechs/.worktrees/testing-pipeline`. `cd` there to run anything.
3. The pipeline does **not** mutate prod data. Everything is read-only.
4. There are **3 real findings** during the build that aren't bugs in the new code — they are pre-existing issues I documented but did not fix. See "Findings" below.

## What got built

**5 commits on `feature/testing-pipeline`:**

```
41b8181 fix(testing): address final reviewer findings
4b993fc ci+docs: GitHub Actions pipeline + printable manual QA checklist
3037e36 build: add test:smoke, test:perf, test:audit, test:all wrapper scripts
8d05fe7 test: extend e2e to authed user surfaces + RLS integration suite
2cd6d8e docs(testing): brainstorm + implementation plan for full testing pipeline
```

A final code-reviewer pass over the diff caught 2 real bugs that I fixed in commit 5: (a) the smoke script accepted 404 on `/curator/drift` unconditionally — fine while Phase P is unmerged, but once the route is on main a misconfigured auth gate returning `notFound()` would silently pass; gated behind `CURATOR_DEPLOYED=1` env flag now. (b) `xargs grep` in the audit script could silently drop matches once the file list outgrew argv limits; switched to NUL-delimited piping. Plus a one-liner cleanup of dead code in the e2e helper.

**14 new files:**

| Layer | File | What it does |
|---|---|---|
| Brainstorm | `docs/superpowers/specs/2026-05-07-testing-pipeline-design.md` | Plain-English design: 4 personas, 10 layers, what's covered today vs after |
| Plan | `docs/superpowers/plans/2026-05-07-testing-pipeline-implementation.md` | Task-by-task plan with file paths |
| E2E | `tests/e2e/auth.spec.ts` | 6 tests — anon access to sign-in, sign-up, /today/sessions/billing/intake redirects |
| E2E | `tests/e2e/sessions.spec.ts` | 5 tests — signed-in /today, /sessions, /sessions/new, /billing, /intake |
| Integration | `tests/integration/rls-enforcement.test.ts` | 15 tests — anon and service_role both blocked from public.* via PostgREST |
| Integration | `vitest.integration.config.ts` | Separate vitest config for live-Supabase tests |
| Smoke | `scripts/smoke-prod.mjs` | Hits any URL: /api/health, /, /sign-in, /curator gate, favicon |
| Perf | `scripts/lighthouse-check.mjs` | Core Web Vitals + perf-score budgets (optional dep) |
| Audit | `scripts/test-audit.sh` | pnpm audit + secret-pattern scan + .env commit check |
| Wrapper | `scripts/test-all.sh` | Sequential fail-fast runner for the 6 local stages |
| CI | `.github/workflows/ci.yml` | typecheck + unit + build + e2e (anonymous) + audit on every PR to main |
| Manual | `docs/testing/manual-checklist.md` | Printable scripts for 4 personas + Stripe test cards |
| Handoff | `docs/superpowers/sessions/2026-05-07-handoff-testing-pipeline.md` | This file |

## How to run each piece

```bash
cd /Volumes/Creativity/dev/projects/vyntechs/.worktrees/testing-pipeline

pnpm test:all                       # all 6 local stages, ~2.5 min, fail-fast
pnpm test                           # 428 unit tests
pnpm test:e2e                       # 21 Playwright tests (anon + curator)
pnpm test:integration               # 15 RLS / live-Supabase tests
pnpm test:audit                     # pnpm audit + secret/env file scan
pnpm test:smoke                     # 9 checks against vyntechs.dev
pnpm test:smoke https://<preview>   # against any URL
pnpm test:perf                      # Lighthouse perf budgets (needs install — see below)
```

**Optional install for perf:**
```bash
pnpm add -D lighthouse chrome-launcher    # ~80MB, only needed for test:perf
```

## What worked end-to-end (last verified run)

```
→ 1/6 typecheck      ✓
→ 2/6 unit tests     ✓ 428/428
→ 3/6 build          ✓
→ 4/6 e2e            ✓ 21/21 (1 landing + 6 auth + 9 curator + 5 sessions)
→ 5/6 integration    ✓ 15/15 RLS
→ 6/6 audit          ✓ no high/critical, no leaked secrets, no .env committed

✓ all green (158s)
```

Plus run-once verifications:
- `pnpm test:smoke https://vyntechs.dev` → **9/9 green** (prod is healthy)
- `pnpm test:perf` → gracefully skips (lighthouse not installed)

## Findings (pre-existing, NOT introduced this session)

### 1. RLS enabled but no policies on every public table

Supabase advisor surfaced: `profiles, sessions, session_events, drift_alerts, novel_pattern_queue, follow_ups, tech_assist_requests, stripe_customers, shops, corpus_entries, artifacts, confidence_calibration, retrieval_cache` all have RLS enabled with **zero policies**. The app works because Drizzle uses a direct postgres connection (`DATABASE_URL`) which bypasses RLS — the anon Supabase client correctly returns nothing.

**This is actually safer than RLS-with-policies** for a single-tenant-style app where Drizzle handles authorization, but it means: if a future feature needs PostgREST access (e.g., a mobile client using only the anon key), it will silently get zero rows. Worth a deliberate decision before that day arrives. Documented in the integration test as the pinned-in-place posture.

### 2. SECURITY DEFINER function callable by anon

`public.rls_auto_enable()` is a `SECURITY DEFINER` function executable by both anon and authenticated roles via `/rest/v1/rpc/rls_auto_enable`. If this function does anything sensitive (like flipping RLS on tables), an anonymous attacker could call it. **Recommend revoke EXECUTE from anon and authenticated**:

```sql
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon, authenticated;
```

### 3. Leaked-password protection disabled in Supabase Auth

Supabase Auth supports checking new/changed passwords against haveibeenpwned.org — currently off. **Recommend enabling** in Supabase dashboard → Authentication → Policies → "Password security."

### 4. Page-title accessibility gap

`/today`, `/sessions`, `/sessions/new`, `/billing` use `AppHeader` which renders the page title as `<div className="title">`, not `<h1>`. `MainHeader` (used by `/intake`, `/curator/*`) does render `<h1>`. Screen readers and SEO see no h1 on those four pages. **Two-line fix in `components/vt/app-header.tsx`** — change `<div className="title">` to `<h1 className="title">` and update CSS specificity. The new e2e tests use a helper that accepts both patterns so the suite stays passing across the change.

### 5. `daily-db-backup.yml` is the only existing GitHub Action

You had **no CI for tests** before this branch — every prior merge happened on local-machine green. The new `ci.yml` closes that gap. Side note: the `daily-db-backup.yml` deserves a separate audit (timing, retention, where dumps land) — not in scope for this run.

## What's deferred (flagged in spec, not built)

- **Visual regression** (Percy / Chromatic) — needs paid service decision.
- **Load testing** (k6 / Artillery) — needs a non-prod environment with seed data.
- **Stripe webhook integration test** — needs `stripe-cli` and a recorded fixture.
- **AI failure-mode tests** — needs a mocking strategy for Anthropic / Voyage.
- **Component tests for new pages** — e2e covers smoke; component tests cover state-machine semantics, different concern.
- **AI answer-quality eval harness** — Phase Q-style work, separate from "did the page render."

## Carryovers from prior handoffs (still relevant)

- **PR #3 (Phase P curator console)** still awaiting your eyeball + merge.
- **Pre-existing race in `ensureProfileAndShop`** at `lib/db/queries.ts:71` — one-line `ON CONFLICT DO NOTHING` fix in a separate PR off main.
- **Stripe env vars empty in `.env.local`** — surfaces during e2e as a noisy `STRIPE_SECRET_KEY` error in the dev server log; doesn't fail tests but worth populating before Stage 3.

## Recommended next session

1. Eyeball PR #3 (Phase P), merge if happy.
2. Eyeball this branch's diff. If happy, push + open a PR (title: `feat(testing): senior-grade pipeline (e2e + RLS + smoke + audit + CI + manual)`).
3. After CI runs the first time, add the badge to `README.md`.
4. Address findings 1-4 above as separate small PRs.

**Estimated time to ship this branch: ~10 minutes** (eyeball + push + PR).
