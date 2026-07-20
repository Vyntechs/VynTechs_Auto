# Current-production low-risk security closure plan

**Goal:** Close all eleven low-risk current-production findings before real PII or public launch without adding user pages or re-enabling diagnostics.

Migration `0043` already closes the live-only public-schema ACL finding. The remaining ten findings are grouped into four minimal, independently verifiable slices.

## Slice A — state and authority invariants

Findings: `CAND-S003-001`, `CAND-S003-002`, `CAND-S003-003`, `CAND-S010-004`, `FR018-C001`.

- Make curator approve, override, and close transitions compare-and-swap from the one legitimate deferred state; stale or concurrent requests lose without mutation.
- Protect explicit `isCurator` authority during shop role and deactivation mutations rather than relying on obsolete role text.
- Make diagnostic flow save/publish transitions atomic and immutable, or fail closed behind the diagnostics-off release policy where a future re-enable requires a redesigned flow contract.
- Verify legitimate operations, stale state, replay, concurrency, cross-object IDs, lower authority, and diagnostics-off behavior.

## Slice B — provider egress and paid-call retirement

Findings: `CAND-S014-002`, `CAND-S014-003`.

- The product decision is diagnostics off while AutoEye is rebuilt; therefore the current ShopOS must not send legacy technician observations to Anthropic or incur paid story-generation calls.
- Retire the AI-generation POST entrance server-side and remove its active UI entrance while preserving manual findings/recommendation editing for ordinary ShopOS work.
- Keep the legacy implementation unreachable for later deletion or replacement; any re-enable requires a new privacy broker, explicit provider economics, stable reservation/idempotency, and fresh security review.
- Verify zero provider invocation for authenticated, replayed, concurrent, or fresh-key requests.

## Slice C — bounded integrated views

Findings: `CAND-S040-004`, `CAND-S096-001`, `CAND-S096-002`.

- Push recent-vehicle limits into SQL per customer so discarded VIN/plate rows never cross the database boundary.
- Bound Today and vehicle-history reads at the database layer with one extra sentinel row to signal overflow.
- Keep results integrated on the existing pages; show a compact continuation/older-history affordance or honest truncation notice rather than adding a page.
- Reuse the already-retired unmetered generic ticket entrance and existing bounded counter/quick creation controls; do not build duplicate throttling.
- Verify tenant scope, stable ordering, maximum returned cardinality, overflow signaling, and normal small-shop output.

## Slice D — zero-database public liveness

Finding: `shard004-health-db-amplification`.

- Keep `/api/health` public and inexpensive, but make it process/deployment liveness only with no database query.
- Database readiness remains provider-internal through Supabase/Vercel health and controlled post-deploy smoke checks.
- Verify repeated unauthenticated requests execute zero database work and return a fixed minimal response.

## Whole-wave verification

- Run red/green focused tests for every finding cluster.
- Run the complete affected role, route, query, flow, diagnostics-off, and concurrency neighborhoods.
- Run TypeScript, production build, bounded full-suite shards, dependency audit, and diff review.
- Re-read the original safe reproducers against the final branch and record one closure receipt mapping every ID to proof.

## Rollback and stop conditions

- Each slice is independently revertible before production.
- Stop if preserving a currently used normal ShopOS flow requires new product behavior, customer data, spend, or a provider mutation.
- Do not apply migrations, change Supabase Auth, deploy, or merge during these source slices.
