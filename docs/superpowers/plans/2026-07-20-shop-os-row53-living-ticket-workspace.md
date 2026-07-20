# ShopOS Row 53 — The Living Repair Order

**Goal:** Let every permitted role move one repair order from handoff through quote, work, payment, and close without leaving the repair order or losing the result of the last action.

**Signature:** The repair order behaves like a physical work jacket on the counter: it never disappears. One calm next move opens exactly where it is needed, and completion folds back into an updated ledger.

**Architecture:** Keep `/tickets/[id]` as the mounted source of truth. Add one client controller with a pure role/status command projector and one active inline tool at a time. Reuse the current assignment, quote, simple-work, parts-request, payment, and close contracts; adapt their screens for embedded rendering instead of inventing parallel domain logic. Existing deep links remain safe fallbacks.

**Scope boundary:** No schema, migration, new page, diagnostics/media enablement, general add-job reopening, provider, messaging, pricing, or production-data mutation.

## Pre-code pressure test

- **Concurrency:** Every inline mutation must consume server truth; assignment/work/quote conflicts must keep the repair order mounted and reconcile only the affected projection.
- **Security:** The controller receives only capabilities and the existing tenant-safe projections. Lazy loaders use authenticated routes and strict parsers; no raw profile, customer, VIN, session, or full-ticket payload may leak through mutation envelopes.
- **Failure:** A failed tool load or mutation leaves the ledger visible, names the unsaved action, and offers a focused retry or deep-link fallback. It never clears local truth or claims success.
- **Data contract:** The ticket projection remains authoritative for identity and ledger placement; embedded tools own only their bounded state and publish narrow result events upward.
- **Rollback:** Existing quote/work deep links remain functional. The inline controller can be removed without changing stored data or domain behavior.
- **Simplicity check:** One mounted screen, one next move, one active tool. No dashboard, wizard, workflow engine, or new route hierarchy.

---

### Task 1 — Project the one honest next move

- [x] Write RED table tests across tech/advisor/parts/owner, ticket state, assignment, approval, and work state.
- [x] Add a pure projector that returns one primary command plus eligible secondary commands without inventing authority.
- [x] Prefer, in order: resolve assignment → finish quote/approval → perform assigned approved work → ring out/close → read-only current truth.
- [x] Keep terminal tickets read-only and keep diagnostics unavailable.
- [x] Render the command as a quiet 44px action on the existing ticket, with no route change.

### Task 2 — Handoff in place

- [x] Load only the active same-shop wrenching roster for advisor/owner.
- [x] Open a compact assignee chooser inside the selected ledger row.
- [x] Claim, unassign, and reassign through the existing assignment route, including explicit below-tier confirmation.
- [x] Reconcile only that job from the narrow assignment envelope; preserve focus, conflicts, and the rest of the repair order.

### Task 3 — Quote in place

- [x] Lazy-load the existing quote, canned-work, and safe vendor projections only when Quote opens.
- [x] Add an embedded mode to the existing manual quote builder; do not fork quote logic or remove deep-link support.
- [x] Replace embedded refresh paths with focused refetches and publish approval/work-state changes back to the mounted ledger.
- [x] Collapse to a concise prepared/approved proof without losing an unsaved editor or retry identity.

### Task 4 — Perform in place

- [x] Lazy-load the existing assigned simple-work projection and text-only part requests.
- [x] Add an embedded mode to the existing work surface; preserve clocks, notes, completion, escalation idempotency, and no-media behavior.
- [x] Publish work-state changes back to the ledger and advance the next move without a page refresh.
- [x] Keep diagnostic jobs dormant and preserve existing work deep links.

### Task 5 — Ring out and close in place

- [x] Keep advisor/owner money and close authority unchanged.
- [x] Remove the broad refresh after close; update the mounted repair order and receipt from the returned ring-out truth.
- [x] Prove unfinished work, outstanding balance, concurrent changes, and terminal tickets fail safely without disappearing.

### Task 6 — Converge and publish

- [ ] Prove phone (375px), desktop, keyboard, focus, reduced motion, and long technician/customer-controlled text.
- [ ] Run focused tests with at most two workers, TypeScript, full suite, production build, and diff guards.
- [ ] Review tenant/capability boundaries, stale state, lost work, duplicate tools, refreshes, diagnostics/media drift, and extra pages.
- [ ] Run final static, security, and runtime convergence; consolidate once, repair once, and focused re-review once.
- [ ] Update Row 53 and `SHOP_OS_DRIVER_STATE.md`, publish, merge after green gates, and verify exact-revision production health.

**Stop if:** Any inline tool requires a new data model, broader response envelope, engine semantic change, media/diagnostic enablement, or a repair/close authorization bypass; or focused re-review discovers a new blocking architecture defect.

**Done when:** A permitted user can open one repair order and complete their next handoff, quote, work, or close action in place; the ledger immediately becomes the proof of that action; phone and desktop preserve the same continuity; and every existing deep link remains a safe fallback.
