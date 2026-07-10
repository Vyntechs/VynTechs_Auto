# Shop OS Audit — what's needed to turn the diagnostic copilot into a full shop operating system

Date: 2026-07-10 · Branch: `claude/shop-os-architecture-peqi8n` · Status: **audit + roadmap, no code changes yet**

This is the required audit before any build. It maps what exists today against
what a full shop operating system needs — with **the diagnostic engine as the
permanent centerpiece**, and advisor / technician / management / parts all
orbiting it, plus the three named vendor integrations (O'Reilly First Call,
Tri State parts, RepairPal).

---

## Headline numbers

| | Today | Full shop OS |
|---|---|---|
| Roles | **2** (`tech`, `owner`) + curator/founder axis | **5+** (advisor, technician, parts, management/owner, + curator) with RBAC |
| Core object | **Diagnostic `session`** (open/closed/declined/deferred) | **Repair Order** that *wraps* the diagnostic + estimate + parts + labor + invoice |
| External integrations | **6 retrieval adapters** (NHTSA, recall, forum, reddit, youtube, web) + weather | + **O'Reilly First Call**, **Tri State**, **RepairPal** (parts pricing/availability + labor/estimate benchmarking) |
| Money in the system | **Stripe SaaS subscription** (shop → us) | + **customer-facing invoicing** (shop → car owner): estimate, approval, payment |
| Parts | A `partInfo` blob captured *after* the fix, in `outcome` | Live catalog, pricing, availability, PO, receiving, cores, returns, margin |
| Scheduling / dispatch | none | appointment book + tech dispatch board + capacity |
| Tables | ~38 (13 in `lib/`, rest topology/corpus) | + ~15–20 for the RO spine, parts, labor, approvals, time |

The single most important finding: **the shop-OS UI vocabulary already exists in
the design layer but has nothing behind it.** `components/screens/counter-intake.tsx`
is live; `counter-work-order-confirm.tsx` renders a `workOrderId`, `estimate`,
`techAssigned`, `authSummary`, and a `customerMessage` (approval) — but there is
**no `work_orders` table, no `estimates` table, no approval flow, no parts, no
second role.** The vision is drawn; the spine isn't built.

---

## What exists today (the audit)

### The map as it stands

```
SHOP (tenant, Stripe subscription)
  │
  ├── profiles          role = 'tech' | 'owner'   (+ isCurator / founder)
  │
  ├── customers ── vehicles
  │
  └── sessions  ◄── THE DIAGNOSTIC. This is the whole product today.
        │
        │   [ tech enters vehicle + complaint ]
        │        │
        │   ┌────▼─────────────────┐
        │   │ Two-rung retrieval   │  cross-shop corpus (pgvector) + 6 web adapters
        │   └────┬─────────────────┘
        │   ┌────▼─────────────────┐
        │   │ Tree engine (Sonnet) │  stateful decision tree, forced JSON
        │   └────┬─────────────────┘
        │   ┌────▼─────────────────┐
        │   │ Risk + confidence    │  ~15 regex rules → Haiku fallback → gate
        │   │ gate                 │  block / gather-more / defer
        │   └────┬─────────────────┘
        │   ┌────▼─────────────────┐
        │   │ Repair phase (locked)│  guidance only, diagnosis can't be re-opened
        │   └────┬─────────────────┘
        │        │
        └── outcome { rootCause, actionType, partInfo{name,oem,aftermarket,cost},
                      verification, diagMinutes, repairMinutes }  ◄── the ONLY place
                                                                       parts+labor exist,
                                                                       and it's post-hoc,
                                                                       free-text, unpriced
```

### What's genuinely strong (do not rebuild)

- **The diagnostic engine.** Tree engine, calibrated risk gating, two-rung
  retrieval, self-curating corpus, electrical-topology knowledge graph. This is
  the moat. Every role below plugs *into* it; none of it changes.
- **Multi-tenancy + auth spine.** `shops → profiles → customers → vehicles →
  sessions`, closed-by-default middleware paywall, defense-in-depth handler
  checks. The tenant boundary a shop OS needs is already enforced.
