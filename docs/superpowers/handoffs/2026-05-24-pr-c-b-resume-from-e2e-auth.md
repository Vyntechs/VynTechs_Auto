# PR-C/B — Resume from e2e auth setup

**Date:** 2026-05-24
**Branch:** `feat/topology-interactive-ui`
**PR:** https://github.com/Vyntechs/auto/pull/91 (base: `staging-interactive-diagnostics`)
**Status:** code complete + tested + pushed; **blocked on e2e auth credentials**

**Brandon's one-line paste to start the resume session:**

```
Read docs/superpowers/handoffs/2026-05-24-pr-c-b-resume-from-e2e-auth.md and continue. You should be on branch feat/topology-interactive-ui; if not, git fetch && git switch feat/topology-interactive-ui.
```

---

## What happened in the previous session

Validation revealed three real issues that have all been addressed in code:

1. **Local dev couldn't talk to the DB.** `.env.local` had `DATABASE_URL_DIRECT` pointing at `db.<proj>.supabase.co`, which Supabase deprecated and removed from DNS. Every authed page in dev 500'd with `getaddrinfo ENOTFOUND`. Prod was unaffected (NODE_ENV=production never reads `_DIRECT`).
   - **Fix:** commented out `DATABASE_URL_DIRECT` in `.env.local` (gitignored, local-only). Dev now falls back to the pooler URL, same as prod.
   - **Memory saved:** [[reference_database_url_direct_dead]]

2. **Malformed session UUIDs 500'd the page** instead of returning 404. Stray `%20` characters from a copy-paste gap broke a URL Brandon clicked. Postgres rejected the malformed UUID with `invalid input syntax for type uuid`, surfaced by Next.js as a runtime-error overlay.
   - **Fix:** added a UUID-shape guard to `getSessionForUser` and `setLastScenarioForSession` in `lib/sessions.ts`. Pre-DB check returns `{ ok: false, status: 404 }` instead of throwing.
   - **Commit:** `fa804b7 fix(sessions): return 404 on malformed session UUID instead of 500`
   - **Unit tests:** 6 new parametrised cases (URL-encoded space, plain text, whitespace, empty) — all pass.

3. **Validation "done" was a lie.** Curl + unit tests don't prove an authed page renders. Brandon hit the post-login screen and immediately got a runtime error. The validation playbook had no step that actually loaded an authed page in a browser.
   - **Fix:** added `tests/e2e/topology.spec.ts` + a `topology` Playwright project to `playwright.config.ts`. Spec covers: page-loads-no-runtime-error, key surfaces visible, ignition control changes readout, mobile viewport, malformed-UUID returns <500.
   - **Commit:** `4c7ca76 test(e2e): topology validation spec for PR-C/B baseline`
   - **Run with:** `pnpm test:e2e --project=topology`

Both new commits are pushed to PR #91.

---

## What's blocking final validation

The e2e spec's `globalSetup` signs in via `supabase.auth.signInWithPassword({ email, password })` using `TEST_USER_EMAIL` and `TEST_USER_PASSWORD` from `.env.local`. **`TEST_USER_PASSWORD` is stale** because Brandon reset his Supabase password mid-session (via the "Forgot password?" flow) but `.env.local` was never updated.

Two paths offered to Brandon, **decision pending**:

### Option 1 — Update `.env.local` manually
- Brandon edits the `TEST_USER_PASSWORD=...` line in `.env.local` with his new password
- Runs `pnpm test:e2e --project=topology` to verify

### Option 2 — Dedicated e2e user (preferred)
- Create `e2e@vyntechs.com` (or similar) with a known random password via Supabase admin API
- Store both in `.env.local`
- One-time write to live Supabase (purely additive INSERT into `auth.users`; nothing touched in `profiles`, `shops`, or any of the 12 existing user accounts)
- After this, e2e never depends on Brandon's personal password
- **Requires Brandon's explicit "do it"** per [[feedback_no_dangerous_prod_ops]]

The user-list evidence Brandon was shown (so he can confirm none of these get touched):
```
brandon@vyntechs.com   maclainyoung94@gmail.com   angelmoralesj@yahoo.com
sndiesel2026@yahoo.com  brandon.james.nichols@gmail.com  thebrandonnichols@gmail.com
test+pr7-validation-1@vyntechs.com   nicholsb019@gmail.com   moralesruben1994@yahoo.com
angelsoccer00@gmail.com   sales@dbcustomoffroad.com   support@vyntechs.com
```

