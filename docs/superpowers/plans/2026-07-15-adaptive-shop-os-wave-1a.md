# Adaptive ShopOS Wave 1A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Use `superpowers:test-driven-development` for each code task and `superpowers:verification-before-completion` before reporting the wave complete. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the privacy-safe, continuously mounted application foundation for authenticated ShopOS without touching the AutoEYE-owned Today/diagnostic seam or pulling future board, delivery, notification, or push work forward.

**Architecture:** Keep Next.js App Router and server authorization as the boundary. Harden the existing service worker so authenticated documents and API data are network-only, activate new application versions only after the user chooses a safe point, wrap the signed-in route group in one persistent shell, add CSS-container adaptive composition primitives, and define pure opaque-version replacement helpers for later living surfaces. Use existing React state/reducer patterns; add no global state or query-cache dependency.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6, CSS Modules, browser Service Worker APIs, Vitest 4, Testing Library.

## Global constraints

- The active ShopOS status table remains the implementation source of truth. Row 47 owns this wave; Row 48 stays blocked until Row 46 releases the shared technician paths in the lane-coordination log.
- Do not edit `components/screens/today-jobs-board.tsx`, `components/screens/today-home.tsx`, their styles/tests, diagnostic start/access controls, entitlement UI, or another Row-46-owned path.
- Do not add Row 44–45 board, delivery, closeout, or vehicle-history behavior.
- Do not add Row 36/39/40 notification delivery, push subscription, permission, or service-worker push behavior. This wave may make application-version activation safe; that is not push scope.
- Do not change schemas, migrations, providers, diagnostic reasoning, topology semantics, retrieval, evidence, pricing, payments, permissions, tenant boundaries, or production data.
- Never cache authenticated HTML, API responses, private projections, mutation payloads, or user-entered drafts in the service worker, Cache Storage, local storage, session storage, IndexedDB, URLs, analytics, or logs.
- The application remains usable in a normal browser when service workers, installation, or connectivity events are unavailable.
- The service worker may cache only a public offline document and explicitly allowlisted public icons/brand assets.
- Application updates never reload an active workflow automatically. A waiting worker activates only after an explicit `Update when ready` action.
- Connectivity copy reports browser-observed network state only. It must not claim a mutation was saved or queued.
- Adaptive composition uses workspace container width, not user-agent/device detection: compact `<840px`, split `840–1279px`, workbench `1280–1679px`, expanded `>=1680px`.
- Touch-only actions are forbidden. Interactive targets are at least 44px, keyboard focus remains visible, reduced motion is honored, and status announcements are polite.
- No broad `router.refresh()` abstraction, global event bus for domain data, global store, query client, or optimistic cross-entity update is introduced in Wave 1A.
- Each commit is independently reviewable and must leave focused tests green.

## File map

- Modify `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`: claim and later close Row 47; keep Row 48 blocked until the shared-path release is recorded.
- Create `public/sw-policy.js`: executable request-classification policy with an explicit public-cache allowlist.
- Modify `public/sw.js`: network-only documents/private data, public offline fallback, user-controlled activation, old-cache cleanup.
- Create `public/offline.html`: static, customer-data-free offline state.
- Create `tests/unit/service-worker-policy.test.ts`: executable classification and privacy regressions.
- Modify `components/sw-register.tsx`: announce a waiting application version without activating it.
- Modify `tests/unit/sw-register.test.tsx`: registration and update-ready regressions.
- Create `components/app-shell/pwa-update-events.ts`: typed browser event contract for a waiting worker.
- Create `components/app-shell/pwa-update-status.tsx`: signed-in update-ready control.
- Create `tests/unit/pwa-update-status.test.tsx`: explicit-activation and no-auto-reload regressions.
- Create `components/app-shell/connection-status.tsx`: honest online/offline client island.
- Create `tests/unit/connection-status.test.tsx`: browser-state and announcement regressions.
- Create `components/app-shell/shop-os-shell.tsx`: persistent signed-in frame and status region.
- Create `components/app-shell/adaptive-workbench.tsx`: optional navigation/queue/main/context composition primitive.
- Create `components/app-shell/app-shell.module.css`: container thresholds, status placement, focus, reduced-motion, and safe-area rules.
- Create `tests/unit/app-shell.test.tsx`: stable shell, slots, accessibility, and breakpoint-source contract tests.
- Modify `app/(app)/layout.tsx`: mount the persistent shell inside the existing authenticated provider.
- Create `lib/ui/live-entity.ts`: opaque-version compare-and-replace/remove helpers.
- Create `tests/unit/live-entity.test.ts`: applied, stale, mismatch, removal, and immutability regressions.