- **A team primitive.** `api/team/{invite,role,deactivate}` and `getShopTeam`
  (with per-tech workload badges) already exist. Roles are changeable today —
  the enum is just too small.
- **Handler-in-`lib/` + thin route shim + pglite tests.** The convention that
  makes new domains (parts, estimates, RO) testable against real Postgres is
  already in place. New work inherits it for free.
- **The outcome already names parts and labor.** `partInfo{name, oemNumber,
  aftermarket, cost}` + `diagMinutes` + `repairMinutes` prove the diagnostic
  *already knows* what a job needs. That payload is the seed of the estimate.

### What's missing (the gaps)

1. **No Repair Order.** The `session` is diagnostic-scoped. Nothing wraps a
   diagnostic + inspection + estimate + parts + labor + authorization + invoice
   into one durable, billable ticket that an advisor owns and a tech works.
2. **Only 2 roles, no RBAC.** No advisor, no parts, no management view. Role is
   a free-text column gating almost nothing (`ALLOWED_ROLES = {tech, owner}`).
3. **No parts domain at all.** No catalog, no live pricing/availability, no
   purchase orders, receiving, cores, returns, or margin. `lib/external/` holds
   only `weather.ts`.
4. **No vendor integrations.** O'Reilly First Call, Tri State, RepairPal are
   entirely absent.
5. **No customer-facing money.** Stripe is SaaS-only (shop pays us). There is no
   estimate → customer approval → invoice → payment for the car owner.
6. **No scheduling / dispatch.** No appointment book, no tech assignment board,
   no capacity/hours.
7. **No labor guide / service catalog.** Labor time is a free-text integer the
   tech types after the fact. No canned jobs, no pricing matrix, no menu.
8. **No management analytics.** No ARO, GP%, effective labor rate, tech
   efficiency, car count, comeback-rate dashboard rolled up for an owner.

---

## The organizing principle: everything orbits the diagnostic

The request is explicit — the diagnostic is the centerpiece and every role is
"tightly integrated" around it. Concretely, that means the diagnostic's output
is the **source of truth that seeds every other role's work**, and each role
writes back facts the diagnostic learns from.

```
                         ┌───────────────────────────┐
                         │      THE DIAGNOSTIC        │
                         │  (unchanged core engine)   │
                         └───────────────────────────┘
                    seeds ▲   │ produces          learns ▲
                          │   ▼                          │
   ADVISOR ──────────────────────────────────────────── writes back
   • builds Repair Order from complaint                  • customer's real words
   • sends diagnostic-derived estimate                   • approve/decline signal
   • gets customer authorization                         • declined-work reasons
                          │   ▼
   TECHNICIAN ─────────────────────────────────────────
   • receives job pre-loaded with the diagnostic tree    • actual root cause
   • runs the gated diagnostic (today's flow)            • verification result
   • clocks labor against RO lines                       • real diag/repair minutes  → CORPUS
                          │   ▼
   PARTS ──────────────────────────────────────────────
   • diagnostic names the part (partInfo)                • real price paid
   • quotes O'Reilly + Tri State live price/availability  • fitment confirmed/failed
   • raises PO, receives, tracks cores                   • supersessions
                          │   ▼
   MANAGEMENT ─────────────────────────────────────────
   • sees every RO's diagnostic confidence + risk        • threshold overrides
   • RepairPal-benchmarks the estimate                   • comeback attribution
   • ARO / GP% / efficiency / comeback dashboards
```

The corpus already self-curates from `outcome`. A shop OS makes that loop
**wider**: the advisor's approval signal, the tech's clocked minutes, and the
parts team's real price/fitment all become higher-quality training facts than
the single post-hoc `outcome` blob captured today.

---

## The missing spine: the Repair Order

A shop OS needs one durable object that every role touches. Today the `session`
almost is it — but it's diagnostic-only and closes when the diagnosis does. The
recommendation is **not** to overload `session`; it's to introduce a
`repair_orders` (RO) parent that a `session` belongs to, so the diagnostic
engine stays surgically unchanged.

