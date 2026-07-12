# Shop OS Row 30 — Frictionless Part Capture Design

**Status:** Written design awaiting owner review. No implementation authority yet.

## Outcome

Turn Row 28's complete manual sourcing contracts into the shortest honest workflow for a technician or advisor: open one context-aware part-capture surface inside the quote job, supply only the missing facts, and add a sourced line without leaving the repair order.

The interaction has three natural states—`ready`, `capture`, and `saved`—but never presents a wizard, step counter, progress bar, or separate Parts screen.

## Product decision

Use one responsive inline workflow:

- **Mobile:** a full-height bottom sheet with one column, keyboard-safe scrolling, and a sticky commit action.
- **Desktop:** a right-side panel that preserves the vehicle, job, existing lines, and quote totals in view.
- **Shared behavior:** both render the same component, validation, draft state, retry identity, and response parser. Breakpoints change placement, not workflow.

A standalone Parts screen remains reserved for later order/receive work. It is not the right place to capture an offer while building a quote because navigation would discard the vehicle/job context.

## Interaction model: three states, zero visible steps

```text
QUOTE JOB
│
├── READY
│   ├── Vehicle, ticket, job, and quote context already fixed
│   ├── "Source part" is the only new entry action
│   └── Existing sourced lines remain visibly read-only
│
├── CAPTURE
│   ├── Required now: supplier, description, quantity, supplier cost,
│   │                customer line price, taxable
│   ├── Honest defaults: quantity 1, core charge 0,
│   │                    availability unknown, fulfillment unknown
│   ├── Optional details: part number, brand, fitment, reference,
│   │                     core charge, availability, fulfillment
│   └── Sticky action previews the commitment:
│       "Add 2 pads · Customer price $240.00"
│
└── SAVED
    ├── Server truth replaces the draft
    ├── Quote totals update from the refreshed builder projection
    ├── Focus returns to the sourced line
    └── The line reads "Sourced · read-only" with no ordinary edit action
```

These are state names for implementation and tests, not labels shown to the user.

## Where consolidation is allowed

Consolidate when fields share one user decision and one existing server mutation:

- supplier selection, offer facts, customer price, and quote-line creation share the Row 28 capture mutation;
- the vehicle, ticket, job, shop, actor, currency, verification time, sort, source, and retry fingerprint are already server-owned and never become form questions;
- availability and fulfillment use explicit `Unknown` values instead of forcing low-value navigation;
- optional part details stay behind one `Part details` disclosure until entered or invalid;
- quote refresh happens automatically after a successful mutation and is not a separate button or step.

Do not consolidate across authority or transaction boundaries:

- creating a supplier account remains restricted to `canManageIntegrations`;
- a manager may add a supplier in a nested inline disclosure, but supplier creation and offer capture remain two honest server results;
- if account creation succeeds and offer capture fails, the UI says the supplier was saved, retains the in-memory offer draft, and offers one retry;
- ordinary quote-line edit routes never receive sourced lines;
- source removal stays an explicit confirmed action; atomic sourced-line replacement is not invented without a reviewed server contract.

## Context and defaults

### Server-owned context

The panel receives the current safe quote-builder projection and enabled manual supplier list. It never asks for or accepts shop ID, ticket ID, job ID, currency, source, sort, verification actor/time, secret reference, vendor mode, configuration, or request fingerprint.

### Supplier selection

- If exactly one enabled manual supplier exists, preselect it visibly.
- If multiple suppliers exist, show large supplier chips and require one deliberate selection; do not guess from unsupported “last used” state.
- If none exist, integration managers see `Add supplier` inline with one bounded name field.
- Other roles see the honest block: `An owner needs to add a supplier before this part can be sourced.` They retain ordinary manual quote-line entry.
- Supplier management, disabling, credential setup, and provider configuration do not enter this surface.

### Locked-diagnosis seed

The diagnosis may reduce typing only through the approved outward read boundary:

