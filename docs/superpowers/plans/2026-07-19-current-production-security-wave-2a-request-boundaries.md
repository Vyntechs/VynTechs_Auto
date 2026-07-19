# Current-Production Security Wave 2A: Request Boundaries

> **Execution:** Use the `superpowers:executing-plans` and `superpowers:test-driven-development` skills task by task. Every behavior change starts with a focused failing test.

**Goal:** Close five current-production medium findings at public or provider-facing request boundaries without adding pages, prompts, permissions, or repeat sign-ins.

**Architecture:** Keep authorization and input controls at the server sink that performs sensitive work. Share one pure return-path validator across authentication flows; bound intake-search work before SQL construction; enforce billing authority inside the portal-session handler; and put strict validation, rate limiting, request coalescing, timeout coverage, and concurrency bounds in front of the VIN provider.

**Finding closure target:** `FR016-C001`, `FR016-C002`, `CAND-S005-001`, `CAND-S010-001`, and `CAND-S040-002` from the sealed 2026-07-19 audit.

## Constraints

- Work only in `/Users/brandonnichols/.codex/worktrees/vyntechs-ai-pii-penetration-audit` on `security/ai-pii-penetration-audit-2026-07-19`.
- Keep diagnostics globally disabled. Do not change diagnostic prompts, retrieval, topology, risk semantics, or release truth.
- Do not inspect or mutate production, Supabase, Stripe, AI providers, customer data, credentials, or external services in this wave.
- Use synthetic identities and vehicle data only.
- Preserve mobile and desktop workflows. Denials use existing status responses; normal users receive no new interaction.
- Billing recovery remains available to active owners and the configured founder even while a shop is unpaid. Non-owners and deactivated accounts must be denied before any Stripe customer lookup or provider call.
- Rate-limit checks happen only after authentication, base access, and syntactic request validation. Provider-independent invalid requests must never reach the provider.
- Middleware is defense in depth, never the sole authorization control.
- Commit each completed task separately. Do not merge or deploy until the full current-production security gate is independently verified.

---

### Task 1: Make every authentication return path unambiguously same-site

**Files:**
- Create: `lib/safe-next-path.ts`
- Create: `tests/unit/safe-next-path.test.ts`
- Create: `tests/unit/auth-return-routes-security.test.ts`
- Modify: `app/auth/callback/route.ts`
- Modify: `app/auth/confirm/route.ts`
- Modify: `app/(auth)/sign-in/page.tsx`

- [ ] Write table-driven tests proving the validator accepts ordinary application paths with query strings and rejects absolute URLs, protocol-relative paths, backslashes, encoded backslashes after query decoding, control characters, and missing values.
- [ ] Add successful callback and OTP route tests for the exact `/%5Cevil.example` reproducer; assert both redirect to `/today`, while a benign nested path is preserved.
- [ ] Run the focused tests and record the pre-fix failure.
- [ ] Add a pure `safeNextPath(raw, fallback = '/today')` helper. It must reject anything not beginning with exactly one forward slash, any backslash, and ASCII control characters.
- [ ] Replace all three duplicate validators with the shared helper so password, OAuth, and OTP sign-in use one policy.
- [ ] Run the new tests plus `tests/unit/sign-in-page.test.tsx`.
- [ ] Commit as `security: close authentication return-path escapes`.

### Task 2: Bound intake-search work before SQL construction

**Files:**
- Modify: `lib/intake/search.ts`
- Modify: `app/api/intake/search/route.ts`
- Modify: `tests/unit/intake-search-route.test.ts`
- Modify: `tests/unit/intake-search-query.test.ts`

- [ ] Add route tests proving queries over 256 characters, over eight tokens, or with a token over 64 characters return `400 query_too_complex` before rate limiting or search work; the exact limits remain accepted.
- [ ] Add a route test proving the 61st accepted search in a minute returns the existing `429` response before search work.
- [ ] Add a direct helper contract proving callers cannot construct more than eight bounded tokens even when they bypass the route.
- [ ] Run the focused tests and record the pre-fix failure.
- [ ] Export immutable search-bound constants and a bounded tokenizer. The route rejects over-limit input; the query helper defensively truncates to the same finite predicate budget.
- [ ] Call `rateLimitReject(db, `intake-search:${userId}`, 60)` after validation and before recents or SQL search.
- [ ] Preserve empty-query recents and all ordinary search response shapes.
- [ ] Run the route, query, entitlement, and search-component tests.
- [ ] Commit as `security: bound intake search amplification`.

