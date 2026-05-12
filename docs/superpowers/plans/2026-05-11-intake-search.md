# Predictive Intake Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a predictive single search box to the top of `/intake` that finds existing customers and vehicles by name/phone/email/VIN/plate/year/make/model/engine in any order, with input-shape-aware pre-fill of the create-new form below and NHTSA VIN auto-decode.

**Architecture:** New `<PredictiveIntakeSearch>` component mounts above the existing `CounterIntake` form. The component owns search input, debounce, dropdown, and "which vehicle?" tier state. Two new API routes — `/api/intake/search` (Drizzle ILIKE per-shop) and `/api/intake/decode-vin` (NHTSA vPIC proxy + LRU cache). The existing `/api/intake/submit` route gains an additive `{ existingCustomerId, existingVehicleId }` body path that skips customer + vehicle inserts and reuses existing rows. CSS is a direct port of the design handoff with `--vt-amber-*` → `--vt-signal-*` rename.

**Tech Stack:** Next.js 16 App Router · React 19 · Drizzle ORM (PostgreSQL/Supabase) · Vitest + PGlite + @testing-library/react · Phosphor icons · CSS variables (no Tailwind).

**Spec:** `docs/superpowers/specs/2026-05-11-intake-search-design.md`
**Design handoff:** `design_handoff_predictive_intake_search/` (canvas.html · SPEC.md · PISStates.jsx · intake-search.css)
**Branch:** `staging` (do not touch main/production)

---

## File Structure

**New files:**
- `lib/intake/input-shape.ts` — pure function: detect token kind (phone/VIN/year/make/email/plate/name)
- `lib/intake/known-makes.ts` — known-make list constant
- `lib/intake/tokens-to-prefill.ts` — pure function: token array → CreateNewPrefill
- `lib/intake/decode-vin.ts` — server: NHTSA vPIC fetch + in-memory LRU cache
- `lib/intake/recent-customers.ts` — server: today's-intake customers query
- `lib/intake/search.ts` — server: Drizzle search query builder
- `lib/intake/use-search.ts` — client hook: debounce + abort + state machine
- `app/api/intake/search/route.ts` — search endpoint
- `app/api/intake/decode-vin/route.ts` — NHTSA proxy endpoint
- `components/vt/intake-search/index.tsx` — `<PredictiveIntakeSearch>` main component
- `components/vt/intake-search/rows.tsx` — Row, GroupHead, CreateRow atoms
- `components/vt/intake-search/dropdown.tsx` — Dropdown shells (results, no-match, empty, slow, tier)
- `components/vt/intake-search/intake-search.css` — ported CSS, token-renamed
- `tests/unit/intake-input-shape.test.ts`
- `tests/unit/intake-tokens-to-prefill.test.ts`
- `tests/unit/intake-decode-vin.test.ts`
- `tests/unit/decode-vin-route.test.ts`
- `tests/unit/intake-recent-customers.test.ts`
- `tests/unit/intake-search-query.test.ts`
- `tests/unit/intake-search-route.test.ts`
- `tests/unit/intake-submit-pick-existing.test.ts`
- `tests/unit/use-intake-search.test.ts`
- `tests/unit/intake-search-component.test.tsx`
- `tests/integration/intake-search-flow.test.tsx`

**Modified files:**
- `app/api/intake/submit/route.ts` — add `existingCustomerId` + `existingVehicleId` body path
- `app/(app)/intake/page.tsx` — SSR-load recent customers, pass as prop
- `components/screens/counter-intake.tsx` — mount `<PredictiveIntakeSearch>` above existing form, wire `onPickVehicle` + `onCreateNew` callbacks

---

## Task 0: Pre-flight

**Files:** none.

- [ ] **Step 1: Confirm working tree is clean and on `staging`**

```bash
git status
git branch --show-current
```

Expected: `staging`, working tree clean (or only the new spec + plan files staged).

- [ ] **Step 2: Confirm test suite is green BEFORE changes**

```bash
pnpm test
```

Expected: all existing tests pass. If anything's red on a clean staging tree, stop and surface it — we won't be able to tell new regressions from pre-existing ones.

- [ ] **Step 3: Confirm typecheck + build are clean**

```bash
pnpm exec tsc --noEmit
pnpm build
```

Expected: zero errors. Same reasoning.

- [ ] **Step 4: Confirm design handoff is in the repo**

```bash
ls design_handoff_predictive_intake_search/
```

Expected to list: `canvas.html`, `intake-search.css`, `PISStates.jsx`, `SPEC.md`, `README.md`, `reference/`, `design-canvas.jsx`.

---

## Task 1: `input-shape.ts` — detect token kind

**Files:**
- Create: `lib/intake/input-shape.ts`
- Test: `tests/unit/intake-input-shape.test.ts`

Depends on Task 2 (`known-makes.ts`) — but we can stub the known-makes import in this task and replace with the real list in Task 2. Cleaner ordering: do Task 2 first if you prefer.

- [ ] **Step 1: Create the known-makes stub (will be replaced in Task 2)**

Create `lib/intake/known-makes.ts`:

```ts
// Replaced with the full list in Task 2. Stub keeps Task 1 self-contained.
export const KNOWN_MAKES = new Set<string>(['Ford', 'Honda', 'Toyota', 'BMW'])
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/intake-input-shape.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { detectInputShape } from '@/lib/intake/input-shape'

describe('detectInputShape', () => {
  it('detects 10-digit phone numbers', () => {
    expect(detectInputShape('7705551234')).toEqual({ kind: 'phone', value: '7705551234' })
  })

  it('detects formatted phone numbers', () => {
    expect(detectInputShape('(770) 555-1234')).toEqual({ kind: 'phone', value: '7705551234' })
  })

  it('detects 17-character VINs', () => {
    expect(detectInputShape('1FTFW1ET5BFA12345')).toEqual({ kind: 'vin', value: '1FTFW1ET5BFA12345' })
  })

  it('rejects VIN-shape containing I, O, or Q (not legal VIN chars) as name', () => {
    expect(detectInputShape('1FTFW1ET5BFA1234O')).toEqual({ kind: 'name', value: '1FTFW1ET5BFA1234O' })
  })

  it('detects 4-digit years in range', () => {
    expect(detectInputShape('2024')).toEqual({ kind: 'year', value: 2024 })
    expect(detectInputShape('1980')).toEqual({ kind: 'year', value: 1980 })
  })

  it('rejects out-of-range years as name', () => {
    expect(detectInputShape('1979')).toEqual({ kind: 'name', value: '1979' })
    expect(detectInputShape('2099')).toEqual({ kind: 'name', value: '2099' })
  })

  it('detects known makes case-insensitively', () => {
    expect(detectInputShape('ford')).toEqual({ kind: 'make', value: 'Ford' })
    expect(detectInputShape('FORD')).toEqual({ kind: 'make', value: 'Ford' })
  })

  it('treats unknown makes as name', () => {
    expect(detectInputShape('Trabant')).toEqual({ kind: 'name', value: 'Trabant' })
  })

  it('detects email addresses', () => {
    expect(detectInputShape('john@smith.com')).toEqual({ kind: 'email', value: 'john@smith.com' })
  })

  it('detects 5-8 char alphanumeric plates', () => {
    expect(detectInputShape('ABC1234')).toEqual({ kind: 'plate', value: 'ABC1234' })
    expect(detectInputShape('F4XQ2')).toEqual({ kind: 'plate', value: 'F4XQ2' })
  })

  it('falls back to name for anything else', () => {
    expect(detectInputShape('Smith')).toEqual({ kind: 'name', value: 'Smith' })
    expect(detectInputShape('123')).toEqual({ kind: 'name', value: '123' })
  })

  it('normalizes case for VIN (uppercases)', () => {
    expect(detectInputShape('1ftfw1et5bfa12345')).toEqual({ kind: 'vin', value: '1FTFW1ET5BFA12345' })
  })
})
```

- [ ] **Step 3: Run the test, expect failure**

```bash
pnpm test tests/unit/intake-input-shape.test.ts
```

Expected: FAIL — `detectInputShape` is not exported from `@/lib/intake/input-shape`.

- [ ] **Step 4: Implement `detectInputShape`**

Create `lib/intake/input-shape.ts`:

```ts
import { KNOWN_MAKES } from './known-makes'

export type InputShape =
  | { kind: 'phone'; value: string }
  | { kind: 'vin'; value: string }
  | { kind: 'year'; value: number }
  | { kind: 'make'; value: string }
  | { kind: 'email'; value: string }
  | { kind: 'plate'; value: string }
  | { kind: 'name'; value: string }

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/
const PHONE_DIGITS_RE = /^\d{10}$/
const YEAR_MIN = 1980
const YEAR_MAX = new Date().getUTCFullYear() + 1
const PLATE_RE = /^[A-Z0-9]{5,8}$/i

function stripPhoneFormatting(s: string): string {
  return s.replace(/[\s()\-.+]/g, '')
}

export function detectInputShape(raw: string): InputShape {
  const trimmed = raw.trim()
  if (trimmed === '') return { kind: 'name', value: '' }

  // Email — cheapest unique signal.
  if (trimmed.includes('@')) {
    return { kind: 'email', value: trimmed.toLowerCase() }
  }

  // Phone — must be exactly 10 digits after stripping formatting.
  const phoneStripped = stripPhoneFormatting(trimmed)
  if (PHONE_DIGITS_RE.test(phoneStripped)) {
    return { kind: 'phone', value: phoneStripped }
  }

  // VIN — 17 chars, uppercase, no I/O/Q.
  const upper = trimmed.toUpperCase()
  if (VIN_RE.test(upper)) {
    return { kind: 'vin', value: upper }
  }

  // Year — 4 digits, in range.
  if (/^\d{4}$/.test(trimmed)) {
    const n = Number.parseInt(trimmed, 10)
    if (n >= YEAR_MIN && n <= YEAR_MAX) {
      return { kind: 'year', value: n }
    }
  }

  // Known make — case-insensitive match against canonical casing.
  const lower = trimmed.toLowerCase()
  for (const canonical of KNOWN_MAKES) {
    if (canonical.toLowerCase() === lower) {
      return { kind: 'make', value: canonical }
    }
  }

  // Plate — 5-8 alphanumeric, no spaces. Must come AFTER make/year/VIN
  // checks (those eat overlapping shapes first).
  if (PLATE_RE.test(trimmed) && !/^\d+$/.test(trimmed)) {
    return { kind: 'plate', value: trimmed.toUpperCase() }
  }

  // Fall through to name.
  return { kind: 'name', value: trimmed }
}
```

- [ ] **Step 5: Run the test, expect pass**

```bash
pnpm test tests/unit/intake-input-shape.test.ts
```

Expected: PASS (all 11 cases).

- [ ] **Step 6: Commit**

```bash
git add lib/intake/input-shape.ts lib/intake/known-makes.ts tests/unit/intake-input-shape.test.ts
git commit -m "feat(intake): add input-shape detection for predictive search"
```

---

## Task 2: `known-makes.ts` — full make list

**Files:**
- Modify: `lib/intake/known-makes.ts`
- Test: `tests/unit/intake-input-shape.test.ts` (extended)

- [ ] **Step 1: Replace the stub with the full list**

Overwrite `lib/intake/known-makes.ts`:

```ts
// Top US makes by 2024 registrations. Used by detectInputShape to recognize
// a single-word make token. Add a make here when the search box should treat
// it as a make rather than a name.
export const KNOWN_MAKES = new Set<string>([
  'Acura',
  'Alfa Romeo',
  'Audi',
  'BMW',
  'Buick',
  'Cadillac',
  'Chevrolet',
  'Chrysler',
  'Dodge',
  'Fiat',
  'Ford',
  'Genesis',
  'GMC',
  'Honda',
  'Hyundai',
  'Infiniti',
  'Jaguar',
  'Jeep',
  'Kia',
  'Land Rover',
  'Lexus',
  'Lincoln',
  'Maserati',
  'Mazda',
  'Mercedes-Benz',
  'Mini',
  'Mitsubishi',
  'Nissan',
  'Polestar',
  'Pontiac',
  'Porsche',
  'RAM',
  'Rivian',
  'Saab',
  'Saturn',
  'Scion',
  'Smart',
  'Subaru',
  'Tesla',
  'Toyota',
  'Volkswagen',
  'Volvo',
])
```

- [ ] **Step 2: Add tests for the expanded list**

Append to `tests/unit/intake-input-shape.test.ts`:

```ts
describe('detectInputShape — extended make coverage', () => {
  it.each([
    ['chevrolet', 'Chevrolet'],
    ['ram', 'RAM'],
    ['tesla', 'Tesla'],
    ['mercedes-benz', 'Mercedes-Benz'],
    ['land rover', 'Land Rover'],
  ])('detects "%s" as make %s', (input, expected) => {
    expect(detectInputShape(input)).toEqual({ kind: 'make', value: expected })
  })
})
```

- [ ] **Step 3: Run the test, expect pass**

```bash
pnpm test tests/unit/intake-input-shape.test.ts
```

Expected: PASS (original 11 cases + 5 new make cases).

- [ ] **Step 4: Commit**

```bash
git add lib/intake/known-makes.ts tests/unit/intake-input-shape.test.ts
git commit -m "feat(intake): expand known-makes list for shape detection"
```

---

## Task 3: `tokens-to-prefill.ts` — token array → form prefill

**Files:**
- Create: `lib/intake/tokens-to-prefill.ts`
- Test: `tests/unit/intake-tokens-to-prefill.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/intake-tokens-to-prefill.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { tokensToPrefill } from '@/lib/intake/tokens-to-prefill'

describe('tokensToPrefill', () => {
  it('routes a phone token to phone field', () => {
    expect(tokensToPrefill(['(720) 555-1234'])).toEqual({ phone: '7205551234' })
  })

  it('routes a VIN token to vin field', () => {
    expect(tokensToPrefill(['1FTFW1ET5BFA12345'])).toEqual({ vin: '1FTFW1ET5BFA12345' })
  })

  it('routes a year token to year field', () => {
    expect(tokensToPrefill(['2024'])).toEqual({ year: 2024 })
  })

  it('routes a make token to make field', () => {
    expect(tokensToPrefill(['Ford'])).toEqual({ make: 'Ford' })
  })

  it('routes an email token to email field', () => {
    expect(tokensToPrefill(['john@smith.com'])).toEqual({ email: 'john@smith.com' })
  })

  it('routes a plate token to plate field', () => {
    expect(tokensToPrefill(['ABC1234'])).toEqual({ plate: 'ABC1234' })
  })

  it('joins multiple name tokens with a single space', () => {
    expect(tokensToPrefill(['John', 'Smith'])).toEqual({ name: 'John Smith' })
  })

  it('routes a mixed multi-token query into separate fields', () => {
    expect(
      tokensToPrefill(['Smith', '(720)', '555-1234', '2018', 'Ford', 'F-150'])
    ).toEqual({
      name: 'Smith F-150', // "F-150" isn't a known make and "Smith" is plain
      phone: '7205551234', // "(720) 555-1234" was split into two adjacent tokens — joined by detectInputShape after normalization
      year: 2018,
      make: 'Ford',
    })
  })

  it('returns an empty object for an empty token array', () => {
    expect(tokensToPrefill([])).toEqual({})
  })

  it('returns an empty object for whitespace-only tokens', () => {
    expect(tokensToPrefill(['', '  '])).toEqual({})
  })
})
```

