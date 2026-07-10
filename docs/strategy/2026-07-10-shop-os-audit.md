# Shop OS plan audit — `main`, remote history, and live schema

**Date:** 2026-07-10
**Target:** `main` @ `38a3b7fc1ee8c910bd5433b74e2aeb64c6731ca7`
**Status:** Evidence record for Rev 4 of `2026-07-10-shop-os-spec-and-phased-plan.md`; this file is not a competing implementation plan.

## Executive verdict

The broad product direction is sound: a ticket/job spine should wrap the diagnostic engine, manual quoting must work before vendor integrations, and customer-facing sends and money commits need human gates.

Rev 3 was not implementation-ready. Its baseline mixed `main` code with assumptions, missed remote and live database history, and promised several flows that the current engine and proposed schema cannot support. Rev 4 corrects those defects without changing product code.

The most important correction is a new Phase 0. `main` contains no Shop OS model, but the live Supabase project already contains two unrepresented Shop OS migrations and two competing partial schemas. No new Shop OS DDL is safe until those are reconciled.

## What was inspected

- Clean clone of `Vyntechs/VynTechs_Auto` from `main`.
- All remote heads, not only the single branch initially cloned.
- The original remote-only audit at commit `b36fb367c2e1b9ad426fadcef3eacc00d66a5fd6`.
- PR #70 and the `release/shop-management` branch.
- Current routes, handlers, schema, migrations, UI surfaces, tests, privacy policy, terms, service worker, and diagnostic lifecycle.
- Live Supabase migration history, table metadata, aggregate row counts, and security advisors through read-only calls.
- Current primary vendor documentation for Twilio, PartsTech, O'Reilly Pro, and RepairPal.

No product code, remote branch, PR, customer row, or live database state was changed.

## Provenance correction

Rev 3 says the referenced audit never existed on any branch or in history. That is false.

- Remote branch: `origin/claude/shop-os-architecture-peqi8n`
- Commit: `b36fb367c2e1b9ad426fadcef3eacc00d66a5fd6`
- Path: `docs/strategy/2026-07-10-shop-os-audit.md`
- The audit and the phased-plan branch share parent `54921a4`; the audit commit predates the phased-plan commits.

The remote audit is useful discovery evidence, not the active plan. Its recommendations for scheduling, DVI, invoicing, payments, inventory, labor clocks, and management analytics remain intentionally cut from v1 by the narrower owner-approved plan. Its useful Phase-0 vendor-discovery warning is restored.

## Three different realities

### 1. `main` source code

`main` has no `tickets`, `ticket_jobs`, quote, parts-vendor, customer-message delivery, generalized notification, or skill-tier domain. All Shop OS workstreams remain unimplemented in source.

`lib/db/schema.ts` declares 38 Drizzle tables. Source migrations contain one additional physical table (`tech_outcomes`) not represented as its own Drizzle declaration, so “38 tables” is only a code-declaration count.

### 2. Remote history outside `main`

PR #70 was merged into `release/shop-management`, not `main`; PR #71, which would have promoted that work, closed. PR #70 contains:

- `shops.shop_mgmt_enabled`
- `repair_orders`
- `sessions.repair_order_id`
- `sessions.customer_authorized`
- intake logic that conditionally creates a repair order

The exact original audit also lives only on a remote branch.

### 3. Live Supabase

Read-only inspection confirmed 47 live public base tables and migration drift not represented on `main` or any fetched remote source migration:

| Live migration | Version | Live objects |
|---|---:|---|
| `shop_mgmt_foundation` | `20260517134921` | `shop_mgmt_enabled`, `repair_orders`, session link/authorization columns |
| `shop_os_v2_foundation` | `20260610181258` | `customers.preferred_channel`, `customers.opt_ins`, `vehicles.diesel_context`, `work_orders`, `concerns`, `line_items`, `authorizations`, `outbound_messages` |

Aggregate live state at audit time:

