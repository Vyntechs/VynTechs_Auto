# Shop OS Row 30 Frictionless Sourcing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one context-aware `Source part` workflow inside eligible quote jobs that works as a mobile full-height sheet and desktop side panel, captures a human-verified manual supplier offer, refreshes server quote truth, and removes sourced lines only through their dedicated contract.

**Architecture:** Keep Row 28's authenticated vendor-account and manual-offer routes unchanged. Add a strict client contract module, a focused sourcing component with in-memory draft/retry state, and a thin composition layer in the existing quote screen; the server quote page supplies only safe enabled accounts and a permission boolean. Reuse the existing quote refresh/parser path after every successful mutation, and derive an optional diagnosis starting point only from one unambiguous reviewed `ordinary_locked_tree` story already present in the approved builder projection.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6, Zod 4, CSS Modules, Vitest 4, Testing Library.

## Global Constraints

- Mobile is a full-height bottom sheet; desktop is a side panel; both render the same React component and state.
- The user sees natural `ready`, `capture`, and `saved` behavior but no wizard, step count, progress bar, or separate Parts screen.
- The form asks only for supplier, description, quantity, supplier unit cost, customer line price, and taxable; optional part details stay behind one disclosure.
- Defaults are quantity `1`, core charge `$0.00`, availability `unknown`, fulfillment `unknown`, and taxable `true`.
- Exactly one enabled supplier is visibly preselected; multiple suppliers require deliberate selection; unsupported “last used” state is forbidden.
- Supplier creation remains limited to `canManageIntegrations`; supplier creation and offer capture are separate server results and must never be described as one transaction.
- Drafts and internal sourcing truth stay in React memory only—never local/session storage, URL state, analytics, or logs.
- A normalized draft owns one UUID retry key; ambiguous retries reuse it and normalized intent edits rotate it.
- Customer price is the complete extended line price. No markup, margin, provider price, order, purchase, receive, return, or spend behavior is added.
- Locked-diagnosis help is an explicit `Use` action for description wording only. It never fills part number, fitment, quantity, money, supplier, availability, or fulfillment.
- Topology, published-wizard, unfinished, pending-review, absent, or ambiguous diagnostic truth supplies no seed and triggers no engine read/write.
- Existing sourced lines remain outside the ordinary line editor. Correction is confirmed removal through Row 28 followed by recapture; no Edit/Replace action is added.
- No schema, migration, provider transport, credential, diagnostic prompt, topology, risk, retrieval, session write, or engine-semantic change is allowed.
- UI copy remains calm, technical, imperative, and emoji-free. Interactive targets are at least 44px.

---

## File map

- Create `lib/shop-os/parts-sourcing-ui.ts`: strict safe-account/capture response parsers, normalized draft builder, action summary, and bounded locked-diagnosis seed selector.
- Create `tests/unit/shop-os-parts-sourcing-ui.test.ts`: contract, normalization, retry-signature, money, and seed fail-closed tests.
- Modify `app/(app)/tickets/[id]/quote/page.tsx`: safely load enabled manual accounts and calculate the integration-management boolean.
- Modify `tests/unit/shop-os-quote-page.test.tsx`: prove server projection, graceful account-read failure, founder/role permission, and privacy.
- Create `components/screens/manual-part-sourcing.tsx`: one controlled responsive capture surface with in-memory state, account creation, capture, retry, and dirty-dismiss behavior.
- Create `components/screens/manual-part-sourcing.module.css`: desktop panel/mobile sheet placement, sticky action, focus, safe-area, keyboard, reduced-motion, and target sizing.
- Create `tests/unit/shop-os-manual-part-sourcing.test.tsx`: component interaction, accessibility, supplier, retry, hostile-response, partial-success, and responsive contract tests.
- Modify `components/screens/manual-quote-builder.tsx`: compose one sourcing surface, share strict refresh, add eligible actions, and route sourced removal to Row 28.
- Modify `components/screens/manual-quote-builder.module.css`: only the small ledger/action styles required for sourcing entry and sourced removal.
- Modify `tests/unit/shop-os-manual-quote-builder.test.tsx`: integration/focus/removal/no-leak regression tests.
- Modify `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`: mark Row 30 complete only after all verification and review gates pass.
- Modify `docs/strategy/SHOP_OS_DRIVER_STATE.md`: record the verified slice, proof, and next safe move.

---

