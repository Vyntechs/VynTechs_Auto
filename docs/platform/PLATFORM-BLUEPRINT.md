# Platform Blueprint — Diagnostics + Living Service Manual + Shop Management, on One Spine

**Status:** Design only. No code, no schema changes, no build started.
**Date:** 2026-06-20
**Reconciles against:** `docs/interactive-diagnostics/MASTER-BUILD-BRIEF.md` (the diagnostics-engine soul + doctrine), `docs/strategy/2026-05-29-customer-interaction-doctrine.md` (who the customers are + the honesty bar), and the live data model in `lib/db/schema.ts`.

> **What this doc reuses, and what it un-vaults.** Almost everything this platform needs is already built: the topology diagnostic engine (`lib/diagnostics/*`), the intake→session runtime (`lib/intake`, `lib/flows`, `lib/gating`, `app/api/sessions/*`), the curator back-office (`lib/curator`, `app/curator/*`), the knowledge/citation spine (`lib/corpus`, `lib/retrieval`), and roles + Stripe billing. The master build brief deliberately **vaulted** the shop-management layer (`MASTER-BUILD-BRIEF.md:18` — *"OUT OF SCOPE (vaulted — do NOT build now): shop-management features, parts ordering… These are the 5-year platform vision, deliberately deferred."*). **This brief deliberately un-vaults that layer** — and reconciles the deferral honestly: shop-management returns **not as a fourth app bolted on, but as views and a job-ledger extension onto the two spines that already exist.** That is the only way the un-vaulting stays true to the soul (`MASTER-BUILD-BRIEF.md:9` — *"an engine that turns the theory of how a system works into an explorable wiring diagram that IS the diagnostic"*) and the minimum-moving-pieces thesis. If a phase ever needs a third object of truth, this doc requires a written justification. It never needs one.

---

## 0. Decisions Brandon Must Make (read this first)

A build session can ship Phase 1 the moment these are ruled on. Each is a real fork I cannot default for you.

| # | Decision | The fork | My recommendation |
|---|----------|----------|-------------------|
| **D1** | **Altitude** | Blueprint-only (you review, then we build) **vs.** blueprint-then-build Phase 1 now. | **Blueprint-only.** You read this, rule on D2–D5, then a build session picks up Phase 1. One approval gate, not a moving target. |
| **D2** | **The live trust breach** | There is a fabrication on the **paid, live** product *right now*: the decline-or-defer confidence gate renders four hardcoded "design-preview" confidences, curator names, and sources to real techs, because the live wrapper never passes real session data (`customer-interaction-doctrine.md:9–18` — your own doc calls it *"the single highest-priority trust fix in the app: it inverts the product's core promise"*). Fix it as **Phase 0 before any new build** — yes/no. | **Yes — Phase 0, before anything.** Un-vaulting a shop layer on top of a screen that fabricates evidence to paying techs poisons the whole thesis. This is small and it comes first. |
| **D3** | **Beachhead scope** | Confirm the roadmap targets the **2011–2016 6.7 Power Stroke** as the first real-shop platform. (Note: the resolver does not yet recognize 2011–2016 6.7 — it needs a new branch; this is known prior work, not new scope.) | **Confirm 2011–2016 6.7 PSD.** It's where your first paying shops actually live. |
| **D4** | **Brand** | **PlainWrench vs. Vyntechs** — decides the name on the customer-facing status link and the invoice. | Your call — it's external-facing and under your name. I default to nothing here. |
| **D5** | **Spine-boundary judgment calls** | (a) **Roles** — extend the `profiles.role` enum to name advisor/parts/master/b-tech, or keep the 3 existing roles + a thin permission layer? (b) **Parts** — fold parts into unified line-items, or give parts its own structure? (c) **Assignment** — reuse `sessions.tech_id` for Phase 1, or add an assignment table now? | (a) Thin permission layer over existing roles for Phase 1; (b) **unified line-items, no separate parts spine**; (c) reuse `sessions.tech_id` now, add assignment only when multi-tech coordination is real. All three keep us at two spines. |

Everything below is the design these decisions unlock.

---

## 1. The Thesis: Two Spines, Many Views

ProDemand + Identifix + Tekmetric are friction-heavy because each owns its **own copy of the truth** and forces a human to translate between them. The minimum-pieces design has exactly **two objects of truth**, and makes everything else a *view*.

### Spine 1 — The Knowledge Graph (vehicle-general truth)
**"How this system works, and what the field has learned about it."** True for a platform/system regardless of which customer is in the bay. This IS both the diagnostic engine and the futuristic service manual — *the same graph, read two ways* (`MASTER-BUILD-BRIEF.md:50` — *"After enough sessions this becomes what a service manual is supposed to be"*).

