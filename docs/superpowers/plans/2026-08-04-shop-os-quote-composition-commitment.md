# Shop OS Quote Composition and Commitment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the mounted quote builder deliberately prepare the exact server quote an advisor reviewed, prevent stale line overwrites, and preserve clear current-versus-historical quote truth through correction.

**Architecture:** Keep the existing repair-order-mounted `ManualQuoteBuilder` and immutable `quote_versions` table. Add versioned SHA-256 concurrency fingerprints to the authenticated builder projection, enforce them under the existing tenant-scoped lock order for line replacement/removal and quote preparation, then present the truth through one focused Quote Commitment panel with an exact-total confirmation and restrained tape detent.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6, Drizzle/PostgreSQL, PGlite, Zod 4, CSS Modules, Vitest 4, Testing Library, Playwright 1.59.

**Approved design:** `docs/superpowers/specs/2026-08-04-shop-os-quote-composition-commitment-design.md`

**Re-plans:** 1 — Task 1 keeps the widened server projection fields required at compile time as well as runtime. TypeScript exposed four consumer fixtures, so Task 1 gained mechanical fixture-only ownership rather than weakening the contract to optional.

**Baseline note:** Exact clean main `9dc3845` ran all eight shards with 4,208 passing tests and one focus assertion failure in the existing manual quote-builder suite; that exact assertion passed immediately in a one-worker isolated rerun. This is not accepted as a green baseline receipt. The final branch must pass the complete eight-shard gate.

## Global constraints

- One implementation owner executes Tasks 1–3 in order. Task reviewers inspect each committed task before the next task starts. Static, security, and runtime reviewers may run in parallel only after the integrated implementation is ready.
- Test-driven development is mandatory: write each behavioral test, run it against the prior production code, and record the expected failure before changing production code.
- Keep quoting mounted inside the repair order. Add no page, wizard, drawer, schema, migration, dependency, provider, pricing field, payment flow, notification, approval channel, or permission model.
- `activeVersion` remains the only current/actionable prepared version. `lastPreparedVersion` is read-only historical context and must never feed customer-link, approval, or decision actions.
- Preparation means an immutable shop quote version exists. Never label it customer viewed, sent, approved, authorized, or customer committed.
- Fingerprints are opaque compare-and-swap tokens, not secrets or authorization. They never replace tenant scope, persisted-actor authorization, schema validation, exact money, or immutable snapshot validation.
- All changed quote API responses, including errors, use `Cache-Control: no-store`. The changed write routes accept strict `application/json` bodies only.
- A stale fingerprint returns `409 conflict` with zero quote-version, line, job, approval, or link mutation. The mounted UI preserves local intent and refreshes current truth before another explicit submit.
- Every real snapshot-affecting mutation continues to call `invalidateActiveQuoteVersion` inside the existing transaction. A semantic no-op or conflict does not invalidate.
- Use only existing bone, graphite, signal, amber, Instrument Serif, Inter Tight, and JetBrains Mono tokens. The only new signature motion is a 200ms tape detent with equivalent static reduced-motion truth.
- One filled primary action per actionable state. Phone controls are at least 44×44px and the commitment rail never covers the software keyboard, editor Save/Cancel, errors, or safe areas.
- Migration `0050`/`0051`, Customer Approval activation, Ticket Correction activation, production data, preview/production proof with dormant flags enabled, merge, and deployment remain outside this source plan.
- Before every commit, `git config user.name` and `git config user.email` must resolve to `Vyntechs` and `brandon@vyntechs.com`. Every commit uses `Co-authored-by` before `Signed-off-by` with those exact values.
- Database-heavy Vitest commands use at most two workers. The full suite runs only through `node scripts/test-shards.mjs`. Stop after the same technical approach fails twice.

---

### Task 1: Project canonical commitment and revision fingerprints

**Owner:** Fresh implementation worker 1

**Files:**
- Modify: `lib/shop-os/quotes.ts`
- Modify: `lib/shop-os/quote-builder-ui.ts`
- Modify: `tests/unit/shop-os-quote-builder.test.ts`
- Modify: `tests/unit/shop-os-quote-builder-ui.test.ts`
- Modify mechanically for required projection fixtures only: `tests/unit/shop-os-manual-quote-builder.test.tsx`
- Modify mechanically for required projection fixtures only: `tests/unit/shop-os-quote-approval-ui.test.tsx`
- Modify mechanically for required projection fixtures only: `tests/unit/shop-os-quote-page.test.tsx`
- Modify mechanically for required projection fixtures only: `tests/unit/shop-os-story-review-ui.test.tsx`

