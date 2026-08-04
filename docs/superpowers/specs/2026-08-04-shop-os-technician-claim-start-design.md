# Shop OS Technician Claim and Start Design

**Date:** 2026-08-04
**Baseline:** production merge `fd2c9e552c4159cb9516be9326c3c89543de0979`
**Design direction approval:** Buzz event `e3e183a5f036556431bd28b6329d7ab2cb08fa44f7bdb4faedc92223a146a890`

## Executive result

An eligible technician moves from an available job to real work through two deliberate actions on one mounted Today surface:

```text
Available
│
└── Claim work
    ├── server confirms this exact job and current approval state
    ├── card settles into My work
    └── approved scope opens beneath the card
        └── Clock on
            └── server confirms the clock is running
```

Claim means **this job is mine**. It never means labor time started. Clock on remains the explicit start after the technician sees exactly what the customer approved.

No page, schema, migration, dependency, provider, price permission, diagnostic activation, or production-data action is required.

## Intent normalization

### Desired outcome

From Today, a technician can tell:

- whether this job is theirs;
- whether the customer authorized it;
- whether their skill tier permits self-claim;
- what changed or needs attention;
- the single honest next action;
- whether the job clock is actually running.

Claim, assignment, approved-scope review, and clock-on feel like one continuous handoff without turning ownership into automatic timekeeping.

### Explicit requirements

- Preserve the repair order and Today as mounted workspaces.
- Remove the needless extra **Open work** tap after an approved claim.
- Keep exact approved scope visible before Clock on.
- Show truthful states for assigned, unassigned, below-tier, declined, deferred, and already-claimed work.
- Keep technicians out of priced quote controls when following their Today next action.
- Prove Finish, Correct, and Recover on phone and desktop.

### Inferred requirements

- Claim must bind to the approval state the technician saw. A late approval or decline cannot silently change the meaning of the tap.
- A lost claim response must replay the same intent rather than create a second ownership event.
- A claimed job must remain visibly claimed when the work tool fails to load.
- A clock may display running only after validated server truth returns.
- Focus must enter the opened work context without skipping the approved scope.
- Opening or reading work must not take mutation locks.

### Constraints and non-goals

- No combined Claim + Clock on mutation.
- No automatic timekeeping.
- No new job clock model, payroll meaning, per-technician time ledger, or exclusive single-job clock rule.
- No change to work notes, Clock off, resume, completion, local draft, parts, found concern, or hold behavior; those remain Chunk 5 or Chunk 6.
- No mistaken-claim release or technician handoff; those remain Chunk 6.
- No session-linked diagnostic ownership transfer, diagnostic procedure, or diagnostic engine change.
- No new activity kind, database constraint, or migration.
- No price, cost, markup, margin, vendor, payment, or customer-contact data on the technician start path.
- No schedule, appointment, ETA, completion forecast, or authored repair procedure.

### Effort and authority

- **Tier:** T2 cross-functional because assignment races, customer authorization, timekeeping, phone continuity, focus, and role-shaped commands meet in one short journey.
- **Design authority:** A1.
- **Source authority after written approval:** A2 on an isolated branch through tests, independent review, and a linked pull request.
- **Production authority:** A3 remains required for merge and deployment.

## Current source truth

- Today already shows My work and Available, uses a bounded server projection, and refreshes while no inline tool is active (`lib/tickets.ts`, `lib/shop-os/today-board.ts`, `components/screens/today-jobs-board.tsx`).
- Self-claim is one tenant-scoped conditional update with a durable request-key receipt. A race returns the safe winning assignee when available (`lib/tickets.ts`, assignment route and tests).
- Successful claim currently moves the row from Available to My work and focuses the row. It does not open work.
- Assigned simple work already opens beneath its Today row through `InlineWorkWorkspace`; no new work page or mutation route is needed.
- The bounded work projection contains exact approved scope without customer pricing. The work surface shows that scope before Clock on (`lib/shop-os/simple-work.ts`, `lib/shop-os/simple-work-ui.ts`, `components/screens/simple-work-workspace.tsx`).
- First Clock on revalidates an active same-shop actor, current assignment, open repair order, and exact pinned approval inside the work transaction. It starts the job and job clock together.
- The job clock is intentionally per job and may run on more than one job at a time. It is actual job-active time, not payroll or technician-attributed labor history.
- Today currently treats ownership and approval as separate: an eligible technician can claim open work before approval. After claim, Today can accidentally make **Build quote** the primary action for that technician.
- Today currently hides above-tier unassigned work from a technician instead of explaining why it cannot be claimed.
- Today and the repair order project work status but not running-versus-paused clock truth outside the work tool.
- A stale embedded workspace currently reports lost access but leaves active-looking controls mounted.
- Production diagnostic automation is off. Eligible sessionless diagnostic work uses the same manual approved-work path; session-linked diagnosis keeps its separate existing entrance.

