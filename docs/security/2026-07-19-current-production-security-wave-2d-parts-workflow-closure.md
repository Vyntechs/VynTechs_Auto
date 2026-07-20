# Current-production security Wave 2D closure receipt

**Branch:** `security/ai-pii-penetration-audit-2026-07-19`  
**Reviewed base:** `5b9fb0505a1f505eb8de8b0129b607e3d618ce4e`  
**Status:** Parts-request eligibility, concurrency, durable cardinality, burst, and read bounds are enforced without changing the technician workflow.

No production system, database, schema, supplier, payment, customer record, diagnostic setting, or user interface was changed.

| Finding | Durable control | Regression proof | User friction | Residual risk |
|---|---|---|---|---|
| `CAND-S029-001` | `createPartRequest` now locks the same-shop ticket and job and requires the assigned technician, repair/maintenance kind, `approved` authorization, and `in_progress` work state inside the insert transaction. Every other state fails with opaque `not_found`. | Eight disallowed approval/work combinations fail with zero rows; the approved in-progress path and exact replay remain green. | none | Correctness assumes all job-state writers honor normal PostgreSQL row-update locking; the final concurrency re-scan will exercise adjacent writers. |
| `CAND-S029-002` | The route uses a 20-per-user minute bucket; the locked transaction caps open requests at 50 per job; resolution frees a slot; job/ticket projections return at most 100 requested-first, newest rows. | A seeded 50-request job rejects a fresh key but accepts exact replay; two concurrent creates at 49 leave exactly 50; 110-row history returns exactly 100 current-first rows. | none in normal use | The shared limiter intentionally fails open on counter-storage failure, but the serialized durable ceiling remains authoritative. |

## Verification receipt

- Test-first proof: 13 focused failures reproduced missing state, quota, concurrency, list, and route controls.
- Focused domain and route gate: 2 files, 24 tests passed.
- Adjacent domain, route, technician panel, ticket panel, work page, and ticket page gate: 6 files, 51 tests passed.
- `pnpm exec tsc --noEmit`: passed.
- `pnpm build`: passed on Next.js `16.2.10`; 64 pages generated.
- `git diff --check`: passed.

## Remaining gate

Ten of fourteen current-production medium findings are now closed. Four transaction-integrity findings, the live-control inspection, broad-suite diagnosis, controlled browser proof, final role/tenant/account-status/retry/concurrency proof, and independent re-scan remain before Row 50 can be completed or merged.