**Interfaces:**
- Add `contentFingerprint: string` to `activeVersion`.
- Add `lastPreparedVersion: { id; versionNumber; totalCents; contentFingerprint; state: 'current' | 'superseded' } | null`.
- Add `draftCommitment: { algorithm: 'quote-draft-v1-sha256'; fingerprint; totalCents; jobCount; lineCount } | null`.
- Add `lineFingerprint: string | null` to projected builder lines. It is non-null only for mutable manual lines.
- Export pure server helpers `quoteSnapshotFingerprint(snapshot)` and `manualDraftLineFingerprint(line)` only if tests or later domain code need them; otherwise keep them module-private and expose behavior through projections.
- Fingerprints are lowercase 64-character SHA-256 hex. Prefix the canonical bytes with `shop-os-quote-draft-v1\0` or `shop-os-manual-line-v1\0` before hashing.

```ts
export function quoteSnapshotFingerprint(snapshot: QuoteSnapshotV1): string
export function manualDraftLineFingerprint(line: typeof jobLines.$inferSelect): string

export type QuoteBuilderProjection = Extract<QuoteBuilderResult, { ok: true }>['builder']

type DraftCommitment = {
  algorithm: 'quote-draft-v1-sha256'
  fingerprint: string
  totalCents: number
  jobCount: number
  lineCount: number
}

type LastPreparedVersion = {
  id: string
  versionNumber: number
  totalCents: number
  contentFingerprint: string
  state: 'current' | 'superseded'
}
```

- [ ] **Step 1: Write RED server-projection tests**

Add literal-behavior tests that prove:

- the same canonical snapshot produces the same 64-hex fingerprint;
- any customer-facing identity, job, line, attachment, tax, subtotal, or total change produces a different quote fingerprint;
- a mutable manual line projects one line fingerprint and a sourced line projects `null`;
- changing any persisted editable line field or its exact `updatedAt` revision changes the line fingerprint;
- an active V3 projects matching `activeVersion` and `lastPreparedVersion { state: 'current' }`;
- after V3 is superseded, `activeVersion` is null while `lastPreparedVersion { state: 'superseded' }` remains with the immutable V3 total;
- latest means highest validated `versionNumber`, never UUID order;
- a historical snapshot validates schema and ticket ID/number but is not rejected merely because current customer/job facts changed;
- malformed, duplicate, contradictory, oversized, or unsafe version truth fails the builder projection closed;
- a versionable current draft projects exact server total/job/line counts and fingerprint; an unversionable draft projects `draftCommitment: null`.

The production changes these tests catch are: accidental raw-JSON hashing, UUID-based latest selection, historical/current type confusion, unbound totals, and omission of line revision from stale-write detection.

- [ ] **Step 2: Write RED strict client-parser tests**

Extend the full builder fixture with all new required fields. Accept exact 64-hex fingerprints and the literal algorithm. Reject uppercase/short/non-hex fingerprints, a mutable manual line with null fingerprint, a sourced line with a fingerprint, a current last version that disagrees with `activeVersion`, a superseded last version while `activeVersion` is present, unsafe totals/counts, missing keys, and extra keys.

- [ ] **Step 3: Prove RED**

```bash
node node_modules/vitest/vitest.mjs run tests/unit/shop-os-quote-builder.test.ts tests/unit/shop-os-quote-builder-ui.test.ts --maxWorkers=1
```

Expected: new projection fields and parser assertions fail because the current builder exposes only `activeVersion` and no fingerprints.

- [ ] **Step 4: Implement canonical fingerprint helpers**

Use `canonicalizeJson` before hashing. `quoteSnapshotFingerprint` validates the full `QuoteSnapshotV1` first, hashes the exact canonical snapshot identity, and never hashes a client object. `manualDraftLineFingerprint` hashes a strict allowlisted object containing the line/shop/job binding IDs, exact persisted `updatedAt` ISO value, and every editable persisted line field. It excludes internal vendor secrets and non-editable unrelated rows.

Representative shape:

```ts
const fingerprint = (namespace: string, value: unknown) => createHash('sha256')
  .update(namespace)
  .update(JSON.stringify(canonicalizeJson(value)))
  .digest('hex')
```