- an eligible, completed ordinary locked diagnosis may offer one bounded part-description starting point;
- the suggestion is visibly labeled `Starting point from locked diagnosis` and requires an explicit `Use` action;
- it may fill description/search wording only;
- it never invents or pre-fills part number, brand, fitment, quantity, price, cost, availability, supplier, or fulfillment;
- topology, published-wizard, unfinished, ambiguous, or unsupported diagnostic paths provide no seed and no empty-state theater;
- Row 30 does not write session state, alter prompts, retrieval, confidence, risk gates, topology, or diagnostic semantics.

If the current safe outward projection cannot prove an eligible locked diagnosis without a new engine-facing read, Row 30 ships manual capture first and leaves the seed absent. It must not infer lock truth from customer copy or client state.

## Capture surface

### Always visible

- supplier
- part description
- quantity
- supplier unit cost
- customer line price (the complete extended price)
- taxable toggle

The customer line price stays visually distinct from supplier unit cost. No markup or margin is invented because no approved shop pricing rule exists.

### Progressive disclosure

`Part details` contains:

- part number
- brand
- fitment
- human reference
- supplier core charge, defaulting to `$0.00`
- availability chips: `In stock`, `Special order`, `Unknown`
- fulfillment chips: `Pickup`, `Delivery`, `Ship`, `Unknown`
- location label only when fulfillment is not `Unknown`

The disclosure opens automatically when one of its values is seeded, populated, or invalid. Collapsing it never clears values.

### Commit language

The sticky action summarizes customer-visible commitment, not internal cost:

- complete: `Add 2 pads · Customer price $240.00`
- missing required facts: `Add sourced part` disabled, with the first actionable missing fact adjacent;
- saving: `Adding sourced part…`

No control says `Order`, `Buy`, `Submit to supplier`, `Live price`, or `Verified fitment`. Row 30 records a human-verified offer only.

## Draft and retry behavior

- Opening/closing the panel or rotating the device preserves draft fields while the quote page remains mounted.
- The UUID retry key is created once for a normalized draft and survives network, timeout, and malformed-response retries.
- Editing normalized intent after an ambiguous failure rotates the key before another request.
- A failed request never clears the form.
- A successful response is followed by the existing strict builder refresh; only refreshed server truth closes the panel and updates totals.
- If mutation succeeds but refresh fails, show `Part saved. Refresh the quote to see current totals.` and retain a dedicated refresh action.
- Do not store supplier cost, references, or offer drafts in `localStorage`, `sessionStorage`, URLs, analytics, logs, or navigation state.
- Do not show `Autosaved`. A full page reload may honestly clear an uncommitted draft.

## Responsive behavior

### Mobile

- full-height bottom sheet under the safe-area inset;
- one field per row, minimum 44-pixel targets, numeric keyboards for money and quantity;
- sticky action remains above the software keyboard;
- sheet title keeps vehicle and job identity visible in one bounded line;
- dismissing a dirty draft requires one `Keep editing` / `Discard draft` confirmation;
- Escape/back closes only after the same dirty-draft rule.

### Desktop

- fixed-width side panel beside the quote ledger and totals;
- vehicle/job context stays pinned at the top;
- optional details may use a compact two-column layout where labels remain unambiguous;
- focus enters at the first missing required field and returns to the invoking control or saved line.

No hover-only instruction or desktop-only capability exists.

## Existing sourced lines

General quote truth remains customer-safe and read-only. A sourced line shows description, quantity, customer line price, taxable state, part number/brand/fitment when present, and `Sourced · read-only`.

Row 30 adds only sourcing-owned controls supported by existing contracts:

- `Remove sourced part` is explicit, confirmed, and uses the dedicated Row 28 delete route;
- a successful removal refreshes totals and restores focus to `Source part` for that job;
- unavailable, ordered, received, malformed, cross-tenant, or otherwise non-removable truth fails closed;
- `Edit` and `Replace` do not appear. Corrections remain remove-and-recapture until a separately reviewed atomic replacement contract exists.

## Errors and recovery