### Task 1: Strict sourcing UI contracts

**Files:**
- Create: `lib/shop-os/parts-sourcing-ui.ts`
- Create: `tests/unit/shop-os-parts-sourcing-ui.test.ts`

**Interfaces:**
- Consumes: `parseMoneyToCents`, `formatMoneyCents`, and `QuoteBuilderResult` from existing quote modules.
- Produces: `SafeManualVendorAccount`, `ManualPartDraft`, `ManualOfferPayload`, `parseEnabledVendorAccountsResponse`, `parseCreatedVendorAccountResponse`, `parseManualOfferResponse`, `parseManualOfferRemovalResponse`, `normalizedManualPartSignature`, `buildManualOfferPayload`, `manualPartCommitLabel`, and `selectLockedDiagnosisSeed`.

- [ ] **Step 1: Write failing parser and normalization tests**

Cover these exact cases in `tests/unit/shop-os-parts-sourcing-ui.test.ts`:

```ts
it('accepts only clean enabled manual accounts and strict envelopes', () => {
  expect(parseEnabledVendorAccountsResponse({ vendorAccounts: [{
    id: ACCOUNT_ID, displayName: 'Local Parts', mode: 'manual', enabled: true,
    updatedAt: '2026-07-12T05:00:00.000Z',
  }] }))?.[0].displayName).toBe('Local Parts')
  expect(parseEnabledVendorAccountsResponse({ vendorAccounts: [{
    id: ACCOUNT_ID, displayName: 'Local Parts', mode: 'manual', enabled: false,
    updatedAt: '2026-07-12T05:00:00.000Z',
  }] })).toBeNull()
  expect(parseEnabledVendorAccountsResponse({ vendorAccounts: [], secretRef: 'NO' })).toBeNull()
})

it('normalizes one exact capture intent and keeps internal fields out of the label', () => {
  const draft = manualPartDraft({ vendorAccountId: ACCOUNT_ID, description: '  Pad set  ', quantity: '2.0', unitCost: '80', customerPrice: '240.00' })
  const payload = buildManualOfferPayload(draft, CLIENT_KEY)
  expect(payload).toEqual({
    clientKey: CLIENT_KEY, vendorAccountId: ACCOUNT_ID, description: 'Pad set',
    partNumber: null, brand: null, quantity: '2', priceCents: 24000,
    unitCostCents: 8000, coreChargeCents: 0, taxable: true,
    availability: 'unknown', fitment: null,
    fulfillment: { method: 'unknown', locationLabel: null }, externalOfferId: null,
  })
  expect(manualPartCommitLabel(draft)).toBe('Add 2 Pad set · Customer price $240.00')
  expect(manualPartCommitLabel(draft)).not.toMatch(/80|cost|supplier/i)
})

it('returns one explicit description seed only for one reviewed ordinary lock', () => {
  expect(selectLockedDiagnosisSeed([reviewedOrdinaryJob('Replace the alternator and verify output.')]))
    .toEqual({ description: 'Replace the alternator and verify output.' })
  expect(selectLockedDiagnosisSeed([
    reviewedOrdinaryJob('First recommendation'), reviewedOrdinaryJob('Second recommendation'),
  ])).toBeNull()
  expect(selectLockedDiagnosisSeed([topologyJob(), pendingOrdinaryJob(), publishedWizardJob()]))
    .toBeNull()
})
```

