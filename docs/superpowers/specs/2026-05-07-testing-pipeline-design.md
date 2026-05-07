# Vyntechs Full-Stack Testing Pipeline — Design

**Author:** autonomous Phase 4-architecture run, 2026-05-07
**Audience:** Brandon (founder, non-engineer); future-Claude sessions picking up testing work.
**Status:** brainstorm + design. Implementation lives at `docs/superpowers/plans/2026-05-07-testing-pipeline-implementation.md`.

## Goal in one sentence

Brandon should be able to run **one command** that proves the app works end-to-end across every layer (database, backend, frontend, AI integrations, billing) — and have a **printable checklist** for the things a machine can't reliably check (UX, AI answer quality, money flows).

## Why this exists

The repo has 75 vitest files and 10 Playwright tests today. That covers individual handlers and the curator console. It does **not** cover:

- The actual customer journey (sign-up → first session → outcome) end-to-end in a browser.
- Whether shop A can accidentally see shop B's data (the multi-tenant guarantee).
- Whether the production deploy is healthy after merging.
- Whether page load times have regressed.
- Whether new dependencies have known security vulnerabilities.
- Whether anybody actually clicked through the new feature like a real customer would.

A "senior staff engineer grade" pipeline closes those gaps with the right tool for each gap, not with one giant test suite.

## The four personas

A test pipeline is only useful if it covers the perspectives that matter. Vyntechs has four:

### 1. Customer (first-time signup)
The shop owner who lands on `vyntechs.dev`, decides to try it, signs up, and gets to a usable state. Failure here loses revenue at the door.

**What we test:** landing page renders, sign-up form works, redirect to `/today` happens, Stripe customer is auto-created.
**What's currently covered:** unit tests for the auth-helper + Stripe ensure-customer logic. Sign-up page has a component test. **No e2e.**
**Gap:** nobody has clicked through this in a browser since the auth helper changed.

### 2. User (tech, daily use)
The mechanic in the bay, signed in as a tech-role user, running diagnostic sessions all day. This is the core product loop.

**What we test:** `/today` dashboard, `/sessions/new` intake, `/sessions/[id]` chat flow, capturing artifacts (photos), closing sessions, decline-or-defer flow.
**What's currently covered:** every handler has unit tests. **No e2e for the actual flow.**
**Gap:** if any of these pages crashes, you only find out when a real tech tries to use it.

### 3. Owner (curator, weekly review)
Brandon-as-curator. Monday morning review of last week's drift recommendations, defer queue, novel patterns, corpus authoring.

**What we test:** all 9 curator screens render.
**What's currently covered:** **9 e2e tests as of yesterday.** Strongest coverage in the app.
**Gap:** the *mutation* paths (apply drift, dismiss, approve deferred case) are unit-tested but not e2e.

### 4. Tester (engineer doing a regression sweep)
Whoever sits down to verify a release before merging. Could be Brandon, could be Claude, could be a future hire.

**What we test:** does `pnpm test:all` go green? Are there npm vulnerabilities? Are perf budgets met? Does production smoke pass after deploy?
**What's currently covered:** `pnpm test` (vitest only) and `pnpm test:e2e` (Playwright only). No combined wrapper, no audit, no perf budget, no production smoke.
**Gap:** the entire "regression checklist" is implicit in Brandon's head.

## The ten layers

Senior-grade testing is layered. Each layer catches a different failure class. Vyntechs needs:

| # | Layer | Tool | Currently | After this run |
|---|---|---|---|---|
| 1 | Pure functions, handler logic | vitest | 75 files, 428 tests | 75 files, 428 tests |
| 2 | React components | vitest + RTL | sign-in, sign-up, today, plan-tree | (no change) |
| 3 | Multi-handler integration with real DB | vitest + PGlite | gating-flow, queries | + RLS isolation test |
| 4 | Browser e2e against live app | Playwright | landing + 9 curator | + auth + sessions + billing |
| 5 | Database integrity (RLS, advisor) | Supabase MCP + custom | manual via MCP | + automated `test:db` |
| 6 | Production smoke (post-deploy) | curl + Playwright | none | + `test:smoke` against URL |
| 7 | Performance budgets | Lighthouse CI | none | + `test:perf` (LCP, CLS) |
| 8 | Security audit | npm audit + custom | none | + `test:audit` |
| 9 | External-service failure modes | mocked vitest | partial (anthropic, voyage) | (no change — out of scope) |
| 10 | Manual UX + AI-quality checklist | markdown | none | + `docs/testing/manual-checklist.md` |