- [ ] **Step 2: Run the test, expect failure**

```bash
pnpm test tests/unit/intake-tokens-to-prefill.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `tokensToPrefill`**

Create `lib/intake/tokens-to-prefill.ts`:

```ts
import { detectInputShape, type InputShape } from './input-shape'

export type CreateNewPrefill = {
  name?: string
  phone?: string
  email?: string
  vin?: string
  year?: number
  make?: string
  plate?: string
}

/**
 * Collapses an array of search tokens into a CreateNewPrefill.
 *
 * Adjacent tokens that together form a recognizable shape (e.g. "(720)" and
 * "555-1234" joining into a 10-digit phone) are merged greedily, then each
 * surviving token is routed by detectInputShape.
 */
export function tokensToPrefill(tokens: string[]): CreateNewPrefill {
  const trimmed = tokens.map((t) => t.trim()).filter((t) => t !== '')
  if (trimmed.length === 0) return {}

  // Greedy merge: scan adjacent pairs and join if the joined string is a more
  // specific shape than either part alone. Only collapses phone-shaped chunks
  // (the only routinely-split-by-whitespace shape in practice).
  const merged: string[] = []
  let i = 0
  while (i < trimmed.length) {
    const here = trimmed[i]
    const next = trimmed[i + 1]
    if (next !== undefined) {
      const joined = here + next
      const joinedShape = detectInputShape(joined)
      if (joinedShape.kind === 'phone') {
        merged.push(joined)
        i += 2
        continue
      }
    }
    merged.push(here)
    i += 1
  }

  const prefill: CreateNewPrefill = {}
  const nameParts: string[] = []

  for (const token of merged) {
    const shape: InputShape = detectInputShape(token)
    switch (shape.kind) {
      case 'phone':
        prefill.phone = shape.value
        break
      case 'vin':
        prefill.vin = shape.value
        break
      case 'year':
        prefill.year = shape.value
        break
      case 'make':
        prefill.make = shape.value
        break
      case 'email':
        prefill.email = shape.value
        break
      case 'plate':
        prefill.plate = shape.value
        break
      case 'name':
        nameParts.push(shape.value)
        break
    }
  }

  if (nameParts.length > 0) prefill.name = nameParts.join(' ')
  return prefill
}
```

- [ ] **Step 4: Run the test, expect pass**

```bash
pnpm test tests/unit/intake-tokens-to-prefill.test.ts
```

Expected: PASS (10 cases).

- [ ] **Step 5: Commit**

```bash
git add lib/intake/tokens-to-prefill.ts tests/unit/intake-tokens-to-prefill.test.ts
git commit -m "feat(intake): add tokens-to-prefill for create-new routing"
```

---

## Task 4: `decode-vin.ts` — NHTSA fetch + LRU cache

**Files:**
- Create: `lib/intake/decode-vin.ts`
- Test: `tests/unit/intake-decode-vin.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/intake-decode-vin.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeVin, _clearCacheForTest } from '@/lib/intake/decode-vin'

const NHTSA_OK = {
  Results: [
    { Variable: 'Model Year', Value: '2014' },
    { Variable: 'Make', Value: 'BMW' },
    { Variable: 'Model', Value: '335i' },
    { Variable: 'Engine Model', Value: 'N55' },
    { Variable: 'Error Code', Value: '0' },
  ],
}

const NHTSA_INVALID = {
  Results: [{ Variable: 'Error Code', Value: '1' }],
}

describe('decodeVin', () => {
  beforeEach(() => {
    _clearCacheForTest()
    vi.restoreAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns decoded fields on a valid NHTSA response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(NHTSA_OK), { status: 200 })))
    const result = await decodeVin('WBA3A5C50EJF12345')
    expect(result).toEqual({ year: 2014, make: 'BMW', model: '335i', engine: 'N55' })
  })

  it('returns {error: "invalid"} on NHTSA error-code response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(NHTSA_INVALID), { status: 200 })))
    const result = await decodeVin('WBA3A5C50EJF99999')
    expect(result).toEqual({ error: 'invalid' })
  })

  it('returns {error: "unavailable"} on non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('error', { status: 503 })))
    const result = await decodeVin('WBA3A5C50EJF12345')
    expect(result).toEqual({ error: 'unavailable' })
  })

  it('returns {error: "unavailable"} on network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network failure') }))
    const result = await decodeVin('WBA3A5C50EJF12345')
    expect(result).toEqual({ error: 'unavailable' })
  })

  it('caches successful decodes — second call does not refetch', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(NHTSA_OK), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await decodeVin('WBA3A5C50EJF12345')
    await decodeVin('WBA3A5C50EJF12345')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('normalizes VIN case before caching (lowercase input hits same cache)', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(NHTSA_OK), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await decodeVin('WBA3A5C50EJF12345')
    await decodeVin('wba3a5c50ejf12345')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run the test, expect failure**

```bash
pnpm test tests/unit/intake-decode-vin.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `decodeVin`**

Create `lib/intake/decode-vin.ts`:

```ts
export type VinDecodeResult =
  | { year: number; make: string; model: string; engine: string }
  | { error: 'invalid' | 'unavailable' }

const NHTSA_URL = 'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues'
const TIMEOUT_MS = 5_000
const CACHE_MAX = 1_000

// Simple LRU: map preserves insertion order; bump on hit by deleting+resetting.
const cache = new Map<string, VinDecodeResult>()

export function _clearCacheForTest() {
  cache.clear()
}

function bumpLru(key: string, value: VinDecodeResult): void {
  cache.delete(key)
  cache.set(key, value)
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
}

type NhtsaVar = { Variable: string; Value: string | null }

function extract(results: NhtsaVar[], variable: string): string | null {
  const row = results.find((r) => r.Variable === variable)
  if (!row) return null
  const v = row.Value
  if (v === null || v === '' || v === 'Not Applicable') return null
  return v
}

export async function decodeVin(rawVin: string): Promise<VinDecodeResult> {
  const vin = rawVin.trim().toUpperCase()
  if (vin.length !== 17) return { error: 'invalid' }

  const cached = cache.get(vin)
  if (cached !== undefined) {
    bumpLru(vin, cached)
    return cached
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(`${NHTSA_URL}/${vin}?format=json`, { signal: controller.signal })
  } catch {
    clearTimeout(timer)
    return { error: 'unavailable' }
  }
  clearTimeout(timer)

  if (!response.ok) {
    return { error: 'unavailable' }
  }

  let body: { Results?: NhtsaVar[] }
  try {
    body = (await response.json()) as { Results?: NhtsaVar[] }
  } catch {
    return { error: 'unavailable' }
  }
  const results = body.Results ?? []

  const errorCode = extract(results, 'Error Code')
  if (errorCode === null || errorCode !== '0') {
    const invalid: VinDecodeResult = { error: 'invalid' }
    bumpLru(vin, invalid)
    return invalid
  }

  const yearRaw = extract(results, 'Model Year')
  const make = extract(results, 'Make')
  const model = extract(results, 'Model')
  const engine = extract(results, 'Engine Model') ?? extract(results, 'Displacement (L)') ?? ''
  const year = yearRaw !== null ? Number.parseInt(yearRaw, 10) : Number.NaN

  if (!Number.isFinite(year) || !make || !model) {
    const invalid: VinDecodeResult = { error: 'invalid' }
    bumpLru(vin, invalid)
    return invalid
  }

  const decoded: VinDecodeResult = { year, make, model, engine }
  bumpLru(vin, decoded)
  return decoded
}
```

- [ ] **Step 4: Run the test, expect pass**

```bash
pnpm test tests/unit/intake-decode-vin.test.ts
```

Expected: PASS (6 cases).

- [ ] **Step 5: Commit**

```bash
git add lib/intake/decode-vin.ts tests/unit/intake-decode-vin.test.ts
git commit -m "feat(intake): add NHTSA vPIC VIN decode with LRU cache"
```

---

## Task 5: `app/api/intake/decode-vin/route.ts` — endpoint wrapper

**Files:**
- Create: `app/api/intake/decode-vin/route.ts`
- Test: `tests/unit/decode-vin-route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/decode-vin-route.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/lib/intake/decode-vin', () => ({
  decodeVin: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({
  requireUserAndProfile: vi.fn(),
}))
vi.mock('@/lib/supabase-server', () => ({
  getServerSupabase: vi.fn(async () => ({})),
}))
vi.mock('@/lib/db/client', () => ({ db: {} }))

import { POST } from '@/app/api/intake/decode-vin/route'
import { decodeVin } from '@/lib/intake/decode-vin'
import { requireUserAndProfile } from '@/lib/auth'

const decodeVinMock = decodeVin as ReturnType<typeof vi.fn>
const requireUserMock = requireUserAndProfile as ReturnType<typeof vi.fn>

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/intake/decode-vin', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('POST /api/intake/decode-vin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireUserMock.mockResolvedValue({ profile: { id: 'p1', shopId: 's1', role: 'owner' }, user: { id: 'u1' } })
  })

  it('returns 200 with decoded fields on success', async () => {
    decodeVinMock.mockResolvedValue({ year: 2014, make: 'BMW', model: '335i', engine: 'N55' })
    const res = await POST(makeReq({ vin: 'WBA3A5C50EJF12345' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ year: 2014, make: 'BMW', model: '335i', engine: 'N55' })
  })

  it('returns 200 with {error:"invalid"} on NHTSA-rejected VIN', async () => {
    decodeVinMock.mockResolvedValue({ error: 'invalid' })
    const res = await POST(makeReq({ vin: 'BADVIN1234567890Z' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ error: 'invalid' })
  })

  it('returns 200 with {error:"unavailable"} on NHTSA outage', async () => {
    decodeVinMock.mockResolvedValue({ error: 'unavailable' })
    const res = await POST(makeReq({ vin: 'WBA3A5C50EJF12345' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ error: 'unavailable' })
  })

  it('returns 400 on missing vin field', async () => {
    const res = await POST(makeReq({}))
    expect(res.status).toBe(400)
  })

  it('returns 401 when unauthenticated', async () => {
    requireUserMock.mockResolvedValue(null)
    const res = await POST(makeReq({ vin: 'WBA3A5C50EJF12345' }))
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 2: Run the test, expect failure**

```bash
pnpm test tests/unit/decode-vin-route.test.ts
```

Expected: FAIL — route module not found.

- [ ] **Step 3: Implement the route**

Create `app/api/intake/decode-vin/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile } from '@/lib/auth'
import { decodeVin } from '@/lib/intake/decode-vin'

type Body = { vin?: string }

export async function POST(req: Request) {
  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const vin = typeof body.vin === 'string' ? body.vin.trim() : ''
  if (vin === '') {
    return NextResponse.json({ error: 'vin_required' }, { status: 400 })
  }

  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const result = await decodeVin(vin)
  return NextResponse.json(result, { status: 200 })
}
```

- [ ] **Step 4: Run the test, expect pass**

```bash
pnpm test tests/unit/decode-vin-route.test.ts
```

Expected: PASS (5 cases).

- [ ] **Step 5: Commit**

```bash
git add app/api/intake/decode-vin/route.ts tests/unit/decode-vin-route.test.ts
git commit -m "feat(intake): add /api/intake/decode-vin endpoint"
```

---

## Task 6: `recent-customers.ts` — server query for empty-focused state

**Files:**
- Create: `lib/intake/recent-customers.ts`
- Test: `tests/unit/intake-recent-customers.test.ts`

This task and the next use **PGlite** (in-memory PostgreSQL) for DB-level tests. Look at an existing PGlite test in `tests/unit/` to see how the suite already wires it up — match that pattern.

- [ ] **Step 1: Find an existing PGlite test setup to mirror**

```bash
grep -lR "PGlite\|@electric-sql/pglite" tests/
```

Expected: at least one existing test file. Open the most recent one to see how it spins up the DB, runs migrations, and tears down. Mirror that pattern for the next steps.

- [ ] **Step 2: Write the failing test**

Create `tests/unit/intake-recent-customers.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
// Import whatever PGlite-wiring helpers the codebase already exposes.
// Adjust the import path to match the existing pattern found in Step 1.
import { setupTestDb, teardownTestDb, type TestDb } from '@/tests/helpers/pglite' // <— adjust if the helper lives elsewhere
import { customers, vehicles, sessions, shops, profiles } from '@/lib/db/schema'
import { getRecentIntakeCustomers } from '@/lib/intake/recent-customers'

let testDb: TestDb

beforeEach(async () => {
  testDb = await setupTestDb()
})
afterEach(async () => {
  await teardownTestDb(testDb)
})

async function seedShopProfileCustomerVehicle(shopId: string, opts: { hoursAgo: number; name: string }) {
  const { db } = testDb
  const [shop] = await db.insert(shops).values({ id: shopId, name: 'Test Shop' }).onConflictDoNothing().returning()
  const [profile] = await db.insert(profiles).values({ userId: 'u-' + shopId, shopId, fullName: 'Tech', role: 'tech' }).returning()
  const [customer] = await db.insert(customers).values({ shopId, name: opts.name, phone: '7705551234' }).returning()
  const [vehicle] = await db.insert(vehicles).values({ customerId: customer.id, year: 2018, make: 'Ford', model: 'F-150' }).returning()
  const createdAt = new Date(Date.now() - opts.hoursAgo * 60 * 60 * 1000)
  await db.insert(sessions).values({
    shopId,
    techId: profile.id,
    vehicleId: vehicle.id,
    status: 'open',
    intake: { vehicleYear: 2018, vehicleMake: 'Ford', vehicleModel: 'F-150', customerComplaint: 'test' },
    treeState: { /* whatever minimum the type requires; cast as needed */ } as any,
    createdAt,
  })
  return { customer, vehicle }
}

describe('getRecentIntakeCustomers', () => {
  it('returns customers with sessions in the last 12 hours, newest first', async () => {
    await seedShopProfileCustomerVehicle('shop-a', { hoursAgo: 1, name: 'Sandoval' })
    await seedShopProfileCustomerVehicle('shop-a', { hoursAgo: 6, name: 'Mendez' })
    await seedShopProfileCustomerVehicle('shop-a', { hoursAgo: 24, name: 'Park' }) // outside window

    const result = await getRecentIntakeCustomers({
      db: testDb.db,
      shopId: 'shop-a',
      withinHours: 12,
      limit: 8,
    })

    expect(result.map((c) => c.name)).toEqual(['Sandoval', 'Mendez'])
  })

  it('scopes by shopId — never returns rows from other shops', async () => {
    await seedShopProfileCustomerVehicle('shop-a', { hoursAgo: 1, name: 'In-shop' })
    await seedShopProfileCustomerVehicle('shop-b', { hoursAgo: 1, name: 'Other-shop' })

    const result = await getRecentIntakeCustomers({
      db: testDb.db,
      shopId: 'shop-a',
      withinHours: 12,
      limit: 8,
    })

    expect(result.map((c) => c.name)).toEqual(['In-shop'])
  })

  it('respects limit', async () => {
    for (let i = 0; i < 12; i++) {
      await seedShopProfileCustomerVehicle('shop-a', { hoursAgo: i * 0.5, name: `Customer ${i}` })
    }
    const result = await getRecentIntakeCustomers({
      db: testDb.db,
      shopId: 'shop-a',
      withinHours: 12,
      limit: 5,
    })
    expect(result).toHaveLength(5)
  })

  it('returns an empty array when the shop has no recent sessions', async () => {
    const result = await getRecentIntakeCustomers({
      db: testDb.db,
      shopId: 'shop-empty',
      withinHours: 12,
      limit: 8,
    })
    expect(result).toEqual([])
  })

  it('returns vehicleCount per customer', async () => {
    const { customer } = await seedShopProfileCustomerVehicle('shop-a', { hoursAgo: 1, name: 'Sandoval' })
    // add a second vehicle for the same customer
    await testDb.db.insert(vehicles).values({ customerId: customer.id, year: 2019, make: 'Honda', model: 'Pilot' })

    const result = await getRecentIntakeCustomers({
      db: testDb.db,
      shopId: 'shop-a',
      withinHours: 12,
      limit: 8,
    })
    expect(result[0].vehicleCount).toBe(2)
  })
})
```

If the PGlite helper file isn't named `tests/helpers/pglite.ts`, update the import path in the test to match the existing convention (Step 1).

- [ ] **Step 3: Run the test, expect failure**

```bash
pnpm test tests/unit/intake-recent-customers.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement `getRecentIntakeCustomers`**

Create `lib/intake/recent-customers.ts`:

```ts
import { and, desc, eq, gte, count, sql } from 'drizzle-orm'
import { customers, sessions, vehicles } from '@/lib/db/schema'
import type { db as DbType } from '@/lib/db/client'

export type RecentCustomer = {
  id: string
  name: string
  phone: string | null
  email: string | null
  vehicleCount: number
  lastVisit: Date
}

export async function getRecentIntakeCustomers(opts: {
  db: typeof DbType
  shopId: string
  withinHours?: number
  limit?: number
}): Promise<RecentCustomer[]> {
  const withinHours = opts.withinHours ?? 12
  const limit = opts.limit ?? 8
  const since = new Date(Date.now() - withinHours * 60 * 60 * 1000)

  // For each customer with at least one session in the window, return the
  // customer's columns + most-recent session createdAt + total vehicle count.
  const rows = await opts.db
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
      email: customers.email,
      lastVisit: sql<Date>`MAX(${sessions.createdAt})`.as('last_visit'),
      vehicleCount: sql<number>`(SELECT COUNT(*)::int FROM ${vehicles} WHERE ${vehicles.customerId} = ${customers.id})`.as('vehicle_count'),
    })
    .from(customers)
    .innerJoin(vehicles, eq(vehicles.customerId, customers.id))
    .innerJoin(sessions, eq(sessions.vehicleId, vehicles.id))
    .where(and(eq(customers.shopId, opts.shopId), gte(sessions.createdAt, since)))
    .groupBy(customers.id)
    .orderBy(desc(sql`MAX(${sessions.createdAt})`))
    .limit(limit)

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    email: r.email,
    vehicleCount: Number(r.vehicleCount),
    lastVisit: r.lastVisit instanceof Date ? r.lastVisit : new Date(r.lastVisit as unknown as string),
  }))
}
```

- [ ] **Step 5: Run the test, expect pass**

```bash
pnpm test tests/unit/intake-recent-customers.test.ts
```

Expected: PASS (5 cases). If the test fails because the existing PGlite helper has different exports, adjust the imports in the test to match — the implementation itself uses standard Drizzle and should be correct.

- [ ] **Step 6: Commit**

```bash
git add lib/intake/recent-customers.ts tests/unit/intake-recent-customers.test.ts
git commit -m "feat(intake): add recent-customers query for empty-focused state"
```

---

## Task 7: `search.ts` — Drizzle search query builder

**Files:**
- Create: `lib/intake/search.ts`
- Test: `tests/unit/intake-search-query.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/intake-search-query.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { setupTestDb, teardownTestDb, type TestDb } from '@/tests/helpers/pglite'
import { customers, vehicles, sessions, shops, profiles } from '@/lib/db/schema'
import { searchIntake } from '@/lib/intake/search'

