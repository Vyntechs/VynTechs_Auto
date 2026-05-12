# Predictive intake search — design spec

**Status:** Ready for implementation review
**Branch:** `staging` (do not touch `main` / production)
**Date:** 2026-05-11
**Design handoff:** `/design_handoff_predictive_intake_search/` — `canvas.html` (25 mockups: 13 laptop · 6 tablet · 6 phone), `SPEC.md` (token map + interaction spec + pushbacks), `PISStates.jsx` (one component per state), `intake-search.css` (component styles).
**Predecessor:** Existing `/intake` page — `app/(app)/intake/page.tsx` mounts `components/screens/counter-intake.tsx`. The page is a manual-entry form ("Who's at the counter?") that POSTs `/api/intake/submit` and creates a `sessions` row. Today's behavior is preserved as the fallback create-new path.

---

## Goal

Replace the manual-only top of `/intake` with a predictive single search box that finds existing customers and vehicles by name, phone, email, VIN, plate, or any combination of year / make / model / engine. When the customer at the counter is already in the database, the writer finds them in 2–3 keystrokes and skips straight to a ticket. When the customer is new, the writer's keystrokes route into the right fields on the existing intake form below, with NHTSA-decoded year/make/model/engine arriving pre-filled when a VIN is in scope.

The button at `components/screens/today-home.tsx:69` ("+ New work order") continues to point at `/intake`. No route changes. The search bar is an additive component above the existing form.

## Non-goals

- Changing `CounterIntake`'s manual-entry session-creation behavior. The route at `/api/intake/submit` gets an additive code path for "pick existing" (accepts `{ vehicleId }`), but the existing manual-fields path stays untouched and backwards-compatible.
- Real camera VIN/plate scan (placeholder kept, disabled; ships in a follow-up PR).
- CARFAX / DataOne plate-to-VIN external lookup.
- Global topbar search (Tekmetric-style search-from-anywhere on every page).
- Moving `mileage` from `vehicles` to a per-visit column (parked — see Open questions).
- Adding a separate `work_orders` table or renaming "+ New work order" (parked — see Open questions).
- Database schema changes. Existing `customers` + `vehicles` columns are sufficient for v1; no migrations.
- Trigram / `pg_trgm` indexes. v1 uses `ILIKE %x%` against existing indexes; trigram is a future PR.
- Modifying the separate "+ New diagnosis" path at `/sessions/new`.

---

## Product behavior (locked in brainstorm 2026-05-11)

Single search box at the top of `/intake`, above the existing `CounterIntake` form. Accepts customer name, phone, email, plate, VIN, year, make, model, engine — order-agnostic. **Token-based match:** each space-separated token in the query must satisfy at least one field on the row. "F-150 2018" and "2018 F-150" return identical results.

**Result grouping:** Customers section above Vehicles section. Vehicle rows show the owner's name inline. Top 5 per group, ranked exact-prefix > substring, ties broken by most-recent visit. **"+ Create new customer"** row is always present at the bottom of the dropdown.

**Empty-focused state:**
- 0 recent customers in shop → zero-recents copy (`No one's been through the counter yet today. Start typing — or create a new customer.`); dropdown shows only "+ Create new" CTA. Same component shell, no broken-looking "Recent" header.
- 1–4 recent customers → show what we have, "+ Create new" still pinned at the bottom.
- 5+ recent customers → top 5 most-recent; if there are more, footer button `See all N ↓` expands to all.

**Camera VIN/plate scan placeholder** is visible on phone / tablet / laptop, `cursor: not-allowed`, "Scan coming" microcopy. Real scan ships in a follow-up.

**VIN auto-decode (NHTSA vPIC)** fires on the create-new form when input length is 17 and shape matches `[A-HJ-NPR-Z0-9]{17}`. Year / Make / Model / Engine arrive pre-filled and flagged `Decoded · NHTSA vPIC` with the signal-navy decoded-field treatment. On decode failure (network out or invalid VIN), the flag swaps to `--vt-risk-destructive` (`Decode unavailable — fill manually`), Y/M/M/Engine clear and become editable, Save remains enabled.

**Input-shape detection** routes pre-fill to the right create-new field. Routing table:

| Input shape | Routes to |
|---|---|
| `\d{10}` or `(\d{3}) \d{3}-\d{4}` | Phone |
| `[A-HJ-NPR-Z0-9]{17}` | VIN (triggers decode) |
| `(19\|20)\d{2}` in range 1980–next year | Year |
| Word matching the known-make list | Make |
| Contains `@` | Email |
| 5–8 char mixed alphanumeric, no spaces | Plate |
| All other words | Name (joined) |

Multi-token queries route each token independently.

**Create-new required fields:** name + phone only. Email, address, VIN, plate, engine all optional. Mileage is **not** on the create-new form (parked — moves to work-order step).

**Selection paths:**
- Pick customer with 1 vehicle → create ticket directly.
- Pick customer with >1 vehicle → "Which vehicle?" second tier; one tap per vehicle row.
- Pick a specific vehicle row → create ticket directly.
- Pick "+ Create new customer" → search bar collapses, intake form pre-fills with detected prefill, focus moves to Name.

**Search timing:**
- 150 ms debounce, abortable.
- Previous results stay visible during refetch — never blank-then-flash.
- > 5 s slow network: status bar shows `Still searching · 5.2 s · slow network`; previous matches stay visible marked `cached`; "+ Create new" remains enabled.

**Keyboard:**
- `⌘ K` or `/` from anywhere on `/intake` → focus the search box.
- `Esc` → close dropdown, blur input, form below interactive again.
- `↓ / ↑` → walk through rows; wraps from last result onto "+ Create new", then back to first result.
- `↩` → activate focused row.
- `⇧ + ↩` → activate "+ Create new" from anywhere in the list (muscle-memory shortcut).
- `Tab` from the input → jump to first form field below (Name). Search does not eat Tab.

**Touch:**
- Tap input on phone → fullscreen takeover. On tablet / laptop → popover anchored to the bar.
- Tap row → ticket (or "which vehicle?" tier).
- Tap "+ Create new" → form below + focus on Name.
- Tap "Cancel" on phone → close search, no changes.

**Accessibility:**
- Search input: `role="combobox"`, `aria-expanded`, `aria-controls` pointing at dropdown id.
- Dropdown: `role="listbox"`. Each row: `role="option"`.
- Keyboard-focused option tracked by `aria-activedescendant`.
- Match highlight is real `<em>` text-decoration, not background; screen readers read the unmodified row text.

---

## Visual + interaction reference

All 25 mockups live in `/design_handoff_predictive_intake_search/canvas.html` and the per-state component shapes in `PISStates.jsx`. The new component CSS is `intake-search.css`. The `pis__*` class namespace is preserved verbatim during the port.

To render the design as-built locally, the canvas needs the foundation tokens it `@import`s. Don't bother — we're porting, not running the canvas.

---

## Critical port note — token rename `--vt-amber-* → --vt-signal-*`

Design Claude's reference snapshot uses `--vt-amber-500` (and the rest of the `--vt-amber-*` ramp) as the brand navy accent. The current `app/globals.css` calls that token `--vt-signal-500`, and a **separate** `--vt-amber-500` exists as a true amber/orange ignition accent (`oklch(80% 0.215 78)`).

**Every `--vt-amber-*` reference in `intake-search.css` and `PISStates.jsx` must be renamed to its `--vt-signal-*` equivalent during the port:**

| Design CSS reference | Codebase token |
|---|---|
| `--vt-amber-200` | `--vt-signal-200` |
| `--vt-amber-300` | `--vt-signal-300` |
| `--vt-amber-400` | `--vt-signal-400` |
| `--vt-amber-500` | `--vt-signal-500` |
| `--vt-amber-600` | `--vt-signal-600` |
| `--vt-amber-700` | `--vt-signal-700` |
| `--vt-amber-800` | `--vt-signal-800` |
| `--vt-fg-on-amber` | `--vt-fg-on-signal` |
| `--vt-stroke-amber` | `--vt-stroke-signal` |

Specifically, the rename touches:
- `.pis__bar--focused` border-color + inset box-shadow
- `.pis__glyph` and `::after` (focused state)
- `.pis__caret` blinking-caret background
- `.pis__spinner` border-color
- `.pis__row--focused` / `:hover` left-rail border-color
- `.pis__mark` color + text-decoration-color (match highlight)
- `.pis__create__plus` border-color + color
- `.pis__seemore:hover` color
- `.pis__tier__back:hover` color
- `.pis__decoded-flag` color + dot bg
- `.pis__field--decoded .vt-field__input` `color-mix` bg tint
- `.pis--phone .pis__bar--focused` border-bottom-color
- `.pis__phone-cancel` color