---

### Task 1: Claim the bounded foundation row

**Files:**
- Modify: `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`

- [ ] **Step 1: Confirm Row 46 still owns the shared technician seam**

Run:

```bash
git fetch origin main
git log --oneline --decorate -8 origin/main
rg -n "\| 4[678] \|" docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md
rg -n "Row 46|release|today-jobs-board|today-home" docs/operations/2026-07-14-autoeye-lane-coordination.md
```

Expected: Row 46 remains `in_progress`; Row 47 is available for platform foundation; Row 48 remains `blocked` unless the coordination log explicitly releases every shared pilot path.

- [ ] **Step 2: Create the implementation branch and draft PR**

Create a fresh worktree from current `origin/main`, use branch `feat/adaptive-shop-os-wave-1a`, and open a draft PR before code. Record the resulting PR number in Row 47; do not use a guessed number.

- [ ] **Step 3: Mark only Row 47 in progress**

Set Row 47 to `in_progress`, lane owner `P`, and name the draft PR. Leave Row 48 `blocked` with the Row-46 release condition unchanged.

- [ ] **Step 4: Commit the ownership claim**

```bash
git add docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md
git commit -m "docs: claim adaptive ShopOS foundation"
```

---

### Task 2: Make the service worker privacy-safe

**Files:**
- Create: `public/sw-policy.js`
- Modify: `public/sw.js`
- Create: `public/offline.html`
- Create: `tests/unit/service-worker-policy.test.ts`
- Modify: `tests/unit/sw-register.test.tsx`

**Contract:** `classifyRequest(request, origin)` returns exactly `navigate-network`, `public-cache`, or `network`. Only same-origin `GET` requests below `/icons/` or `/brand/` may return `public-cache`. Documents always return `navigate-network`; every other request is network-only and is not intercepted by the worker.

- [ ] **Step 1: Write the executable policy tests first**

Load `public/sw-policy.js` in `node:vm` and prove this table:

| Request | Expected policy |
|---|---|
| signed-in `/today`, `mode:navigate` | `navigate-network` |
| `/api/jobs/1`, `destination:''` | `network` |
| `/_next/static/chunk.js` | `network` |
| same-origin `/icons/icon-192.png` | `public-cache` |
| same-origin `/brand/mark.svg` | `public-cache` |
| same-origin `/uploads/evidence.jpg` | `network` |
| cross-origin image | `network` |
| `POST` to any URL | `network` |

Also read `public/sw.js` as source and assert:

```ts
expect(source).not.toMatch(/caches\.match\(event\.request/)
expect(source).not.toMatch(/const SHELL = \['\/'\]/)
expect(source.match(/self\.skipWaiting\(\)/g)).toHaveLength(1)
expect(source).toContain("data.type === 'ACTIVATE'")
expect(source).toContain("caches.match('/offline.html')")
const navigateStart = source.indexOf("if (policy === 'navigate-network')")
const publicCacheStart = source.indexOf("if (policy === 'public-cache')")
expect(navigateStart).toBeGreaterThan(-1)
expect(publicCacheStart).toBeGreaterThan(navigateStart)
expect(source.slice(navigateStart, publicCacheStart)).not.toMatch(/cache\.put|cache\.match/)
expect(source.match(/cache\.put\(/g)).toHaveLength(1)
expect(source.indexOf('cache.put(')).toBeGreaterThan(publicCacheStart)
```

- [ ] **Step 2: Run the focused tests and confirm RED**

```bash
pnpm vitest run tests/unit/service-worker-policy.test.ts tests/unit/sw-register.test.tsx
```

Expected: FAIL because `sw-policy.js` and the safe policy do not exist, and the current worker caches signed-in navigations.

- [ ] **Step 3: Implement the pure request policy**