Tables (already built, `lib/db/schema.ts`): `platforms`, `architectureFacts`, `components`, `componentConnections`, `componentPins`, `observableProperties`, `symptoms`, `testActions`, `branchLogic`, `systemScenarios`, `scenarioWireStates`, `pinScenarioReadings`, `systemDataStatus`, `symptomTestImplications`, `platformEquivalents`. Plus the citation/field-outcome layer: `corpusEntries`, `retrievalCache`.

### Spine 2 — The Job Ledger (this-job truth)
**"What happened on THIS job, for THIS customer, and what we billed."** Instance data, tied to one repair order. This is the Repair Order as it flows: intake → assignment → **diagnose (the topology engine)** → recommend → authorize → parts → labor → invoice → comeback.

Tables (mostly built): `shops`, `profiles`, `customers`, `vehicles`, `sessions`, `sessionEvents`, `followUps`, `diagnosticSessions`, `tech_outcomes`. **Net-new = the repair-order lifecycle wrapped around the diagnostic session** (§4).

### The boundary rule
- Knowledge that is **true for a platform/system regardless of customer** → **Spine 1**.
- Anything tied to a **specific repair order, customer, part, dollar, or signature** → **Spine 2**.
- **The one sanctioned bridge:** `corpusEntries`. Field outcomes are *harvested* from Spine-2 sessions and *promoted* into Spine-1 knowledge. This is the compounding loop — the service manual writing itself — and it is the only place the two spines touch.

### Everything else is a view
| View | Reads | Writes |
|------|-------|--------|
| Diagnostic (topology engine) | Spine 1 | Spine 2 (`tech_outcomes`, `sessionEvents`) |
| Living service manual | Spine 1 (incl. field-outcome distribution on `corpusEntries`) | — |
| Estimate / Invoice | Spine 2 | Spine 2 |
| Shop board / advisor counter | Spine 2 | Spine 2 |
| Parts queue | Spine 2 (line-items) | Spine 2 |
| Customer status link | Spine 2 (read-only subset) | Spine 2 (one approval write) |

**No third spine is introduced anywhere in this blueprint.**

---

## 2. Role → View Map

Seven roles. Each lives in **one** view and reaches its job in the **fewest taps** — honoring the doctrine's *"Two taps to the answer, gloves on"* (`customer-interaction-doctrine.md:65`).

| Role | The one view they live in | Job-to-be-done | Tap budget |
|------|---------------------------|----------------|-----------|
| **Owner / Owner-Tech** (the buyer) | **Shop Board** — every open RO with its live status + any stuck/gated jobs flagged | See every job's state and jump into a stuck one *without hovering over his guys* | Glance → 1 tap into any job |
| **Service Writer / Advisor** | **Front Counter** — intake + build estimate + send authorization + customer comms | Take the call, turn it into an authorized RO | 2 taps: phone → authorized estimate sent |
| **Master Tech (the "Gate")** | **Verify view** — the diagnostic topology with confidence + tappable citations | Confirm-or-redirect a call; *catch one fabricated source and he kills it shopwide* (`customer-interaction-doctrine.md:27`) | 2 taps to the cited answer |
| **B-Tech (the "Climber")** | **Bay view** — guided diagnostic walk, one fully-specified directive at a time | Confirm his own call without looking dumb; never act on an ambiguous directive (a wrong call is *his* free comeback, `customer-interaction-doctrine.md:30`) | 2 taps, gloves on |
| **Parts** | **Parts Queue** — parts line-items needing sourcing across all authorized ROs | Source / price / receive parts for authorized jobs | 1 tap per line |
| **Customer** (external) | **Status Link** — read-only RO status + one-tap estimate approval | See what's happening and approve the work | 1 tap to approve |
| **Curator** (back-office, built) | **Curator Console** (`app/curator/*`, already shipped) | Keep the knowledge graph honest, close gaps, author flows | (existing) |

Every tech-facing view inherits the directive-clarity contract (§5). Persona grounding: the Gate / Climber / Owner-Tech are the *evidenced* roles in `customer-interaction-doctrine.md:24–30`; Advisor and Parts are named in the brief and represented here as views, with their role representation deferred to **D5(a)**.

---

## 3. Data-Model Delta — Reuse vs. Add