- [ ] **Step 5: Extend the authenticated builder projection**

Build the current canonical draft snapshot from the same validated source rows used by version creation. If it is not versionable, return `draftCommitment: null` rather than a partial commitment. Project the last prepared version from maximum validated version number. Keep current and last projections separate and enforce their relationship before returning.

Do not duplicate the snapshot builder. Extract or reuse a pure `buildQuoteSnapshot` path that both the read projection and locked version writer call with the same canonical inputs.

- [ ] **Step 6: Extend the strict client parser**

Add one reusable lowercase 64-hex schema and cross-field refinements matching the server invariants. Do not default missing concurrency fields. Any old or partial payload must return `null` so the mounted loader shows truthful unavailable/retry state.

- [ ] **Step 7: Prove GREEN and commit**

```bash
node node_modules/vitest/vitest.mjs run tests/unit/shop-os-quote-builder.test.ts tests/unit/shop-os-quote-builder-ui.test.ts tests/unit/shop-os-quote-versions.test.ts --maxWorkers=2
node_modules/.bin/tsc --noEmit --pretty false
git diff --check
git config user.name
git config user.email
git add lib/shop-os/quotes.ts lib/shop-os/quote-builder-ui.ts tests/unit/shop-os-quote-builder.test.ts tests/unit/shop-os-quote-builder-ui.test.ts
git commit -m "feat: project exact quote commitment truth" --trailer "Co-authored-by: Vyntechs <brandon@vyntechs.com>" --trailer "Signed-off-by: Vyntechs <brandon@vyntechs.com>"
```

Expected: focused projection/version tests, TypeScript, and diff checks pass.

---

### Task 2: Enforce compare-and-swap on line correction and preparation

**Owner:** Fresh implementation worker 2

**Files:**
- Modify: `lib/shop-os/quotes.ts`
- Modify: `app/api/tickets/[id]/quote/jobs/[jobId]/lines/[lineId]/route.ts`
- Modify: `app/api/tickets/[id]/quote/versions/route.ts`
- Modify: `tests/unit/shop-os-quote-builder.test.ts`
- Modify: `tests/unit/shop-os-quote-versions.test.ts`
- Modify: `tests/unit/shop-os-quote-routes.test.ts`

**Interfaces:**
- `replaceDraftLine` additionally requires `expectedLineFingerprint: unknown` beside `body`.
- `deleteDraftLine` additionally requires `expectedLineFingerprint: unknown`.
- PUT accepts strict JSON `{ expectedLineFingerprint, line }`, where `line` is the existing discriminated manual-line payload.
- DELETE accepts strict JSON `{ expectedLineFingerprint }`.
- `createQuoteVersion` additionally requires `expectedDraftFingerprint: unknown`.
- Prepare POST accepts strict JSON `{ expectedDraftFingerprint }`.
- All four success/error paths use no-store responses. Missing/wrong media type is 415, malformed JSON is 400, strict-shape failure is 422, stale fingerprint is 409.

```ts
export async function replaceDraftLine(
  db: AppDb,
  input: {
    actor: QuoteActor
    ticketId: unknown
    jobId: unknown
    lineId: unknown
    expectedLineFingerprint: unknown
    body: unknown
  },
): Promise<QuoteDraftResult>

export async function deleteDraftLine(
  db: AppDb,
  input: {
    actor: QuoteActor
    ticketId: unknown
    jobId: unknown
    lineId: unknown
    expectedLineFingerprint: unknown
  },
): Promise<QuoteDraftResult>

export async function createQuoteVersion(
  db: AppDb,
  input: { actor: QuoteActor; ticketId: unknown; expectedDraftFingerprint: unknown },
  dependencies?: CreateQuoteVersionDependencies,
): Promise<CreateQuoteVersionResult>

const linePutSchema = z.strictObject({
  expectedLineFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  line: z.unknown(), // `replaceDraftLine` applies the existing strict discriminated schema.
})
const lineDeleteSchema = z.strictObject({
  expectedLineFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
})
const prepareSchema = z.strictObject({
  expectedDraftFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
})
```

- [ ] **Step 1: Write RED stale-line domain tests**

Use two independent authorized actors/connections where supported. Prove current-fingerprint PUT and DELETE work; stale PUT cannot restore an older description or price; stale DELETE cannot remove a newer line; malformed fingerprints fail before transaction work; the comparison happens against the locked row before semantic no-op evaluation; conflicts leave the line, active version, job approvals, and actionable link byte-for-byte unchanged; successful real mutations still invalidate atomically; exact create-key replay remains unchanged.