Create `public/sw-policy.js` as a plain script usable by both a service worker and `node:vm`:

```js
;(function installVyntechsSwPolicy(root) {
  const publicPrefixes = ['/icons/', '/brand/']

  function classifyRequest(request, origin) {
    const url = new URL(request.url)
    if (request.method !== 'GET' || url.origin !== origin) return 'network'
    if (request.mode === 'navigate' || request.destination === 'document') {
      return 'navigate-network'
    }
    return publicPrefixes.some((prefix) => url.pathname.startsWith(prefix))
      ? 'public-cache'
      : 'network'
  }

  root.VyntechsSwPolicy = Object.freeze({ classifyRequest })
})(typeof self === 'object' ? self : globalThis)
```

- [ ] **Step 4: Replace the unsafe cache behavior**

Implement `public/sw.js` with these exact behaviors:

```js
importScripts('/sw-policy.js')

const CACHE = 'vyntechs-public-shell-v4'
const PUBLIC_SHELL = ['/offline.html', '/icons/icon-192.png', '/icons/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PUBLIC_SHELL)))
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'ACTIVATE') self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const policy = self.VyntechsSwPolicy.classifyRequest(event.request, self.location.origin)

  if (policy === 'navigate-network') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/offline.html')))
    return
  }

  if (policy === 'public-cache') {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(event.request)
        if (cached) return cached
        const response = await fetch(event.request)
        if (response.ok) await cache.put(event.request, response.clone())
        return response
      }),
    )
  }
})
```

The only `cache.put(event.request, ...)` is inside the `public-cache` branch selected by the executable allowlist. The source assertion must prove the put is structurally inside that branch and that navigation uses only the fixed `/offline.html` key.

- [ ] **Step 5: Add a static public offline document**

Create `public/offline.html` with no scripts, user names, job data, route snapshot, or cached API content. It must include viewport metadata, the Vyntechs name, `Connection needed`, `Reconnect to continue`, and a normal link to `/today`. Use system fonts and inline static CSS only.

- [ ] **Step 6: Run focused tests and commit**

```bash
pnpm vitest run tests/unit/service-worker-policy.test.ts tests/unit/sw-register.test.tsx
git add public/sw-policy.js public/sw.js public/offline.html tests/unit/service-worker-policy.test.ts tests/unit/sw-register.test.tsx
git commit -m "fix: keep private ShopOS data out of service worker cache"
```

Expected: PASS; no signed-in document or non-allowlisted request is cacheable.

---

### Task 3: Make application updates user-controlled

**Files:**
- Create: `components/app-shell/pwa-update-events.ts`
- Modify: `components/sw-register.tsx`
- Create: `components/app-shell/pwa-update-status.tsx`
- Modify: `tests/unit/sw-register.test.tsx`
- Create: `tests/unit/pwa-update-status.test.tsx`

**Interfaces:**

```ts
export const PWA_UPDATE_READY_EVENT = 'vyntechs:pwa-update-ready'

export type PwaUpdateReadyDetail = {
  waiting: ServiceWorker
}

export function announcePwaUpdateReady(waiting: ServiceWorker): void
```

- [ ] **Step 1: Write failing update lifecycle tests**

Prove:

- an already-waiting registration announces one typed update-ready event;
- a newly installed worker announces only when an existing controller proves this is an update, not first install;
- registration failure remains non-fatal and does not leak exception details into the UI;
- `PwaUpdateStatus` is absent until an update-ready event arrives;
- its `Update when ready` button posts exactly `{ type: 'ACTIVATE' }` to that waiting worker;
- no message, activation, or reload occurs merely because the event arrived;
- `controllerchange` invokes the injected reload callback once after the explicit button action;
- the control is keyboard operable and exposes a polite status.

- [ ] **Step 2: Run tests and confirm RED**

```bash
pnpm vitest run tests/unit/sw-register.test.tsx tests/unit/pwa-update-status.test.tsx
```

- [ ] **Step 3: Implement the event and registration lifecycle**