let testDb: TestDb

beforeEach(async () => { testDb = await setupTestDb() })
afterEach(async () => { await teardownTestDb(testDb) })

async function seed(shopId: string) {
  const { db } = testDb
  await db.insert(shops).values({ id: shopId, name: 'Shop' }).onConflictDoNothing()
  const [tech] = await db.insert(profiles).values({ userId: 'u-' + shopId, shopId, fullName: 'T', role: 'tech' }).returning()
  const [sandoval] = await db.insert(customers).values({ shopId, name: 'Robert Sandoval', phone: '3035550142', email: 'rsandoval@example.com' }).returning()
  const [chen] = await db.insert(customers).values({ shopId, name: 'Robin Chen', phone: '7205559183' }).returning()
  const [mendez] = await db.insert(customers).values({ shopId, name: 'Aïda Mendez', phone: '7205557710' }).returning()
  const [sandovalBmw] = await db.insert(vehicles).values({ customerId: sandoval.id, year: 2014, make: 'BMW', model: '335i', vin: 'WBA3A5C50EJF12345', plate: 'ABC1234' }).returning()
  const [sandovalPilot] = await db.insert(vehicles).values({ customerId: sandoval.id, year: 2019, make: 'Honda', model: 'Pilot' }).returning()
  const [chenF150] = await db.insert(vehicles).values({ customerId: chen.id, year: 2018, make: 'Ford', model: 'F-150' }).returning()
  // give sandoval a recent session so recency tiebreak surfaces him first
  await db.insert(sessions).values({
    shopId, techId: tech.id, vehicleId: sandovalBmw.id, status: 'open',
    intake: { vehicleYear: 2014, vehicleMake: 'BMW', vehicleModel: '335i', customerComplaint: 't' },
    treeState: {} as any,
  })
  return { sandoval, chen, mendez, sandovalBmw, sandovalPilot, chenF150 }
}

describe('searchIntake', () => {
  it('matches a name prefix in customers', async () => {
    const seeded = await seed('shop-a')
    const r = await searchIntake({ db: testDb.db, shopId: 'shop-a', q: 'Rob' })
    expect(r.customers.map((c) => c.name)).toEqual(['Robert Sandoval', 'Robin Chen']) // exact-prefix tiebreak by recency
  })

  it('matches a phone substring', async () => {
    await seed('shop-a')
    const r = await searchIntake({ db: testDb.db, shopId: 'shop-a', q: '5559183' })
    expect(r.customers.map((c) => c.name)).toEqual(['Robin Chen'])
  })

  it('matches a VIN fragment in vehicles, with owner inline', async () => {
    const seeded = await seed('shop-a')
    const r = await searchIntake({ db: testDb.db, shopId: 'shop-a', q: 'WBA3A5C50' })
    expect(r.vehicles).toHaveLength(1)
    expect(r.vehicles[0].vin).toBe('WBA3A5C50EJF12345')
    expect(r.vehicles[0].ownerName).toBe('Robert Sandoval')
  })

  it('multi-token: requires every token to match across some field (customer OR vehicle owner)', async () => {
    await seed('shop-a')
    // "rob 335" — Robert (customer name) + 335 (model fragment via owner-linked vehicle)
    const r = await searchIntake({ db: testDb.db, shopId: 'shop-a', q: 'rob 335' })
    // vehicle row matches: 2014 BMW 335i owned by Robert Sandoval
    expect(r.vehicles.map((v) => v.model)).toEqual(['335i'])
  })

  it('returns empty results for a query with no match', async () => {
    await seed('shop-a')
    const r = await searchIntake({ db: testDb.db, shopId: 'shop-a', q: 'ZZZZZZZ' })
    expect(r.customers).toEqual([])
    expect(r.vehicles).toEqual([])
  })

  it('scopes by shopId — never returns rows from another shop', async () => {
    await seed('shop-a')
    await seed('shop-b')
    const r = await searchIntake({ db: testDb.db, shopId: 'shop-a', q: 'Robin' })
    expect(r.customers).toHaveLength(1)
  })

  it('caps results at 5 per group', async () => {
    const { db } = testDb
    await db.insert(shops).values({ id: 'shop-a', name: 'Shop' }).onConflictDoNothing()
    for (let i = 0; i < 10; i++) {
      await db.insert(customers).values({ shopId: 'shop-a', name: `Smith ${i}`, phone: '0000000000' })
    }
    const r = await searchIntake({ db: testDb.db, shopId: 'shop-a', q: 'Smith' })
    expect(r.customers).toHaveLength(5)
  })

  it('an empty query returns no rows (the caller handles empty=recents elsewhere)', async () => {
    await seed('shop-a')
    const r = await searchIntake({ db: testDb.db, shopId: 'shop-a', q: '' })
    expect(r.customers).toEqual([])
    expect(r.vehicles).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test, expect failure**

```bash
pnpm test tests/unit/intake-search-query.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `searchIntake`**

Create `lib/intake/search.ts`:

```ts
import { and, desc, eq, ilike, like, or, sql } from 'drizzle-orm'
import { customers, sessions, vehicles } from '@/lib/db/schema'
import type { db as DbType } from '@/lib/db/client'

export type CustomerHit = {
  id: string
  name: string
  phone: string | null
  email: string | null
  vehicleCount: number
  lastVisit: Date | null
}

export type VehicleHit = {
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

export type SearchResults = {
  customers: CustomerHit[]
  vehicles: VehicleHit[]
}

const PER_GROUP_LIMIT = 5

function tokenize(q: string): string[] {
  return q.trim().split(/\s+/).filter((t) => t !== '')
}

export async function searchIntake(opts: {
  db: typeof DbType
  shopId: string
  q: string
}): Promise<SearchResults> {
  const tokens = tokenize(opts.q)
  if (tokens.length === 0) return { customers: [], vehicles: [] }

  // ----- Customers -----
  // Per token, require: name ILIKE %t% OR phone LIKE %t% OR email ILIKE %t%.
  // All tokens AND'd together. Order by exact-prefix (name) > substring > most-recent session.
  const customerConditions = tokens.map((t) =>
    or(
      ilike(customers.name, `%${t}%`),
      like(customers.phone, `%${t}%`),
      ilike(customers.email, `%${t}%`),
    ),
  )

  const firstTok = tokens[0]
  const prefixScore = sql<number>`CASE WHEN ${customers.name} ILIKE ${firstTok + '%'} THEN 0 ELSE 1 END`.as('prefix_score')

  const customerRows = await opts.db
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
      email: customers.email,
      vehicleCount: sql<number>`(SELECT COUNT(*)::int FROM ${vehicles} WHERE ${vehicles.customerId} = ${customers.id})`.as('vehicle_count'),
      lastVisit: sql<Date | null>`(SELECT MAX(${sessions.createdAt}) FROM ${sessions} WHERE ${sessions.vehicleId} IN (SELECT ${vehicles.id} FROM ${vehicles} WHERE ${vehicles.customerId} = ${customers.id}))`.as('last_visit'),
      prefixScore,
    })
    .from(customers)
    .where(and(eq(customers.shopId, opts.shopId), ...customerConditions))
    .orderBy(prefixScore, desc(sql`COALESCE((SELECT MAX(${sessions.createdAt}) FROM ${sessions} WHERE ${sessions.vehicleId} IN (SELECT ${vehicles.id} FROM ${vehicles} WHERE ${vehicles.customerId} = ${customers.id})), TIMESTAMP 'epoch')`))
    .limit(PER_GROUP_LIMIT)

  // ----- Vehicles -----
  // Per token, match across vehicle fields OR owning customer's name.
  const vehicleConditions = tokens.map((t) =>
    or(
      sql`CAST(${vehicles.year} AS TEXT) LIKE ${`%${t}%`}`,
      ilike(vehicles.make, `%${t}%`),
      ilike(vehicles.model, `%${t}%`),
      ilike(vehicles.engine, `%${t}%`),
      ilike(vehicles.vin, `%${t}%`),
      ilike(vehicles.plate, `%${t}%`),
      ilike(customers.name, `%${t}%`),
    ),
  )

  const vehicleRows = await opts.db
    .select({
      id: vehicles.id,
      year: vehicles.year,
      make: vehicles.make,
      model: vehicles.model,
      engine: vehicles.engine,
      vin: vehicles.vin,
      plate: vehicles.plate,
      mileage: vehicles.mileage,
      ownerId: customers.id,
      ownerName: customers.name,
      lastVisit: sql<Date | null>`(SELECT MAX(${sessions.createdAt}) FROM ${sessions} WHERE ${sessions.vehicleId} = ${vehicles.id})`.as('last_visit'),
    })
    .from(vehicles)
    .innerJoin(customers, eq(vehicles.customerId, customers.id))
    .where(and(eq(customers.shopId, opts.shopId), ...vehicleConditions))
    .orderBy(desc(sql`COALESCE((SELECT MAX(${sessions.createdAt}) FROM ${sessions} WHERE ${sessions.vehicleId} = ${vehicles.id}), TIMESTAMP 'epoch')`))
    .limit(PER_GROUP_LIMIT)

  return {
    customers: customerRows.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      vehicleCount: Number(c.vehicleCount),
      lastVisit: c.lastVisit instanceof Date ? c.lastVisit : c.lastVisit ? new Date(c.lastVisit as unknown as string) : null,
    })),
    vehicles: vehicleRows.map((v) => ({
      id: v.id,
      year: v.year,
      make: v.make,
      model: v.model,
      engine: v.engine,
      vin: v.vin,
      plate: v.plate,
      mileage: v.mileage,
      ownerId: v.ownerId,
      ownerName: v.ownerName,
      lastVisit: v.lastVisit instanceof Date ? v.lastVisit : v.lastVisit ? new Date(v.lastVisit as unknown as string) : null,
    })),
  }
}
```

- [ ] **Step 4: Run the test, expect pass**

```bash
pnpm test tests/unit/intake-search-query.test.ts
```

Expected: PASS (8 cases).

- [ ] **Step 5: Commit**

```bash
git add lib/intake/search.ts tests/unit/intake-search-query.test.ts
git commit -m "feat(intake): add search query builder (per-shop, multi-token AND)"
```

---

## Task 8: `app/api/intake/search/route.ts` — endpoint wrapper

**Files:**
- Create: `app/api/intake/search/route.ts`
- Test: `tests/unit/intake-search-route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/intake-search-route.test.ts`:

```ts
import { describe, expect, it, beforeEach, vi } from 'vitest'

