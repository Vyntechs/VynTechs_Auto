# Shop OS Phase-1 Ticket Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development`, `superpowers:test-driven-development`, and `frontend-design` task-by-task. Steps use checkbox syntax for durable progress. This packet is subordinate to `2026-07-10-shop-os-spec-and-phased-plan.md`.

**Goal:** Give every active Shop OS role one real, tenant-safe, mobile-ready ticket route that makes the customer, vehicle, concern, assignment, work state, and approval state readable without exposing diagnostic internals or inventing future controls.

**Architecture:** A pure `TicketDetailScreen` renders the safe `TicketDetail` projection introduced by row 8. The server page authenticates, translates the profile with `ticketActorFromProfile`, calls injected-domain `getTicketDetail`, collapses every denied/missing result to Next.js `notFound`, and renders the screen. CSS Modules keep the row-9 visual system local while consuming the existing Workshop Instrument tokens.

**Tech Stack:** Next.js 16 server components, React 19, TypeScript 6, CSS Modules, Testing Library, Vitest 4.

## Global constraints

- Do not apply migrations or write to production Supabase; row 6 remains the production owner gate.
- Do not change ticket/job handlers, schema, diagnostic prompts, risk/gating, retrieval, topology, session initialization, repair/close behavior, or engine output semantics.
- Read only the row-8 `TicketDetail` projection; do not query raw ticket, profile, customer, vehicle, or session tables from the page or screen.
- Every supported active Shop OS role may read a same-shop ticket. Missing, cross-shop, malformed, pending, deactivated, unsupported-role, and no-shop results render the same not-found boundary.
- Row 9 is read-only. Do not add customer reconciliation, add-job, assign/claim, quote, approve, start-work, deliver, close, or cancel controls.
- A linked diagnostic session may expose one real `Open diagnosis` link. No session means no start button or fake affordance.
- A provisional `tech_quick` ticket with null customer/vehicle must say exactly what is missing and what remains blocked; it never fabricates a customer, vehicle, VIN, or contact.
- Use the existing bone/graphite/signal token system, Instrument Serif for narrative, Inter Tight for utility chrome, and JetBrains Mono for RO numbers, VIN, status, and measurements. No new raw color palette or font dependency.
- Use calm, technical, imperative copy with no emoji. Every status shown comes from persisted ticket/job state.
- Responsive at 375px without horizontal scrolling; tap targets are at least 44px; keyboard focus is visible; reduced-motion users receive no animation.
- UI verification requires component DOM tests, server-page access tests, full tests, TypeScript, build, diff review, independent review, and the repository-required browser accessibility check when the connected signed-in browser is available.

## Design direction

**Subject:** A service advisor or owner reviewing one repair order at the counter. The page's single job is to answer: whose vehicle is this, why is it here, and where does each job stand?

**Palette:** Existing `--vt-bone-50/100/200`, `--vt-fg/fg-2/fg-3`, `--vt-rule`, and `--vt-signal-500`; semantic job/ticket states use only existing status/risk tokens.

**Type:** Instrument Serif for concern and customer-facing prose; Inter Tight for compact labels; JetBrains Mono for `RO 000123`, VIN, timestamps, tier, and state stamps.

**Signature:** The job list is a repair-order ledger rail. Each persisted job occupies one actual line on a thin signal-navy spine, with its real work and approval stamps adjacent. The rail encodes job order; it is not decorative workflow theater.

```text
┌──────────────────────────────────────────────────────┐
│ Vyntechs        RO 000123 · Open       ← My Jobs     │
├──────────────────────────────────────────────────────┤
│ RO 000123                                             │
│ Customer + vehicle identity        Open / source stamp│
├───────────────────────────────┬──────────────────────┤
│ WHAT BROUGHT IT IN            │ CONTACT / VEHICLE    │
│ Full concern, when, frequency │ phone · email · VIN  │
├───────────────────────────────┴──────────────────────┤
│ JOB LEDGER                                           │
│ ● 01 Brake vibration    Open · Quote not built       │
│ │    Diagnostic · A-tech · Open / unassigned         │
│ ● 02 Oil service        Done · Approved              │
│      Maintenance · C-tech · Angel R.                 │
└──────────────────────────────────────────────────────┘

375px: header → identity → concern → contact/vehicle → jobs
```

**Self-critique:** The bone canvas and serif are repository-mandated, so distinction is spent on the truthful repair-order ledger rather than generic cards, gradients, dashboard counters, or decorative numbering. Every visible mark carries ticket identity, job order, or persisted state.

---

### Task 1: Claim and publish the advisor ticket-detail lane

**Files:**

- Create: `docs/strategy/2026-07-10-shop-os-phase-1-ticket-detail-plan.md`
- Modify: `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`
- Modify: `docs/strategy/2026-07-10-shop-os-phase-1-ticket-api-plan.md`