`announcePwaUpdateReady` dispatches `CustomEvent<PwaUpdateReadyDetail>` on `window`. In `SwRegister`, await `navigator.serviceWorker.register('/sw.js')`; announce `registration.waiting` immediately when present; otherwise observe `updatefound` and announce the installing worker only after `state === 'installed'` and `navigator.serviceWorker.controller` exists. Do not call `skipWaiting`, `update`, `reload`, or navigate from `SwRegister`.

- [ ] **Step 4: Implement the signed-in update control**

`PwaUpdateStatus` owns the waiting worker in component memory. On the explicit action, attach a one-time `controllerchange` listener, post `{ type: 'ACTIVATE' }`, disable the button, and show `Updating application…`. If posting throws, remove the listener, re-enable the control, and show `Update could not start. Keep working and try again.` Do not discard children, form state, or route state before `controllerchange`.

- [ ] **Step 5: Run focused tests and commit**

```bash
pnpm vitest run tests/unit/sw-register.test.tsx tests/unit/pwa-update-status.test.tsx
git add components/sw-register.tsx components/app-shell/pwa-update-events.ts components/app-shell/pwa-update-status.tsx tests/unit/sw-register.test.tsx tests/unit/pwa-update-status.test.tsx
git commit -m "feat: activate ShopOS updates at a safe point"
```

---

### Task 4: Add honest connectivity status

**Files:**
- Create: `components/app-shell/connection-status.tsx`
- Create: `tests/unit/connection-status.test.tsx`

- [ ] **Step 1: Write failing browser-state tests**

Prove that the component renders nothing while `navigator.onLine` is true, renders `Connection needed · Unsaved actions require a connection` in a polite status after `offline`, clears after `online`, removes both event listeners on unmount, and never contains `saved`, `synced`, or `queued` success language.

- [ ] **Step 2: Run the focused test and confirm RED**

```bash
pnpm vitest run tests/unit/connection-status.test.tsx
```

- [ ] **Step 3: Implement with `useSyncExternalStore`**

Use one subscription that listens to `online` and `offline`, `navigator.onLine` as the client snapshot, and `true` as the server snapshot. Render a `<p role="status" aria-live="polite">` only while offline. Do not persist connectivity state or intercept mutations.

- [ ] **Step 4: Run and commit**

```bash
pnpm vitest run tests/unit/connection-status.test.tsx
git add components/app-shell/connection-status.tsx tests/unit/connection-status.test.tsx
git commit -m "feat: show honest ShopOS connection status"
```

---

### Task 5: Mount the persistent adaptive application shell

**Files:**
- Create: `components/app-shell/shop-os-shell.tsx`
- Create: `components/app-shell/adaptive-workbench.tsx`
- Create: `components/app-shell/app-shell.module.css`
- Create: `tests/unit/app-shell.test.tsx`
- Modify: `app/(app)/layout.tsx`

**Interfaces:**

```ts
export function ShopOsShell({ children }: { children: React.ReactNode }): React.ReactElement

export type AdaptiveWorkbenchProps = {
  navigation?: React.ReactNode
  queue?: React.ReactNode
  main: React.ReactNode
  context?: React.ReactNode
  queueLabel?: string
  mainLabel: string
  contextLabel?: string
}

export function AdaptiveWorkbench(props: AdaptiveWorkbenchProps): React.ReactElement
```

- [ ] **Step 1: Write failing shell and composition tests**

Prove:

- one stable shell wraps children and exposes `#shop-os-workspace` as the skip-link target;
- connection and application-update controls live in one labelled status region outside the workspace outlet;
- the shell does not use `role="application"`;
- `AdaptiveWorkbench` always renders `main`, renders only supplied optional regions, and labels queue/main/context regions;
- missing optional rails do not leave empty DOM regions;
- the CSS source contains container thresholds `840px`, `1280px`, and `1680px`, `container-type: inline-size`, `100dvh`, `env(safe-area-inset-bottom)`, a visible `:focus-visible` rule, a `prefers-reduced-motion: reduce` rule, and minimum `44px` interactive sizing;
- neither component reads `window.innerWidth`, `navigator.userAgent`, or device names.

- [ ] **Step 2: Run the focused test and confirm RED**

```bash
pnpm vitest run tests/unit/app-shell.test.tsx
```

- [ ] **Step 3: Implement `ShopOsShell`**