Plus: **CI** (a GitHub Actions workflow that runs layers 1+3+4 on every PR — closes the "we never run e2e in CI" gap).

## What this autonomous run delivers

**MUST HAVE (will be done):**
- Brainstorm + plan docs (this file + the plan).
- E2E for the four critical authed surfaces: today, sessions index, sessions/new intake, billing.
- E2E for the auth flows: sign-in form (forgot-the-password path), redirect-when-already-signed-in.
- RLS verification test (does shop A see shop B?).
- `pnpm test:smoke` script against any URL.
- `pnpm test:perf` Lighthouse wrapper.
- `pnpm test:audit` (`npm audit` + grep for committed secrets).
- `pnpm test:all` wrapper that runs everything in order with a clean summary.
- `.github/workflows/ci.yml` — pre-merge gate on PRs.
- `docs/testing/manual-checklist.md` — printable scripts for all 4 personas.
- Morning summary handoff doc.

**EXPLICITLY DEFERRED (will be flagged in the morning summary):**
- Visual regression (needs Percy or Chromatic — paid services, separate decision).
- Load testing (needs a non-prod environment with seed data).
- Stripe webhook integration test (needs `stripe-cli` + a recorded webhook fixture).
- AI failure mode tests (needs Anthropic/Voyage mocking infra at the right layer).
- Component tests for every new page (e2e covers "does it render"; component test covers "does this state machine work" and that's a different question).
- Chaos / resilience tests (network drop, DB connection loss).

## Constraints driving the design

- **Brandon is non-engineer.** Every test command must produce a clear pass/fail. Failure output must be readable, not require Stack Overflow.
- **No test environment yet.** Tests run against prod Supabase. Mutating tests are off-limits — pipeline is read-only against prod data. Sign-in uses Brandon's real account (`brandon@vyntechs.com`), already wired in `tests/e2e/global-setup.ts`.
- **Solo-founder time budget.** A test that takes 30 minutes to run and 30 minutes to debug isn't worth shipping. Target: full pipeline runs in < 5 minutes.
- **No CI infra to maintain yet.** GitHub Actions is the cheapest, runs on Anthropic-paid infra (Microsoft Linux), no extra cost.
- **Stripe + AI keys cost money.** Tests that hit Anthropic on every PR cost ~$0.50 each — keep them in unit-test layer with mocks.

## What "passing" means at each layer

| Layer | Pass criteria | Where to look on fail |
|---|---|---|
| Unit (`pnpm test`) | 428/428 green | vitest output names the failing test + file |
| E2E (`pnpm test:e2e`) | 10 → 20+ green | `test-results/<name>/error-context.md` has page snapshot |
| RLS (`pnpm test:db`) | service-role and anon-role return matching counts | failure means a policy is missing or wrong |
| Smoke (`pnpm test:smoke <url>`) | `/api/health` returns 200, landing page has expected h1 | Vercel deploy URL is broken — check deployment logs |
| Perf (`pnpm test:perf`) | LCP < 2.5s, CLS < 0.1 on landing + today | run Lighthouse interactively to drill in |
| Audit (`pnpm test:audit`) | 0 high/critical vulnerabilities | `pnpm audit --fix` or pin patched version |
| Manual checklist | every checkbox checked | open the relevant page, retry the action |

## The "test:all" sequence

```
pnpm test:all  →  runs in order, fails fast:
  1. typecheck       (~15s)
  2. unit tests      (~2min)
  3. build           (~30s)
  4. e2e             (~1min)
  5. audit           (~10s)
  6. perf  (against http://localhost:3000)  (~30s)

Total: ~5 minutes. Output: green check or red X per stage, then summary.
```

Smoke is **not** in `test:all` because it needs a deployed URL — runs separately after every deploy.

## Open questions / future decisions

- **Visual regression** — Percy, Chromatic, or DIY screenshot diff? Needs a separate evaluation.
- **CI cost** — at scale, GitHub Actions free tier covers this fine. If we add many e2e runs, may need to optimize (e.g., conditional matrix).
- **Test data hygiene** — currently tests run against prod Supabase as Brandon. Long-term we want a dedicated test Supabase project. Not in scope for this run.
- **AI quality assurance** — the AI's *responses* need a separate evaluation framework (eval harness with golden cases). That's a Phase R / Q-style effort, not a "testing pipeline."
