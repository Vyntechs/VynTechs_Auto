# ShopOS No-Media Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` task by task. Use `superpowers:test-driven-development` for every code task and `superpowers:verification-before-completion` before any completion claim. Keep the production purge closed; it has its own plan.

**Goal:** Make production ShopOS accept, require, expose, or advertise no operational media; turn the current diagnostic engine globally off; preserve users, jobs, notes, status, structured measurements, and immutable business history.

**Architecture:** Put one fail-closed server release policy ahead of comp and shop entitlements, and a separate compile-time media-off policy ahead of every body parse, storage access, download, and extraction. Remove media projections and controls from active ShopOS flows. Keep current schemas readable for legacy snapshots while preventing every new quote or story from acquiring media references. Do not drop tables, rewrite history, touch AutoEYE, or delete production data in this release.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6, Drizzle ORM, Supabase auth/storage boundary, Zod 4, Vitest 4, Testing Library.

## Global constraints

- The approved design in `docs/superpowers/specs/2026-07-15-shop-os-no-media-shutdown-and-purge-design.md` is authoritative.
- Finish and verify Row 47 before opening or publishing Row 49. Keep Row 49 out of PR #167.
- Before shared diagnostic-path edits, append the bounded FYI entry to `docs/operations/2026-07-14-autoeye-lane-coordination.md`.
- Do not push, open/modify a PR, merge, deploy, alter Vercel configuration, or touch production in this local execution lane without its separate authority gate.
- Do not change AutoEYE retrieval, receipt, benchmark, corpus, topology, reasoning, risk thresholds, pricing, Stripe mapping, or protected historical records.
- Operational media means uploaded/captured photos, video, audio, scan screens, wiring diagrams, documents, or text files. Static application assets and structured non-file data remain.
- `DIAGNOSTICS_RELEASE` recognizes only `legacy` and `off`. Missing/unknown values fail to `off`; production remains hard-off until a later reviewed code release explicitly permits a production engine.
- The diagnostic route boundary is exact: gate `/sessions`, `/api/sessions`, exact `/api/intake/submit`, and `/api/artifacts`. Do not gate `/intake`, `/api/intake/search`, or `/api/intake/decode-vin`; those are the live Counter work-order intake and its non-diagnostic lookup helpers.
- Operational media has no enablement environment variable. It is compile-time `off`; a future Evidence Vault requires a separate reviewed design and release.
- Disabled media handlers authenticate and enforce base account access, then return the same `404 { error: 'not_available' }` before resource lookup or byte access.
- Every intake and diagnostic handler authenticates before parsing. Counter search/VIN helpers enforce base paywall access; session-producing intake and ticket-job diagnostic start enforce the diagnostic release before body parsing or provider work.
- Public, authentication, subscription, and install surfaces must describe the current ShopOS release truthfully. Delete the unauthenticated `/design` diagnostic fixture and its direct-public diagnostic screenshot assets; do not widen diagnostic middleware prefixes to hide either mistake.
- Preserve V1 quote/story parsers for immutable historical values. New writes must be media-free; old UUID references remain inert and unserved.
- Do not create a media backup, drop `artifacts` or `job_attachments`, or run the purge plan during this release.
- Each commit must be independently reviewable and leave its focused test set green.

## File map

### Create

- `lib/release-policy.ts`: fail-closed diagnostic and operational-media release contract plus shared not-available response data.
- `tests/unit/release-policy.test.ts`: malformed/missing/production diagnostic policy and constant media-off tests.
- `tests/unit/capture-route.test.ts`: capture refusal before multipart, storage, metadata, or extraction.
- `tests/unit/curator-case-detail-no-media.test.ts`: curator detail performs no artifact query and exposes no artifact projection.
- `tests/unit/shop-os-vehicle-history-page.test.tsx`: diagnostic-off vehicle history performs no session query or link projection.
- `tests/unit/no-operational-media-source.test.ts`: source contract catches literal JSX file inputs across double-quoted, single-quoted, and brace-wrapped forms.
- `tests/unit/subscribe-client.test.tsx`: subscription recovery preserves the approved price while promising only current ShopOS access.
- `tests/unit/public-no-media-copy.test.ts`: exhaustive public-home, metadata, pricing, legal, diagnostic-off, and no-media truth assertions.
- `tests/unit/no-media-bootstrap.test.ts`: source/bootstrap contract proving no operational-media bucket creation.

### Modify

- `tests/setup.ts`: explicitly opt legacy diagnostic tests into the old engine while production defaults stay off.
- `lib/entitlements.ts`: resolve the global release before comp, explicit rows, or grandfathering.
- `lib/auth-access.ts`: remove the comp bypass; define the exact diagnostic path boundary; emit the global-off API response.
- `middleware.ts`: use the same global-off response for only the exact diagnostic page/API boundary.
- `tests/unit/entitlements.test.ts`
- `tests/unit/entitlement-gate-route.test.ts`
- `tests/unit/auth-access.test.ts`
- `app/api/intake/search/route.ts`
- `app/api/intake/decode-vin/route.ts`
- `app/api/intake/submit/route.ts`
- `tests/unit/intake-search-route.test.ts`
- `tests/unit/decode-vin-route.test.ts`
- `tests/unit/intake-decode-vin.test.ts`
- `tests/unit/intake-submit-route.test.ts`
- `tests/unit/intake-page-wiring.test.tsx`
- `tests/unit/counter-intake.test.tsx`
- `tests/unit/shop-os-counter-ticket-route.test.ts`
- `tests/unit/shop-os-counter-ticket.test.ts`
- `app/api/tickets/[id]/jobs/[jobId]/diagnostic/start/route.ts`
- `tests/unit/shop-os-diagnostic-start-route.test.ts`
- `app/api/sessions/[id]/capture/route.ts`
- `app/api/artifacts/[id]/extract/route.ts`
- `tests/unit/artifact-extract-route.test.ts`
- `app/api/tickets/[id]/jobs/[jobId]/attachments/route.ts`
- `app/api/tickets/[id]/jobs/[jobId]/attachments/[attachmentId]/route.ts`
- `tests/unit/shop-os-job-attachment-routes.test.ts`
- `lib/shop-os/simple-work.ts`
- `lib/shop-os/simple-work-ui.ts`
- `components/screens/simple-work-workspace.tsx`
- `components/screens/simple-work-workspace.module.css`
- `tests/unit/shop-os-simple-work.test.ts`
- `tests/unit/shop-os-simple-work-ui.test.ts`
- `tests/unit/shop-os-simple-work-workspace.test.tsx`
- `lib/storage/client.ts`
- `tests/unit/storage.test.ts`
- `lib/ai/customer-story.ts`
- `lib/shop-os/customer-stories.ts`
- `app/api/tickets/[id]/quote/jobs/[jobId]/story/route.ts`
- `components/screens/manual-quote-builder.tsx`
- `lib/shop-os/quote-builder-ui.ts`
- `lib/shop-os/quotes.ts`
- customer-story and quote tests named in Task 6
- `components/screens/decline-or-defer-live.tsx`
- `components/screens/decline-or-defer.tsx`
- `tests/unit/decline-or-defer-screen.test.tsx`
- `lib/curator/case-detail-query.ts`
- `app/curator/cases/[sessionId]/page.tsx`
- `app/(app)/today/page.tsx`
- `components/screens/today-home.tsx`
- `components/screens/today-jobs-board.tsx`
- `components/comeback/follow-up-panel.tsx`
- `app/(app)/tickets/[id]/page.tsx`
- `components/screens/ticket-detail.tsx`
- `app/(app)/vehicles/[vehicleId]/page.tsx`
- `components/screens/vehicle-history.tsx`
- their focused tests named in Task 8
- `app/layout.tsx`
- `app/manifest.ts`
- `app/page.tsx`
- `app/(auth)/sign-in/page.tsx`
- `components/screens/subscribe-client.tsx`
- `components/marketing/nav.tsx`
- `components/marketing/hero.tsx`
- `components/marketing/hero-terminal.tsx`
- `components/marketing/strip.tsx`
- `components/marketing/faq.tsx`
- `components/marketing/pricing.tsx`
- `components/marketing/footer.tsx`
- `components/marketing/compare.tsx`
- `components/marketing/why.tsx`
- `components/marketing/ladder.tsx`
- `components/marketing/gate.tsx`
- `components/marketing/final-cta.tsx`
- `components/marketing/screenshots.config.ts`
- `components/marketing/reel.tsx`
- `app/privacy/page.tsx`
- `app/terms/page.tsx`
- `tests/unit/manifest.test.ts`
- `tests/unit/sign-in-page.test.tsx`
- `tests/e2e/landing.spec.ts`
- `AGENTS.md`
- `docs/RESTORE.md`
- `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`
- `docs/strategy/SHOP_OS_DRIVER_STATE.md`
- `docs/operations/2026-07-14-autoeye-lane-coordination.md`