The production changes these tests catch are: lost updates, stale no-op acceptance, and partial invalidation before CAS.

- [ ] **Step 2: Write RED preparation domain tests**

Prove an exact current draft fingerprint creates V1; exact retry returns the same active version with `changed: false`; a line change between displayed commitment and transaction lock returns conflict with zero version/job/link writes; same total with different composition still conflicts; concurrent identical Prepare converges on one version; concurrent different Prepare produces one version plus one conflict; malformed fingerprint fails before transaction work.

- [ ] **Step 3: Write RED route-contract tests**

Exercise real route handlers with complete auth mocks. Assert strict content type/body/status/no-store behavior, exact fingerprint pass-through, current success status 201, idempotent status 200, retryable conflict propagation, and no domain call for 400/415/422 requests. DELETE must carry JSON; a query parameter or header fingerprint is refused.

- [ ] **Step 4: Prove RED**

```bash
node node_modules/vitest/vitest.mjs run tests/unit/shop-os-quote-builder.test.ts tests/unit/shop-os-quote-versions.test.ts tests/unit/shop-os-quote-routes.test.ts --maxWorkers=1
```

Expected: stale-write and strict-request assertions fail because current line writes and Prepare carry no concurrency token.

- [ ] **Step 5: Enforce line CAS under the existing lock order**

Parse lowercase 64-hex before loading the actor. Inside `runMutation`, calculate the fingerprint from the locked mutable row and compare before no-op, update, delete, or invalidation. Return conflict without mutation on mismatch. Keep delete idempotent only when the row is already absent and the supplied fingerprint was syntactically valid; never claim an existing changed row is absent.

- [ ] **Step 6: Bind Prepare to locked canonical truth**

After `lockVersionContext` and canonical snapshot construction, calculate the server fingerprint and compare it to `expectedDraftFingerprint` before active-version replay, invalidation, or insert. Exact active content remains idempotent only when the supplied fingerprint matches that same content.

- [ ] **Step 7: Tighten both routes**

Use a small route-local `noStoreJson` helper following `app/api/tickets/[id]/corrections/route.ts`. Require normalized `application/json`, parse once, validate strict Zod objects, and pass only validated fields to the domain. Do not add a new endpoint, middleware rule, rate bucket, feature flag, or permission branch.

- [ ] **Step 8: Prove GREEN and commit**

```bash
node node_modules/vitest/vitest.mjs run tests/unit/shop-os-quote-builder.test.ts tests/unit/shop-os-quote-versions.test.ts tests/unit/shop-os-quote-routes.test.ts tests/unit/shop-os-manual-quote-builder.test.tsx --maxWorkers=2
node_modules/.bin/tsc --noEmit --pretty false
git diff --check
git config user.name
git config user.email
git add lib/shop-os/quotes.ts app/api/tickets/'[id]'/quote/jobs/'[jobId]'/lines/'[lineId]'/route.ts app/api/tickets/'[id]'/quote/versions/route.ts tests/unit/shop-os-quote-builder.test.ts tests/unit/shop-os-quote-versions.test.ts tests/unit/shop-os-quote-routes.test.ts
git commit -m "fix: bind quote writes to reviewed truth" --trailer "Co-authored-by: Vyntechs <brandon@vyntechs.com>" --trailer "Signed-off-by: Vyntechs <brandon@vyntechs.com>"
```

---

### Task 3: Build the mounted Quote Commitment panel

**Owner:** Fresh implementation worker 3

**Files:**
- Create: `components/screens/quote-commitment-panel.tsx`
- Modify: `components/screens/manual-quote-builder.tsx`
- Modify: `components/screens/manual-quote-builder.module.css`
- Modify: `lib/shop-os/quote-builder-ui.ts`
- Create: `tests/unit/shop-os-quote-commitment-panel.test.tsx`
- Modify: `tests/unit/shop-os-manual-quote-builder.test.tsx`
- Modify: `tests/unit/shop-os-quote-builder-ui.test.ts`

