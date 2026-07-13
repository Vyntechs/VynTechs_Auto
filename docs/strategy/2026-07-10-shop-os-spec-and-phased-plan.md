# Shop OS — Spec & Phased Implementation Plan

**Date:** 2026-07-10 · **Rev 4** — corrected against `main` @ `38a3b7fc1ee8c910bd5433b74e2aeb64c6731ca7`, all fetched remote heads, PR history, the live Supabase schema, and current vendor documentation. Rev 4 preserves the owner-approved product scope while replacing unsafe or unsupported implementation assumptions.
**Status:** **ACTIVE PLAN — the single source of truth for Shop OS work. Phase 1 and Phase 2 source rows through row 15, Phase 3 rows 16–24, and Phase 4 rows 27–28 and 30 are complete; Row 30 merged in PR #154 and is production-verified. Row 31 source is verified and ready to ship.** Approved production migrations through `0032_shop_os_server_only_acl` are live and verified; Row 31 migrations `0033` and `0034` have not been applied. External access, spend, messaging retention/legal policy, production database changes, and later feature enablement remain separate owner gates.
**Scope:** Turn Vyntechs into the operating system for an automotive shop, dialed in against the first five-person shop while remaining tenant-safe. The diagnostic engine remains the centerpiece and is not redesigned by this plan.
**Evidence record:** [`2026-07-10-shop-os-audit.md`](./2026-07-10-shop-os-audit.md)

---

## 0. Audit provenance and mandatory preflight

Rev 3's claim that the referenced audit never existed was false. The original audit exists on remote branch `claude/shop-os-architecture-peqi8n` at commit `b36fb367c2e1b9ad426fadcef3eacc00d66a5fd6`. It and the first phased-plan branch share parent `54921a4`; the audit commit came first and was missed because the initial clone fetched only `main`.

The original audit is discovery evidence, not the active plan. Its broader scheduling, DVI, invoicing, payments, inventory, labor-clock, and management-analytics scope remains intentionally cut from v1. Rev 4 incorporates its useful evidence and the narrower owner decisions that followed it.

Three different realities must not be conflated:

```
MAIN SOURCE @ 38a3b7f
  ├── 38 Drizzle table declarations
  ├── no Shop OS ticket/job/quote/vendor/message model
  └── active Shop OS plan only

REMOTE HISTORY OUTSIDE MAIN
  ├── original audit @ b36fb367
  └── PR #70 → release/shop-management, never promoted to main
      └── repair_orders + shop/session columns

LIVE SUPABASE
  ├── 20260517134921 shop_mgmt_foundation
  │   ├── shops.shop_mgmt_enabled = true for 1 shop
  │   └── repair_orders = 1 row
  └── 20260610181258 shop_os_v2_foundation
      ├── work_orders = 0
      ├── concerns = 0
      ├── line_items = 0
      ├── authorizations = 0
      └── outbound_messages = 0
```

The second live migration has no source migration on any fetched branch. Those live-only tables have RLS enabled but no policies and are flagged by the Supabase security advisor. Therefore:

1. The Rev-4 `tickets` + `ticket_jobs` model is the recommended canonical target because it matches the approved three-door, multi-job workflow.
2. Before new DDL, export and map the one `repair_orders` row and its linked session; re-confirm the five v2 tables remain empty.
3. Prepare one source-controlled adopt/migrate/retire migration and rollback. Do not create a third parallel schema.
4. Renaming, dropping, or reinterpreting any live table, column, flag, or row is an **owner architecture/data gate**. This audit did not authorize or perform it.
5. Phase 0 is complete when the owner has approved one staged reconciliation migration + rollback and local tests prove the mapping. The approved Phase-1 schema row then creates the canonical tables, migrates the legacy row, and adopts/retires the predecessors in one production change; only after that apply must main schema, source migrations, live history, tests, and advisors agree.

Historical note: PR #70 merged only into `release/shop-management`; PR #71, which would have promoted it, closed. Older `docs/superpowers/*` references are absent from current `main`; PR #111 separately removed root handoff/task files and should not be cited as removing every older planning path.

---

## 1. Evidence-backed baseline

### 1.1 What exists on `main`

```
DIAGNOSTIC ENGINE  (load-bearing; behavior frozen for Shop OS)
  ├── AI tree + published-wizard path
  │   └── intake → retrieval/tree → steps → gate → lock → repair → outcome
  ├── topology path
  │   └── page-level diagram intercept; no finding/lock/repair/outcome bridge
  └── calibration, corpus, artifacts, events, and follow-up machinery

SHOP SHELL
  ├── shops → profiles → customers → vehicles → sessions
  ├── roles in current UI/API: tech | owner
  │   └── curator/founder is a separate axis; legacy role values need audit
  ├── counter intake
  │   ├── default-off feature flag and owner-only access
  │   ├── customer/vehicle search and explicit tech assignment
  │   ├── VIN decode exists server-side but is not wired into the UI
  │   └── null "open" assignment currently falls back to self-assignment
  ├── tech quick session form
  │   └── vehicle snapshot + complaint only; no customer/vehicle record link
  ├── /today
  │   └── open sessions + follow-ups + closed-today history
  └── PWA shell
      └── manifest + service worker install/activate/fetch; no push subsystem
```

Useful surfaces to extend, not duplicate:

- `CounterIntake`, `PredictiveIntakeSearch`, `TechSelector`, and the existing VIN decoder.
- `TodayHome` and `FollowUpPanel`; jobs compose above the existing legacy/follow-up content.
- `/settings/shop`, `/settings/team`, `ShopSection`, and `TeamSection`.
- `/vehicles/[vehicleId]` and `VehicleHistory`.
- `DiagnosisProposedReview`, `RepairPhaseView`, `OutcomeCapture`, and `ClosedCaseSummary` with their current timing preserved.
- `PhotoCapture` and storage as implementation patterns, not as direct storage for sessionless jobs.
- `SwRegister` and `public/sw.js` as prerequisites only.

`CounterWorkOrderConfirm` is an orphaned presentational artifact. Its fake estimate, SMS, plan, and print claims must not be connected unchanged.

### 1.2 Corrected gaps in current `main` application code

| Capability | Current `main` reality | Plan consequence |
|---|---|---|
| Ticket / repair-order / job | No application model | Add one canonical spine only after Phase 0 |
| Non-diagnostic work | Every current session enters a diagnostic route | Sessionless repair/maintenance jobs need their own work view |
| Quotes and approvals | No lines, versions, totals, or customer approval | Manual quote + immutable version is the floor |
| Vendor parts | No adapter/account/order code | Manual mode first; access-dependent transports later |
| Customer messaging | No outbound customer channel | Consent, secure sends, STOP/HELP, legal updates required |
| General notifications | Specialized follow-up/What's New behavior only | Add response notifications in Phase 5; push in Phase 6 |
| Skill tiers/open claim | Sessions require a tech at creation | New jobs may be open; claim must be atomic and tenant/tier-safe |
| Advisor/parts roles | Not supported by team UI/API | Schema, capabilities, invites, UI, and last-owner rules all change |
| Customer story | No evidence-bound story | Typed lock-time story for supported diagnostic paths |
| Customer payments/invoices | SaaS Stripe billing only | Explicit v1 non-goal |

Important corrections to Rev 3:

- `createSessionFromIntake` is a persistence helper, not a complete diagnostic initializer. Without a populated `treeState`, it writes `EMPTY_TREE` and the page remains on tree generation.
- The counter intake drops `whenStarted`, `howOften`, and free-text authorization after the route. Ticket fields must persist normalized values.
- Pick-existing customer/vehicle support is useful, but it does not make session creation, ticket linking, or access control complete.
- Camera/autosave theater was already removed and tests pin its absence. The remaining false affordances are the dead scan control and "VIN auto-fills" copy.
- Current topology sessions do not produce the same evidence/lock/outcome lifecycle as tree or published-wizard sessions.
- Diagnosis lock begins the repair phase; session close and `outcome.partInfo` happen after repair. Pre-work quoting cannot depend on outcome data.
- `ActiveSession` still contains doctrine debt such as hardcoded risk and step-count framing. The engine freeze does not certify that UI as correct; it only keeps that separate from Shop OS scope.

---

## 2. Design principles

1. **Engine schema and diagnostic semantics are frozen; four narrow OS seams are allowed.** Shop OS does not change prompts, risk rules, diagnostic decisions, topology behavior, or engine output semantics. It may add the outward job→session FK, orchestrate existing session initialization, read lock/outcome data, and enforce ticket approval in the existing repair/close UI + API paths. The one-time Phase-0/1 drift reconciliation may also map or retire already-live Shop-Management columns on `sessions`, only under the explicit owner gate. Every seam is regression-tested and legacy ticketless sessions remain unchanged.
2. **The ticket is the spine; the session is an optional attachment.** A ticket holds jobs. Only a diagnostic job may link one session, and one session may link at most one job.
3. **Doctrine applies to customer claims.** Every generated assertion must trace to selected session events/artifacts or be omitted. No invented urgency, parts, fitment, or outcome.
4. **Statuses, not a forced pipeline.** Work and approval are separate axes, while every approval binds to an immutable quote version.
5. **Human-confirmed money.** A person sends a quote, records phone/in-person approval, and confirms every parts order. No auto-order path exists.
6. **Tenant boundaries are explicit.** Every new tenant-owned/queryable table carries `shopId`; parent/child shop consistency is enforced in handlers and database constraints. Server-only access, RLS/grants, and negative cross-shop tests are required.
7. **Manual paths are the launch floor.** Quoting cannot depend on SMS, vendor access, RepairPal, or push. External accounts, representations, credentials, production changes, and spend remain owner gates.
8. **Idempotency at every public or race-prone seam.** Claim, diagnostic start, quote approval, webhook processing, notifications, and order confirmation must tolerate retries safely.
9. **House conventions hold.** Handler-in-`lib/` + thin route; `db: AppDb` first; pglite tests; integer cents/basis points; tokenized UI; no emoji; UI acceptance includes the required accessibility pass.