Also prove strict capture envelopes: `201 + changed:true + line+sourcing`, `200 + changed:false + identical line+sourcing`, and `200 + changed:false + unavailable:true` pass; extra keys, wrong statuses, invalid UUIDs, `unavailable:true` with a line, or missing sourcing fail closed. Prove removal accepts only `200 {changed:boolean}`.

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
pnpm vitest run tests/unit/shop-os-parts-sourcing-ui.test.ts
```

Expected: FAIL because `@/lib/shop-os/parts-sourcing-ui` does not exist.

- [ ] **Step 3: Implement the strict contract module**

Implement Zod `strictObject` schemas matching the existing Row 28 public envelopes exactly. Define the draft as:

```ts
export type ManualPartDraft = {
  vendorAccountId: string
  description: string
  quantity: string
  unitCost: string
  customerPrice: string
  taxable: boolean
  partNumber: string
  brand: string
  fitment: string
  externalOfferId: string
  coreCharge: string
  availability: 'in_stock' | 'special_order' | 'unknown'
  fulfillmentMethod: 'pickup' | 'delivery' | 'ship' | 'unknown'
  locationLabel: string
}
```

`buildManualOfferPayload` must trim optional text to `null`, canonicalize quantity through existing scaled-decimal helpers, parse cents through `parseMoneyToCents`, reject negative/unsafe money, and set `locationLabel:null` whenever fulfillment is `unknown`. `normalizedManualPartSignature` must be total for incomplete/invalid drafts: serialize every normalized raw intent field, use canonical quantity/money when valid, otherwise preserve its trimmed raw value, and exclude `clientKey`. It must not hash or persist anything. `manualPartCommitLabel` returns `Add sourced part` until description, valid positive quantity, and valid customer price exist.

`selectLockedDiagnosisSeed` must return a seed only when exactly one job satisfies all of:

```ts
job.kind === 'diagnostic'
job.storyMode === 'ordinary_locked_tree'
job.story.reviewStatus === 'reviewed'
job.story.content !== null
job.story.content.whatWeRecommend.trim().length > 0
```

Return only `{ description: job.story.content.whatWeRecommend }`; never expose evidence, session identifiers, or other story fields.

- [ ] **Step 4: Run contract tests and confirm GREEN**

Run:

```bash
pnpm vitest run tests/unit/shop-os-parts-sourcing-ui.test.ts tests/unit/shop-os-quote-builder-ui.test.ts
```

Expected: both files pass; existing builder privacy tests remain green.

- [ ] **Step 5: Commit the contract slice**

```bash
git add lib/shop-os/parts-sourcing-ui.ts tests/unit/shop-os-parts-sourcing-ui.test.ts
git commit -m "Add strict sourcing UI contracts"
```

---

### Task 2: Safe server composition and permissions

**Files:**
- Modify: `app/(app)/tickets/[id]/quote/page.tsx`
- Modify: `tests/unit/shop-os-quote-page.test.tsx`

**Interfaces:**
- Consumes: `listVendorAccounts`, `vendorAccountActorFromProfile`, `publicVendorAccount`, `canManageIntegrations`, and `isFounder`.
- Produces props on `ManualQuoteBuilder`: `vendorAccounts: SafeManualVendorAccount[]`, `vendorCatalogAvailable: boolean`, and `canCreateVendorAccount: boolean`.

- [ ] **Step 1: Extend the page tests first**

Add a mocked `listVendorAccounts` and assert:

```ts
expect(listVendorAccountsMock).toHaveBeenCalledWith({}, {
  actor: { profileId: profile.id }, scope: 'enabled',
})
expect(manualBuilderMock.mock.calls[0][0]).toMatchObject({
  vendorAccounts: [safeAccount], vendorCatalogAvailable: true,
  canCreateVendorAccount: false,
})
```

Add cases for owner and founder override returning `canCreateVendorAccount:true`; a rejected/corrupt account read returning `vendorAccounts:[]` and `vendorCatalogAvailable:false`; and JSON-stringified props containing no `secretRef`, `nonSecretConfig`, customer contact data, vehicle VIN/plate/engine, unit cost, or vendor snapshot.

- [ ] **Step 2: Run the page test and confirm RED**

```bash
pnpm vitest run tests/unit/shop-os-quote-page.test.tsx
```

Expected: FAIL because the page neither loads accounts nor passes the new props.

- [ ] **Step 3: Add the optional account read**

In the quote page, after the quote builder succeeds, call:

```ts
let vendorResult: Awaited<ReturnType<typeof listVendorAccounts>> | null = null
try {
  vendorResult = await listVendorAccounts(db, {
    actor: vendorAccountActorFromProfile(ctx.profile, isFounder(ctx.user.email)),
    scope: 'enabled',
  })
} catch {
  // Sourcing is optional. Ordinary manual quote entry remains available.
}
const vendorCatalogAvailable = vendorResult?.ok === true
const vendorAccounts = vendorResult?.ok
  ? vendorResult.vendorAccounts.map(publicVendorAccount)
  : []