```
repair_order (advisor owns)
  ├── vehicle + customer            (exists)
  ├── status: estimate → authorized → in_progress → parts_hold → complete → invoiced → paid
  ├── concerns[]  (customer complaints)  each ──► a diagnostic SESSION (existing engine)
  ├── inspection (DVI, optional)         findings ──► new concerns
  ├── estimate
  │     ├── labor_lines   (from diagnostic + labor guide / RepairPal time)
  │     └── parts_lines   (from diagnostic partInfo → O'Reilly/Tri State live quote)
  ├── authorization   (customer approve/decline per line, text/email)
  ├── purchase_orders → O'Reilly First Call / Tri State
  ├── labor_time_entries  (tech clock on/off per RO line)
  └── invoice → payment
```

RO status is the state machine the whole shop runs on. The diagnostic session
becomes *one node inside a concern*, keeping the safety doctrine (locked
diagnosis, risk gate) exactly as-is.

---

## Role-by-role: what each needs

### Advisor (service writer) — the front counter
- **Have:** `counter-intake` screen (live), `counter-work-order-confirm` screen
  (orphan, no backing model), customer/vehicle lookup, team roster.
- **Need:** create/own ROs; convert a complaint into a diagnostic session;
  assemble estimates from diagnostic output + labor guide + parts quotes; send
  the estimate for approval; capture authorization; status-text the customer;
  see the diagnostic's confidence/risk so they never oversell a low-confidence job.

### Technician — the bay
- **Have:** the entire diagnostic flow (this is their tool today), workload badges.
- **Need:** a dispatch/job board (assigned ROs, priority, status); clock on/off
  labor against RO lines; digital vehicle inspection with photos that spawn new
  concerns; the diagnostic pre-loaded from the RO rather than re-entered.

### Parts — the back counter
- **Need (all new):** parts catalog + live lookup; **O'Reilly First Call** and
  **Tri State** price/availability at the point the diagnostic names a part;
  PO creation, receiving, core tracking, returns; margin/matrix pricing; tie
  every part line back to the RO and back to the diagnostic that called for it.

### Management / owner — the office
- **Have:** owner role, billing/settings, curator tools, per-tech workload.
- **Need:** shop dashboard — car count, ARO, gross profit %, effective labor
  rate, tech efficiency/proficiency, **comeback rate** (already the product's
  north star — surface it), parts margin, approval-rate on estimates;
  **RepairPal** benchmarking of estimates; discount/override approvals;
  threshold/calibration visibility (curator tools point at this already).

---

## The three vendor integrations

| Vendor | What it gives the shop OS | Integration surface | Where it plugs in |
|---|---|---|---|
| **O'Reilly First Call** | Real-time B2B parts price + availability + ordering for pros | First Call Online / B2B API or punch-out; account + store number auth | Parts quote on an estimate line; PO on authorization; the diagnostic's `partInfo` is the search seed |
| **Tri State** | Second parts source — price/availability/coverage compare | Confirm API vs. catalog/EDI/punch-out during discovery | Same estimate-line quote surface; advisor/parts picks best source per line (price, availability, margin) |
| **RepairPal** | Fair-price estimate benchmarking + labor times; certified-shop network | RepairPal Estimate/API (labor + parts fair-cost ranges) | Validates the shop's estimate against market; supplies labor time when a canned job has none; management sees over/under-market |

**Integration doctrine (matches existing conventions):**
- Each vendor is a `lib/external/<vendor>/` adapter behind a **narrow internal
  interface** (`quotePart`, `checkAvailability`, `placeOrder`,
  `benchmarkEstimate`) — mirroring how `lib/retrieval/adapters/*` already sit
  behind one orchestrator. Swapping/adding a parts vendor stays a one-file change.
- **Fail-soft, budgeted, cached** — same pattern as retrieval (20s deadline,
  never blocks the human). A parts API being down must degrade to manual entry,
  never wedge an estimate.