### Reuse / extend (already built — do not rebuild)
| Table | Role in the platform | Change |
|-------|---------------------|--------|
| `sessions` | The diagnostic work product. The RO **wraps** this; it is not replaced. | None to ship Phase 1. RO references it. |
| `sessionEvents` | The decision timeline (curator-auditable). | None. |
| `diagnosticSessions` + `tech_outcomes` | Proof-of-fix ledger + per-test measured values — *already_built*. **Reconciliation note:** `tech_outcomes` exists in migration 0021 but is **not exported from `schema.ts`** — a build session should export it before relying on it (cleanup, not new design). | Export `tech_outcomes`; otherwise reuse. |
| `corpusEntries` | The field-outcome compounding loop — the "service manual" writing itself. | None. Phase 5 adds a *read view*, not a schema change. |
| `followUps` | 7d/30d comeback tracking — feeds the misdiagnosis-cost metric. | None. |
| `customers`, `vehicles`, `shops`, `profiles` | People + assets + roles + the shop-license billing unit. | Extend **only when a phase needs it** (e.g. customer billing address at invoice time). Trivial column adds, no FK conflict. |

### Add (net-new — the repair-order layer; every add justified)
| New table | Carries | Why an existing table can't carry it |
|-----------|---------|--------------------------------------|
| `repairOrders` | The RO header: `sessionId` FK, lifecycle status (`estimate / authorized / awaiting_parts / in_repair / inspecting / complete / invoiced / paid`), customer PO, authorization ref. | `sessions.status` is **diagnostic-only** (`open/closed/declined/deferred`). An RO has a *repair-and-billing* lifecycle a diagnostic session never models. |
| `roLineItems` | Labor **and** parts lines (unified, `kind` = `labor`/`part`): description, qty, rate/cost, amount, plus the **citation/source** for the directive that justified the line. | `sessions.outcome` is a single JSONB blob holding one *suggested* fix. A real estimate is many lines that must be **queried, summed, approved per-line** — JSONB can't be line-queried or per-line authorized. |
| `authorizations` | Customer approval of an estimate: who, when, how (tap/signature), which line-items. | No approval workflow exists. `sessions.curator_override_action` is a different concept (curator gate release, not customer authorization). |
| `invoices` | Tax, totals, terms, payment status for a **customer repair**. | `stripeCustomers` holds the *shop's SaaS subscription* metadata, not customer repair invoices. Different payer, different ledger. |

That is the entire delta: **four net-new tables**, all in Spine 2, all justified, no third spine. Parts and assignment stay folded per **D5(b)/(c)** until a phase proves they need their own structure.

---

## 4. The Directive-Clarity Contract (the moat)

> The under-served moat: **no free-text-only directive reaches the bay.** Every actionable instruction a tech receives — a test step or a repair step — must carry, as **structured fields**, everything needed to act on it without ambiguity. This is what prevents a tech acting on an unclear instruction and damaging a part.

### The contract — every directive MUST carry:
| Field | Definition | Where it lives today |
|-------|-----------|---------------------|
| **Scope** | Exactly what and where: component, pin, back-probe location. | `components`, `componentPins.probe_location`, `testActions.description` |
| **Expected spec** | Expected reading + unit + tolerance/range; numeric where measurable. | `testActions.expected_value / expected_unit / expected_tolerance / expected_observation` |
| **Safety / torque / sequence** | Where relevant: torque spec, tightening sequence, safety precaution. | **Net-new structured field** on the directive (extend `testActions` or a directive object) — currently absent. |
| **Citation** | A tappable source. Per doctrine, the excerpt (verbatim quote) must be non-empty unless `evidenceGrade='unverified'` (`MASTER-BUILD-BRIEF.md:46`, *"source-span verification strips any extracted field whose verbatim quote isn't found in the source"*). | flows `Citation` type; `corpusEntries`; retrieval `[ref:item_id]` markers |
| **If-wrong branch** | What to do when the reading is out of expected — the next action. | `branchLogic.condition / verdict / next_action / routesToTestActionId` |

### Where it's enforced
A **single directive-renderer guard** that **refuses to render** any step missing a required field — and instead shows a visible *"not yet captured"* gap (`MASTER-BUILD-BRIEF.md:29`, *"'Not yet captured,' not 'unknown.'"*), never a fabricated value. Enforced in **two places**:
1. **Authoring time** — curator flow validation / publish (`lib/curator/flow-validation.ts`) rejects an incomplete directive.
2. **Runtime** — the render guard at the bay refuses non-compliant directives.

