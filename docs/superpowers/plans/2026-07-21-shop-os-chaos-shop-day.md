# ShopOS Chaos Shop Day Implementation Plan

**Goal:** Make the mounted living repair order recover real interrupted work—pause, block, defer, hand off, partially approve, cancel, reopen, and resume—while retaining accountable ownership, append-only audit truth, no lost local work, and one clear next move on phone and desktop.

**Architecture:** Keep the existing `ticket_jobs.work_status` state machine. Add small hold metadata plus one immutable ticket-activity ledger. Put all transactional transitions in `lib/shop-os/interruption.ts`, reuse the existing assignment/simple-work/quote paths, and mount one inline exception surface inside `TicketDetailScreen`. The authenticated Golden test grows into a two-technician Chaos Shop Day; no operational page, diagnostics, or media path is introduced.

**Tech stack:** Next.js 16, React 19, TypeScript, Drizzle ORM, PostgreSQL/PGlite, Vitest, Testing Library, Playwright.

## Global constraints

- No diagnostic, media, messaging, calendar, provider, dependency, refund, or new-page scope.
- `blocked` is the only work hold state. `paused` means a stopped timer on `in_progress`, never a second status.
- A blocked job retains its technician until an advisor/owner explicitly hands it off.
- Every operational write locks the tenant-scoped ticket/job and atomically appends an activity receipt.
- Activity rows are database-append-only; browser projections expose only safe, bounded fields.
- All local text draft recovery is bounded `sessionStorage`, actor/ticket/job scoped, schema-validated, and never server-authoritative.
- Database-heavy tests run at most two workers; the full suite runs as eight serialized shards.

## Task 1 — Add the interruption persistence contract

**Files:**
- Create: `drizzle/migrations/0045_shop_os_interruption_ledger.sql`
- Modify: `lib/db/schema.ts`
- Create: `lib/shop-os/ticket-activity.ts`
- Create: `tests/unit/shop-os-ticket-activity.test.ts`

**Contract:** Add nullable job hold metadata (`holdKind`, `holdNote`, `holdResumeStatus`, `heldAt`, `heldByProfileId`) and one `ticket_activity` ledger. New transition writes use a UUID request key and allowed finite event kinds; legacy blocked jobs without metadata render honestly as `Needs review`.

- [ ] Write RED schema/domain tests for allowed payloads, malformed event data, tenant binding, request-key idempotency, and legacy hold compatibility.
- [ ] Create the additive SQL migration with tenant-safe composite FKs, indexes for ticket activity reads, JSON-object checks, no client privileges, and an immutable trigger that rejects update/delete.
- [ ] Update the Drizzle schema and write the small safe activity codec/insert helper. Do not make activity payloads a generic untyped JSON escape hatch.
- [ ] Run local migration/PGlite proof, activity tests, TypeScript, and `git diff --check`.

## Task 2 — Make interruption and recovery transactional

**Files:**
- Create: `lib/shop-os/interruption.ts`
- Create: `app/api/tickets/[id]/jobs/[jobId]/interruption/route.ts`
- Create: `app/api/tickets/[id]/lifecycle/route.ts`
- Modify: `lib/tickets.ts`
- Modify: `lib/shop-os/simple-work.ts`
- Modify: `lib/shop-os/living-ticket.ts`
- Modify: `app/api/tickets/[id]/jobs/[jobId]/assignment/route.ts` only if response mapping needs the richer projection
- Create/modify: `tests/unit/shop-os-interruption.test.ts`, `tests/unit/shop-os-simple-work.test.ts`, `tests/unit/shop-os-job-assignment.test.ts`, route tests

**Contract:**

```text
in_progress + clock off ──> in_progress / timer stopped / work_paused event
open|in_progress + hold ──> blocked / saved resume state / job_blocked event
blocked + resolve ────────> stored open|in_progress / job_hold_resolved event
open|in_progress|blocked + handoff ──> same state, timer banked / handoff event
open + no payment + cancel ──> canceled ticket + active-job snapshot / cancel event
canceled + reopen ───────> open ticket + snapshot restoration / reopen event
```

- [ ] Write RED tests for every legal transition and exact illegal case: unassigned/other-shop/inactive actor, wrong role, stale request, active diagnostic lease, terminal work, unpaid/paid cancellation, incomplete snapshot, concurrent handoff, and repeated request key.
- [ ] Implement locked, idempotent mutation handlers. Blocking or handing off a running job must bank time in the same transaction. Resolving a blocked job never starts the clock automatically.
- [ ] Extend assignment only for advisor/owner deliberate handoff/reassign of `open`, `in_progress`, and `blocked` jobs; preserve progress/hold, reject a live diagnostic startup lease, and append the correct activity receipt.
- [ ] Make `clock_off` and next clock-on emit pause/resume activity receipts. Preserve current exact-approval and manual-work policy checks.
- [ ] Implement cancel/reopen with a bounded, versioned cancellation snapshot. Cancel requires a reason and zero payments; reopen restores only interrupted snapshot jobs. Never reopen a closed/paid ticket.
- [ ] Extend living-command projection so a technician's blocked job ranks as **Resolve hold**, followed by current work/assignment/quote/close commands. Partial approval remains job-level and cannot suppress approved work.
- [ ] Run focused domain/route tests, then TypeScript and diff check.