| Condition | User-facing result | Preserved state |
|---|---|---|
| Offline/timeout | `Connection interrupted. Retry with the same details.` | All draft fields + retry key |
| Lock contention | `This quote changed elsewhere. Refresh and retry.` | Draft values; key rotates only after refreshed intent changes |
| Supplier disabled/removed | `That supplier is no longer available. Choose another.` | Offer fields except supplier selection |
| Offer marked unavailable | `Supplier reports this part unavailable. No quote line was added.` | Draft values for correction or another supplier |
| Mutation saved, refresh failed | `Part saved. Refresh the quote to see current totals.` | Server mutation truth; no duplicate submission |
| Strict response rejected | `The saved response could not be verified. Refresh before continuing.` | No optimistic line or total |
| Unauthorized supplier creation | Supplier-creation control absent | Ordinary manual quote entry remains available |

Errors never expose IDs, fingerprints, secret references, configuration, raw payloads, verifier identity, or internal exception text.

## Component and data boundaries

The implementation should preserve existing architecture:

1. Extend the strict UI parsing layer with dedicated account-list and capture-result parsers.
2. Add one sourcing controller/component owned by the quote screen; keep its state machine separate from the existing ordinary line editor.
3. Reuse the current authenticated/paywalled Row 28 account and manual-offer routes.
4. Refresh through the existing quote-builder read model after every committed change.
5. Add a bounded locked-diagnosis seed read only if the current approved outward seam can prove it without engine behavior changes.

The quote page remains the composition root. Do not duplicate quote math, snapshot parsing, authorization, account cleanliness, or sourced-line validation in the client.

## Verification contract

### Domain/route compatibility

- strict account and offer envelopes remain unchanged;
- exact retry, changed-key collision, unavailable/no-line, removal retry, tenant/role/state guards, quote invalidation, rollback, and privacy tests remain green;
- zero network/provider invocation and absence of order methods remain proven.

### UI behavior

- mobile and desktop render the same state with placement-only responsive differences;
- one-supplier preselection, multi-supplier deliberate choice, owner inline creation, and non-manager honest blocking;
- required/optional disclosure behavior and no-value-loss collapse;
- exact money/quantity bounds, keyboard input modes, sticky action summary, and dirty-dismiss confirmation;
- network retry preserves values/key; normalized edits rotate it; successful refresh closes and focuses the saved line;
- unavailable and partial-success recovery are explicit;
- sourced totals stay complete; supplier cost/core/account/reference never enter general quote rendering;
- sourced lines have no ordinary line-editor controls, and the dedicated confirmed `Remove sourced part` path is focus-safe;
- hostile account/capture/builder responses fail closed;
- 375-pixel layout, safe areas, zoom, keyboard navigation, screen-reader names/status announcements, reduced motion, and 44-pixel targets pass.

### Whole branch

- affected Row 17/18/21/27/28/30 tests;
- complete test suite;
- TypeScript;
- production build;
- diff checks;
- independent parts/security, quote/privacy, and mobile/desktop UI/accessibility reviews;
- deployed health, protected-route behavior, and fresh error-log inspection.

## Explicit non-goals

- no provider search or live prices;
- no PartsTech, O'Reilly, RepairPal, punchout, credentials, or secret resolution;
- no ordering, purchasing, receiving, return, or spend;
- no supplier settings screen;
- no sourced-line atomic replacement;
- no automatic markup or margin policy;
- no customer approval/send change;
- no schema or production migration;
- no diagnostic prompt, topology, risk, retrieval, corpus, session write, or engine-semantic change;
- no persistent browser storage of internal sourcing drafts.

## Rollback and stop conditions

Rollback is the Row 30 source/UI PR; Row 28 server contracts and stored offers remain valid and readable.

Stop if implementation requires a new schema, provider access, credential, order/spend action, supplier permission expansion, persistent client storage of internal offer data, unsafe inference from diagnosis, sourced-line replacement mutation, or any diagnostic-engine semantic change. Those require a separately reviewed design and authority gate.