---

## 3. End-to-end spine

### 3.1 Three doors, one structure

```
DOOR A  Counter intake
  └── customer + vehicle + concern + jobs + assign-or-open

DOOR B  Tech quick diagnosis
  └── provisional ticket + diagnostic job + current session inputs
      ├── customerId/vehicleId may be null initially
      └── quote/send/delivery/close blocked until reconciliation

DOOR C  Quick ticket / quote
  └── customer + vehicle + requested work + manual/canned lines
      └── no diagnostic session unless the work later needs one
```

Door B never fabricates a customer. Its provisional ticket is visible as incomplete and must be reconciled to a real customer/vehicle before any customer-facing or closeout action.

### 3.2 Full operating flow

```
1 INTAKE
  └── ticket + one or more jobs
      ├── diagnostic
      ├── repair
      └── maintenance
          ├── pre-assigned to an active wrenching profile
          └── left truly open

2 ASSIGNMENT
  ├── assigned → My Jobs
  └── open → visible when skillTier >= requiredSkillTier
      └── claim [atomic DB write; same-shop + active + tier + open-status]

3 DIAGNOSIS / QUOTE PREP
  ├── repair / maintenance
  │   └── card visible; manual/canned quote can be built
  │       └── start remains locked until exact-version approval
  └── diagnostic
      └── start diagnostic [OS bootstrap; idempotent]
          ├── topology found → existing topology page
          │   └── manual customer story until a separate bridge is approved
          └── tree / published wizard
              └── existing steps → gate → diagnosis lock
                  └── lock-time evidence becomes available to Shop OS

4 STORY + QUOTE  (pre-work)
  ├── typed story from locked diagnosis + selected event/artifact IDs
  ├── advisor/tech review and edit
  ├── manual lines are always available
  └── immutable quote version created

5 APPROVAL
  ├── advisor/owner records phone or in-person approval
  └── advisor/owner sends secure page
      └── approve / decline / question against one exact quote version

6 REPAIR + PARTS
  ├── repair / maintenance → start → notes + job attachments → done
  │   └── found another concern → add diagnostic job
  ├── diagnostic repair/close controls unlock only for approved work
  ├── vendor search may help price/source; human confirms fitment
  └── human confirms every order after live staleness check

7 OUTCOME + DELIVERY
  ├── existing diagnostic outcome closes after repair
  │   └── final history may reconcile actual part/result; never rewrites approval
  ├── jobs done
  ├── deliveredAt/deliveredBy recorded
  └── ticket closed
```

### 3.3 Engine integration boundary

There is one relational seam — `ticket_jobs.sessionId` — and four OS orchestration points:

1. **Creation:** an idempotent job-start handler reuses the full current initialization behavior. It does not call `createSessionFromIntake` without a populated topology sentinel or generated tree.
2. **Lock read:** for tree/published-wizard sessions, Shop OS reads the locked root-cause summary, proposed action, selected events, and artifacts. It writes only to Shop OS tables.
3. **Authorization intercept:** ticket-backed repair UI/API requires the approved quote version before any repair mutation. Outcome close requires either approved work or an explicit declined/no-repair closeout that cannot claim a repair was performed. Legacy ticketless sessions behave exactly as they do today.
4. **Outcome read:** after repair/close, Shop OS may append actual-result context to final history. It never mutates the version the customer approved.

The diagnostic-start transaction must enforce a unique job/session link and return the existing session on retry. If external AI generation must occur before the transaction, the leased attempt key/state prevents concurrent taps from creating two provider calls or sessions; the post-provider/pre-persistence crash window follows the explicit `ambiguous` rule in §5 rather than pretending provider-side idempotency exists.

---

## 4. Roles, capabilities, and skill tiers

### 4.1 Roles and capability helpers

`profiles.role` remains a single text value and expands deliberately:

```
tech      defaults to command-center work
advisor   defaults to counter, quote-send, assignment, and closeout work
parts     defaults to vendor/order surfaces; can still create and build
owner     advisor/parts capabilities + team, billing, rates, settings
```

Every profile may create tickets, add jobs, and build quotes. Gated actions:

| Action | Capability |
|---|---|
| Send quote / record customer approval | advisor or owner |
| Close/cancel ticket | advisor or owner |
| Place parts order | parts, advisor, or owner |
| Assign/reassign another profile | advisor or owner |
| Team/rates/integration settings | owner |

Dedicated `can*` helpers are the authority; scattered string comparisons are prohibited. `isCurator`/founder remains a separate engine-content axis. Before adding role constraints, Phase 0/1 audits distinct live role values and explicitly maps any legacy `role='curator'` records without removing curator capability. Team invite/update APIs, UI choices, and the last-owner guard must change together.

### 4.2 Skill tier, not multi-role

```
profiles.skillTier: integer | null
  3 = A-tech: diagnostic / driveability / electrical
  2 = B-tech: general repair
  1 = C-tech: maintenance
  null = does not wrench

ticket_jobs.requiredSkillTier: integer
```

Any active profile with a non-null tier — including an owner or advisor — can appear in the tech selector and command center. Migration gives existing active techs a safe minimum tier only; open-board launch stays off until the owner confirms each wrenching profile's real tier. Inactive profiles and null-tier profiles never appear as claimable techs.

### 4.3 Assignment and claim rules

- Self-claim is one conditional update enforcing same shop, active profile, non-null sufficient tier, open work status, and null assignment. A losing racer receives the current owner, not a generic error.
- Advisor/owner assignment uses the same tenant/active checks. Below-tier assignment is an explicit warning that requires confirmation, not a silent bypass.
- "Open" persists `assignedTechId = null`; it never falls back to the advisor.
- Workload combines open ticket jobs and legacy open sessions during migration.
- After intake, advisors land on the readable ticket route, not a tech-owned session route they may be unable to access.

---

## 5. Target logical data model

Phase 0 determines how this target adopts or retires the two live predecessor schemas. The target is **14 new logical tables plus additive columns on 3 existing tables**; the final physical migration count may differ because live objects must be reconciled rather than blindly recreated.

All monetary values are integer cents; percentages use basis points. Every table below includes IDs/timestamps/indexes appropriate to its access paths.

```text
shops
  + nextTicketNumber, laborRateCents, taxRateBps,
    smsEnabled, partsVendorsEnabled

profiles
  + skillTier integer null
  role vocabulary expands without replacing curator/founder capability

customers
  + smsConsentStatus, smsConsentAt, smsConsentSource,
    smsConsentEvidence, smsOptOutAt

tickets
  id, shopId, ticketNumber, source: counter|tech_quick|quick_quote,
  customerId null, vehicleId null,
  concern, whenStarted, howOften,
  diagnosticAuthorizedCents null, diagnosticAuthorizationNote null,
  status: open|closed|canceled,
  createdByProfileId, canceledAt/By, deliveredAt/By, closedAt/By

ticket_jobs
  id, shopId, ticketId, title,
  kind: diagnostic|repair|maintenance,
  requiredSkillTier, assignedTechId null, claimedAt,
  sessionId null unique,
  workStatus: open|in_progress|blocked|done|canceled,
  approvalState: pending_quote|quote_ready|sent|approved|declined,
  customerStory jsonb null, storyMeta jsonb,
  workNotes, approvedQuoteVersionId null,
  diagnosticStartState: idle|initializing|ready|failed|ambiguous,
  diagnosticStartAttemptKey null, diagnosticStartLeaseUntil null,
  diagnosticStartErrorCode null

job_attachments
  id, shopId, jobId, storageKey, kind, mimeType, byteSize,
  uploadedByProfileId, createdAt

job_lines
  id, shopId, jobId, kind: part|labor|fee, description, sort,
  quantity, priceCents, taxable,
  partNumber, brand, unitCostCents, coreChargeCents,
  fitment, vendorAccountId, externalOfferId, vendorSnapshot jsonb,
  partStatus: proposed|needs_order|ordered|received|installed|returned,
  orderedAt/By, receivedAt/By,
  laborHours, laborRateCents,
  source: manual|vendor_offer|diagnosis_seed|guide

canned_jobs
  id, shopId, title, kind: repair|maintenance,
  defaultRequiredSkillTier, defaultLines jsonb, sort, retiredAt

vendor_accounts
  id, shopId, vendor, displayName,
  mode: manual|api|punchout,
  nonSecretConfig jsonb, secretRef null, enabled

quote_versions
  id, shopId, ticketId, versionNumber,
  snapshot jsonb, createdByProfileId, createdAt, supersededAt
  -- snapshot pins jobs, lines, totals, story sections, and artifact refs

quote_sends
  id, shopId, ticketId, quoteVersionId,
  channel: sms|link, tokenHash, toPhone,
  sentByProfileId, sentAt, expiresAt, revokedAt

quote_events
  id, shopId, ticketId, jobId null, quoteVersionId,
  quoteSendId null, kind: sent|delivered|viewed|approved|declined|question,
  actorProfileId null, approvedVia: page|phone|in_person null,
  requestKey, providerEventId null,
  body null, userAgent null, createdAt

sms_log
  id, shopId, ticketId null, quoteSendId null,
  direction, customerId null, fromPhone, toPhone,
  templateId, redactedRender,
  providerSid null, providerEventId null, status, errorCode, createdAt

notifications
  id, shopId, recipientProfileId, kind, ticketId null, jobId null,
  title, body, dedupeKey, readAt, createdAt

push_subscriptions
  id, shopId, profileId, endpoint, endpointHash, p256dh, auth,
  userAgent, createdAt, lastSuccessAt, lastFailureAt,
  failureCount, revokedAt

parts_orders
  id, shopId, ticketId, quoteVersionId, vendorAccountId null,
  mode: manual|api|punchout,
  status: draft|prepared|submitted|confirmed|failed|canceled,
  idempotencyKey, refreshedOfferSnapshot jsonb,
  providerOrderId null, providerStatus null, failureCode null,
  preparedByProfileId, confirmedByProfileId null,
  preparedAt, submittedAt null, confirmedAt null

parts_order_lines
  id, shopId, partsOrderId, jobLineId,
  quoteVersionLineKey, quantity, refreshedOfferSnapshot jsonb,
  providerLineId null, status, createdAt
```