## Task 3 — Keep interrupted work mounted and draft-safe

**Files:**
- Create: `lib/shop-os/simple-work-draft.ts`
- Create: `components/screens/ticket-interruption-panel.tsx`
- Create: `components/screens/ticket-interruption-panel.module.css`
- Modify: `components/screens/simple-work-workspace.tsx`
- Modify: `components/screens/inline-work-workspace.tsx`
- Modify: `components/screens/ticket-assignment-control.tsx`
- Modify: `components/screens/ticket-detail.tsx`
- Modify: `components/screens/ticket-detail.module.css`
- Modify: `lib/shop-os/simple-work-ui.ts`, `lib/tickets.ts`, and the ticket page only as needed for safe activity/hold projections
- Create/modify: component and codec tests

**Contract:** The ticket stays mounted. A job's **Manage work** disclosure is the only exception surface; it has pause, hold/defer, resolve, handoff, and authorized cancel controls as applicable. Close, block, handoff, cancel, and workspace close refuse to discard dirty draft state.

- [ ] Write RED codec tests rejecting oversized, stale, malformed, terminal, cross-user, cross-ticket, and cross-job drafts; prove successful save/discard/terminal state clears the key.
- [ ] Write RED component tests for primary action priority, exact role visibility, block reason requirement, hold resolution, handoff focus return, cancel confirmation, activity rendering, dirty-draft guards, local projection, and 390px long-content wrapping.
- [ ] Implement the bounded draft codec and integrate it without background server autosave. Restore only after the strict workspace projection verifies current assignment and work state.
- [ ] Mount the exception panel below the affected ledger job. Use existing focused, inline workspace conventions; no route navigation, page reload, or inert disabled control.
- [ ] Project server-confirmed hold/assignment/lifecycle responses into the local ticket state, target the affected job with the restrained confirmation cue, and return focus to the invoking action.
- [ ] Render the factual activity receipt list behind a compact disclosure. Do not expose internal IDs, raw snapshots, or noisy event chatter.
- [ ] Run focused codec/component/ticket tests, TypeScript, and diff check.

## Task 4 — Build the authenticated Chaos Shop Day proof

**Files:**
- Modify: `tests/helpers/golden-shop-day.ts`
- Modify: `tests/unit/shop-os-golden-shop-day.test.ts`
- Modify: `tests/e2e/golden-shop-day.spec.ts` or create a sibling `tests/e2e/chaos-shop-day.spec.ts` that reuses its authenticated setup/cleanup harness
- Modify: `scripts/shop-os-golden-browser.mjs`, Playwright config, and QA provisioning only when required to add an isolated relief-tech identity
- Create/modify: focused browser/component receipts as required

**Contract:** Prove the complete domain journey hermetically and the same authenticated journey at 390×844 and 1440×900 with two isolated technicians.

- [ ] Extend the local Golden fixture with a relief technician and prove owner/advisor/tech/relief/parts authority and cleanup.
- [ ] Add the exact chaos journey: partial approval; note-reload recovery; pause; parts block; advisor handoff; relief-tech resolve/continue/complete; separate canceled then reopened interruption ticket; activity receipts at every boundary.
- [ ] Assert mounted ticket URL throughout, safe focus, zero horizontal overflow, no serious/critical Axe issues, no browser faults, no diagnostics/media controls, and zero retained QA rows.
- [ ] Run local production-build browser proof first, then provision/use the isolated hosted QA identities and run exact-production phone/desktop proof after deployment.

## Task 5 — Converge, migrate, release, and record the result

**Files:**
- Modify: `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`
- Modify: `tasks/lessons.md` only if a new non-obvious lesson occurs

- [ ] Run one adversarial pre-merge review across authorization, tenant isolation, activity immutability, snapshot restoration, timer accounting, dirty drafts, accessibility, and responsive overflow. Batch any findings into one repair wave.
- [ ] Apply `0045` through the approved Supabase migration path, then verify table shape, ACL/RLS, immutable trigger behavior, required FK indexes, and advisor output before production deploy.
- [ ] Run focused tests, eight serialized full-suite shards, `pnpm exec tsc --noEmit --pretty false`, `pnpm build`, diff/security scans, and CI gates.
- [ ] Merge, deploy, and run the exact authenticated Chaos Shop Day against production. Verify health, protected routes, deployment/runtime logs, browser evidence, and cleanup.
- [ ] Record the completed workstream and exact proof in the active strategy plan’s status table and implementation-correction section if reality differs from this plan.

## Completion definition

The goal is complete only when the current production revision proves every named interruption action for its permitted role, the mounted repair order gives the correct next action with no data loss, activity truth is immutable and tenant-safe, diagnostics/media remain unavailable, and the authenticated two-viewport Chaos Shop Day passes with no retained QA operational rows.
