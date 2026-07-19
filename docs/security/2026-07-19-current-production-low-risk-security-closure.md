# Current-production low-risk security closure receipt

**Branch:** `security/ai-pii-penetration-audit-2026-07-19`  
**Reviewed production deployment:** `5b9fb0505a1f505eb8de8b0129b607e3d618ce4e`  
**Status:** All eleven low-risk current-production findings are closed in source. No production mutation was made.

## Finding map

| Finding | Closure | Proof |
| --- | --- | --- |
| `CAND-S003-001` | Deferred approval is one compare-and-swap from `deferred`; stale/replayed requests lose. | Deferred-action transition and replay tests. |
| `CAND-S003-002` | Deferred override uses the same atomic state guard. | Deferred-action state and authority tests. |
| `CAND-S003-003` | Deferred close uses the same atomic state guard. | Deferred-action state and concurrency tests. |
| `CAND-S010-004` | Team role and deactivation mutations protect explicit `isCurator`, not obsolete role text alone. | Team route authority tests. |
| `FR018-C001` | Flow save/publish/archive transitions are compare-and-swap guarded; publish locks the row before validation. | Transaction-barrier race regression. |
| `CAND-S014-002` | Legacy AI story generation returns `feature_unavailable` before auth, parsing, domain, or Anthropic access while diagnostics is off. | Valid, malformed, repeated, and fresh-key route probes; zero provider calls. |
| `CAND-S014-003` | Fresh client keys cannot amplify paid generation calls; the active generation UI is removed. | Server and quote-builder tests; existing stories remain manually reviewable. |
| `CAND-S040-004` | Recent-customer vehicles are ranked and capped at ten per customer inside SQL. | High-cardinality query and SQL-shape regression. |
| `CAND-S096-001` | Today returns at most 200 active jobs plus an overflow signal, with assigned work ordered first. | 205-row database regression and integrated notice test. |
| `CAND-S096-002` | Vehicle history selects 101 tickets as a sentinel and renders at most the newest 100 with an honest stored-history notice. | 102-visit database regression and page/component tests. |
| `shard004-health-db-amplification` | Public `/api/health` returns fixed application liveness and performs zero database work. | Ten repeated route probes with zero database executions. |

The live-only public-schema ACL finding is separately closed by migration `0043` and its [source closure receipt](./2026-07-19-live-public-schema-acl-closure.md). The fresh dependency audit closure is recorded in the [dependency receipt](./2026-07-19-current-production-dependency-audit-closure.md).

## Commits

- `5ae24e9` — atomic authority transitions
- `a981841` — legacy AI story generation retirement
- `49de378` — bounded integrated ShopOS history reads
- `d56da01` — database-free public health check
- `3101e87` — patched transitive dependency advisories
- `c9277fd` — collapsed, deliberate review of previously saved stories after full-suite regression discovery

## Verification receipt

- Focused state/authority slice: 7 files, 59 tests passed.
- AI story route and UI neighborhood: 5 files, 100 tests passed; post-regression route/UI/quote neighborhood: 3 files, 106 tests passed.
- Bounded read neighborhood: 9 files, 95 tests passed.
- Health/auth neighborhood: 2 files, 57 tests passed.
- `pnpm exec tsc --noEmit`: passed.
- `pnpm build`: passed after dependency pins on Next.js `16.2.10`; 64 pages generated.
- `pnpm audit --prod`: **No known vulnerabilities found**.
- Full suite, sequential and memory-bounded: **304 files, 3,389 tests passed**.
  - shard 1: 38 files / 371 tests
  - shard 2: 38 files / 322 tests
  - shard 3: 38 files / 584 tests
  - shard 4: 38 files / 394 tests after closing the saved-story clutter regression
  - shard 5: 38 files / 540 tests
  - shard 6: 38 files / 440 tests
  - shard 7: 38 files / 404 tests
  - shard 8: 38 files / 334 tests
- `git diff --check`: passed.

Non-failing Happy DOM abort messages and browser-emulated recall-provider CORS refusals remain known test-harness noise. They did not change any result and were already recorded as cleanup debt.

## Remaining gate

Source closure is not production closure. Before launch, migration `0042` then `0043`, Supabase compromised-password screening, deployment, and post-deploy tenant/role/browser smoke checks must be executed as one controlled rollout with rollback evidence.