**Interfaces:**
- `QuoteCommitmentPanel` is presentational. It receives parsed builder truth, calculated display totals, editor-dirty state, preparation state, operation state, approval-link eligibility/status, and callbacks. It does not fetch, authorize, calculate money, or own durable server state.
- Extend the existing confirmation union with `kind: 'prepare'` carrying a frozen `DraftCommitment` and the invoker.
- Manual line PUT/DELETE send the exact projected `lineFingerprint`; Prepare sends the exact frozen `draftCommitment.fingerprint`.
- A stale conflict refreshes current truth and requires a new explicit action. It never automatically resubmits a refreshed fingerprint.

```ts
type PrepareConfirmation = {
  kind: 'prepare'
  commitment: DraftCommitment
  invoker: HTMLButtonElement
}

export type QuoteCommitmentPanelProps = {
  builder: QuoteBuilderProjection
  totals: QuoteMoneySummary
  preparation: QuotePreparationState
  editorDirty: boolean
  preparing: boolean
  confirmation: DraftCommitment | null
  preparedFocusRef: (element: HTMLParagraphElement | null) => void
  onOpenPrepare: (invoker: HTMLButtonElement) => void
  onCancelPrepare: () => void
  onConfirmPrepare: () => void
  preparedActions?: ReactNode
}

export function QuoteCommitmentPanel(props: QuoteCommitmentPanelProps): ReactNode
```

- [ ] **Step 1: Write RED pure panel/state tests**

Render the real panel in each state and prove the exact visible truth and one filled primary action:

- never prepared draft: `Current draft`, `Customer has not received this`, exact total, `Prepare quote`;
- prepared current: `Prepared V3`, exact snapshot customer total, no draft wording;
- prepared with dirty local editor: `Prepared V3 remains current`, `Unsaved line changes`, no Prepare action;
- revised durable draft: `Current draft`, `V3 no longer current`, current draft total, last prepared total;
- commitment plate: job/line count, `Customer will see $X.XX`, Cancel, and `Prepare $X.XX`;
- blocked: every reason visible and no filled disabled theater;
- preparing/recoverable failure: no premature version or saved claim;
- current customer actions consume only `activeVersion`, never the superseded last version.

The production changes these tests catch are: historical version becoming actionable, unsaved local intent labeled durable, first-tap POST, and multiple filled primaries.

- [ ] **Step 2: Write RED mounted interaction tests**

Prove:

- first Prepare tap performs no fetch and focuses the commitment heading;
- Cancel restores focus to the invoker;
- confirm sends `{ expectedDraftFingerprint }` and keeps the displayed exact total during pending state;
- validated POST plus refreshed matching `activeVersion.contentFingerprint` seats/focuses `Prepared Vn`;
- malformed success or mismatched refresh never paints prepared state;
- 409 refreshes truth, names the changed quote, closes/resets the stale commitment, and requires a second deliberate review;
- PUT and DELETE send `expectedLineFingerprint` and preserve typed editor intent on stale conflict;
- a durable correction displays `Vn no longer current` from refreshed server projection across remount, not React memory;
- the existing create key, source-part recovery, approval-link authority, authorization strips, draft recovery, and focus restoration remain intact.

- [ ] **Step 3: Prove RED**

```bash
node node_modules/vitest/vitest.mjs run tests/unit/shop-os-quote-commitment-panel.test.tsx tests/unit/shop-os-manual-quote-builder.test.tsx tests/unit/shop-os-quote-builder-ui.test.ts --maxWorkers=1
```

Expected: component import/state assertions fail and first-tap Prepare still POSTs immediately.

- [ ] **Step 4: Extract the focused presentational panel**

Move only quote-tape, commitment, and phone-rail markup out of the 2,200-line builder. Keep fetches and state transitions in `ManualQuoteBuilder`. Use semantic headings, `dl` totals, a dialog/confirmation focus boundary consistent with existing confirmation patterns, polite status for durable settle, assertive error only when action is required, and no toast-only truth.

- [ ] **Step 5: Wire exact request and recovery state**

Freeze the displayed `DraftCommitment` when confirmation opens. Send it once on explicit confirm. On success, require the refreshed active version ID/number/fingerprint/total to match the confirmed response and commitment before settling. On stale line or Prepare conflict, retain local input where applicable, refresh, name the conflict without blaming connection or user, and rotate only the stale confirmation/fingerprint—not an unrelated create request key.

- [ ] **Step 6: Implement the Quote Bench visual contract**

