# Current-Production Security Wave 2G: Public Add-Job Retirement

**Goal:** Close `CAND-S012-001` by removing the unused public entrance that can append unbounded jobs to an existing repair order.

**Architecture:** The current UI has no caller for `POST /api/tickets/:id/jobs`. Constrained counter intake still uses the underlying `addTicketJob` domain function inside its own transaction, and canned quote jobs use a separate bounded/idempotent route. Retire only the dead public handler with the same opaque 404 pattern already used for legacy generic ticket creation.

## Constraints

- Preserve counter intake, quick tickets, canned jobs, quote editing, assignment, technician work, and the internal `addTicketJob` domain function.
- Return opaque 404 before auth, paywall, request parsing, route-parameter resolution, or domain/database work.
- Do not add a schema migration, UI control, user prompt, production write, or diagnostic enablement.
- Prove there is no production client caller before removing reachability.

## Test-first execution

- [ ] Structural search proves no application client calls exact `POST /api/tickets/:id/jobs`.
- [ ] Require the retired handler to return opaque 404 without invoking auth, paywall, parsing, or `addTicketJob`.
- [ ] Preserve internal add-job access/capability tests and counter-intake creation tests.
- [ ] Run ticket route/domain, counter-intake, canned-job, quote, typecheck, build, and diff gates.
- [ ] Record closure while keeping Row 50 `in_progress`.
