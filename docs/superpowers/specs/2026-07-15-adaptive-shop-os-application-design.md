# Adaptive ShopOS Application Design

**Date:** 2026-07-15
**Status:** Approved with sequencing and safety modifications; Wave 1A plan ready
**Product definition:** An installable, real-time Progressive Web App with single-page application behavior
**Wave 1A execution:** [Adaptive ShopOS Wave 1A implementation plan](../plans/2026-07-15-adaptive-shop-os-wave-1a.md)

## Outcome

Turn the signed-in Vyntechs product into one adaptive ShopOS application that
feels continuous on a phone, large tablet, laptop, desktop, or wide monitor.
The application frame stays mounted while the repair order, job, diagnostic
step, status, counter, message, and evidence elements update independently.

The public marketing, pricing, legal, and authentication surfaces remain
server-rendered web pages. The authenticated product becomes the application.
This is an incremental architecture change inside the existing React/Next.js
codebase, not a native rewrite or a second mobile product.

The first implementation wave is deliberately split: foundation and shell
contracts first, then `My Jobs` as the pilot living surface only after its
current shared-file owner releases those paths. Later ShopOS surfaces adopt
the same contracts in separate verified waves.

## Product thesis

**Change the object, not the page.**

A technician acts on a repair order or job. The affected object enters an
honest local pending state, the server authorizes and persists the transition,
and the response replaces only that object and any directly affected summary
counts. Navigation, scroll position, open context, typed input, topology state,
camera state, and unrelated work remain undisturbed.

The visual signature is the **adaptive workbench aperture**: the same selected
work stays centered while additional context rails appear as space becomes
available. A larger screen reveals more useful shop context; it never merely
stretches a phone card or enlarges decorative whitespace.

## Decisions

1. **One adaptive application, not separate mobile and desktop products.** The
   same domain components and server contracts compose differently by
   available space and input capability.
2. **Server truth remains authoritative.** Client state controls continuity
   and pending feedback, never permissions, assignment, workflow legality,
   tenant isolation, or diagnostic truth.
3. **Routine mutations return precise projections.** Broad route refreshes and
   full-document navigation are not the default synchronization mechanism.
4. **The selected work has a durable URL.** Deep links, browser history, and
   recovery remain valid even though the shared shell does not remount.
5. **Touch gestures are enhancements.** Every swipe action has a visible,
   keyboard-accessible equivalent. No production swipe directly deletes a
   repair record.
6. **Installation is progressive.** The product works in a normal browser and
   may also launch as a standalone PWA on supported phones, tablets, laptops,
   and desktops.
7. **Offline state is honest.** The application may cache its shell and
   explicitly approved non-personal reference assets, but never claims a
   repair-status mutation was saved without server confirmation.

## Scope boundaries

### In scope

- authenticated application shell and navigation continuity;
- compact, split, workbench, and expanded-workbench compositions;
- component-level mutation and reconciliation contracts;
- precise local pending, success, conflict, and failure states;
- cross-user change notifications and targeted truth refresh;
- PWA installation, version-update, reconnect, and safe-cache behavior;
- responsive, touch, mouse, keyboard, accessibility, and reduced-motion
  contracts;
- incremental migration beginning with `My Jobs`;
- production verification across representative screen sizes and browsers.

### Out of scope

- native iOS, Android, Windows, or macOS applications;
- a second desktop-only interface or duplicated domain logic;
- changes to diagnostic reasoning, topology semantics, confidence/risk rules,
  retrieval, citations, or AutoEYE evidence contracts;
- implicit offline mutation queues for assignment, diagnosis, authorization,
  repair status, payments, or customer communication;
- permanent deletion of production repair history;
- the separate founder-authorized synthetic-data cleanup decision;
- new pricing, messaging providers, production migrations, credentials, or
  customer-data movement.

## Relationship to the active ShopOS plan

This document defines product and application architecture. It does **not**
replace the active status table in
`docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`, which remains the
only implementation source of truth.

Before code begins, the Wave 1 implementation plan must add bounded rows to
that table with one owner, lane, dependency set, allowed paths, verification,
and rollback per row. The architecture waves in this document are not status
rows and cannot be claimed independently.

Current sequencing constraints are explicit:

- AutoEYE Row 46 currently owns its entitlement/access seam and may touch the
  Today/diagnostic paths needed by the pilot. No adaptive-application row may
  write `today-jobs-board`, `today-home`, diagnostic start/access controls, or
  another Row-46-owned path until the coordination protocol records their
  release.
- The future derived board and delivery work in Rows 44–45 consumes this
  architecture rather than being silently pulled forward. The pilot may
  replace broad refresh behavior for existing My/Open Jobs, but it may not add
  Row-45 board, delivery, or closeout features.
- Existing Phase-5 notification and Phase-6 push rows retain ownership of
  customer notifications, push subscriptions, permission UX, and service-
  worker push behavior. Live entity invalidation is a separate privacy-
  minimized synchronization contract and does not pre-authorize those rows.
- Platform-shell and technician-surface changes are separate owned tasks. A
  platform task may not use shell work as permission to edit a technician or
  diagnostic surface.

The first executable work may therefore prove shell primitives, projection
contracts, and tests without touching a shared live surface. The My Jobs pilot
starts only after its lane is unambiguously free.

## Application boundary

```text
Vyntechs
│
├── Public website
│   ├── Marketing
│   ├── Pricing
│   ├── Legal
│   └── Authentication
│
└── Authenticated ShopOS application
    ├── Persistent application frame
    ├── Adaptive workbench composition
    ├── Living repair-order projections
    ├── Precise mutations and reconciliation
    ├── Authorized real-time synchronization
    └── Browser or standalone PWA launch
```

The existing server boundary still performs authentication, entitlement,
profile, membership, role, and tenant checks before composing initial data.
The browser receives bounded projections appropriate for the current actor.
Moving state into a live client surface must not widen any projection.

## Persistent application shell

The signed-in route group shares one application shell containing:

- shop and technician identity;
- primary navigation;
- current workspace outlet;
- connection and application-version status;
- accessible announcement region;
- optional queue and context rails when the active composition supports them.

The shell stays mounted across ShopOS route transitions. A normal navigation
changes the workspace outlet and URL without replacing the document. A full
document transition remains appropriate for sign-in/sign-out, external
checkout, tenant change, an application version that cannot safely continue,
or an unrecoverable authorization-boundary change.

The shell owns only cross-surface continuity. Domain state remains in bounded
stores or component islands so a job update cannot accidentally rerender or
invalidate the entire application. Wave 1 defaults to the existing React
state/reducer patterns; it adds no global state or query-cache dependency
unless the pilot produces a concrete requirement that cannot be met cleanly.

## Adaptive compositions

Composition is selected by the workspace container, then refined by input
capabilities such as coarse touch, hover, fine pointer, and keyboard. Device
names and user-agent strings do not determine the experience.

Initial composition thresholds are application tokens:

- **Compact:** workspace container below 840 CSS pixels;
- **Split:** 840–1,279 CSS pixels;
- **Workbench:** 1,280–1,679 CSS pixels;
- **Expanded workbench:** 1,680 CSS pixels and above.

These thresholds govern composition, not typography scaling. Individual
components also use container queries so a narrow rail renders its compact
form even inside a wide application.

### Compact

Intended for phones, narrow windows, and most portrait tablets.

- one primary work surface at a time;
- compact application header and reachable action dock;
- job context opens as an anchored bottom sheet or focused work surface;
- horizontal gestures activate only after horizontal intent is established,
  preserving vertical scroll;
- returning to the list restores the selected job and exact scroll position;
- nonessential context stays one action away, never hidden permanently.

### Split

Intended for landscape tablets, small laptops, and medium windows.

- queue or job list on the left;
- selected repair order or work surface on the right;
- optional context opens as an overlay rather than compressing the work below
  its usable minimum;
- touch, mouse, trackpad, keyboard, and mixed-input devices receive equivalent
  controls.

### Workbench

Intended for laptops, desktops, and large windows.

- narrow persistent navigation rail;
- shop queue or personal work rail;
- main repair or diagnostic workspace;
- contextual evidence, messages, or authorization opens beside the work when
  room permits;
- the central work surface remains bounded for legibility and reach rather
  than stretching text across the monitor.

### Expanded workbench

Intended for wide monitors and multi-monitor shop stations.

- the workbench composition remains familiar;
- a fourth context rail may remain persistently visible;
- additional width shows evidence, conversation, topology context, or shop
  exceptions—not decorative whitespace or oversized cards;
- no workflow requires the wide composition.