## Approaches considered

### A. Two deliberate actions in one mounted handoff — selected

Claim the exact job, settle it into My work, open approved scope automatically when eligible, then require Clock on. Preserve pre-approval ownership as a separate state. Use the existing assignment and work routes.

This removes one tap and one visual restart without starting time before the technician reviews the work.

### B. One atomic Claim + Clock on action — rejected

This is the fewest taps, but it starts real time before the approved scope is visible, couples two different permissions, complicates race recovery, and makes an accidental claim an accidental time entry.

### C. Keep Claim → Open work → Clock on and add polish — rejected

This preserves current contracts but leaves three separate commands and two intermediate stops. It does not meet the promised continuous handoff.

## Experience contract

### One mounted path

```text
Today
│
├── Available
│   ├── Approved + eligible → Claim work
│   ├── Waiting + eligible → Claim work
│   ├── Below tier → Requires [tier]; no claim
│   ├── Deferred → Waiting on customer; no claim
│   └── Declined → Customer declined; no claim
│
└── My work
    ├── Approved + not started → Review & clock on
    ├── Waiting for quote → Waiting for quote; no price action
    ├── Quote ready → Waiting for advisor; no price action
    ├── Link opened → Waiting for customer; no price action
    ├── Deferred → Waiting on customer; no start
    ├── Declined → Customer declined; no start
    ├── Clock running → Clock running since [time]
    ├── Clock paused → Clock paused
    └── Blocked → existing hold recovery; unchanged in this chunk
```

`Waiting + eligible` means `pending_quote`, `quote_ready`, or `sent`. Self-claim remains an ownership action for these current nonterminal states. It does not open work. `quote_ready` waits for the advisor to share the current customer handoff; internal `sent` means the current link has been opened and waits for the customer's answer. `deferred` and `declined` are deliberate customer outcomes and do not offer a new self-claim.

Advisor/owner assignment remains able to place unapproved work with a technician. An already-assigned technician sees the same waiting state and no work-start or price-building command.

### Approved claim

1. The technician taps **Claim work**.
2. The tapped control shows **Claiming…** and all other claim controls temporarily disable.
3. The server binds tenant, ticket, job, open work, null assignment, active actor, skill tier, request key, and the approval state the technician saw.
4. The returned narrow envelope proves the current assignee and approval state.
5. If the exact returned state is approved manual work, the card moves to My work and the existing inline work tool opens beneath it without another tap.
6. Focus moves to **Exactly what is approved**, not directly to Clock on. This keeps scope review deliberate and places the opened tool where the user acted.
7. Clock on remains after the approved scope. The server-confirmed mutation changes the visible truth to **Clock running since [time]**.

### Preassigned approved work

The card says **Assigned to you** and offers **Review & clock on**. The action opens the same inline work tool and focuses the approved-scope heading. It does not start time.

### Mechanical settle

The decisive interaction is a restrained **handoff detent**:

- the claimed card moves from Available to My work;
- a 2px signal rail confirms the new ownership state;
- the inline work surface expands directly beneath the card;
- transform/opacity settles to rest over 200ms without delaying the next action;
- reduced motion removes the transform and transition while preserving lane placement, rail, wording, focus, and live announcement.

No sparkle, gradient, pulse, count-up, confetti, vibration, or decorative celebration.

### Phone and desktop

- The same card and work tool exist at 390×844 and 1440×900; layout changes, behavior does not.
- The approved-scope heading becomes the focus and scroll destination after open.
- The exact scope remains before Clock on. Long scope may scroll; the UI does not auto-skip it.
- Claim, Review & clock on, Clock on, Retry work, and fallback controls are at least 44×44px.
- Long job, customer, vehicle, and assignee text wraps without horizontal overflow.
- Only one inline quote, work, or ring-out tool remains active at a time.