| Object | Rows |
|---|---:|
| shops with `shop_mgmt_enabled=true` | 1 |
| `repair_orders` | 1 |
| `work_orders` | 0 |
| `concerns` | 0 |
| `line_items` | 0 |
| `authorizations` | 0 |
| `outbound_messages` | 0 |
| customers with non-default `preferred_channel` or `opt_ins` | 0 of 8 |
| vehicles with non-null `diesel_context` | 0 of 8 |
| sessions with non-null `customer_authorized` | 0 of 91 |

The six live-only tables have RLS enabled but no policies, which Supabase’s security advisor flags. Phase 0 must preserve the one repair-order record, choose one canonical model, represent the final state in source-controlled migrations, and leave no parallel ghost schema. Any drop/rename is a destructive owner gate, not an autonomous agent action.

## Evidence-backed plan defects

| Area | Rev 3 claim | Evidence | Required correction |
|---|---|---|---|
| Counter intake | Real VIN decode and tech/open assignment | Decode exists server-side but the UI never calls it. “Open queue” passes null, which self-assigns. Team lookup includes every shop profile, including inactive/non-wrenching users. | Wire decode; remove the remaining dead scan affordance; filter active `skillTier` profiles; make open truly unassigned; redirect advisors to the ticket they can read. |
| Fake affordances | Camera scan and auto-save still need removal | Tests already pin both as removed. The remaining false claims are “VIN auto-fills” and the dead `Scan VIN/plate` control. | Replace the stale cleanup task with real decode wiring and honest copy. |
| Door B | Tech quick start can invisibly auto-wrap a required customer/vehicle ticket | The form captures only vehicle snapshot + complaint. `createSessionForUser` leaves `sessions.vehicleId` null and creates no customer. | Create a provisional ticket with nullable customer/vehicle, never a fake customer; block quote/send/close until it is reconciled. |
| Diagnostic start | `createSessionFromIntake` is the complete job→session seam | Without `treeState`, it writes `EMPTY_TREE`; `routeForSession` then stays on `tree-generating`. | Add an idempotent OS bootstrap that reuses the full current topology/AI initialization stack before atomically linking one session to one job. |
| Topology parity | Tree and topology both run gate→lock→repair→outcome today | Topology is a page-level intercept with no step navigation, observation, capture, lock, or outcome flow; it calls a nonexistent scenario route. | Tree/published-wizard jobs may generate evidence stories. Topology jobs use manual stories until a separately approved topology→finding/lock bridge exists. |
| Lock timing | Story/quote starts after session close | Lock only enters repair phase; close and `outcome.partInfo` occur after repair. | Generate the pre-work story/quote at diagnosis lock from `rootCauseSummary`, `proposedAction`, events, and artifacts. Use outcome only for final reconciliation. |
| Quote seed | `outcome.partInfo` seeds the pre-work quote/vendor lookup | It is optional, singular, technician-entered on the close form, and unavailable before repair. | Use a human-confirmed extraction of the locked root cause/action as the search seed; keep manual entry as the floor. |
| Story shape | `customerStory text` can enforce structured evidence | The contract requires sectioned output and explicit event/artifact references. Gate history is not durably stored and topology has no evidence trail. | Store typed JSONB with validated source IDs. Remove gate-history input. Use manual story for unsupported sessions. |
| Simple-job photos | Existing artifact flow can be reused unchanged | `artifacts.sessionId` is non-null; simple jobs have no session. | Add `job_attachments` and a dedicated handler; reuse only the capture/storage patterns. |
| Repair authorization order | Phase 2 can execute simple work before the immutable approval contract arrives in Phase 3 | That permits repair mutation with no version-bound customer authorization. | Phase 2 shows/claims simple jobs but cannot start them; Phase 3 ships guarded simple-work execution after approval. |
| Approval audit | Phase 3 phone approval can pin what was approved | Immutable quote snapshots/events were deferred to Phase 5. | Introduce immutable quote versions and approval events in Phase 3; every phone, in-person, or page approval references an exact version. |
| Corrected quotes | A corrected quote updates the same link without re-send | Rev 3 also says editing requires re-send; mutating the snapshot behind an issued token breaks approval integrity. | Editing creates a new immutable version, revokes old sends, and requires a new token/re-issue. |
| Notifications | Phase 5 customer responses become notifications | General notifications do not exist until Phase 6. | Move minimal in-app response notifications to Phase 5; web push remains Phase 6. |
| PWA push | Existing service worker is web-push ready | It handles install/activate/fetch only; no PushManager, permission UX, push handler, or notification click handler exists. | Treat the shell as a prerequisite only. Push must degrade to in-app when unsupported or denied. |
| Delivery | Ticket flows through delivered→closed | Proposed ticket schema has no delivery field. | Define `closedAt` as the delivery/close action or add `deliveredAt`; Rev 4 chooses the explicit timestamp. |
| Roles | Parts is vendor/order only, but every role can build | Those statements conflict. Current role API/team UI only support tech/owner. | Parts defaults to vendor/order surfaces but retains the universal build capability. Split schema, capability helpers, and team UI/API work. |
| Tenant boundary | Every new table has `shopId` | Five proposed child tables omitted it. | Use direct `shopId` on tenant-owned/queryable rows and enforce same-shop parents with handler, FK/index, RLS, and negative tests. |
| Secrets | Vendor credentials live in ordinary JSONB | No encryption/key-management contract exists. | Store only non-secret metadata plus an opaque secret-manager reference. Never store raw vendor secrets or approval tokens in ordinary JSON/log fields. |
| Order durability | Line status/timestamps are enough for one-click ordering | They cannot retain grouped lines, refreshed offers, provider IDs, idempotency, attempts, or failures. | Add `parts_orders` + `parts_order_lines`; keep manual ordering complete and provider placement optional. |
| Retry contract | Claim/start/approval/webhook retries are promised abstractly | Several proposed records lacked persisted keys, states, leases, or uniqueness; paid AI has a post-response crash window without provider idempotency. | Model leases/keys/uniqueness and an explicit non-auto-retrying `ambiguous` start state rather than promising impossible exactly-once cost. |
| Server-only RLS | RLS enabled with no policies is an acceptable server-only posture | Supabase flags that exact state, so it cannot also satisfy a clean-advisor criterion. | Revoke direct DML and add explicit deny-all direct-client policies for service-role-only tables. |
| Counts | About 12 new tables + two column-adds | Rev 3 actually listed 10 new tables and six columns; job photos, immutable quote versions, and durable parts orders were unmodeled. | Rev 4 states 14 logical tables + additive columns on 3 existing tables; the final physical delta remains conditional on Phase-0 adoption/retirement. |
| Parallel plan | Status rows can be selected from phase dependencies | The table had no dependency column and several rows mixed or overlapped lanes. | Add explicit dependencies, gates, and ownership for shared routes/components/tests. |