### Resizing and rotation

Composition changes must preserve:

- selected repair order, job, diagnostic, or message;
- URL and browser history;
- confirmed server projections;
- local pending owner and retry identity;
- typed but unconfirmed inputs;
- scroll, focus, topology pan/zoom, and open disclosure state where the target
  composition can represent them.

When space contracts, optional context closes first, the queue becomes a
drawer second, and the main work remains selected. Resizing never restarts the
workflow or silently discards input.

## Living-entity contract

Each independently updating server projection has:

- an entity kind;
- stable entity ID;
- an opaque server version token generated and compared atomically with the
  persisted mutation;
- bounded actor-safe data;
- explicit available actions derived from server truth.

Examples include a ticket job, repair order summary, diagnostic session
summary, assignment count, notification, or message thread summary. The
client keys the rendered element by stable identity and replaces only a newer
authorized projection. An existing `updated_at` value may serve as the opaque
version only when the handler compares it in the same transaction and tests
prove collision-safe stale-write rejection. Client clocks and presentation
timestamps are never concurrency tokens.

A routine mutation request carries:

- action and target identity;
- stable request key for idempotency;
- actor's expected revision;
- only the bounded user input required by that action.

A successful mutation returns:

- the persisted target projection;
- any directly affected summary projections or removals;
- the new authoritative revision;
- a precise result label suitable for visible and assistive feedback.

The browser applies that response atomically to its local view. It does not
call a broad route refresh merely to discover what the mutation changed.

## Mutation experience

```text
User acts on one element
│
├── Element alone enters an honest pending state
├── Server authenticates, authorizes, locks, validates, and persists
│
├── Success
│   ├── Apply returned target projection
│   ├── Apply returned dependent summaries
│   └── Announce the exact persisted result
│
├── Stale or concurrent change
│   ├── Replace only the target with current server truth
│   ├── Preserve safe local input
│   └── Explain what changed and the next available action
│
└── Network or server failure
    ├── Keep unrelated work untouched
    ├── Keep retry-safe local input and request identity
    └── Say that the change was not confirmed
```

Safe navigation or reversible presentation may respond immediately. A
repair-status, assignment, authorization, diagnostic, payment, or communication
state never displays a false completed state while confirmation is pending.

Each entity has at most one pending mutation owner. Duplicate gestures,
double taps, retries, and delayed responses cannot apply an older revision over
a newer one.

## Cross-user synchronization

Changes made by another authorized shop member should appear without manual
refresh. The live channel transmits a privacy-minimized invalidation envelope:

- shop-scoped channel identity;
- entity kind and ID;
- new revision;
- event cursor or ordering token.

The event is a signal, not the display payload. The client retrieves the
current authorized projection from the normal server boundary and replaces
only that entity. Private customer content, diagnostic evidence, storage
paths, notes, or authorization details do not travel in the invalidation
envelope.

On reconnect, the client presents a connection state, requests changes since
its last cursor when supported, and otherwise reconciles only the currently
mounted entity collections. A reconnect does not force a document reload or
discard local input.

## Navigation and focus

- Selecting work updates the URL so refresh, recovery, and sharing preserve
  the destination.
- The persistent shell and appropriate parent rail stay mounted.
- Back returns to the previous application context and restored scroll, not a
  newly constructed page.
- Focus remains on the acted element or moves to its explicit result.
- Background updates never steal focus.
- When an updated element disappears from the current collection, focus moves
  to the nearest stable sibling or collection heading and the removal is
  announced.

## Gestures and input equivalence

The gesture grammar remains consistent:

- right moves work forward through the one server-permitted primary action;
- left moves responsibility or opens bounded secondary actions;
- no full swipe hard-deletes a production repair record;
- actions requiring a reason, recipient, irreversible state, or consequential
  confirmation open an anchored sheet rather than firing on release.

Every gesture has a visible 44×44 CSS-pixel control, keyboard access, screen-
reader name, and reduced-motion equivalent. Mouse users may drag when useful,
but hover is never required to discover the available action.

## PWA and version behavior

The existing manifest and service-worker prerequisites are extended rather
than replaced.

- Browser use remains fully supported.
- Supported browsers may install Vyntechs with its own icon and standalone
  window.
- Wave 1A caches only its static public offline document and explicitly
  allowlisted public icon/brand assets. Broader versioned shell-asset caching
  requires separate executable proof that authenticated or user-controlled
  content cannot enter the cache.