## State and command rules

| Server truth | Technician-visible truth | Primary action |
|---|---|---|
| Unassigned, approved, within tier | Approved · Available | `Claim work` |
| Unassigned, pending quote, within tier | Waiting for quote · Available | `Claim work` |
| Unassigned, quote ready, within tier | Waiting for advisor · Available | `Claim work` |
| Unassigned, sent, within tier | Waiting for customer · Available | `Claim work` |
| Unassigned, deferred | Waiting on customer | None |
| Unassigned, declined | Customer declined | None |
| Unassigned, pending quote/quote ready/sent/approved, below tier | Requires C-tech/B-tech/A-tech derived from the persisted required tier | None |
| Assigned to current technician, approved, open | Assigned to you · Approved | `Review & clock on` |
| Assigned to current technician, pending quote | Assigned to you · Waiting for quote | None |
| Assigned to current technician, quote ready | Assigned to you · Waiting for advisor | None |
| Assigned to current technician, sent/deferred | Assigned to you · Waiting for customer | None |
| Assigned to current technician, declined | Assigned to you · Customer declined | None |
| Assigned to current technician, in progress, clock running | Clock running since persisted time | `Continue work` |
| Assigned to current technician, in progress, clock paused | Clock paused | `Continue work` |
| Claimed by another technician during tap | Already claimed by safe winner, when available | Current row leaves or becomes read-only |
| Identity incomplete, blocked, canceled, terminal, or unsupported session shape | Exact safe reason or repair-order fallback | Existing safe fallback only |

Claimable rows sort before read-only below-tier rows so explanation never hides work the signed-in technician can actually take within the existing bounded response.

Customer outcome takes precedence over skill fit: deferred and declined rows show that customer truth rather than a tier message because neither state offers self-claim.

## Server and data contract

### 1. Keep claim and start separate

Use the existing assignment POST and work POST. Do not create a combined endpoint or transaction.

Claim changes only assignment ownership and claim receipt truth. Clock on changes only approved work and clock truth. The work transaction continues to revalidate current assignment and exact approval immediately before writing.

### 2. Bind claim to visible decision truth

Extend the strict claim request with the exact `expectedApprovalState` shown on the card:

```ts
{
  action: 'claim'
  requestKey: string // UUID
  expectedApprovalState:
    | 'pending_quote'
    | 'quote_ready'
    | 'sent'
    | 'approved'
}
```

`deferred` and `declined` are not valid new claim intents.

The conditional claim update must compare the persisted approval state before changing assignment. The durable receipt intent includes the expected state so one request key cannot be replayed with different meaning. A mismatch writes nothing and returns a no-store conflict that causes Today to refresh current truth.

The narrow assignment success envelope adds the current allowlisted `approvalState`. It does not add quote totals, quote lines, customer links, actor IDs, timestamps, or private ticket data.

### 3. Show below-tier truth without granting claim authority

The bounded Today query may return unassigned open work above the technician's tier, but `canClaim` remains false. The current `requiredSkillTier` produces the visible reason. Claimable rows sort first and the existing hard response limit remains.

The mutation remains the authority: it rechecks the actor's active persisted membership, role, shop, and tier in the same conditional update. Client visibility never grants claim permission.

An advisor/owner's existing explicit below-tier assignment remains valid for manual work. This chunk does not change that policy or the separate disabled diagnostic-engine rules.

### 4. Project running-versus-paused truth

Add only the existing `clockedOnSince` ISO value or null to the bounded Today job projection and its strict parser. Derive:

- `workStatus === 'open'` → Not started;
- `workStatus === 'in_progress' && clockedOnSince !== null` → Clock running since persisted time;
- `workStatus === 'in_progress' && clockedOnSince === null` → Clock paused.

Do not add active seconds, money, payroll language, technician attribution, forecasts, or a second live timer to the card. The work tool remains the detailed clock surface.

After a successful work mutation, project both `workStatus` and `clockedOnSince` into the parent card before any close or collapse. Reload uses the same server truth.

### 5. Keep price-building out of the technician next move

