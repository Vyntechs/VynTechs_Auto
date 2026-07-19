# Current-production security Wave 2G closure receipt

**Branch:** `security/ai-pii-penetration-audit-2026-07-19`  
**Reviewed base:** `5b9fb0505a1f505eb8de8b0129b607e3d618ce4e`  
**Status:** The unused public add-job entrance is unreachable, while every current repair-order creation and editing flow remains on its existing constrained path.

No production system, database, schema, customer record, repair order, diagnostic setting, or visible workflow was changed.

| Finding | Durable control | Regression proof | User friction | Residual risk |
|---|---|---|---|---|
| `CAND-S012-001` | Exact `POST /api/tickets/:id/jobs` returns opaque 404 before authentication, paywall, parsing, route-parameter resolution, or domain work. The internal helper remains available only to server-owned counter intake; canned quote jobs retain their separate idempotent route. | Repository client search found no caller for the exact entrance; its prior valid/invalid contracts were replaced by a fail-closed structural test; 96 adjacent ticket, access, counter-intake, canned-job, and quote tests remain green. | none | A future direct add-job feature must introduce operation identity, role policy, and a durable per-ticket ceiling before this route can be restored. |

## Verification receipt

- Test-first proof: the retired-route contract failed against the reachable handler before implementation.
- Production-client source search: no exact public add-job caller found; only nested assignment, work, part, and quote routes remain.
- Adjacent ticket route/domain, counter-intake, canned-job, and quote gate: 7 files, 96 tests passed.
- `pnpm exec tsc --noEmit`: passed.
- `pnpm build`: passed on Next.js `16.2.10`; 64 pages generated.
- `git diff --check`: passed.

## Remaining gate

Thirteen of fourteen current-production medium findings are now closed. Stripe event ordering, the live-control inspection, broad-suite diagnosis, controlled browser proof, final role/tenant/account-status/retry/concurrency proof, and independent re-scan remain before Row 50 can be completed or merged.