vi.mock('@/lib/intake/search', () => ({
  searchIntake: vi.fn(),
}))
vi.mock('@/lib/intake/recent-customers', () => ({
  getRecentIntakeCustomers: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({
  requireUserAndProfile: vi.fn(),
}))
vi.mock('@/lib/supabase-server', () => ({
  getServerSupabase: vi.fn(async () => ({})),
}))
vi.mock('@/lib/db/client', () => ({ db: {} }))

import { POST } from '@/app/api/intake/search/route'
import { searchIntake } from '@/lib/intake/search'
import { getRecentIntakeCustomers } from '@/lib/intake/recent-customers'
import { requireUserAndProfile } from '@/lib/auth'

const searchMock = searchIntake as ReturnType<typeof vi.fn>
const recentsMock = getRecentIntakeCustomers as ReturnType<typeof vi.fn>
const authMock = requireUserAndProfile as ReturnType<typeof vi.fn>

function req(body: unknown) {
  return new Request('http://localhost/api/intake/search', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('POST /api/intake/search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue({ profile: { id: 'p1', shopId: 's1', role: 'owner' }, user: { id: 'u1' } })
  })

  it('returns search results for a non-empty query', async () => {
    searchMock.mockResolvedValue({ customers: [{ id: 'c1', name: 'X', phone: null, email: null, vehicleCount: 0, lastVisit: null }], vehicles: [] })
    const res = await POST(req({ q: 'smith' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.customers).toHaveLength(1)
    expect(typeof body.latencyMs).toBe('number')
    expect(searchMock).toHaveBeenCalledWith({ db: {}, shopId: 's1', q: 'smith' })
  })

  it('returns recent customers when q is empty', async () => {
    recentsMock.mockResolvedValue([{ id: 'c1', name: 'Recent', phone: null, email: null, vehicleCount: 1, lastVisit: new Date() }])
    const res = await POST(req({ q: '' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.customers).toHaveLength(1)
    expect(body.vehicles).toEqual([])
    expect(recentsMock).toHaveBeenCalled()
    expect(searchMock).not.toHaveBeenCalled()
  })

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null)
    const res = await POST(req({ q: 'smith' }))
    expect(res.status).toBe(401)
  })

  it('returns 403 when profile has no shopId', async () => {
    authMock.mockResolvedValue({ profile: { id: 'p1', shopId: null, role: 'owner' }, user: { id: 'u1' } })
    const res = await POST(req({ q: 'smith' }))
    expect(res.status).toBe(403)
  })

  it('returns 400 on invalid JSON', async () => {
    const badReq = new Request('http://localhost/api/intake/search', {
      method: 'POST', body: 'not json', headers: { 'content-type': 'application/json' },
    })
    const res = await POST(badReq)
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run the test, expect failure**

```bash
pnpm test tests/unit/intake-search-route.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route**

Create `app/api/intake/search/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile } from '@/lib/auth'
import { searchIntake } from '@/lib/intake/search'
import { getRecentIntakeCustomers } from '@/lib/intake/recent-customers'

type Body = { q?: string }

export async function POST(req: Request) {
  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const q = typeof body.q === 'string' ? body.q : ''

  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  if (!ctx.profile.shopId) {
    return NextResponse.json({ error: 'no_shop' }, { status: 403 })
  }

  const start = performance.now()

  if (q.trim() === '') {
    const recents = await getRecentIntakeCustomers({ db, shopId: ctx.profile.shopId, withinHours: 12, limit: 8 })
    return NextResponse.json(
      { customers: recents, vehicles: [], latencyMs: Math.round(performance.now() - start) },
      { status: 200 },
    )
  }

  const result = await searchIntake({ db, shopId: ctx.profile.shopId, q })
  return NextResponse.json(
    { ...result, latencyMs: Math.round(performance.now() - start) },
    { status: 200 },
  )
}
```

- [ ] **Step 4: Run the test, expect pass**

```bash
pnpm test tests/unit/intake-search-route.test.ts
```

Expected: PASS (5 cases).

- [ ] **Step 5: Commit**

```bash
git add app/api/intake/search/route.ts tests/unit/intake-search-route.test.ts
git commit -m "feat(intake): add /api/intake/search endpoint with empty=recents fallback"
```

---

## Task 9: Extend `/api/intake/submit` to accept `{ existingCustomerId, existingVehicleId }`

**Files:**
- Modify: `app/api/intake/submit/route.ts`
- Test: `tests/unit/intake-submit-pick-existing.test.ts`

The route currently requires manual `customer.name/phone` + `vehicle.year/make/model` + `complaint.description`. We add an alternative input shape: when `existingVehicleId` is supplied, the route loads that vehicle (scoped to the caller's shop via customer.shopId), pulls customer + vehicle data from the DB, and uses those instead of body-supplied fields. Tree generation, mileage update, and session creation all stay the same.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/intake-submit-pick-existing.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDb, teardownTestDb, type TestDb } from '@/tests/helpers/pglite'
import { customers, vehicles, shops, profiles } from '@/lib/db/schema'

// Stub the heavy AI work so the route only exercises the existing-pick branch.
vi.mock('@/lib/ai/tree-engine', () => ({
  generateInitialTree: vi.fn(async () => ({ mocked: true })),
}))
vi.mock('@/lib/retrieval/orchestrator', () => ({
  runRetrieval: vi.fn(async () => []),
}))
vi.mock('@/lib/retrieval/validator', () => ({
  validateRetrievalResults: vi.fn(async () => []),
}))
vi.mock('@/lib/corpus/retrieval', () => ({
  retrieveCorpus: vi.fn(async () => []),
}))
vi.mock('@/lib/retrieval/wire-into-tree', () => ({
  buildGenerateInitialTreeWithRetrieval: () => async () => ({ mocked: true }),
}))
vi.mock('@/lib/retrieval/adapters/nhtsa', () => ({ NHTSAAdapter: class {} }))
vi.mock('@/lib/retrieval/adapters/manufacturer-recall', () => ({ ManufacturerRecallAdapter: class {} }))
vi.mock('@/lib/retrieval/adapters/forum', () => ({ ForumAdapter: class {} }))
vi.mock('@/lib/retrieval/adapters/youtube', () => ({ YouTubeAdapter: class {} }))
vi.mock('@/lib/retrieval/adapters/reddit', () => ({ RedditAdapter: class {} }))
vi.mock('@/lib/retrieval/adapters/web-search', () => ({ WebSearchAdapter: class {} }))

vi.mock('@/lib/auth', () => ({
  requireUserAndProfile: vi.fn(),
}))
vi.mock('@/lib/supabase-server', () => ({
  getServerSupabase: vi.fn(async () => ({})),
}))

// Use the test DB as the route's db client.
let testDb: TestDb
vi.mock('@/lib/db/client', () => ({
  get db() {
    return testDb.db
  },
}))

import { POST } from '@/app/api/intake/submit/route'
import { requireUserAndProfile } from '@/lib/auth'
const authMock = requireUserAndProfile as ReturnType<typeof vi.fn>

function req(body: unknown) {
  return new Request('http://localhost/api/intake/submit', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('POST /api/intake/submit — pick-existing path', () => {
  beforeEach(async () => {
    testDb = await setupTestDb()
    await testDb.db.insert(shops).values({ id: 'shop-a', name: 'Shop' })
    const [tech] = await testDb.db.insert(profiles).values({ userId: 'u1', shopId: 'shop-a', fullName: 'Tech', role: 'owner' }).returning()
    authMock.mockResolvedValue({ profile: tech, user: { id: 'u1' } })
  })
  afterEach(async () => {
    await teardownTestDb(testDb)
    vi.clearAllMocks()
  })

  it('creates a session attached to the existing vehicle without inserting new customer/vehicle rows', async () => {
    const [c] = await testDb.db.insert(customers).values({ shopId: 'shop-a', name: 'Existing', phone: '7705551234' }).returning()
    const [v] = await testDb.db.insert(vehicles).values({ customerId: c.id, year: 2018, make: 'Ford', model: 'F-150' }).returning()
    const customerCountBefore = (await testDb.db.select().from(customers)).length
    const vehicleCountBefore = (await testDb.db.select().from(vehicles)).length

    const res = await POST(req({
      existingVehicleId: v.id,
      complaint: { description: 'engine noise', whenStarted: 'today', howOften: 'always', authorized: 'yes' },
      vehicle: { mileage: '104500' },
    }))

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.sessionId).toBeTypeOf('string')

    const customerCountAfter = (await testDb.db.select().from(customers)).length
    const vehicleCountAfter = (await testDb.db.select().from(vehicles)).length
    expect(customerCountAfter).toBe(customerCountBefore) // no new customer
    expect(vehicleCountAfter).toBe(vehicleCountBefore)   // no new vehicle
  })

  it('updates existing vehicle.mileage when one is provided on a pick-existing submit', async () => {
    const [c] = await testDb.db.insert(customers).values({ shopId: 'shop-a', name: 'X', phone: '0' }).returning()
    const [v] = await testDb.db.insert(vehicles).values({ customerId: c.id, year: 2018, make: 'Ford', model: 'F-150', mileage: 90000 }).returning()

    await POST(req({
      existingVehicleId: v.id,
      complaint: { description: 'd', whenStarted: '', howOften: '', authorized: '' },
      vehicle: { mileage: '104500' },
    }))

    const [updated] = await testDb.db.select().from(vehicles).where((v2) => (v2 as any).id.eq(v.id) as any) // adjust to match codebase's where-helper if needed
    // Fallback path if the where-helper above doesn't match your codebase style:
    const all = await testDb.db.select().from(vehicles)
    const u = all.find((row) => row.id === v.id)!
    expect(u.mileage).toBe(104500)
  })

  it('rejects existingVehicleId from a different shop with 403', async () => {
    const [c] = await testDb.db.insert(customers).values({ shopId: 'shop-other', name: 'Outside', phone: '0' }).returning()
    const [v] = await testDb.db.insert(vehicles).values({ customerId: c.id, year: 2018, make: 'Ford', model: 'F-150' }).returning()
    // shop-other does not exist yet for the test seed; add it minimally
    await testDb.db.insert(shops).values({ id: 'shop-other', name: 'Other' }).onConflictDoNothing()

    const res = await POST(req({
      existingVehicleId: v.id,
      complaint: { description: 'd', whenStarted: '', howOften: '', authorized: '' },
    }))
    expect(res.status).toBe(403)
  })

  it('returns 422 when neither existingVehicleId nor manual fields are provided', async () => {
    const res = await POST(req({ complaint: { description: 'something' } }))
    expect(res.status).toBe(422)
  })

  it('still accepts the original manual-entry body unchanged (backwards-compat)', async () => {
    const res = await POST(req({
      customer: { name: 'New', phone: '7705550001' },
      vehicle: { year: '2020', make: 'Honda', model: 'Civic', vin: 'VIN12345678901234' },
      complaint: { description: 'oil change', whenStarted: '', howOften: '', authorized: 'yes' },
    }))
    expect(res.status).toBe(201)
    const all = await testDb.db.select().from(customers)
    expect(all.some((c) => c.name === 'New')).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test, expect failure**

```bash
pnpm test tests/unit/intake-submit-pick-existing.test.ts
```

Expected: FAIL — current route returns 422 because it requires manual fields.

- [ ] **Step 3: Modify the route to handle the pick-existing branch**

In `app/api/intake/submit/route.ts`, update the `IntakeBody` type and the `POST` handler. The full new file:

```ts
import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile } from '@/lib/auth'
import { createSessionFromIntake } from '@/lib/intake/session'
import { generateInitialTree } from '@/lib/ai/tree-engine'
import { retrieveCorpus } from '@/lib/corpus/retrieval'
import { runRetrieval } from '@/lib/retrieval/orchestrator'
import { validateRetrievalResults } from '@/lib/retrieval/validator'
import { buildGenerateInitialTreeWithRetrieval } from '@/lib/retrieval/wire-into-tree'
import { NHTSAAdapter } from '@/lib/retrieval/adapters/nhtsa'
import { ManufacturerRecallAdapter } from '@/lib/retrieval/adapters/manufacturer-recall'
import { ForumAdapter } from '@/lib/retrieval/adapters/forum'
import { YouTubeAdapter } from '@/lib/retrieval/adapters/youtube'
import { RedditAdapter } from '@/lib/retrieval/adapters/reddit'
import { WebSearchAdapter } from '@/lib/retrieval/adapters/web-search'
import { customers as customersTable, vehicles as vehiclesTable } from '@/lib/db/schema'

export const maxDuration = 60

const ADAPTERS = [
  new NHTSAAdapter(),
  new ManufacturerRecallAdapter(),
  new ForumAdapter(),
  new YouTubeAdapter(),
  new RedditAdapter(),
  new WebSearchAdapter(),
]

type IntakeBody = {
  // Pick-existing path:
  existingVehicleId?: string

  // Manual path (existing):
  customer?: { name?: string; phone?: string; email?: string }
  vehicle?: {
    vin?: string
    year?: string
    make?: string
    model?: string
    engine?: string
    mileage?: string
    plate?: string
  }
  complaint?: {
    description?: string
    whenStarted?: string
    howOften?: string
    authorized?: string
  }
}

function nonEmpty(v: string | undefined): string | null {
  if (!v) return null
  const trimmed = v.trim()
  return trimmed === '' ? null : trimmed
}
function toIntOrNull(v: string | undefined): number | null {
  const trimmed = nonEmpty(v)
  if (trimmed === null) return null
  const parsed = Number.parseInt(trimmed, 10)
  return Number.isFinite(parsed) ? parsed : null
}

export async function POST(req: Request) {
  let body: IntakeBody
  try {
    body = (await req.json()) as IntakeBody
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  if (!ctx.profile.shopId) {
    return NextResponse.json({ error: 'no_shop' }, { status: 403 })
  }

  const description = nonEmpty(body.complaint?.description)
  if (!description) {
    return NextResponse.json({ error: 'complaint description is required' }, { status: 422 })
  }

  // ---- Resolve customer + vehicle ----
  let resolvedCustomer: { id: string; name: string; phone: string; email: string | null }
  let resolvedVehicle: {
    id?: string
    year: number
    make: string
    model: string
    engine: string | null
    vin: string | null
    mileage: number | null
    plate: string | null
  }

  if (body.existingVehicleId) {
    // Pick-existing branch.
    const [v] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, body.existingVehicleId)).limit(1)
    if (!v) {
      return NextResponse.json({ error: 'vehicle_not_found' }, { status: 404 })
    }
    const [c] = await db.select().from(customersTable).where(eq(customersTable.id, v.customerId)).limit(1)
    if (!c || c.shopId !== ctx.profile.shopId) {
      return NextResponse.json({ error: 'cross_shop_forbidden' }, { status: 403 })
    }
    // Optional mileage update for this visit.
    const newMileage = toIntOrNull(body.vehicle?.mileage)
    if (newMileage !== null && newMileage !== v.mileage) {
      await db.update(vehiclesTable).set({ mileage: newMileage, updatedAt: new Date() }).where(eq(vehiclesTable.id, v.id))
    }
    resolvedCustomer = { id: c.id, name: c.name, phone: c.phone, email: c.email }
    resolvedVehicle = {
      id: v.id,
      year: v.year,
      make: v.make,
      model: v.model,
      engine: v.engine,
      vin: v.vin,
      mileage: newMileage ?? v.mileage,
      plate: v.plate,
    }
  } else {
    // Manual-entry branch (unchanged).
    const name = nonEmpty(body.customer?.name)
    const phone = nonEmpty(body.customer?.phone)
    const email = nonEmpty(body.customer?.email)
    const vin = nonEmpty(body.vehicle?.vin)
    const year = toIntOrNull(body.vehicle?.year)
    const make = nonEmpty(body.vehicle?.make)
    const model = nonEmpty(body.vehicle?.model)
    const engine = nonEmpty(body.vehicle?.engine)
    const mileage = toIntOrNull(body.vehicle?.mileage)
    const plate = nonEmpty(body.vehicle?.plate)

    if (!name || !phone) {
      return NextResponse.json({ error: 'customer name and phone are required' }, { status: 422 })
    }
    if (!year || !make || !model) {
      return NextResponse.json({ error: 'vehicle year, make, and model are required' }, { status: 422 })
    }
    resolvedCustomer = { id: '', name, phone, email }
    resolvedVehicle = { year, make, model, engine, vin, mileage, plate }
  }

  // ---- Tree generation (unchanged) ----
  const intakePayload = {
    vehicleYear: resolvedVehicle.year,
    vehicleMake: resolvedVehicle.make,
    vehicleModel: resolvedVehicle.model,
    vehicleEngine: resolvedVehicle.engine ?? undefined,
    mileage: resolvedVehicle.mileage ?? undefined,
    customerComplaint: description,
  }

  const generateInitialTreeWithRetrieval = buildGenerateInitialTreeWithRetrieval({
    db,
    adapters: ADAPTERS,
    generateInitialTree,
    runRetrieval,
    validateRetrievalResults,
    retrieveCorpus,
  })

  let treeState
  try {
    treeState = await generateInitialTreeWithRetrieval(intakePayload)
  } catch (err) {
    console.error('tree generation failed:', err)
    return NextResponse.json({ error: 'tree generation failed' }, { status: 500 })
  }

  // ---- Session creation ----
  const { sessionId } = await createSessionFromIntake(db, {
    shopId: ctx.profile.shopId,
    advisorProfileId: ctx.profile.id,
    customer: { name: resolvedCustomer.name, phone: resolvedCustomer.phone, email: resolvedCustomer.email },
    vehicle: {
      year: resolvedVehicle.year,
      make: resolvedVehicle.make,
      model: resolvedVehicle.model,
      engine: resolvedVehicle.engine,
      vin: resolvedVehicle.vin,
      mileage: resolvedVehicle.mileage,
      plate: resolvedVehicle.plate,
    },
    complaint: {
      description,
      whenStarted: body.complaint?.whenStarted?.trim() ?? '',
      howOften: body.complaint?.howOften?.trim() ?? '',
      authorized: body.complaint?.authorized?.trim() ?? '',
    },
    treeState,
    existingCustomerId: body.existingVehicleId ? resolvedCustomer.id : undefined,
    existingVehicleId: body.existingVehicleId,
  })

  return NextResponse.json({ sessionId }, { status: 201 })
}
```

- [ ] **Step 4: Update `createSessionFromIntake` to accept the existing IDs**

`lib/intake/session.ts` already creates `customer + vehicle + session` from scratch. Add optional `existingCustomerId` and `existingVehicleId` params; when present, skip the customer + vehicle inserts and use the IDs directly.

Open `lib/intake/session.ts`. At the top of `createSessionFromIntake`, branch on the new params:

```ts
// Inside createSessionFromIntake, after the existing arg destructuring:
const customerId = opts.existingCustomerId
  ?? (await db.insert(customers).values({
    shopId: opts.shopId,
    name: opts.customer.name,
    phone: opts.customer.phone,
    email: opts.customer.email,
  }).returning())[0].id

const vehicleId = opts.existingVehicleId
  ?? (await db.insert(vehicles).values({
    customerId,
    year: opts.vehicle.year,
    make: opts.vehicle.make,
    model: opts.vehicle.model,
    engine: opts.vehicle.engine,
    vin: opts.vehicle.vin,
    mileage: opts.vehicle.mileage,
    plate: opts.vehicle.plate,
  }).returning())[0].id

// The rest of the function (session insert) continues as today, using
// vehicleId / customerId resolved above.
```

Add `existingCustomerId?: string; existingVehicleId?: string` to the `createSessionFromIntake` opts type.

- [ ] **Step 5: Run the test, expect pass**

```bash
pnpm test tests/unit/intake-submit-pick-existing.test.ts
```

Expected: PASS (5 cases). Also run the full existing intake tests to confirm the manual path still works:

```bash
pnpm test tests/unit/ -t "intake"
```

- [ ] **Step 6: Commit**

```bash
git add app/api/intake/submit/route.ts lib/intake/session.ts tests/unit/intake-submit-pick-existing.test.ts
git commit -m "feat(intake): /api/intake/submit accepts existingVehicleId for pick-existing path"
```

---

## Task 10: Port `intake-search.css` (with `--vt-amber-*` → `--vt-signal-*` rename)

**Files:**
- Create: `components/vt/intake-search/intake-search.css`

- [ ] **Step 1: Copy the design CSS into the component folder**

```bash
mkdir -p components/vt/intake-search
cp design_handoff_predictive_intake_search/intake-search.css components/vt/intake-search/intake-search.css
```

- [ ] **Step 2: Remove the two design-system `@import` lines at the top**

Open `components/vt/intake-search/intake-search.css`. Delete lines 28-29 (the two `@import url(...)` directives). The CSS now relies on `app/globals.css` being already loaded by the layout.

- [ ] **Step 3: Rename `--vt-amber-*` → `--vt-signal-*` throughout**

Use a single sed pass (Mac BSD sed syntax — adjust on Linux):

```bash
sed -i '' 's/--vt-amber-/--vt-signal-/g' components/vt/intake-search/intake-search.css
sed -i '' 's/--vt-fg-on-amber/--vt-fg-on-signal/g' components/vt/intake-search/intake-search.css
sed -i '' 's/--vt-stroke-amber/--vt-stroke-signal/g' components/vt/intake-search/intake-search.css
```

- [ ] **Step 4: Verify zero `--vt-amber-*` references remain in the file**

```bash
grep -n "vt-amber" components/vt/intake-search/intake-search.css
```

Expected: NO output (silent grep means no matches).

- [ ] **Step 5: Verify the comments referring to "signal-navy" are now consistent**

```bash
grep -n "signal" components/vt/intake-search/intake-search.css | head -30
```

Expected: all references now read `--vt-signal-*`. The doc-comments in the file (e.g. line 9 mentioning "signal-navy") were never wrong; they described intent — the renames just align the token names with the codebase.

- [ ] **Step 6: Commit**

```bash
git add components/vt/intake-search/intake-search.css
git commit -m "feat(intake): port intake-search.css with amber→signal token rename"
```

---

## Task 11: Component atoms — `rows.tsx`

**Files:**
- Create: `components/vt/intake-search/rows.tsx`

No tests for atoms in isolation — they're tested transitively in Task 13 (`use-intake-search`) and Task 14 (component). Atoms are pure presentational React; trying to test them on their own produces brittle snapshot tests that don't catch real bugs.

- [ ] **Step 1: Create the atoms file**

Create `components/vt/intake-search/rows.tsx`:

```tsx
import type { ReactNode } from 'react'

export function Glyph() {
  return <span className="pis__glyph" />
}

export function Mark({ children }: { children: ReactNode }) {
  return <em className="pis__mark">{children}</em>
}

export function ScanBtn({ label = 'Scan VIN/plate' }: { label?: string }) {
  return (
    <button type="button" className="pis__scan-btn" aria-disabled="true" title="Scan coming">
      <span className="pis__scan-btn__ring" />
      {label}
    </button>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="pis__kbd">{children}</span>
}

export function Caret() {
  return <span className="pis__caret" />
}

export type RowProps = {
  kind: string
  primary: ReactNode
  secondary?: ReactNode
  meta?: ReactNode
  focused?: boolean
  onClick?: () => void
  id?: string
}

export function Row({ kind, primary, secondary, meta, focused, onClick, id }: RowProps) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={focused ? 'true' : 'false'}
      id={id}
      className={`pis__row ${focused ? 'pis__row--focused' : ''}`}
      onClick={onClick}
    >
      <span className="pis__row-kind">{kind}</span>
      <div>
        <div className="pis__row-primary">{primary}</div>
        {secondary && <div className="pis__row-secondary">{secondary}</div>}
      </div>
      {meta && <span className="pis__row-meta">{meta}</span>}
    </button>
  )
}

export function CreateRow({
  label = 'Create new customer',
  hint,
  kbd = '↩',
  focused,
  onClick,
  id,
}: {
  label?: string
  hint?: string
  kbd?: string
  focused?: boolean
  onClick?: () => void
  id?: string
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={focused ? 'true' : 'false'}
      id={id}
      className={`pis__create ${focused ? 'pis__row--focused' : ''}`}
      onClick={onClick}
    >
      <span className="pis__create__plus">+</span>
      <span>
        {label}
        {hint && <span className="pis__create__hint">{hint}</span>}
      </span>
      {kbd && <span className="pis__row-meta">{kbd}</span>}
    </button>
  )
}

export function GroupHead({ label, count }: { label: string; count?: string | number }) {
  return (
    <div className="pis__group-head">
      <span>{label}</span>
      {count !== undefined && <span>{count}</span>}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/vt/intake-search/rows.tsx
git commit -m "feat(intake): add presentational row atoms"
```

---

## Task 12: Component atoms — `dropdown.tsx`

**Files:**
- Create: `components/vt/intake-search/dropdown.tsx`

- [ ] **Step 1: Create the dropdown shells**

Create `components/vt/intake-search/dropdown.tsx`:

```tsx
import type { ReactNode } from 'react'
import { CreateRow, GroupHead, Row } from './rows'
import type { RecentCustomer } from '@/lib/intake/recent-customers'
import type { CustomerHit, VehicleHit } from '@/lib/intake/search'
import type { InputShape } from '@/lib/intake/input-shape'

export function DropdownEmpty({
  recents,
  focusedIdx,
  onPickCustomer,
  onCreateNew,
}: {
  recents: RecentCustomer[]
  focusedIdx: number | null
  onPickCustomer: (customer: RecentCustomer) => void
  onCreateNew: () => void
}) {
  if (recents.length === 0) {
    return (
      <div className="pis__dropdown" role="listbox" id="pis-dropdown">
        <div className="pis__dropdown-inner">
          <div className="pis__empty-zero">
            No one's been through the counter yet today.<br />
            Start typing — or create a new customer.
          </div>
        </div>
        <CreateRow
          id="pis-row-create"
          hint="Name and phone is all we need."
          focused={focusedIdx === 0}
          onClick={onCreateNew}
        />
      </div>
    )
  }

  const visible = recents.slice(0, 5)
  const showSeeMore = recents.length > 5

  return (
    <div className="pis__dropdown" role="listbox" id="pis-dropdown">
      <div className="pis__dropdown-inner">
        <GroupHead label="Recent · today" count={`${recents.length} customer${recents.length === 1 ? '' : 's'}`} />
        <div className="pis__empty-pad">
          {visible.map((c, i) => (
            <Row
              key={c.id}
              id={`pis-row-${i}`}
              kind="C"
              primary={c.name}
              secondary={
                <>
                  {c.phone ?? '—'}
                  {' · '}
                  {c.vehicleCount} vehicle{c.vehicleCount === 1 ? '' : 's'}
                </>
              }
              meta="↩"
              focused={focusedIdx === i}
              onClick={() => onPickCustomer(c)}
            />
          ))}
        </div>
        {showSeeMore && (
          <button type="button" className="pis__seemore">
            See all {recents.length} ↓
          </button>
        )}
      </div>
      <CreateRow
        id="pis-row-create"
        hint="Or — start a new ticket from scratch."
        focused={focusedIdx === visible.length}
        onClick={onCreateNew}
      />
    </div>
  )
}

export function DropdownSearching({ elapsedMs, onCreateNew, focusedIdx }: { elapsedMs: number; onCreateNew: () => void; focusedIdx: number | null }) {
  return (
    <div className="pis__dropdown" role="listbox" id="pis-dropdown">
      <div className="pis__dropdown-inner">
        <div className="pis__status">
          <span className="pis__status__left">
            <span className="pis__spinner" /> Searching · {elapsedMs} ms
          </span>
          <span>—</span>
        </div>
        <div style={{ padding: '22px 18px 26px', fontFamily: 'var(--vt-font-serif)', fontStyle: 'italic', color: 'var(--vt-fg-3)', fontSize: 15 }}>
          Holding previous results while we re-fetch…
        </div>
      </div>
      <CreateRow id="pis-row-create" hint="No need to wait — you can always create new." focused={focusedIdx === 0} onClick={onCreateNew} />
    </div>
  )
}

export function DropdownResults({
  customers,
  vehicles,
  latencyMs,
  focusedIdx,
  onPickCustomer,
  onPickVehicle,
  onCreateNew,
  highlightTokens,
}: {
  customers: CustomerHit[]
  vehicles: VehicleHit[]
  latencyMs: number
  focusedIdx: number | null
  onPickCustomer: (customer: CustomerHit) => void
  onPickVehicle: (vehicle: VehicleHit) => void
  onCreateNew: () => void
  highlightTokens: string[]
}) {
  const totalMatches = customers.length + vehicles.length
  let idx = 0
  return (
    <div className="pis__dropdown" role="listbox" id="pis-dropdown">
      <div className="pis__dropdown-inner">
        <div className="pis__status">
          <span className="pis__status__left">Matched · {latencyMs} ms · {totalMatches} match{totalMatches === 1 ? '' : 'es'}</span>
          <span>↑↓ navigate · ↩ pick</span>
        </div>
        {customers.length > 0 && <GroupHead label="Customers" count={customers.length} />}
        {customers.map((c) => {
          const myIdx = idx++
          return (
            <Row
              key={c.id}
              id={`pis-row-${myIdx}`}
              kind="C"
              primary={highlight(c.name, highlightTokens)}
              secondary={<>{c.phone ?? '—'}{c.email ? ` · ${c.email}` : ''} · {c.vehicleCount} vehicle{c.vehicleCount === 1 ? '' : 's'}</>}
              meta={c.lastVisit ? formatRelative(c.lastVisit) : '—'}
              focused={focusedIdx === myIdx}
              onClick={() => onPickCustomer(c)}
            />
          )
        })}
        {customers.length > 0 && vehicles.length > 0 && <div className="pis__divider" />}
        {vehicles.length > 0 && <GroupHead label="Vehicles" count={vehicles.length} />}
        {vehicles.map((v) => {
          const myIdx = idx++
          return (
            <Row
              key={v.id}
              id={`pis-row-${myIdx}`}
              kind="V"
              primary={
                <>
                  {highlight(`${v.year ?? ''} ${v.make ?? ''} ${v.model ?? ''}`.trim(), highlightTokens)} · {v.ownerName}
                </>
              }
              secondary={
                <>
                  {v.vin && <>VIN {highlight(v.vin, highlightTokens)}</>}
                  {v.plate && <> · {highlight(v.plate, highlightTokens)}</>}
                  {v.mileage != null && <> · {v.mileage.toLocaleString()} mi</>}
                </>
              }
              meta={v.lastVisit ? formatRelative(v.lastVisit) : '—'}
              focused={focusedIdx === myIdx}
              onClick={() => onPickVehicle(v)}
            />
          )
        })}
      </div>
      <CreateRow
        id="pis-row-create"
        hint="Not in this list? Create new customer."
        focused={focusedIdx === totalMatches}
        onClick={onCreateNew}
      />
    </div>
  )
}

export function DropdownNoMatch({
  query,
  shape,
  onCreateNew,
  focusedIdx,
}: {
  query: string
  shape: InputShape
  onCreateNew: () => void
  focusedIdx: number | null
}) {
  const hint = routeHint(shape)
  return (
    <div className="pis__dropdown" role="listbox" id="pis-dropdown">
      <div className="pis__dropdown-inner">
        <div className="pis__status">
          <span className="pis__status__left">No match</span>
          <span>—</span>
        </div>
        <div className="pis__nomatch">
          <div className="pis__nomatch__head">
            Nothing matches <em style={{ fontStyle: 'italic', color: 'var(--vt-fg)' }}>"{query}"</em> in customers or vehicles.
          </div>
          <div className="pis__nomatch__detail">Searched: name · phone · email · VIN · plate · year · make · model</div>
          {hint && (
            <div className="pis__nomatch__route">
              Looks like a {hint.kind} — we'll prefill the {hint.field} field. <b>{hint.field}: {hint.value}</b>
            </div>
          )}
        </div>
      </div>
      <CreateRow
        id="pis-row-create"
        label="Create new customer with this info"
        hint="Required fields: name + phone."
        focused={focusedIdx === 0}
        onClick={onCreateNew}
      />
    </div>
  )
}

export function DropdownSlow({ elapsedSec, prev, focusedIdx, onCreateNew }: { elapsedSec: number; prev: { customers: CustomerHit[]; vehicles: VehicleHit[] } | null; focusedIdx: number | null; onCreateNew: () => void }) {
  return (
    <div className="pis__dropdown" role="listbox" id="pis-dropdown">
      <div className="pis__dropdown-inner">
        <div className="pis__status">
          <span className="pis__status__left"><span className="pis__spinner" /> Still searching · {elapsedSec.toFixed(1)} s</span>
          <span>slow network</span>
        </div>
        <div style={{ padding: '20px 18px', fontFamily: 'var(--vt-font-serif)', fontStyle: 'italic', fontSize: 14, color: 'var(--vt-fg-3)', lineHeight: 1.45 }}>
          Holding previous matches. You can still create a new customer — we'll merge when the search returns.
        </div>
        {prev && (prev.customers.length > 0 || prev.vehicles.length > 0) && (
          <>
            <GroupHead label="Previous matches · stale" count={`${prev.customers.length} customer${prev.customers.length === 1 ? '' : 's'} · ${prev.vehicles.length} vehicle${prev.vehicles.length === 1 ? '' : 's'}`} />
            {prev.customers.map((c) => (
              <Row key={c.id} kind="C" primary={c.name} secondary={c.phone ?? '—'} meta="cached" />
            ))}
            {prev.vehicles.map((v) => (
              <Row key={v.id} kind="V" primary={`${v.year ?? ''} ${v.make ?? ''} ${v.model ?? ''} · ${v.ownerName}`.trim()} secondary={v.vin ?? '—'} meta="cached" />
            ))}
          </>
        )}
      </div>
      <CreateRow id="pis-row-create" hint="The create-new path is never blocked." focused={focusedIdx === 0} onClick={onCreateNew} />
    </div>
  )
}

export function DropdownWhichVehicle({
  customerName,
  vehicles,
  focusedIdx,
  onBack,
  onPickVehicle,
  onCreateNew,
}: {
  customerName: string
  vehicles: VehicleHit[]
  focusedIdx: number | null
  onBack: () => void
  onPickVehicle: (vehicle: VehicleHit) => void
  onCreateNew: () => void
}) {
  return (
    <div className="pis__dropdown" role="listbox" id="pis-dropdown">
      <div className="pis__dropdown-inner">
        <div className="pis__tier__head">
          <span className="pis__tier__title"><b>{customerName}</b> · which vehicle?</span>
          <button type="button" className="pis__tier__back" onClick={onBack}>← Back to results</button>
        </div>
        {vehicles.map((v, i) => (
          <Row
            key={v.id}
            id={`pis-row-${i}`}
            kind="V"
            primary={`${v.year ?? ''} ${v.make ?? ''} ${v.model ?? ''}`.trim()}
            secondary={
              <>
                {v.vin && <>VIN {v.vin}</>}
                {v.plate && <> · {v.plate}</>}
                {v.mileage != null && <> · {v.mileage.toLocaleString()} mi</>}
              </>
            }
            meta={v.lastVisit ? formatRelative(v.lastVisit) : '—'}
            focused={focusedIdx === i}
            onClick={() => onPickVehicle(v)}
          />
        ))}
      </div>
      <CreateRow
        id="pis-row-create"
        label="None of these — add another vehicle for this customer"
        focused={focusedIdx === vehicles.length}
        onClick={onCreateNew}
      />
    </div>
  )
}

/* helpers */

function highlight(text: string, tokens: string[]): ReactNode {
  if (tokens.length === 0 || text === '') return text
  const escaped = tokens.filter((t) => t !== '').map(escapeRegex)
  if (escaped.length === 0) return text
  const re = new RegExp(`(${escaped.join('|')})`, 'gi')
  const parts = text.split(re)
  return parts.map((p, i) =>
    re.test(p)
      ? <em key={i} className="pis__mark">{p}</em>
      : <span key={i}>{p}</span>,
  )
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function routeHint(shape: InputShape): { kind: string; field: string; value: string } | null {
  switch (shape.kind) {
    case 'phone': return { kind: 'phone', field: 'Phone', value: shape.value }
    case 'vin': return { kind: 'VIN', field: 'VIN', value: shape.value }
    case 'plate': return { kind: 'plate', field: 'License plate', value: shape.value }
    case 'year': return { kind: 'year', field: 'Year', value: String(shape.value) }
    case 'make': return { kind: 'make', field: 'Make', value: shape.value }
    case 'email': return { kind: 'email', field: 'Email', value: shape.value }
    default: return null
  }
}

function formatRelative(d: Date): string {
  const diffMs = Date.now() - d.getTime()
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000))
  if (days === 0) return 'today'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}wk ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}
```

- [ ] **Step 2: Commit**

```bash
git add components/vt/intake-search/dropdown.tsx
git commit -m "feat(intake): add dropdown shells (empty, results, no-match, slow, tier)"
```

---

## Task 13: `useIntakeSearch` hook — debounce + abort + state machine

**Files:**
- Create: `lib/intake/use-search.ts`
- Test: `tests/unit/use-intake-search.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/use-intake-search.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useIntakeSearch } from '@/lib/intake/use-search'

const flushTimers = async () => {
  await vi.advanceTimersByTimeAsync(160) // past 150ms debounce
}

describe('useIntakeSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('starts in idle state', () => {
    const { result } = renderHook(() => useIntakeSearch())
    expect(result.current.state.kind).toBe('idle')
  })

  it('debounces 150 ms before firing fetch', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ customers: [], vehicles: [], latencyMs: 5 }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useIntakeSearch())
    act(() => { result.current.setQuery('smith') })

    expect(fetchMock).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    expect(fetchMock).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(60) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('aborts in-flight request when query changes', async () => {
    const abortSpies: Array<AbortSignal> = []
    const fetchMock = vi.fn(async (_url: string, init?: { signal?: AbortSignal }) => {
      if (init?.signal) abortSpies.push(init.signal)
      await new Promise((r) => setTimeout(r, 1000)) // long-running
      return new Response(JSON.stringify({ customers: [], vehicles: [], latencyMs: 5 }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useIntakeSearch())
    act(() => { result.current.setQuery('smit') })
    await act(async () => { await flushTimers() })
    act(() => { result.current.setQuery('smith') })
    await act(async () => { await flushTimers() })

    expect(abortSpies[0].aborted).toBe(true)
  })

  it('transitions to "slow" after 5 s without response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Promise(() => {}))) // never resolves
    const { result } = renderHook(() => useIntakeSearch())
    act(() => { result.current.setQuery('smith') })
    await act(async () => { await flushTimers() })
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(result.current.state.kind).toBe('slow')
  })

  it('lands in "matched" with results on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      customers: [{ id: 'c1', name: 'Smith', phone: null, email: null, vehicleCount: 0, lastVisit: null }],
      vehicles: [],
      latencyMs: 42,
    }), { status: 200 })))
    const { result } = renderHook(() => useIntakeSearch())
    act(() => { result.current.setQuery('smith') })
    await act(async () => { await flushTimers() })
    await waitFor(() => expect(result.current.state.kind).toBe('matched'))
    if (result.current.state.kind === 'matched') {
      expect(result.current.state.customers).toHaveLength(1)
    }
  })

  it('lands in "no-match" when both groups are empty', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ customers: [], vehicles: [], latencyMs: 7 }), { status: 200 })))
    const { result } = renderHook(() => useIntakeSearch())
    act(() => { result.current.setQuery('xyz') })
    await act(async () => { await flushTimers() })
    await waitFor(() => expect(result.current.state.kind).toBe('no-match'))
  })

  it('reverts to idle on empty query', async () => {
    const { result } = renderHook(() => useIntakeSearch())
    act(() => { result.current.setQuery('') })
    await act(async () => { await flushTimers() })
    expect(result.current.state.kind).toBe('idle')
  })
})
```

- [ ] **Step 2: Run the test, expect failure**

```bash
pnpm test tests/unit/use-intake-search.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