Render a visually hidden-until-focused `Skip to current work` link, one shell-status region containing `ConnectionStatus` and `PwaUpdateStatus`, and a stable `<div id="shop-os-workspace">` outlet. Keep the existing `AppHeaderProvider` outside the shell so current header context remains unchanged. Do not move a page-level `<main>` into another `<main>`.

- [ ] **Step 4: Implement the adaptive workbench primitive**

Use CSS Grid and a query container. Compact exposes main only in the grid; optional rail content must remain reachable through caller-supplied compact controls when a live surface adopts the primitive. Split exposes queue + main. Workbench exposes navigation + queue + main. Expanded exposes navigation + queue + main + context. Bound the main reading width and let context consume added space; never enlarge type merely because the viewport is wide.

The primitive is foundation-only in this wave. Test it directly, but do not compose it into Today/My Jobs until Row 48 is unblocked.

- [ ] **Step 5: Replace the anonymous signed-in wrapper**

Change `app/(app)/layout.tsx` from the inline `minHeight` `<div>` to:

```tsx
<AppHeaderProvider shopName={shop?.name ?? null} isFounder={founder}>
  <ShopOsShell>{children}</ShopOsShell>
</AppHeaderProvider>
```

Do not change authentication, profile loading, shop lookup, founder detection, redirects, route files, or page data.

- [ ] **Step 6: Run focused tests and commit**

```bash
pnpm vitest run tests/unit/app-shell.test.tsx tests/unit/connection-status.test.tsx tests/unit/pwa-update-status.test.tsx
git add components/app-shell app/'(app)'/layout.tsx tests/unit/app-shell.test.tsx
git commit -m "feat: mount the adaptive ShopOS application shell"
```

---

### Task 6: Define opaque-version living-entity replacements

**Files:**
- Create: `lib/ui/live-entity.ts`
- Create: `tests/unit/live-entity.test.ts`

**Interfaces:**

```ts
export type VersionedEntity<T> = Readonly<{
  id: string
  version: string
  data: Readonly<T>
}>

export type EntityReplacement<T> = Readonly<{
  expectedVersion: string
  entity: VersionedEntity<T>
}>

export type EntityRemoval = Readonly<{
  id: string
  expectedVersion: string
}>

export type EntityApplyResult<T> =
  | Readonly<{ status: 'applied'; entity: VersionedEntity<T> | null }>
  | Readonly<{ status: 'stale'; entity: VersionedEntity<T> }>
  | Readonly<{ status: 'mismatch'; entity: VersionedEntity<T> }>

export function applyEntityReplacement<T>(
  current: VersionedEntity<T>,
  replacement: EntityReplacement<T>,
): EntityApplyResult<T>

export function applyEntityRemoval<T>(
  current: VersionedEntity<T>,
  removal: EntityRemoval,
): EntityApplyResult<T>
```

- [ ] **Step 1: Write failing pure-contract tests**

Prove:

- matching ID + matching `expectedVersion` applies the returned entity;
- matching ID + changed current version returns `stale` and preserves the exact current object;
- changed ID returns `mismatch` even when versions match;
- removal applies only when ID and expected version both match;
- version strings are treated as opaque equality tokens, never parsed, sorted, timestamp-compared, or generated by the client;
- inputs are not mutated;
- empty IDs/versions fail closed as `mismatch`, not applied.

- [ ] **Step 2: Run the focused test and confirm RED**

```bash
pnpm vitest run tests/unit/live-entity.test.ts
```

- [ ] **Step 3: Implement the pure helpers**

The replacement applies only when all identifiers and version tokens are non-empty, `current.id === replacement.entity.id`, and `current.version === replacement.expectedVersion`. A removal uses the same rule. Return the current object unchanged for `stale` and `mismatch`; do not clone it. Do not add a clock, sequence parser, retry loop, transport, global store, React hook, or domain-specific job type.

- [ ] **Step 4: Run and commit**

```bash
pnpm vitest run tests/unit/live-entity.test.ts
git add lib/ui/live-entity.ts tests/unit/live-entity.test.ts
git commit -m "feat: add version-safe live entity replacements"
```

---

### Task 7: Integrate, pressure-test, and close only Wave 1A