Integrity and security rules:

- Quote math is deterministic: `priceCents` is the extended customer price for a line; quantity is display/parts context, while labor defaults to `laborHours × laborRateCents` with an explicit line-price override. Sum extended lines first, calculate tax once from the taxable subtotal as `roundHalfUp(taxableSubtotalCents × taxRateBps / 10_000)`, then add it to subtotal. Validate non-negative cents, `taxRateBps` in `0..10_000`, parts quantity to at most 3 decimals, and labor hours to at most 2. The immutable snapshot stores inputs and computed totals.
- Direct `shopId` plus same-shop parent constraints are required on every new table. Prefer composite FKs/unique keys where practical; handlers still verify tenant ownership inside the write transaction.
- `(shopId, ticketNumber)` is unique and allocated with a locked/atomic increment.
- `quote_versions` enforces unique `(shopId, ticketId, versionNumber)`, and each public `tokenHash` is unique. Approval `requestKey`, non-null provider event/SID values, parts-order `idempotencyKey`, and `(shopId, recipientProfileId, notifications.dedupeKey)` are unique in their tenant scope. A push subscription is unique by profile + endpoint hash; its endpoint/key material is server-only and never logged.
- A `tech_quick` ticket may temporarily lack customer/vehicle. Other sources require both. Any quote version, send, approval, delivery, or close rejects an unreconciled ticket.
- Only diagnostic jobs may link sessions. `sessionId` and each non-null diagnostic start attempt key are unique in tenant scope. The initializing state uses a bounded lease: retry returns the existing session or waits on the live lease. If a worker dies in the unavoidable window after a paid provider response but before durable persistence, expiration becomes `ambiguous` and never auto-regenerates; a human must explicitly retry with the possible duplicate-cost warning.
- Quote versions are immutable. Editing lines or story creates a new version, supersedes the old version, revokes its active sends, and requires a new token/re-issue. No link silently changes beneath a customer.
- Page, phone, and in-person approval all append an event tied to one exact version. Diagnostic-fee authorization is a separate structured amount/note and never implies repair approval.
- Public tokens are high entropy, hashed at rest, expiring, revocable, rate-limited, and idempotent on approval. Raw tokens never appear in logs or `sms_log` renders.
- Vendor credentials never live in ordinary JSONB. `nonSecretConfig` contains only safe metadata; `secretRef` points to approved secret storage.
- Vendor snapshots include `externalOfferId`, currency, price, core charge, availability, fitment, fulfillment/location, and `fetchedAt`.
- A parts order references the exact approved quote version; every order line must occur in that snapshot. Manual confirmation and provider submission both persist the refreshed offer, idempotency key, actor, result, and failure state before changing `job_lines.partStatus`.
- Quote events and SMS delivery records are append-only. Approval storage does not require IP; the current privacy policy says the app does not log IP addresses.
- New public-schema tables are server-only by default: RLS enabled, all table privileges revoked from `anon`/`authenticated`, no effective client access through `PUBLIC` or inherited roles, only intended operations granted to `service_role`, and explicit deny-all direct-client policies installed so the server path remains the only writer without leaving no-policy advisor findings. Add narrower direct-client policies only when an approved use exists; Supabase advisors must be clean for Shop OS objects.

---

## 6. Product and integration decisions

### 6.1 Customer approval channel

**Decision: short SMS + secure hosted approval page, while phone/in-person approval remains first-class.** The page carries the story, photos, immutable totals, per-job approve/decline, and a question box. A corrected quote gets a new version and link; it never mutates the old link.

Current low-volume Twilio planning numbers, to re-quote before procurement:

- Approximately $4.50 brand registration + $15 campaign vetting.
- Approximately $1.50/month low-volume campaign + current local-number rental.
- Outbound transport is currently $0.0083/segment plus carrier fees. Four to six outbound segments across a quote/reminder/confirmation cycle is roughly $0.05–$0.08 per ticket before fixed fees.

The monthly total is a forecast, not a shipping criterion. Registration, phone-number purchase, opt-in language, privacy/terms/subprocessor updates, business representation, credentials, and spend are owner gates. Production messaging requires retained consent proof, sender identification, and working STOP/HELP handling. Compliance automation is not a two-way SMS inbox.

### 6.2 Parts ordering

**Decision: no auto-order, now or deferred.** Approved vendor-sourced lines enter an order queue. Refresh the offer immediately before order:

```
REFRESH OFFER
  ├── manual account
  │   └── human verifies by phone/portal → records snapshot/reference
  └── API / punchout account [vendor transport]
      └── live refresh
          ├── unchanged price + availability → human confirms order
          └── changed / unavailable / stale
              └── block → re-price, re-source, or obtain new approval
```

Manual mark-ordered/received is a complete v1 path and does not depend on a provider API. API/punchout placement is optional acceleration, always recorded in `parts_orders`/`parts_order_lines` with the exact approved quote version.

Real-order tests spend money and require explicit owner approval or a vendor sandbox/dry-run.

### 6.3 Non-diagnostic and quick-quote work

Repair/maintenance jobs have no session. Their work surface is start → notes/photos → done. "Found something" adds a diagnostic job on the same ticket. Door C creates a required customer/vehicle, requested work, and manual or canned lines without assignment ceremony.

Early known-work approval still requires an immutable quote version. `pre_approved` is not a free-floating state. A counter diagnostic-fee authorization remains separate from authorization to perform the repair.

Canned jobs are shallow shop-scoped templates. No nested packages, per-vehicle price matrix, fluid-capacity engine, or inventory system enters v1.

### 6.4 Vendor strategy

The adapter contract is `searchParts`, `refreshOffer`, and optional human-triggered `prepareOrder/placeOrder`. Manual mode is complete before any transport.

- **PartsTech:** advertised shop/free API capabilities are promising, but developer access and O'Reilly coverage are partner-mediated. Treat `$0` as public pricing, not a guaranteed total dependency.
- **O'Reilly:** direct API/punchout applications exist through the Integration Hub. Access is an external gate; PartsTech may be the first transport if approved.
- **Tri State:** exact legal/vendor identity, account contact, and transport are unknown. Manual mode is the floor until discovery resolves it.
- **RepairPal:** not a parts vendor. A benchmark/labor-guide surface is optional only if commercial access and permitted usage are confirmed; manual quoting cannot depend on it.

Pre-work search seeds come from the **locked** root-cause summary and proposed repair, then a human selects the real catalog offer and confirms fitment. `outcome.partInfo` arrives after repair and may reconcile final history; it cannot seed the quote that authorizes the repair.

### 6.5 Topology limitation

Topology currently renders a diagnostic diagram outside the lock/repair/outcome lifecycle. Rev 4 does not pretend parity:

- Tree and published-wizard sessions may generate the evidence-bound story after lock.
- Topology jobs use a manual story and manual quote seed in v1.
- A topology → finding/lock bridge is separate engine work and requires a separately approved plan; Shop OS does not smuggle it into an integration task.

---

## 7. Explicit v1 non-goals

1. Appointments/scheduling.
2. Parts inventory/stock management.
3. Customer payments, deposits, card-present flows, and accounting-grade invoicing.
4. Two-way SMS threading.
5. A required dedicated parts seat.
6. Standalone checklist DVI.
7. Labor-rate matrices beyond one shop rate plus line override.
8. Per-line customer approval; approval granularity is the job within a pinned ticket version.
9. Manually maintained kanban stage; board stage derives from current job/approval/part/delivery state.
10. Topology lifecycle redesign, diagnostic prompt/risk changes, or cleanup of unrelated current engine UX debt.

---

## 8. Evidence-bound customer story

### 8.1 Contract

For a tree/published-wizard diagnostic job after diagnosis lock, a new Shop OS generator reads only:

- Ticket concern in the customer's words.
- Locked `rootCauseSummary` and `proposedAction`.
- Explicitly selected session-event IDs and artifact IDs.
- Current confidence context that is durably present.

It does **not** use ephemeral gate history, invent fitment/parts, or depend on post-repair `outcome.partInfo`.

