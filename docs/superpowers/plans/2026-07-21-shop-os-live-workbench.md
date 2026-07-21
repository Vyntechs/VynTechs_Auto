# ShopOS Live Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the mounted Build quote workflow respond locally, reveal editors at the invoking job, recover bounded per-user drafts after accidental reload, fit long content, and expose one obvious next action on phone and desktop.

**Architecture:** Preserve `TicketDetailScreen` → `InlineQuoteWorkspace` → `ManualQuoteBuilder`. Add one pure fail-closed session-draft codec, then make `ManualQuoteBuilder` render and announce one contextual editor and one server-confirmed change marker. No server contract, route, database, page, dependency, or authority rule changes.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6, CSS Modules, Vitest 4, Testing Library, Playwright 1.59.

## Global Constraints

- Add no page, schema/migration, dependency, diagnostic/media entrance, autosave request, global redesign, provider call, or production/customer-data mutation.
- Persist only a bounded, versioned line draft in `sessionStorage`, scoped by authenticated actor ID and ticket ID; server truth stays authoritative.
- No quote total or line is optimistic; visible money changes only after strict GET reconciliation.
- All active controls are at least 44 CSS pixels, keyboard reachable, visibly focused, and honest about pending/blocked state.
- The signature bay pulse is one non-looping server-confirmation cue of at most 220 ms with a reduced-motion equivalent.
- Database-heavy tests run with at most two workers; full-suite shards run sequentially.

---

### Task 1: Add the bounded quote-draft codec

**Files:**
- Create: `lib/shop-os/quote-editor-draft.ts`
- Create: `tests/unit/shop-os-quote-editor-draft.test.ts`

**Interfaces:**
- Produces: `quoteEditorDraftKey(actorId: string, ticketId: string): string`.
- Produces: `encodeQuoteEditorDraft(draft: QuoteEditorDraft, now?: number): string`.
- Produces: `parseQuoteEditorDraft(raw: string, scope: { actorId: string; ticketId: string; now?: number }): QuoteEditorDraft | null`.
- Consumes: `ManualLineFormValues` and `ManualLineKind` from `quote-builder-ui.ts`.

- [ ] **Step 1: Write RED codec tests**

Cover a valid create draft, a valid edit draft, actor/ticket mismatch, a timestamp older than 12 hours, malformed JSON, payloads over 8 KiB, unknown keys/types, invalid UUID identities, and values exceeding their UI bounds. Assert that encoded output never includes customer name, vehicle, concern, price totals, cookies, or credentials.

- [ ] **Step 2: Prove RED**

Run:

```bash
pnpm exec vitest run tests/unit/shop-os-quote-editor-draft.test.ts --maxWorkers=1
```

Expected: FAIL because `quote-editor-draft.ts` does not exist.

- [ ] **Step 3: Implement the fail-closed codec**

Use this public shape and constants:

```ts
export const QUOTE_EDITOR_DRAFT_VERSION = 1
export const QUOTE_EDITOR_DRAFT_MAX_BYTES = 8192
export const QUOTE_EDITOR_DRAFT_MAX_AGE_MS = 12 * 60 * 60 * 1000

export type QuoteEditorDraft = {
  version: 1
  actorId: string
  ticketId: string
  jobId: string
  mode: 'create' | 'edit'
  kind: ManualLineKind
  lineId: string | null
  values: ManualLineFormValues
  hoursChanged: boolean
  clientKey: string | null
  savedAt: number
}
```

Normalize UUID identifiers to lowercase. Validate exact keys, types, field lengths, finite timestamps, matching scope, maximum size, mode/line/client-key consistency, and 12-hour expiry. Return `null` for every invalid input.

- [ ] **Step 4: Prove GREEN and commit**

Run:

```bash
pnpm exec vitest run tests/unit/shop-os-quote-editor-draft.test.ts --maxWorkers=1
pnpm exec tsc --noEmit --pretty false
git diff --check
```

Expected: codec tests, TypeScript, and diff check pass.

Commit:

```bash
git add lib/shop-os/quote-editor-draft.ts tests/unit/shop-os-quote-editor-draft.test.ts
git commit -m "feat: preserve bounded quote drafts"
```

---

### Task 2: Make the job action and editor one local interaction

**Files:**
- Modify: `components/screens/manual-quote-builder.tsx`
- Modify: `components/screens/manual-quote-builder.module.css`
- Modify: `tests/unit/shop-os-manual-quote-builder.test.tsx`

**Interfaces:**
- Consumes: Task 1 draft key/codec.
- Produces: optional `actorId?: string | null` prop on `ManualQuoteBuilder`.
- Produces: active add-button semantics, immediate editor placement, draft recovery, local success status, and `data-change-state="confirmed"` bay-pulse targeting.

- [ ] **Step 1: Write RED interaction tests**

Add tests that prove:

```ts
const add = screen.getByRole('button', { name: 'Add part' })
await user.click(add)
expect(add).toHaveAttribute('aria-expanded', 'true')
expect(add).toHaveAttribute('aria-controls', expect.stringContaining(JOB_ID))
expect(screen.getByRole('heading', { name: 'Add part line' }))
  .toBeInTheDocument()
expect(add.compareDocumentPosition(screen.getByRole('form')) & Node.DOCUMENT_POSITION_FOLLOWING)
  .toBeTruthy()
```

Also prove the editor precedes the diagnostic story, cancel restores invoker focus and clears storage, dirty input writes one scoped draft, remount restores it for the same actor/ticket, invalid or other-actor storage is ignored and deleted, failed saves retain it, successful strict refresh clears it, the confirmed line receives the live status and change marker, and only the active job/action is marked.

- [ ] **Step 2: Prove RED**

Run:

```bash
pnpm exec vitest run tests/unit/shop-os-manual-quote-builder.test.tsx --maxWorkers=1
```

Expected: new placement, semantics, draft, and confirmation assertions fail.

- [ ] **Step 3: Integrate recovery without changing server truth**

Add an optional `actorId` prop. On first mount with an actor, read the scoped session key, parse it, and restore only when the current builder contains its job and, for edits, its exact mutable line. Delete rejected/stale storage. Persist after dirty field changes; clear on save success, explicit cancel/discard, or missing target. Register `beforeunload` only while dirty so the browser warns on destructive navigation.

- [ ] **Step 4: Move and name the editor**

Render `LineEditor` immediately after `.addActions` and before `StoryCard`. Give the form a deterministic ID and accessible name. For each add button, compute whether it owns the active editor and render:

```tsx
aria-expanded={active}
aria-controls={active ? editorId : undefined}
data-active={active ? 'true' : undefined}
{active ? `Adding ${kind}` : `Add ${kind}`}
```

Keep exactly one editor and the existing discard modal. Store the invoker key in editor state so cancel and discard restore the exact control rather than a generic part button.

- [ ] **Step 5: Add server-confirmed orientation**

After `refreshQuote()` validates the expected line/job, set a concise `role="status"` message and a `confirmedTarget` key. Mark only the matching line/job with `data-change-state="confirmed"`; clear the marker after the CSS cue while leaving focus on that server-confirmed row. Do not announce or animate before the strict refresh succeeds.

- [ ] **Step 6: Add restrained responsive styling**

Style `[data-active='true']` as the selected local tool and `.line[data-change-state='confirmed']` / `.job[data-change-state='confirmed']` with a 220 ms cobalt border/background pulse. Add `min-width: 0`, `overflow-wrap: anywhere`, and intentional money wrapping/nowrap rules to every flex/grid child that can contain user text. Under reduced motion, remove animation but retain a static confirmed edge.

- [ ] **Step 7: Prove GREEN and commit**

Run:

```bash
pnpm exec vitest run tests/unit/shop-os-quote-editor-draft.test.ts tests/unit/shop-os-manual-quote-builder.test.tsx tests/unit/shop-os-story-review-ui.test.tsx tests/unit/shop-os-quote-approval-ui.test.tsx --maxWorkers=2
pnpm exec tsc --noEmit --pretty false
git diff --check
```

Expected: focused interaction, adjacent story/approval, TypeScript, and diff checks pass.

Commit:

```bash
git add components/screens/manual-quote-builder.tsx components/screens/manual-quote-builder.module.css tests/unit/shop-os-manual-quote-builder.test.tsx
git commit -m "feat: reveal quote work at the action"
```

---

### Task 3: Preserve mounted-workspace attention and actor scope

**Files:**
- Modify: `components/screens/ticket-detail.tsx`
- Modify: `components/screens/inline-quote-workspace.tsx`
- Modify: `app/(app)/tickets/[id]/quote/page.tsx`
- Modify: `tests/unit/shop-os-ticket-detail.test.tsx`
- Modify: `tests/unit/shop-os-inline-quote-workspace.test.tsx`

**Interfaces:**
- Consumes: `ManualQuoteBuilder.actorId` from Task 2.
- Produces: `InlineQuoteWorkspace.actorId: string` and a stable focusable workspace boundary.

- [ ] **Step 1: Write RED mounted-attention tests**

Prove `Build quote` exposes `aria-controls`, immediate loading status is inside that controlled region, the region receives focus once after opening, loaded content does not cause a second disruptive focus jump, close restores the opener, and the exact current profile ID reaches `ManualQuoteBuilder`. Prove the direct quote page passes `ctx.profile.id` as well.

- [ ] **Step 2: Prove RED**

Run:

```bash
pnpm exec vitest run tests/unit/shop-os-ticket-detail.test.tsx tests/unit/shop-os-inline-quote-workspace.test.tsx --maxWorkers=1
```

Expected: controlled-region, focus, and actor propagation assertions fail.

- [ ] **Step 3: Implement the stable boundary**

Give the mounted quote region a deterministic ID derived from the ticket ID. Pass `currentProfileId` through `InlineQuoteWorkspace` to `ManualQuoteBuilder`. Keep one wrapper boundary mounted across loading/error/loaded states, focus it once when opened, and use `aria-busy` plus the existing visible status. Preserve the full-page route only as the existing failure fallback; do not add navigation.