## Existing surfaces Rev 4 must reuse deliberately

- `CounterIntake`, `PredictiveIntakeSearch`, and `TechSelector`, after fixing access, roster, open-assignment, VIN, and redirect behavior.
- `TodayHome` and `FollowUpPanel`; My/Open Jobs compose above existing check-ins and closed-today history rather than replacing them blindly.
- `/settings/shop` + `ShopSection` for rate/tax settings.
- `/settings/team` + `TeamSection` and team APIs for role/tier management.
- `/vehicles/[vehicleId]` + `VehicleHistory`, extended to include ticket/job history.
- `DiagnosisProposedReview`, `RepairPhaseView`, `OutcomeCapture`, and `ClosedCaseSummary`, with lock-time vs. outcome-time responsibilities kept separate.
- `PhotoCapture`/storage as patterns only for new job attachments.
- `SwRegister` and `public/sw.js` as PWA prerequisites, not an existing push subsystem.
- `CounterWorkOrderConfirm` as an orphaned visual artifact only; its fake SMS/estimate/plan claims must not be wired unchanged.

## Security and compliance corrections

- New Shop OS public-schema tables are server-only by default: RLS enabled, direct `anon`/`authenticated` DML revoked, and explicit deny-all direct-client policies installed so service-role-only access does not leave no-policy advisor findings.
- Public approval tokens are high-entropy, hashed at rest, expiring, revocable, rate-limited, and bound to one immutable quote version. Approval is idempotent.
- `sms_log` stores a template identifier and redacted render, never a raw approval token.
- Twilio messaging requires prior express consent, retained proof, sender identification, and a one-step STOP path. Automated STOP/HELP handling is compliance plumbing, not a conversational SMS inbox.
- The current privacy policy says the app does not log IP addresses. Rev 4 removes IP as a mandatory approval field; any future addition requires legal/privacy review first.
- Privacy/terms and subprocessor disclosures must be updated before Twilio or vendor data is used in production.