Typed JSON output:

```text
customerStory
  whatYouToldUs
  whatWeFound
  howWeKnow[]
    claim
    sourceEventIds[]
    sourceArtifactIds[]
  whatItMeansIfWaived
  whatWeRecommend
```

### 8.2 Guards and human review

- Every `howWeKnow` claim must reference allowed IDs from that same session/shop; invalid IDs or unsupported claims reject the generation.
- Output cannot contradict the locked diagnosis or add fields outside the schema. Thin evidence produces a shorter story, not padding.
- Advisor/tech can edit; editor/time/source metadata is retained. The approved/sent rendering lives in the immutable quote snapshot.
- Simple jobs and topology jobs use manual/template stories with no AI claim of diagnostic evidence.
- Generate/review at diagnosis lock, before repair. After outcome, a separate final-history note may record what actually fixed the vehicle without altering the approved quote/story.

The bar: readable in under 60 seconds on a phone; verdict first, proof one tap beneath; calm, specific, and free of fear theater.

**Implementation correction — row 20 provenance boundary proved 2026-07-11.** Row 20 supports ordinary locked tree sessions only. Any `wizard_lock_in` returns `unsupported_path` before provider work because current client-supplied wizard lock provenance cannot satisfy this section's evidence contract without changing engine semantics. This overrides the original tree/published-wizard wording for row 20. Published-wizard and topology bridges require separately approved engine work; topology, simple, and other unsupported paths remain manual/template stories.

**Implementation correction — row 21 human story and exact-version approval proved 2026-07-11.** [Row-21 design](./2026-07-11-shop-os-row21-story-review-and-approval-design.md) and [execution packet](./2026-07-11-shop-os-row21-story-review-and-approval-plan.md) extend the existing quote workspace with strict human review for row-20 AI stories, honest manual topology stories with empty proof, and exact-version phone/in-person/decline decisions. Published-wizard and unfinished diagnostic paths remain explicitly unsupported; parts-role users cannot mutate stories or decisions. Diagnostic versioning/approval fails closed without a valid reviewed or manual story, approval truth is checked against the sole active immutable snapshot, and UI retries defer to refreshed server truth. Full verification passes 231 files/2,312 tests, TypeScript, production build, focused accessibility/interaction tests, independent task reviews, and whole-branch review. No migration, provider, messaging, public approval link, diagnostic-engine semantic, repair authorization, or production-data change shipped in this row.

---

## 9. Notifications and push

Minimal in-app response notifications ship with the customer channel in Phase 5. Web push is a best-effort Phase-6 enhancement with in-app fallback. The existing service worker is not push-ready: permission UX, VAPID subscription, server delivery, `push`, and `notificationclick` behavior all need implementation.

Capability routing includes owners when they are acting as advisor/parts; owners are not categorically silenced.

| Event | In-app recipient | Push in Phase 6? |
|---|---|---|
| Quote approved | Assigned tech + parts-capable profiles | Yes |
| Quote declined / question | Advisor-capable profiles | Yes |
| Quote viewed | Timeline only | No |
| Quote ready | Advisor-capable profiles | Yes |
| Parts received | Assigned tech | Yes |
| Open job aging | Advisor-capable digest | No |
| Job claimed/started/done | Board state | No |

Initial confidence-gate hits are **not** a v1 notification promise: current gate state is cleared on release and lacks the durable transition needed for reliable exactly-once routing. A durably recorded defer/close may notify later. Any new engine-side event hook requires separate approval.

---

## 10. Phased delivery plan

Seven phases including the mandatory Phase 0. Each later phase retains a complete manual path if an external dependency slips.

### Phase 0 — Reconcile reality before DDL (S; owner gate)

**Ships:** this corrected audit/plan; a proposed canonical mapping from both live predecessor schemas to `tickets`/`ticket_jobs`; an export/mapping for the one legacy repair order; re-confirmed zero counts; source-controlled forward and rollback SQL ready for the Phase-1 schema row; explicit policy/grant design; vendor access discovery notes.

**No autonomous production change:** preparing migration artifacts is allowed after the architecture decision. Applying any destructive reconciliation requires separate explicit approval.

**Done when:** owner approves the canonical model, legacy-row treatment, and staged forward/rollback design; local migration tests against a representative predecessor schema prove preservation. No production apply occurs in Phase 0.

**Implementation correction — approved and locally proved 2026-07-10.** Brandon approved `tickets` + `ticket_jobs` as canonical, preservation of the linked repair order/session, and fail-closed retirement of empty/default-only predecessor objects. The exact [execution packet](./2026-07-10-shop-os-phase-0-reconciliation-plan.md), [forward SQL draft](./sql/2026-07-10-shop-os-reconciliation-forward.sql), and [rollback SQL draft](./sql/2026-07-10-shop-os-reconciliation-rollback.sql) pass eleven PGlite tests. Live inspection also found three v2 fields omitted from Rev 3: `customers.preferred_channel`, `customers.opt_ins`, and `vehicles.diesel_context`; the drafts refuse to retire them unless they remain exactly at today's default/default/null state. Nothing was applied to production.

### Phase 1 — Ticket spine and honest intake (L)

**Ships:** source schema/migration + local proof for canonical `tickets`/`ticket_jobs`, followed by a separately approved production apply that maps the legacy repair-order row and adopts/retires predecessor objects without a third live model; then ticket handlers/API/read surface, ticket numbering, capability helpers, role/tier team API+UI, required first-run tier setup, counter intake v2, Door C minimal ticket, and Door B provisional auto-wrap.

Counter corrections:

- Keep the feature default-off until fixture acceptance and explicit owner enablement.
- Wire the existing VIN decoder or remove both scan control and auto-fill claim; Rev 4 recommends wiring decode.
- Filter active non-null-tier wrenching profiles and compute workload from jobs + legacy sessions.
- Persist truly open assignment as null.
- Parse diagnostic authorization to structured amount/note; persist full concern fields.
- Redirect every creator to the real ticket view they are allowed to read.

**Data:** tickets/jobs; shop numbering; profile tier/role support. Customer/vehicle may be null only on `tech_quick` provisional tickets.

**Done when:** source schema/migrations/live history agree and Shop-OS-specific advisors are clean; the legacy row is preserved in the approved canonical form; fixture-based counter intake creates one ticket with diagnostic + maintenance jobs in under 90 seconds; full concern survives; open stays open; advisor can read the result; quick tech session creates exactly one provisional wrapper on retry; legacy sessions still render; tenant/role/tier negative tests pass.

**Implementation correction — source spine proved 2026-07-10.** [Row-5 packet](./2026-07-10-shop-os-phase-1-schema-plan.md) promotes the rehearsal into Drizzle declarations plus `0026_shop_os_ticket_spine.sql`. One runner-transactional migration accepts either the clean source chain or the complete guarded live predecessor; partial drift aborts before DDL, and transaction-scoped table locks prevent guarded rows from changing between validation and predecessor retirement. Fifteen focused tests cover clean, live, catalog-security, lock, guard, and rollback behavior, and the complete 1,495-test suite passes. Drizzle's known malformed `0011b_snapshot.json` blocks custom generation, so this follows migration 0021's established hand-written SQL + journal pattern. Nothing was applied to production.

**Implementation correction — team authority proved 2026-07-10.** [Row-7 packet](./2026-07-10-shop-os-phase-1-team-roles-plan.md) adds the approved capability matrix, role/tier invite and update contracts, transaction-locked last-owner protection, protected curator handling, and the existing Team screen controls. Source migration `0027_team_membership_lifecycle.sql` makes invitation acceptance explicit: chosen role/tier state remains pending until first authenticated use, so pending profiles cannot count as owners, mutate teams, or enter the wrenching roster. Sixty-five focused tests and the complete 1,519-test suite pass with TypeScript, production build, independent review, and GitHub checks. The signed-in Chrome extension was unavailable, so the protected-page browser check could not run; accessible labels and interactions are covered by component DOM tests. Nothing was applied to production.

**Implementation correction — ticket domain proved 2026-07-10.** [Row-8 packet](./2026-07-10-shop-os-phase-1-ticket-api-plan.md) adds injected ticket creation, safe detail reads, open-ticket job addition, and three thin authenticated/paywalled route shims. Creation atomically allocates per-shop ticket numbers and inserts one to twenty-five validated jobs; reads hide cross-tenant existence and expose only the approved projection; add-job locks the tenant-scoped ticket before checking open status, assignment, or insertion. Forty focused tests and the complete 1,559-test suite pass with TypeScript, production build, clean GitHub checks, three task reviews, and a whole-branch review. Concurrency tests prove SQL lock/order contracts and single-client outcomes; a two-connection contention test remains a non-blocking future harness improvement. No schema, production, UI, claim/reassign, quote, or diagnostic-engine behavior changed.

**Implementation correction — real ticket detail proved 2026-07-10.** [Row-9 packet](./2026-07-10-shop-os-phase-1-ticket-detail-plan.md) adds one protected `/tickets/[id]` server route and a mobile repair-order ledger rendered only from row 8's safe `TicketDetail` projection. Authentication and actor translation precede the tenant-safe domain read; every denial collapses to the same not-found boundary. The screen shows persisted customer, vehicle, concern, assignment, work, and approval facts; provisional tickets state exactly what remains blocked; unsafe legacy contact actions fail closed to plain text; and only linked diagnostic sessions expose `Open diagnosis`. Eighteen focused tests and the complete 1,577-test suite pass with TypeScript, production build, clean GitHub checks, two task reviews, and a whole-branch review. Chrome was installed and configured but not running, so signed-in visual inspection could not run; 375px stacking, 44px targets, focus rules, landmarks, conditional facts, and linked-session behavior are covered by CSS/static and DOM tests. No schema, production, mutation, quote, assignment, reconciliation, or diagnostic-engine behavior changed.

