# Current-production security Wave 2F closure receipt

**Branch:** `security/ai-pii-penetration-audit-2026-07-19`  
**Reviewed base:** `5b9fb0505a1f505eb8de8b0129b607e3d618ce4e`  
**Status:** Resolving one follow-up now permits exactly one database winner and at most one downstream corpus-decay operation.

No production system, database, schema, customer record, diagnostic setting, corpus row, or visible workflow was changed.

| Finding | Durable control | Regression proof | User friction | Residual risk |
|---|---|---|---|---|
| `CAND-S022-008` | The resolution update claims the row only when its ID and assigned technician match and `resolved_at` is still null. Only the request whose conditional update returns the claimed row may invoke corpus decay. | Two simultaneous true resolutions previously both succeeded; the regression now proves exactly one success, one stale rejection, one stored resolution, and one decay invocation. | none | Corpus decay intentionally remains non-transactional and non-fatal after the resolution claim; an internal decay failure can under-count a comeback, but cannot multiply it. |

## Verification receipt

- Test-first proof: the parallel reproducer observed two successful resolutions before implementation.
- Focused resolution gate: 1 file, 9 tests passed.
- Adjacent follow-up, scheduling, surfacing, corpus-decay, UI, entitlement, and access gate: 8 files, 129 tests passed.
- `pnpm exec tsc --noEmit`: passed.
- `pnpm build`: passed on Next.js `16.2.10`; 64 pages generated.
- `git diff --check`: passed.

## Remaining gate

Twelve of fourteen current-production medium findings are now closed. Repair-order job growth, Stripe event ordering, the live-control inspection, broad-suite diagnosis, controlled browser proof, final role/tenant/account-status/retry/concurrency proof, and independent re-scan remain before Row 50 can be completed or merged.
