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

`pnpm exec tsc --noEmit` passes after Task 1 and Task 2 domain convergence.

## Assumptions

- `open`, `in_progress`, and `blocked` are the non-closed diagnostic job states; `done` and `canceled` are closed for review.
- Existing `storyMeta` JSONB safely carries additive audit fields without DDL.
- Current topology sentinel is `done: true` with `currentNodeId: '_topology'`; no topology engine semantics are changed.

## Skipped/failed

- Full suite and build: intentionally reserved for the control lane.
- None within Task 1; the full suite and build remain intentionally reserved for the control lane.

## Independent-review follow-up

Commit follow-up hardens canonical replay and introduces the shared authoritative story contract requested during Task 1/2 convergence.

- Canonical replay now revalidates the current session path, exact concern/waiver/proof, source, session binding, and AI generation binding before returning committed truth.
- The request fingerprint includes the originally submitted expected revision; its now-stale original value replays, while changed revision/key reuse conflicts.
- Review narratives normalize CRLF, surrounding whitespace, NFC, and zero-width separators; whitespace/control-only payloads fail at route and domain boundaries.
- PUT returns a bounded safe metadata projection without request fingerprints, client keys, or actor IDs.
- Existing manual stories require complete row-21 review audit, positive revision, and exact UUID session binding.
- Review locks now include tenant predicates on ticket, jobs, versions, session, and actor.
- `lib/shop-os/customer-story-contracts.ts` is the shared strict parser/projection seam for persisted stories, full metadata, and immutable snapshot metadata.

Follow-up RED: nine route/domain regressions failed plus the shared-contract suite failed to resolve before implementation.

Follow-up GREEN: five focused files / 108 tests pass; `pnpm exec tsc --noEmit` passes; targeted diff check passes.