**Implementation correction — counter intake v2 proved 2026-07-10.** [Row-10 packet](./2026-07-10-shop-os-phase-1-counter-intake-v2-plan.md) adds one default-off, owner-only `/api/tickets/counter` seam and rewires the counter surface to create the canonical ticket before any diagnostic session exists. New or same-shop existing customer/vehicle resolution, diagnostic authorization, one A-tier diagnostic job, and an optional B/C repair or maintenance job commit atomically; Open remains truly null, below-tier assignment requires explicit confirmation, and success redirects only to the real ticket. The wrenching roster now reports A/B/C tiers and de-duplicates ticket-backed legacy sessions from open workload. Real VIN decode, editable fallbacks, Command/Control-Enter, all-width 44px controls, and 375px stacking replace inherited fake or desktop-only affordances. Eight focused files/105 tests and the complete 195-file/1,618-test suite pass with TypeScript, production build, clean GitHub checks, three task reviews, and a whole-branch review. Signed-in Chrome remained unavailable, so live visual inspection did not run; CSS/static and DOM coverage protect the narrow layout, targets, keyboard paths, announcements, assignment, and redirect. No schema, production data, feature enablement, session creation, quote behavior, or diagnostic-engine semantics changed.

**Implementation correction — Door C minimal create proved 2026-07-10.** [Row-11 packet](./2026-07-10-shop-os-phase-1-door-c-minimal-create-plan.md) adds a dedicated `/api/tickets/quick` seam and protected `/tickets/new` surface for an honest sessionless quick ticket. New or same-shop existing customer and vehicle resolution plus exactly one unassigned repair or maintenance job commit atomically through the canonical ticket domain; every active paid Shop OS role may create, while missing-shop, unauthorized, unpaid, and over-quota actors fail closed. The UI reuses predictive intake, mirrors server bounds, resets entity-specific state, supports Command/Control-Enter without search collisions, exposes a 44px Today entry, and redirects only from the returned ticket ID. Five focused files/67 tests and the complete 198-file/1,668-test suite pass with TypeScript, production build, clean diff checks, two task reviews, and a whole-branch review. Signed-in Chrome remained unavailable, so live visual inspection did not run; CSS/static and DOM coverage protect 375px layout, targets, focus, validation, errors, and redirect behavior. No schema, production data, diagnostic session, quote lines/prices/approval, assignment, feature enablement, or diagnostic-engine semantics changed.

**Implementation correction — Door B provisional wrapper proved 2026-07-10.** [Row-12 packet](./2026-07-10-shop-os-phase-1-door-b-provisional-plan.md) keeps the existing `/sessions/new` diagnostic flow but atomically wraps each accepted intake in one null-customer/vehicle `tech_quick` ticket and one assigned diagnostic job linked to the session. A browser UUID serves as the request key and proposed session ID; canonical same-input retries return the same session/ticket/job before quota, open-cap, retrieval, or provider work, while changed input, cross-actor reuse, malformed wrappers, unsupported roles, and divergent collisions fail closed. The key survives ambiguous transport or JSON failures, rotates for edited normalized intake, and never enters retrieval. Active Shop OS roles require a current non-null A/B/C tier; the persisted job keeps its creation-time tier across later profile changes. Nine focused files/90 tests and the complete 201-file/1,715-test suite pass with TypeScript, production build, clean GitHub checks on the source head, two task reviews, and a whole-branch review. Signed-in Chrome remained unavailable, so live inspection did not run; the visible flow is intentionally unchanged and DOM tests protect access, error recovery, retry identity, and redirect behavior. PGlite exercises deterministic concurrent conflict paths but not two-connection PostgreSQL lock timing; row 15 still owns leased provider-call idempotency. No schema, production data, customer fabrication, quote/approval, feature enablement, provider/retrieval/tree behavior, or diagnostic-engine semantics changed.

### Phase 2 — Technician command center and diagnostic start (M)

**Ships:** My Jobs/Open Jobs composed into `/today` without removing current follow-ups, check-ins, closed-today, or legacy session cards; atomic claim; idempotent full diagnostic bootstrap. Repair/maintenance cards may be claimed and viewed, but their start action remains disabled as "Quote and approval required" until Phase 3 lands the immutable approval contract.

Tree/published-wizard starts reuse the full existing initialization behavior. Topology starts retain their existing topology sentinel/intercept and manual-story limitation. No job may call the persistence helper with an empty tree.

**Done when:** eligible tech claims in two taps and reaches the existing diagnostic on the third; losing/below-tier/cross-shop claims fail safely; concurrent/user retries create one session and at most one provider call; an expired ambiguous attempt never auto-regenerates; simple work cannot start through UI or API without an approved version; current Today follow-ups/history remain observable.

**Implementation correction — atomic job assignment proved 2026-07-10.** [Row-13 packet](./2026-07-10-shop-os-phase-2-job-assignment-plan.md) adds one domain mutation seam and one thin `/api/tickets/[id]/jobs/[jobId]/assignment` route for claim, unclaim, and reassign. Self-claim is one conditional update over the named same-shop open ticket/job, null assignment, and the current active supported actor's sufficient tier; it stamps the database claim time. Losing racers receive only the safe current assignee. Self/admin unclaim clears assignment and claim time; advisor/owner reassign atomically rechecks current actor authority, target shop/activity/supported role/tier, current required tier, and explicit below-tier confirmation. Four focused files/67 tests and the complete 203-file/1,750-test suite pass with TypeScript, production build, clean diff checks, two task reviews, and a whole-branch review. PGlite exercises deterministic conflict paths but not two-connection PostgreSQL timing; SQL predicates own the race. No UI, work-start/status transition, schema, production, quote/approval, provider, session, or diagnostic-engine behavior changed.

**Implementation correction — Today job board proved 2026-07-10.** [Row-14 packet](./2026-07-10-shop-os-phase-2-today-jobs-plan.md) adds a tenant-safe Today read model plus a focused repair-order ledger for My Jobs and tier-eligible Open Jobs. Today preserves creation controls, curator access, follow-ups/check-ins, ticketless legacy diagnoses, closed-today history, and empty guidance while de-duplicating only persisted ticket-linked session IDs. Claim uses row 13's exact route, refreshes server truth, keeps safe race feedback mounted, and returns visible focus to an owned target. Repair/maintenance remains disabled with `Quote and approval required`; unlinked diagnostics expose no invented start. Linked session navigation appears only when the current actor actually owns that same-shop session, so reassignment never produces a guaranteed 404. Five focused files/57 tests and the complete 206-file/1,775-test suite pass with TypeScript, production build, two task reviews, and a whole-branch review. Signed-in Chrome remained unavailable; DOM/static proof covers 44px controls, 375px stacking, reduced motion, focus, refresh feedback, and preserved content. No schema, production, quote/approval, work-status, bootstrap, provider, or diagnostic-engine behavior changed.

**Implementation correction — leased diagnostic bootstrap proved 2026-07-10.** [Row-15 packet](./2026-07-10-shop-os-phase-2-diagnostic-bootstrap-plan.md) adds one dedicated ticket-job start route and a two-minute database-time state machine that returns an owned linked session on retry, grants one conditional provider lease, and atomically creates/links the session only after the exact acquired ticket/vehicle context is reauthorized and row-locked. Counter-intake topology hits reuse the populated `_topology` sentinel with zero AI work; other cases reuse the complete retrieval/tree initializer unchanged. Live leases freeze unclaim/reassign, expired leases remain assignable, stale workers learn no newer state, every post-initializer uncertainty becomes `ambiguous`, and status-only polling can expose expiry without acquiring a lease, consuming quota, or invoking AI. Today now supplies the third tap with explicit idle/wait/ambiguous/ready states, a fresh-key possible-duplicate-cost confirmation, validated owned-session navigation, legacy linked-session compatibility, and the unchanged `Quote and approval required` simple-work gate. Ten focused files/176 tests and the complete 209-file/1,866-test suite pass with TypeScript, production build, task reviews, and a whole-branch review. PGlite proves deterministic behavior and SQL/lock structure but not two-connection PostgreSQL timing; the conditional updates and job→ticket→vehicle→actor locks own that boundary. No schema, production data, provider call, quote/approval, repair mutation, cold-case synthesis, deployment, or diagnostic-engine semantics changed.

### Phase 3 — Immutable quote, story, and phone approval (L)

**Ships:** manual `job_lines`; `canned_jobs`; `job_attachments`; shop rate/tax; quote math; immutable `quote_versions`; approval `quote_events`; evidence-bound story generator/review; exact-version phone/in-person approval; completed Door C; diagnostic fee line; ticket-backed repair authorization plus explicit declined/no-repair closeout guards; simple work view; and "found something" diagnostic escalation.

Quote build is universal. Send/approval recording/close remain capability-gated. A change after approval creates a new version and requires new approval. Tree/published-wizard lock seeds story/search; topology stays manual. Legacy ticketless repair behavior is unchanged.

