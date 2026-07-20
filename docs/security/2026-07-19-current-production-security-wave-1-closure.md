# Current-production security Wave 1 closure receipt

**Branch:** `security/ai-pii-penetration-audit-2026-07-19`
**Reviewed base:** `5b9fb0505a1f505eb8de8b0129b607e3d618ce4e`
**Status:** Source controls and focused proof complete; merge gate remains open because the repository-wide Vitest command stalls in the known local test environment.

No production system, Supabase project, provider, payment system, credential, customer record, diagnostic release setting, or user interface was changed.

| Finding | Durable control | Regression proof | User friction | Residual risk |
|---|---|---|---|---|
| `CAND-S052-001` | `package.json` and `pnpm-lock.yaml` resolve Next.js `16.2.10`; `tests/unit/security-dependency-floor.test.ts` rejects any version below `16.2.6`. | Dependency-floor test passed; TypeScript and the 64-page production build passed on Next.js `16.2.10`. | none | The destructive vendor DoS payload was not executed. |
| `CAND-S052-002` | Patched Next.js plus `app/(app)/sessions/layout.tsx` independently enforces deactivation, paywall, release, and entitlement before child rendering. | `sessions-layout-security.test.tsx` exercises deactivated, canceled, release-off, unentitled, and valid development branches. | none | Hosting-edge rules were not inspected; route-local control no longer relies on them. |
| `CAND-S052-003` | Patched Next.js plus the sessions segment guard makes dynamic-route middleware behavior non-authoritative. | The layout is invoked directly without middleware in five focused policy tests. | none | The exact vendor query was not sent to a deployment. |
| `CAND-S054-001` | Every `/sessions` child page inherits the segment guard before its page-level session query. Production remains globally release-off. | 69 combined release/access tests passed, including zero-entitlement and release-off rejection. | none | Diagnostics stay disabled; future re-enable still requires the separate 50-finding gate. |
| `CAND-S055-001` | `listSessionsForTech` constrains both `shop_id` and `tech_id` in SQL and transfers at most 50 newest rows. | PGlite proves same-shop peer and cross-shop complaints are excluded; page wiring passes trusted shop/profile IDs. | none | A future manager-wide diagnostic index requires a separate explicit capability and projection. |
| `CAND-S056-001` | `settings/team/page.tsx` calls `checkAccess` before role evaluation or the roster query. | Deactivated and past-due owners redirect before `db.select`; active roster/component tests remain green. | none | The exact vendor prefetch request was not sent to production. |
| `CAND-S056-002` | `settings/shop/page.tsx` calls `checkAccess` before shop, rate, canned-job, or supplier reads. | Deactivated and unpaid owners redirect with zero sensitive helper calls; active owner/founder behavior remains green. | none | The exact vendor prefetch request was not sent to production. |

## Verification receipt

- Focused Wave-1 gate: 8 files, 119 tests passed.
- Settings boundary subset: 4 files, 30 tests passed.
- Sessions release/access subset: 3 files, 69 tests passed.
- Sessions object boundary subset: 2 files, 32 tests passed.
- `pnpm exec tsc --noEmit`: passed.
- `pnpm build`: passed on Next.js `16.2.10`; 64 pages generated.
- `pnpm audit --prod --json`: the three validated Next.js advisories are absent. Remaining entries are PostCSS build-time stringification and Supabase Realtime's unused `ws` client path; they remain explicit rather than hidden.
- `pnpm test`: attempted normally and with one worker; both produced no test progress and were stopped. This reproduces the untouched audit baseline's broad local-suite stall, so no full-suite pass is claimed.

## Merge stop condition

Do not mark ShopOS Row 50 complete or merge this wave until the repository-wide test gate yields a trustworthy result, or a separately reviewed test-harness diagnosis proves and replaces the unavailable command with an equivalent deterministic gate.