## External-claim corrections

- For this shop’s expected volume, Twilio’s current low-volume standard path is approximately **$4.50 brand registration + $15 campaign vetting**, not the plan’s $59 standard-brand assumption. Recurring campaign, phone-number, message, and carrier fees still apply and must be re-quoted at procurement.
- PartsTech publicly describes its developer API as free, and its shop free tier includes live pricing/inventory. API access remains partner-mediated, so `$0` and O’Reilly coverage are discovery findings, not guaranteed implementation inputs.
- O’Reilly’s Integration Hub currently offers direct API or punchout applications to shops and management systems. Access and contract terms remain an external gate.
- RepairPal has partnership APIs for some products, but no public self-serve parts-ordering API was found. Labor/fair-price benchmark access is optional until commercial terms and permitted use are confirmed.

Primary references:

- [Twilio messaging policy](https://www.twilio.com/en-us/legal/messaging-policy)
- [Twilio A2P pricing](https://help.twilio.com/hc/en-us/articles/1260803965530-A2P-10DLC-Campaign-Registration-Guide)
- [Twilio US SMS pricing](https://www.twilio.com/en-us/sms/pricing/us)
- [PartsTech pricing](https://partstech.com/pricing/)
- [PartsTech developer API overview](https://partstech.com/resource/blog/partstech-sms-a-winning-combination/)
- [O’Reilly Pro Integration Hub](https://integrations.oreillypro.com/)
- [RepairPal estimator](https://repairpal.com/estimator)

## Phase-0 recommendation

Use the Rev-4 logical model (`tickets` + `ticket_jobs`) as canonical because it matches the approved three-door, multi-job workflow. Before implementation:

1. Export and map the one live `repair_orders` row and its linked session.
2. Confirm the five `shop_os_v2_foundation` tables remain empty.
3. Prepare an adopt-or-retire migration that preserves the legacy row and does not create a third parallel model.
4. Require Brandon’s explicit approval for any rename/drop.
5. Bring source schema, source migrations, live migration history, and local pglite tests into agreement.
6. Run Supabase security/performance advisors and leave no Shop-OS-specific warnings.

## Approved Phase-0 local proof

Brandon approved the canonical recommendation on 2026-07-10. The subordinate [Phase-0 execution packet](./2026-07-10-shop-os-phase-0-reconciliation-plan.md) now includes exact forward and rollback SQL drafts plus ten PGlite tests.

The rehearsal proves:

- the legacy repair-order UUID, shop/customer/vehicle/opener relationships, linked session UUID, and complaint survive into the canonical ticket/job;
- cross-tenant or ambiguous legacy links abort the transaction;
- any v2 row, non-default customer channel/opt-in field, non-null diesel context, or non-null legacy authorization aborts the transaction;
- `vehicles.platform_id` survives because it belongs to the source-controlled diagnostic schema, not v2 drift;
- canonical tables are tenant-keyed, RLS-enabled, and explicitly unavailable to direct `anon`/`authenticated` DML;
- rollback restores exact predecessor table shapes and row identity, but refuses after any non-legacy canonical write.

The drafts are deliberately outside `drizzle/migrations/`. Phase 1 row 5 must promote the reviewed model into Drizzle schema/migration artifacts; production row 6 remains an explicit owner gate.

## Verification evidence

- `git status --short --branch`
- `git log --all`, `git show`, `git branch -r --contains`, and PR #70/#115 metadata
- targeted `rg`/line inspection across schema, routes, handlers, UI, tests, privacy/terms, and service worker
- read-only Supabase `list_migrations`, `list_tables`, aggregate counts, policy/grant inspection, and security advisors
- current official vendor and messaging documentation
- targeted PGlite forward/guard/rollback rehearsal against the exact live migration definitions

No live migration, DDL, data write, vendor application, registration, spend, commit, push, or PR was performed.