### Task 3: Enforce billing authority where the Stripe portal is minted

**Files:**
- Modify: `lib/stripe.ts`
- Modify: `app/api/stripe/portal/route.ts`
- Modify: `tests/unit/stripe-portal-handler.test.ts`
- Create: `tests/unit/stripe-portal-route-security.test.ts`

- [ ] Add handler tests proving a deactivated owner, tech, advisor, and parts user receive `403` before the Stripe-customer query and provider call; active owner and explicit founder override remain allowed.
- [ ] Add a route test proving the authenticated email is translated through `isFounder` and passed as the explicit override.
- [ ] Run the focused tests and record the pre-fix failure.
- [ ] Add `founderOverride?: boolean` to the handler and use `canManageTeam` plus `deactivatedAt` before any billing lookup.
- [ ] Expand only the failure result status type to `400 | 403`; preserve the existing successful response.
- [ ] Pass `isFounder(user.email)` from the thin route.
- [ ] Run the new tests plus billing-page and Stripe handler tests.
- [ ] Commit as `security: restrict billing portal authority`.

### Task 4: Bound and coalesce VIN-provider traffic

**Files:**
- Modify: `lib/intake/decode-vin.ts`
- Modify: `app/api/intake/decode-vin/route.ts`
- Modify: `tests/unit/intake-decode-vin.test.ts`
- Modify: `tests/unit/decode-vin-route.test.ts`

- [ ] Add route tests proving only canonical 17-character VIN alphabet input is accepted and normalized; invalid VINs return `400 invalid_vin` before quota or provider work; the 21st valid lookup per user per minute returns `429`.
- [ ] Add library tests proving `I`, `O`, `Q`, punctuation, and wrong lengths never fetch; concurrent identical VINs share one provider request; no more than eight distinct provider requests are active; and a slow response body remains under the five-second abort window.
- [ ] Run the focused tests and record the pre-fix failure.
- [ ] Export a strict `normalizeVin` validator using `^[A-HJ-NPR-Z0-9]{17}$`.
- [ ] Add `rateLimitReject(db, `vin-decode:${userId}`, 20)` after route validation and before decoding.
- [ ] Add an in-flight promise map for identical VINs and a fail-fast eight-request provider concurrency ceiling.
- [ ] Keep the abort timer active through body parsing and clear it only in `finally`; URL-encode the normalized VIN.
- [ ] Ensure the test reset clears completed cache state and assert all in-flight tests settle.
- [ ] Run the focused VIN, intake, and entitlement tests.
- [ ] Commit as `security: bound VIN provider amplification`.

### Task 5: Verify, document, and preserve the larger gate

**Files:**
- Create: `docs/security/2026-07-19-current-production-security-wave-2a-closure.md`
- Modify: `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`

- [ ] Run all Wave 1 and Wave 2A focused security tests together.
- [ ] Run `pnpm exec tsc --noEmit`, `pnpm build`, `pnpm audit --prod --json`, and `git diff --check origin/main...HEAD`.
- [ ] Do not repeat the already reproduced full-suite invocation that stalled twice. Record it as an open merge gate for a fresh harness-debugging approach.
- [ ] Review the diff for authorization ordering, PII in fixtures/logs, user-visible friction, diagnostic enablement, unrelated changes, and hidden external mutations.
- [ ] Map each of the five finding IDs to source and test proof in the closure document.
- [ ] Update active plan Row 50 with the Wave 2A evidence while keeping the overall current-production security gate `in_progress`.
- [ ] Commit as `docs: record current-production security wave 2a`.

## Stop Conditions

- Stop if a fix requires production mutation, a real credential, customer PII, an external provider call, new user interaction, or diagnostic enablement.
- Stop if the reviewed `origin/main` base changes before integration; fetch and re-audit the diff rather than silently rebasing evidence.
- Stop and re-plan if a focused regression exposes a wider public API or data-contract change.
- The branch is not merge-ready until the remaining current-production medium findings, authorized live-control inspection, broad harness gate, and final role/tenant/concurrency re-test are complete.