- Authenticated HTML, API responses, customer records, repair orders, messages,
  diagnostic observations, signed URLs, and payment data are network-only
  unless a later privacy-reviewed design explicitly proves safe storage.
- Offline mode never fabricates freshness. Consequential controls disable with
  a plain connection explanation.
- A newly downloaded application version never forces a reload during active
  work. It offers a safe update point, preserves confirmed state, and reloads
  only after the user reaches or chooses that point.
- Service-worker failure falls back to the normal browser application without
  blocking work.

## Visual and motion system

The existing Vyntechs typography and tokens remain the foundation. This work
does not introduce a generic dashboard aesthetic.

- the stable shell is quiet and architectural;
- the selected work carries the visual weight;
- rails use compact technical typography and encode real responsibility or
  state;
- one restrained mechanical catch marks a committed gesture or persisted
  state transition;
- local transitions complete in roughly 160–240 ms when motion is enabled;
- no global spinner, page flash, fake progress narration, or unrelated skeleton
  appears for a local action;
- reduced-motion mode preserves hierarchy and feedback without movement.

## First implementation wave: foundation, then My Jobs

The pilot proves the architecture without changing diagnostic-engine behavior.

### Wave 1A — foundation and shell contracts

1. Record bounded platform and technician rows in the active ShopOS status
   table before implementation.
2. Introduce the persistent authenticated application-shell primitives and
   composition tokens while preserving current routes and authorization.
3. Add the bounded entity/version, precise mutation-result, focus, reconnect,
   and application-version contracts with isolated tests.
4. Prove the compact, split, workbench, and expanded-workbench composition
   primitive in isolated tests, and prove the persistent shell on an honest
   existing authenticated route without editing a Row-46-owned surface. The
   first live multi-rail composition belongs to Wave 1B.
5. Keep current production navigation available as the rollback path.

### Wave 1B — My Jobs pilot after path release

1. Confirm in the active plan and AutoEYE coordination log that no other lane
   owns the Today/diagnostic files required by the pilot.
2. Compose `My Jobs` in compact, split, workbench, and expanded-workbench
   modes from the existing role-safe job projections.
3. Move only the board's client-visible collections into one bounded
   jobs-board reducer keyed by job ID.
4. Change claim and any included assignment mutations to return the updated
   ticket/job projection and affected collection counts.
5. Replace broad `router.refresh()` recovery with precise projection apply,
   stale-target reconciliation, and explicit local failure.
6. Preserve existing diagnostic start/open, simple-work, ticket, paywall,
   role, tenant, and five-open-session-cap semantics.
7. Add gesture presentation only after the underlying visible actions and
   precise mutation contracts pass independently.

The pilot does not add permanent synthetic-data deletion. A cleanup action may
later use the same precise-update mechanics after its authorization, scope,
lineage, and deletion semantics receive their own approved design.

## Migration waves

There is no big-bang conversion.

### Wave 1 — Foundation, then My Jobs

Wave 1A delivers the persistent shell, adaptive composition primitives,
entity/version helpers, and navigation/focus continuity. Wave 1B begins after
shared-path release and adds precise jobs-board mutations plus the device
matrix on the real pilot surface.

### Wave 2 — Living repair order

Ticket identity, job ledger, assignment, authorization, simple work, evidence,
and quote summaries adopt the same projection contract without changing their
domain handlers.

### Wave 3 — Diagnostic workspace

Current step, observation, evidence count, topology selection, lock decision,
repair phase, and closeout update locally while the four permitted ShopOS/
engine seams and diagnostic doctrine remain authoritative.

### Wave 4 — Communication and supporting operations

Messages, notifications, parts, estimates, settings, and curator operations
adopt targeted invalidation where it materially improves continuity. External
redirects such as checkout remain explicit full transitions.

### Wave 5 — Cross-user and installation hardening

Authorized invalidation delivery, reconnect cursors, standalone installation,
version activation, cache audit, production observability, and progressive
rollout are proven across the complete application.

Each wave has its own implementation plan, tests, review, rollback, and
production proof. Shipping one wave is a checkpoint, not permission to weaken
later domain boundaries.

## Failure behavior

- A failed local action marks only its owning element and retains retry-safe
  input.