Replace the generic `bay-pulse` for commitment truth with a quote-specific 2px signal rail and a 200ms `translateY(-2px)` tape detent. Use existing tokens only. On phone, the fixed rail contains the current state, exact total, and one action; it becomes static whenever an editor, story tool, sourcing surface, confirmation, focused field, or software keyboard could be obscured. Reduced motion removes movement and transition while preserving identical words, rail, focus, and announcement.

- [ ] **Step 7: Prove GREEN and commit**

```bash
node node_modules/vitest/vitest.mjs run tests/unit/shop-os-quote-commitment-panel.test.tsx tests/unit/shop-os-manual-quote-builder.test.tsx tests/unit/shop-os-quote-builder-ui.test.ts tests/unit/shop-os-inline-quote-workspace.test.tsx tests/unit/shop-os-quote-routes.test.ts --maxWorkers=2
node_modules/.bin/tsc --noEmit --pretty false
git diff --check
git config user.name
git config user.email
git add components/screens/quote-commitment-panel.tsx components/screens/manual-quote-builder.tsx components/screens/manual-quote-builder.module.css lib/shop-os/quote-builder-ui.ts tests/unit/shop-os-quote-commitment-panel.test.tsx tests/unit/shop-os-manual-quote-builder.test.tsx tests/unit/shop-os-quote-builder-ui.test.ts
git commit -m "feat: make quote preparation deliberate" --trailer "Co-authored-by: Vyntechs <brandon@vyntechs.com>" --trailer "Signed-off-by: Vyntechs <brandon@vyntechs.com>"
```

---

### Task 4: Prove Finish, Correct, Recover and converge once

**Owner:** Fresh implementation worker 4 for proof artifacts; Atlas owns final convergence and release gate.

**Files:**
- Create: `tests/e2e/quote-composition-commitment-proof.spec.ts`
- Create: `tests/e2e/quote-composition-commitment-harness/`
- Create: `playwright.quote-composition-commitment.config.ts`
- Create: `tests/unit/shop-os-quote-composition-commitment-harness.test.ts`
- Modify: `docs/strategy/SHOP_OS_DRIVER_STATE.md`
- Modify: `docs/superpowers/specs/2026-08-04-shop-os-quote-composition-commitment-design.md`
- Modify: `docs/superpowers/plans/2026-08-04-shop-os-quote-composition-commitment.md`

- [ ] **Step 1: Add the split persistence/browser proof**

Use the existing ticket-building-correction harness safety and receipt patterns without importing its scenario. Domain/PGlite tests prove tenant authorization, exact money, immutable V1/V2, link invalidation, line CAS, Prepare CAS, and zero duplicate versions. A localhost-only harness mounts the production Quote Bench and uses deterministic stateful HTTP fixtures to prove rendered interaction only.

The harness exits before startup unless the base URL is loopback, all database/auth secrets are absent, and `VERCEL_ENV` is not production. It never imports `scripts/shop-os-golden-browser.mjs`, reads `.env.local`, contacts Supabase, or implies deterministic harness state is database persistence.

- [ ] **Step 2: Prove four browser cases**

At 390×844 and 1440×900, run exactly two journeys:

1. `finish-correct`: compose mixed labor/part/fee quote, observe durable line/total settle, open exact-total commitment without a first-tap POST, prepare V1, edit V1 with the current line fingerprint, see V1 remain current while unsaved, save and see `V1 no longer current`, then prepare V2.
2. `recover`: interrupted create retry with one key/one line, stale PUT/DELETE, stale Prepare, malformed success, failed refresh, late success, and truthful explicit retry.

For every case assert the exact request ledger, no unexpected external request/browser error, correct focus, 44px targets, no horizontal overflow, software-keyboard/safe-area non-occlusion, zero serious/critical Axe findings, normal/reduced-motion equivalence, and preserved phone/desktop screenshots before any rerun.

- [ ] **Step 3: Prove focused integration and browser GREEN**

```bash
node node_modules/vitest/vitest.mjs run \
  tests/unit/shop-os-quote-builder.test.ts \
  tests/unit/shop-os-quote-builder-ui.test.ts \
  tests/unit/shop-os-quote-versions.test.ts \
  tests/unit/shop-os-quote-routes.test.ts \
  tests/unit/shop-os-manual-quote-builder.test.tsx \
  tests/unit/shop-os-quote-commitment-panel.test.tsx \
  tests/unit/shop-os-inline-quote-workspace.test.tsx \
  tests/unit/shop-os-quote-composition-commitment-harness.test.ts \
  --maxWorkers=2
node_modules/.bin/tsc --noEmit --pretty false
git diff --check
env -u DATABASE_URL -u DATABASE_URL_DIRECT -u SUPABASE_SERVICE_ROLE_KEY -u VERCEL_ENV \
  PLAYWRIGHT_USE_SYSTEM_CHROME=1 \
  corepack pnpm@10.18.3 exec playwright test --config playwright.quote-composition-commitment.config.ts
```