Create `lib/intake/use-search.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CustomerHit, VehicleHit } from './search'

const DEBOUNCE_MS = 150
const SLOW_AFTER_MS = 5_000

export type SearchState =
  | { kind: 'idle' }
  | { kind: 'searching'; query: string; elapsedMs: number }
  | { kind: 'slow'; query: string; elapsedSec: number; prev: { customers: CustomerHit[]; vehicles: VehicleHit[] } | null }
  | { kind: 'matched'; query: string; customers: CustomerHit[]; vehicles: VehicleHit[]; latencyMs: number }
  | { kind: 'no-match'; query: string; latencyMs: number }
  | { kind: 'error'; query: string; message: string }

export function useIntakeSearch() {
  const [state, setState] = useState<SearchState>({ kind: 'idle' })
  const lastResults = useRef<{ customers: CustomerHit[]; vehicles: VehicleHit[] } | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const slowTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimers = useCallback(() => {
    if (debounceTimer.current !== null) clearTimeout(debounceTimer.current)
    if (slowTimer.current !== null) clearTimeout(slowTimer.current)
    debounceTimer.current = null
    slowTimer.current = null
  }, [])

  const abort = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    clearTimers()
  }, [clearTimers])

  useEffect(() => () => abort(), [abort])

  const fire = useCallback(async (query: string) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const startedAt = Date.now()

    setState({ kind: 'searching', query, elapsedMs: 0 })

    slowTimer.current = setTimeout(() => {
      setState({
        kind: 'slow',
        query,
        elapsedSec: (Date.now() - startedAt) / 1000,
        prev: lastResults.current,
      })
    }, SLOW_AFTER_MS)

    try {
      const res = await fetch('/api/intake/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ q: query }),
        signal: controller.signal,
      })
      if (slowTimer.current !== null) clearTimeout(slowTimer.current)
      if (controller.signal.aborted) return
      if (!res.ok) {
        setState({ kind: 'error', query, message: 'Search unavailable' })
        return
      }
      const body = (await res.json()) as { customers: CustomerHit[]; vehicles: VehicleHit[]; latencyMs: number }
      lastResults.current = { customers: body.customers, vehicles: body.vehicles }
      const total = body.customers.length + body.vehicles.length
      if (total === 0) {
        setState({ kind: 'no-match', query, latencyMs: body.latencyMs })
      } else {
        setState({ kind: 'matched', query, customers: body.customers, vehicles: body.vehicles, latencyMs: body.latencyMs })
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      if (slowTimer.current !== null) clearTimeout(slowTimer.current)
      setState({ kind: 'error', query, message: 'Search unavailable' })
    }
  }, [])

  const setQuery = useCallback((q: string) => {
    if (debounceTimer.current !== null) clearTimeout(debounceTimer.current)
    if (q.trim() === '') {
      abort()
      setState({ kind: 'idle' })
      return
    }
    debounceTimer.current = setTimeout(() => { void fire(q) }, DEBOUNCE_MS)
  }, [abort, fire])

  return { state, setQuery, abort }
}
```