- **Credentials per shop** — parts accounts, store numbers, and RepairPal keys
  are per-tenant secrets, not global. New `shop_integrations` table.
- **Discovery risk:** none of the three publishes a fully open self-serve API.
  Each needs an account/partner conversation to confirm the real surface (REST
  vs. punch-out vs. EDI). That confirmation is **Phase 0 work** below and gates
  the parts phases.

---

## New data model (delta only)

Additive — nothing in the diagnostic core changes.

- `repair_orders` — the spine (status machine, advisor, totals)
- `ro_concerns` — customer complaints; each links to a diagnostic `session`
- `inspections` / `inspection_items` — DVI with photo artifacts → new concerns
- `estimates` / `estimate_lines` (labor | part, source, price, cost, margin)
- `authorizations` — per-line customer approve/decline + channel + timestamp
- `parts_catalog` / `part_quotes` — vendor-agnostic cache of live quotes
- `purchase_orders` / `po_lines` / `part_receipts` — ordering + receiving + cores
- `labor_time_entries` — tech clock on/off per RO line (real effective labor)
- `service_catalog` / `labor_times` — canned jobs + guide/RepairPal times
- `invoices` / `payments` — customer-facing money
- `shop_integrations` — per-tenant vendor credentials (O'Reilly, Tri State, RepairPal)
- `profiles.role` enum widened: `tech | advisor | parts | manager | owner`, with an
  RBAC helper (`can(profile, action)`) replacing the two-value `ALLOWED_ROLES` set

---

## Phased roadmap

Ordered so the diagnostic stays the centerpiece and each phase ships something
usable. Rough sizing only — each phase is its own spec.

- **Phase 0 — Foundations + vendor discovery** *(blocks parts phases)*
  Widen the role enum + RBAC helper; add `repair_orders` + `ro_concerns` and
  wire the existing `session` to belong to a concern; confirm the real API
  surface for O'Reilly First Call, Tri State, and RepairPal (accounts, auth,
  data shape). Nothing customer-visible ships broken.
- **Phase 1 — RO spine + advisor.** RO lifecycle, estimate assembly from
  diagnostic output, customer authorization (text/email), status board. The
  orphan `counter-work-order-confirm` screen gets its real backend.
- **Phase 2 — Technician workflow.** Dispatch board, labor clock on/off, DVI
  with photos → concerns, diagnostic pre-loaded from the RO.
- **Phase 3 — Parts + O'Reilly + Tri State.** Catalog, live quote on estimate
  lines, source-compare, PO/receiving/cores/returns, margin.
- **Phase 4 — RepairPal + management.** Estimate benchmarking; owner dashboard
  (ARO, GP%, effective labor rate, efficiency, comeback rate, approval rate).
- **Phase 5 — Customer-facing money.** Invoice, payment, digital inspection
  report the customer sees.

Each phase closes with the existing gate: `pnpm test`, `pnpm exec tsc --noEmit`,
`pnpm build`, plus a11y on any wired surface — per `AGENTS.md`.

---

## Open questions for Brandon (need answers before Phase 0 build)

1. **Vendor accounts.** Do you have active O'Reilly First Call, Tri State, and
   RepairPal accounts/partner contacts? The integration surface can't be
   confirmed without them — this is the one true blocker.
2. **Money scope.** Is customer-facing invoicing/payment in scope for this
   product, or does the shop keep billing in an existing DMS/QuickBooks and we
   only push the estimate? (Changes Phase 5 from "build payments" to "export".)
3. **Accounting/DMS coexistence.** Is this the shop's *system of record*, or does
   it sit alongside Tekmetric/Shop-Ware/Mitchell? That decides how deep the RO,
   invoicing, and parts modules go vs. integrate-and-defer.
4. **Rollout.** One flagship shop to build against first (real O'Reilly account,
   real ROs), or a general multi-shop build? Recommend the former — the corpus
   and the vendor quirks both reward a design partner.
```