The technician Today command projector never makes **Build quote**, Prepare, totals, or customer price the next action for assigned work. Waiting states remain read-only and explain who or what is pending.

This changes next-move presentation, not the broader `canBuildQuotes` authorization model. Deliberate quote access elsewhere remains unchanged and is not expanded by this chunk.

### 6. Preserve read and mutation boundaries

- `InlineWorkWorkspace` remains the read/retry owner.
- `SimpleWorkWorkspace` remains the work/clock owner.
- Work GET stays a read-only snapshot and takes no work locks.
- Assignment and work mutations retain their current tenant, actor, and transaction boundaries.
- Today owns lane placement, one-active-tool arbitration, focus, announcements, and narrow local projections.
- The repair-order screen consumes the same pure technician command rules so labels and precedence do not drift.

## Component boundary

Expected source surface:

- `lib/tickets.ts` — bounded Today visibility, approval-bound claim, current approval and clock projection.
- `lib/shop-os/today-board.ts` — strict parsing, lane placement, assignment/clock overrides.
- `lib/shop-os/living-ticket.ts` — shared technician command/readiness rules.
- `app/api/tickets/[id]/jobs/[jobId]/assignment/route.ts` — narrow current approval in the safe envelope.
- `components/screens/today-jobs-board.tsx` — state wording, automatic approved-work open, parent projection, focus, detent.
- `components/screens/ticket-detail.tsx` — the same technician command wording and running state.
- `components/screens/inline-work-workspace.tsx` — open/failure/fallback focus boundary.
- `components/screens/simple-work-workspace.tsx` — approved-scope focus target and non-actionable stale-access recovery.
- Existing CSS modules — handoff detent, 44px controls, overflow, and reduced-motion rules.

No new page, route, table, migration, dependency, global workflow engine, or duplicate work component.

## Failure, correction, and recovery

### Finish

- Approved unassigned work: Claim work → card moves to My work → exact approved scope opens → Clock on → running truth appears.
- Approved preassigned work: Review & clock on → exact approved scope opens → Clock on → running truth appears.

### Correct

- If a technician claimed waiting work, it remains in My work with the exact waiting state. Approval appearing later replaces the wait with Review & clock on through the existing refresh path.
- If approval changes between render and claim, expected-state comparison writes nothing, refreshes the row, and reveals the current state.
- A below-tier row never presents a disabled mystery button; it names the required tier.

### Recover

- **Lost claim response:** retain and replay the same request key and expected state. A successful prior claim returns the same assignment truth and continues to the right waiting or approved state.
- **Claim race:** show `Already claimed by [safe name]` when available, move or remove the stale row, and focus the next surviving context. Never expose profile IDs.
- **Malformed claim success:** keep the row, remove stale claim authority, explain that the screen could not safely catch up, and offer the repair-order fallback.
- **Work tool load failure:** the durable claim remains visible. Offer Retry work, full work page, and Close; do not undo assignment.
- **Approval or assignment lost while work is open:** replace active-looking controls with a non-actionable recovery panel, refresh the parent card, and offer the repair-order fallback. Do not leave Clock on mounted.
- **Lost first Clock on response:** retry/reload converges on the persisted running state and original start time. Do not create a second interval or claim failure while the server clock is already running.
- **Clock mutation conflict or malformed response:** keep the scope mounted, show no running truth, refresh the bounded workspace, and require an explicit retry.

## Acceptance tests

### Finish

- An approved within-tier unassigned job moves Available → My work, opens exact approved scope without an Open work tap, and clocks on once.
- An approved preassigned job opens through Review & clock on and uses the same work surface.
- Clock running truth survives Today and repair-order reload without exposing prices or active-seconds payroll meaning.

### Correct

- Pending-quote and awaiting-customer work may be claimed but never opens work or priced quote controls.
- A later approval changes the sole next action to Review & clock on.
- Deferred and declined jobs offer neither Claim work nor Clock on.
- Below-tier work is visible, names the required tier, sorts after claimable work, and rejects a forged claim at the server.
- Manual work explicitly assigned below tier keeps the current advisor-confirmed assignment policy.

### Recover

