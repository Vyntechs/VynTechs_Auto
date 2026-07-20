# Current-production security Wave 2B closure receipt

**Branch:** `security/ai-pii-penetration-audit-2026-07-19`  
**Reviewed base:** `5b9fb0505a1f505eb8de8b0129b607e3d618ce4e`  
**Status:** The unused generic ticket-creation entrance is retired; two medium findings are closed without changing an active user flow.

No production system, data, schema, credential, customer record, diagnostic release setting, or user interface was changed.

| Finding | Durable control | Regression proof | User friction | Residual risk |
|---|---|---|---|---|
| `CAND-S015-001` | Exact `POST /api/tickets` now returns opaque `404 not_found` before authentication, parsing, or domain work. Caller-selected `source: counter` can no longer reach the low-level creator. | The retired-route contract fails on the vulnerable source and passes after retirement; Counter Intake remains constrained to `/api/tickets/counter`. | none | Internal `createTicket` remains available to reviewed server modules and tests; no public generic route calls it. |
| `CAND-S015-002` | The same retirement removes the unmetered, non-idempotent durable write sink instead of adding complexity to a dead API. | Repository search finds no non-test product client for exact `POST /api/tickets`; active Quick Ticket, Counter Intake, ticket-detail, and add-job checks pass. | none | Quick and Counter retain their existing shared limiter and idempotency controls. Add-job amplification is tracked separately. |

## Verification receipt

- Test-first retirement proof: the vulnerable handler returned `400` after auth and parsing instead of the required opaque `404`.
- Active-flow regression gate: 5 files, 96 tests passed.
- `pnpm exec tsc --noEmit`: passed.
- `pnpm build`: passed on Next.js `16.2.10`; 64 pages generated.
- Product-client search: creation calls exist only for `/api/tickets/quick` and `/api/tickets/counter`; no product code posts to exact `/api/tickets`.
- `git diff --check`: passed.

## Remaining gate

Seven of fourteen current-production medium findings are now closed. Seven medium findings, the live-control inspection, broad-suite diagnosis, final role/tenant/account-status/retry/concurrency proof, and independent re-scan remain before Row 50 can be completed or merged.