### Delete

- `components/session/photo-capture.tsx`
- `components/session/audio-capture.tsx`
- `components/session/video-capture.tsx`
- `tests/unit/shop-os-job-attachments.test.ts`
- `app/design/page.tsx`
- `public/marketing/screenshots/hero.png`
- `public/marketing/screenshots/laptop-hero.png`
- `public/marketing/screenshots/motion-01-open.png`
- `public/marketing/screenshots/motion-02-research.png`
- `public/marketing/screenshots/motion-03-propose.png`
- `public/marketing/screenshots/motion-04-confirm.png`
- `public/marketing/screenshots/motion-05-lock.png`
- `supabase/storage-setup.sql`

### Intentionally retain unchanged

- `lib/db/schema.ts`: dormant media tables and legacy JSON types remain for compatibility.
- `lib/shop-os/customer-story-contracts.ts`: parses historical artifact UUIDs.
- `lib/shop-os/quote-math.ts`: parses V1 attachment and story-reference history.
- immutable `quote_versions.snapshot` values and existing mutable story JSON.
- structured ambient-condition capture.

---

### Task 1: Establish the clean Row 49 lane and coordination boundary

**Files:**
- Modify: `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`
- Modify: `docs/strategy/SHOP_OS_DRIVER_STATE.md`
- Modify: `docs/operations/2026-07-14-autoeye-lane-coordination.md`

- [ ] **Step 1: Prove Row 47 is ready and Row 46 is already integrated**

Run:

```bash
git fetch origin main
git merge-base --is-ancestor e2d6454 origin/main
git merge-base --is-ancestor 743f7df origin/main
rg -n "\\| 4[6789] \\|" docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md
git status --short
```

Expected: both ancestry checks exit `0`; Row 46 can be reconciled complete; Row 47 is the only active foundation row; the no-media work is not mixed into PR #167. If Row 47 is not verified/ready, stop Row 49 and complete `2026-07-15-adaptive-shop-os-wave-1a.md` first.

- [ ] **Step 2: Create a separate local Row 49 worktree**

From the verified Row 47 head, create `feat/shop-os-no-media` in a new worktree. Do not reuse the PR #167 worktree. Copy or cherry-pick only the approved no-media design and plan commits.

- [ ] **Step 3: Reconcile the active status table without claiming an unpublished PR**

Record migration `0036_shop_entitlements` as live and migrations `0033–0035` as unapplied. Mark Row 46 complete with PR #163 / `e2d6454`; leave Row 47 at its truthful state; leave Row 48 blocked. Add Row 49 under temporary exclusive lane `NM`, dependency set `17,20,23,24,46,47`, and status `pending` until its own draft PR exists.

- [ ] **Step 4: Update durable driver state**

Set Outcome, Current slice, Last proof, Next safe move, Open gates, Worker lanes, Stop only when, and Usage balance to the Row 47 → Row 49 → Bay Pulse sequence. Name production push/deploy/purge as separate gates.

- [ ] **Step 5: Append the bounded AutoEYE FYI**

Append the approved `controller → autoeye · FYI` Log entry naming the shared release paths and explicitly excluding AutoEYE receipt, benchmark, retrieval, corpus, topology, risk, pricing, engine schema, and protected history.

- [ ] **Step 6: Commit local ownership documentation**

```bash
git add docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md docs/strategy/SHOP_OS_DRIVER_STATE.md docs/operations/2026-07-14-autoeye-lane-coordination.md
git commit -m "docs: prepare ShopOS no-media lane"
```

Expected: one local-only documentation commit; no remote mutation.

---

### Task 2: Add fail-closed release policy and close diagnostic access globally

**Files:**
- Create: `lib/release-policy.ts`
- Create: `tests/unit/release-policy.test.ts`
- Modify: `tests/setup.ts`
- Modify: `lib/entitlements.ts`
- Modify: `lib/auth-access.ts`
- Modify: `middleware.ts`
- Modify: `tests/unit/entitlements.test.ts`
- Modify: `tests/unit/entitlement-gate-route.test.ts`
- Modify: `tests/unit/auth-access.test.ts`
- Modify: `app/api/intake/search/route.ts`
- Modify: `app/api/intake/decode-vin/route.ts`
- Modify: `app/api/intake/submit/route.ts`
- Modify: `tests/unit/intake-search-route.test.ts`
- Modify: `tests/unit/decode-vin-route.test.ts`
- Preserve/extend: `tests/unit/intake-decode-vin.test.ts`
- Modify: `tests/unit/intake-submit-route.test.ts`
- Preserve/extend: `tests/unit/intake-page-wiring.test.tsx`
- Preserve/extend: `tests/unit/counter-intake.test.tsx`
- Preserve/extend: `tests/unit/shop-os-counter-ticket-route.test.ts`
- Preserve/extend: `tests/unit/shop-os-counter-ticket.test.ts`
- Preserve/verify: `app/api/tickets/[id]/jobs/[jobId]/diagnostic/start/route.ts`
- Modify: `tests/unit/shop-os-diagnostic-start-route.test.ts`

**Interfaces:**

```ts
export type DiagnosticsRelease = 'off' | 'legacy'
export type OperationalMediaRelease = 'off'

export function getDiagnosticsRelease(): DiagnosticsRelease
export function isDiagnosticsReleaseEnabled(): boolean
export function getOperationalMediaRelease(): OperationalMediaRelease
export function isOperationalMediaEnabled(): false

export const OPERATIONAL_MEDIA_UNAVAILABLE = {
  status: 404,
  body: { error: 'not_available' },
} as const
```

`getDiagnosticsRelease()` returns `off` in production regardless of environment value. Outside production, only the exact value `legacy` enables the old engine; `off`, missing, empty, whitespace variants, and unknown strings return `off`. `getOperationalMediaRelease()` always returns `off`.

- [ ] **Step 1: Write release-policy and entitlement regressions first**

Prove:

- missing/unknown diagnostic configuration is off;
- test/local exact `legacy` is enabled;
- production `legacy` remains off;
- operational media is always off;
- paid/no-row, explicit-true, explicit-false, grandfathered, and comp shops all resolve diagnostics false when the release is off;
- release-off returns before querying `shop_entitlements`;
- base ShopOS access remains allowed for an active paid or comp user;
- `/sessions`, `/api/sessions`, and `/api/artifacts` are diagnostic prefixes with no prefix bleed;
- only exact `/api/intake/submit` is diagnostic-gated; `/intake`, `/api/intake/search`, `/api/intake/decode-vin`, and lookalike paths are not;
- Counter search and VIN decode authenticate, enforce base paywall/deactivation access, and only then parse or call their domain dependency; diagnostics-off and a false shop entitlement do not block them;
- the `/intake` page still composes Counter intake and an owner can create the existing manual-findings-capable work order while diagnostics is off;
- `/api/intake/submit` authenticates and applies the diagnostic gate before parsing, creating a session, or invoking retrieval/provider work;
- ticket-job diagnostic start authenticates first, preserves base paywall/deactivation rejection, then returns global-off `404 not_available` before request parsing, acquisition, quota, session-cap, or provider work;
- global-off diagnostic API refusal is `404 not_available`, while legacy-mode shop entitlement refusal remains the existing `403 entitlement`.