- [ ] **Step 4: Commit proof and establish a clean candidate head**

```bash
git config user.name
git config user.email
git add tests/e2e/quote-composition-commitment-proof.spec.ts tests/e2e/quote-composition-commitment-harness playwright.quote-composition-commitment.config.ts tests/unit/shop-os-quote-composition-commitment-harness.test.ts docs/strategy/SHOP_OS_DRIVER_STATE.md docs/superpowers/specs/2026-08-04-shop-os-quote-composition-commitment-design.md docs/superpowers/plans/2026-08-04-shop-os-quote-composition-commitment.md
git commit -m "test: prove quote composition commitment" --trailer "Co-authored-by: Vyntechs <brandon@vyntechs.com>" --trailer "Signed-off-by: Vyntechs <brandon@vyntechs.com>"
git log -1 --format=full
git status --porcelain
```

- [ ] **Step 5: Run independent final review and one repair wave**

Dispatch static/intent, security/privacy/concurrency, and runtime/accessibility reviewers in parallel against the same exact clean candidate head. Consolidate every Critical/Important finding into one fix dispatch, then one focused re-review. A new unrelated blocker after that re-review triggers the architecture stop.

- [ ] **Step 6: Run the exact final gate on the repaired clean head**

```bash
git rev-parse HEAD
node scripts/test-shards.mjs
node_modules/.bin/tsc --noEmit --pretty false
corepack pnpm@10.18.3 build
env -u DATABASE_URL -u DATABASE_URL_DIRECT -u SUPABASE_SERVICE_ROLE_KEY -u VERCEL_ENV PLAYWRIGHT_USE_SYSTEM_CHROME=1 corepack pnpm@10.18.3 exec playwright test --config playwright.quote-composition-commitment.config.ts
git diff --check
git status --porcelain
git rev-parse HEAD
```

Require all eight shards and a nonzero total, matching before/after HEAD, clean status, successful build, and all four browser cases. A focused rerun cannot turn the known clean-main focus flake into a green full-suite receipt; the complete final branch suite must pass.

- [ ] **Step 7: Push and open the channel-linked PR**

Push the exact reviewed head. Open the PR with `--channel 95938fc9-02c1-4c1a-8b20-84f540bc6c74`, or use the GitHub connector only if Buzz has no valid repository announcement and record this Buzz thread in the PR. Report exact head, business outcome, local proof, reviewers, unchanged migration/activation posture, rollback, and remaining merge/deploy gate. Do not merge or deploy in this plan without a new explicit owner approval immediately before that action.

## Rollback and stop contract

- Source rollback: revert this branch/PR. No migration or data cleanup exists.
- Never delete or rewrite immutable quote versions. Database triggers remain the final history guard.
- Stop for any migration, new public endpoint, broader permission, production secret/data, dormant-feature activation, customer-viewed semantics, a second failure of the same technical approach, or a new unrelated Critical/Important defect after focused final re-review.

## Acceptance map

| Gate | Observable proof |
|---|---|
| Finish | Mixed quote stays mounted; first Prepare tap writes nothing; exact server-bound total becomes one immutable prepared version. |
| Correct | Unsaved edits leave Vn current; a durable current-fingerprint save makes Vn/link non-current and preserves immutable history; Vn+1 holds corrected truth. |
| Recover | Stale line/Prepare fingerprints write nothing, local intent survives, refresh is truthful, and explicit retry converges without duplicates. |
| Premium interaction | One Quote Bench, one filled primary, 200ms tape detent, exact total/state, safe phone rail, equivalent reduced-motion truth. |
| Release safety | Focused tests, full eight-shard suite, TypeScript, build, four browser cases, independent reviews, clean exact head, and linked PR. |

Verified by: approved design `419c711`, exact source map and three pre-code reviews, linked worktree/branch verification, current route/domain/UI/test inspection, and explicit TDD plus final-gate commands above.