- [ ] **Step 4: Run the test, expect pass**

```bash
pnpm test tests/unit/use-intake-search.test.ts
```

Expected: PASS (7 cases).

- [ ] **Step 5: Commit**

```bash
git add lib/intake/use-search.ts tests/unit/use-intake-search.test.ts
git commit -m "feat(intake): add useIntakeSearch hook (debounce, abort, slow-network state)"
```

---

## Task 14: `<PredictiveIntakeSearch>` main component

**Files:**
- Create: `components/vt/intake-search/index.tsx`
- Test: `tests/unit/intake-search-component.test.tsx`

- [ ] **Step 1: Write the failing component test**

Create `tests/unit/intake-search-component.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PredictiveIntakeSearch } from '@/components/vt/intake-search'

const recents = [
  { id: 'c1', name: 'Sandoval', phone: '7705551234', email: null, vehicleCount: 1, lastVisit: new Date() },
  { id: 'c2', name: 'Mendez', phone: '7205557710', email: null, vehicleCount: 2, lastVisit: new Date() },
]

const fetchOk = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))

describe('<PredictiveIntakeSearch>', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.restoreAllMocks()
  })

  it('renders the search bar in resting state', () => {
    render(<PredictiveIntakeSearch recentCustomers={recents} onPickVehicle={vi.fn()} onCreateNew={vi.fn()} />)
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('opens the dropdown with recent customers when the bar is focused', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<PredictiveIntakeSearch recentCustomers={recents} onPickVehicle={vi.fn()} onCreateNew={vi.fn()} />)
    await user.click(screen.getByRole('combobox'))
    expect(screen.getByText('Sandoval')).toBeInTheDocument()
    expect(screen.getByText('Mendez')).toBeInTheDocument()
  })

  it('shows "+ Create new customer" at the bottom of the dropdown', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<PredictiveIntakeSearch recentCustomers={recents} onPickVehicle={vi.fn()} onCreateNew={vi.fn()} />)
    await user.click(screen.getByRole('combobox'))
    expect(screen.getByText(/Create new customer/)).toBeInTheDocument()
  })

  it('navigates rows with arrow keys', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<PredictiveIntakeSearch recentCustomers={recents} onPickVehicle={vi.fn()} onCreateNew={vi.fn()} />)
    const input = screen.getByRole('combobox')
    await user.click(input)
    await user.keyboard('{ArrowDown}')
    expect(input).toHaveAttribute('aria-activedescendant', 'pis-row-1')
    await user.keyboard('{ArrowUp}')
    expect(input).toHaveAttribute('aria-activedescendant', 'pis-row-0')
  })

  it('Enter activates the focused row → onPickVehicle (1-vehicle customer)', async () => {
    const onPick = vi.fn()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    // We don't have vehicle IDs in recents; for this test, swap to a result-state via fetch mock + typed query.
    vi.stubGlobal('fetch', vi.fn(async () => fetchOk({
      customers: [],
      vehicles: [{ id: 'v1', year: 2018, make: 'Ford', model: 'F-150', engine: null, vin: null, plate: null, mileage: null, ownerId: 'c1', ownerName: 'Sandoval', lastVisit: null }],
      latencyMs: 5,
    })))
    render(<PredictiveIntakeSearch recentCustomers={[]} onPickVehicle={onPick} onCreateNew={vi.fn()} />)
    const input = screen.getByRole('combobox')
    await user.click(input)
    await user.type(input, 'f-150')
    await vi.advanceTimersByTimeAsync(200)
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onPick).toHaveBeenCalledWith('v1')
  })

  it('Shift+Enter activates "+ Create new" from anywhere in the list', async () => {
    const onCreate = vi.fn()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<PredictiveIntakeSearch recentCustomers={recents} onPickVehicle={vi.fn()} onCreateNew={onCreate} />)
    const input = screen.getByRole('combobox')
    await user.click(input)
    await user.keyboard('{Shift>}{Enter}{/Shift}')
    expect(onCreate).toHaveBeenCalled()
  })

  it('Escape closes the dropdown', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<PredictiveIntakeSearch recentCustomers={recents} onPickVehicle={vi.fn()} onCreateNew={vi.fn()} />)
    const input = screen.getByRole('combobox')
    await user.click(input)
    expect(screen.queryByText('Sandoval')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByText('Sandoval')).not.toBeInTheDocument()
  })

  it('shows the "which vehicle?" tier when a customer has >1 vehicle', async () => {
    const onPick = vi.fn()
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    vi.stubGlobal('fetch', vi.fn(async () => fetchOk({
      customers: [{ id: 'c1', name: 'Sandoval', phone: null, email: null, vehicleCount: 2, lastVisit: null }],
      vehicles: [
        { id: 'v1', year: 2014, make: 'BMW', model: '335i', engine: null, vin: 'A', plate: null, mileage: null, ownerId: 'c1', ownerName: 'Sandoval', lastVisit: null },
        { id: 'v2', year: 2019, make: 'Honda', model: 'Pilot', engine: null, vin: 'B', plate: null, mileage: null, ownerId: 'c1', ownerName: 'Sandoval', lastVisit: null },
      ],
      latencyMs: 5,
    })))
    render(<PredictiveIntakeSearch recentCustomers={[]} onPickVehicle={onPick} onCreateNew={vi.fn()} />)
    const input = screen.getByRole('combobox')
    await user.type(input, 'sandoval')
    await vi.advanceTimersByTimeAsync(200)
    // pick the customer row (idx 0)
    await user.keyboard('{ArrowDown}{Enter}')
    expect(screen.getByText(/which vehicle/i)).toBeInTheDocument()
    await user.keyboard('{ArrowDown}{Enter}')
    expect(onPick).toHaveBeenCalledWith('v1')
  })
})
```