**Interfaces:**

- Produces: row 9 owned by `feat/shop-os-p1-ticket-detail`; row 8 merge completion recorded; row 6 unchanged.

- [x] Mark row 9 `in_progress` with branch `feat/shop-os-p1-ticket-detail`.
- [x] Record row 8's completed merge/verification checkbox.
- [x] Commit the packet and status claim, push the branch, and open draft PR #120 before UI implementation.

---

### Task 2: Build the truthful ticket-detail screen test-first

**Files:**

- Create: `components/screens/ticket-detail.tsx`
- Create: `components/screens/ticket-detail.module.css`
- Create: `tests/unit/shop-os-ticket-detail.test.tsx`

**Interfaces:**

```ts
import type { TicketDetail } from '@/lib/tickets'

export function TicketDetailScreen({ ticket }: { ticket: TicketDetail }): React.JSX.Element
```

- [ ] Write DOM tests first for a complete counter ticket, a provisional tech-quick ticket, open/unassigned work, assigned work, every persisted work/approval label, a linked diagnostic session, and safe contact/vehicle links.
- [ ] Verify RED because `TicketDetailScreen` does not exist.
- [ ] Render `AppHeader` with `RO ${ticketNumber.toString().padStart(6, '0')}`, ticket status/source, and a real `/today` back link.
- [ ] Render full concern, optional `whenStarted`/`howOften`, optional diagnostic authorization amount/note, customer contact, vehicle identity, VIN, mileage, plate, and vehicle-history link only when the projection contains them.
- [ ] Render the provisional state as `Customer and vehicle still needed` plus `Quoting, sending, delivery, and closeout stay blocked until this ticket is reconciled.` No action control appears.
- [ ] Render an ordered job ledger with title, kind, required A/B/C tier, assignee or `Open — no technician assigned`, work label, approval label, and `Open diagnosis` only when `sessionId` is non-null.
- [ ] Keep copy and labels pure/deterministic through small private formatter maps; never infer a state absent from the projection.
- [ ] Implement responsive CSS Modules with the existing tokens, 44px links, visible `:focus-visible`, and no motion dependency.
- [ ] Run `pnpm test tests/unit/shop-os-ticket-detail.test.tsx`; verify GREEN and commit the screen slice.

---

### Task 3: Wire the protected server route test-first

**Files:**

- Create: `app/(app)/tickets/[id]/page.tsx`
- Create: `tests/unit/shop-os-ticket-page.test.tsx`

**Interfaces:**

```ts
export default async function TicketPage({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<React.JSX.Element>
```

- [ ] Write page tests first for unauthenticated redirect, exact actor/ticket forwarding, successful screen render, and one indistinguishable `notFound` result for every domain denial/error.
- [ ] Verify RED because the page module does not exist.
- [ ] Authenticate with `requireUserAndProfile`, redirect unauthenticated users to `/sign-in`, and call `getTicketDetail(db, {actor: ticketActorFromProfile(ctx.profile), ticketId: id})`.
- [ ] Call `notFound()` for every non-success domain result; do not branch on error codes or query raw tables.
- [ ] Render only `<TicketDetailScreen ticket={result.ticket} />` on success.
- [ ] Run both row-9 focused test files and TypeScript; verify GREEN and commit the route slice.

---

### Task 4: Verify, review, reconcile, and ship row 9

**Files:**

- Modify: `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`
- Modify: `docs/strategy/2026-07-10-shop-os-phase-1-ticket-detail-plan.md`

**Interfaces:**

- Produces: row 9 `complete` with PR/proof; rows 10 and 11 become dependency-ready but remain unclaimed; row 6 remains `owner_gate`.

- [ ] Run row-9 focused tests, `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm build`, and `git diff --check`; record exact counts.
- [ ] Inspect desktop and 375px layouts, keyboard focus, landmarks/headings/labels, honest provisional state, and linked-session behavior with the required browser accessibility workflow when available.
- [ ] Inspect the full diff for raw-table reads, engine changes, fake controls, raw colors, unsafe contact leakage, unrelated files, and intent drift.
- [ ] Obtain independent task reviews and one whole-branch review; resolve every Critical/Important finding and re-review.
- [ ] Add the Phase-1 ticket-detail implementation correction, mark row 9 complete, and preserve row 6's production owner gate.
- [ ] Push the final head, wait for GitHub checks, mark the PR ready, squash-merge, verify `origin/main` matches the merged tree, and immediately continue the next dependency-safe row.

## Verification

```bash
pnpm test tests/unit/shop-os-ticket-detail.test.tsx tests/unit/shop-os-ticket-page.test.tsx
pnpm test
pnpm exec tsc --noEmit
pnpm build
git diff --check
```