**This contract is the generalization of the Phase-0 fix (D2).** The live decline-or-defer breach is *exactly* a directive rendered with fabricated, uncited values. Fix that screen first (Phase 0), then enforce the same contract everywhere (Phase 3). The doctrine also already specifies the measurement half of this: *"Structured measurement with live expected-vs-actual… the tool diffs the read against the spec it already has"* (`customer-interaction-doctrine.md:90`) — today measurements are free-text with no diff (`:161`). The contract closes that gap.

---

## 5. Phased Roadmap

Each phase is independently shippable and independently verifiable. **The topology engine is threaded through every phase — it is the "diagnose" stage of every RO; no phase rebuilds it.**

| Phase | What ships | Ship + verify (one line) | Topology thread |
|-------|-----------|--------------------------|-----------------|
| **0 — Trust debt** (gated on D2) | Wire real session data into the decline-or-defer gate; delete hardcoded confidences/curator-names/sources. | *Verify:* the live gate shows the session's real confidence + real sources, or an honest "not yet captured" — never a design-preview default. | Restores honesty on the exact screen that presents the topology's verdict. |
| **1 — RO header** (small; one session) | `repairOrders` table FK→`sessions`; **Owner "Shop Board"** listing every job as an RO with a status beyond diagnostics. | *Verify:* create a session → it appears on the Shop Board as an RO with correct status transitions. | The RO's "diagnose" stage *is* the existing topology session — zero new engine. |
| **2 — Estimate + authorize** | `roLineItems` + `authorizations`; **Advisor "Front Counter"** turns a closed diagnosis into a priced estimate + customer approval link. | *Verify:* estimate sums correctly; customer approval flips RO → `authorized`. | Each line-item carries the citation from the diagnostic step that justified it. |
| **3 — Directive-clarity at the bay** (the moat) | The directive-renderer guard; structured measurement field (numeric + unit + live expected-vs-actual diff); refuse-to-render on missing fields. **B-Tech "Bay view."** | *Verify:* a directive missing a citation renders "not yet captured," never a fabricated value; a measurement diffs against spec live. | Directives are read straight from `testActions` / `branchLogic` nodes. |
| **4 — Parts + Invoice + Customer link** | Parts queue across ROs; `invoices` (tax/total/terms); read-only customer **Status Link**. | *Verify:* invoice total = sum of authorized lines + tax; parts status flows; customer sees live status. | The line a part fulfills traces back to the topology directive that called for it. |
| **5 — Living service manual + comeback loop** | A *read view* of `corpusEntries` field-outcome distribution as the "service manual" read of Spine 1; comeback rate wired from `followUps` into metrics. | *Verify:* a topology node shows its N-tech confirmed value distribution; comeback rate visible per pattern. | The same graph, read as a manual — the compounding loop made visible. |

Phase 1 is intentionally small enough to ship in a single build session.

---

## 6. Metric Instrumentation

| Outcome goal | What's measured | Data source | Baseline → target |
|--------------|-----------------|-------------|-------------------|
| **1. Productivity ↑** | RO cycle time (created → invoiced); tool-switches per job (near-zero by design — one spine) | `repairOrders` timestamps (Phase 1); switches are app-internal | Baseline = current session open→close span; target = ↓ cycle time, ~0 tool-switches |
| **2. Diagnostic accuracy ↑** | Right-repair rate = % closed with `symptoms_resolved=yes` **and** no comeback; every call confidence-gated + cited | `sessions.outcome.verification` + `followUps` + `diagnosticSessions.final_verdict` | Baseline from existing closed sessions; target ↑ (carry "never guess / cited or it didn't happen") |
| **3. Misdiagnosis cost ↓** | Comeback rate + free-comeback dollars | `followUps` (7d/30d `comeback_recorded`) + `roLineItems` flagged warranty/no-charge | Baseline = current comeback rate; target ↓ dollars |
| **4. Accidental-damage from unclear directives ↓** | Count of directives rendered without the full §4 contract (target = **0**) + tech-reported damage/ambiguity flags | Directive-renderer guard logs (net-new, Phase 3) + a tech report flag | Baseline = today (no enforcement; fabrications live) → target = **0 non-compliant directives reach the bay** |

---

## 7. What This Blueprint Deliberately Does NOT Do
- No application, library, or migration code. No schema changes. No build phase started.
- Does not re-architect the working topology engine — it threads it through, untouched.
- Does not introduce a third spine of truth (and requires written justification if any future feature proposes one).
- Does not copy any OEM/licensed manual content — the graph generates uncopyrightable facts only; the doctrine holds.

---

*Build session entry point: rule on D1–D5 above, then start at Phase 0 (if D2 = yes) or Phase 1. Every phase has its own ship+verify line — pick it up and go.*