- [ ] **Step 2: Run the test, expect failure**

```bash
pnpm test tests/unit/intake-search-component.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the main component**

Create `components/vt/intake-search/index.tsx`:

```tsx
'use client'

import { useCallback, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useIntakeSearch } from '@/lib/intake/use-search'
import { tokensToPrefill, type CreateNewPrefill } from '@/lib/intake/tokens-to-prefill'
import { detectInputShape } from '@/lib/intake/input-shape'
import type { RecentCustomer } from '@/lib/intake/recent-customers'
import type { CustomerHit, VehicleHit } from '@/lib/intake/search'
import { Bar } from './bar'
import { DropdownEmpty, DropdownNoMatch, DropdownResults, DropdownSearching, DropdownSlow, DropdownWhichVehicle } from './dropdown'
import './intake-search.css'

export type PredictiveIntakeSearchProps = {
  recentCustomers: RecentCustomer[]
  onPickVehicle: (vehicleId: string) => void
  onCreateNew: (prefill: CreateNewPrefill) => void
}

export function PredictiveIntakeSearch({ recentCustomers, onPickVehicle, onCreateNew }: PredictiveIntakeSearchProps) {
  const [value, setValue] = useState('')
  const [open, setOpen] = useState(false)
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null)
  const [tier, setTier] = useState<{ customer: CustomerHit; vehicles: VehicleHit[] } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownId = useId()

  const { state, setQuery } = useIntakeSearch()

  // Total row count (used for keyboard navigation wraparound).
  const rowCount = useMemo(() => {
    if (tier) return tier.vehicles.length + 1 // + create-new
    if (state.kind === 'matched') return state.customers.length + state.vehicles.length + 1
    if (state.kind === 'no-match' || state.kind === 'slow' || state.kind === 'searching' || state.kind === 'error') return 1 // just create-new
    if (state.kind === 'idle') return Math.min(recentCustomers.length, 5) + 1
    return 1
  }, [state, tier, recentCustomers.length])

  const onInputChange = useCallback((v: string) => {
    setValue(v)
    setQuery(v)
    setOpen(true)
    setFocusedIdx(null)
    if (tier) setTier(null)
  }, [setQuery, tier])

  const fireCreateNew = useCallback(() => {
    const tokens = value.trim().split(/\s+/).filter((t) => t !== '')
    onCreateNew(tokensToPrefill(tokens))
    setOpen(false)
    setFocusedIdx(null)
  }, [value, onCreateNew])

  const pickCustomer = useCallback((c: CustomerHit | RecentCustomer) => {
    if (c.vehicleCount === 0) {
      // No vehicle on file — fall through to create-new with the customer's data
      onCreateNew({ name: c.name, phone: c.phone ?? undefined, email: c.email ?? undefined })
      setOpen(false)
      return
    }
    if (c.vehicleCount === 1) {
      // We need the vehicleId — fetch it. Recents don't include vehicles; bail
      // to create-new tagged with the existing customer for v1 simplicity.
      // For the "matched" path, c is a CustomerHit; we need to find one of its
      // vehicles in the matched results.
      if ('id' in c && state.kind === 'matched') {
        const ownVehicle = state.vehicles.find((v) => v.ownerId === c.id)
        if (ownVehicle) {
          onPickVehicle(ownVehicle.id)
          setOpen(false)
          return
        }
      }
      // Fallback: create-new with customer data (edge case, e.g. recents path with single vehicle).
      onCreateNew({ name: c.name, phone: c.phone ?? undefined, email: c.email ?? undefined })
      setOpen(false)
      return
    }
    // 2+ vehicles → tier
    if (state.kind === 'matched') {
      const owned = state.vehicles.filter((v) => v.ownerId === ('id' in c ? c.id : ''))
      setTier({ customer: c as CustomerHit, vehicles: owned })
      setFocusedIdx(0)
      return
    }
    // Recents path with multi-vehicle customer — fall through to create-new for v1.
    onCreateNew({ name: c.name, phone: c.phone ?? undefined, email: c.email ?? undefined })
    setOpen(false)
  }, [state, onPickVehicle, onCreateNew])

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (!open) return
    if (e.key === 'Escape') {
      setOpen(false)
      setFocusedIdx(null)
      setTier(null)
      return
    }
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault()
      fireCreateNew()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusedIdx((cur) => {
        if (cur === null) return 0
        return (cur + 1) % rowCount
      })
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusedIdx((cur) => {
        if (cur === null) return rowCount - 1
        return (cur - 1 + rowCount) % rowCount
      })
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (focusedIdx === null) {
        fireCreateNew()
        return
      }
      // Determine what's at focusedIdx based on current view.
      if (tier) {
        if (focusedIdx < tier.vehicles.length) {
          onPickVehicle(tier.vehicles[focusedIdx].id)
          setOpen(false)
        } else {
          // create-new
          onCreateNew({ name: tier.customer.name, phone: tier.customer.phone ?? undefined, email: tier.customer.email ?? undefined })
          setOpen(false)
        }
        return
      }
      if (state.kind === 'matched') {
        const customerCount = state.customers.length
        if (focusedIdx < customerCount) {
          pickCustomer(state.customers[focusedIdx])
        } else if (focusedIdx < customerCount + state.vehicles.length) {
          onPickVehicle(state.vehicles[focusedIdx - customerCount].id)
          setOpen(false)
        } else {
          fireCreateNew()
        }
        return
      }
      if (state.kind === 'idle') {
        if (focusedIdx < Math.min(recentCustomers.length, 5)) {
          pickCustomer(recentCustomers[focusedIdx])
        } else {
          fireCreateNew()
        }
        return
      }
      // no-match / slow / error / searching — only create-new is reachable
      fireCreateNew()
    }
  }, [open, rowCount, focusedIdx, tier, state, recentCustomers, fireCreateNew, onPickVehicle, onCreateNew, pickCustomer])

  const activeDescendantId = useMemo(() => {
    if (focusedIdx === null) return undefined
    if (tier && focusedIdx >= tier.vehicles.length) return 'pis-row-create'
    if (state.kind === 'matched' && focusedIdx >= state.customers.length + state.vehicles.length) return 'pis-row-create'
    if ((state.kind === 'idle' && focusedIdx >= Math.min(recentCustomers.length, 5))) return 'pis-row-create'
    return `pis-row-${focusedIdx}`
  }, [focusedIdx, tier, state, recentCustomers.length])

  const tokens = useMemo(() => value.trim().split(/\s+/).filter((t) => t !== ''), [value])
  const noMatchShape = useMemo(() => detectInputShape(value.trim()), [value])

  return (
    <div className="pis">
      <Bar
        value={value}
        focused={open}
        onChange={onInputChange}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        ariaControls={dropdownId}
        ariaExpanded={open}
        activeDescendant={activeDescendantId}
        inputRef={inputRef}
      />
      {open && (
        <>
          {tier ? (
            <DropdownWhichVehicle
              customerName={tier.customer.name}
              vehicles={tier.vehicles}
              focusedIdx={focusedIdx}
              onBack={() => { setTier(null); setFocusedIdx(null) }}
              onPickVehicle={(v) => { onPickVehicle(v.id); setOpen(false) }}
              onCreateNew={fireCreateNew}
            />
          ) : state.kind === 'idle' && value.trim() === '' ? (
            <DropdownEmpty
              recents={recentCustomers}
              focusedIdx={focusedIdx}
              onPickCustomer={pickCustomer}
              onCreateNew={fireCreateNew}
            />
          ) : state.kind === 'searching' ? (
            <DropdownSearching elapsedMs={state.elapsedMs} onCreateNew={fireCreateNew} focusedIdx={focusedIdx} />
          ) : state.kind === 'slow' ? (
            <DropdownSlow elapsedSec={state.elapsedSec} prev={state.prev} focusedIdx={focusedIdx} onCreateNew={fireCreateNew} />
          ) : state.kind === 'matched' ? (
            <DropdownResults
              customers={state.customers}
              vehicles={state.vehicles}
              latencyMs={state.latencyMs}
              focusedIdx={focusedIdx}
              onPickCustomer={pickCustomer}
              onPickVehicle={(v) => { onPickVehicle(v.id); setOpen(false) }}
              onCreateNew={fireCreateNew}
              highlightTokens={tokens}
            />
          ) : state.kind === 'no-match' ? (
            <DropdownNoMatch query={value} shape={noMatchShape} focusedIdx={focusedIdx} onCreateNew={fireCreateNew} />
          ) : (
            // 'error' fallback — same shape as no-match but with friendlier copy
            <DropdownNoMatch query={value} shape={noMatchShape} focusedIdx={focusedIdx} onCreateNew={fireCreateNew} />
          )}
        </>
      )}
    </div>
  )
}
```

Also create the small `Bar` sub-component file at `components/vt/intake-search/bar.tsx`:

```tsx
import { type Ref, type KeyboardEvent } from 'react'
import { Glyph, Kbd, ScanBtn } from './rows'

export function Bar({
  value,
  focused,
  onChange,
  onFocus,
  onKeyDown,
  ariaControls,
  ariaExpanded,
  activeDescendant,
  inputRef,
}: {
  value: string
  focused: boolean
  onChange: (v: string) => void
  onFocus: () => void
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void
  ariaControls: string
  ariaExpanded: boolean
  activeDescendant?: string
  inputRef: Ref<HTMLInputElement>
}) {
  return (
    <div className={`pis__bar ${focused ? 'pis__bar--focused' : ''}`}>
      <Glyph />
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={ariaExpanded}
        aria-controls={ariaControls}
        aria-autocomplete="list"
        aria-activedescendant={activeDescendant}
        className="pis__input"
        placeholder="Customer name, phone, VIN, plate, year/make/model…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
      />
      <ScanBtn />
      <Kbd>⌘ K</Kbd>
    </div>
  )
}
```

- [ ] **Step 4: Run the test, expect pass**

```bash
pnpm test tests/unit/intake-search-component.test.tsx
```

Expected: PASS (8 cases). Some tests may need slight adjustments around timing — if a test flakes, prefer fixing the test (add `await waitFor(...)`) over loosening behavior in the component.

- [ ] **Step 5: Commit**

```bash
git add components/vt/intake-search/index.tsx components/vt/intake-search/bar.tsx tests/unit/intake-search-component.test.tsx
git commit -m "feat(intake): add PredictiveIntakeSearch component"
```

---

## Task 15: Mount in `/intake` — page + counter-intake integration

**Files:**
- Modify: `app/(app)/intake/page.tsx`
- Modify: `components/screens/counter-intake.tsx`

- [ ] **Step 1: Update the intake page to SSR recent customers**

Replace `app/(app)/intake/page.tsx` with:

```tsx
import { redirect } from 'next/navigation'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile } from '@/lib/auth'
import { getRecentIntakeCustomers } from '@/lib/intake/recent-customers'
import { CounterIntake } from '@/components/screens/counter-intake'