**External preparation:** after consent/legal copy is approved, the owner may begin A2P registration. Agents do not file or spend autonomously.

**Done when:** fixture diagnostic runs lock→story→versioned quote→phone approval; repair and simple-work mutation stay locked before approval and unlock only for the approved version; a declined job can close only through the no-repair path and never records performed work; a simple job runs approved→photo/note→done with zero AI calls; math matches hand calculations at rounding/tax edges; mutation/retry/tenant tests pass; Door C creates a canned priced quote in under 60 seconds.

**Implementation correction — deterministic quote domain proved 2026-07-11.** [Row-17 packet](./2026-07-10-shop-os-phase-3-quote-domain-plan.md) adds scaled-integer money math, tenant-safe mutable manual lines, deterministic immutable ticket versions, exact-version phone/in-person decisions, one privacy-safe builder read model, and thin authenticated/paywalled route shims. Ticket-first stable `NOWAIT` locking prevents quote paths from waiting behind the existing diagnostic job→ticket path; exact request-key retries remain actor-bound and precede stale-version checks; append-only decision events and immutable snapshots backstop the current projection. Six focused files/113 tests and the complete 216-file/1,989-test suite pass with TypeScript, production build, task reviews, whole-branch review, and a zero-finding security review. PGlite proves generated lock order, rollback, and deterministic same-client behavior; true two-connection PostgreSQL timing remains deferred to integration proof. No production migration, send/vendor/work execution, UI, or diagnostic-engine behavior changed.

**Implementation correction — manual quote builder proved 2026-07-11.** [Row-18 packet](./2026-07-11-shop-os-phase-3-manual-quote-builder-plan.md) adds one protected repair-order quote surface over row 17's safe builder and mutation routes. Advisors and owners can create, edit, remove, total, and prepare manual part/labor/fee lines while exact BigInt formatting, strict hostile-response validation, server-truth refresh, serialized mutations, privacy-minimized client identity, honest contention recovery, and immutable version truth fail closed. The calibrated quote tape supports 375px, safe areas, software keyboards, restored focus, 44px controls, and exact maximum values without exposing cost/vendor/diagnostic data or implying send, approval, authorization, ordering, or work execution. Eleven focused files/216 tests and the complete 219-file/2,073-test suite pass with TypeScript, production build, clean diff checks, task reviews, and zero-finding visual/accessibility and product/security reviews. Chrome and its extension were installed and enabled but Chrome was not running; owner permission is required to launch it, so loaded protected-page browser proof remains the recorded environment gate and is not claimed. No schema, production data, external account, diagnostic-engine behavior, or non-manual quote source changed.

**Implementation correction — evidence-bound tree stories proved 2026-07-11.** [Row-20 packet](./2026-07-11-shop-os-phase-3-customer-story-plan.md) adds one strict forced-tool evidence selector, tenant-safe bounded workspace, actor-bound retry/CAS persistence, and thin authenticated route for ordinary locked tree jobs. The server owns concern, locked finding/action, neutral waiver copy, and byte-exact selected proof; provider work runs outside transactions with a 30-second timeout and zero retries, then ticket-first `NOWAIT` revalidation atomically saves the mutable draft and invalidates changed active quote truth. AI output persists `reviewStatus: pending`; quote version creation rejects every non-null story without valid metadata and every AI story not explicitly reviewed. Row 21 owns the authenticated pending-to-reviewed human edit/review and approval UI. Five focused files/129 tests and the complete 227-file/2,251-test suite pass with TypeScript, production build, diff checks, approved task and whole-branch reviews, and a zero-finding final narrow review. PGlite proves generated lock order, injected drift, and rollback, not true two-connection timing. No migration/DDL, UI, production data, live provider call, engine write, external access, or repair mutation occurred.

**Implementation correction — ticket-backed repair authorization and honest closeout proved 2026-07-11.** [Row-22 design](./2026-07-11-shop-os-row22-repair-closeout-design.md) and [execution packet](./2026-07-11-shop-os-row22-repair-closeout-plan.md) add one shared authorization projection plus locked mutation checks across repair observations, performed-repair closeout, and declined/no-repair closeout. Exact immutable quote snapshot and latest decision truth, open repairing session state, current assignment, active membership, tenant identity, and `NOWAIT` lock order all fail closed; the approved path rechecks before specificity AI and again atomically with final writes. The no-repair marker is server-owned, uses locked diagnosis truth, records no repair or verification, and cancels only the declined diagnostic job. Ticketless legacy behavior and wizard, adaptive, topology, prompt, gate, retrieval, corpus, and engine semantics remain unchanged. PR #141 passed 10 focused files/113 tests and the complete 244-file/2,478-test suite with TypeScript, production build, diff checks, and an approved whole-branch re-review with no remaining findings. No migration, production data change, feature enablement, external provider, or spend occurred.

**Implementation correction — A2P consent contract ready for owner decision 2026-07-11.** [Row-25 design](./2026-07-11-shop-os-row25-a2p-consent-design.md) and [execution packet](./2026-07-11-shop-os-row25-a2p-consent-plan.md) define an ongoing same-shop transactional repair-update program with optional written consent, complete phone/in-person fallback, immutable disclosure proof, separate caller/destination suppression, honest provider-handoff races, reasonable revocation, provider-signed webhook ordering, consumer SMS Terms, Privacy/subprocessor direction, and draft Row-26 campaign fields. Independent product/compliance/security review found and corrected fourteen concrete defects; final re-review reports no remaining Critical, Important, or Minor findings. PR #149 is docs-only and remains an explicit owner language decision. It authorizes no published legal-page edit, provider registration, account, credential, spend, schema/runtime change, production message, or customer send.

### Phase 4 — Parts vendor layer (M; external risk)

**Ships:** secure `vendor_accounts`; adapter contract; fully usable manual transport; PartsTech or O'Reilly transport only after access is confirmed; offer snapshot/refresh; diagnosis-seeded query UI; optional RepairPal benchmark only after permitted-use confirmation.

**Done when:** the base phase can source and snapshot a manual offer without blocking a quote, and no secret reaches DB JSON, logs, browser payload, or git. If approved transport access exists, its extension returns price/availability/fitment and fills a line in three taps while timeout/auth/rate-limit failures degrade to manual mode.

**Implementation correction — dormant vendor-account source proved 2026-07-11.** [Row-27 design](./2026-07-11-shop-os-row27-vendor-accounts-schema-design.md) and [execution packet](./2026-07-11-shop-os-row27-vendor-accounts-schema-plan.md) add one server-only `vendor_accounts` table, direct shop ownership, and a same-shop `job_lines` foreign key. Manual accounts hold no reference; API/punchout rows accept only bounded `env:` or canonical lowercase `vault:` reference shapes. No writer or resolver exists, and Row 28 must allowlist config plus reference identifiers before either field is writable. The standard PGlite fixture detects absent/complete/partial source state and applies the real migration after the existing guarded unjournaled adaptive migration. Historical Drizzle metadata remains untouched because two isolated generator attempts failed on pre-existing malformed snapshots. PR #147 passed 4 affected files/53 tests and the complete 254-file/2,549-test suite with TypeScript, production build, clean diff checks, and independent pre-code plus whole-branch schema/security review. No runtime path imports the table; no production DDL, data, credential, provider access, or spend occurred. Row 28 implementation cannot deploy until live Row 27 DDL is separately approved and advisors/invariants pass, unless a later reviewed slice proves the code completely unreachable and dormant.

**Implementation correction — manual sourcing contract approved 2026-07-11.** [Row-28 design](./2026-07-11-shop-os-row28-manual-sourcing-design.md) and [execution packet](./2026-07-11-shop-os-row28-manual-sourcing-plan.md) reconcile the already-complete manual quote entry floor with the missing supplier identity, normalized human-verified offer snapshot, retry/removal semantics, complete quote projection, and read-only compatibility rendering. The approved contract is manual-only, provider-free, fixed-USD, tenant-bound, privacy-minimized, and uses the canonical all-job/all-line quote lock order. It explicitly excludes diagnostics until Row 30, preserves historical offers across account rename/disable, and adds no order methods or credential resolver. PR #148 is docs-only and independently approved with no remaining findings. Runtime implementation is not authorized until the owner approves the exact Row 27 production migration and live table/FK/RLS/grant/advisor/application proofs pass.

**Implementation correction — complete manual sourcing runtime proved 2026-07-12.** Production migrations `0030`, `0031`, and ACL correction `0032` were separately owner-approved, applied through Supabase migration tooling, and verified with unchanged data, 0 direct/effective client table privileges, 32 intended service CRUD grants, 8 RLS policies, clean Shop OS advisor scope, successful deployment, and healthy application response. PR #153 adds zero-network manual adapter contracts, tenant/capability-safe supplier account management, canonical retry-safe human offer capture/removal, one shared fail-closed 4-KiB snapshot validator, complete customer-safe quote totals/versions, and honest read-only compatibility rendering. It adds no provider transport, credential resolver, order method, schema, spend, diagnostic-engine change, or Row-30 sourcing controls. The complete 260-file/2,606-test suite, TypeScript, production build, diff checks, and independent parts/security, quote/privacy, and UI/accessibility reviews pass with no remaining findings.

### Phase 5 — Secure text-to-approve and response inbox (M)