**Files:**
- Modify: `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`
- Review: every file changed in Tasks 1–6

- [ ] **Step 1: Run all focused proof**

```bash
pnpm vitest run \
  tests/unit/service-worker-policy.test.ts \
  tests/unit/sw-register.test.tsx \
  tests/unit/pwa-update-status.test.tsx \
  tests/unit/connection-status.test.tsx \
  tests/unit/app-shell.test.tsx \
  tests/unit/live-entity.test.ts
```

Expected: every test passes with no retries.

- [ ] **Step 2: Run privacy and scope guards**

```bash
rg -n "cache\.put\(event\.request|caches\.match\(event\.request|localStorage|sessionStorage|indexedDB|router\.refresh|userAgent|innerWidth" \
  public/sw.js public/sw-policy.js components/app-shell lib/ui/live-entity.ts
git diff --name-only origin/main...HEAD
```

Expected: service-worker cache writes exist only in the explicitly classified `public-cache` branch; no private persistence, broad refresh, or device detection appears; the diff contains no Today/diagnostic/Row-46-owned file and no schema/migration/provider file.

- [ ] **Step 3: Run the repository gates**

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm build
```

Expected: all commands exit 0. Record exact test file/test counts and the build result in Row 47 and the PR.

- [ ] **Step 4: Verify the observable browser story**

Using an isolated QA identity with no credentials committed to the repository:

1. Open one authenticated route at 375, 1024, 1440, and 1920 CSS-pixel widths.
2. Confirm the document does not reload during ordinary authenticated client navigation.
3. Confirm keyboard skip-link and focus indication work.
4. Simulate offline: the signed-in shell reports connection loss, a fresh navigation displays only the public offline document, and no prior job/customer content appears from Cache Storage.
5. Install a waiting worker: active work remains untouched until `Update when ready` is selected; the application reloads once after `controllerchange`.
6. Inspect Cache Storage and prove it contains only `/offline.html` and allowlisted public icon/brand assets.
7. Confirm phone portrait, tablet split width, laptop, and wide desktop show no horizontal page overflow.

Expected: the application foundation is continuous and honest; private data is never served from the worker cache.

- [ ] **Step 5: Perform the pressure-test review**

Review the full branch diff for:

- accidental Row 40 push scope;
- accidental Row 46 shared-path edits;
- hidden private caching or offline-write claims;
- automatic update/reload behavior;
- inaccessible status/focus behavior;
- unused abstraction beyond the one shell, one workbench primitive, one event contract, and two pure entity helpers;
- hydration instability, listener leaks, and full-page navigation regressions.

Fix every Critical or Important issue, rerun the affected focused tests, then rerun all three repository gates.

- [ ] **Step 6: Close Row 47 without unblocking Row 48**

After all proof passes, set Row 47 to `complete` with the actual implementation PR, exact test counts, TypeScript/build result, and browser proof. Keep durable status in the active plan's §11 table. If implementation reality drifted from the approved phase text, add an `Implementation correction` callout at the end of the relevant phase with the verified behavior, remaining gates, and Row 48's release condition.

Do not change Row 48 from `blocked` based on inference, inactivity, or a clean merge alone.

- [ ] **Step 7: Commit final evidence and mark the implementation PR ready**

```bash
git add docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md
git commit -m "docs: record adaptive ShopOS foundation proof"
git status --short
git diff --check origin/main...HEAD
```

Expected: clean worktree, no whitespace errors, focused/full tests green, TypeScript/build green, browser proof recorded, Row 48 still blocked. Push the branch and mark the implementation PR ready for founder-authorized merge; do not merge or deploy without that hard gate.

### Task 8: Close the legacy private-cache migration before release

**Root cause:** The privacy-safe worker waits for explicit activation, but the currently deployed `vyntechs-shell-v3` worker remains active during that wait. V3 continues writing and serving authenticated navigation responses, so merely installing v4 does not satisfy the private-cache prohibition.

**Files:**
- Modify: `public/sw-policy.js`
- Modify: `public/sw.js`
- Modify: `components/sw-register.tsx`
- Modify: `tests/unit/service-worker-policy.test.ts`
- Modify: `tests/unit/sw-register.test.tsx`

- [ ] **Step 1: Prove the unsafe upgrade state with RED tests**

Add pure and executable worker-lifecycle tests that begin with the exact active v3 worker. Prove the safe worker does not remain waiting behind that legacy controller. Prove activation scrubs the v3 cache around controller takeover, including a delayed un-awaited v3 `cache.put`, without reloading the document. Also prove an active public-only worker with the activation-only public-policy receipt remains waiting for the explicit safe-point action even when its live response is delayed or unavailable.

- [ ] **Step 2: Add a one-time fail-closed privacy migration**

Register `/sw.js?cache-policy=public-v4` at explicit scope `/` with `updateViaCache: 'none'`, then call `registration.update()` so the same-URL register fast path cannot leave v3 or an earlier waiting v4 untouched. The URL change and explicit update are migration/update triggers only; neither is safety proof alone. A distinct cache named `vyntechs-public-policy-v1` holds exactly one public receipt at the allowlisted `/icons/icon-192.png?cache-policy=public-v4`, with `x-vyntechs-cache-policy: public-only-v1`. Write it only after successful safe-worker activation or bounded active-worker recovery has scrubbed every obsolete cache and verified the clean catalog; install and durable-proof validation must never create it. The exact deployed v3 worker and any merely waiting v4 worker therefore cannot forge “migration complete.” Classify an active controller as durably safe without scheduling-sensitive messaging only when all facts agree: the active worker has the exact same-origin `/sw.js?cache-policy=public-v4` identity, a side-effect-free targeted lookup returns the exact receipt, the policy cache contains exactly that one request, and the complete cache catalog contains no name except the policy cache and current public shell. A stale, empty, extra-entry, wrong-receipt, identity-mismatched, or obsolete-cache-adjacent policy cache is not proof. Otherwise challenge the active worker over a transferred `MessageChannel` for the stable `public-only-v1` capability. The current safe worker answers that exact probe. A timely exact response preserves the normal waiting lifecycle while keeping install incapable of creating durable proof. Missing, malformed, different, timed-out, or thrown responses — including any channel setup or cleanup failure — are explicitly `unknown-and-unsafe` and permit automatic `skipWaiting()` without reload. Storage eviction or manual storage clearing erases durable safety proof; privacy-first replacement in that exceptional unknown state is intentional, not an ordinary update path. With no active worker, preserve first-install behavior. Keep the explicit `ACTIVATE` message for ordinary future updates.

Do not start or await public-shell seeding on the `unknown-and-unsafe` path; activate network-only so quota, asset, interruption, late work, or a hanging cache cannot preserve v3. Bound every Cache Storage operation and client claim so failure cannot strand takeover indefinitely. Seed normally only on first install or behind a durably proven/timely-attested safe controller, where failure must preserve the existing safe controller. At activation start, overwrite the policy receipt with `revoked-v1` before attempting deletion, so a failed deletion remains untrusted for that worker global. Retain only the current public-shell and policy caches, scrub every other cache, claim clients, scrub again, then replace the revoked policy cache with the exact receipt only after deletion is verified. A freshly booted active worker must assume proof is revoked rather than trust any stored receipt. Its next intercepted navigation or public-asset event extends its lifetime with bounded recovery: revoke the old receipt, resume the obsolete-cache scrub, and recreate exact proof only after the clean catalog is verified. A failed recovery stays network-only and retries on the next eligible event; it never trusts the pre-existing receipt, including when revocation write and marker deletion both fail. Any timeout, throw, failed deletion, malformed result, wrong or extra receipt, or dirty catalog withholds durable proof and leaves the worker network-only. Every cache read and write — including the fixed offline-navigation fallback — requires the full identity/receipt/clean-catalog proof. A successful public network response must return without waiting for bounded recovery or its bounded background cache write.

> **Implementation correction (2026-07-15):** Cache Storage has no non-creating “open existing cache” operation, so an empty marker has an unavoidable eviction race: validation can recreate the very proof it is checking. The single allowlisted activation receipt makes the first lookup side-effect-free, makes provenance observable, and keeps every stored key public-only.

> **Controller-transfer correction (2026-07-15):** The Service Workers Activate algorithm terminates the prior active worker and transfers every client already using the registration before dispatching the new worker's `activate` event. The later bounded `clients.claim()` covers other matching clients; a claim failure cannot leave an existing tab on v3, but it still withholds the durable receipt. See the [Service Workers Activate algorithm](https://w3c.github.io/ServiceWorker/#activate-algorithm).

> **Interrupted-activation correction (2026-07-15):** Activation handlers can be terminated while the worker still becomes active. Active-worker globals therefore start network-only and attach resumable cache cleanup to the next eligible fetch lifetime. This closes both an interrupted v3 scrub and correlated receipt-write/deletion failure without blocking a successful navigation response.

- [ ] **Step 3: Preserve uninterrupted work**

The privacy migration may replace the legacy controller and purge its cache without reloading the document. Existing passive-controller handling must offer a manual `Reload when ready` state; it must never call `window.location.reload()` automatically. This one-time controller replacement is a privacy exception to safe-point activation, not permission for ordinary future versions to auto-activate.

Activation must delete every non-current cache, claim clients, and delete non-current caches again. Executable browser proof must model the deployed v3 ordering: its navigation response calls `caches.open('vyntechs-shell-v3')` before its `respondWith` promise settles, while its un-awaited `cache.put` may finish after takeover. The final named Cache Storage catalog must contain no v3 cache or private entry. A synthetic race that delays `caches.open` until after the v3 fetch event has settled is not representative of the deployed worker and does not substitute for this proof.

The `public-cache` fetch branch must treat Cache Storage as an optional acceleration layer. Cache open, match, or put failure must never reject an otherwise successful network response or make a public asset unavailable; executable tests must cover each failure boundary.

- [ ] **Step 4: Verify the correction**

```bash
pnpm vitest run \
  tests/unit/service-worker-policy.test.ts \
  tests/unit/sw-register.test.tsx \
  tests/unit/pwa-update-status.test.tsx
