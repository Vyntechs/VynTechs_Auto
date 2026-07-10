# Shop OS — Spec & Phased Implementation Plan

**Date:** 2026-07-10 · **Rev 3** — rev 2 (owner feedback): auto-order removed entirely; quick-quote door first-class; building opened to every role; canned jobs. Rev 3: audited claim-by-claim against `main` @ `54921a4` and confirmed accurate; session protocol + parallel-worktree lanes added (§11); AGENTS.md repointed here.
**Status:** **ACTIVE PLAN — the single source of truth for shop-OS work.** Future development sessions resume from §11. No code in this change; spec + plan only.
**Scope:** Turn Vyntechs into the operating system for an automotive shop — built universally, dialed in against our shop (2 manager/owners, 3 techs) as the first tenant. The diagnostic engine is the centerpiece and does not change.

---

## ⚠️ The referenced audit does not exist in this repo

The task pointed at `docs/strategy/2026-07-10-shop-os-audit.md` as the baseline. That file is not in the working tree, not on any branch, and not anywhere in git history (nothing matching `*audit*` was ever committed). The most likely explanations: it was written in a session that never pushed, or it lived in the internal-notes area that PR #111 stripped before the repo went public (`HANDOFF.md`, `tasks/`) — though the strip commit shows no audit file either.

Rather than quietly working around it, this doc says so plainly and **reconstructs the audit as §1** from the actual code: schema (`lib/db/schema.ts`), routes (`app/api/*`, `app/(app)/*`), the flow map (`docs/flow.md`), the customer-interaction doctrine (`docs/strategy/2026-05-29-customer-interaction-doctrine.md`), the diagnostics brief (`docs/interactive-diagnostics/MASTER-BUILD-BRIEF.md`), and `README.md`. Every claim below is grounded in a file that exists today. If the original audit surfaces and contradicts something here, reconcile before building Phase 1.