- [ ] **Step 4: Prove GREEN and commit**

Run:

```bash
pnpm exec vitest run tests/unit/shop-os-ticket-detail.test.tsx tests/unit/shop-os-inline-quote-workspace.test.tsx tests/unit/shop-os-manual-quote-builder.test.tsx --maxWorkers=2
pnpm exec tsc --noEmit --pretty false
git diff --check
```

Expected: mounted attention, actor scope, quote interactions, TypeScript, and diff checks pass.

Commit:

```bash
git add 'app/(app)/tickets/[id]/quote/page.tsx' components/screens/ticket-detail.tsx components/screens/inline-quote-workspace.tsx tests/unit/shop-os-ticket-detail.test.tsx tests/unit/shop-os-inline-quote-workspace.test.tsx
git commit -m "feat: keep quote attention mounted"
```

---

### Task 4: Prove long-content, role, and release behavior

**Files:**
- Create: `tests/e2e/shop-os-live-workbench.spec.ts`
- Modify: `playwright.golden.config.ts`
- Modify: `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`

**Interfaces:**
- Consumes: the existing synthetic Golden Browser QA tenant, cleanup harness, and Task 1–3 UI contract.
- Produces: phone/desktop evidence for all four roles and plan Rows 55–56 receipts.

- [ ] **Step 1: Add rendered stress assertions**

Use synthetic-only concerns and line fields near maximum supported lengths. At 390×844 and 1440×900, assert:

```ts
expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
await expect(page.getByRole('button', { name: 'Adding part' })).toHaveAttribute('aria-expanded', 'true')
await expect(page.getByRole('heading', { name: 'Add part line' })).toBeInViewport()
await expect(page.getByRole('status')).toContainText('Part added')
```

Exercise same-tab reload recovery, retry retention, save clearing, sticky-action clearance, keyboard focus, reduced motion, and absence of diagnostic/media controls. For each role, prove quote build/view access and forbidden approval/close controls according to current capability rules.

- [ ] **Step 2: Run focused browser and accessibility verification**

Run the existing synthetic QA provision/test path against a local production build first, then the authenticated hosted QA path. Expected: phone and desktop pass with zero serious/critical axe violations, no horizontal overflow, no console/framework errors, and cleanup count zero.

- [ ] **Step 3: Run static and full regression gates**

Run:

```bash
pnpm exec tsc --noEmit --pretty false
pnpm build
pnpm test
git diff --check
```

If the full suite needs project-safe sharding, run the existing eight serialized shards with at most two workers and record the summed count. Expected: all tests, 64-page build, TypeScript, and diff checks pass.

- [ ] **Step 4: Update the active ShopOS plan**

Record Row 55 as the already-complete authenticated Golden Shop Day at merged main SHA `80c1c3b`. Record Row 56 as this live-workbench slice with exact test, browser, review, PR, merge, deploy, and production receipts. Do not create a separate handoff or completion document.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/shop-os-live-workbench.spec.ts playwright.golden.config.ts docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md
git commit -m "test: prove the live quote workbench"
```

---

### Task 5: Converge review and release

**Files:**
- Modify only files implicated by consolidated findings.

**Interfaces:**
- Produces: one consolidated static/security/runtime finding set, one repair wave, one focused re-review, and final source/production proof.

- [ ] **Step 1: Review the complete diff**

Review concurrency, storage privacy, cross-actor isolation, stale server targets, focus behavior, reduced motion, long-content containment, role authority, failure recovery, and rollback. Consolidate all blocking findings before editing.

- [ ] **Step 2: Repair once and re-review once**

Write a failing regression for every accepted finding, apply one repair wave, run focused tests, then perform one focused re-review. A new unrelated Critical/Important finding triggers the documented architecture stop.

- [ ] **Step 3: Run final verification**

Run focused tests, eight serialized full-suite shards, TypeScript, production build, diff guards, authenticated phone/desktop journeys, accessibility checks, and synthetic cleanup. Review `git diff origin/main...HEAD` for unrelated change and secret/PII leakage.

- [ ] **Step 4: Publish through the normal gate**

Push the branch, open the PR, wait for GitGuardian and Vercel checks, and merge only under the existing production authority. Verify the exact merged SHA is deployed, rerun the authenticated phone/desktop live-workbench journey, prove zero QA operational rows, and record final Row 56 receipts.

---

## Self-review receipt

- **Spec coverage:** Every objective clause maps to Tasks 1–4; release convergence maps to Task 5.
- **Scope:** One client draft codec and three existing mounted-workspace files; no backend or schema work.
- **Type consistency:** `actorId`, `QuoteEditorDraft`, storage key, and change-target naming are consistent across tasks.
- **Placeholders:** No `TBD`, deferred implementation, or unspecified error-handling step remains.
- **Rollback:** Git revert plus scoped session-key deletion restores pre-slice behavior without data migration.