- [ ] **Step 2: Run focused tests and confirm RED**

```bash
pnpm vitest run \
  tests/unit/release-policy.test.ts \
  tests/unit/entitlements.test.ts \
  tests/unit/entitlement-gate-route.test.ts \
  tests/unit/auth-access.test.ts \
  tests/unit/intake-search-route.test.ts \
  tests/unit/decode-vin-route.test.ts \
  tests/unit/intake-decode-vin.test.ts \
  tests/unit/intake-submit-route.test.ts \
  tests/unit/intake-page-wiring.test.tsx \
  tests/unit/counter-intake.test.tsx \
  tests/unit/shop-os-counter-ticket-route.test.ts \
  tests/unit/shop-os-counter-ticket.test.ts \
  tests/unit/shop-os-diagnostic-start-route.test.ts
```

Expected: FAIL because the central release contract and global precedence do not exist.

- [ ] **Step 3: Implement the policy and test-only legacy baseline**

Put the production hard-off logic in `lib/release-policy.ts`. In `tests/setup.ts`, set `DIAGNOSTICS_RELEASE=legacy` only when the test process did not explicitly set a value so unchanged diagnostic-engine tests keep their current scope. Individual release tests must use `vi.stubEnv()` and `vi.unstubAllEnvs()` so environment state is restored explicitly.

- [ ] **Step 4: Resolve global release before all entitlement shortcuts**

In `resolveShopEntitlements()`, return `{ diagnostics: false }` before comp, shopless, row lookup, undefined-table fallback, explicit row, or grandfathered default when the release is off. In `checkAccess()`, replace the hard-coded comp diagnostics result with `resolveShopEntitlements(db, { shopId: profile.shopId, isComp: true })`.

- [ ] **Step 5: Align the exact middleware boundary and handler ordering**

Define the diagnostic route boundary as `/sessions` and descendants, `/api/sessions` and descendants, exact `/api/intake/submit`, plus `/api/artifacts` and descendants. Remove `/intake` and broad `/api/intake` from that boundary. When diagnostics is globally off, API middleware and `entitlementReject()` return the same `404 not_available`; signed-in `/sessions` pages redirect to `/today`. In local/test `legacy` mode, preserve the existing per-shop `403 entitlement` behavior.

In search and VIN decode, move authentication ahead of body parsing, replace `entitlementReject()` with `paywallReject()`, then preserve the existing shop/domain behavior. Update both route-test mock contracts accordingly: `paywallReject()` is called only after authentication and before parsing/domain work, while `entitlementReject()` is neither imported nor called. Keep the lower-level VIN decoder tests unchanged except for any compatibility expectation genuinely affected by the route refactor. In intake submit, move authentication plus `entitlementReject()` ahead of body parsing and all retrieval/provider work. Keep the ticket-job diagnostic-start handler's authentication → entitlement/base-access → parsing order, and lock that composition together with the real release-policy/auth-access regressions rather than relying on the route's mocked helper alone.

- [ ] **Step 6: Run focused tests and commit**

```bash
pnpm vitest run \
  tests/unit/release-policy.test.ts \
  tests/unit/entitlements.test.ts \
  tests/unit/entitlement-gate-route.test.ts \
  tests/unit/auth-access.test.ts \
  tests/unit/intake-search-route.test.ts \
  tests/unit/decode-vin-route.test.ts \
  tests/unit/intake-decode-vin.test.ts \
  tests/unit/intake-submit-route.test.ts \
  tests/unit/intake-page-wiring.test.tsx \
  tests/unit/counter-intake.test.tsx \
  tests/unit/shop-os-counter-ticket-route.test.ts \
  tests/unit/shop-os-counter-ticket.test.ts \
  tests/unit/shop-os-diagnostic-start-route.test.ts
git add lib/release-policy.ts tests/setup.ts lib/entitlements.ts lib/auth-access.ts middleware.ts app/api/intake/search/route.ts app/api/intake/decode-vin/route.ts app/api/intake/submit/route.ts tests/unit/release-policy.test.ts tests/unit/entitlements.test.ts tests/unit/entitlement-gate-route.test.ts tests/unit/auth-access.test.ts tests/unit/intake-search-route.test.ts tests/unit/decode-vin-route.test.ts tests/unit/intake-decode-vin.test.ts tests/unit/intake-submit-route.test.ts tests/unit/intake-page-wiring.test.tsx tests/unit/counter-intake.test.tsx tests/unit/shop-os-counter-ticket-route.test.ts tests/unit/shop-os-counter-ticket.test.ts tests/unit/shop-os-diagnostic-start-route.test.ts
git commit -m "feat: turn diagnostic release off globally"
```

Expected: PASS; no comp or entitlement row can bypass the release, Counter intake remains available, and every session-producing path refuses before parsing or paid work.

---

### Task 3: Close every operational-media server route before bytes

**Files:**
- Modify: `app/api/sessions/[id]/capture/route.ts`
- Modify: `app/api/artifacts/[id]/extract/route.ts`
- Create: `tests/unit/capture-route.test.ts`
- Modify: `tests/unit/artifact-extract-route.test.ts`
- Modify: `app/api/tickets/[id]/jobs/[jobId]/attachments/route.ts`
- Modify: `app/api/tickets/[id]/jobs/[jobId]/attachments/[attachmentId]/route.ts`
- Modify: `tests/unit/shop-os-job-attachment-routes.test.ts`

**Contract:** Every handler authenticates and enforces base account access, then returns `OPERATIONAL_MEDIA_UNAVAILABLE`. It never awaits route IDs, probes tenant resources, parses a body, buffers a Blob, reads/downloads a file, signs a URL, inserts metadata, or calls an extractor.

- [ ] **Step 1: Write refusal-order tests first**

Cover all four route families:

- unauthenticated callers still receive `401`;
- paywalled/deactivated callers retain their current base-access rejection;
- any active caller receives exact `404 { error: 'not_available' }` for owned, missing, malformed-looking, and other-tenant IDs;
- a throwing `Request.formData()` is never called;
- storage upload/download/remove, metadata create/query, session/artifact lookup, Blob `arrayBuffer()`, and extraction spies remain at zero calls;
- capture/extract behavior stays closed in local `legacy` diagnostics mode, proving the independent media policy cannot reopen with diagnostics.

- [ ] **Step 2: Run route tests and confirm RED**

```bash
pnpm vitest run tests/unit/capture-route.test.ts tests/unit/artifact-extract-route.test.ts tests/unit/shop-os-job-attachment-routes.test.ts
```

Expected: FAIL because current handlers parse, query, store, download, or extract media.

- [ ] **Step 3: Replace diagnostic media handlers with authenticated stubs**

For capture and extraction, replace `entitlementReject` with base `paywallReject` inside the handler so the independent media policy is tested directly. Remove all capture, artifact lookup, storage, and extraction imports. Keep middleware diagnostics-off as the outer defense.

- [ ] **Step 4: Replace simple-work attachment handlers with authenticated stubs**

Keep `requireUserAndProfile`, `paywallReject`, and the non-null shop boundary. Return the shared 404 before reading params or request data. Remove attachment domain/storage imports and response bodies that reveal attachment state.

- [ ] **Step 5: Run route tests and commit**