One real conflict to name up front: **`MASTER-BUILD-BRIEF.md` §1 explicitly vaults shop-management features, parts ordering, and the command-center dashboard** ("do NOT build now"). This plan un-vaults them — on the owner's explicit instruction, which supersedes the brief. The brief's *doctrine* (never guess, cited-or-it-didn't-happen, bay-is-the-boss, no theater) is not un-vaulted; it governs every surface below. The brief's §1 was amended 2026-07-10 with a pointer to this doc so the two don't contradict silently; the brief still governs the engine itself.

---

## 1. Reconstructed baseline — what exists vs. what a shop OS needs

### 1.1 What exists (and is good)

```
DIAGNOSTIC ENGINE  (the centerpiece — untouched by this plan)
  │
  ├── AI tree line: intake → 2-rung retrieval → tree engine → risk+confidence
  │   gate → lock diagnosis → repair coaching → validated outcome close
  │   → corpus promotion → 7d/30d comeback follow-ups     (docs/flow.md)
  │
  ├── Interactive topology line: platform+symptom → graph-served wiring
  │   diagram, AI out of the hot path, curator flows/wizard, research runs
  │
  └── Calibration: per-cell thresholds, weekly advisory refit, drift alerts

SHOP LAYER  (what exists around the engine today)
  │
  ├── Tenancy: shops → profiles → customers → vehicles → sessions,
  │   Stripe per shop, closed-by-default paywall (lib/auth-access.ts)
  ├── Roles in practice: 'tech' | 'owner' (text column). Self-signup ⇒ owner,
  │   invite ⇒ tech. Curator is a separate axis (isCurator / founder email).
  │   'advisor' appears ONLY as advisorProfileId in lib/intake/session.ts.
  ├── Intake, two flows:
  │   ├── Counter intake (components/screens/counter-intake.tsx, flag
  │   │   NEXT_PUBLIC_DESKTOP_INTAKE_ENABLED) — customer/vehicle search,
  │   │   REAL tech pre-assignment w/ workload (lib/intake/team.ts),
  │   │   REAL NHTSA VIN decode (lib/intake/decode-vin.ts) — but the camera
  │   │   toggle + auto-save footer are fake (doctrine Appendix C).
  │   └── Tech quick path (components/intake/new-session-form.tsx) — good.
  ├── Sessions: tech-owned (techId NOT NULL), diagnostic-only, typed JSONB
  │   intake/tree/outcome, append-only session_events audit
  └── PWA shell: manifest.ts + service-worker registration (web-push ready)
```

Two details worth flagging because the plan builds on them:

- `POST /api/intake/submit` already accepts `assignedTechId` (validated cross-shop) and `complaint.{whenStarted, howOften, authorized}` — but `createSessionFromIntake` **drops everything except `description`**. The richer complaint the advisor types today never lands anywhere. The ticket entity in Phase 1 finally gives those fields a home.
- `createSessionFromIntake` already supports a **pick-existing customer/vehicle path** (`existingCustomerId`/`existingVehicleId`). That is exactly the seam the job layer needs to spawn sessions without touching the engine.

### 1.2 What a shop OS needs that does not exist — at all

| Capability | Today | Evidence |
|---|---|---|
| Repair order / ticket / job entity | **None** — a diagnostic session is the only unit of work | `lib/db/schema.ts` (38 tables, none of them RO/job/quote) |
| Non-diagnostic work path (oil change, brakes) | **None** — every intake generates a diagnostic tree or topology | `app/api/intake/submit/route.ts` |
| Quote / estimate (parts + labor lines, totals, tax) | **None** — closest is `OutcomePayload.partInfo`, one part with cost, recorded *after* work | `lib/db/schema.ts:103-112` |
| Parts vendors (price/availability/ordering) | **None** | no vendor code anywhere |
| Customer communication (SMS/email/approval) | **None** — customers have name/phone/email and are never contacted | grep: no twilio/sms/mail |
| Notifications (any kind, any role) | **None** | no notifications table/code |
| Skill tiers / claimable open jobs | **None** — sessions are assigned at creation, `techId NOT NULL` | `lib/db/schema.ts:117` |
| Advisor role | **Assumed, never built** | doctrine Appendix A |
| Customer-facing story | **None** — `generateDeclineLanguage` writes customer-facing *decline* copy; nothing sells approved work | `lib/gating/*` |
| Payments / invoicing | **None** (Stripe is SaaS billing per shop, not customer payments) | `lib/stripe.ts` |

The shape of the gap is consistent: **the product is a diagnostic instrument, not yet an operating system.** Everything upstream of the tech (intake → assignment) exists in embryo; everything downstream of the diagnosis (story → quote → approval → parts → repair tracking → delivery) does not exist.

---

## 2. Design principles

1. **The engine is load-bearing and frozen.** No schema change to `sessions`, `session_events`, `artifacts`, corpus, calibration, gating, retrieval, or topology tables. No behavior change to `lib/ai`, `lib/gating`, `lib/retrieval`, `lib/corpus`, `lib/diagnostics`, `lib/flows`. The OS layer *wraps* the engine: new tables point at `sessions.id`; nothing inside the engine points out.
2. **The ticket is the spine; the session is an attachment.** A repair order (ticket) holds jobs; a job *may* hold a diagnostic session. "No diagnostic needed" is the absence of a session, not a special mode of one.
3. **Doctrine applies to customers too.** The customer story and approval page obey the same rules the tech UI is held to: every claim carries its evidence, no theater, no fabricated urgency, verdict first with proof one tap beneath (doctrine §2, §5).
4. **Statuses over pipelines.** Real shops run out of order (quote before assignment, approval before claim, parts before diagnosis on a known-good complaint). Jobs carry two independent axes — work state and approval state — instead of one forced sequence.
5. **Human-confirmed money.** Nothing that spends the shop's or the customer's money fires silently: quotes are sent by a person, parts orders are confirmed by a person, stale prices are re-checked at approval.
6. **Universal, tenant-flagged.** Every new table carries `shopId` with the existing conventions. Risky integrations (SMS, vendors) are enabled per shop; our shop turns them on first.
7. **House conventions hold.** Handler-in-`lib/` + thin route shim, `db: AppDb` first arg, pglite tests, 422+`{error, feedback}` for AI validation, migrations via Supabase MCP, tokens for styling, no emoji in product UI.

---

## 3. The spine — end-to-end flow

Target flow, mapped to the nine steps in the request. `[NEW]` marks new surfaces; everything under `SESSION` is the existing engine, byte-for-byte.

**Three doors into a ticket, all landing in the same structure.** The tree below draws the full flow, but most tickets won't walk every step of it — that's by design, not exception handling:

```
DOOR A  Full counter intake — vehicle arrives with the customer, concern
        captured in detail, jobs assigned or opened. The tree below.
DOOR B  Tech quick path — a tech starts a diagnostic directly (exists
        today); the ticket+job wrapper is created automatically behind it.
DOOR C  Quick ticket/quote — ANY role, one screen: customer, vehicle,
        what they want, lines. No assignment, no approval ceremony, no
        concern narrative required. This is the door for the customer
        request ("just do my brakes"), the phone-shopper estimate, the
        counter quote, and every edge case that doesn't need the normal
        flow. The normal flow is available to that ticket later if the
        job turns out to need it — never the other way around.
```

```
1 INTAKE  (door A shown; doors B/C skip straight to their point)     [NEW-ish]
  │  Customer + vehicle (search / VIN decode — already real)
  │  Ticket created: RO number, customer concern in full detail
  │  Jobs added to ticket, each one:
  │    kind = diagnostic | repair | maintenance    ← "no diag" first-class
  │    required skill tier (defaulted by kind, overridable)
  │    pre-assigned to a tech ─── or ─── left open for grabs
  │    pre-approved at counter? (oil change: customer already said yes)
  │
2 ASSIGNMENT                                                          [NEW]
  ├── pre-assigned → lands in that tech's queue
  └── open → visible to every profile with skillTier ≥ required tier
        └── claim (atomic; race-safe; tier-gated)
  │
3 TECH COMMAND CENTER  (My Jobs / Open Jobs)                           [NEW]
  │  Card answers at a glance: what vehicle · what's wrong · mine or open
  ├── job.kind = diagnostic → tap →
  │     │
  │     ▼
  │   SESSION  ═══ EXISTING ENGINE, UNCHANGED ═══
  │   created lazily on first tap via createSessionFromIntake
  │   (existingCustomerId/VehicleId path, assignedTechId = this tech,
  │   complaint = ticket's full concern text — richer than today)
  │   tree line or topology line, gate, lock, repair, outcome — as today
  │     │
  │     └── diagnosis locked / session closed
  │           │
  4           ▼
  │   CUSTOMER STORY generated onto the job                            [NEW]
  │   inputs: locked root cause, evidence trail, artifacts, confidence
  │   advisor reviews/edits — the deal-closer surface, not an afterthought
  │
  └── job.kind = repair | maintenance → tap → simple work view          [NEW]
        start → notes/photos → done  (no AI, no session, no ceremony)
  │
5 QUOTE BUILT on the ticket                                            [NEW]
  │  parts lines + labor lines + tax, entered by tech or manager
  │  diag job's authorized fee finally persisted as a labor line
  │
6 PARTS PRICING/AVAILABILITY                                           [NEW]
  │  vendor adapter layer: O'Reilly First Call (launch), Tri State (post),
  │  RepairPal repositioned as labor/fair-price benchmark — see §6.5
  │  diagnosis partInfo seeds the vendor search
  │
7 APPROVAL                                                             [NEW]
  │  advisor notified quote is ready → calls customer, marks approved
  │  ─ OR ─ short SMS with secure link → hosted approval page
  │  page = the story + photos + per-job approve/decline + ask-a-question
  │  approval audit: who/when/how/what-snapshot
  │
8 CONTEXTUAL NOTIFICATIONS + PARTS ORDERING                            [NEW]
  │  approved → assigned tech (push) + order queue for parts-capable role
  │  order queue re-checks live price/availability vs. quote snapshot
  │  → unchanged: one-click confirm order   → changed: flagged, never silent
  │  parts received → tech nudged
  │
9 DO THE WORK → ticket tracked to done → delivered → closed
```

**The one seam with the engine** (worth stating precisely, because it's the whole trick): a diagnostic job stores `sessionId NULL` until the assigned tech taps it. At that moment the OS calls the *existing* `createSessionFromIntake` with the *existing* pick-existing path and the *existing* `assignedTechId` override, passing the ticket's full concern text as the complaint. From that point `routeForSession` owns the experience exactly as today (tree, topology, gate, decline, lock, repair, outcome). The engine never learns tickets exist. When the session locks/closes, the OS reads *outputs* the engine already produces — `rootCauseSummary`, `session_events`, `artifacts`, `outcome.partInfo` — to seed the story and the quote. Read-only taps, no writes into engine tables.

---

## 4. Roles, the two-hat problem, and skill tiers

### 4.1 Role model

`profiles.role` (text) grows from `tech | owner` to:

```
tech      wrench: command center, works jobs — and creates tickets and
          builds quotes like everyone else (see the principle below)
advisor   counter: assign/reassign, send quotes to customers, order parts,
          close tickets
parts     optional seat: vendor lookups + order queue only (big-shop role)
owner     everything advisor can do + team, billing, rates, settings
```

**The permission principle: building is open to everyone; only customer-facing sends and money commits are gated.** Any profile — tech, advisor, parts, owner — can create a ticket, add jobs, and build a quote, from any door (§3). At a 5-person shop, gatekeeping *entry* of work is pure friction with zero protective value; what actually needs a gate is the moment something leaves the building or spends money. Concretely, the only role-gated actions: **send quote to customer** and **close/cancel ticket** (`advisor|owner`), **place parts orders** (`parts|advisor|owner`), **assign/reassign someone else's job** (`advisor|owner`), settings/rates/team (`owner`). Capability checks are role-set helpers, mirroring how `canCurate` already works — not scattered `role ===` comparisons. The `parts` role exists so a bigger shop can hire a dedicated parts person, but no capability requires it — per the requirement, parts duties fall to advisor/owner by default. Curator/founder stays its own axis, untouched.

### 4.2 Two hats: `skillTier`, not multi-role

The two-hat problem (Brandon = admin + lead tech) is solved with **one nullable column**, not a roles array:

```
profiles.skillTier: integer | null      job.requiredSkillTier: integer
  3 = A-tech  diag / driveability / electrical     (diagnostic default)
  2 = B-tech  general repair                       (repair default)
  1 = C-tech  maintenance                          (maintenance default)
  null = does not wrench (never claimable, never in tech pools)
```

Anyone with a non-null `skillTier` — regardless of role — shows up in the assignment selector, sees the command center, and can claim open jobs at or below their tier. A multi-role array was considered and rejected: it complicates every permission check forever to model exactly one real overlap ("admin who also wrenches"), which one integer models completely.

**Our shop's seat map (first tenant):**

| Person | role | skillTier | What they see |
|---|---|---|---|
| Brandon | `owner` | 3 | Everything + command center; claimable A-tech |
| Manager/owner #2 | `owner` | null (or tier if he wrenches) | Advisor surfaces + board |
| Tech 2 | `tech` | 2–3 per ability | Command center |
| Tech 3 | `tech` | 1–2 per ability | Command center |

Nobody at our shop holds `advisor` or `parts` day one — owners cover both. The roles exist so the model is universal, not because we need the seats.

### 4.3 Claiming rules

- Claim is atomic: `UPDATE ticket_jobs SET assigned_tech_id = $me, claimed_at = now() WHERE id = $job AND assigned_tech_id IS NULL AND $myTier >= required_skill_tier` — no double-claims, tier enforced in the write, not just the UI.
- Advisors/owners can always assign directly (pre-assignment already exists in counter intake; it gains the tier check as a *warning*, not a block — a manager deliberately stretching a B-tech on a job is a management decision; a B-tech self-claiming A-work is not).
- Unclaim/reassign: advisor/owner only, logged.

---

## 5. Data model delta — complete, in one place

All new tables; `sessions` and every engine table untouched. Money is integer cents. All tables carry the usual `createdAt`/indexes; FKs shop-scoped like existing tables.

```
shops               + laborRateCents, taxRatePct, nextTicketNumber (race-safe
                      RO numbering via UPDATE..RETURNING), smsEnabled,
                      partsVendorsEnabled  (per-tenant flags)

profiles            + skillTier int null          (role vocabulary grows;
                                                   column type unchanged)

tickets             id, shopId, ticketNumber, customerId, vehicleId,
                    concern text (the FULL detail — finally persisted),
                    whenStarted, howOften, authorizedCents (diag fee OK'd
                    at counter — today's dropped intake fields get a home),
                    status: open | closed | canceled,
                    createdByProfileId, createdAt, closedAt
                    -- board stage is DERIVED from jobs on read, not stored

ticket_jobs         id, ticketId, title, kind: diagnostic|repair|maintenance,
                    requiredSkillTier int, assignedTechId null→profiles,
                    claimedAt, sessionId null→sessions  (THE seam; nullable,
                    set only for diagnostic jobs once started),
                    workStatus:  open | in_progress | done | canceled
                    approvalState: pre_approved | pending_quote | quote_ready
                                   | sent | approved | declined
                    customerStory text null, storyMeta jsonb
                    (generatedAt, fromSessionId, editedBy/At),
                    storyArtifactIds uuid[],
                    workNotes text  (simple-path work log),
                    approvedAt, approvedVia: page|phone|in_person, approvedBy

job_lines           id, jobId, kind: part | labor | fee, description, sort,
                    -- part fields (null unless kind=part):
                    partNumber, brand, quantity, unitCostCents,
                    vendorAccountId null, vendorSnapshot jsonb
                    (price/availability/location/fetchedAt),
                    partStatus: proposed | needs_order | ordered | received
                               | installed | returned,
                    orderedAt/By, receivedAt,
                    -- labor fields (null unless kind=labor):
                    hours numeric, rateCents,
                    -- all kinds:
                    priceCents (extended customer price), taxable bool,
                    source: manual | vendor_quote | diagnosis_seed | guide

canned_jobs         id, shopId, title, kind: repair | maintenance,
                    defaultRequiredSkillTier, defaultLines jsonb
                    (template rows: description/qty/hours — priced at
                    apply time from shop rate, then hand-adjusted),
                    sort, retiredAt

vendor_accounts     id, shopId, vendor: oreilly | partstech | tristate,
                    displayName, credentials jsonb, mode: api | punchout,
                    enabled

quote_sends         id, ticketId, tokenHash, channel: sms | link | phone,
                    toPhone, sentByProfileId, sentAt, expiresAt, revokedAt,
                    totalsSnapshot jsonb   (what the customer actually saw —
                    approval binds to THIS, not to live rows)

quote_events        id, quoteSendId, jobId null, kind: delivered | viewed |
                    approved | declined | question, body text (question),
                    meta jsonb (ip, ua), createdAt        -- append-only

sms_log             id, shopId, ticketId null, direction, toPhone, body,
                    providerSid, status, errorCode, createdAt

notifications       id, shopId, recipientProfileId, kind, ticketId, jobId,
                    title, body, readAt, createdAt

push_subscriptions  id, profileId, endpoint, keys jsonb, createdAt
```

Integrity rules that matter:

- Editing any `job_lines` row of a job in `approvalState='sent'` reverts it to `quote_ready` and requires re-send — a customer never approves rows that changed under them; what they approved is pinned in `totalsSnapshot`.
- `quote_events` and `sms_log` are append-only (same posture as `session_events`) — they are the legal record of authorization. Store approval with timestamp + IP + the snapshot; most states require written/electronic authorization records for repair work.
- Legacy sessions (pre-Phase-1) have no ticket; every view handles that. Post-Phase-1, the tech quick path auto-wraps its session in a ticket+job so nothing new is ticketless.

---

## 6. Open decisions — recommendation and reasoning on each

### 6.1 SMS approach — **short SMS + hosted approval page. Not story-by-text.**

Options evaluated:

| | Raw SMS/MMS (story in the text) | Short SMS + secure link to hosted page (Tekmetric-style) |
|---|---|---|
| Carries full story + photos | Poorly — 8–12 SMS segments + 2–4 MMS per quote; photos recompressed to junk | Fully — real typography, full-res photos, per-job layout |
| Approve/decline/question | Reply-parsing ("YES to approve") — fragile, no per-job granularity | Buttons per job; question box; events captured |
| Legal audit trail | Reply text only | Snapshot + timestamp + IP + per-job record (`quote_events`) |
| Cost per quote (see math) | ~$0.15–0.25 | **~$0.02–0.04** |
| Cost at our volume (~100–150 ROs/mo) | ~$20–35/mo | **~$10–20/mo all-in** (mostly the fixed campaign fee) |

Cost math, from current published pricing (verify at build time): one-time A2P 10DLC registration — brand $44 (standard business; $4 sole-prop), campaign vetting $15; then $1.50–$10/mo campaign fee; outbound SMS ≈ $0.0079/segment + $0.003–0.005/segment carrier surcharge ([Twilio A2P fees](https://help.twilio.com/articles/1260803965530-What-pricing-and-fees-are-associated-with-the-A2P-10DLC-service-), [Twilio US SMS pricing](https://www.twilio.com/en-us/sms/pricing/us)). A quote send is 1–2 segments ("Yukon Motor Sports: your estimate for the 2016 F-250 is ready — review and approve: {link}"), plus a reminder and a confirmation ≈ 4–6 segments per RO ≈ **about a penny per message, a nickel per RO**. At one-shop volume *either* option is cheap in absolute dollars — the honest reasons to pick the link are product and legal, not pennies: the story renders as a designed surface instead of a text wall, approval is per-job and auditable, a corrected quote updates the same link instead of re-spamming, and at multi-tenant scale the economics hold (per-RO cost is flat while story-by-MMS scales linearly with photos).

Implementation notes baked into Phase 5: provider Twilio (Telnyx is marginally cheaper per segment; Twilio's docs/tooling win at our scale — revisit if volume ever makes the delta real). **Local 10DLC number, not toll-free** — a shop texting from an 833 number reads like a warranty scam; the local area code is part of the trust. Register **our shop's brand/campaign directly now** and defer the multi-tenant ISV registration model (per-tenant sub-brands) until tenant #2 exists — no speculative compliance architecture. Campaign vetting takes days-to-weeks ([Twilio vetting FAQ](https://support.twilio.com/hc/en-us/articles/11587910480155-A2P-10DLC-Campaign-Vetting-FAQ)), so the paperwork starts during Phase 3, not Phase 5.

The bar from the request stands: if the story does its job, the page needs no follow-up — just the approve tap. The question box exists for the exception, and lands as a quiet advisor notification, not a 2-way SMS thread (deliberately not built in v1).

### 6.2 Auto-order vs. reminder — **DECIDED (owner, 2026-07-10): auto-order is removed from the plan entirely. Human-confirmed one-click order with a staleness re-check.**

On approval, every vendor-sourced part line on the approved job goes into an **order queue** for parts-capable roles. The queue re-runs the vendor lookup live and diffs against the line's `vendorSnapshot`:

- Price/availability unchanged → line shows green, **one click places the order** (or opens the vendor punchout cart pre-filled, depending on integration mode — §6.6).
- Price up, or availability changed → line is flagged with the delta and blocks one-click until a human re-prices or re-sources. Never silently ordered, never silently absorbed.

Reasoning: ordering is where the shop commits money against a quote a customer approved; wrong-part, core charges, will-call vs. delivery, and vendor substitutions all live in that moment, and a 5-person shop confirms an order in under 30 seconds. Automation buys ~30 seconds and risks a wrong $400 part on the shelf. **Auto-order is not deferred — it is out of the plan.** The one-click confirm above is the floor of ceremony ordering will ever have; no code path places a vendor order without a human tap.

### 6.3 Skill-gated open jobs — **yes, with one integer, and no skills matrix**

As specced in §4.2/§4.3: `skillTier 1–3` (C/B/A — the vocabulary techs already use), claim gate enforced in the atomic claim write, tier defaulted by job kind and overridable by the advisor at intake. Managers can deliberately assign below tier (warning, not block); self-claim cannot.

Pushing back on the fancier versions before they're proposed: no per-system skill matrices ("brakes: 3, driveability: 1"), no certifications tracking, no training progressions. Three techs. The lead tech knows who can do what; the tier is a guardrail against the one real failure mode (a C-tech grabbing an intermittent-electrical A-job off the open board), not an HR system.

### 6.4 The non-diagnostic path — **a job kind, not a mode; the session simply doesn't exist**

`kind: repair | maintenance` jobs never touch the engine: no session, no tree, no topology, no AI cost. The tech's simple work view is start → notes/photos → done, and the quote machinery (lines, story, approval) is *identical* — a brake job gets a human-written or template story line, not an AI narrative. Three design commitments make this genuinely first-class rather than a stub:

1. **Approval can precede everything.** A known-good complaint ("customer wants front brakes, quoted $489 on the phone") can be quoted and marked `pre_approved` at intake, before any tech is assigned. Statuses-not-pipelines (§2.4) is what makes this fall out for free.
2. **An escalation seam, cheap and unceremonious.** The real shop pattern is the oil change that finds a leaking valve cover. From a simple job's work view: "found something → add diagnostic job to this ticket" — one tap, creates a `diagnostic` job on the same ticket (open or self-assigned), which then runs the full engine → story → quote-addendum → re-approval flow. The upsell inherits all the trust machinery.
3. **A quick door that skips the ceremony entirely (door C, §3).** One screen, any role: pick-or-create customer (search already exists), pick-or-create vehicle (VIN decode already exists), what they want, lines. It auto-creates the ticket and a single job underneath — the user never thinks about "jobs" unless they add a second one. No assignment, no concern narrative, no approval state beyond draft. This covers the customer request, the phone-shopper estimate ("how much for brakes on a 2016 F-150?" → priced quote in under a minute, texted or read aloud, and if they never call back it's just a recorded estimate — the board derives an "Estimate" stage from *no job approved or started*, no extra schema), and every edge case that doesn't fit the normal flow. Structure stays uniform; the friction lives only in the UI.

**The friction-killer for door C: canned jobs.** A shop-scoped `canned_jobs` table — title, kind, default lines (parts descriptions, labor hours at shop rate) — so "Front brakes," "Synthetic oil change," "4-tire mount & balance" land as a priced job in two taps, then get adjusted, not built. This is the single highest-leverage speed feature for the exact case that skips diagnosis, and it's one table and a picker. Deliberate restraint: no nested packages, no per-vehicle pricing matrices, no fluid-capacity lookups — a canned job is a starting template, and the human finishes it.

### 6.5 RepairPal — **pushback: it is not a parts vendor. Reposition as the labor-time / fair-price source.**

The request lists RepairPal as a launch parts integration alongside O'Reilly. RepairPal doesn't sell parts and doesn't expose a parts API — it's a consumer fair-price estimator (industry-standard parts MSRP + agreed labor times + a local labor-rate model) and a certified-shop network, with a widget for shop sites ([RepairPal estimator](https://repairpal.com/estimator), [how it works](https://news.repairpal.com/164160-repairpal-brings-truth-and-transparency-to-auto-and-service-repair-with-their-new-fair-price-estimator)). No public parts-ordering API exists to integrate.

What RepairPal is *actually* good for in this flow: **labor hours and a price-sanity benchmark in the quote builder** — "front pads + rotors, 2019 Silverado: RepairPal fair range $431–$612" next to your quote total is a trust line on the approval page (especially if the shop is/becomes RepairPal Certified, which contractually pins quotes inside the fair range). Recommendation: drop RepairPal from the parts-adapter roadmap; add it in Phase 4 as a benchmark/labor-guide source (via their widget/certified program, or manual reference if no API access materializes). If what you meant was "RepairLink" (OEM parts ordering, OEConnection) or PartsTech itself, say so and Phase 4's adapter list adjusts — the adapter interface doesn't care.

### 6.6 Parts vendor integration route — **adapter interface + honest transport per vendor; manual entry is the floor**

The pattern mirrors `lib/retrieval/adapters/*`, which is already proven in this codebase: a `PartsVendorAdapter` interface (`searchParts(vehicle, query) → offers`, `refreshOffer`, `placeOrder?`), one adapter per vendor, everything degrades to manual entry.

Reality check per vendor:

- **O'Reilly First Call** has no self-serve public API; shop-management systems integrate either through O'Reilly's partner program ([O'Reilly Pro Integration Hub](https://integrations.oreillypro.com/) — 130+ SMS integrations, worth a direct ask via the shop's First Call rep) or through **PartsTech**, the aggregator purpose-built for this: free for shops, [free API for SMS developers](https://partstech.com/pricing/), O'Reilly account connections approved on their network, punchout UI that returns the cart to the RO ([PartsTech ordering API](https://www.vehicleservicepros.com/home/press-release/20997189/partstech-parts-ordering-api-allows-shop-management-system-integration)). **Recommendation: build the adapter interface, ship PartsTech as the first transport** (one integration → O'Reilly + WorldPac + NAPA + dozens more through a single API, at $0), *and* file the O'Reilly-direct partner application in parallel — if First Call direct API access comes through, it becomes a second adapter behind the same interface. The launch requirement "O'Reilly First Call, live price and availability" is satisfied either way; PartsTech is just the cheaper key to the same door.
- **Tri State** (post-launch): expect no API. The adapter interface's `manual` mode covers it day one (advisor keys price/availability from the phone call into the line, `vendorSnapshot.source='manual'`); if they turn out to run Nexpart/Epicor or similar, that's a transport swap later.
- **Manual entry is not a fallback, it's the floor.** The quote builder never blocks on vendor integration health — Phase 3 ships with manual lines only and is fully usable; Phase 4 adds live data into the same rows.

### 6.7 Where the diagnosis seeds the parts search

The engine already emits what's needed, in two places, no changes required: the locked diagnosis' recommended repair (in `treeState`) and `outcome.partInfo {name, oemNumber, aftermarket, cost}` at close. Phase 4 wires: "build quote from diagnosis" pre-fills a part line per recommended part (`source='diagnosis_seed'`) and fires the vendor search with `(vehicle year/make/model/engine + part name + oemNumber)`. The tech confirms fitment on the vendor result — the AI seeds the search, a human picks the part. That division of labor is doctrine-consistent (the engine never asserts a part number it can't cite; the vendor catalog is the citation).

---

## 7. Where I'm pushing back / explicit non-goals for v1

Named so they're decisions, not omissions. Each is cuttable *because* the ticket spine is designed to accept it later without rework.

1. **No appointments/scheduling module.** Your flow starts "when the vehicle arrives." Calendars are a different product; the ticket doesn't need one to work. Revisit only when walk-in reality demands it.
2. **No parts inventory/stock management.** Order-per-job only. Stocking oil filters is a spreadsheet problem until it isn't; do not build a warehouse system for a 3-bay shop.
3. **No customer payments/invoicing in v1.** The approved quote *is* the invoice content, and a printable/textable receipt view is cheap — but card-present payments, deposits, and merchant accounts are a Phase-7+ decision (likely Stripe Terminal, since Stripe is already in the stack). Taking money is the one flow where a half-built feature is worse than none.
4. **No 2-way SMS threading.** Questions come through the approval page into notifications. A full messaging inbox is Tekmetric's bloat; resist until real question volume proves the need.
5. **No dedicated parts seat required** (per your instruction) — the role exists, nothing depends on it.
6. **No DVI (digital vehicle inspection) module.** For diagnostic jobs, the session's evidence trail *is* the inspection — better than any checklist DVI on the market. Simple jobs get photo attach on the work log. A standalone templated-checklist DVI is a competitor checkbox, not a need of this flow.
7. **One labor rate + one tax rate per shop.** Line-level price overrides cover the exceptions. A rate matrix (diag rate vs. maintenance rate vs. euro rate…) is a settings screen nobody at a 5-person shop will open twice; add columns when a real tenant demands it.
8. **Approval granularity is the job, not the line.** Customers approve "Front brakes — $612," never pad-vs-rotor line items. Per-line approval doubles the UI and the legal surface for zero shop value.
9. **Ticket board stage is derived, not stored.** No hand-maintained kanban column that drifts from reality; the jobs' states *are* the stage. (At 5-person scale, computing it on read is free.)

One thing I am *not* pushing back on: treating the customer story as a real product surface. That instinct is right, and it's the piece none of the incumbents have — Tekmetric sends a quote; this sends *the case for the repair, with the evidence the engine actually gathered*. It gets its own spec section below and first-class treatment in Phase 3.

---

## 8. The deal-closer story — product spec (Phase 3's heart)

**Contract.** A generator in `lib/ai/customer-story.ts` (new file, Sonnet, same client/conventions as existing AI modules) consuming, read-only: the ticket concern (customer's own words), the locked `rootCauseSummary` + recommended repair, the observation trail (`session_events` — what was tested, what was found, what was ruled out), artifacts chosen by the tech (`storyArtifactIds`), confidence + the gate history, and `outcome.partInfo` when present.

**Output shape** (structured, so the approval page lays it out — not a text blob):

```
1. What you told us        — their complaint, mirrored in their words
2. What we found           — root cause, plain English, no jargon un-glossed
3. How we know             — the tests run and readings taken, each traceable
                             to a real session event; what we ruled OUT (the
                             trust move competitors can't fake — "we tested
                             the battery and alternator first so you don't
                             pay for parts you don't need")
4. What it means if waived — honest consequence, severity-calibrated,
                             NO fear-mongering (doctrine: no theater)
5. What we recommend       — the repair, tied to the quote's jobs
```

**Guards, same posture as the repair-phase field-stripper:** the generator cannot contradict the locked diagnosis, cannot introduce a part/claim absent from the session record, and the server strips any output field beyond the contract. Every "how we know" line must map to a `session_events` row — the story is *compiled from* evidence, not written about it. If the session record is thin, the story says less; it never pads.

**Human in the loop:** the story renders on the job for advisor review; edits are stored with editor + timestamp (`storyMeta`); regenerate is a button; the *sent* version is pinned in the send snapshot. Simple jobs get a template/manual story line, no AI.

**Bar:** reads in under 60 seconds on a phone; a customer who reads it should feel they'd already watched the tech work. If the story builds the trust it should, the only follow-up is the approve tap.

---

## 9. Notifications — the routing table (small on purpose)

Channel: in-app notification row always; web push (PWA already registers a service worker — `components/sw-register.tsx`) for the rows marked push. No internal SMS/email in v1. The rule: **push only what changes someone's next action; everything else is dashboard state.**

| Event | Who | Push? |
|---|---|---|
| Quote approved (any job) | Assigned tech; parts-capable roles (order queue) | Yes |
| Quote declined / question asked | Advisor/owner | Yes |
| Quote viewed | Nobody (visible on ticket timeline) | — |
| Parts received (marked by receiver) | Assigned tech of that job | Yes |
| Diagnostic session hit the confidence gate / deferred | Advisor (customer may need a call) | Yes |
| Job claimed / work started / work done | Nobody (board reflects it) | — |
| Quote ready to send (tech finished building) | Advisor/owner | Yes |
| Open job unclaimed > N hours | Advisor (digest, not push) | — |

Owners get nothing pushed by default; their surface is the board. Every push kind is per-profile mutable in settings later — but ship the defaults, not the settings screen.

---

## 10. The phased plan

Six phases. Each ships something our shop uses in anger the week it lands; each states its data delta, the role it serves, the diagnostic plug-in, and done-when criteria (Rule 4: success criteria, then loop). Sizes are relative (S/M/L ≈ PR count at this repo's typical PR grain: S=1–2, M=3–5, L=6–9).

---

### Phase 1 — The ticket spine (L)

**What ships:** `tickets` + `ticket_jobs` + role/tier plumbing, and intake v2 on top of the existing counter intake: create ticket → add jobs (kind, tier default, pre-assign-or-open, pre-approve toggle for counter-authorized work) → full concern detail persisted at last. Ticket creation is open to **every role** from day one (§4.1's principle), and door C's minimal create — customer + vehicle + title, nothing else required — ships here even though its full 60-second quote experience needs Phase 3's lines. The tech quick path auto-wraps its session in a ticket+job so every new unit of work has a spine. Kill the two fake affordances in counter intake while touching it (camera-scan toggle → wire the real `decode-vin.ts` or remove the button; fake auto-save footer → remove) — doctrine debt paid in passing, not a redesign.
**Data delta:** `tickets`, `ticket_jobs` (minus approval/story columns — those land with their phases), `profiles.skillTier`, `shops.nextTicketNumber`, role vocabulary + capability helpers.
**Serves:** advisor/manager (intake, assignment); the whole system structurally.
**Diagnostic plug:** additive only — `ticket_jobs.sessionId` FK; sessions untouched; nothing reads it yet.
**Done when:** advisor books a real customer into a ticket with a maintenance job and a diagnostic job in <90 seconds; concern text survives to the DB in full; legacy sessions render unaffected; `pnpm test` / `tsc` / `build` green.

### Phase 2 — Technician command center (M)

**What ships:** My Jobs / Open Jobs replacing today-home's session list (legacy ticketless sessions still listed below the fold). Job cards that answer *what vehicle, what's wrong, mine-or-open* at a glance — doctrine-grade, no step counts, no fake risk chips. Atomic tier-gated claim. Tap a diagnostic job → session created lazily via the existing engine seam (§3) → straight into `routeForSession` land. Tap a simple job → simple work view (start / notes+photos / done). The "found something" escalation tap (§6.4.2).
**Data delta:** none beyond Phase 1 (claim writes `assignedTechId`/`claimedAt`; work view writes `workStatus`, `workNotes`).
**Serves:** technician — this is their room.
**Diagnostic plug:** the seam goes live: `createSessionFromIntake` called with existing pick-existing + `assignedTechId` paths, richer complaint text in; session UX from there is byte-identical to today, both tree and topology lines.
**Done when:** a tech claims an open job on their phone with gloves on in ≤2 taps and is inside the live diagnostic on the 3rd; a below-tier tech cannot claim (verified by test, not UI); an oil change flows open→claim→done with zero AI calls.

### Phase 3 — Quote builder + the customer story (L)

**What ships:** `job_lines` CRUD on the ticket (parts/labor/fee, manual entry — the floor), shop rate/tax settings, quote totals per job + ticket, the story generator + advisor review/edit surface (§8), "build quote from diagnosis" (seeds lines from `outcome.partInfo` / recommended repair), diag-fee line from `tickets.authorizedCents`, and mark-approved-by-phone (`approvedVia='phone'`) so the full loop works *before* SMS exists. **Door C completes here:** the one-screen quick-quote flow (§6.4.3) plus `canned_jobs` — pick customer, pick vehicle, tap a canned job, adjust, done. Quote *building* is open to every role; only send/close stays gated. **Also: start the A2P 10DLC brand/campaign registration paperwork now** — it's external lead time for Phase 5, not code.
**Data delta:** `job_lines`, `canned_jobs`; `ticket_jobs` approval + story columns; `shops.laborRateCents/taxRatePct`.
**Serves:** every role (builds tickets and quotes), advisor/manager (finalizes, sends, closes by phone).
**Diagnostic plug:** first read-back from the engine: story compiled from `session_events`/artifacts/locked diagnosis; quote seeded from outcome. Read-only; a session with no ticket (legacy) simply has no story button.
**Done when:** a real customer's diagnostic job goes lock → story → quote → phone-approval → `approved` with the story text stored, edited, and pinned; totals match a hand calculation to the cent; editing a sent quote forces re-send (test-enforced); **and the friction bar: a customer-request job ("front brakes, 2016 F-150") goes from nothing → priced quote in under 60 seconds via door C + a canned job, by a tech, with no advisor involved.**

### Phase 4 — Parts vendor layer (M; external-dependency risk)

**What ships:** `PartsVendorAdapter` interface + `vendor_accounts`, PartsTech transport first (search → offers with live price/availability → line fill with `vendorSnapshot`; punchout cart-return for ordering), O'Reilly-direct partner application filed in parallel (becomes adapter #2 if granted), Tri State as `manual` mode, RepairPal as labor/fair-price benchmark line on the quote (per §6.5 — not a parts adapter). Diagnosis-seeded vendor search (§6.7).
**Data delta:** `vendor_accounts`; `job_lines` vendor columns activate; `shops.partsVendorsEnabled`.
**Serves:** parts-capable roles (advisor/owner/parts).
**Diagnostic plug:** `outcome.partInfo` + recommended repair seed the search query; vendor catalog supplies the part-number citation the engine deliberately refuses to fabricate.
**Done when:** a part the diagnosis named is found at the local O'Reilly through the adapter with live price/availability and lands on the quote in ≤3 taps; pulling the vendor's plug (adapter failure) degrades to manual entry without blocking a quote.

### Phase 5 — Text-to-approve (M)

**What ships:** the hosted approval page (public route, tokenized, expiring, revocable; verdict-first layout: jobs + totals up top, each job expanding to its story + photos via signed artifact URLs; per-job approve/decline; ask-a-question box), `quote_sends`/`quote_events`/`sms_log`, Twilio send behind `shops.smsEnabled`, snapshot pinning, and the approval audit record (§5 integrity rules). Phone/in-person approval from Phase 3 remains an equal path forever — the page is an option, not a gate.
**Data delta:** `quote_sends`, `quote_events`, `sms_log`, `shops.smsEnabled`.
**Serves:** advisor (sends, gets answers) and the customer — their only surface, so it carries the whole brand.
**Diagnostic plug:** the approval page is where the engine's work faces the customer: the story's "how we know" section IS the engine's evidence trail, rendered for a civilian. Nothing else on the market can show its work like this; the page exists to cash that in.
**Done when:** a real customer approves a real quote from their phone; the approval row carries snapshot/timestamp/IP; a declined job and a question both land as advisor notifications; total SMS spend for the month shows on the Twilio console under ~$20.

### Phase 6 — Contextual notifications + order queue + track-to-done (M)

**What ships:** `notifications` + web-push on the routing table (§9), the parts order queue with live staleness re-check + one-click confirm (§6.2), parts received → tech nudge, the manager's ticket board (derived stages, aging), delivery/closeout (ticket → closed, declined-work recorded on the ticket for the record — not fed to the corpus).
**Data delta:** `notifications`, `push_subscriptions`; `job_lines.partStatus` lifecycle activates.
**Serves:** everyone — this is the "right person, right nudge, nothing noisy" step.
**Diagnostic plug:** gate/defer events route to the advisor (the one engine event a customer conversation hangs on); the existing 7d/30d comeback follow-up crons stay internal-only, with customer-facing comeback texts noted as a post-v1 option once SMS trust is established.
**Done when:** approval at the counter reaches the assigned tech's phone as a push within seconds while the advisor sees the order queue; a part whose live price rose above snapshot cannot be one-click-ordered (test-enforced); a ticket runs intake → delivered with zero paper and every state transition visible on the board.

---

### Step-to-phase map (the nine steps from the request)

| Step | 1 Intake | 2 Assign | 3 Command center | 4 Story | 5 Quote | 6 Parts | 7 Approval | 8 Notify/order | 9 Work→done |
|---|---|---|---|---|---|---|---|---|---|
| Phase | 1 | 1–2 | 2 | 3 | 3 | 4 | 3 (phone) / 5 (text) | 6 | 2 (work) / 6 (track) |

### Headline numbers

- **6 phases**; our shop is live on the spine after Phase 2, quoting after Phase 3, texting after Phase 5.
- **~12 new tables + 2 column-adds** (`shops`, `profiles`); **0 engine tables or engine code paths modified**.
- **1 seam** between OS and engine: `ticket_jobs.sessionId` + the existing `createSessionFromIntake` pick-existing path.
- **~$59 one-time + ~$10–20/mo** projected SMS cost at our volume; **$0** for the PartsTech transport.
- **2 external lead-time items to start early:** A2P campaign vetting (start in Phase 3) and the O'Reilly-direct partner application (start in Phase 4, PartsTech covers the gap).

### Sequencing rationale & risks

Spine → tech room → money → vendors → customer channel → nudges: each phase's output is the next phase's input, and the shop gets standalone value at every cut. The two integration phases (4, 5) carry external-party risk (API grants, carrier vetting) — both are sequenced *after* the manual paths that make them optional, so a slipped vendor never blocks quoting and a slow carrier never blocks phone approvals. The single biggest product risk is the story's quality (Phase 3): it's the deal-closer, and it's held to the doctrine's bar — cited, honest, no theater — with the advisor edit loop as the safety net while the prompt earns trust against real customers.

---

## 11. Session protocol — how future sessions resume from this plan

**This document is the only active plan for shop-OS work.** AGENTS.md's "Where to look first" points here; the previous plan/spec/handoff files it referenced were removed from the public tree in PR #111 and are gone. If any other planning doc for shop-OS work appears, it is stale — this one wins, and the conflict gets flagged to Brandon.

**Audit stamp.** Rev 3 was verified claim-by-claim against `main` @ `54921a4` (2026-07-10): every cited file path exists, both line citations are exact (`lib/db/schema.ts:117`, `:103-112`), the 38-table count holds, all symbol claims resolve (`generateDeclineLanguage` → `lib/gating/decline-language.ts`, `routeForSession` → `lib/session-routing.ts:25`, signed URLs → `lib/storage/client.ts`), and the absence claims (no SMS/email/push/notifications code anywhere) are confirmed. If `main` has moved when you read this, re-verify §1 before building on it.

### Resume protocol (fresh session, every time)

1. Read this doc, then `AGENTS.md` (conventions, migration workflow, verification gates). UI work also reads the interaction doctrine (`docs/strategy/2026-05-29-customer-interaction-doctrine.md`) — its principles apply to every new surface, including the customer-facing approval page.
2. Open the **status table** below. Pick the highest-priority `pending` workstream whose lane is free and whose dependencies (listed with each phase in §10) have shipped.
3. Branch from `main`: `feat/shop-os-p<phase>-<workstream-slug>`, one git worktree per lane. Keep the repo's PR grain (small, reviewed, green).
4. Gates before any PR: `pnpm test` · `pnpm exec tsc --noEmit` · `pnpm build`. Schema changes follow AGENTS.md's Supabase MCP migration workflow to the letter.
5. When a workstream ships: update its status-table row (status + PR#) **in the same PR**, and if reality drifted from this plan, add an *"Implementation corrections"* callout at the end of the relevant phase in §10 — that convention is kept from the previous plan, and **corrections callouts are authoritative over the original phase text**.
6. Hard boundary, restated from §2: no PR in this plan touches engine tables or engine code paths (`sessions`, `session_events`, `artifacts`, corpus/calibration/gating/retrieval/topology tables; `lib/ai` except *new* files, `lib/gating`, `lib/retrieval`, `lib/corpus`, `lib/diagnostics`, `lib/flows`). A workstream that seems to need an engine change is mis-scoped — stop and flag it.

### Parallel worktree lanes

One hard rule makes parallelism painless: **the schema lane is exclusive.** `lib/db/schema.ts` + `drizzle/migrations/*` (+ meta snapshots) may have exactly one open PR at any time — schema PRs are deliberately small and merge first. Everything else parallelizes by directory ownership:

```
LANE S  schema + migrations            exclusive; ships first in each phase
LANE A  advisor/customer surfaces      app/(app)/tickets/*, quote builder,
                                       intake v2, approval page, board
LANE T  tech surfaces                  command center, simple work view
                                       (app/(app)/today, its screens)
LANE L  lib-only, pglite-tested        lib/tickets, lib/quotes, lib/parts,
                                       lib/ai/customer-story.ts (new file),
                                       lib/messaging, lib/notifications
```

Overlap map: within a phase, S ships first, then A/T/L run concurrently. Across phases: Phase 2 lanes start once Phase 1's S + claim API land; Phase 3's S can land while Phase 2 UI is in flight; Phase 4's adapters (manual mode) can start any time after Phase 3's S; Phase 5's A2P registration is external and starts during Phase 3; Phase 6 consumes everything and goes last. Never parallel: two PRs touching `schema.ts`; two PRs on the same screen file.

### Status table — the resume point (update in the PR that ships the work)

| # | Phase | Workstream | Lane | Status | PR |
|---|---|---|---|---|---|
| 1 | 1 | Schema: `tickets`, `ticket_jobs`, `skillTier`, roles, capability helpers | S | pending | — |
| 2 | 1 | Intake v2 on counter intake (+ kill the two fake affordances) | A | pending | — |
| 3 | 1 | Door C minimal create (any role; customer + vehicle + title) | A | pending | — |
| 4 | 1 | Tech quick path auto-wraps ticket+job | L | pending | — |
| 5 | 2 | Claim API — atomic, tier-gated (+ tests) | L | pending | — |
| 6 | 2 | Command center: My Jobs / Open Jobs cards | T | pending | — |
| 7 | 2 | Session-creation seam (job → `createSessionFromIntake`) | L | pending | — |
| 8 | 2 | Simple work view + "found something" escalation | T | pending | — |
| 9 | 3 | Schema: `job_lines`, `canned_jobs`, shop rates, approval/story columns | S | pending | — |
| 10 | 3 | Quote builder + totals (+ sent-edit reverts, snapshot rules) | A | pending | — |
| 11 | 3 | Canned jobs + door C one-screen quote (60-second bar) | A | pending | — |
| 12 | 3 | Customer story generator + guards (`lib/ai/customer-story.ts`) | L | pending | — |
| 13 | 3 | Story review/edit surface + phone approval | A | pending | — |
| 14 | 3 | *(external)* A2P 10DLC brand + campaign registration | — | pending | — |
| 15 | 4 | Schema: `vendor_accounts` | S | pending | — |
| 16 | 4 | Adapter interface + manual mode | L | pending | — |
| 17 | 4 | PartsTech transport (search/offers/punchout) | L | pending | — |
| 18 | 4 | Diagnosis-seeded search + line-fill UI (+ RepairPal benchmark) | A | pending | — |
| 19 | 5 | Schema: `quote_sends`, `quote_events`, `sms_log` | S | pending | — |
| 20 | 5 | Hosted approval page (token, story, per-job approve/decline, question) | A | pending | — |
| 21 | 5 | SMS send + delivery webhooks + audit trail | L | pending | — |
| 22 | 6 | Schema: `notifications`, `push_subscriptions` | S | pending | — |
| 23 | 6 | Web push + routing table (§9) | L | pending | — |
| 24 | 6 | Order queue + staleness re-check | A | pending | — |
| 25 | 6 | Ticket board (derived stages) + delivery/closeout | A | pending | — |

---

## Sources (external claims)

- Twilio: [A2P 10DLC pricing and fees](https://help.twilio.com/articles/1260803965530-What-pricing-and-fees-are-associated-with-the-A2P-10DLC-service-) · [US SMS pricing](https://www.twilio.com/en-us/sms/pricing/us) · [campaign vetting FAQ](https://support.twilio.com/hc/en-us/articles/11587910480155-A2P-10DLC-Campaign-Vetting-FAQ)
- PartsTech: [pricing (free tier, free API)](https://partstech.com/pricing/) · [SMS integrations](https://partstech.com/software/management-system-integrations/) · [ordering API](https://www.vehicleservicepros.com/home/press-release/20997189/partstech-parts-ordering-api-allows-shop-management-system-integration) · [O'Reilly connections approved](https://managerforum.net/viewtopic.php?t=14316)
- O'Reilly: [Pro Integration Hub](https://integrations.oreillypro.com/)
- RepairPal: [estimator](https://repairpal.com/estimator) · [fair-price methodology](https://news.repairpal.com/164160-repairpal-brings-truth-and-transparency-to-auto-and-service-repair-with-their-new-fair-price-estimator)

*Pricing verified 2026-07-10 via web search; re-verify at build time.*
