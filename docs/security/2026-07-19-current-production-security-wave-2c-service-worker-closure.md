# Current-production security Wave 2C closure receipt

**Branch:** `security/ai-pii-penetration-audit-2026-07-19`  
**Reviewed base:** `5b9fb0505a1f505eb8de8b0129b607e3d618ce4e`  
**Status:** The privacy-migration worker and every mandatory imported script are now independently reachable after logout, deactivation, or paywall.

No production system, browser profile, cache, customer record, credential, diagnostic setting, or user interface was changed.

| Finding | Durable control | Regression proof | User friction | Residual risk |
|---|---|---|---|---|
| `CAND-S072-001` | `/sw-policy.js` is an exact public fast-path exemption beside `/sw.js`; similarly named paths remain protected. A structural test parses every top-level `importScripts()` dependency and requires the same exemption automatically. | The vulnerable source produced two focused failures. The fixed auth, worker-policy, registration/migration, and public-surface gate passes 4 files / 131 tests; typecheck and the 64-page production build pass. | none | A synthetic browser retaining historical v3 cache was not created against a staging deployment; that browser-state proof remains part of the final controlled verification. |

## Why the public exception is narrow

`public/sw-policy.js` is static classifier code with no user, customer, shop, billing, or credential data. The exemption is exact: `/sw-policy.js/anything` remains gated. This allows the installed application to receive the update that removes old private caches even when the current user is no longer authorized.

## Remaining gate

Eight of fourteen current-production medium findings are now closed. Six medium findings, the live-control inspection, broad-suite diagnosis, controlled legacy-browser migration proof, final role/tenant/account-status/retry/concurrency proof, and independent re-scan remain before Row 50 can be completed or merged.