---

## Fresh session — start here

1. **Ask Brandon which option he picked** (1 or 2). Do not assume.
2. **If option 1:** wait for him to confirm `.env.local` is updated, then run `pnpm test:e2e --project=topology`.
3. **If option 2:** with his explicit approval, write a small one-time script (or inline node command) that:
   - Uses `SUPABASE_SERVICE_ROLE_KEY` from `.env.local`
   - Calls `supabase.auth.admin.createUser({ email: 'e2e@vyntechs.com', password: <generated>, email_confirm: true })`
   - Writes `TEST_USER_EMAIL=e2e@vyntechs.com` and the new password to `.env.local` (replacing the stale lines)
   - Reports the user_id back so it's recorded
   - Then runs `pnpm test:e2e --project=topology`
4. **If e2e passes:** hand off to Brandon for final visual sign-off (he opens the page in Safari, walks the F-350 session, confirms it looks right at desktop + phone).
5. **Brandon merges PR #91 via GitHub UI** when he's satisfied.

---

## Standing rules — still apply

- **Never push to main or `staging-interactive-diagnostics`.** Push to the feature branch only. Brandon merges via GitHub UI.
- **Apply migrations to live DB** — N/A here (no schema changes).
- **Validate with real inputs.** Use the actual F-350 / P0087 session URL, not a mock fixture.
- **PGlite cold-cache flake** ([[feedback_vitest_pglite_flake]]) — rerun once before treating intake-submit failures as a regression.
- **No "AI" word in user-facing copy** ([[feedback_no_ai_word_in_ui]]).
- **TDD via failing test first** if any bug surfaces ([[feedback_test_driven_bug_capture]]).

---

## Validated in the previous session (don't re-verify)

- `pnpm tsc --noEmit` — clean (only gitignored `design_handoff_*/` noise)
- `pnpm test tests/unit/get-session-handler.test.ts tests/unit/set-last-scenario.test.ts` — 15/15 pass
- `pnpm test` full suite — 1076+ pass on rerun (PGlite flake on first run; topology tests aren't affected)
- Dev server starts on port 3000; pooler URL connects; profile query returns 1 row
- Unauthed curl of session URL → 307 → `/sign-in?next=...` (no 500)
- PR #91: base correct, OPEN, 17 commits ahead of base

## Still needs validation in the fresh session

- **e2e topology spec** (the script Brandon asked for) — needs working auth credentials before it can run end-to-end
- **Brandon's eyeballs** on the live page — 8 scenarios at desktop, mobile viewport check, pin click + side panel behaviour. This is the final gate per [[feedback_claude_validates_first]] (Claude validates first, Brandon validates last).

---

## Files this PR touches (current state)

**New (7):**
- `components/topology/wire-state.ts`
- `components/topology/wire-edge.tsx`
- `components/topology/scenario-bar.tsx`
- `components/topology/captured-missing-footer.tsx`
- `components/topology/topology-selection-context.tsx`
- `app/api/sessions/[id]/scenario/route.ts`
- `tests/e2e/topology.spec.ts`

**Modified (10):**
- `app/globals.css`, `app/(app)/sessions/[id]/page.tsx`
- `components/screens/topology-diagnostic.tsx`
- `components/topology/topology-diagram.tsx`, `topology-flow.ts`, `topology-node.tsx`, `topology-detail-panel.tsx`, `topology.css`
- `lib/sessions.ts` (scenario helper + UUID guard)
- `playwright.config.ts` (new `topology` project)

**Tests new/modified (10):** wire-state, wire-edge, scenario-bar, captured-missing-footer, set-last-scenario, scenario-route, topology-flow, topology-diagram, topology-diagnostic, topology-detail-panel, get-session-handler.

---

## Related

- Spec: `docs/superpowers/specs/2026-05-23-interactive-electrical-topology-design.md`
- Plan: `docs/superpowers/plans/2026-05-23-electrical-topology-interactive-ui.md`
- Previous handoffs (this PR):
  - `docs/superpowers/handoffs/2026-05-23-pr-c-b-kickoff.md`
  - `docs/superpowers/handoffs/2026-05-23-pr-c-b-resume-from-task-14.md`
- PR-C/A predecessor (merged): https://github.com/Vyntechs/auto/pull/90
