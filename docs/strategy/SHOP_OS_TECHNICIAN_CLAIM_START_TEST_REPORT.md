# Shop OS Technician Claim and Start — Release Test Report

## Result

The Chunk 4 source candidate passed its complete local release gate. A technician can claim eligible work without starting time, review the exact approved scope in place, deliberately clock on, and recover from stale or interrupted handoffs without false ownership or running-clock truth.

## Reviewed state

- Production baseline: `fd2c9e552c4159cb9516be9326c3c89543de0979`
- Product-code candidate: `be60fdba07d622a853accc8043b6ae6d188b02d8`
- Branch: `codex/technician-claim-clock-on-2026-08-04`
- Written-spec approval: Buzz event `9ccca41a90e34201ded53a2b67259f9c984df3b40c2c626191dbc5fde91032a4`
- Merge and production pre-approval: Buzz event `ac679722b1eec082a71b066d3ba1e03a901e180184870e56c3cd6f1d07538cc9`

The final release-record commit is documentation-only. GitHub's exact-head checks remain the authoritative immutable receipt for the PR head that includes this report.

## Acceptance evidence

### Complete automated suite

`node scripts/test-shards.mjs` passed all eight serialized shards:

| Shard | Tests |
| --- | ---: |
| 1 | 492 |
| 2 | 485 |
| 3 | 608 |
| 4 | 559 |
| 5 | 601 |
| 6 | 554 |
| 7 | 499 |
| 8 | 506 |
| **Total** | **4,304** |

Expected failure-path logging appeared in existing tests for unavailable Stripe, NHTSA/Ford, localhost, and simulated service failures. Every shard completed green.

### Compile and production build

- `node_modules/.bin/tsc --noEmit --pretty false` — pass
- `npm run build` — pass; 69 static pages generated
- `git diff --check` — pass
- Clean worktree at tested product-code head — pass

The first sandboxed build could not reach Google Fonts. The authorized network retry fetched the two configured fonts and completed successfully; no source changed between attempts.

### Real technician journeys

`PLAYWRIGHT_USE_SYSTEM_CHROME=1 node scripts/shop-os-golden-browser.mjs test --suite technician-handoff` passed four journey families on phone and desktop, 8/8 total:

1. Approved unassigned work: Claim work → exact scope → deliberate Clock on → running truth.
2. Approved preassigned work: Review and clock on → exact scope → deliberate Clock on.
3. State matrix: waiting, below-tier, deferred, and declined work explain the state and suppress forbidden action.
4. Recovery: claim race, lost-response replay, work-load failure, and stale mounted access remain truthful and recoverable.

Each journey also checks keyboard focus, minimum target size, horizontal overflow, serious/critical Axe findings, browser faults, price leakage, one active inline tool, reduced motion, and outside-network refusal.

The initial sandboxed browser run could not bind the loopback port. The authorized loopback-only rerun passed all eight journeys.

## Independent review and security

- Full-file static/security discovery covered all 16 ranked source-like changes and supporting authorization, work, harness, and regression evidence.
- Tenant, active-actor, skill-tier, assignment, exact approval-state, idempotency, and stale-state controls remained server-authoritative.
- No reportable product vulnerability survived validation and reportability review.
- Synthetic canaries proved the original proof runner copied unlisted credential-shaped variables into its child process. Policy classified this as developer/CI-only rather than a product vulnerability, but it violated the harness's hermetic claim.
- Repair `be60fdb` replaced the denylist copy with a minimal runtime allowlist. Stripe, Anthropic, OpenAI, GitHub, `NODE_OPTIONS`, and an arbitrary unlisted canary are now absent. The tooling test passed 11/11 and the complete browser proof remained 8/8 green.
- Canonical security report: `/private/tmp/codex-security-scans/vyntechs-attention-clock/0933da044da7b3e2d3a690576d1081df88edd23e_20260804T220204Z/report.md`

## Release boundaries and rollback

- No migration or schema change.
- No dormant feature activation.
- No production repair-order read/write proof is required; the hermetic real-component journeys supply interaction evidence without customer data.
- No production secret is copied into the hermetic proof child.
- Source rollback is a normal revert of the Chunk 4 merge; there is no data cleanup or migration rollback.

## Remaining release gate

Push the exact release-record head, open the Buzz-linked PR, require all hosted checks to pass, then merge and deploy under the recorded owner pre-approval. Production proof must confirm the exact deployed merge, both production domains, health, protected-route behavior, and quiet error/fatal logs without mutating a live repair order.
