# Current-Production Security Wave 2D: Parts Workflow Integrity

**Goal:** Close `CAND-S029-001` and `CAND-S029-002` without changing the technician's normal “Need a part” interaction or adding a new page.

**Architecture:** Put the UI's existing eligibility truth—assigned technician, approved job, work in progress—inside the same database transaction as the insert. Lock the target job, preserve exact request-key idempotency, serialize a generous 50-open-request ceiling, damp bursts at 20 requests per user per minute, and bound read projections to the 100 most relevant rows.

## Constraints

- Preserve the current request body, success JSON, exact UUID replay behavior, and money-free request model.
- Only `approvalState: approved` plus `workStatus: in_progress` is eligible.
- Use not-found-style denial for ineligible job states; do not disclose state details.
- Rate limiting is defense in depth; the locked durable ceiling remains authoritative.
- A resolved or dismissed request frees one open slot.
- Bound both job and ticket projections; requested work sorts ahead of resolved history, then newest first.
- No schema migration, production mutation, UI prompt, diagnostic enablement, or provider call.

## Test-first execution

- [ ] Prove every disallowed approval/work state currently inserts and then fails after the fix.
- [ ] Seed 50 open requests and prove the next distinct key conflicts while exact replay remains idempotent.
- [ ] Start two creates from a 49-request state and prove serialization leaves exactly 50 open rows.
- [ ] Seed more than 100 history rows and prove each list returns a bounded, current-first projection.
- [ ] Prove the route applies `part-request:{shopId}:{profileId}` at 20 per minute after auth, paywall, shop, and JSON checks but before domain work.
- [ ] Run part-request domain, route, workspace, ticket, type, build, and diff gates.
- [ ] Record the two-finding closure while keeping Row 50 `in_progress`.

## Stop conditions

- Stop and re-plan if PGlite cannot exercise the transaction/lock contract or if an existing product path intentionally creates parts requests outside approved in-progress work.
- Stop if closure requires external supplier integration, money movement, production migration, or a user-facing workflow change.
