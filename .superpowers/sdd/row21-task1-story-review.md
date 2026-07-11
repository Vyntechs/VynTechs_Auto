# Row 21 Task 1 — Human story review domain

## Scope

Implemented only the approved Task 1 domain, JSONB metadata type, and existing story-route `PUT` seam. No migration, UI, quote decision/version logic, engine write, provider call, package change, or production state was touched.

## TDD proof

- RED: `vitest run tests/unit/shop-os-customer-story-review.test.ts tests/unit/shop-os-customer-story-route.test.ts --reporter=verbose`
- Expected failure: seven assertions failed because `saveReviewedCustomerStory` and route `PUT` did not exist.
- GREEN: `vitest run tests/unit/shop-os-customer-story-review.test.ts tests/unit/shop-os-customer-story-route.test.ts tests/unit/shop-os-customer-stories.test.ts tests/unit/customer-story-generator.test.ts --reporter=dot`
- Result: exit 0; domain, route, row-20 persistence/workspace, and provider-boundary regressions passed.

## Behavior proved

- AI review edits only finding/recommendation and preserves server concern, waiver, and sourced proof.
- Topology may create an honest manual reviewed story with empty proof; ordinary-tree fallback and published wizard are denied.
- Actor/key/payload-bound replay returns committed truth before stale revision; changed or cross-actor reuse conflicts.
- Ticket → jobs by ID → versions by ID → session → actor `NOWAIT` lock order is generated and contention is retryable.
- Story-content changes invalidate one active immutable version; metadata-only/new-key unchanged review and canonical retry do not.
- Parts, inactive, cross-shop, closed ticket/job/session, corrupt story/meta, and unsupported paths fail closed.
- Review identity, fingerprint, actor, time, and source come only from server truth; the route remains authenticated, paywalled, strict, and provider-free.

## TypeScript

`pnpm exec tsc --noEmit` was run. It reported only concurrently edited Task 2 quote-projection fixture errors in `shop-os-manual-quote-builder.test.tsx` and `shop-os-quote-page.test.tsx`; it reported no Task 1 file error. The control lane owns the clean shared-worktree rerun after Task 2 converges.

## Assumptions

- `open`, `in_progress`, and `blocked` are the non-closed diagnostic job states; `done` and `canceled` are closed for review.
- Existing `storyMeta` JSONB safely carries additive audit fields without DDL.
- Current topology sentinel is `done: true` with `currentNodeId: '_topology'`; no topology engine semantics are changed.

## Skipped/failed

- Full suite and build: intentionally reserved for the control lane.
- Clean TypeScript: temporarily blocked by the disjoint in-progress Task 2 test fixtures described above.
