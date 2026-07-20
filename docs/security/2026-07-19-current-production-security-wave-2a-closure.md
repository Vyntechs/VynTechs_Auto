# Current-production security Wave 2A closure receipt

**Branch:** `security/ai-pii-penetration-audit-2026-07-19`  
**Reviewed base:** `5b9fb0505a1f505eb8de8b0129b607e3d618ce4e`  
**Status:** Five medium request-boundary findings have source, regression, type, and production-build proof. The larger current-production security gate remains in progress.

No production system, Supabase project, Stripe account, external VIN provider, credential, customer record, diagnostic release setting, or user interface was changed.

| Finding | Durable control | Regression proof | User friction | Residual risk |
|---|---|---|---|---|
| `FR016-C001` | OAuth callback return paths use `safeNextPath`, which rejects absolute, protocol-relative, backslash-bearing, and control-character targets before URL construction. | The exact decoded `/\\evil.example` reproducer now returns to `/today`; benign nested paths retain their query string. | none | Canonical ingress authority remains a separate live-control inspection item. |
| `FR016-C002` | OTP confirmation shares the same validator, eliminating policy drift between password, OAuth, and recovery flows. | Callback, OTP, pure-validator, and sign-in tests pass together, including the same authority-escape reproducer. | none | Canonical ingress authority remains a separate live-control inspection item. |
| `CAND-S005-001` | Intake search rejects more than 256 characters, eight tokens, or 64 characters per token; direct callers are defensively capped; accepted requests use a 60-per-user minute bucket. | Over-limit requests stop before quota or query work, exact boundaries pass, quota rejection stops SQL, and existing search, recents, tenant, and component behavior remains green. | none in normal use | The shared rate limiter intentionally fails open on counter-storage failure, but each request still has a finite predicate budget. |
| `CAND-S010-001` | The Stripe portal sink rejects deactivated profiles and requires owner authority or an explicit authenticated-founder override before billing-record lookup or provider invocation. | Tech, advisor, parts, and deactivated-owner cases receive `403`; active owner and founder paths remain green; the route passes only `isFounder(user.email)`. | none for authorized users | Trusted return-origin configuration remains part of the separate live-control inspection. |
| `CAND-S040-002` | VIN input is restricted to the canonical 17-character alphabet; accepted requests use a 20-per-user minute bucket; identical in-flight lookups coalesce; each process allows at most eight provider calls; timeout covers headers and body. | Invalid alphabet and length never fetch, lowercase normalizes, concurrent duplicates fetch once, the ninth distinct concurrent request fails closed, slow body parsing aborts, and adjacent intake tests remain green. | none in normal use | The concurrency ceiling is per application process; deployment-wide rate behavior will be checked during live-control inspection. |

## Verification receipt

- Test-first failures were observed for every new control before implementation.
- Combined Wave 1 + Wave 2A gate: 22 files, 296 tests passed.
- `pnpm exec tsc --noEmit`: passed.
- `pnpm build`: passed on Next.js `16.2.10`; 64 pages generated.
- `git diff --check origin/main...HEAD`: passed.
- `pnpm audit --prod --json`: 0 critical, 1 high, 2 moderate. The validated Next.js advisories remain absent. The explicit residuals are PostCSS stringification through Next.js and `ws` through unused Supabase Realtime dependency paths.
- The repository-wide Vitest invocation was not repeated because both approved Wave 1 attempts stalled without progress. A fresh harness-diagnosis approach remains a merge gate; no full-suite pass is claimed.

## Remaining gate

Wave 2A closes five of fourteen current-production medium findings. Nine current-production medium findings, the authorized read-only live-control inspection, a trustworthy broad test result, final role/tenant/account-status/retry/concurrency proof, and an independent security re-scan remain before Row 50 can be completed or the branch recommended for merge.