pnpm exec tsc --noEmit
```

Then repeat every Task 7 gate and browser scenario. Include active v3 plus a waiting v4 that already seeded `vyntechs-public-shell-v4`; absence of the exact activation receipt must still force privacy takeover. Include hanging and throwing cache catalog, open, shell-seed, match, put, delete, marker-key, and client-claim operations; every one must settle fail-closed. Any path in which an active worker lacking both identity-bound receipt proof and timely live public-only proof can keep controlling the app after the safe worker finishes installation, install creates the durable receipt, shell seeding gates that takeover, a delayed exact-v3 write restores a named private cache, an identity-bound safely receipted worker is automatically replaced, the policy cache is empty or gains an extra/wrong entry, proof failure still permits cache reads or writes, or a cache failure rejects a successful public network response is a stop-ship failure.

## Rollback

Wave 1A has no data migration. The shell, status controls, workbench primitive, and live-entity helpers are source-reversible. The service-worker privacy fix is not safely reversible to the old authenticated-navigation cache; if another part of the wave must be rolled back, retain Task 2 and Task 8 or ship a separately proven higher public-only policy generation. Every rollback must preserve the changed migration URL, explicit `registration.update()`, explicit scope, `updateViaCache: 'none'`, the activation-or-recovery exact public receipt, fresh-active-global network-only default, resumable v3 scrub, the `public-only-v1` responder/challenge contract, bounded unknown-and-unsafe takeover, double v3 scrub, and cache-failure network fallback. Never restore the previous authenticated-navigation cache. A service-worker privacy regression is a stop-ship defect.

## Done when

- Row 47 is implemented and verified in its own PR with no Row-46-owned path changes.
- Authenticated documents, API data, and non-allowlisted assets cannot enter service-worker Cache Storage.
- Durably marked or timely-attested public-only updates wait without disturbing active work and activate only after the explicit safe-point action; only missing/erased proof may fail closed to a no-reload privacy takeover.
- The authenticated route group has one persistent, accessible, container-aware shell.
- The adaptive workbench primitive is tested but not prematurely composed into Today/My Jobs.
- Opaque-version entity replacements fail closed on stale or mismatched state.
- Focused tests, full tests, TypeScript, build, privacy checks, scope checks, and representative browser proof all pass.
- Row 48 remains blocked until the coordination log records the shared-path release.