- Two claims for one job produce one winner, one durable assignment receipt, one safe loser state, and no duplicate ownership event.
- Approval changing during claim produces zero assignment write for the stale intent.
- Lost claim response replay returns the same result and opens or waits according to server truth.
- Initial inline load failure preserves the claim and exposes Retry/full-page/Close.
- Lost assignment or approval while mounted removes active controls before announcing recovery.
- Lost first-clock response and duplicate tap converge on one start time and one running interval.
- Cross-shop, inactive, unassigned, wrong-technician, closed-ticket, unsupported diagnostic-session, malformed success, and stale response cases fail safely.

### Browser proof

Run production React/CSS at 390×844 and 1440×900 for:

1. **Finish:** approved unassigned Claim work → automatic scope open → Clock on → running truth.
2. **Assigned:** preassigned Review & clock on → scope open → Clock on.
3. **State truth:** pending quote, awaiting customer, below tier, deferred, and declined controls.
4. **Recover:** already-claimed race, lost claim response, failed work load, and stale mounted access.

Each case proves exact request identity, focus on the approved-scope or recovery heading, 44px controls, no horizontal overflow, normal/reduced-motion equivalence, zero serious/critical Axe findings, no unexpected browser/network faults, and no technician-facing price control or price data.

The browser harness proves interaction and accessibility. PGlite/domain tests prove transaction, tenant, authorization, claim receipt, approval binding, and clock persistence. Neither environment substitutes for the other.

## Verification and convergence

1. Write RED state-matrix, route, domain, component, and browser tests first.
2. Implement the smallest projection, mutation, mounted-flow, focus, and CSS changes.
3. Run focused tests during implementation.
4. Run static, security, and runtime/accessibility review in parallel.
5. Consolidate blocking findings into one repair wave and one focused re-review.
6. Run the full eight-shard suite, TypeScript, production build, diff checks, and phone/desktop browser proof on the exact clean HEAD.
7. Push and open a channel-linked pull request only after the gate passes.
8. Merge and deploy only after explicit owner approval, then verify exact-revision production health and protected-route behavior.

## Rollback and stop conditions

Rollback is a source revert. Existing assignments, approved snapshots, clock intervals, work notes, and quote history remain intact; no data cleanup exists.

Stop and return for a new decision if implementation requires:

- a migration, new table, new activity kind, new endpoint, or new page;
- a broader permission or customer-price exposure;
- a combined claim/time mutation or changed payroll meaning;
- diagnostic activation, diagnostic ownership transfer, or engine semantic change;
- production secrets, production data, or dormant-feature activation;
- a new Critical/Important defect after the focused final re-review.

## Deliberately deferred findings

- Clock off, resume, note, completion, and full timer-intent hardening remain Chunk 5.
- Mistaken claim release, technician handoff, session-linked diagnostic transfer, hold, found concern, and manual parts flow remain Chunk 6.
- First-start/completion activity kinds, per-technician clock intervals, database clock constraints, and payroll reporting require separate storage decisions and likely migrations.
- Whole-shop Floor projection and Today overflow policy are not required for the My work claim-to-start exit test.

## Evidence and reviewer reconciliation

- Product source: `PLANS/SHOP_OS_PREMIUM_INTERACTION_ROADMAP_2026_08_02.md`, Chunk 4.
- Interaction source: `docs/strategy/2026-05-29-customer-interaction-doctrine.md`, current Today/work components, and existing phone/desktop browser harness.
- Current source baseline: exact clean production merge `fd2c9e552c4159cb9516be9326c3c89543de0979`.
- Flow review: confirmed the three-action current journey, assignment receipt safety, missing running-state projection, duplicate command logic, and separation of assignment from authorization.
- Phone/desktop review: found missing focus handoff, overbroad repair-order claim wording, stale mounted controls, and incomplete Claim → Clock on browser proof.
- Concurrency/security review: required claim/start separation, current-assignment and approval revalidation, safe claim-race recovery, deliberate clock-on, and a stop boundary around session-linked diagnostic transfer.
- No reviewer found a Critical defect in the current manual claim-to-first-clock path. All Important findings required for this chunk are incorporated or explicitly deferred to their named later chunk.

## Approval gate

Brandon reviews this written specification before implementation planning or code begins. Written approval authorizes source implementation planning only. It does not authorize merge, deployment, migration `0050`/`0051`, Customer Approval activation, Ticket Correction activation, production secrets, or production-data mutation.