const canCreateVendorAccount = canManageIntegrations(
  ctx.profile.role,
  isFounder(ctx.user.email),
)
```

Pass only those three props across the client boundary. Do not broaden the builder projection or query account scope `all`.

- [ ] **Step 4: Run page and account-route tests**

```bash
pnpm vitest run tests/unit/shop-os-quote-page.test.tsx tests/unit/shop-os-vendor-account-routes.test.ts
```

Expected: both files pass; route authorization remains unchanged.

- [ ] **Step 5: Commit server composition**

```bash
git add 'app/(app)/tickets/[id]/quote/page.tsx' tests/unit/shop-os-quote-page.test.tsx
git commit -m "Project safe sourcing context into quotes"
```

---

### Task 3: Responsive capture surface and honest draft state

**Files:**
- Create: `components/screens/manual-part-sourcing.tsx`
- Create: `components/screens/manual-part-sourcing.module.css`
- Create: `tests/unit/shop-os-manual-part-sourcing.test.tsx`

**Interfaces:**
- Consumes: safe account/draft helpers from Task 1 and quote ticket/job identity from the parent.
- Produces: `ManualPartSourcing` with props:

```ts
export type ManualPartSourcingProps = {
  open: boolean
  ticketId: string
  ticketLabel: string
  vehicleLabel: string | null
  job: { id: string; title: string }
  accounts: SafeManualVendorAccount[]
  catalogAvailable: boolean
  canCreateVendorAccount: boolean
  diagnosisSeed: { description: string } | null
  busy: boolean
  onBusyChange: (busy: boolean) => void
  onAccountCreated: (account: SafeManualVendorAccount) => void
  onSaved: (lineId: string) => Promise<boolean>
  onClose: () => void
}
```

- [ ] **Step 1: Write interaction and accessibility tests**

Prove all of the following before implementation:

- closed state renders nothing;
- open state has one `dialog` named `Source part for {job title}` and no step/progress language;
- exactly one account is visibly preselected; two accounts leave supplier unselected;
- zero accounts + manager shows `Add supplier`; zero accounts + non-manager shows `An owner needs to add a supplier before this part can be sourced.`;
- unavailable catalog says `Sourcing is temporarily unavailable. Manual quote entry still works.` and provides no fake supplier creation;
- quantity `1`, core `$0.00`, unknown availability/fulfillment, and taxable are initial values;
- optional `Part details` starts closed, opens on seeded/invalid optional values, and collapse preserves values;
- diagnosis suggestion is inert until `Use`, then fills only description;
- dirty close and Escape open one confirmation with `Keep editing` and `Discard draft`;
- clean close returns immediately;
- no `Autosaved`, `Order`, `Buy`, `Live price`, `Verified fitment`, or visible step count;
- money and quantity fields use decimal input modes, every control has an accessible name, and status changes use `role=status` or `aria-live=polite`.

- [ ] **Step 2: Run component tests and confirm RED**

```bash
pnpm vitest run tests/unit/shop-os-manual-part-sourcing.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the shared state and form**

Use one React component and one draft object. Initialize the account selection with:

```ts
const initialAccountId = accounts.length === 1 ? accounts[0].id : ''
const [draft, setDraft] = useState(() => createManualPartDraft(initialAccountId))
const [clientKey, setClientKey] = useState(() => crypto.randomUUID())
```

Every field update compares `normalizedManualPartSignature(previous)` with `normalizedManualPartSignature(next)`. Rotate `clientKey` only when they differ; retain the key across network, timeout, malformed-response, and retryable-conflict retries. Keep the draft in component state only. The sticky button label comes from `manualPartCommitLabel`; invalid submissions focus the first missing/invalid required field and announce its exact label.

The optional diagnosis callout must render:

```tsx
<aside aria-label="Starting point from locked diagnosis">
  <p>Starting point from locked diagnosis</p>
  <p>{diagnosisSeed.description}</p>
  <button type="button" onClick={useDiagnosisSeed}>Use</button>
</aside>
```

Do not silently prefill the form.

- [ ] **Step 4: Implement responsive CSS**

Desktop (`min-width: 801px`) uses a fixed right panel beside the quote with `width:min(440px, 42vw)`, full viewport height, independent overflow, and a sticky footer. Task 5 adds a parent `screenWithSourcing` class that reserves the same width so the panel never covers the quote ledger or totals. Mobile (`max-width:800px`) uses `position:fixed; inset:0; min-height:100dvh`, one column, `padding-bottom:env(safe-area-inset-bottom)`, and a sticky footer above the software keyboard. All controls use `min-height:44px`; no hover-only information; reduced-motion removes panel transitions.

- [ ] **Step 5: Run component tests and confirm GREEN**