**Ships:** customer consent fields; `quote_sends`, `sms_log`, and `notifications`; hosted public approval route; hashed expiring/revocable version-bound token; per-job approval/decline/question; Twilio send/webhooks; STOP/HELP; redacted logging; minimal in-app advisor/tech response notifications; updated privacy/terms/subprocessor disclosures.

The public approval route is deliberately exempted from authenticated-app middleware while remaining rate-limited and tenant/version bound. Phone/in-person remains equal and SMS-disabled shops remain complete.

**Done when:** automated fixture/test-number flow sends, opens, approves/declines/questions idempotently against the correct immutable version; stale/revoked/brute-force/cross-shop tokens fail; old sends cannot approve a replacement version; responses appear in-app. Real-customer messaging is owner-run field validation, not an agent test.

**Implementation correction — messaging retention/deletion source verified 2026-07-13.** [Row-31 design](./2026-07-12-shop-os-row31-messaging-retention-deletion-design.md), [convergence plan](../superpowers/plans/2026-07-12-shop-os-row31-deletion-convergence.md), and [request-scoped work-journal plan](../superpowers/plans/2026-07-13-shop-os-row31-deletion-work-journal.md) implement the owner-approved balanced policy: five-year privacy-minimized consent/revocation proof, twelve-month delivery metadata, ninety-day notifications, and the existing ninety-day backup age-out. Deletion commits durable multi-key suppression before bounded retryable cleanup, removes readable messaging identity and ordinary metadata, preserves held records without losing exact request-scoped proof, and retains only a keyed-destination compliance tombstone for the remaining proof window; expiration never restores consent. The ready-to-ship source passes 273/273 focused Row 31 tests, the complete 268-file/3,032-test suite, TypeScript, a 65-page production build, diff checks, and independent PASS/PASS closure review with no Critical or Important findings. It adds no provider, public route, UI, published policy, production DDL, message, credential, spend, or diagnostic-engine change. Migrations `0033` and `0034` have not been applied; production migration and production messaging remain separate gates.

### Phase 6 — Push, order queue, board, and delivery (M)

**Ships:** `push_subscriptions`; explicit permission UX; VAPID subscription/server send/service-worker handlers; capability-routed push with in-app fallback; `parts_orders`/`parts_order_lines`; manual order queue and receive flow; offer staleness re-check; optional API/punchout placement behind transport access; derived ticket board; explicit delivery/closeout; vehicle history extension.

**Done when:** push works on supported/allowed devices and degrades cleanly when denied; quote approval reaches the correct recipients once; manual order/receive works without a provider API; changed/unavailable offers block provider placement; sandbox/dry-run proves provider-order idempotency when a transport exists; ticket moves through current derived states to explicit delivery/close without losing legacy history.

### Step-to-phase map

| Preflight | Intake | Assign | Command center | Story | Quote | Parts | Approval | Notify/order | Work→delivery |
|---|---|---|---|---|---|---|---|---|---|
| Phase 0 | 1 | 1–2 | 2 | 3 | 3 | 4 | 3 phone / 5 page | 5–6 | 3 work / 6 delivery |

### Headline numbers

- **7 phases including Phase 0**; no implementation phase is safe before live-schema reconciliation.
- **14 new logical tables + columns on 3 existing tables**; final physical delta depends on adopt/retire mapping.
- **0 diagnostic-semantic or planned engine-schema changes.** Four explicitly allowed OS integration seams plus one owner-approved cleanup of already-live Shop-Management columns on `sessions`.
- **Manual quote/phone approval works before vendors, SMS, or push.**
- SMS and vendor prices/access are conditional external inputs, not guaranteed acceptance criteria.

### Sequencing rationale

```
PHASE 0  choose one schema and preserve live data
  └── PHASE 1  ticket spine + handlers + honest intake
      └── PHASE 2  tech room + reliable diagnostic start
          └── PHASE 3  immutable money/story contract
              ├── PHASE 4  optional vendor acceleration
              └── PHASE 5  optional customer channel + in-app responses
                  └── PHASE 6  push/order/board/delivery orchestration
```

The highest product risk is story quality; the highest technical risk is live-schema reconciliation; the highest external risk is vendor/carrier access. The sequence isolates all three behind working manual paths.

---

## 11. Session protocol and status table

### 11.1 Audit stamp

Rev 4 was checked against:

- `main` @ `38a3b7fc1ee8c910bd5433b74e2aeb64c6731ca7`.
- All fetched remote heads, original audit commit `b36fb367`, and PR #70/#71/#115 history.
- Current schema/routes/handlers/UI/tests/policies/service worker and diagnostic lifecycle.
- Read-only live Supabase migrations, tables, counts, grants/policies, and advisors.
- Current official Twilio, PartsTech, O'Reilly, and RepairPal sources.

If `main` or live migration history changes, re-run the relevant baseline checks before claiming a row. The detailed evidence is in the companion audit; this file remains the only active implementation plan.

### 11.2 Resume protocol

1. Read this plan, `AGENTS.md`, and the interaction doctrine for UI work.
2. Run `git fetch --all --prune`, `git worktree list`, and `gh pr list --state open` before trusting the table. Compare live migrations/tables before any schema row.
3. Rows 1–3, 5–25, 27–28, and 30 are complete. Row 30 merged in PR #154 and passed production mobile, desktop, API-health, authentication-boundary, and deployment-log proof. Row 31 source is verified and ready to ship, while migrations `0033` and `0034`, retention/legal publication, production messaging, later production feature enablement, and external account/spend work remain owner gates.
4. Claim one row by recording owner/branch and opening a draft PR. One named writer owns each artifact; advisory review lanes do not co-edit it.
5. Respect `Depends on`, `Gate`, and owned paths. Two active rows may not touch the same screen/domain files.
6. Before shipping: `pnpm test`, `pnpm exec tsc --noEmit`, and `pnpm build`. UI rows also run the repository's required browser accessibility check. Schema rows additionally prove local migration, live migration only after approval, and clean Supabase advisors.
7. Update status + PR in the shipping PR. If reality drifts, add an **Implementation correction** under the relevant phase; it overrides the earlier wording.

Hard boundary: the four seams in §3.3 are explicitly allowed, including their narrow changes to current session/intake route, handler, page, and repair/close UI paths. Except for those seams and the owner-approved live-drift reconciliation, a Shop OS row that needs a diagnostic prompt, risk/gate/retrieval/corpus/topology semantic change or an engine-table migration is mis-scoped. Stop and propose a separate engine plan.

### 11.3 Lanes and owned paths

```
C   control/docs       docs/strategy/*, plan convergence
S   schema             lib/db/schema.ts, drizzle/migrations/*, meta/*
R   roles/team         capability helpers, app/api/team/*,
                       settings team UI and role/tier tests
LT  ticket domain      lib/tickets*, lib/jobs*, app/api/tickets|jobs/*
I   engine seam        lib/intake/session.ts + new bootstrap,
                       lib/sessions.ts narrow approval guards,
                       app/api/sessions/*, app/(app)/sessions/[id]/*,
                       ActiveSession/RepairPhaseView/OutcomeCapture
LQ  quote/story        lib/quotes*, new lib/ai/customer-story.ts
LP  parts              lib/parts*, vendor/order handlers
LM  messaging          lib/messaging*, lib/notifications*, webhooks
A   advisor/customer   counter intake, ticket, quote, approval, board UI
T   technician         /today composition and sessionless job/work UI
P   platform           middleware/proxy, public-route policy, service worker,
                       push client, privacy/terms/subprocessor docs
X   external owner     vendor/carrier applications, credentials, spend
```

`S` is exclusive. Within each UI lane, only one active row may own a shared surface. Domain route shims follow their corresponding `L*` owner. Production migrations and real vendor orders are never implied by completing code.

Statuses: `pending`, `in_progress`, `blocked`, `owner_gate`, `complete`.

### 11.4 Resume-point table