export default async function IntakePage() {
  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) redirect('/sign-in')

  const recentCustomers = ctx.profile.shopId
    ? await getRecentIntakeCustomers({ db, shopId: ctx.profile.shopId, withinHours: 12, limit: 8 })
    : []

  return <CounterIntake userEmail={ctx.user.email} recentCustomers={recentCustomers} />
}
```

- [ ] **Step 2: Update `CounterIntake` to mount the search and accept the new prop**

Open `components/screens/counter-intake.tsx`. Add at the top (after existing imports):

```tsx
import { PredictiveIntakeSearch } from '@/components/vt/intake-search'
import type { RecentCustomer } from '@/lib/intake/recent-customers'
import type { CreateNewPrefill } from '@/lib/intake/tokens-to-prefill'
```

Update the `CounterIntake` component signature:

```tsx
type CounterIntakeProps = {
  userEmail?: string | null
  recentCustomers?: RecentCustomer[]
}

export function CounterIntake({ userEmail, recentCustomers = [] }: CounterIntakeProps) {
```

Inside the component, add three new pieces of state and handlers:

```tsx
const [searchOpen, setSearchOpen] = useState(true)
const router = useRouter()

const handlePickVehicle = useCallback(async (vehicleId: string) => {
  setSearchOpen(false)
  // POST /api/intake/submit with existingVehicleId. The complaint section
  // remains in the form below — the writer types the complaint, then submits.
  // For "pick existing" we pre-populate hidden state and reuse the existing
  // submit handler below — see the form's onSubmit.
  // Implementation: stash the picked vehicleId in component state and let
  // the form's submit path send {existingVehicleId, complaint, vehicle:{mileage}}.
  setPickedVehicleId(vehicleId)
}, [])

const handleCreateNew = useCallback((prefill: CreateNewPrefill) => {
  if (prefill.name) setName(prefill.name)
  if (prefill.phone) setPhone(prefill.phone)
  if (prefill.email) setEmail(prefill.email)
  if (prefill.vin) setVin(prefill.vin)
  if (prefill.year) setYear(String(prefill.year))
  if (prefill.make) setMake(prefill.make)
  if (prefill.plate) setPlate(prefill.plate)
  setSearchOpen(false)
  // Focus the first empty required field. Name first.
  setTimeout(() => nameRef.current?.focus(), 0)
}, [])
```

Render the search above the existing form fields:

```tsx
<PredictiveIntakeSearch
  recentCustomers={recentCustomers}
  onPickVehicle={handlePickVehicle}
  onCreateNew={handleCreateNew}
/>
{pickedVehicleId && (
  <div style={{ padding: '12px 18px', background: 'var(--vt-bone-100)', fontFamily: 'var(--vt-font-serif)', fontStyle: 'italic' }}>
    Picked existing vehicle — type the complaint below and submit to start the ticket.
  </div>
)}
{/* existing form fields continue here */}
```

In the form's submit handler, branch on `pickedVehicleId`:

```tsx
const body = pickedVehicleId
  ? { existingVehicleId: pickedVehicleId, complaint: complaintObj, vehicle: { mileage } }
  : { customer: customerObj, vehicle: vehicleObj, complaint: complaintObj }

const res = await fetch('/api/intake/submit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
```

(The exact handler shape depends on the existing component's structure. Read `components/screens/counter-intake.tsx` first to see how `customerObj`/`vehicleObj`/`complaintObj` are currently built — then inject the conditional cleanly without disturbing the rest.)

Add the `nameRef`:

```tsx
const nameRef = useRef<HTMLInputElement>(null)
// pass nameRef to the Name input: <Input ref={nameRef} ... />
```

If the existing form's name input doesn't already accept a ref, threading one in is part of this task — match the existing pattern (`forwardRef`, `useImperativeHandle`, etc. — whichever the component lib uses).

- [ ] **Step 3: Run the full test suite to confirm nothing regressed**

```bash
pnpm test
```

Expected: all green, including the new tests added in tasks 1–14 and the existing intake tests.

- [ ] **Step 4: Run typecheck + build**

```bash
pnpm exec tsc --noEmit
pnpm build
```

Expected: clean. If typecheck flags missing types between `CreateNewPrefill` / `RecentCustomer` re-exports, add explicit re-exports from `lib/intake/recent-customers.ts` and `lib/intake/tokens-to-prefill.ts`.

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/intake/page.tsx components/screens/counter-intake.tsx
git commit -m "feat(intake): mount PredictiveIntakeSearch on /intake page"
```

---

## Task 16: Integration test — full flow

**Files:**
- Create: `tests/integration/intake-search-flow.test.tsx`

- [ ] **Step 1: Write the integration test**

Create `tests/integration/intake-search-flow.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { setupTestDb, teardownTestDb, type TestDb } from '@/tests/helpers/pglite'
import { customers, vehicles, shops, profiles } from '@/lib/db/schema'

// Mock the AI/retrieval stack so submit doesn't actually call models.
vi.mock('@/lib/ai/tree-engine', () => ({ generateInitialTree: vi.fn(async () => ({ mocked: true })) }))
vi.mock('@/lib/retrieval/orchestrator', () => ({ runRetrieval: vi.fn(async () => []) }))
vi.mock('@/lib/retrieval/validator', () => ({ validateRetrievalResults: vi.fn(async () => []) }))
vi.mock('@/lib/corpus/retrieval', () => ({ retrieveCorpus: vi.fn(async () => []) }))
vi.mock('@/lib/retrieval/wire-into-tree', () => ({ buildGenerateInitialTreeWithRetrieval: () => async () => ({ mocked: true }) }))
vi.mock('@/lib/retrieval/adapters/nhtsa', () => ({ NHTSAAdapter: class {} }))
vi.mock('@/lib/retrieval/adapters/manufacturer-recall', () => ({ ManufacturerRecallAdapter: class {} }))
vi.mock('@/lib/retrieval/adapters/forum', () => ({ ForumAdapter: class {} }))
vi.mock('@/lib/retrieval/adapters/youtube', () => ({ YouTubeAdapter: class {} }))
vi.mock('@/lib/retrieval/adapters/reddit', () => ({ RedditAdapter: class {} }))
vi.mock('@/lib/retrieval/adapters/web-search', () => ({ WebSearchAdapter: class {} }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  redirect: vi.fn(),
}))

let testDb: TestDb
vi.mock('@/lib/db/client', () => ({ get db() { return testDb.db } }))

vi.mock('@/lib/auth', () => ({
  requireUserAndProfile: vi.fn(async () => ({
    profile: { id: 'p1', shopId: 'shop-a', role: 'owner', userId: 'u1', fullName: 'Tech', createdAt: new Date() },
    user: { id: 'u1', email: 'test@example.com' },
  })),
}))
vi.mock('@/lib/supabase-server', () => ({ getServerSupabase: vi.fn(async () => ({})) }))

import { CounterIntake } from '@/components/screens/counter-intake'

async function seed() {
  await testDb.db.insert(shops).values({ id: 'shop-a', name: 'Shop' }).onConflictDoNothing()
  const [tech] = await testDb.db.insert(profiles).values({ id: 'p1', userId: 'u1', shopId: 'shop-a', fullName: 'Tech', role: 'owner' }).returning()
  const [c] = await testDb.db.insert(customers).values({ shopId: 'shop-a', name: 'Existing Sandoval', phone: '7705551234' }).returning()
  const [v] = await testDb.db.insert(vehicles).values({ customerId: c.id, year: 2018, make: 'Ford', model: 'F-150' }).returning()
  return { customer: c, vehicle: v }
}

describe('intake-search end-to-end', () => {
  beforeEach(async () => { testDb = await setupTestDb() })
  afterEach(async () => { await teardownTestDb(testDb); vi.restoreAllMocks() })

  it('picking existing customer → submitting → creates session without duplicating customer/vehicle', async () => {
    const { customer, vehicle } = await seed()
    const user = userEvent.setup()

    // Wire fetch through to the actual route handlers via a tiny shim:
    // intercept /api/intake/search and /api/intake/submit and invoke the route POST.
    const { POST: searchPOST } = await import('@/app/api/intake/search/route')
    const { POST: submitPOST } = await import('@/app/api/intake/submit/route')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      const req = new Request(url, init as RequestInit)
      if (url.endsWith('/api/intake/search')) return searchPOST(req)
      if (url.endsWith('/api/intake/submit')) return submitPOST(req)
      throw new Error(`unmocked fetch ${url}`)
    })

    render(<CounterIntake userEmail="test@example.com" recentCustomers={[]} />)
    const searchInput = screen.getByRole('combobox')
    await user.type(searchInput, 'Sandoval')

    await waitFor(() => expect(screen.getByText(/Existing Sandoval/)).toBeInTheDocument(), { timeout: 2_000 })
    await user.click(screen.getByText(/Existing Sandoval/).closest('button')!)

    // The "picked existing" banner should appear.
    await waitFor(() => expect(screen.getByText(/Picked existing vehicle/)).toBeInTheDocument())

    // Fill in complaint and submit.
    const descriptionInput = screen.getByLabelText(/complaint|description|what brings/i)
    await user.type(descriptionInput, 'engine noise')
    await user.click(screen.getByRole('button', { name: /submit|start|continue/i }))

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled()
    })

    // Verify no new customer/vehicle was inserted.
    const cs = await testDb.db.select().from(customers)
    const vs = await testDb.db.select().from(vehicles)
    expect(cs).toHaveLength(1)
    expect(vs).toHaveLength(1)
  })
})
```

The integration test has more moving parts than a unit test — if it flakes on selectors (labels may not match the existing form's actual label text), adjust the `getByLabelText` regex to match what `CounterIntake` actually renders. The intent of the test is the behavioral assertion at the bottom (no duplicate inserts).

- [ ] **Step 2: Run the test, expect pass**

```bash
pnpm test tests/integration/intake-search-flow.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/intake-search-flow.test.tsx
git commit -m "test(intake): integration test for pick-existing → submit flow"
```

---

## Task 17: Verification

**Files:** none new.

- [ ] **Step 1: Full test suite**

```bash
pnpm test
```

Expected: all green. If any pre-existing test (unrelated to intake) flakes once on cold cache, rerun. Per project memory, vitest fork-pool can show PGlite-closed errors on first run after a fresh shell — rerun before treating as a regression.

- [ ] **Step 2: Typecheck**

```bash
pnpm exec tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Build**

```bash
pnpm build
```

Expected: zero errors. Output bundle should include the new route handlers.

- [ ] **Step 4: Push to staging for Vercel preview**

```bash
git push origin staging
```

Wait for the Vercel deploy. The preview URL is the test surface.

- [ ] **Step 5: Manual walkthrough — laptop**

Open the Vercel preview `/intake` in a desktop browser:

- Search bar visible above the existing form. Theme matches the rest of the app (bone canvas, navy signal accent, Instrument Serif body, JetBrains Mono for VIN/phone/plate, sharp 2–10 px corners).
- Empty state with no recent customers in the last 12 h: shows zero-recents copy + "+ Create new" CTA.
- Empty state with recent customers: shows up to 5; if 6+, "See all N ↓" expands.
- Type a name with multiple matches: Customers section above Vehicles section, owner name on each vehicle row.
- Multi-token: `"smith 2018"` → only rows matching both surface; both tokens highlighted in their fields.
- Type something that doesn't exist: no-match block with input-shape route hint ("Looks like a plate — we'll prefill the License plate field").
- Pick customer with one vehicle: confirmation banner appears, type complaint, submit, route to `/sessions/{id}`. Verify no duplicate customer/vehicle in Supabase.
- Pick customer with multiple vehicles: "which vehicle?" tier shows; pick one → confirmation, submit, route.
- Click "+ Create new" with a phone-shaped query: form below pre-fills phone in phone field.
- Type a 17-char VIN into create-new VIN field: year/make/model/engine arrive pre-filled, flagged decoded.
- DevTools → Network throttling = "Slow 3G". Type a query: status bar transitions to "Still searching · slow network"; "+ Create new" still clickable.
- `⌘ K` from anywhere on `/intake`: focuses search bar.
- `⇧ + ↩` from anywhere in the list: jumps to "+ Create new".

- [ ] **Step 6: Manual walkthrough — iPad (or DevTools tablet width)**

- Same as laptop. Search bar fills surface gutter; camera button visible but disabled.
- On-screen keyboard doesn't overlap results — dropdown scrolls correctly.

- [ ] **Step 7: Manual walkthrough — iPhone (or DevTools mobile width)**

- Search bar visible above the form when resting.
- Tap input → fullscreen takeover; bar pins to top.
- Tap "Cancel" → returns to form unchanged.
- All result rows ≥ 56 px tap target.
- Camera button shows "Scan" placeholder, disabled.

- [ ] **Step 8: Cross-device theme check**

- At every state, the visual is indistinguishable from the rest of the app.
- Navigate to another page (e.g. `/today`, `/sessions/...`) and back — no visible style break between pages.

- [ ] **Step 9: Open a PR via GitHub UI (manual)**

Push is done. Brandon opens the PR on GitHub, reviews, merges to `main`.

---

## Out of scope (do NOT implement)

- Real camera VIN/plate scan (placeholder stays disabled).
- CARFAX / DataOne plate-to-VIN external lookup.
- Global topbar search.
- `pg_trgm` trigram indexes.
- Moving `mileage` out of `vehicles`.
- Unifying "+ New diagnosis" path with this search.

## Open questions (parked — do not block on these)

1. **Mileage location.** `vehicles.mileage` stays as-is for v1; per-visit mileage is a future PR.
2. **"+ New work order" → `sessions`.** The button label vs. the entity it creates is unresolved. Not blocking — search finds customer+vehicle regardless of downstream entity.

---

## Plan self-review notes

Re-checked against the spec:
- Every section of the spec has at least one corresponding task (input-shape, tokens-to-prefill, decode-vin helper + route, search query + route, submit extension, recent-customers, CSS port with token rename, atoms, dropdown shells, hook, main component, page integration, verification).
- No "TBD" / "TODO" / "fill in details" placeholders.
- Types are consistent: `CreateNewPrefill` from `lib/intake/tokens-to-prefill.ts` is the single source; `RecentCustomer` from `recent-customers.ts`; `CustomerHit`/`VehicleHit` from `search.ts`.
- One known soft spot: Task 15's `counter-intake.tsx` modifications depend on the existing form's exact internal structure, which I haven't quoted line-by-line. The implementing agent must read that file before editing — the plan flags this explicitly.
- Schema: confirmed no migrations needed. The note in Task 0 about confirming a clean test suite acts as the migration sanity check.