```bash
pnpm vitest run tests/unit/shop-os-manual-part-sourcing.test.tsx
```

Expected: all ready/capture/dismiss/responsive-contract tests pass.

- [ ] **Step 6: Commit the surface**

```bash
git add components/screens/manual-part-sourcing.tsx components/screens/manual-part-sourcing.module.css tests/unit/shop-os-manual-part-sourcing.test.tsx
git commit -m "Add responsive manual part capture surface"
```

---

### Task 4: Supplier creation, capture, retry, and partial success

**Files:**
- Modify: `components/screens/manual-part-sourcing.tsx`
- Modify: `tests/unit/shop-os-manual-part-sourcing.test.tsx`

**Interfaces:**
- Consumes: existing `POST /api/shop/vendor-accounts`, existing `POST /api/tickets/{ticketId}/quote/jobs/{jobId}/parts/manual-offers`, strict parsers from Task 1, and the Task 3 callbacks.
- Produces: one honest client controller that never treats account creation and offer capture as one transaction.

- [ ] **Step 1: Add failing mutation tests**

Test these exact request/response sequences:

1. Account creation sends `{clientKey,displayName}`, accepts only strict `200/201`, inserts/selects the returned account, leaves the offer draft intact, and never auto-submits the offer.
2. Capture sends the exact normalized payload, accepts strict created/replay responses, calls `onSaved(line.id)`, and closes only when `onSaved` resolves `true`.
3. Offline/timeout retries send the same `clientKey`; changing normalized quantity or price rotates it.
4. `200 {changed:false,unavailable:true}` shows `Supplier reports this part unavailable. No quote line was added.` and keeps the draft.
5. `onSaved(false)` shows `Part saved. Refresh the quote to see current totals.` with a dedicated `Refresh quote` action and disables duplicate capture.
6. Supplier creation success followed by capture failure says `Supplier saved. The part was not added yet.` and preserves all offer fields.
7. Extra keys, hostile IDs, malformed money, wrong status/changed pairing, or supplier ID mismatch fail closed with no optimistic line, close, or callback.
8. `401/403/404` use the existing safe quote navigation/error behavior passed from the parent; raw body fields never render.

- [ ] **Step 2: Run mutation tests and confirm RED**

```bash
pnpm vitest run tests/unit/shop-os-manual-part-sourcing.test.tsx
```

Expected: new mutation cases fail because network actions are not implemented.

- [ ] **Step 3: Implement account creation as its own bounded mutation**

Generate one account UUID when the nested account form opens. Retain it across ambiguous retries and rotate it when the normalized supplier name changes. POST JSON to `/api/shop/vendor-accounts`, parse with `parseCreatedVendorAccountResponse`, call `onAccountCreated`, select the account, announce `Supplier saved. Continue with the part details.`, and return focus to the first missing offer field. Do not call the offer route from the supplier-success handler.

- [ ] **Step 4: Implement offer capture and refresh handoff**

POST the Task 1 payload to:

```ts
`/api/tickets/${ticketId}/quote/jobs/${job.id}/parts/manual-offers`
```

Set `onBusyChange(true)` before fetch and always clear it in `finally`. On a strict line response, record a local `savedLineId`, call `await onSaved(line.id)`, and:

- close/reset only when refresh returns `true`;
- otherwise render the saved/refresh-required state and never resend capture;
- retain the exact key after ambiguous failures;
- keep the panel open after unavailable or strict-response failure.

- [ ] **Step 5: Run mutation and Row 28 route tests**

```bash
pnpm vitest run tests/unit/shop-os-manual-part-sourcing.test.tsx tests/unit/shop-os-vendor-account-routes.test.ts tests/unit/shop-os-quote-routes.test.ts
```

Expected: UI mutation cases and unchanged Row 28 route contracts pass.

- [ ] **Step 6: Commit controller behavior**

```bash
git add components/screens/manual-part-sourcing.tsx tests/unit/shop-os-manual-part-sourcing.test.tsx
git commit -m "Wire manual sourcing capture and retries"
```

---

### Task 5: Quote integration and dedicated sourced removal

**Files:**
- Modify: `components/screens/manual-quote-builder.tsx`
- Modify: `components/screens/manual-quote-builder.module.css`
- Modify: `tests/unit/shop-os-manual-quote-builder.test.tsx`