**Also remove the two `@import` lines at the top of `intake-search.css`** (lines 28–29 — they point at `../design_handoff_vyntechs_design_system/` paths that don't exist in the repo). `app/globals.css` is already loaded by `app/layout.tsx` and provides all tokens globally.

---

## Schema

No changes. Existing tables and indexes are sufficient for v1.

- `customers`: `id`, `shop_id`, `name`, `phone`, `email`, `created_at`, `updated_at`. Index `customers_shop_id_phone_idx`.
- `vehicles`: `id`, `customer_id`, `year`, `make`, `model`, `engine`, `vin`, `mileage`, `plate`, `created_at`, `updated_at`. Indexes `vehicles_customer_id_idx`, `vehicles_customer_id_vin_idx`.

For v1, search uses `ILIKE %token%` queries with per-token AND semantics. At small per-shop scale (≪ 1000 customers), this is fine. When/if performance degrades, a follow-up PR adds the `pg_trgm` extension + trigram GIN indexes on `(customers.name, customers.phone, customers.email, vehicles.vin, vehicles.plate, vehicles.make, vehicles.model)` and rewires the query. Not v1.

---

## Server side

### `app/api/intake/search/route.ts` — NEW

POST endpoint. Body: `{ q: string }`. Returns `{ customers: Customer[]; vehicles: VehicleWithOwner[]; latencyMs: number }`.

Auth: same Supabase server-side auth as `/api/intake/submit`. Scoped to caller's `shop_id` (rejects cross-shop reads).

Query logic (per shop):
1. Split `q` on whitespace into tokens; drop empties.
2. For each token, run `detectInputShape` (see `lib/intake/input-shape.ts` below) — used as a ranking hint, not a hard filter.
3. Build a Drizzle query:
   - Customers: `WHERE shop_id = $ AND (token1 matches some field) AND (token2 matches some field) AND ...` where "matches some field" expands to `name ILIKE %token% OR phone LIKE %token% OR email ILIKE %token%`.
   - Vehicles: `JOIN customers ON vehicles.customer_id = customers.id WHERE customers.shop_id = $ AND (per-token cross-field match across vehicle fields plus customer name)`.
4. Order: exact-prefix (`name ILIKE token%`) > substring > most-recent visit.
5. `LIMIT 5` per group.

```ts
type Customer = {
  id: string
  name: string
  phone: string | null
  email: string | null
  vehicleCount: number
  lastVisit: Date | null
}
type VehicleWithOwner = {
  id: string
  year: number | null
  make: string | null
  model: string | null
  engine: string | null
  vin: string | null
  plate: string | null
  mileage: number | null
  ownerId: string
  ownerName: string
  lastVisit: Date | null
}
```

`latencyMs` is server-measured so the status bar can display `Matched · 47 ms · 6 matches`.

Empty query (`q.trim() === ''`) is treated as "recent customers" → return customers with at least one session in the last 12 hours, max 8, ordered by latest session DESC. Rolling 12-hour window avoids timezone math (profile timezone isn't stored today) while staying semantically "today's intake" for any normal shop day.

Aborted requests: respond with 499 (client-defined). Next.js routes can detect via `request.signal.aborted`.

### `app/api/intake/decode-vin/route.ts` — NEW

POST endpoint. Body: `{ vin: string }`. Returns `{ year: number; make: string; model: string; engine: string } | { error: 'invalid' | 'unavailable' }`.

Proxies to NHTSA vPIC: `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/{VIN}?format=json`. 5 s timeout via `AbortController`. On NHTSA non-2xx or network error → `{ error: 'unavailable' }`. On VIN with bad checksum or empty results (NHTSA returns shape with `ErrorCode !== '0'`) → `{ error: 'invalid' }`.

Cache: in-memory LRU keyed by uppercased VIN, max 1000 entries (≈ 100 KB). VIN decode is immutable, so cache hits return identical shape. NHTSA is free, no API key.

### `lib/intake/recent-customers.ts` — NEW

```ts
export async function getRecentIntakeCustomers(opts: {
  shopId: string
  withinHours?: number   // defaults to 12
  limit?: number         // defaults to 8
}): Promise<Customer[]>
```

Server-side helper called by `app/(app)/intake/page.tsx` to SSR the empty-state recents. Same `Customer` shape as the search route returns.

### `lib/intake/input-shape.ts` — NEW

Shared between client (prefill routing) and server (search ranking hint).

```ts
export type InputShape =
  | { kind: 'phone'; value: string }
  | { kind: 'vin'; value: string }
  | { kind: 'year'; value: number }
  | { kind: 'make'; value: string }
  | { kind: 'email'; value: string }
  | { kind: 'plate'; value: string }
  | { kind: 'name'; value: string }

export function detectInputShape(token: string): InputShape

export type CreateNewPrefill = {
  name?: string
  phone?: string
  email?: string
  vin?: string
  year?: number
  make?: string
  plate?: string
}
export function tokensToPrefill(tokens: string[]): CreateNewPrefill
```

Known-make list at `lib/intake/known-makes.ts` — top ~50 US makes (Ford, Chevrolet, Toyota, Honda, Nissan, RAM, Jeep, GMC, Dodge, Hyundai, Kia, Subaru, Mazda, Volkswagen, BMW, Mercedes-Benz, Audi, Lexus, Acura, Infiniti, Tesla, Volvo, Porsche, Land Rover, Cadillac, Lincoln, Buick, Chrysler, Mitsubishi, Mini, Genesis, Fiat, Alfa Romeo, Polestar, Rivian, …). Case-insensitive match.

### `lib/intake/decode-vin.ts` — NEW

Server-side helper invoked by the decode-vin route. Owns the NHTSA fetch + LRU cache. Returns the decoded shape or an error tag.

---

## Client side

### `components/vt/predictive-intake-search.tsx` — NEW

Single component that owns search state, dropdown open/closed, keyboard focus, and the "which vehicle?" second-tier state.

```tsx
type Props = {
  recentCustomers: Customer[]
  onPickVehicle: (vehicleId: string) => void   // fires for both "pick vehicle row" and "pick customer w/ 1 vehicle"
  onCreateNew: (prefill: CreateNewPrefill) => void
}
```

The "pick customer with multiple vehicles → which vehicle? tier" path is internal to the component; the parent only ever sees the final `onPickVehicle(vehicleId)` call. The "customer has 0 vehicles" edge falls through to `onCreateNew` with the customer's data pre-filled.

Internal state:
- `value: string` — search input
- `dropdownOpen: boolean`
- `focusedIdx: number | null` — keyboard focus position
- `whichVehicleFor: Customer | null` — second-tier state
- `results: SearchResults | null`
- `searchState: 'idle' | 'searching' | 'slow' | 'matched' | 'no-match' | 'error'`

Uses `useIntakeSearch` (below) for debounce + abort. Emits `onPickCustomer` and `onCreateNew` upward — does NOT own the form.

### `lib/intake/use-search.ts` — NEW

Headless hook. Same hook pattern as the existing `use-advance-stream.ts`.

```ts
export function useIntakeSearch(): {
  state: SearchState
  setQuery: (q: string) => void
  abort: () => void
}
```

`setQuery` is called on every keystroke. The hook debounces 150 ms, then `POST`s `/api/intake/search` with an `AbortController`. If a new query arrives mid-flight, abort the previous. After 5 s without response, transition state to `slow` while keeping previous results visible.

### `components/screens/counter-intake.tsx` — MODIFY

Mount `<PredictiveIntakeSearch>` above the existing form group inside the `IntakeShell`. Callbacks integrate:
- `onPickVehicle(vehicleId)` → POST `/api/intake/submit` with `{ vehicleId }` (additive code path added to the existing route — see Server side). The route derives the owning customer from the vehicle row and creates the session. On success, `router.push('/sessions/{id}')` — existing post-submit behavior.
- `onCreateNew(prefill)` → set state on the existing form's React-controlled inputs from `prefill`, then `nameRef.current?.focus()`. Search bar collapses but remains in the DOM at the top of the page.

Recent customers list is SSR-loaded by the parent page and passed down:

```tsx
// app/(app)/intake/page.tsx
const recent = await getRecentIntakeCustomers({ shopId: ctx.profile.shopId, limit: 8 })
return <CounterIntake recentCustomers={recent} canWriteCounterOrder={...} />
```

### `app/api/intake/submit/route.ts` — MODIFY (additive)

Existing route accepts the manual-entry form body and creates `customer + vehicle + session`. We add an alternative input shape:

```ts
// alternative body for "pick existing"
{ vehicleId: string }
```

When `vehicleId` is present, the route:
1. Loads the vehicle row and confirms `vehicles.customer_id` belongs to a customer with the caller's `shop_id` (rejects cross-shop reads).
2. Skips the customer + vehicle inserts.
3. Creates the `sessions` row attached to the existing `customer_id` + `vehicle_id`.
4. Returns the new `sessionId` in the same response shape as today.

The manual-entry path (existing body) is unchanged. Existing tests stay green.

### File layout — co-located component folder

```
components/vt/intake-search/
  index.tsx                  ← <PredictiveIntakeSearch> (main export)
  rows.tsx                   ← Row, GroupHead, CreateRow atoms
  dropdown.tsx               ← Dropdown shells (results, no-match, empty, etc.)
  intake-search.css          ← ported CSS, token-renamed
```

CSS is imported by `index.tsx`. Scoped via the `.pis` parent class — won't leak to other surfaces. The existing repo pattern is sibling files for small components and folders for larger ones; this component clearly warrants a folder.

---

## Failure modes

| Mode | Behavior |
|---|---|
| Slow network (>5 s) on search | `searchState` → `slow`. Status bar: `Still searching · X.X s · slow network`. Previous matches stay, marked `cached`. "+ Create new" remains enabled. |
| Search request 4xx / 5xx | `searchState` → `error`. Status bar: `Search unavailable — try again or create new`. "+ Create new" remains enabled. No scary UI. |
| User types fast while previous request in flight | New request aborts previous via `AbortController`. Previous results stay until new ones land. No flash-to-empty. |
| User clears the input mid-search | Pending request aborted; dropdown reverts to empty-focused (recent customers). |
| Empty database (no customers in shop) | Empty-focused state shows zero-recents copy; dropdown shows only "+ Create new" CTA. |
| NHTSA decode timeout (>5 s) | Decode flag → failure (`Decode unavailable — fill manually`); Y/M/M/Engine clear; user types manually. Save remains enabled. |
| NHTSA decode VIN-invalid (ErrorCode !== '0') | Same as timeout — flag → failure, fields clear, manual entry, Save enabled. |
| User types a partial VIN | Decode does NOT fire until input length === 17. No spurious requests. |
| User pastes a VIN with whitespace / lowercase | Normalize before checking shape (`.trim().toUpperCase()`). |
| User picks a customer with 0 vehicles (rare edge — vehicle row deleted) | Skip "which vehicle?" tier; fall through to "+ Create new" pre-filled with the customer's data so the writer adds a vehicle. |
| User picks "+ Create new" with empty input | Form below opens with no prefill; standard manual entry path. |
| User scrolls dropdown past the focused row | Focused row auto-scrolls into view; mouse hover overrides keyboard focus until next key press. |

---

## Tests

### `tests/unit/intake-input-shape.test.ts` — NEW
- 10-digit number → `phone`
- `(720) 555-1234` formatted → `phone`
- 17-char alphanumeric VIN → `vin`
- VIN-shape with I, O, or Q → `name` (those chars are excluded from VIN spec)
- `2024` → `year`; `1979` → `name` (out of range)
- `Ford` → `make`; `Trabant` → `name`
- `john@smith.com` → `email`
- `ABC1234` → `plate`
- Multi-token: `"smith 720-555-1234 2018 F-150"` → prefill `{ name: 'smith', phone: '7205551234', year: 2018, name: 'F-150' }` (F-150 falls back to name since it isn't a known make)

### `tests/unit/intake-search-route.test.ts` — NEW
- Seed two shops with customers/vehicles. Search from shop A only returns shop A rows.
- Multi-token AND semantics: `"smith 2018"` only returns rows where BOTH tokens match across some field.
- Exact-prefix outranks substring.
- Recency tiebreaker.
- Empty query returns recent customers, ordered by most-recent session DESC, capped at 8.
- Aborted request returns 499.

### `tests/unit/decode-vin-route.test.ts` — NEW
- NHTSA valid response → returns `{ year, make, model, engine }`.
- NHTSA empty / ErrorCode !== '0' → `{ error: 'invalid' }`.
- NHTSA timeout → `{ error: 'unavailable' }`.
- Cache hit on second identical VIN → no second fetch.

### `tests/unit/use-intake-search.test.ts` — NEW
- Typing triggers debounced fetch after 150 ms.
- Second keystroke within debounce aborts the first.
- 5 s without response → state transitions to `slow`, previous results stay.
- Aborted request does not transition state.

### `tests/unit/predictive-intake-search.test.tsx` — NEW
- Renders search bar in resting state.
- Focus reveals dropdown with recent customers (0 / 3 / 8 variants).
- Typing shows status bar + spinner.
- `↓ / ↑` navigates rows; `↩` activates focused row; `⇧ + ↩` activates "+ Create new" from anywhere.
- `Esc` closes dropdown.
- Picking customer with >1 vehicle shows "which vehicle?" tier.
- Picking "+ Create new" calls `onCreateNew` with detected prefill.
- Match highlight rendered as `<em class="pis__mark">`.

### `tests/integration/intake-search-flow.test.tsx` — NEW
- Full flow: render `CounterIntake` → focus search → type customer name → pick result → assert `/api/intake/submit` called with `{ customerId, vehicleId }`.
- Full flow: render `CounterIntake` → type VIN of new vehicle → no match → tap "+ Create new" → form pre-fills with VIN, NHTSA decode arrives, Year/Make/Model/Engine populated.

---

## Verification

1. `pnpm test` — full suite green (including new unit + integration tests).
2. `pnpm exec tsc --noEmit` — clean.
3. `pnpm build` — clean.
4. Push to `staging`. Vercel preview is the test surface.
5. Brandon walks the flow on each device, in this order:

**Laptop (desktop browser):**
- `/intake` loads. Search bar visible above the existing form. Theme matches the rest of the app (bone canvas, signal-navy accent, Instrument Serif body, JetBrains Mono for VIN/phone/plate, sharp corners).
- Empty state with no recent customers: shows "No one's been through the counter yet today..." + "+ Create new" CTA.
- Empty state with recent customers: shows up to 5; if 6+, `See all N ↓` expands.
- Type a name with multiple matches: Customers section above Vehicles section, owner name on each vehicle row.
- Multi-token: type `"smith 2018"` → only rows matching both surface; both tokens highlighted in their fields.
- Type something that doesn't exist: no-match block with input-shape route hint (`Looks like a plate — we'll prefill the License plate field`).
- Pick customer with one vehicle: ticket creation fires, route to `/sessions/{id}`.
- Pick customer with multiple vehicles: "which vehicle?" tier; pick one → ticket.
- Click "+ Create new" with a phone-shaped query: form below pre-fills phone in phone field.
- Type a 17-char VIN into create-new VIN field: year/make/model/engine pre-fill from NHTSA, flagged decoded.
- Network throttled to 3G: status bar transitions to "Still searching · slow network"; "+ Create new" still clickable.
- `⌘ K` from anywhere on `/intake`: focuses search bar.
- `⇧ + ↩` from anywhere in list: jumps to "+ Create new".

**iPad (Safari, tablet width):**
- Same as laptop. Search bar fills the surface gutter; camera button visible but disabled.
- On-screen keyboard never overlaps results — dropdown scrolls correctly.

**iPhone (Safari, phone width):**
- Search bar visible above the form when resting.
- Tap input → fullscreen takeover; bar pins to top of viewport.
- Tap "Cancel" → returns to form unchanged.
- All result rows are 56 px minimum tap target.
- Camera button shows "Scan" placeholder, disabled.

**Cross-device theme check:**
- At every state, the visual is indistinguishable from the rest of the app.
- Open another page (`/today`, `/sessions/...`) and switch back — no visible style break between pages.

---

## Out of scope (future work)

- Real camera scan integration.
- CARFAX / DataOne plate-to-VIN external lookup.
- Global topbar search (Tekmetric-style search-from-anywhere).
- `pg_trgm` trigram indexes for fuzzy search at scale.
- Mileage moved from `vehicles` to a per-visit table or `work_orders.odometer`.
- Unifying "+ New diagnosis" path to use the same search component.

---

## Open questions

1. **Mileage location.** `vehicles` has a `mileage` column today, but you noted miles belongs on the repair order. v1 leaves the column in place and simply doesn't collect it on the create-new form. Future PR should move/duplicate it as a per-visit field (likely `work_orders.odometer` once that entity exists).

2. **"+ New work order" → `sessions`.** The button labeled "+ New work order" routes to `/intake` and creates a `sessions` row, not a `work_orders` row. Either the button label is misleading, or `work_orders` is a future entity not yet built. Not blocking for the search box (search finds customer+vehicle regardless of downstream entity), but worth resolving before unifying with "+ New diagnosis".

Neither blocks v1 implementation.