- A stale action replaces only its target with current server truth.
- An authorization or tenant failure removes inaccessible content immediately,
  clears related client projections, and routes through the authenticated
  boundary without displaying cached private data.
- A live-channel outage degrades to precise mutation responses and bounded
  foreground reconciliation; it does not block normal work.
- A service-worker outage degrades to browser operation.
- An application-version mismatch pauses new consequential mutations and
  offers a safe controlled update; it never silently mixes incompatible
  contracts.

## Accessibility contract

- all functionality works without swipe, drag, hover, or animation;
- visible targets are at least 44×44 CSS pixels in bay workflows;
- focus order follows visual work order in every composition;
- composition changes preserve or intentionally restore focus;
- local successes use polite announcements and local failures use alerts;
- background updates announce only material changes and never interrupt input;
- status never relies on color alone;
- compact and expanded compositions preserve the same accessible names and
  action vocabulary;
- software keyboard, safe areas, zoom, 200% text, and reduced motion are
  supported without losing primary actions.

## Verification contract

### Architecture and domain

- server authorization, paywall, membership, role, assignment, tenant, and
  workflow tests remain authoritative;
- entity projections reject unknown, missing, wrong-actor, wrong-tenant, stale,
  and non-monotonic revisions;
- duplicate request keys are exact idempotent retries and conflicting reuse
  fails closed;
- older responses cannot overwrite newer local truth;
- live invalidation envelopes expose no private display content.

### Interaction

- a routine job mutation performs no full-document navigation and no broad
  route refresh;
- only the affected entity and declared dependent summaries rerender;
- scroll, focus, selected work, disclosures, and unrelated local input survive;
- uncertain responses retain the same retry identity;
- conflicts restore exact server truth without false success;
- swipe, button, mouse, and keyboard paths produce the same server intent.

### Responsive matrix

Verify at minimum:

- 320×568 and 375×812 compact phones;
- 430×932 large phone;
- 768×1,024 portrait tablet;
- 1,024×768 landscape tablet;
- 1,280×800 small laptop;
- 1,440×900 desktop;
- 1,920×1,080 wide desktop;
- a window resized continuously across every composition threshold;
- coarse touch, fine pointer, keyboard-only, 200% zoom, reduced motion, and
  software-keyboard states.

Representative browser coverage includes current Chromium desktop, Edge on
Windows, Safari on macOS and iOS/iPadOS, and Chrome on Android. Standalone PWA
launch is verified where the platform supports it; ordinary browser use is the
required fallback everywhere.

### Reliability and privacy

- weak connection, offline transition, reconnect, delayed response, duplicate
  event, out-of-order event, concurrent reassignment, and expired session;
- no authenticated response or customer/repair/diagnostic content enters a
  public or shared service-worker cache;
- application update never interrupts an active mutation or discards input;
- local pending feedback appears without a global loading state;
- production logs identify contract/version failures without recording private
  payloads.

### Release proof

- focused unit, domain, component, and route tests;
- full test suite, TypeScript, production build, and clean diff checks;
- visual regression at every composition;
- keyboard and accessibility inspection on wired surfaces;
- independent product, privacy/security, and whole-branch review with zero
  unresolved Critical or Important findings;
- preview deployment and signed non-mutating production smoke before rollout;
- fresh production error and performance logs after rollout.

## Success criteria

The design is successful when:

1. a technician can act on one job without the application frame or unrelated
   work visibly refreshing;
2. the same selected work survives rotation, resizing, browser navigation, and
   supported standalone launch;
3. phone, tablet, laptop, and desktop each feel intentionally composed;
4. another authorized employee's change updates only the affected element;
5. offline or uncertain state is explicit and never presented as persisted;
6. no server authorization or diagnostic safety rule moves into client trust;
7. the first wave can be rolled back without schema rollback or engine change.

## Rollback and stop conditions

Each wave is independently revertible. The initial shell and jobs-board wave
must preserve current routes and server handlers so rollback restores the prior
composition without data migration.

Stop and return for a separate decision if implementation requires:

- native application development;
- a production schema migration not already approved by the active ShopOS
  plan;
- caching private authenticated content outside the current request;
- weakening server authorization, tenant isolation, idempotency, assignment,
  risk, or diagnostic-engine boundaries;
- permanent data deletion, external provider/spend, public release claims, or
  production customer-data movement;
- duplicated mobile and desktop domain logic.