**Interfaces:**
- Consumes: `ManualPartSourcing`, server-projected accounts/permission, `selectLockedDiagnosisSeed`, existing `refreshQuote`, and Row 28 sourced delete route.
- Produces: one active sourcing panel at a time, eligible `Source part` actions, safe refreshed totals, and dedicated confirmed sourced removal.

- [ ] **Step 1: Write failing quote-integration tests**

Add tests proving:

- `Source part` appears only on `repair|maintenance` jobs with `open|blocked` status, not diagnostic or in-progress jobs;
- opening one job's surface closes no dirty surface without confirmation and blocks other quote mutations while saving;
- the panel receives the ticket/job identity, current accounts, permission boolean, and only the unambiguous seed;
- after strict capture, the existing GET refresh replaces builder truth, updates totals, closes the panel, and focuses `line:{id}`;
- refresh failure leaves the saved state visible and its dedicated refresh action retries GET without reposting capture;
- sourced rows display `Sourced · read-only`, no ordinary Edit/Remove, plus one `Remove sourced part: {description}` action;
- confirmed sourced removal calls only `/parts/manual-offers/{lineId}`, refreshes truth, updates totals, and focuses that job's `Source part` action;
- failed sourced removal closes the confirmation, restores focus, preserves the row, and leaks no account/cost/snapshot fields;
- ordinary manual line removal still uses the existing `/lines/{lineId}` route;
- hostile refreshed builder truth does not close the panel or alter totals.

- [ ] **Step 2: Run quote UI tests and confirm RED**

```bash
pnpm vitest run tests/unit/shop-os-manual-quote-builder.test.tsx
```

Expected: new source-action, panel, and dedicated-removal assertions fail.

- [ ] **Step 3: Compose one sourcing state in the quote builder**

Add props and state:

```ts
vendorAccounts?: SafeManualVendorAccount[]
vendorCatalogAvailable?: boolean
canCreateVendorAccount?: boolean

const [accounts, setAccounts] = useState(vendorAccounts)
const [sourcingJobId, setSourcingJobId] = useState<string | null>(null)
const diagnosisSeed = selectLockedDiagnosisSeed(current.jobs)
```

Render `Source part` only when Row 28 can accept it. Keep one `ManualPartSourcing` instance at the quote composition root so mobile/desktop placement changes do not duplicate state. Pass `onSaved={(lineId) => refreshQuote('line:' + lineId, false, true)}` and merge a newly created account by ID without persisting it in browser storage.

When a panel is open, add `styles.screenWithSourcing` to the root. Above 800px it reserves the panel width with `width:min(calc(100% - min(440px, 42vw)), 1240px)` and left-aligns the quote workspace; at 800px and below it has no layout effect because the sheet owns the viewport.

- [ ] **Step 4: Add the sourced-specific confirmation and delete path**

Extend `ModalState` with:

```ts
| { kind: 'remove-sourced'; target: { jobId: string; line: BuilderLine }; invoker: HTMLElement }
```

Render copy `Remove sourced part?` / `Keep sourced part` / `Confirm removal`. DELETE only:

```ts
`/api/tickets/${ticket.id}/quote/jobs/${jobId}/parts/manual-offers/${line.id}`
```

Parse only `200 {changed:boolean}`, refresh, and focus `source:${jobId}`. Never route sourced lines through `confirmRemove` or the ordinary line endpoint.

- [ ] **Step 5: Run quote, story, and parser regression tests**

```bash
pnpm vitest run tests/unit/shop-os-manual-quote-builder.test.tsx tests/unit/shop-os-story-review-ui.test.tsx tests/unit/shop-os-quote-builder-ui.test.ts
```

Expected: all files pass; stories, ordinary lines, quote totals, and privacy remain unchanged.

- [ ] **Step 6: Commit integration**

```bash
git add components/screens/manual-quote-builder.tsx components/screens/manual-quote-builder.module.css tests/unit/shop-os-manual-quote-builder.test.tsx
git commit -m "Integrate sourcing into quote jobs"
```

---

### Task 6: Full verification, independent review, and status convergence

**Files:**
- Modify: `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`
- Modify: `docs/strategy/SHOP_OS_DRIVER_STATE.md`

**Interfaces:**
- Consumes: all completed tasks and repository verification requirements.
- Produces: a reviewable Row 30 runtime PR with durable, truthful status.

- [ ] **Step 1: Run the complete focused sourcing/quote matrix**