```bash
pnpm vitest run tests/unit/capture-route.test.ts tests/unit/artifact-extract-route.test.ts tests/unit/shop-os-job-attachment-routes.test.ts
git add app/api/sessions/'[id]'/capture/route.ts app/api/artifacts/'[id]'/extract/route.ts app/api/tickets/'[id]'/jobs/'[jobId]'/attachments/route.ts app/api/tickets/'[id]'/jobs/'[jobId]'/attachments/'[attachmentId]'/route.ts tests/unit/capture-route.test.ts tests/unit/artifact-extract-route.test.ts tests/unit/shop-os-job-attachment-routes.test.ts
git commit -m "fix: refuse operational media before byte access"
```

Expected: PASS; direct route execution cannot touch media or reveal resource existence.

---

### Task 4: Make simple work truthful and text-only

**Files:**
- Modify: `lib/shop-os/simple-work.ts`
- Modify: `lib/shop-os/simple-work-ui.ts`
- Modify: `components/screens/simple-work-workspace.tsx`
- Modify: `components/screens/simple-work-workspace.module.css`
- Modify: `lib/storage/client.ts`
- Modify: `tests/unit/shop-os-simple-work.test.ts`
- Modify: `tests/unit/shop-os-simple-work-ui.test.ts`
- Modify: `tests/unit/shop-os-simple-work-workspace.test.tsx`
- Modify: `tests/unit/storage.test.ts`
- Delete: `tests/unit/shop-os-job-attachments.test.ts`

**Workspace contract:**

```ts
{
  id: string
  title: string
  kind: 'repair' | 'maintenance'
  workStatus: 'open' | 'in_progress' | 'done'
  workNotes: string | null
  updatedAt: string
  authorization: 'approved' | 'declined' | 'awaiting_approval'
}
```

- [ ] **Step 1: Change domain tests to the text-only contract**

Prove note-less completion returns `not_ready`; an authorized non-empty saved note completes with zero attachment rows; stale timestamp still conflicts; exact completed replay stays idempotent; workspace loading performs no attachment query and contains no `hasCompletionProof` or `attachments` key.

- [ ] **Step 2: Change UI tests to the text-only contract**

Prove mobile/desktop render no `input[type=file]`, `capture`, proof/download link, filename, upload/retry copy, or attachment fields. Completion enables after the saved non-empty note and reads `Requires a saved work note.` Modules are `01 Work note` and `02 Complete work`.

- [ ] **Step 3: Run focused tests and confirm RED**

```bash
pnpm vitest run tests/unit/shop-os-simple-work.test.ts tests/unit/shop-os-simple-work-ui.test.ts tests/unit/shop-os-simple-work-workspace.test.tsx tests/unit/storage.test.ts
```

Expected: FAIL on the current photo requirement and media projection.

- [ ] **Step 4: Remove attachment state from the domain**

Remove `jobAttachments` from `LockedContext`, `lockContext()`, and workspace loading. Completion checks only the non-empty trimmed saved note after existing authorization/status/concurrency checks. Remove `createJobAttachment`, `getJobAttachmentProof`, media MIME/signature/storage-key helpers, and their exports.

- [ ] **Step 5: Remove attachment state from UI contracts and components**

Delete attachment schemas, file classifiers, upload attempt helpers, proof state/refs/functions/list, and related styles. Preserve note save, completion, live status notices, keyboard behavior, and concern escalation.

- [ ] **Step 6: Remove now-unreachable simple-work storage functions**

Delete `uploadJobAttachment`, `removeJobAttachment`, `downloadJobAttachment`, and only their now-unused types/tests from `lib/storage/client.ts`. Leave diagnostic storage primitives until the route shutdown and later dead-code review prove no other internal consumer.

- [ ] **Step 7: Run focused tests and commit**

```bash
pnpm vitest run tests/unit/shop-os-simple-work.test.ts tests/unit/shop-os-simple-work-ui.test.ts tests/unit/shop-os-simple-work-workspace.test.tsx tests/unit/shop-os-job-attachment-routes.test.ts tests/unit/storage.test.ts
git add lib/shop-os/simple-work.ts lib/shop-os/simple-work-ui.ts components/screens/simple-work-workspace.tsx components/screens/simple-work-workspace.module.css lib/storage/client.ts tests/unit/shop-os-simple-work.test.ts tests/unit/shop-os-simple-work-ui.test.ts tests/unit/shop-os-simple-work-workspace.test.tsx tests/unit/shop-os-job-attachment-routes.test.ts tests/unit/storage.test.ts tests/unit/shop-os-job-attachments.test.ts
git commit -m "feat: make simple work completion text only"
```

Expected: PASS; existing done work remains done and current work never depends on media.

---

### Task 5: Remove diagnostic capture controls from every screen size

**Files:**
- Modify: `components/screens/decline-or-defer-live.tsx`
- Modify: `components/screens/decline-or-defer.tsx`
- Delete: `components/session/photo-capture.tsx`
- Delete: `components/session/audio-capture.tsx`
- Delete: `components/session/video-capture.tsx`
- Modify: `tests/unit/decline-or-defer-screen.test.tsx`
- Create: `tests/unit/no-operational-media-source.test.ts`

- [ ] **Step 1: Invert photo-path tests first**

For `whatWouldClose.kind='photo'`, assert there is no file input, capture attribute, Snap button, Uploading copy, media-device call, or `/capture` request. Confirm asks must still render and release the gate. Legacy string asks remain generic gather guidance.

Add a source-contract regression that recursively reads active `app/**/*.{ts,tsx}` and `components/**/*.{ts,tsx}` source and rejects literal file inputs with `/type\s*=\s*(?:"file"|'file'|\{\s*(?:"file"|'file')\s*\})/`. Because the test evaluates complete file strings, `\s*` must cover line breaks as well as spaces. It must demonstrate fixtures for `type="file"`, `type='file'`, `type={"file"}`, and `type={'file'}` all fail, then also reject `getUserMedia`, `MediaRecorder`, operational `/capture` calls, and `photoAsk`. Do not ban structured non-file ambient capture by component name.

- [ ] **Step 2: Run UI tests and confirm RED**

```bash
pnpm vitest run tests/unit/decline-or-defer-screen.test.tsx tests/unit/active-step-form.test.tsx tests/unit/active-session.test.tsx tests/unit/no-operational-media-source.test.ts
```

Expected: FAIL because the live photo hero still mounts an input and upload handler.

- [ ] **Step 3: Remove live and presentational photo affordances**

Remove file refs, handlers, hidden inputs, `photoAsk`, and the Snap block. Keep confirm asks, defer/gather choices, error handling, ambient structured capture, and non-media outcome capture. Delete the three unimported media capture components.

- [ ] **Step 4: Run focused tests and commit**

```bash
pnpm vitest run tests/unit/decline-or-defer-screen.test.tsx tests/unit/active-step-form.test.tsx tests/unit/active-session.test.tsx tests/unit/no-operational-media-source.test.ts
git add components/screens/decline-or-defer-live.tsx components/screens/decline-or-defer.tsx components/session/photo-capture.tsx components/session/audio-capture.tsx components/session/video-capture.tsx tests/unit/decline-or-defer-screen.test.tsx tests/unit/no-operational-media-source.test.ts
git commit -m "feat: remove diagnostic media controls"
```

Expected: PASS; no viewport or input mode exposes operational media capture.

---

### Task 6: Prevent new stories and quotes from acquiring media references

**Files:**
- Modify: `lib/ai/customer-story.ts`
- Modify: `lib/shop-os/customer-stories.ts`
- Modify: `app/api/tickets/[id]/quote/jobs/[jobId]/story/route.ts`
- Modify: `components/screens/manual-quote-builder.tsx`
- Modify: `lib/shop-os/quote-builder-ui.ts`
- Modify: `lib/shop-os/quotes.ts`
- Modify: `tests/unit/customer-story-generator.test.ts`
- Modify: `tests/unit/shop-os-customer-stories.test.ts`
- Modify: `tests/unit/shop-os-customer-story-route.test.ts`
- Modify: `tests/unit/shop-os-story-review-ui.test.tsx`
- Modify: `tests/unit/shop-os-quote-builder-ui.test.ts`
- Modify: `tests/unit/shop-os-quote-versions.test.ts`
- Preserve/extend: `tests/unit/shop-os-customer-story-contracts.test.ts`
- Preserve/extend: `tests/unit/shop-os-quote-math.test.ts`
- Preserve/extend: `tests/unit/shop-os-quote-decisions.test.ts`