| # | Phase | Workstream | Lane | Depends on | Status | Gate / claim / PR |
|---:|---:|---|---|---|---|---|
| 1 | 0 | Main/remote/live audit + Rev-4 plan reconciliation | C | — | complete | This document; no PR opened |
| 2 | 0 | Approve canonical model + legacy-row/adopt-retire treatment | C | 1 | complete | Brandon approved 2026-07-10 |
| 3 | 0 | Reconciliation migration + rollback draft, RLS/grants, local proof | S | 2 | complete | [Phase-0 packet](./2026-07-10-shop-os-phase-0-reconciliation-plan.md) + 11 tests; no production apply |
| 4 | 0 | Vendor identity/access discovery: PartsTech, O'Reilly, Tri State, RepairPal | X | 1 | owner_gate | External representation/account access |
| 5 | 1 | Source schema/migration: canonical tickets/jobs, legacy mapping, numbering, tier/roles | S | 3 | complete | PR #117; 15 focused + 1,495 full tests; no production apply |
| 6 | 1 | Apply approved reconciliation migration + verify live advisors | S | 5 | complete | Brandon approved 2026-07-11; applied `shop_os_ticket_spine`, `team_membership_lifecycle`, and `shop_os_quote_foundation`; live data/schema invariants passed; advisor follow-up recorded |
| 7 | 1 | Capability helpers + team/invite/update APIs and last-owner guard | R | 5 | complete | PR #118; 65 focused + 1,519 full tests; no production apply |
| 8 | 1 | Ticket/job handlers, queries, API, and access tests | LT | 5 | complete | PR #119; 40 focused + 1,559 full tests; no production apply |
| 9 | 1 | Real ticket detail/read surface | A | 8 | complete | PR #120; 18 focused + 1,577 full tests; [execution packet](./2026-07-10-shop-os-phase-1-ticket-detail-plan.md) |
| 10 | 1 | Counter intake v2: VIN, roster, true-open, concern, redirect | A | 7,8,9 | complete | PR #121; 8 focused files/105 tests + 195 files/1,618 full tests; [execution packet](./2026-07-10-shop-os-phase-1-counter-intake-v2-plan.md); feature enable remains owner gate |
| 11 | 1 | Door C minimal create | A | 8,9 | complete | PR #122; 5 focused files/67 tests + 198 files/1,668 full tests; [execution packet](./2026-07-10-shop-os-phase-1-door-c-minimal-create-plan.md) |
| 12 | 1 | Door B provisional ticket/job wrapper | I | 8 | complete | PR #123; 9 focused files/90 tests + 201 files/1,715 full tests; [execution packet](./2026-07-10-shop-os-phase-1-door-b-provisional-plan.md); creation seam only |
| 13 | 2 | Atomic claim/unclaim/reassign handlers + tests | LT | 7,8 | complete | PR #124; 4 focused files/67 tests + 203 files/1,750 full tests; [execution packet](./2026-07-10-shop-os-phase-2-job-assignment-plan.md) |
| 14 | 2 | My/Open Jobs composed into Today; simple work disabled pending approval | T | 13 | complete | PR #125; 5 focused files/57 tests + 206 files/1,775 full tests; [execution packet](./2026-07-10-shop-os-phase-2-today-jobs-plan.md) |
| 15 | 2 | Leased/idempotent full diagnostic bootstrap + unique session link | I | 8,12 | complete | PR #126; 10 focused files/176 tests + 209 files/1,866 full tests; [execution packet](./2026-07-10-shop-os-phase-2-diagnostic-bootstrap-plan.md); creation seam and diagnostic semantics preserved |
| 16 | 3 | Schema: attachments, lines, canned jobs, stories, quote versions/events, rates | S | 5 | complete | PR #127; 3 focused files/25 tests + 210 files/1,876 full tests; source/local proof only; [execution packet](./2026-07-10-shop-os-phase-3-quote-foundation-plan.md) |
| 17 | 3 | Quote math, CRUD, versioning, invalidation, approval idempotency | LQ | 16 | complete | PR #128; 6 focused files/113 tests + 216 files/1,989 full tests; [execution packet](./2026-07-10-shop-os-phase-3-quote-domain-plan.md); no production apply |
| 18 | 3 | Manual quote builder + totals | A | 17 | complete | PR #129; 11 focused files/216 tests + 219 files/2,073 full tests; [execution packet](./2026-07-11-shop-os-phase-3-manual-quote-builder-plan.md) |
| 19 | 3 | Canned jobs + completed Door C quote | A | 17,18 | complete | PR #130; [execution packet](./2026-07-11-shop-os-phase-3-canned-jobs-plan.md); copied lines remain complete visible manual truth |
| 20 | 3 | Evidence-bound story generator + guards | LQ | 15,16 | complete | PR #132; merge `e9bc780`; 5 focused files/129 tests + 227 files/2,251 full tests; [execution packet](./2026-07-11-shop-os-phase-3-customer-story-plan.md); ordinary locked trees only |
| 21 | 3 | Story review/manual topology + phone/in-person approval UI | A | 17,20 | complete | PR #134; 231 files/2,312 full tests; [design](./2026-07-11-shop-os-row21-story-review-and-approval-design.md) + [execution packet](./2026-07-11-shop-os-row21-story-review-and-approval-plan.md); no migration/provider/engine changes |
| 22 | 3 | Ticket-aware repair + declined/no-repair closeout guards across handler/API/UI | I | 15,17 | complete | PR #141; 10 focused files/113 tests + 244 files/2,478 full tests; [design](./2026-07-11-shop-os-row22-repair-closeout-design.md) + [execution packet](./2026-07-11-shop-os-row22-repair-closeout-plan.md); authorization seam; legacy sessions unchanged |
| 23 | 3 | Simple-work/attachment/escalation handlers | LT | 13,16,17,22 | complete | PR #143; 12 focused files/134 tests + 250 files/2,517 full tests; [design](./2026-07-11-shop-os-row23-simple-work-handlers-design.md) + [execution packet](./2026-07-11-shop-os-row23-simple-work-handlers-plan.md); independently reviewed; no schema/provider/UI/engine changes |
| 24 | 3 | Simple-work/attachment/escalation UI | T | 14,23 | complete | PR #145; merge `d049b29`; 7 focused files/85 tests + 253 files/2,544 full tests; [design](./2026-07-11-shop-os-row24-simple-work-ui-design.md) + [execution packet](./2026-07-11-shop-os-row24-simple-work-ui-plan.md); independently reviewed and production-smoked without fabricated data |
| 25 | 3 | A2P consent, policy, and disclosure design | P | 1 | complete | PR #149; owner-approved exact language; registration, publication, retention, and spend remain separate gates |
| 26 | 3 | A2P registration and sender procurement | X | 25 | owner_gate | Business representation + spend |
| 27 | 4 | Schema/security: vendor accounts and safe secret references | S | 5,16 | complete | PR #147; production migration `shop_os_vendor_accounts` live and verified with ACL correction PR #152/migration `shop_os_server_only_acl`; [design](./2026-07-11-shop-os-row27-vendor-accounts-schema-design.md) + [execution packet](./2026-07-11-shop-os-row27-vendor-accounts-schema-plan.md) |
| 28 | 4 | Adapter interface + complete manual sourcing mode | LP | 27 | complete | PR #153; 260 files/2,606 tests; TypeScript/build; three independent final approvals; manual-only and provider-free |
| 29 | 4 | Approved PartsTech/O'Reilly transport + failure tests | LP | 4,28 | blocked | External access required |
| 30 | 4 | Locked-diagnosis seed + manual/live offer/line-fill UI | A | 21,28 | complete | PR #154; merge `19898cf`; owner-approved [written design](./2026-07-12-shop-os-row30-frictionless-sourcing-design.md) + [execution plan](../superpowers/plans/2026-07-12-shop-os-row30-frictionless-sourcing.md); 262 files/2,718 tests; TypeScript/build; four independent final approvals; production mobile/desktop/API/log proof; manual capture is live, while provider transport controls still wait on Row 29 |
| 31 | 5 | Schema: consent, sends, SMS log, notification dedupe | S | 16,25 | complete | Verified, ready-to-ship source: 273 focused tests + 268 files/3,032 full tests, TypeScript/build, and independent PASS/PASS closure review; [retention/deletion design](./2026-07-12-shop-os-row31-messaging-retention-deletion-design.md) + [work-journal execution plan](../superpowers/plans/2026-07-13-shop-os-row31-deletion-work-journal.md); migrations `0033`/`0034` are not applied and remain a separate production gate |
| 32 | 5 | Public approval token/response handlers + retry/security tests | LM | 17,21,31 | pending | — |
| 33 | 5 | Public-route middleware exemption + rate-limit policy | P | 32 | pending | Shared middleware owned here |
| 34 | 5 | Hosted approval page UI | A | 32,33 | pending | — |
| 35 | 5 | SMS send/webhooks/STOP/HELP + inbound customer mapping | LM | 26,31,32 | blocked | Registered sender + credentials required |
| 36 | 5 | In-app response notification handlers + capability routing | LM | 31,32 | pending | — |
| 37 | 5 | Advisor response inbox UI | A | 34,36 | pending | — |
| 38 | 6 | Schema: push subscriptions, parts orders, order-line mapping | S | 27,31 | pending | — |
| 39 | 6 | Push routing/server delivery + dedupe | LM | 36,38 | pending | — |
| 40 | 6 | Push permission/subscription/service-worker UI + fallback | P | 39 | pending | Browser/device support is best-effort |
| 41 | 6 | Manual order refresh/confirm/receive handlers | LP | 17,28,38 | pending | No provider API required |
| 42 | 6 | Manual order queue/receive UI | A | 30,41 | pending | — |
| 43 | 6 | Optional API/punchout placement + provider idempotency | LP | 29,41 | blocked | Sandbox or owner approval for real order |
| 44 | 6 | Derived board/delivery/closeout handlers | LT | 23,36,41 | pending | — |
| 45 | 6 | Board + delivery/closeout + vehicle-history UI | A | 24,37,42,44 | pending | — |

---

## Sources for external claims

- Twilio: [Messaging Policy](https://www.twilio.com/en-us/legal/messaging-policy) · [A2P fees](https://help.twilio.com/hc/en-us/articles/1260803965530-A2P-10DLC-Campaign-Registration-Guide) · [US SMS pricing](https://www.twilio.com/en-us/sms/pricing/us) · [business information requirements](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/collect-business-info)
- PartsTech: [pricing](https://partstech.com/pricing/) · [developer API overview](https://partstech.com/resource/blog/partstech-sms-a-winning-combination/) · [O'Reilly connection](https://get.partstech.com/oreilly)
- O'Reilly Pro: [Integration Hub](https://integrations.oreillypro.com/)
- RepairPal: [estimator](https://repairpal.com/estimator) · [FAQ](https://repairpal.com/faq) · [partner program](https://pages.repairpal.com/partners)

*External claims checked 2026-07-10; re-verify price, access, policy, and commercial terms at procurement/build time.*