```bash
pnpm vitest run \
  tests/unit/shop-os-parts-sourcing-ui.test.ts \
  tests/unit/shop-os-manual-part-sourcing.test.tsx \
  tests/unit/shop-os-manual-quote-builder.test.tsx \
  tests/unit/shop-os-quote-builder-ui.test.ts \
  tests/unit/shop-os-quote-page.test.tsx \
  tests/unit/shop-os-vendor-accounts.test.ts \
  tests/unit/shop-os-vendor-account-routes.test.ts \
  tests/unit/shop-os-quote-routes.test.ts \
  tests/unit/shop-os-story-review-ui.test.tsx
```

Expected: all focused files pass with no unhandled rejection or console error.

- [ ] **Step 2: Run whole-branch deterministic verification**

Run sequentially; do not overlap heavy tests with reviewers:

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm build
git diff --check origin/main...HEAD
```

Expected: complete suite, TypeScript, production build, and diff checks pass.

- [ ] **Step 3: Verify the wired UI at desktop and mobile widths**

Run the app with production-like environment values and inspect authenticated quote fixtures at 1280px and 375px. Verify: side panel vs full-height sheet, safe-area/sticky action, software-keyboard visibility, one-column fields, 200% zoom, keyboard-only focus order/trap/return, screen-reader names/status, reduced motion, 44px targets, dirty dismissal, single/multiple/no supplier states, diagnosis `Use`, saved refresh, and sourced removal. Capture screenshots/proof without customer PII or internal sourcing costs.

- [ ] **Step 4: Run three independent read-only reviews**

Review lanes and exact scopes:

1. Parts/security: permissions, retry identity, strict envelopes, no provider/order behavior, no secrets/internal cost leakage.
2. Quote/privacy: totals/refetch, sourced-vs-ordinary endpoint separation, invalidation, hostile truth, focus, customer-safe projection.
3. UI/accessibility: 375px/desktop parity, keyboard/screen reader, safe areas, dirty dismissal, visible defaults, no theater.

Resolve every actionable finding and rerun the affected focused tests plus TypeScript/build if source changed.

- [ ] **Step 5: Update durable state only after proof is green**

Mark Row 30 `complete` in the active plan with PR number, exact focused/full counts, TypeScript/build result, review result, and explicit note that live provider transport remains blocked on Row 29. Update `SHOP_OS_DRIVER_STATE.md` with the last proof and the next safe internal lane; do not imply diagnosis-engine or provider work shipped.

- [ ] **Step 6: Commit status convergence**

```bash
git add docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md docs/strategy/SHOP_OS_DRIVER_STATE.md
git commit -m "Record verified Row 30 sourcing UI"
```

- [ ] **Step 7: Push, convert the draft PR to ready, and verify GitHub checks**

```bash
git push
gh pr edit --title "Add frictionless Shop OS part sourcing" --body '## Outcome

Adds one responsive Source part workflow inside eligible quote jobs, backed only by the existing manual supplier and offer contracts.

## Boundaries

- Mobile full-height sheet and desktop side panel share one state machine.
- Human-verified manual offers only; no provider transport, ordering, credentials, spend, schema, or diagnostic-engine changes.
- Draft and internal sourcing truth remain in memory and out of customer quote projections.
- Sourced corrections use the dedicated confirmed remove contract; no ordinary edit or replacement.

## Proof

- Focused sourcing, quote, route, account, parser, page, and diagnostic-story tests pass.
- Complete test suite, TypeScript, production build, and diff checks pass.
- Parts/security, quote/privacy, and responsive accessibility reviews have no remaining findings.'
gh pr ready
gh pr checks --watch
```

Expected: branch is pushed, PR #154 describes runtime work, the PR is review-ready, and every required check is green. Do not merge until independent reviews and GitHub checks are both green.

---

## Stop and rollback conditions

- Stop if any task requires schema/migration work, provider access, credentials, ordering/spend, integration-permission expansion, persistent browser storage, diagnostic session writes, engine-semantic changes, or sourced-line replacement.
- Stop after two failures of the same technical approach and return the evidence instead of layering workarounds.
- Roll back by reverting the Row 30 runtime commits; Row 28 accounts/offers and existing sourced rows remain valid.
- A docs-only plan commit is not implementation completion. Row 30 completes only after focused/full proof, responsive accessibility verification, independent review, and green PR checks.