**Compatibility contract:** New provider selection supports only event evidence. The story HTTP envelope retains `sourceArtifactIds` only as an exactly empty array, and the workspace retains `artifacts: []` / `nextArtifactCursor: null` so old clients fail predictably without a simultaneous schema version. Historical V1 parsers continue accepting inert UUID references.

- [ ] **Step 1: Write media-free new-write tests first**

Prove:

- provider schema cannot emit `sourceKind: 'artifact'`;
- non-empty POST `sourceArtifactIds` returns `422 invalid_input` before database/provider work;
- `artifactCursor` is rejected;
- workspace never queries artifacts and returns fixed empty artifact compatibility fields;
- generation locks/reads only selected event rows and always writes `sourceArtifactIds: []`;
- manual quote builder renders/selects event observations only and submits an empty artifact array;
- new quote versions emit `attachments: []` even when legacy attachment rows exist;
- quote creation rejects a mutable current story containing non-empty artifact IDs rather than stripping provenance;
- an existing V1 quote with attachment/artifact UUIDs still parses, renders non-media content, and remains decision-compatible;
- no immutable quote snapshot or stored story is rewritten.

- [ ] **Step 2: Run focused tests and confirm RED**

```bash
pnpm vitest run tests/unit/customer-story-generator.test.ts tests/unit/shop-os-customer-stories.test.ts tests/unit/shop-os-customer-story-route.test.ts tests/unit/shop-os-story-review-ui.test.tsx tests/unit/shop-os-quote-builder-ui.test.ts tests/unit/shop-os-quote-versions.test.ts tests/unit/shop-os-customer-story-contracts.test.ts tests/unit/shop-os-quote-math.test.ts tests/unit/shop-os-quote-decisions.test.ts
```

Expected: FAIL because artifact evidence and attachment snapshot writers remain.

- [ ] **Step 3: Make generation event-only without breaking legacy parsers**

Constrain the provider tool and domain selection to `event`. Remove artifact pagination/query/locking and artifact provider content from new generation. Keep the compatibility fields fixed empty. Do not narrow `parsePersistedCustomerStory()` or the V1 quote schema.

- [ ] **Step 4: Make quote preparation reject legacy media provenance and emit no attachments**

Remove `jobAttachments` from quote version locking and construction. Always set new job snapshot `attachments: []`. Before creating a new version, fail closed when the mutable current story contains any `sourceArtifactIds`; require current event/manual text evidence instead.

- [ ] **Step 5: Remove artifact controls from the quote builder**

Delete selected-artifact state, pagination, toggles, and rebase logic. Keep event selection, manual findings, optimistic revision behavior, and the empty compatibility array.

- [ ] **Step 6: Run focused tests and commit**

```bash
pnpm vitest run tests/unit/customer-story-generator.test.ts tests/unit/shop-os-customer-stories.test.ts tests/unit/shop-os-customer-story-route.test.ts tests/unit/shop-os-story-review-ui.test.tsx tests/unit/shop-os-quote-builder-ui.test.ts tests/unit/shop-os-quote-versions.test.ts tests/unit/shop-os-customer-story-contracts.test.ts tests/unit/shop-os-quote-math.test.ts tests/unit/shop-os-quote-decisions.test.ts
git add lib/ai/customer-story.ts lib/shop-os/customer-stories.ts app/api/tickets/'[id]'/quote/jobs/'[jobId]'/story/route.ts components/screens/manual-quote-builder.tsx lib/shop-os/quote-builder-ui.ts lib/shop-os/quotes.ts tests/unit/customer-story-generator.test.ts tests/unit/shop-os-customer-stories.test.ts tests/unit/shop-os-customer-story-route.test.ts tests/unit/shop-os-story-review-ui.test.tsx tests/unit/shop-os-quote-builder-ui.test.ts tests/unit/shop-os-quote-versions.test.ts tests/unit/shop-os-customer-story-contracts.test.ts tests/unit/shop-os-quote-math.test.ts tests/unit/shop-os-quote-decisions.test.ts
git commit -m "feat: keep new ShopOS stories and quotes media free"
```

Expected: PASS; new writes have no media refs while immutable history remains readable.

---

### Task 7: Remove curator artifact projection without touching history

**Files:**
- Modify: `lib/curator/case-detail-query.ts`
- Modify: `app/curator/cases/[sessionId]/page.tsx`
- Create: `tests/unit/curator-case-detail-no-media.test.ts`

- [ ] **Step 1: Write the curator no-media contract first**

Prove curator case detail still loads the session, text events, tree state, outcome, and review actions, but performs no `artifacts` table query and returns no `artifacts` property. The rendered page has no Artifacts heading, MIME type, byte count, extraction status, extracted media summary, storage key, or empty media placeholder. Historical media rows remain unchanged in the database.

- [ ] **Step 2: Run the focused test and confirm RED**

```bash
pnpm vitest run tests/unit/curator-case-detail-no-media.test.ts
```

Expected: FAIL because current curator detail queries and projects artifact metadata and extracted summaries.

- [ ] **Step 3: Remove only the live projection**

Remove the `artifacts` import/query/result field from `fetchCuratorCaseDetail()`. Update the case page to consume only session and event truth and delete the Artifacts section. Preserve curator authorization, diagnostic text history, outcome review, deferred/novel actions, and every stored row.

- [ ] **Step 4: Run the focused test and commit**

```bash
pnpm vitest run tests/unit/curator-case-detail-no-media.test.ts
git add lib/curator/case-detail-query.ts app/curator/cases/'[sessionId]'/page.tsx tests/unit/curator-case-detail-no-media.test.ts
git commit -m "feat: remove curator media projection"
```

Expected: PASS; no reachable curator surface queries or displays operational media.

---

### Task 8: Remove reachable diagnostic-engine links while preserving ShopOS intake and manual work

**Files:**
- Modify: `app/(app)/today/page.tsx`
- Modify: `components/screens/today-home.tsx`
- Modify: `components/screens/today-jobs-board.tsx`
- Modify: `components/comeback/follow-up-panel.tsx`
- Modify: `app/(app)/tickets/[id]/page.tsx`
- Modify: `components/screens/ticket-detail.tsx`
- Modify: `app/(app)/vehicles/[vehicleId]/page.tsx`
- Modify: `components/screens/vehicle-history.tsx`
- Modify: `tests/unit/today-home.test.tsx`
- Modify: `tests/unit/shop-os-today-jobs-board.test.tsx`
- Modify: `tests/unit/shop-os-today-page.test.tsx`
- Preserve/extend: `tests/unit/shop-os-manual-findings.test.ts`
- Modify: `tests/unit/follow-up-panel.test.tsx`
- Modify: `tests/unit/shop-os-ticket-detail.test.tsx`
- Modify: `tests/unit/vehicle-history.test.tsx`
- Create: `tests/unit/shop-os-vehicle-history-page.test.tsx`

- [ ] **Step 1: Write reachable-surface honesty tests first**

With diagnostics off, prove:

- Today does not call `listSessionsForShop()`, renders no legacy session queue/link, `/sessions/new`, `New diagnosis`, engine-start control, disabled engine placeholder, or add-on teaser;
- the owner-only `New work order` action still links to `/intake`, Quick ticket still links to `/tickets/new`, and the empty state points to available ShopOS work rather than diagnosis;
- a sessionless diagnostic job still offers `Record findings` through the existing manual text path;
- due follow-up actions remain usable but expose no `View case` or `/sessions/*` link;
- ticket detail preserves the job ledger, assignment, quote, and simple-work navigation but exposes no `Open diagnosis` link when off;
- vehicle history performs no diagnostic-session query and renders vehicle/customer truth without session cards or `/sessions/*` links; and
- existing jobs, repair/maintenance work, repair-order navigation, and stored diagnostic records remain unchanged.

- [ ] **Step 2: Run focused tests and confirm RED**

```bash
pnpm vitest run \
  tests/unit/today-home.test.tsx \
  tests/unit/shop-os-today-jobs-board.test.tsx \
  tests/unit/shop-os-today-page.test.tsx \
  tests/unit/shop-os-manual-findings.test.ts \
  tests/unit/follow-up-panel.test.tsx \
  tests/unit/shop-os-ticket-detail.test.tsx \
  tests/unit/vehicle-history.test.tsx \
  tests/unit/shop-os-vehicle-history-page.test.tsx
```

Expected: FAIL because Today and vehicle history still query diagnostic sessions and multiple reachable screens still link into globally closed session pages.

- [ ] **Step 3: Remove dead queries, links, controls, and false fallbacks**

Resolve diagnostic availability before Today session loading; when off, do not call `listSessionsForShop()` and pass no session queue. Keep due follow-up loading/actions, but conditionally omit its diagnostic case link. Make diagnostic component defaults/fallbacks false, remove the add-on teaser, hide engine-start controls entirely, and keep manual `Record findings`.

Pass the resolved diagnostic availability into ticket detail and omit only its session link when off. Remove `listSessionsForVehicle()` from the reachable vehicle page and remove diagnostic session cards from the vehicle-history component while retaining vehicle/customer facts and the `/intake` back path. Do not delete, close, or rewrite sessions.

- [ ] **Step 4: Run focused tests and commit**

```bash
pnpm vitest run \
  tests/unit/today-home.test.tsx \
  tests/unit/shop-os-today-jobs-board.test.tsx \
  tests/unit/shop-os-today-page.test.tsx \
  tests/unit/shop-os-manual-findings.test.ts \
  tests/unit/follow-up-panel.test.tsx \
  tests/unit/shop-os-ticket-detail.test.tsx \
  tests/unit/vehicle-history.test.tsx \
  tests/unit/shop-os-vehicle-history-page.test.tsx
git add app/'(app)'/today/page.tsx components/screens/today-home.tsx components/screens/today-jobs-board.tsx components/comeback/follow-up-panel.tsx app/'(app)'/tickets/'[id]'/page.tsx components/screens/ticket-detail.tsx app/'(app)'/vehicles/'[vehicleId]'/page.tsx components/screens/vehicle-history.tsx tests/unit/today-home.test.tsx tests/unit/shop-os-today-jobs-board.test.tsx tests/unit/shop-os-today-page.test.tsx tests/unit/shop-os-manual-findings.test.ts tests/unit/follow-up-panel.test.tsx tests/unit/shop-os-ticket-detail.test.tsx tests/unit/vehicle-history.test.tsx tests/unit/shop-os-vehicle-history-page.test.tsx
git commit -m "feat: present ShopOS without diagnostic engine links"
```

Expected: PASS; Counter intake and manual operating work remain useful while no reachable ShopOS surface sends a user into the closed engine.

---

### Task 9: Reconcile public product promises, legal truth, restore behavior, and fresh environments

**Files:**
- Modify: `app/layout.tsx`
- Modify: `app/manifest.ts`
- Modify: `app/page.tsx`
- Modify: `app/(auth)/sign-in/page.tsx`
- Modify: `components/screens/subscribe-client.tsx`
- Preserve/verify: `components/marketing/nav.tsx`
- Modify: `components/marketing/hero.tsx`
- Modify: `components/marketing/hero-terminal.tsx`
- Modify: `components/marketing/strip.tsx`
- Modify: `components/marketing/faq.tsx`
- Modify: `components/marketing/pricing.tsx`
- Modify: `components/marketing/footer.tsx`
- Modify: `components/marketing/compare.tsx`
- Modify: `components/marketing/why.tsx`
- Modify: `components/marketing/ladder.tsx`
- Modify: `components/marketing/gate.tsx`
- Modify: `components/marketing/final-cta.tsx`
- Modify: `components/marketing/screenshots.config.ts`
- Modify: `components/marketing/reel.tsx`
- Modify: `app/privacy/page.tsx`
- Modify: `app/terms/page.tsx`
- Modify: `tests/unit/manifest.test.ts`
- Modify: `tests/unit/sign-in-page.test.tsx`
- Create: `tests/unit/subscribe-client.test.tsx`
- Modify: `tests/e2e/landing.spec.ts`
- Delete: `app/design/page.tsx`
- Delete: `public/marketing/screenshots/hero.png`
- Delete: `public/marketing/screenshots/laptop-hero.png`
- Delete: `public/marketing/screenshots/motion-01-open.png`
- Delete: `public/marketing/screenshots/motion-02-research.png`
- Delete: `public/marketing/screenshots/motion-03-propose.png`
- Delete: `public/marketing/screenshots/motion-04-confirm.png`
- Delete: `public/marketing/screenshots/motion-05-lock.png`
- Delete: `supabase/storage-setup.sql`
- Modify: `AGENTS.md`
- Modify: `docs/RESTORE.md`
- Create: `tests/unit/public-no-media-copy.test.ts`
- Create: `tests/unit/no-media-bootstrap.test.ts`

- [ ] **Step 1: Write source-contract tests first**

Build the source-contract test from the complete public-home composition, not only known phrases: `app/page.tsx`, metadata, manifest, Nav, Hero, HeroTerminal, Strip, Why, Ladder, Gate, Pricing, Compare, FAQ, FinalCTA, Footer, and any component those surfaces import for product demonstration. Extend the same truth boundary to sign-in, subscription recovery, retained screenshot/reel configuration, Privacy, Terms, bootstrap instructions, and restore docs. The test must fail if the home composition later imports an unscanned marketing product component. Ban active media capability phrases including `Files you upload`, `stores the files you upload`, `uploaded file contents`, `snap a photo of the screen`, and `Direct capture’s on the list`.

Also ban every unavailable diagnostic demo or outcome claim, not just the word `diagnostic`: current examples of automated steps, AI reasoning, confidence thresholds, destructive-work gates, three-question deferral, learned closed cases, diagnostic session history, and system-specific repair calls must disappear from the active public offer. Ban known phrases including `AI-led diagnostic assistant`, `AI master tech for the bay`, `Unlimited diagnostic sessions`, `The full diagnostic`, `A diagnostic for working technicians`, `Knows how the system works`, `confidence line`, `questions max before it defers`, `Session log`, `your sessions`, and `back to diagnosing`, plus unqualified legal statements that the current Vyntechs service is a diagnostic tool. Require truthful ShopOS positioning around work orders, assignments, job flow, authorization, quotes, status, manual findings, and text work notes; require a factual statement that operational file intake and the diagnostic engine are unavailable in the current release. Manifest, sign-in, and subscription tests must assert the ShopOS wording while preserving install behavior, authentication redirects, the approved $100 price, and checkout behavior.

Prove `app/design/page.tsx` is absent without adding `/design` to the diagnostic route boundary. Because authentication middleware runs before route resolution, an anonymous `/design` request must keep the normal sign-in redirect; an authenticated, base-authorized request must reach the framework `404`. Prove all seven obsolete diagnostic PNGs are absent from `public/marketing/screenshots`, no app/component source references their former public URLs, and direct HTTP requests for representative former URLs return `404`. The test must distinguish these false-current diagnostic assets from allowed brand icons, fonts, and other static application shell assets.

Require the interim Privacy policy to state all three truths together: new operational uploads are off; historical uploaded submissions or related metadata may still remain until the separately authorized production purge is verified; and Vyntechs is not claiming deletion from provider temporary systems or infrastructure backups. Ban absolute pre-purge claims such as all media deleted, no historical uploads remain, or backups/provider copies were purged. Prove the Privacy and Terms effective dates reflect this material publication rather than the superseded May dates. Prove no canonical bootstrap file/instruction creates an `artifacts` bucket.

- [ ] **Step 2: Run tests and confirm RED**

```bash
pnpm vitest run tests/unit/public-no-media-copy.test.ts tests/unit/no-media-bootstrap.test.ts tests/unit/manifest.test.ts tests/unit/sign-in-page.test.tsx tests/unit/subscribe-client.test.tsx
pnpm exec playwright test tests/e2e/landing.spec.ts
```

Expected: FAIL on the diagnostic manifest/auth/subscription copy, public `/design` fixture, obsolete diagnostic images, landing promise, and pre-purge Privacy ambiguity.

- [ ] **Step 3: Make metadata, marketing, pricing, and legal copy true**

Position the current product as ShopOS for automotive work orders, job flow, quotes, status, and text notes. Review every component in the active `app/page.tsx` composition even when it does not contain a known banned phrase. Replace or remove the Hero/HeroTerminal diagnostic session, confidence statistics, system-reasoning strip, diagnostic Why/Ladder/Gate story, diagnostic comparison rows, session-based pricing promises, and session-based final CTA. Reuse the existing page structure only where it can demonstrate current shipped ShopOS truth—for example Counter intake → assignment → manual findings/work note → quote/status—without inventing Bay Pulse or any future feature. Replace diagnostic-engine promises in metadata, manifest description, sign-in return copy, subscription recovery, pricing inclusions, footer, comparison, and founder-problem copy without changing the approved $100-per-technician price, billing terms, authentication behavior, checkout behavior, or Stripe mapping.

Delete `app/design/page.tsx`; do not add `/design` to middleware exemptions or diagnostic prefixes. Preserve the existing anonymous sign-in redirect, and verify an authenticated, base-authorized request reaches the natural framework `404`. Delete the seven obsolete diagnostic PNGs from `public/marketing/screenshots` and remove every config/reel reference to them. Do not replace them with invented ShopOS screenshots in this release. Brand icons, fonts, and static shell assets remain.

FAQ says the current diagnostic engine and direct photo/capture are unavailable; it must not tease an add-on or imply typed scan-tool data enters a live engine. Privacy states new operational uploads are unavailable while plainly disclosing that historical submissions or related metadata may remain until the verified production purge; it explicitly avoids claiming deletion from provider temporary systems or infrastructure backups. Terms describes the paid ShopOS service truthfully, bounds file/diagnostic language to historical submissions or records where legally necessary, and retains appropriate professional-responsibility language without promising AI output. Update both effective dates to the publication date of this material change. The post-purge receipt must trigger a later Privacy update before any absolute zero-media claim is published.

- [ ] **Step 4: Make fresh and restored environments media-free**

Delete `supabase/storage-setup.sql` and its AGENTS instruction. Update RESTORE: operational storage is intentionally absent; old database backups may restore dormant metadata rows but never media bytes; Row 49 zero-media reconciliation must run before a restored environment reopens. Do not invoke the database backup workflow as a media backup.

- [ ] **Step 5: Run focused tests and commit**

```bash
pnpm vitest run tests/unit/public-no-media-copy.test.ts tests/unit/no-media-bootstrap.test.ts tests/unit/manifest.test.ts tests/unit/sign-in-page.test.tsx tests/unit/subscribe-client.test.tsx
pnpm exec playwright test tests/e2e/landing.spec.ts
git add app/layout.tsx app/manifest.ts app/page.tsx app/'(auth)'/sign-in/page.tsx components/screens/subscribe-client.tsx components/marketing/nav.tsx components/marketing/hero.tsx components/marketing/hero-terminal.tsx components/marketing/strip.tsx components/marketing/why.tsx components/marketing/ladder.tsx components/marketing/gate.tsx components/marketing/pricing.tsx components/marketing/compare.tsx components/marketing/faq.tsx components/marketing/final-cta.tsx components/marketing/footer.tsx components/marketing/screenshots.config.ts components/marketing/reel.tsx app/design/page.tsx public/marketing/screenshots/hero.png public/marketing/screenshots/laptop-hero.png public/marketing/screenshots/motion-01-open.png public/marketing/screenshots/motion-02-research.png public/marketing/screenshots/motion-03-propose.png public/marketing/screenshots/motion-04-confirm.png public/marketing/screenshots/motion-05-lock.png app/privacy/page.tsx app/terms/page.tsx supabase/storage-setup.sql AGENTS.md docs/RESTORE.md tests/unit/public-no-media-copy.test.ts tests/unit/no-media-bootstrap.test.ts tests/unit/manifest.test.ts tests/unit/sign-in-page.test.tsx tests/unit/subscribe-client.test.tsx tests/e2e/landing.spec.ts
git commit -m "docs: make current ShopOS promises true"
```

Expected: PASS; public product claims match the globally-off release and no fresh-project instruction can recreate operational storage.

---

### Task 10: Integrate, pressure-test, and prepare the release gate

**Files:**
- Modify: `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`
- Modify: `docs/strategy/SHOP_OS_DRIVER_STATE.md`
- Modify: `tasks/lessons.md` only if a new correction occurred

- [ ] **Step 1: Run the complete focused proof**

```bash
pnpm vitest run \
  tests/unit/release-policy.test.ts \
  tests/unit/entitlements.test.ts \
  tests/unit/entitlement-gate-route.test.ts \
  tests/unit/auth-access.test.ts \
  tests/unit/intake-search-route.test.ts \
  tests/unit/decode-vin-route.test.ts \
  tests/unit/intake-decode-vin.test.ts \
  tests/unit/intake-submit-route.test.ts \
  tests/unit/intake-page-wiring.test.tsx \
  tests/unit/counter-intake.test.tsx \
  tests/unit/shop-os-counter-ticket-route.test.ts \
  tests/unit/shop-os-counter-ticket.test.ts \
  tests/unit/shop-os-diagnostic-start-route.test.ts \
  tests/unit/capture-route.test.ts \
  tests/unit/artifact-extract-route.test.ts \
  tests/unit/shop-os-job-attachment-routes.test.ts \
  tests/unit/shop-os-simple-work.test.ts \
  tests/unit/shop-os-simple-work-ui.test.ts \
  tests/unit/shop-os-simple-work-workspace.test.tsx \
  tests/unit/storage.test.ts \
  tests/unit/decline-or-defer-screen.test.tsx \
  tests/unit/active-step-form.test.tsx \
  tests/unit/active-session.test.tsx \
  tests/unit/no-operational-media-source.test.ts \
  tests/unit/customer-story-generator.test.ts \
  tests/unit/shop-os-customer-stories.test.ts \
  tests/unit/shop-os-customer-story-route.test.ts \
  tests/unit/shop-os-story-review-ui.test.tsx \
  tests/unit/shop-os-quote-builder-ui.test.ts \
  tests/unit/shop-os-quote-versions.test.ts \
  tests/unit/shop-os-customer-story-contracts.test.ts \
  tests/unit/shop-os-quote-math.test.ts \
  tests/unit/shop-os-quote-decisions.test.ts \
  tests/unit/curator-case-detail-no-media.test.ts \
  tests/unit/today-home.test.tsx \
  tests/unit/shop-os-today-jobs-board.test.tsx \
  tests/unit/shop-os-today-page.test.tsx \
  tests/unit/shop-os-manual-findings.test.ts \
  tests/unit/follow-up-panel.test.tsx \
  tests/unit/shop-os-ticket-detail.test.tsx \
  tests/unit/vehicle-history.test.tsx \
  tests/unit/shop-os-vehicle-history-page.test.tsx \
  tests/unit/manifest.test.ts \
  tests/unit/sign-in-page.test.tsx \
  tests/unit/subscribe-client.test.tsx \
  tests/unit/public-no-media-copy.test.ts \
  tests/unit/no-media-bootstrap.test.ts \
  tests/unit/service-worker-policy.test.ts
```

- [ ] **Step 2: Run scope and dead-surface guards**

```bash
rg -n -U --pcre2 "type\s*=\s*(?:[\"']file[\"']|\{\s*[\"']file[\"']\s*\})" app components --glob '*.{ts,tsx}'
rg -n "getUserMedia|MediaRecorder|/api/sessions/.*/capture|Take proof photo|Add file|Snap it|photoAsk" app components lib --glob '*.{ts,tsx}'
rg -n "uploadArtifact|uploadJobAttachment|downloadJobAttachment|processArtifactExtraction" app components --glob '*.{ts,tsx}'
rg -n "artifacts|artifact\." lib/curator/case-detail-query.ts app/curator/cases/'[sessionId]'/page.tsx
rg -n "/sessions/" components/comeback/follow-up-panel.tsx components/screens/ticket-detail.tsx components/screens/vehicle-history.tsx
rg -n "/sessions/new|New diagnosis|Diagnose with AI — add-on" components/screens/today-home.tsx components/screens/today-jobs-board.tsx
rg -n "listSessionsForVehicle" app/'(app)'/vehicles/'[vehicleId]'/page.tsx components/screens/vehicle-history.tsx
rg -n "AI-led diagnostic assistant|AI master tech for the bay|Unlimited diagnostic sessions|The full diagnostic|A diagnostic for working technicians|Knows how the system works|confidence line|questions max before it defers|Session log|your sessions|back to diagnosing|snap a photo of the screen|Direct capture.s on the list" app/layout.tsx app/manifest.ts app/page.tsx app/'(auth)'/sign-in/page.tsx components/screens/subscribe-client.tsx components/marketing app/privacy/page.tsx app/terms/page.tsx
test ! -e app/design/page.tsx
test ! -e public/marketing/screenshots/hero.png
test ! -e public/marketing/screenshots/laptop-hero.png
test ! -e public/marketing/screenshots/motion-01-open.png
test ! -e public/marketing/screenshots/motion-02-research.png
test ! -e public/marketing/screenshots/motion-03-propose.png
test ! -e public/marketing/screenshots/motion-04-confirm.png
test ! -e public/marketing/screenshots/motion-05-lock.png
rg -n "/marketing/screenshots/(hero|laptop-hero|motion-01-open|motion-02-research|motion-03-propose|motion-04-confirm|motion-05-lock)\.png" app components --glob '*.{ts,tsx}'
rg -n "historical.*(upload|submission|metadata).*may remain|provider temporary systems|infrastructure backups" app/privacy/page.tsx
rg -n "storage-setup|createBucket|insert into storage\.buckets|bucket.*artifacts" AGENTS.md docs supabase scripts --glob '*.{md,sql,js,mjs,ts}'
git diff --check
git diff --stat origin/main...HEAD
```

Expected: the file-input/media searches, curator/session-link/vehicle-query searches, false-public-promise search, former screenshot-reference search, and direct file-existence checks find nothing. The Privacy presence search finds all three bounded interim disclosures; the source-contract test separately rejects absolute pre-purge deletion claims. The bootstrap search finds only explicit no-media tests/docs, not creation code. `TodayJobsBoard` may retain a tested legacy-only `/sessions/{id}` implementation behind the release boolean, but it must contain none of the banned always-visible invitations or add-on copy. Static logos/icons/fonts remain allowed.

- [ ] **Step 3: Run repository gates**

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm build
pnpm exec playwright test tests/e2e/landing.spec.ts
```

Expected: complete suite, TypeScript, and production build pass.

- [ ] **Step 4: Verify the browser story locally**

At representative compact mobile, tablet, desktop, keyboard-only, and reduced-motion settings, prove:

- the owner can open `/intake`, search customers, decode a VIN, and create a Counter work order without diagnostic entitlement or engine access;
- signed-in Today contains no diagnostic engine start, diagnostic-session queue, dead session link, add-on teaser, or media control;
- follow-up actions, ticket detail, and vehicle facts remain usable without any link into `/sessions/*`;
- text-only simple work starts, saves a note, and enables completion without page-wide reload or media;
- direct diagnostic submit/start and upload/download/extraction URLs return not available before request parsing or provider/storage work;
- manual `Record findings` remains usable;
- curator case detail shows text history and review actions but no artifact metadata or extracted media summary;
- historical quote non-media content renders without media links;
- public metadata, landing page, pricing, FAQ, Privacy, and Terms describe the current ShopOS release truthfully;
- the PWA manifest, sign-in return copy, and subscription recovery promise ShopOS—not diagnostics—while authentication, install behavior, checkout, and the $100 price remain intact;
- anonymous `/design` preserves the normal sign-in redirect, authenticated/base-authorized `/design` reaches the framework `404`, and every former direct-public diagnostic screenshot URL returns `404`, without expanding either middleware boundary;
- Privacy says new uploads are off, historical submissions may remain until verified purge, and provider temporary systems/backups are not claimed deleted;
- no camera/microphone permission prompt occurs.

Use `chrome-devtools-mcp:a11y-debugging` for the keyboard/focus/accessibility pass. Capture screenshots only when they contain no customer or media content.

- [ ] **Step 5: Run independent code and security review**

Request one whole-branch reviewer and one auth/privacy reviewer. They must specifically probe comp bypass, explicit entitlement bypass, exact-path/prefix bleed, accidental Counter-intake gating, auth-before-parse ordering, ticket-job diagnostic-start bypass, multipart early-read, resource existence oracle, curator artifact projection, quote/story legacy mutation, reachable dead session links, public `/design` or static diagnostic-asset leakage, manifest/auth/subscription promise drift, interim Privacy overclaiming, false marketing/legal promises, fresh bucket recreation, and diagnostic control leakage. Address every Critical/Important finding with a regression test, then rerun Steps 1–3.

- [ ] **Step 6: Update status truthfully**

If no PR exists, leave Row 49 `pending/local-ready`. If a separately authorized draft PR exists, mark `in_progress` with its real number. Do not mark complete until merge, deployed refusal proof, and the separate purge receipt are complete. Update DRIVER_STATE with local proof and the next real gate.

- [ ] **Step 7: Commit final local evidence**

```bash
git add docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md docs/strategy/SHOP_OS_DRIVER_STATE.md tasks/lessons.md
git commit -m "docs: record no-media release proof"
git status --short
```

Expected: clean local branch. Stop at the push/deploy gate. Do not run the purge plan until the exact deployed commit is production-proved.

## Rollback and stop conditions

- Every release-code commit is Git-revert-able; media tables and bytes remain untouched in this plan.
- Stop after two failed implementation approaches on the same defect and return evidence for a fresh lane.
- Stop for unexpected production/live-data dependency, schema drift, external authority, secrets, spend, policy publication, or any need to rewrite immutable records.
- A failing legacy parser test is a hard stop; do not solve it by stripping historical UUIDs.
- A route that reads body/resource/storage before refusal is a hard stop.
- A fresh-project path that recreates the bucket is a hard stop.
- A reachable `/design` diagnostic fixture, direct-public diagnostic screenshot, or auth/install/subscription promise of the disabled engine is a hard stop.
- An interim Privacy statement that implies historical media, provider temporary systems, or infrastructure backups were purged before verified receipts is a hard stop.
- Push, PR publication, merge, deploy, and production smoke are separate authority gates. The permanent purge remains governed by `2026-07-15-shop-os-media-purge.md`.
