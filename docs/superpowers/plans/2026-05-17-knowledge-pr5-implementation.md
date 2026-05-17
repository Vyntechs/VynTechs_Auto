# Vehicle Knowledge Platform — PR 5 (Knowledge Page UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## PR 5 split — 5a (read surface) + 5b (contribution surfaces)

Brandon chose 2026-05-17 to ship PR 5 as two PRs instead of one. This plan covers both; each task notes which PR it belongs to.

- **PR 5a — `feat/knowledge-page-ui` (cut off `staging`).** Tasks 1-12, 21 (nav), and a reduced E2E + verification (tasks 23 read-only + 24). Definition of done = the list page renders, drawer opens, items can be retired + restored. The old PR 2/3 placeholder forms (`paste-form.tsx`, `rich-form.tsx`) stay mounted below the list so Brandon can add items to validate the list view — they are NOT deleted in 5a.
- **PR 5b — `feat/knowledge-contribute-ui` (cut off `staging` AFTER 5a merges).** Tasks 13 (picker), 14 (paste sheet), 15 (review form), 16 (form helpers), 17-20 (4 rich forms), 22 (delete the placeholder forms), full write-side E2E, final verification.

### Task 12 modification for PR 5a

When executing Task 12 in PR 5a, do NOT delete the imports of `KnowledgePasteForm` and `RichKnowledgeForm`. The new list page should render the new list/drawer at the top, then render the old placeholder forms below in a `<section className="vk-interim">` block with a small mono header `"PR 5b contribution UI (interim)"`. PR 5b (Task 22) deletes both the placeholder forms and that interim section in one commit.

### Task ordering for PR 5a (this session)

Execute in this order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 (with the modification above) → 21 → 23 (only the read-side and mobile-viewport tests; skip the form-adding E2E) → 24.

---

**Goal:** Ship the owner-facing UI for the vehicle knowledge platform — list/filter/drawer + 5 contribution surfaces (paste + review + 4 rich forms) + owner-gated nav link — wired to the PR 1–4 backend.

**Architecture:** Next.js 16 App Router. Server Components by default for routes and data-fetching; Client Components only where interaction requires (forms, picker dialog, drawer overlay). Read APIs are 5 new route handlers (`GET /api/knowledge`, `GET/PATCH/DELETE /api/knowledge/[id]`, `POST /api/knowledge/[id]/restore`) using existing `requireCurator()` gate. Visual styles ported from `designs/design_handoff_vehicle_knowledge/vehicle-knowledge.css` (2,050 lines, all `.vk-*` classes, uses only existing `--vt-*` tokens). All 8 content types share one `knowledge_items` table; type discriminator routes form rendering.

**Tech Stack:** Next.js 16 · React 19 · TypeScript · Drizzle ORM · Supabase Postgres + Storage · Zod · Anthropic Claude Haiku (already-wired AI helpers from PR 2/3) · Vitest (PGlite) · Playwright (E2E) · pnpm.

---

## Open decisions (resolved as v1 defaults — flag in approval message)

1. **AI source spans (Spec OQ #1):** v1 holds spans in client-only React state during Review. No `ai_sources` column on `knowledge_items`. Edited fields clear spans (already correct behavior since spans never persist). Drawer doesn't show retrospective source spans. Promote to a JSONB column in v2 if Brandon wants the per-item audit trail in the drawer.
2. **Drawer routing:** URL query param `?detail=<id>` over Parallel Routes. Server reads `searchParams.detail` and passes the item to a `<KnowledgeDrawer>` client component that renders nothing when the param is absent. Sharable URLs work, no route layout duplication.
3. **Retire 24h window:** `retired = true` + `retired_at = now()` on retire. List query treats retired items as still-visible if `retired_at > now() - 24h`. After 24h the default list filter excludes them. The drawer's "Restore" button is shown only inside the 24h window.
4. **Restore endpoint:** sets `retired = false`, clears `retired_at` and `retired_by_user_id`. No event log row in v1.
5. **List filters (v1):** `status` (active | drafts | retired | all), `type` (one of 8), `system` (one of 20 system codes), `dtc` (string), `symptom` (string), `vehicleMake` + `vehicleModel` + `vehicleYear` (free-text vehicle filter). NO free-text full-text search across title/body in v1 — the search input filters client-side over the visible page (per spec: "v1: structured filters only; trigram is v2"). Cap result rows at 200; pagination is v2.
6. **Fire count UI:** read directly from `knowledge_items.fire_count` column (already incremented by PR 4's retrieval). Format: `"fired Nx"` when N > 0, omitted when N = 0.
7. **Status pill values surfaced in UI:** `active` (no pill), `draft` (mono "DRAFT" pill), `retired` (mono "RETIRED" pill). "Draft" is a future-state in PR 5 — Save Draft button on review/forms sets a `draft` row, but for v1 the schema has no `status` column. Decision: defer "Save Draft" wiring to v2; the button renders but is disabled with a tooltip "Drafts ship in v2". This keeps the visual surface complete without a schema change.

**If any of these are wrong, Brandon flags before execution.**

---

## File structure

### Files created (~32)

- `lib/knowledge/constants.ts` — TYPE_LABELS, TYPE_SHORT, SYSTEM_CODES (extracted from `SampleData.jsx`)
- `lib/knowledge/list.ts` + `lib/knowledge/list.test.ts` — list query with filters
- `lib/knowledge/get-item.ts` + `.test.ts` — fetch one item + its vehicle scopes
- `lib/knowledge/update-item.ts` + `.test.ts` — edit existing item (re-validates via KnowledgeSaveSchema)
- `lib/knowledge/retire-item.ts` + `.test.ts` — soft retire (sets retired flag + timestamp)
- `lib/knowledge/restore-item.ts` + `.test.ts` — undo retire within 24h
- `app/api/knowledge/route.ts` + `route.test.ts` — `GET /api/knowledge`
- `app/api/knowledge/[id]/route.ts` + `route.test.ts` — `GET`/`PATCH`/`DELETE`
- `app/api/knowledge/[id]/restore/route.ts` + `route.test.ts` — `POST`
- `components/knowledge/knowledge.css` — ported from `vehicle-knowledge.css` (drop `@import`, drop `.vk-root` overflow/height harness)
- `components/knowledge/glyph.tsx` — 8 type glyph marks (SVG, 1.25px stroke)
- `components/knowledge/row.tsx` — knowledge list row (server)
- `components/knowledge/filter-bar.tsx` — filter chips + search (client; reads/writes URL params)
- `components/knowledge/add-picker.tsx` — type picker dialog (client; phone = bottom sheet)
- `components/knowledge/paste-sheet.tsx` — paste + AI sort UI (client)
- `components/knowledge/drawer.tsx` — card detail drawer (client; ownerMode prop)
- `components/knowledge/empty-state.tsx` — no-items affordance (server)
- `app/(app)/knowledge/[id]/review/page.tsx` + `review-form.tsx` — review pre-filled simple-type proposal
- `app/(app)/knowledge/new/pinout/page.tsx` + `pinout-form.tsx`
- `app/(app)/knowledge/new/connector/page.tsx` + `connector-form.tsx`
- `app/(app)/knowledge/new/wiring/page.tsx` + `wiring-form.tsx`
- `app/(app)/knowledge/new/theory/page.tsx` + `theory-form.tsx`
- `tests/e2e/knowledge.spec.ts` — owner happy-path + tech 403 + mobile viewport

### Files modified (~3)

- `app/(app)/knowledge/page.tsx` — replace placeholder with real list page
- `app/globals.css` — `@import` the new `knowledge.css`
- `components/screens/today-home.tsx` — add owner-gated `/knowledge` link next to `/curator`

### Files deleted (2)

- `app/(app)/knowledge/paste-form.tsx` — placeholder superseded by paste-sheet.tsx
- `app/(app)/knowledge/rich-form.tsx` — placeholder superseded by per-type pages

---

## Conventions used throughout

- **Server vs client:** Pages are Server Components unless they need state/effects. Forms are Client Components. The Drawer is a Client Component because it manages an open/closed UI state via URL param + animation classes.
- **Data fetching:** Server Components call `lib/knowledge/*` directly (Drizzle). API routes exist for client-side mutations and refetches (drawer edit/retire/restore).
- **Validation:** All POST/PATCH bodies validated by Zod schemas reused from `lib/knowledge/save.ts` (`KnowledgeSaveSchema`). New PATCH schema is a partial of it.
- **Owner gate:** Server pages call `canCurate(profile.role)` and redirect to `/` if false. API routes call `requireCurator()` (returns 403). Both already exist.
- **CSS:** All new visuals use `.vk-*` classes from `components/knowledge/knowledge.css`. Existing primitives (`Module`, `Pill`, `DtcChip`, `AppHeader`) are reused as-is; do NOT introduce duplicates.
- **Commits:** Per-task conventional commits. Co-author trailer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- **TDD:** API + lib code is test-first. UI components are build-then-verify (per kickoff: "visual rendering doesn't get unit tests — that's E2E territory"). E2E spec is the last task.

---

# Phase A — CSS foundation

### Task 1: Port `vehicle-knowledge.css` into the codebase

**Files:**
- Create: `components/knowledge/knowledge.css`
- Modify: `app/globals.css` (one new `@import` line)

The design CSS in `designs/design_handoff_vehicle_knowledge/vehicle-knowledge.css` is 2,050 lines, already uses only existing `--vt-*` tokens. We copy it verbatim except for two changes:
1. Drop the first line `@import url("reference/colors_and_type.css");` — those tokens already live in `app/globals.css`.
2. Drop the `.vk-root` height/overflow harness (lines roughly 17–27 — see step 2 for verification). The harness exists because the design canvas needs to scroll within an iframe; our app routes don't need it.

- [ ] **Step 1: Copy the CSS file with two edits**

```bash
cp designs/design_handoff_vehicle_knowledge/vehicle-knowledge.css components/knowledge/knowledge.css
```

Then open `components/knowledge/knowledge.css` and:
- Delete the `@import url("reference/colors_and_type.css");` line.
- Find the `.vk-root { ... }` block (near top) and delete the `height: 100%;` and `overflow: hidden;` declarations (keep the rest of the block — the typography defaults are useful).

- [ ] **Step 2: Add the import to globals.css**

In `app/globals.css`, find the existing `@import` block (near top of file) and add at the end:

```css
@import './components-knowledge.css';
```

Wait — the import path needs to be from `app/globals.css` perspective. Move the file or import via relative path. Simplest: keep `components/knowledge/knowledge.css` and import via:

```css
/* in app/globals.css, after existing @import lines */
@import '../components/knowledge/knowledge.css';
```

If your build uses CSS modules / different import strategy, check how `components/vt/vt.css` is imported (likely via component file). In that case, instead create a placeholder import file: in `components/knowledge/index.ts` add `import './knowledge.css'` and import that index from a top-level layout if needed.

- [ ] **Step 3: Verify globally available**

```bash
pnpm exec tsc --noEmit
pnpm build 2>&1 | tail -20
```

Expected: no TS errors; build succeeds. (CSS errors at build-time print clearly.)

- [ ] **Step 4: Commit**

```bash
git add components/knowledge/knowledge.css app/globals.css
git commit -m "feat(knowledge-ui): port vehicle-knowledge.css into the codebase (PR 5 task 1)"
```

---

# Phase B — Read APIs + lib functions (TDD)

These five tasks build the data-access layer that the UI calls.

### Task 2: `lib/knowledge/list.ts` — query with filters

**Files:**
- Create: `lib/knowledge/list.ts`
- Test: `tests/unit/knowledge-list.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/knowledge-list.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestDb, teardownTestDb, type TestDb } from '../helpers/test-db'
import { knowledgeItems, knowledgeItemVehicles } from '@/lib/db/schema'
import { listKnowledgeItems, type KnowledgeListFilter } from '@/lib/knowledge/list'

describe('listKnowledgeItems', () => {
  let testDb: TestDb
  beforeEach(async () => {
    testDb = await setupTestDb()
  })
  afterEach(async () => {
    await teardownTestDb(testDb)
  })

  async function seed(shopId: string, userId: string) {
    const [a] = await testDb.db.insert(knowledgeItems).values({
      shopId, type: 'cause_fix', title: 'Hard shift on 6.4 Powerstroke',
      dtcList: ['P0700'], systemCodes: ['transmission'], symptoms: ['hard_shift'],
      createdByUserId: userId,
    }).returning()
    const [b] = await testDb.db.insert(knowledgeItems).values({
      shopId, type: 'pinout', title: 'Alternator 4-pin pinout',
      dtcList: ['P0562'], systemCodes: ['charging'], symptoms: [],
      createdByUserId: userId,
    }).returning()
    const [c] = await testDb.db.insert(knowledgeItems).values({
      shopId, type: 'note', title: 'Old retired note',
      retired: true, retiredAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      createdByUserId: userId,
    }).returning()
    await testDb.db.insert(knowledgeItemVehicles).values({
      knowledgeItemId: a.id, yearStart: 2008, yearEnd: 2010, make: 'Ford', model: 'F-250',
    })
    return { a, b, c }
  }

  it('returns active items only by default', async () => {
    const { a, b } = await seed(testDb.shopId, testDb.userId)
    const rows = await listKnowledgeItems(testDb.db, { shopId: testDb.shopId, filter: {} })
    expect(rows.map(r => r.id).sort()).toEqual([a.id, b.id].sort())
  })

  it('filters by type', async () => {
    const { b } = await seed(testDb.shopId, testDb.userId)
    const rows = await listKnowledgeItems(testDb.db, {
      shopId: testDb.shopId, filter: { type: 'pinout' },
    })
    expect(rows.map(r => r.id)).toEqual([b.id])
  })

  it('filters by dtc', async () => {
    const { a } = await seed(testDb.shopId, testDb.userId)
    const rows = await listKnowledgeItems(testDb.db, {
      shopId: testDb.shopId, filter: { dtc: 'P0700' },
    })
    expect(rows.map(r => r.id)).toEqual([a.id])
  })

  it('filters by systemCode', async () => {
    const { b } = await seed(testDb.shopId, testDb.userId)
    const rows = await listKnowledgeItems(testDb.db, {
      shopId: testDb.shopId, filter: { systemCode: 'charging' },
    })
    expect(rows.map(r => r.id)).toEqual([b.id])
  })

  it('filters by vehicle make', async () => {
    const { a } = await seed(testDb.shopId, testDb.userId)
    const rows = await listKnowledgeItems(testDb.db, {
      shopId: testDb.shopId, filter: { vehicleMake: 'Ford' },
    })
    expect(rows.map(r => r.id)).toEqual([a.id])
  })

  it('hides items retired > 24h ago when status filter omitted', async () => {
    const { c } = await seed(testDb.shopId, testDb.userId)
    const rows = await listKnowledgeItems(testDb.db, { shopId: testDb.shopId, filter: {} })
    expect(rows.map(r => r.id)).not.toContain(c.id)
  })

  it('returns retired items when status = retired', async () => {
    const { c } = await seed(testDb.shopId, testDb.userId)
    const rows = await listKnowledgeItems(testDb.db, {
      shopId: testDb.shopId, filter: { status: 'retired' },
    })
    expect(rows.map(r => r.id)).toEqual([c.id])
  })

  it('isolates by shop (cannot see other shops)', async () => {
    const { a } = await seed(testDb.shopId, testDb.userId)
    const otherShop = await testDb.createShop('Other Shop')
    const rows = await listKnowledgeItems(testDb.db, { shopId: otherShop.shopId, filter: {} })
    expect(rows.map(r => r.id)).not.toContain(a.id)
  })
})
```

- [ ] **Step 2: Run, expect failure**

```bash
pnpm test tests/unit/knowledge-list.test.ts
```

Expected: FAIL — `Cannot find module '@/lib/knowledge/list'`.

- [ ] **Step 3: Implement `lib/knowledge/list.ts`**

```typescript
import { and, desc, eq, exists, gte, inArray, sql } from 'drizzle-orm'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import { knowledgeItems, knowledgeItemVehicles, type KnowledgeItem } from '@/lib/db/schema'

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000

export type KnowledgeListFilter = {
  type?: KnowledgeItem['type']
  dtc?: string
  systemCode?: string
  symptom?: string
  vehicleMake?: string
  vehicleModel?: string
  vehicleYear?: number
  status?: 'active' | 'retired' | 'all'
}

export type KnowledgeListRow = KnowledgeItem & {
  vehicleScopes: Array<{
    yearStart: number
    yearEnd: number
    make: string
    model: string | null
    engine: string | null
    trim: string | null
  }>
}

export async function listKnowledgeItems(
  // biome-ignore lint: db type is project-wide
  db: PgDatabase<any, any, any>,
  args: { shopId: string; filter: KnowledgeListFilter; limit?: number },
): Promise<KnowledgeListRow[]> {
  const { shopId, filter, limit = 200 } = args
  const status = filter.status ?? 'active'
  const cutoff = new Date(Date.now() - TWENTY_FOUR_HOURS_MS)

  const conditions = [eq(knowledgeItems.shopId, shopId)]

  if (status === 'active') {
    // Active OR retired within last 24h
    conditions.push(
      sql`(${knowledgeItems.retired} = false OR ${knowledgeItems.retiredAt} >= ${cutoff})`,
    )
  } else if (status === 'retired') {
    conditions.push(eq(knowledgeItems.retired, true))
  }
  // status === 'all' → no retired condition

  if (filter.type) conditions.push(eq(knowledgeItems.type, filter.type))
  if (filter.dtc) {
    conditions.push(sql`${filter.dtc} = ANY(${knowledgeItems.dtcList})`)
  }
  if (filter.systemCode) {
    conditions.push(sql`${filter.systemCode} = ANY(${knowledgeItems.systemCodes})`)
  }
  if (filter.symptom) {
    conditions.push(sql`${filter.symptom} = ANY(${knowledgeItems.symptoms})`)
  }

  if (filter.vehicleMake || filter.vehicleModel || filter.vehicleYear) {
    const vehicleConds = []
    if (filter.vehicleMake) vehicleConds.push(eq(knowledgeItemVehicles.make, filter.vehicleMake))
    if (filter.vehicleModel) vehicleConds.push(eq(knowledgeItemVehicles.model, filter.vehicleModel))
    if (filter.vehicleYear) {
      vehicleConds.push(
        and(
          gte(knowledgeItemVehicles.yearStart, 0),
          sql`${knowledgeItemVehicles.yearStart} <= ${filter.vehicleYear}`,
          sql`${knowledgeItemVehicles.yearEnd} >= ${filter.vehicleYear}`,
        )!,
      )
    }
    conditions.push(
      exists(
        db
          .select({ one: sql<number>`1` })
          .from(knowledgeItemVehicles)
          .where(
            and(
              eq(knowledgeItemVehicles.knowledgeItemId, knowledgeItems.id),
              ...vehicleConds,
            ),
          ),
      ),
    )
  }

  const items = await db
    .select()
    .from(knowledgeItems)
    .where(and(...conditions))
    .orderBy(desc(knowledgeItems.updatedAt))
    .limit(limit)

  if (items.length === 0) return []

  const scopes = await db
    .select()
    .from(knowledgeItemVehicles)
    .where(inArray(knowledgeItemVehicles.knowledgeItemId, items.map(i => i.id)))

  const scopesByItem = new Map<string, KnowledgeListRow['vehicleScopes']>()
  for (const s of scopes) {
    const arr = scopesByItem.get(s.knowledgeItemId) ?? []
    arr.push({
      yearStart: s.yearStart,
      yearEnd: s.yearEnd,
      make: s.make,
      model: s.model,
      engine: s.engine,
      trim: s.trim,
    })
    scopesByItem.set(s.knowledgeItemId, arr)
  }

  return items.map(item => ({
    ...item,
    vehicleScopes: scopesByItem.get(item.id) ?? [],
  }))
}
```

- [ ] **Step 4: Verify helpers exist (test-db.ts may need an extension for `createShop`)**

Run:

```bash
grep -n 'createShop' tests/helpers/test-db.ts || echo 'MISSING'
```

If MISSING, open `tests/helpers/test-db.ts` and look at the existing pattern for how a test shop+user are created. Add a method `createShop(name: string)` that mirrors the shop creation flow and returns `{ shopId: string }`. This is needed for the shop-isolation test. (If the helper has a different name, adapt the test to use it.)

- [ ] **Step 5: Run tests, expect green**

```bash
pnpm test tests/unit/knowledge-list.test.ts
```

Expected: all 8 tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/knowledge/list.ts tests/unit/knowledge-list.test.ts
# also commit any test-db.ts helper additions
git add tests/helpers/test-db.ts 2>/dev/null || true
git commit -m "feat(knowledge-ui): listKnowledgeItems lib fn + tests (PR 5 task 2)"
```

---

### Task 3: `lib/knowledge/get-item.ts` — fetch one item with scopes

**Files:**
- Create: `lib/knowledge/get-item.ts`
- Test: `tests/unit/knowledge-get-item.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupTestDb, teardownTestDb, type TestDb } from '../helpers/test-db'
import { knowledgeItems, knowledgeItemVehicles } from '@/lib/db/schema'
import { getKnowledgeItem } from '@/lib/knowledge/get-item'

describe('getKnowledgeItem', () => {
  let testDb: TestDb
  beforeEach(async () => { testDb = await setupTestDb() })
  afterEach(async () => { await teardownTestDb(testDb) })

  it('returns item with its vehicle scopes', async () => {
    const [item] = await testDb.db.insert(knowledgeItems).values({
      shopId: testDb.shopId, type: 'cause_fix', title: 'Test', createdByUserId: testDb.userId,
    }).returning()
    await testDb.db.insert(knowledgeItemVehicles).values({
      knowledgeItemId: item.id, yearStart: 2017, yearEnd: 2019, make: 'Ford', model: 'F-250',
    })
    const row = await getKnowledgeItem(testDb.db, { id: item.id, shopId: testDb.shopId })
    expect(row?.id).toBe(item.id)
    expect(row?.vehicleScopes).toHaveLength(1)
    expect(row?.vehicleScopes[0].make).toBe('Ford')
  })

  it('returns null when item belongs to another shop', async () => {
    const [item] = await testDb.db.insert(knowledgeItems).values({
      shopId: testDb.shopId, type: 'note', title: 'Mine', createdByUserId: testDb.userId,
    }).returning()
    const other = await testDb.createShop('Other')
    const row = await getKnowledgeItem(testDb.db, { id: item.id, shopId: other.shopId })
    expect(row).toBeNull()
  })

  it('returns null for non-existent id', async () => {
    const row = await getKnowledgeItem(testDb.db, {
      id: '00000000-0000-0000-0000-000000000000', shopId: testDb.shopId,
    })
    expect(row).toBeNull()
  })
})
```

- [ ] **Step 2: Run, expect failure**

```bash
pnpm test tests/unit/knowledge-get-item.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```typescript
// lib/knowledge/get-item.ts
import { and, eq } from 'drizzle-orm'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import { knowledgeItems, knowledgeItemVehicles } from '@/lib/db/schema'
import type { KnowledgeListRow } from './list'

export async function getKnowledgeItem(
  // biome-ignore lint: db type is project-wide
  db: PgDatabase<any, any, any>,
  args: { id: string; shopId: string },
): Promise<KnowledgeListRow | null> {
  const [item] = await db
    .select()
    .from(knowledgeItems)
    .where(and(eq(knowledgeItems.id, args.id), eq(knowledgeItems.shopId, args.shopId)))
    .limit(1)

  if (!item) return null

  const scopes = await db
    .select()
    .from(knowledgeItemVehicles)
    .where(eq(knowledgeItemVehicles.knowledgeItemId, item.id))

  return {
    ...item,
    vehicleScopes: scopes.map(s => ({
      yearStart: s.yearStart,
      yearEnd: s.yearEnd,
      make: s.make,
      model: s.model,
      engine: s.engine,
      trim: s.trim,
    })),
  }
}
```

- [ ] **Step 4: Run, expect green**

```bash
pnpm test tests/unit/knowledge-get-item.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/knowledge/get-item.ts tests/unit/knowledge-get-item.test.ts
git commit -m "feat(knowledge-ui): getKnowledgeItem lib fn + tests (PR 5 task 3)"
```

---

### Task 4: `lib/knowledge/update-item.ts` — edit an existing item

**Files:**
- Create: `lib/knowledge/update-item.ts`
- Test: `tests/unit/knowledge-update-item.test.ts`

The PATCH semantics: re-validate the full item with `KnowledgeSaveSchema`, then update the row + replace its vehicle scopes (delete old, insert new). Reusing the save schema keeps validation consistent.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupTestDb, teardownTestDb, type TestDb } from '../helpers/test-db'
import { knowledgeItems, knowledgeItemVehicles } from '@/lib/db/schema'
import { updateKnowledgeItem } from '@/lib/knowledge/update-item'
import { eq } from 'drizzle-orm'

describe('updateKnowledgeItem', () => {
  let testDb: TestDb
  beforeEach(async () => { testDb = await setupTestDb() })
  afterEach(async () => { await teardownTestDb(testDb) })

  it('updates the row and replaces vehicle scopes', async () => {
    const [item] = await testDb.db.insert(knowledgeItems).values({
      shopId: testDb.shopId, type: 'cause_fix', title: 'Original',
      structuredData: { cause: 'old', correction: 'old fix' },
      createdByUserId: testDb.userId,
    }).returning()
    await testDb.db.insert(knowledgeItemVehicles).values({
      knowledgeItemId: item.id, yearStart: 2010, yearEnd: 2012, make: 'GM',
    })

    await updateKnowledgeItem(
      testDb.db,
      { id: item.id, shopId: testDb.shopId },
      {
        type: 'cause_fix',
        title: 'Updated title',
        structuredData: { cause: 'new cause', correction: 'new fix' },
        vehicleScopes: [{ yearStart: 2017, yearEnd: 2019, make: 'Ford', model: 'F-250' }],
      },
    )

    const [updated] = await testDb.db
      .select().from(knowledgeItems).where(eq(knowledgeItems.id, item.id))
    expect(updated.title).toBe('Updated title')
    const scopes = await testDb.db
      .select().from(knowledgeItemVehicles)
      .where(eq(knowledgeItemVehicles.knowledgeItemId, item.id))
    expect(scopes).toHaveLength(1)
    expect(scopes[0].make).toBe('Ford')
  })

  it('throws on cross-shop access', async () => {
    const [item] = await testDb.db.insert(knowledgeItems).values({
      shopId: testDb.shopId, type: 'note', title: 'Mine',
      body: 'old', createdByUserId: testDb.userId,
    }).returning()
    const other = await testDb.createShop('Other')

    await expect(
      updateKnowledgeItem(
        testDb.db, { id: item.id, shopId: other.shopId },
        { type: 'note', title: 'Hijack', body: 'new' },
      ),
    ).rejects.toThrow(/not found/)
  })

  it('bumps updated_at', async () => {
    const [item] = await testDb.db.insert(knowledgeItems).values({
      shopId: testDb.shopId, type: 'note', title: 'T', body: 'b', createdByUserId: testDb.userId,
    }).returning()
    const originalUpdatedAt = item.updatedAt
    await new Promise(r => setTimeout(r, 10))

    await updateKnowledgeItem(
      testDb.db, { id: item.id, shopId: testDb.shopId },
      { type: 'note', title: 'T2', body: 'b2' },
    )

    const [refreshed] = await testDb.db
      .select().from(knowledgeItems).where(eq(knowledgeItems.id, item.id))
    expect(refreshed.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime())
  })
})
```

- [ ] **Step 2: Run, expect failure**

```bash
pnpm test tests/unit/knowledge-update-item.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```typescript
// lib/knowledge/update-item.ts
import { and, eq } from 'drizzle-orm'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import {
  knowledgeItems, knowledgeItemVehicles,
  type NewKnowledgeItemVehicle,
} from '@/lib/db/schema'
import { KnowledgeSaveSchema, type KnowledgeSaveInput } from './save'
import { normalizeDtc, normalizeEngine } from './normalize'

export async function updateKnowledgeItem(
  // biome-ignore lint: db type is project-wide
  db: PgDatabase<any, any, any>,
  args: { id: string; shopId: string },
  input: KnowledgeSaveInput,
): Promise<void> {
  KnowledgeSaveSchema.parse(input) // throws if invalid

  const normalizedDtcs = Array.from(
    new Set(
      (input.dtcList ?? [])
        .map(d => normalizeDtc(d))
        .filter((d): d is string => d !== null),
    ),
  )

  await db.transaction(async tx => {
    const result = await tx
      .update(knowledgeItems)
      .set({
        type: input.type,
        title: input.title.trim(),
        body: 'body' in input && typeof input.body === 'string' ? input.body : null,
        structuredData:
          'structuredData' in input && input.structuredData
            ? (input.structuredData as Record<string, unknown>)
            : null,
        dtcList: normalizedDtcs,
        systemCodes: input.systemCodes ?? [],
        symptoms: input.symptoms ?? [],
        relatedItemIds: input.relatedItemIds ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(knowledgeItems.id, args.id), eq(knowledgeItems.shopId, args.shopId)))
      .returning({ id: knowledgeItems.id })

    if (result.length === 0) {
      throw new Error(`knowledge item not found or not owned by shop: ${args.id}`)
    }

    // Replace vehicle scopes wholesale.
    await tx.delete(knowledgeItemVehicles).where(eq(knowledgeItemVehicles.knowledgeItemId, args.id))
    if (input.vehicleScopes && input.vehicleScopes.length > 0) {
      const rows: NewKnowledgeItemVehicle[] = input.vehicleScopes.map(s => ({
        knowledgeItemId: args.id,
        yearStart: s.yearStart,
        yearEnd: s.yearEnd,
        make: s.make.trim(),
        model: s.model?.trim() ?? null,
        engine: normalizeEngine(s.engine ?? null),
        trim: s.trim?.trim() ?? null,
        drivetrain: s.drivetrain?.trim() ?? null,
        buildDateAfter: s.buildDateAfter ? new Date(s.buildDateAfter) : null,
        buildDateBefore: s.buildDateBefore ? new Date(s.buildDateBefore) : null,
        extraQualifiers: s.extraQualifiers ?? null,
      }))
      await tx.insert(knowledgeItemVehicles).values(rows)
    }
  })
}
```

- [ ] **Step 4: Run, expect green**

```bash
pnpm test tests/unit/knowledge-update-item.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/knowledge/update-item.ts tests/unit/knowledge-update-item.test.ts
git commit -m "feat(knowledge-ui): updateKnowledgeItem lib fn + tests (PR 5 task 4)"
```

---

### Task 5: `lib/knowledge/retire-item.ts` + `restore-item.ts`

Combine into one task; they're symmetric.

**Files:**
- Create: `lib/knowledge/retire-item.ts`, `lib/knowledge/restore-item.ts`
- Test: `tests/unit/knowledge-retire-restore.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupTestDb, teardownTestDb, type TestDb } from '../helpers/test-db'
import { knowledgeItems } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { retireKnowledgeItem } from '@/lib/knowledge/retire-item'
import { restoreKnowledgeItem } from '@/lib/knowledge/restore-item'

describe('retireKnowledgeItem', () => {
  let testDb: TestDb
  beforeEach(async () => { testDb = await setupTestDb() })
  afterEach(async () => { await teardownTestDb(testDb) })

  it('marks the item retired with timestamp + user', async () => {
    const [item] = await testDb.db.insert(knowledgeItems).values({
      shopId: testDb.shopId, type: 'note', title: 'T', body: 'b', createdByUserId: testDb.userId,
    }).returning()
    await retireKnowledgeItem(testDb.db, {
      id: item.id, shopId: testDb.shopId, retiredByUserId: testDb.userId,
    })
    const [row] = await testDb.db.select().from(knowledgeItems).where(eq(knowledgeItems.id, item.id))
    expect(row.retired).toBe(true)
    expect(row.retiredAt).toBeTruthy()
    expect(row.retiredByUserId).toBe(testDb.userId)
  })

  it('throws on cross-shop access', async () => {
    const [item] = await testDb.db.insert(knowledgeItems).values({
      shopId: testDb.shopId, type: 'note', title: 'Mine', body: 'b', createdByUserId: testDb.userId,
    }).returning()
    const other = await testDb.createShop('Other')
    await expect(
      retireKnowledgeItem(testDb.db, {
        id: item.id, shopId: other.shopId, retiredByUserId: testDb.userId,
      }),
    ).rejects.toThrow(/not found/)
  })
})

describe('restoreKnowledgeItem', () => {
  let testDb: TestDb
  beforeEach(async () => { testDb = await setupTestDb() })
  afterEach(async () => { await teardownTestDb(testDb) })

  it('clears retired flag + timestamp when within 24h window', async () => {
    const [item] = await testDb.db.insert(knowledgeItems).values({
      shopId: testDb.shopId, type: 'note', title: 'T', body: 'b',
      retired: true, retiredAt: new Date(Date.now() - 60 * 60 * 1000),
      retiredByUserId: testDb.userId, createdByUserId: testDb.userId,
    }).returning()
    await restoreKnowledgeItem(testDb.db, { id: item.id, shopId: testDb.shopId })
    const [row] = await testDb.db.select().from(knowledgeItems).where(eq(knowledgeItems.id, item.id))
    expect(row.retired).toBe(false)
    expect(row.retiredAt).toBeNull()
    expect(row.retiredByUserId).toBeNull()
  })

  it('throws when retired more than 24h ago', async () => {
    const [item] = await testDb.db.insert(knowledgeItems).values({
      shopId: testDb.shopId, type: 'note', title: 'T', body: 'b',
      retired: true, retiredAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      retiredByUserId: testDb.userId, createdByUserId: testDb.userId,
    }).returning()
    await expect(
      restoreKnowledgeItem(testDb.db, { id: item.id, shopId: testDb.shopId }),
    ).rejects.toThrow(/24h restore window/)
  })

  it('throws when item is not retired', async () => {
    const [item] = await testDb.db.insert(knowledgeItems).values({
      shopId: testDb.shopId, type: 'note', title: 'T', body: 'b', createdByUserId: testDb.userId,
    }).returning()
    await expect(
      restoreKnowledgeItem(testDb.db, { id: item.id, shopId: testDb.shopId }),
    ).rejects.toThrow(/not retired/)
  })
})
```

- [ ] **Step 2: Run, expect failure**

```bash
pnpm test tests/unit/knowledge-retire-restore.test.ts
```

Expected: FAIL — modules missing.

- [ ] **Step 3: Implement `retire-item.ts`**

```typescript
// lib/knowledge/retire-item.ts
import { and, eq } from 'drizzle-orm'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import { knowledgeItems } from '@/lib/db/schema'

export async function retireKnowledgeItem(
  // biome-ignore lint: db type is project-wide
  db: PgDatabase<any, any, any>,
  args: { id: string; shopId: string; retiredByUserId: string },
): Promise<void> {
  const result = await db
    .update(knowledgeItems)
    .set({
      retired: true,
      retiredAt: new Date(),
      retiredByUserId: args.retiredByUserId,
      updatedAt: new Date(),
    })
    .where(and(eq(knowledgeItems.id, args.id), eq(knowledgeItems.shopId, args.shopId)))
    .returning({ id: knowledgeItems.id })

  if (result.length === 0) {
    throw new Error(`knowledge item not found or not owned by shop: ${args.id}`)
  }
}
```

- [ ] **Step 4: Implement `restore-item.ts`**

```typescript
// lib/knowledge/restore-item.ts
import { and, eq } from 'drizzle-orm'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import { knowledgeItems } from '@/lib/db/schema'

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000

export async function restoreKnowledgeItem(
  // biome-ignore lint: db type is project-wide
  db: PgDatabase<any, any, any>,
  args: { id: string; shopId: string },
): Promise<void> {
  const [row] = await db
    .select({
      id: knowledgeItems.id,
      retired: knowledgeItems.retired,
      retiredAt: knowledgeItems.retiredAt,
    })
    .from(knowledgeItems)
    .where(and(eq(knowledgeItems.id, args.id), eq(knowledgeItems.shopId, args.shopId)))
    .limit(1)

  if (!row) throw new Error(`knowledge item not found: ${args.id}`)
  if (!row.retired) throw new Error(`item is not retired: ${args.id}`)
  if (!row.retiredAt || Date.now() - row.retiredAt.getTime() > TWENTY_FOUR_HOURS_MS) {
    throw new Error(`24h restore window has passed: ${args.id}`)
  }

  await db
    .update(knowledgeItems)
    .set({
      retired: false,
      retiredAt: null,
      retiredByUserId: null,
      updatedAt: new Date(),
    })
    .where(eq(knowledgeItems.id, args.id))
}
```

- [ ] **Step 5: Run, expect green**

```bash
pnpm test tests/unit/knowledge-retire-restore.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/knowledge/retire-item.ts lib/knowledge/restore-item.ts tests/unit/knowledge-retire-restore.test.ts
git commit -m "feat(knowledge-ui): retire + restore lib fns + tests (PR 5 task 5)"
```

---

### Task 6: `GET /api/knowledge` route

**Files:**
- Create: `app/api/knowledge/route.ts`
- Test: `tests/unit/knowledge-list-route.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDb, teardownTestDb, type TestDb } from '../helpers/test-db'
import { knowledgeItems } from '@/lib/db/schema'

vi.mock('@/lib/curator/route-helpers', () => ({
  requireCurator: vi.fn(),
}))
vi.mock('@/lib/db/client', () => ({ db: null }))

import { requireCurator } from '@/lib/curator/route-helpers'
import { GET } from '@/app/api/knowledge/route'

describe('GET /api/knowledge', () => {
  let testDb: TestDb
  beforeEach(async () => {
    testDb = await setupTestDb()
    const dbModule = await import('@/lib/db/client')
    ;(dbModule as { db: unknown }).db = testDb.db
    vi.mocked(requireCurator).mockResolvedValue({
      kind: 'ok', profileId: testDb.userId, shopId: testDb.shopId,
    })
  })
  afterEach(async () => { await teardownTestDb(testDb); vi.clearAllMocks() })

  it('returns shop items as JSON', async () => {
    await testDb.db.insert(knowledgeItems).values({
      shopId: testDb.shopId, type: 'note', title: 'T', body: 'b',
      createdByUserId: testDb.userId,
    })
    const res = await GET(new Request('http://localhost/api/knowledge'))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { items: Array<{ title: string }> }
    expect(json.items).toHaveLength(1)
    expect(json.items[0].title).toBe('T')
  })

  it('parses filter query params', async () => {
    await testDb.db.insert(knowledgeItems).values([
      { shopId: testDb.shopId, type: 'note', title: 'A', body: 'a', createdByUserId: testDb.userId },
      { shopId: testDb.shopId, type: 'cause_fix', title: 'B', createdByUserId: testDb.userId,
        structuredData: { cause: 'x', correction: 'y' } },
    ])
    const res = await GET(new Request('http://localhost/api/knowledge?type=cause_fix'))
    const json = (await res.json()) as { items: Array<{ title: string }> }
    expect(json.items).toHaveLength(1)
    expect(json.items[0].title).toBe('B')
  })

  it('returns 403 for non-curator', async () => {
    vi.mocked(requireCurator).mockResolvedValueOnce({
      kind: 'forbidden',
      response: new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }) as unknown as Response,
    } as never)
    const res = await GET(new Request('http://localhost/api/knowledge'))
    expect(res.status).toBe(403)
  })
})
```

- [ ] **Step 2: Run, expect failure**

```bash
pnpm test tests/unit/knowledge-list-route.test.ts
```

Expected: FAIL — route missing.

- [ ] **Step 3: Implement**

```typescript
// app/api/knowledge/route.ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCurator } from '@/lib/curator/route-helpers'
import { db } from '@/lib/db/client'
import { listKnowledgeItems, type KnowledgeListFilter } from '@/lib/knowledge/list'
import { SAVE_ALL_TYPES } from '@/lib/knowledge/save'

const KNOWLEDGE_TYPE_VALUES = SAVE_ALL_TYPES

const FilterSchema = z.object({
  type: z.enum(KNOWLEDGE_TYPE_VALUES).optional(),
  dtc: z.string().min(1).max(40).optional(),
  systemCode: z.string().min(1).max(40).optional(),
  symptom: z.string().min(1).max(120).optional(),
  vehicleMake: z.string().min(1).max(60).optional(),
  vehicleModel: z.string().min(1).max(60).optional(),
  vehicleYear: z.coerce.number().int().min(1980).max(2100).optional(),
  status: z.enum(['active', 'retired', 'all']).optional(),
})

export async function GET(req: Request) {
  const auth = await requireCurator()
  if (auth.kind === 'forbidden') return auth.response

  const url = new URL(req.url)
  const raw = Object.fromEntries(url.searchParams.entries())
  const parsed = FilterSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_input', issues: parsed.error.issues },
      { status: 422 },
    )
  }

  const items = await listKnowledgeItems(db, {
    shopId: auth.shopId,
    filter: parsed.data as KnowledgeListFilter,
  })

  return NextResponse.json({ items })
}
```

- [ ] **Step 4: Run, expect green**

```bash
pnpm test tests/unit/knowledge-list-route.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/knowledge/route.ts tests/unit/knowledge-list-route.test.ts
git commit -m "feat(knowledge-ui): GET /api/knowledge with filter parsing (PR 5 task 6)"
```

---

### Task 7: `GET / PATCH / DELETE /api/knowledge/[id]` route

**Files:**
- Create: `app/api/knowledge/[id]/route.ts`
- Test: `tests/unit/knowledge-item-route.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDb, teardownTestDb, type TestDb } from '../helpers/test-db'
import { knowledgeItems } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

vi.mock('@/lib/curator/route-helpers', () => ({
  requireCurator: vi.fn(),
}))
vi.mock('@/lib/db/client', () => ({ db: null }))

import { requireCurator } from '@/lib/curator/route-helpers'
import { GET, PATCH, DELETE } from '@/app/api/knowledge/[id]/route'

async function makeReq(method: string, path: string, body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

describe('/api/knowledge/[id]', () => {
  let testDb: TestDb
  beforeEach(async () => {
    testDb = await setupTestDb()
    const dbModule = await import('@/lib/db/client')
    ;(dbModule as { db: unknown }).db = testDb.db
    vi.mocked(requireCurator).mockResolvedValue({
      kind: 'ok', profileId: testDb.userId, shopId: testDb.shopId,
    })
  })
  afterEach(async () => { await teardownTestDb(testDb); vi.clearAllMocks() })

  it('GET returns the item', async () => {
    const [item] = await testDb.db.insert(knowledgeItems).values({
      shopId: testDb.shopId, type: 'note', title: 'T', body: 'b',
      createdByUserId: testDb.userId,
    }).returning()
    const res = await GET(
      await makeReq('GET', `/api/knowledge/${item.id}`),
      { params: Promise.resolve({ id: item.id }) },
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as { item: { title: string } }
    expect(json.item.title).toBe('T')
  })

  it('GET returns 404 for missing/wrong-shop item', async () => {
    const res = await GET(
      await makeReq('GET', '/api/knowledge/00000000-0000-0000-0000-000000000000'),
      { params: Promise.resolve({ id: '00000000-0000-0000-0000-000000000000' }) },
    )
    expect(res.status).toBe(404)
  })

  it('PATCH updates the item', async () => {
    const [item] = await testDb.db.insert(knowledgeItems).values({
      shopId: testDb.shopId, type: 'note', title: 'old', body: 'old',
      createdByUserId: testDb.userId,
    }).returning()
    const res = await PATCH(
      await makeReq('PATCH', `/api/knowledge/${item.id}`, {
        type: 'note', title: 'new', body: 'new',
      }),
      { params: Promise.resolve({ id: item.id }) },
    )
    expect(res.status).toBe(200)
    const [updated] = await testDb.db
      .select().from(knowledgeItems).where(eq(knowledgeItems.id, item.id))
    expect(updated.title).toBe('new')
  })

  it('PATCH rejects invalid body with 422', async () => {
    const [item] = await testDb.db.insert(knowledgeItems).values({
      shopId: testDb.shopId, type: 'note', title: 'T', body: 'b',
      createdByUserId: testDb.userId,
    }).returning()
    const res = await PATCH(
      await makeReq('PATCH', `/api/knowledge/${item.id}`, { type: 'bogus' }),
      { params: Promise.resolve({ id: item.id }) },
    )
    expect(res.status).toBe(422)
  })

  it('DELETE soft-retires the item', async () => {
    const [item] = await testDb.db.insert(knowledgeItems).values({
      shopId: testDb.shopId, type: 'note', title: 'T', body: 'b',
      createdByUserId: testDb.userId,
    }).returning()
    const res = await DELETE(
      await makeReq('DELETE', `/api/knowledge/${item.id}`),
      { params: Promise.resolve({ id: item.id }) },
    )
    expect(res.status).toBe(204)
    const [row] = await testDb.db.select().from(knowledgeItems).where(eq(knowledgeItems.id, item.id))
    expect(row.retired).toBe(true)
    expect(row.retiredAt).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run, expect failure**

```bash
pnpm test tests/unit/knowledge-item-route.test.ts
```

Expected: FAIL — route missing.

- [ ] **Step 3: Implement**

```typescript
// app/api/knowledge/[id]/route.ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCurator } from '@/lib/curator/route-helpers'
import { db } from '@/lib/db/client'
import { getKnowledgeItem } from '@/lib/knowledge/get-item'
import { updateKnowledgeItem } from '@/lib/knowledge/update-item'
import { retireKnowledgeItem } from '@/lib/knowledge/retire-item'
import { KnowledgeSaveSchema } from '@/lib/knowledge/save'

type RouteCtx = { params: Promise<{ id: string }> }

const IdSchema = z.string().uuid()

export async function GET(_req: Request, ctx: RouteCtx) {
  const auth = await requireCurator()
  if (auth.kind === 'forbidden') return auth.response

  const { id: rawId } = await ctx.params
  if (!IdSchema.safeParse(rawId).success) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 })
  }

  const item = await getKnowledgeItem(db, { id: rawId, shopId: auth.shopId })
  if (!item) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ item })
}

export async function PATCH(req: Request, ctx: RouteCtx) {
  const auth = await requireCurator()
  if (auth.kind === 'forbidden') return auth.response

  const { id: rawId } = await ctx.params
  if (!IdSchema.safeParse(rawId).success) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 })
  }

  let json: unknown
  try { json = await req.json() } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const parsed = KnowledgeSaveSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_input', issues: parsed.error.issues },
      { status: 422 },
    )
  }

  try {
    await updateKnowledgeItem(db, { id: rawId, shopId: auth.shopId }, parsed.data)
  } catch (err) {
    if (err instanceof Error && /not found/.test(err.message)) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    throw err
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: Request, ctx: RouteCtx) {
  const auth = await requireCurator()
  if (auth.kind === 'forbidden') return auth.response

  const { id: rawId } = await ctx.params
  if (!IdSchema.safeParse(rawId).success) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 })
  }

  try {
    await retireKnowledgeItem(db, {
      id: rawId, shopId: auth.shopId, retiredByUserId: auth.profileId,
    })
  } catch (err) {
    if (err instanceof Error && /not found/.test(err.message)) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    throw err
  }
  return new NextResponse(null, { status: 204 })
}
```

- [ ] **Step 4: Run, expect green**

```bash
pnpm test tests/unit/knowledge-item-route.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/knowledge/\[id\]/route.ts tests/unit/knowledge-item-route.test.ts
git commit -m "feat(knowledge-ui): GET/PATCH/DELETE /api/knowledge/[id] (PR 5 task 7)"
```

---

### Task 8: `POST /api/knowledge/[id]/restore`

**Files:**
- Create: `app/api/knowledge/[id]/restore/route.ts`
- Test: `tests/unit/knowledge-restore-route.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDb, teardownTestDb, type TestDb } from '../helpers/test-db'
import { knowledgeItems } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

vi.mock('@/lib/curator/route-helpers', () => ({
  requireCurator: vi.fn(),
}))
vi.mock('@/lib/db/client', () => ({ db: null }))

import { requireCurator } from '@/lib/curator/route-helpers'
import { POST } from '@/app/api/knowledge/[id]/restore/route'

describe('POST /api/knowledge/[id]/restore', () => {
  let testDb: TestDb
  beforeEach(async () => {
    testDb = await setupTestDb()
    const dbModule = await import('@/lib/db/client')
    ;(dbModule as { db: unknown }).db = testDb.db
    vi.mocked(requireCurator).mockResolvedValue({
      kind: 'ok', profileId: testDb.userId, shopId: testDb.shopId,
    })
  })
  afterEach(async () => { await teardownTestDb(testDb); vi.clearAllMocks() })

  it('restores an item retired within the 24h window', async () => {
    const [item] = await testDb.db.insert(knowledgeItems).values({
      shopId: testDb.shopId, type: 'note', title: 'T', body: 'b',
      retired: true, retiredAt: new Date(Date.now() - 60 * 60 * 1000),
      retiredByUserId: testDb.userId, createdByUserId: testDb.userId,
    }).returning()
    const res = await POST(
      new Request(`http://localhost/api/knowledge/${item.id}/restore`, { method: 'POST' }),
      { params: Promise.resolve({ id: item.id }) },
    )
    expect(res.status).toBe(200)
    const [row] = await testDb.db.select().from(knowledgeItems).where(eq(knowledgeItems.id, item.id))
    expect(row.retired).toBe(false)
  })

  it('returns 409 when 24h window has passed', async () => {
    const [item] = await testDb.db.insert(knowledgeItems).values({
      shopId: testDb.shopId, type: 'note', title: 'T', body: 'b',
      retired: true, retiredAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      retiredByUserId: testDb.userId, createdByUserId: testDb.userId,
    }).returning()
    const res = await POST(
      new Request(`http://localhost/api/knowledge/${item.id}/restore`, { method: 'POST' }),
      { params: Promise.resolve({ id: item.id }) },
    )
    expect(res.status).toBe(409)
  })

  it('returns 404 when not found', async () => {
    const res = await POST(
      new Request('http://localhost/api/knowledge/00000000-0000-0000-0000-000000000000/restore',
        { method: 'POST' }),
      { params: Promise.resolve({ id: '00000000-0000-0000-0000-000000000000' }) },
    )
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run, expect failure**

```bash
pnpm test tests/unit/knowledge-restore-route.test.ts
```

Expected: FAIL — route missing.

- [ ] **Step 3: Implement**

```typescript
// app/api/knowledge/[id]/restore/route.ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCurator } from '@/lib/curator/route-helpers'
import { db } from '@/lib/db/client'
import { restoreKnowledgeItem } from '@/lib/knowledge/restore-item'

type RouteCtx = { params: Promise<{ id: string }> }
const IdSchema = z.string().uuid()

export async function POST(_req: Request, ctx: RouteCtx) {
  const auth = await requireCurator()
  if (auth.kind === 'forbidden') return auth.response

  const { id: rawId } = await ctx.params
  if (!IdSchema.safeParse(rawId).success) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 })
  }

  try {
    await restoreKnowledgeItem(db, { id: rawId, shopId: auth.shopId })
  } catch (err) {
    if (err instanceof Error) {
      if (/not found/.test(err.message)) {
        return NextResponse.json({ error: 'not_found' }, { status: 404 })
      }
      if (/24h restore window/.test(err.message) || /not retired/.test(err.message)) {
        return NextResponse.json({ error: 'cannot_restore', message: err.message }, { status: 409 })
      }
    }
    throw err
  }
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Run, expect green**

```bash
pnpm test tests/unit/knowledge-restore-route.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/knowledge/\[id\]/restore/route.ts tests/unit/knowledge-restore-route.test.ts
git commit -m "feat(knowledge-ui): POST /api/knowledge/[id]/restore (PR 5 task 8)"
```

---

# Phase C — Shared UI primitives

### Task 9: `lib/knowledge/constants.ts` + `components/knowledge/glyph.tsx`

**Files:**
- Create: `lib/knowledge/constants.ts`
- Create: `components/knowledge/glyph.tsx`

- [ ] **Step 1: Create constants**

```typescript
// lib/knowledge/constants.ts
import type { KnowledgeItem } from '@/lib/db/schema'

export type KnowledgeType = KnowledgeItem['type']

export const TYPE_LABELS: Record<KnowledgeType, string> = {
  cause_fix: 'Cause + fix',
  reference_doc: 'Reference doc',
  bulletin: 'Bulletin',
  note: 'Note',
  pinout: 'Pinout',
  connector: 'Connector',
  wiring_diagram: 'Wiring diagram',
  theory_of_operation: 'Theory',
}

export const TYPE_SHORT: Record<KnowledgeType, string> = {
  cause_fix: 'CAUSE+FIX',
  reference_doc: 'REFDOC',
  bulletin: 'BULLETIN',
  note: 'NOTE',
  pinout: 'PINOUT',
  connector: 'CONN',
  wiring_diagram: 'WIRING',
  theory_of_operation: 'THEORY',
}

export const SYSTEM_CODES = [
  'transmission', 'engine', 'can_bus', 'fuel_delivery', 'ignition',
  'charging', 'hvac', 'brakes', 'suspension', 'body_electrical',
  'cooling', 'emissions', 'lighting', 'steering', 'abs', 'sas',
  'hybrid_drive', 'restraint', 'infotainment', 'network',
] as const

export type SystemCode = (typeof SYSTEM_CODES)[number]
```

- [ ] **Step 2: Create glyph component**

Open `designs/design_handoff_vehicle_knowledge/KnowledgePageStates.jsx` and find the `KP_TypeGlyph` component (search for `KP_TypeGlyph`). Lift its SVG paths verbatim into the TS component. The 8 glyphs are small 16×16 SVGs with `stroke="currentColor"` and `strokeWidth={1.25}`.

```typescript
// components/knowledge/glyph.tsx
import type { KnowledgeType } from '@/lib/knowledge/constants'

const SIZE = 16
const stroke = { stroke: 'currentColor', strokeWidth: 1.25, fill: 'none' } as const

export function TypeGlyph({ type }: { type: KnowledgeType }) {
  switch (type) {
    case 'cause_fix':
      return (
        <svg width={SIZE} height={SIZE} viewBox="0 0 16 16">
          <path d="M3 5h10M3 8h10M3 11h6" {...stroke} />
        </svg>
      )
    case 'reference_doc':
      return (
        <svg width={SIZE} height={SIZE} viewBox="0 0 16 16">
          <rect x="3" y="2.5" width="10" height="11" rx="0.5" {...stroke} />
          <path d="M5 6h6M5 9h6M5 12h4" {...stroke} />
        </svg>
      )
    case 'bulletin':
      return (
        <svg width={SIZE} height={SIZE} viewBox="0 0 16 16">
          <path d="M8 2v3M8 11v3M2 8h3M11 8h3M4 4l2 2M10 10l2 2M12 4l-2 2M6 10l-2 2" {...stroke} />
        </svg>
      )
    case 'note':
      return (
        <svg width={SIZE} height={SIZE} viewBox="0 0 16 16">
          <path d="M3 3h10v8l-3 3H3z" {...stroke} />
          <path d="M10 14v-3h3" {...stroke} />
        </svg>
      )
    case 'pinout':
      return (
        <svg width={SIZE} height={SIZE} viewBox="0 0 16 16">
          <circle cx="5" cy="5" r="1.25" {...stroke} />
          <circle cx="11" cy="5" r="1.25" {...stroke} />
          <circle cx="5" cy="11" r="1.25" {...stroke} />
          <circle cx="11" cy="11" r="1.25" {...stroke} />
        </svg>
      )
    case 'connector':
      return (
        <svg width={SIZE} height={SIZE} viewBox="0 0 16 16">
          <rect x="2.5" y="4" width="11" height="8" rx="1" {...stroke} />
          <path d="M5 4v-1M11 4v-1" {...stroke} />
        </svg>
      )
    case 'wiring_diagram':
      return (
        <svg width={SIZE} height={SIZE} viewBox="0 0 16 16">
          <path d="M2 5h4l3 3h5M2 11h4l3-3" {...stroke} />
          <circle cx="6" cy="5" r="0.6" fill="currentColor" />
          <circle cx="9" cy="8" r="0.6" fill="currentColor" />
        </svg>
      )
    case 'theory_of_operation':
      return (
        <svg width={SIZE} height={SIZE} viewBox="0 0 16 16">
          <circle cx="8" cy="8" r="5" {...stroke} />
          <path d="M8 4v4l3 2" {...stroke} />
        </svg>
      )
  }
}
```

- [ ] **Step 3: Quick smoke check**

```bash
pnpm exec tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add lib/knowledge/constants.ts components/knowledge/glyph.tsx
git commit -m "feat(knowledge-ui): type labels + glyphs (PR 5 task 9)"
```

---

# Phase D — List page surfaces

### Task 10: Row + EmptyState + FilterBar components

**Files:**
- Create: `components/knowledge/row.tsx`
- Create: `components/knowledge/empty-state.tsx`
- Create: `components/knowledge/filter-bar.tsx`

Reference: `designs/design_handoff_vehicle_knowledge/KnowledgePageStates.jsx` (KP_Row, KP_FilterBar, KP_Empty components — lift markup verbatim, convert to TS, replace SampleData accessors with real props).

- [ ] **Step 1: Build row.tsx (server component)**

```typescript
// components/knowledge/row.tsx
import Link from 'next/link'
import { TypeGlyph } from './glyph'
import { TYPE_SHORT } from '@/lib/knowledge/constants'
import type { KnowledgeListRow } from '@/lib/knowledge/list'

function formatScope(s: KnowledgeListRow['vehicleScopes'][number]) {
  const year = s.yearStart === s.yearEnd
    ? String(s.yearStart)
    : `${s.yearStart}–${String(s.yearEnd).slice(2)}`
  const parts = [year, s.make, s.model, s.engine && `· ${s.engine}`, s.trim && `· ${s.trim}`]
  return parts.filter(Boolean).join(' ')
}

function formatEdited(d: Date | string) {
  const date = typeof d === 'string' ? new Date(d) : d
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mi = String(date.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} · ${hh}:${mi}`
}

export function KnowledgeRow({ item }: { item: KnowledgeListRow }) {
  const isRetired = item.retired
  return (
    <Link href={`?detail=${item.id}`} className="vk-row" role="link" scroll={false}>
      <div className="vk-row__type">
        <span className="vk-row__type-label">{TYPE_SHORT[item.type]}</span>
        <span className="vk-row__type-mark"><TypeGlyph type={item.type} /></span>
      </div>
      <div className="vk-row__main">
        <h3 className="vk-row__title">{item.title}</h3>
        {item.vehicleScopes.length > 0 && (
          <div className="vk-row__scope">
            {item.vehicleScopes.map((s, i) => (
              <span className="vk-scope" key={i}>{formatScope(s)}</span>
            ))}
          </div>
        )}
        {(item.dtcList.length > 0 || item.systemCodes.length > 0 || item.symptoms.length > 0) && (
          <div className="vk-row__tags">
            {item.dtcList.map(dtc => <span className="vk-chip-dtc" key={dtc}>{dtc}</span>)}
            {item.systemCodes.map(sc => <span className="vk-chip-sys" key={sc}>{sc}</span>)}
            {item.symptoms.map(s => <span className="vk-chip-sym" key={s}>{s}</span>)}
          </div>
        )}
      </div>
      <div className="vk-row__meta">
        {item.fireCount > 0 && (
          <div className="vk-row__fires">fired <strong>{item.fireCount}×</strong></div>
        )}
        <div className="vk-row__edited">{formatEdited(item.updatedAt)}</div>
        {isRetired && <div className="vk-row__status">RETIRED</div>}
      </div>
    </Link>
  )
}
```

- [ ] **Step 2: Build empty-state.tsx (server)**

```typescript
// components/knowledge/empty-state.tsx
export function KnowledgeEmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="vk-empty">
      <h2 className="vk-empty__title">Nothing here yet.</h2>
      <p className="vk-empty__body">
        {hasFilters
          ? "No items match these filters. Try widening the scope, or clear the chips above."
          : "Add the first knowledge entry by pasting reference text or filling a structured form."}
      </p>
    </div>
  )
}
```

- [ ] **Step 3: Build filter-bar.tsx (client)**

Reference the `KP_FilterBar` component in `KnowledgePageStates.jsx`. Filters write to the URL via `router.replace(?key=val)` so the server page re-runs with the new filter set.

```typescript
// components/knowledge/filter-bar.tsx
'use client'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback } from 'react'
import { TYPE_LABELS, SYSTEM_CODES } from '@/lib/knowledge/constants'

const TYPE_KEYS = Object.keys(TYPE_LABELS) as Array<keyof typeof TYPE_LABELS>

export function FilterBar() {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()

  const update = useCallback((key: string, value: string | null) => {
    const next = new URLSearchParams(search.toString())
    if (value === null || value === '') next.delete(key)
    else next.set(key, value)
    next.delete('detail') // close drawer on filter change
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }, [router, pathname, search])

  const status = search.get('status') ?? 'active'
  const type = search.get('type') ?? ''
  const systemCode = search.get('systemCode') ?? ''

  return (
    <div className="vk-filterbar">
      <div className="vk-filterbar__chips">
        <button
          className={`vk-chip ${status === 'active' ? 'vk-chip--active' : ''}`}
          onClick={() => update('status', null)}
        >Active</button>
        <button
          className={`vk-chip ${status === 'retired' ? 'vk-chip--active' : ''}`}
          onClick={() => update('status', 'retired')}
        >Retired</button>
        <button
          className={`vk-chip ${status === 'all' ? 'vk-chip--active' : ''}`}
          onClick={() => update('status', 'all')}
        >All</button>
        <div className="vk-filterbar__divider" aria-hidden />
        <select
          className="vk-select"
          value={type}
          onChange={e => update('type', e.target.value || null)}
        >
          <option value="">Type · all</option>
          {TYPE_KEYS.map(k => <option key={k} value={k}>{TYPE_LABELS[k]}</option>)}
        </select>
        <select
          className="vk-select"
          value={systemCode}
          onChange={e => update('systemCode', e.target.value || null)}
        >
          <option value="">System · all</option>
          {SYSTEM_CODES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input
          className="vk-input"
          type="text"
          placeholder="DTC (e.g. P0562)"
          defaultValue={search.get('dtc') ?? ''}
          onBlur={e => update('dtc', e.target.value.trim() || null)}
          onKeyDown={e => { if (e.key === 'Enter') update('dtc', (e.target as HTMLInputElement).value.trim() || null) }}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: TS clean**

```bash
pnpm exec tsc --noEmit
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add components/knowledge/row.tsx components/knowledge/empty-state.tsx components/knowledge/filter-bar.tsx
git commit -m "feat(knowledge-ui): row + empty-state + filter-bar (PR 5 task 10)"
```

---

### Task 11: Card detail drawer (client component)

**Files:**
- Create: `components/knowledge/drawer.tsx`

Reference: `designs/design_handoff_vehicle_knowledge/CardDetailDrawerStates.jsx` (309 lines). Lift the markup for all 8 type-specific render-bodies; the drawer shell is shared.

The drawer:
- Renders nothing when `item` is null.
- Renders a fixed-position overlay (scrim + drawer pane) when `item` is set.
- Closing = navigate to current URL without `?detail=`.
- Type-specific bodies for: cause_fix, reference_doc, bulletin, note, pinout, connector, wiring_diagram, theory_of_operation.
- Footer with Edit / Retire / Restore buttons (hidden when `ownerMode=false` — PR 6 uses this).

- [ ] **Step 1: Build drawer.tsx**

```typescript
// components/knowledge/drawer.tsx
'use client'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { TypeGlyph } from './glyph'
import { TYPE_LABELS, TYPE_SHORT } from '@/lib/knowledge/constants'
import type { KnowledgeListRow } from '@/lib/knowledge/list'

type PinRow = { pin_number: string; signal_name: string; wire_color?: string; expected_voltage_or_waveform?: string; notes?: string }
type WiringConn = { from_component: string; from_pin?: string; to_component: string; to_pin?: string; wire_color?: string; splice_id?: string; notes?: string }
type TheorySection = { heading: string; body: string }

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000

export function KnowledgeDrawer({ item, ownerMode = true }: { item: KnowledgeListRow | null; ownerMode?: boolean }) {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const [pending, setPending] = useState<'retire' | 'restore' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const close = useCallback(() => {
    const next = new URLSearchParams(search.toString())
    next.delete('detail')
    const q = next.toString()
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false })
  }, [router, pathname, search])

  useEffect(() => {
    if (!item) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [item, close])

  if (!item) return null

  const isRetired = item.retired
  const withinRestoreWindow = isRetired && item.retiredAt
    ? Date.now() - new Date(item.retiredAt).getTime() < TWENTY_FOUR_HOURS_MS
    : false

  async function handleRetire() {
    if (!confirm('Retire this item? It will hide from the list within 24h.')) return
    setPending('retire'); setError(null)
    try {
      const res = await fetch(`/api/knowledge/${item!.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'retire failed')
    } finally { setPending(null) }
  }

  async function handleRestore() {
    setPending('restore'); setError(null)
    try {
      const res = await fetch(`/api/knowledge/${item!.id}/restore`, { method: 'POST' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'restore failed')
    } finally { setPending(null) }
  }

  return (
    <>
      <div className="vk-scrim" onClick={close} aria-hidden />
      <aside className="vk-drawer" role="dialog" aria-modal="true" aria-label={item.title}>
        <header className="vk-drawer__head">
          <div className="vk-drawer__eyebrow">
            <span className="vk-drawer__type-mark"><TypeGlyph type={item.type} /></span>
            <span className="vk-drawer__type-label">{TYPE_SHORT[item.type]}</span>
          </div>
          <h2 className="vk-drawer__title">{item.title}</h2>
          <button className="vk-drawer__close" onClick={close} aria-label="Close">×</button>
        </header>

        <div className="vk-drawer__body">
          {item.vehicleScopes.length > 0 && <DrawerScopes scopes={item.vehicleScopes} />}
          <DrawerTypeBody item={item} />
          {(item.dtcList.length > 0 || item.systemCodes.length > 0 || item.symptoms.length > 0) && (
            <DrawerTags item={item} />
          )}
        </div>

        <footer className="vk-drawer__foot">
          <div className="vk-drawer__meta">
            {item.fireCount > 0 && <span className="vk-drawer__fires">fired <strong>{item.fireCount}×</strong></span>}
            <span className="vk-drawer__edited">edited {new Date(item.updatedAt).toISOString().replace('T', ' · ').slice(0, 19)}</span>
          </div>
          {ownerMode && (
            <div className="vk-drawer__actions">
              <Link href={editHref(item)} className="vk-btn vk-btn--ghost">Edit</Link>
              {!isRetired && (
                <button className="vk-btn vk-btn--danger" disabled={pending !== null} onClick={handleRetire}>
                  {pending === 'retire' ? 'Retiring…' : 'Retire'}
                </button>
              )}
              {isRetired && withinRestoreWindow && (
                <button className="vk-btn" disabled={pending !== null} onClick={handleRestore}>
                  {pending === 'restore' ? 'Restoring…' : 'Restore'}
                </button>
              )}
            </div>
          )}
          {error && <div className="vk-drawer__error">{error}</div>}
        </footer>
      </aside>
    </>
  )
}

function editHref(item: KnowledgeListRow): string {
  switch (item.type) {
    case 'pinout': return `/knowledge/new/pinout?id=${item.id}`
    case 'connector': return `/knowledge/new/connector?id=${item.id}`
    case 'wiring_diagram': return `/knowledge/new/wiring?id=${item.id}`
    case 'theory_of_operation': return `/knowledge/new/theory?id=${item.id}`
    default: return `/knowledge/${item.id}/review?edit=1`
  }
}

function DrawerScopes({ scopes }: { scopes: KnowledgeListRow['vehicleScopes'] }) {
  return (
    <section className="vk-dsec">
      <h3 className="vk-dsec__head">Vehicle scope</h3>
      <ul className="vk-dsec__scope-list">
        {scopes.map((s, i) => (
          <li key={i}>
            {s.yearStart === s.yearEnd ? s.yearStart : `${s.yearStart}–${s.yearEnd}`}{' '}
            {s.make}{s.model && ` ${s.model}`}{s.engine && ` — ${s.engine}`}
          </li>
        ))}
      </ul>
    </section>
  )
}

function DrawerTags({ item }: { item: KnowledgeListRow }) {
  return (
    <section className="vk-dsec">
      <h3 className="vk-dsec__head">Tags</h3>
      <div className="vk-dsec__tags">
        {item.dtcList.map(d => <span className="vk-chip-dtc" key={d}>{d}</span>)}
        {item.systemCodes.map(s => <span className="vk-chip-sys" key={s}>{s}</span>)}
        {item.symptoms.map(s => <span className="vk-chip-sym" key={s}>{s}</span>)}
      </div>
    </section>
  )
}

function DrawerTypeBody({ item }: { item: KnowledgeListRow }) {
  const sd = (item.structuredData ?? {}) as Record<string, unknown>
  switch (item.type) {
    case 'cause_fix':
      return (
        <section className="vk-dsec">
          {labeled('Complaint', sd.complaint)}
          {labeled('Cause', sd.cause)}
          {labeled('Correction', sd.correction)}
          {labeled('First check', sd.first_check)}
        </section>
      )
    case 'reference_doc':
    case 'note':
      return <section className="vk-dsec"><p className="vk-dsec__prose">{item.body ?? ''}</p></section>
    case 'bulletin':
      return (
        <section className="vk-dsec">
          {labeled('Source', sd.source)}
          {labeled('Bulletin ID', sd.bulletin_id)}
          {labeled('Summary', sd.summary)}
          {labeled('Body', sd.body)}
          {typeof sd.link === 'string' && <p><a href={sd.link} rel="noreferrer">Original link →</a></p>}
        </section>
      )
    case 'pinout':
      return <PinoutBody connector={String(sd.connector_ref ?? '')} pins={(sd.pins ?? []) as PinRow[]} />
    case 'connector':
      return <ConnectorBody sd={sd} />
    case 'wiring_diagram':
      return <WiringBody sd={sd} />
    case 'theory_of_operation':
      return <TheoryBody sd={sd} />
  }
}

function labeled(label: string, value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  return (
    <div className="vk-dsec__labeled">
      <div className="vk-dsec__labeled-label">{label}</div>
      <div className="vk-dsec__labeled-value">{value}</div>
    </div>
  )
}

function PinoutBody({ connector, pins }: { connector: string; pins: PinRow[] }) {
  return (
    <section className="vk-dsec">
      <h3 className="vk-dsec__head">{connector}</h3>
      <table className="vk-dsec__pintable">
        <thead><tr><th>Pin</th><th>Signal</th><th>Wire</th><th>Expected</th><th>Notes</th></tr></thead>
        <tbody>
          {pins.map(p => (
            <tr key={p.pin_number}>
              <td>{p.pin_number}</td>
              <td>{p.signal_name}</td>
              <td>{p.wire_color ?? '—'}</td>
              <td>{p.expected_voltage_or_waveform ?? '—'}</td>
              <td>{p.notes ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function ConnectorBody({ sd }: { sd: Record<string, unknown> }) {
  return (
    <section className="vk-dsec">
      {labeled('Connector ID', sd.connector_id)}
      {labeled('Component', sd.component_name)}
      {labeled('Location', sd.location_description)}
      <div className="vk-dsec__images">
        {typeof sd.image_ref === 'string' && (
          <figure className="vk-dsec__img"><img src={sd.image_ref} alt="In place" /><figcaption>In place</figcaption></figure>
        )}
        {typeof sd.mating_end_image_ref === 'string' && (
          <figure className="vk-dsec__img"><img src={sd.mating_end_image_ref} alt="Mating end" /><figcaption>Mating end</figcaption></figure>
        )}
      </div>
    </section>
  )
}

function WiringBody({ sd }: { sd: Record<string, unknown> }) {
  const connections = Array.isArray(sd.connections) ? (sd.connections as WiringConn[]) : []
  return (
    <section className="vk-dsec">
      {typeof sd.image_ref === 'string' && (
        <figure className="vk-dsec__wiring-img"><img src={sd.image_ref} alt={String(sd.name ?? 'Wiring diagram')} /></figure>
      )}
      {connections.length > 0 && (
        <table className="vk-dsec__conntable">
          <thead><tr><th>From</th><th>Pin</th><th>To</th><th>Pin</th><th>Wire</th><th>Splice</th><th>Notes</th></tr></thead>
          <tbody>
            {connections.map((c, i) => (
              <tr key={i}>
                <td>{c.from_component}</td><td>{c.from_pin ?? ''}</td>
                <td>{c.to_component}</td><td>{c.to_pin ?? ''}</td>
                <td>{c.wire_color ?? ''}</td><td>{c.splice_id ?? ''}</td>
                <td>{c.notes ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function TheoryBody({ sd }: { sd: Record<string, unknown> }) {
  const sections = Array.isArray(sd.sections) ? (sd.sections as TheorySection[]) : []
  return (
    <section className="vk-dsec">
      {sections.map((s, i) => (
        <details key={i} className="vk-dsec__theory" open={i === 0}>
          <summary>{s.heading}</summary>
          <div className="vk-dsec__prose">{s.body}</div>
        </details>
      ))}
    </section>
  )
}
```

- [ ] **Step 2: TS clean**

```bash
pnpm exec tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/knowledge/drawer.tsx
git commit -m "feat(knowledge-ui): card detail drawer with all 8 type bodies (PR 5 task 11)"
```

---

### Task 12: Replace placeholder `/knowledge/page.tsx` with real list page

**Files:**
- Modify: `app/(app)/knowledge/page.tsx` (full rewrite — delete current contents, write new)

- [ ] **Step 1: Rewrite the page**

```typescript
// app/(app)/knowledge/page.tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { eq } from 'drizzle-orm'
import { getServerSupabase } from '@/lib/supabase-server'
import { db } from '@/lib/db/client'
import { profiles } from '@/lib/db/schema'
import { canCurate } from '@/lib/curator/can-curate'
import { listKnowledgeItems, type KnowledgeListFilter } from '@/lib/knowledge/list'
import { getKnowledgeItem } from '@/lib/knowledge/get-item'
import { SAVE_ALL_TYPES } from '@/lib/knowledge/save'
import { FilterBar } from '@/components/knowledge/filter-bar'
import { KnowledgeRow } from '@/components/knowledge/row'
import { KnowledgeEmptyState } from '@/components/knowledge/empty-state'
import { KnowledgeDrawer } from '@/components/knowledge/drawer'

export const metadata = { title: 'Knowledge' }

const TYPE_SET = new Set<string>(SAVE_ALL_TYPES)

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const supabase = await getServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in?next=%2Fknowledge')

  const [profile] = await db
    .select({ role: profiles.role, shopId: profiles.shopId })
    .from(profiles)
    .where(eq(profiles.userId, user.id))
    .limit(1)
  if (!canCurate(profile?.role) || !profile?.shopId) redirect('/')

  const sp = await searchParams
  const filter = parseFilters(sp)
  const items = await listKnowledgeItems(db, { shopId: profile.shopId, filter })

  const detailId = singleParam(sp.detail)
  const detail = detailId
    ? await getKnowledgeItem(db, { id: detailId, shopId: profile.shopId })
    : null

  return (
    <main className="vk-page">
      <header className="vk-page__head">
        <div>
          <p className="vk-page__eyebrow">VEHICLE KNOWLEDGE</p>
          <h1 className="vk-page__title">Knowledge</h1>
        </div>
        <div className="vk-page__head-actions">
          <Link href="/knowledge?add=1" className="vk-btn vk-btn--primary">+ Add knowledge</Link>
        </div>
      </header>

      <FilterBar />

      <section className="vk-list">
        {items.length === 0
          ? <KnowledgeEmptyState hasFilters={Object.keys(filter).length > 0} />
          : items.map(item => <KnowledgeRow key={item.id} item={item} />)}
      </section>

      <KnowledgeDrawer item={detail} />
    </main>
  )
}

function singleParam(v: string | string[] | undefined): string | null {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v[0] ?? null
  return null
}

function parseFilters(sp: Record<string, string | string[] | undefined>): KnowledgeListFilter {
  const filter: KnowledgeListFilter = {}
  const type = singleParam(sp.type)
  if (type && TYPE_SET.has(type)) filter.type = type as KnowledgeListFilter['type']
  const dtc = singleParam(sp.dtc); if (dtc) filter.dtc = dtc.toUpperCase()
  const sc = singleParam(sp.systemCode); if (sc) filter.systemCode = sc
  const sy = singleParam(sp.symptom); if (sy) filter.symptom = sy
  const make = singleParam(sp.vehicleMake); if (make) filter.vehicleMake = make
  const model = singleParam(sp.vehicleModel); if (model) filter.vehicleModel = model
  const year = singleParam(sp.vehicleYear); if (year && /^\d{4}$/.test(year)) filter.vehicleYear = Number(year)
  const status = singleParam(sp.status)
  if (status === 'active' || status === 'retired' || status === 'all') filter.status = status
  return filter
}
```

- [ ] **Step 2: TS clean**

```bash
pnpm exec tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add app/\(app\)/knowledge/page.tsx
git commit -m "feat(knowledge-ui): real /knowledge list page with drawer (PR 5 task 12)"
```

---

# Phase E — Add picker (entry point to contribution flows)

### Task 13: `components/knowledge/add-picker.tsx` (client dialog)

**Files:**
- Create: `components/knowledge/add-picker.tsx`
- Modify: `app/(app)/knowledge/page.tsx` (mount picker, gate by `?add=1`)

Reference: `designs/design_handoff_vehicle_knowledge/AddKnowledgeStates.jsx`.

The picker:
- Mounted on the page; visible when `searchParams.add === '1'`.
- Closed by setting `?add` to empty.
- Five options: Paste (primary, amber), Pinout, Connector, Wiring, Theory.
- Each non-Paste option navigates to `/knowledge/new/<type>`.
- Paste opens the paste sheet (task 14).
- Keyboard: P=paste, 1=pinout, 2=connector, 3=wiring, 4=theory, Esc=close.

- [ ] **Step 1: Create add-picker.tsx**

```typescript
// components/knowledge/add-picker.tsx
'use client'
import Link from 'next/link'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useCallback, useEffect } from 'react'

const STRUCTURED = [
  { key: '1', href: '/knowledge/new/pinout', label: 'Pinout', sub: 'Pin-by-pin signal table' },
  { key: '2', href: '/knowledge/new/connector', label: 'Connector', sub: 'Connector ID + location + images' },
  { key: '3', href: '/knowledge/new/wiring', label: 'Wiring diagram', sub: 'Image + connections table' },
  { key: '4', href: '/knowledge/new/theory', label: 'Theory of operation', sub: 'Long-form sections' },
] as const

export function AddKnowledgePicker() {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const open = search.get('add') === '1'

  const close = useCallback(() => {
    const next = new URLSearchParams(search.toString())
    next.delete('add')
    const q = next.toString()
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false })
  }, [router, pathname, search])

  const openPaste = useCallback(() => {
    const next = new URLSearchParams(search.toString())
    next.delete('add'); next.set('paste', '1')
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }, [router, pathname, search])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { close(); return }
      if (e.key.toLowerCase() === 'p') { openPaste(); return }
      const s = STRUCTURED.find(s => s.key === e.key)
      if (s) router.push(s.href)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close, openPaste, router])

  if (!open) return null

  return (
    <>
      <div className="vk-scrim" onClick={close} aria-hidden />
      <div className="vk-picker" role="dialog" aria-modal="true" aria-label="Add knowledge">
        <header className="vk-picker__head">
          <h2 className="vk-picker__title">Add knowledge</h2>
          <p className="vk-picker__sub">Pick a flow</p>
        </header>

        <button className="vk-picker__primary" onClick={openPaste}>
          <span className="vk-picker__glyph">P</span>
          <span className="vk-picker__primary-text">
            <strong>Paste reference text</strong>
            <em>For cause+fix, bulletins, notes — AI sorts it for you.</em>
          </span>
        </button>

        <div className="vk-picker__grid">
          {STRUCTURED.map(s => (
            <Link key={s.key} href={s.href} className="vk-picker__opt" onClick={close}>
              <span className="vk-picker__opt-key">{s.key}</span>
              <div className="vk-picker__opt-text">
                <strong>{s.label}</strong>
                <em>{s.sub}</em>
              </div>
            </Link>
          ))}
        </div>

        <footer className="vk-picker__foot">P · paste · 1 / 2 / 3 / 4 · structured · ESC · close</footer>
      </div>
    </>
  )
}
```

- [ ] **Step 2: Mount in page.tsx**

In `app/(app)/knowledge/page.tsx`, add import:

```typescript
import { AddKnowledgePicker } from '@/components/knowledge/add-picker'
```

Then add `<AddKnowledgePicker />` just before `</main>`:

```typescript
      <KnowledgeDrawer item={detail} />
      <AddKnowledgePicker />
    </main>
```

- [ ] **Step 3: TS clean**

```bash
pnpm exec tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add components/knowledge/add-picker.tsx app/\(app\)/knowledge/page.tsx
git commit -m "feat(knowledge-ui): add-knowledge picker + page mount (PR 5 task 13)"
```

---

# Phase F — Paste flow + Review form

### Task 14: `components/knowledge/paste-sheet.tsx` (replaces old paste-form)

**Files:**
- Create: `components/knowledge/paste-sheet.tsx`
- Modify: `app/(app)/knowledge/page.tsx` (mount sheet, gate by `?paste=1`)

Reference: `PasteSheetStates.jsx`. Behavior:
- Open when `?paste=1`. Close = remove param. Esc closes.
- Textarea + scope-hint input + char counter.
- Counter colors: green ≤8k, medium 8k–20k, high >20k. Save disabled when empty or >20k.
- Save POSTs to `/api/knowledge/paste`; on success stash result via `sessionStorage` keyed by a new draft id, then `router.push(/knowledge/draft-{id}/review)`. **Decision:** since drafts don't persist (Open Decision 7), use a `sessionStorage` payload key + a `/knowledge/review-draft` page that reads it.

Actually — simpler: pass the parsed result as URL state via base64-encoded JSON. Too brittle. Better: POST + immediately POST to `/api/knowledge/save` → get real id → navigate to `/knowledge/[id]/review?fromPaste=1`. But the user needs to *review and edit* the AI-proposed fields before save.

Use this flow: paste-sheet posts to `/api/knowledge/paste`, gets the proposal, stores it in `sessionStorage['vk-paste-proposal']`, navigates to `/knowledge/review-paste` (new route, not part of the [id] tree). Review page reads sessionStorage, lets owner edit, then POSTs to `/api/knowledge/save`. On save, navigate to `/knowledge?detail=<newId>`.

- [ ] **Step 1: Build paste-sheet.tsx**

```typescript
// components/knowledge/paste-sheet.tsx
'use client'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import type { ClassifiedPasteResult } from '@/lib/knowledge/classify-paste'

const SOFT_CAP = 8_000
const HARD_CAP = 20_000

export function PasteSheet() {
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const open = search.get('paste') === '1'

  const [scope, setScope] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const close = useCallback(() => {
    const next = new URLSearchParams(search.toString())
    next.delete('paste')
    const q = next.toString()
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false })
  }, [router, pathname, search])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); handleSave() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, text, scope])

  if (!open) return null

  async function handleSave() {
    if (text.length === 0 || text.length > HARD_CAP || busy) return
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/knowledge/paste', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rawText: text, scopeHint: scope || undefined }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.message || j.error || `HTTP ${res.status}`)
      }
      const proposal = (await res.json()) as ClassifiedPasteResult
      sessionStorage.setItem('vk-paste-proposal', JSON.stringify({ proposal, rawText: text, scopeHint: scope }))
      router.push('/knowledge/review-paste')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'paste failed')
    } finally {
      setBusy(false)
    }
  }

  const count = text.length
  const counterClass = count > HARD_CAP ? 'vk-paste__count--high'
    : count > SOFT_CAP ? 'vk-paste__count--medium' : ''

  return (
    <div className="vk-paste-overlay">
      <section className="vk-paste-sheet" role="dialog" aria-modal="true" aria-label="Paste reference text">
        <header className="vk-paste-sheet__head">
          <div>
            <h2 className="vk-paste-sheet__title">Paste reference text</h2>
            <input
              className="vk-paste-sheet__scope"
              type="text" placeholder="Optional scope hint (e.g. 2017–19 F-250 6.7L)"
              value={scope} onChange={e => setScope(e.target.value)} maxLength={500}
            />
          </div>
          <button className="vk-btn vk-btn--ghost" onClick={close}>×</button>
        </header>

        <textarea
          className="vk-paste-sheet__area"
          value={text} onChange={e => setText(e.target.value)}
          placeholder="Paste shop notes, OEM text, AllData snippet, your own writeup… (≤ 20k chars)"
          autoFocus
        />

        <div className={`vk-paste-sheet__status ${counterClass}`}>
          <span>{count.toLocaleString()} / {HARD_CAP.toLocaleString()} chars</span>
          {count > HARD_CAP && <span> · hard cap exceeded</span>}
          {count > SOFT_CAP && count <= HARD_CAP && <span> · soft cap</span>}
          {busy && <span> · sorting…</span>}
          {error && <span> · {error}</span>}
        </div>

        <footer className="vk-paste-sheet__foot">
          <button className="vk-btn vk-btn--ghost" onClick={close}>Cancel</button>
          <button
            className="vk-btn vk-btn--primary"
            disabled={count === 0 || count > HARD_CAP || busy}
            onClick={handleSave}
          >
            {busy ? 'Sorting…' : 'Sort and review'}
          </button>
        </footer>
      </section>
    </div>
  )
}
```

- [ ] **Step 2: Mount in page.tsx**

In `app/(app)/knowledge/page.tsx` add:

```typescript
import { PasteSheet } from '@/components/knowledge/paste-sheet'
```

and add `<PasteSheet />` just before `</main>`.

- [ ] **Step 3: TS clean**

```bash
pnpm exec tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add components/knowledge/paste-sheet.tsx app/\(app\)/knowledge/page.tsx
git commit -m "feat(knowledge-ui): paste sheet (replaces old paste-form) (PR 5 task 14)"
```

---

### Task 15: Review page for paste-proposal flow

**Files:**
- Create: `app/(app)/knowledge/review-paste/page.tsx`
- Create: `app/(app)/knowledge/review-paste/review-form.tsx`

The review page reads `sessionStorage['vk-paste-proposal']` (the proposal payload), renders an editable form, and on Save POSTs the edited values to `/api/knowledge/save`.

- [ ] **Step 1: Build the server page (gate only)**

```typescript
// app/(app)/knowledge/review-paste/page.tsx
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { getServerSupabase } from '@/lib/supabase-server'
import { db } from '@/lib/db/client'
import { profiles } from '@/lib/db/schema'
import { canCurate } from '@/lib/curator/can-curate'
import { ReviewForm } from './review-form'

export const metadata = { title: 'Review · Knowledge' }

export default async function ReviewPastePage() {
  const supabase = await getServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in?next=%2Fknowledge%2Freview-paste')
  const [profile] = await db
    .select({ role: profiles.role }).from(profiles)
    .where(eq(profiles.userId, user.id)).limit(1)
  if (!canCurate(profile?.role)) redirect('/')

  return (
    <main className="vk-page">
      <header className="vk-page__head">
        <div>
          <p className="vk-page__eyebrow">REVIEW</p>
          <h1 className="vk-page__title">Review AI sort</h1>
        </div>
      </header>
      <ReviewForm />
    </main>
  )
}
```

- [ ] **Step 2: Build the client form**

```typescript
// app/(app)/knowledge/review-paste/review-form.tsx
'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import type { ClassifiedPasteResult } from '@/lib/knowledge/classify-paste'
import { TYPE_LABELS, SYSTEM_CODES } from '@/lib/knowledge/constants'

type Stored = { proposal: ClassifiedPasteResult; rawText: string; scopeHint: string }

const SIMPLE_TYPES = ['cause_fix', 'reference_doc', 'bulletin', 'note'] as const
type SimpleType = (typeof SIMPLE_TYPES)[number]

export function ReviewForm() {
  const router = useRouter()
  const [hydrated, setHydrated] = useState(false)
  const [stored, setStored] = useState<Stored | null>(null)
  const [type, setType] = useState<SimpleType>('note')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [structured, setStructured] = useState<Record<string, string>>({})
  const [dtcs, setDtcs] = useState<string[]>([])
  const [systemCodes, setSystemCodes] = useState<string[]>([])
  const [symptoms, setSymptoms] = useState<string[]>([])
  const [scopes, setScopes] = useState<Array<{
    yearStart: number; yearEnd: number; make: string; model?: string; engine?: string
  }>>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editedFields, setEditedFields] = useState<Set<string>>(new Set())

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('vk-paste-proposal')
      if (!raw) { router.replace('/knowledge'); return }
      const parsed = JSON.parse(raw) as Stored
      setStored(parsed)
      const d = parsed.proposal.draft
      if (d.type && SIMPLE_TYPES.includes(d.type as SimpleType)) setType(d.type as SimpleType)
      setTitle(d.title ?? '')
      setBody(d.body ?? '')
      setStructured((d.structuredData as Record<string, string>) ?? {})
      setDtcs(d.dtcList ?? [])
      setSystemCodes(d.systemCodes ?? [])
      setSymptoms(d.symptoms ?? [])
      setScopes(d.vehicleScopes ?? [])
    } finally {
      setHydrated(true)
    }
  }, [router])

  const sources = useMemo(() => stored?.proposal.sourceSpans ?? {}, [stored])

  function markEdited(field: string) { setEditedFields(prev => new Set(prev).add(field)) }

  async function handleSave() {
    if (busy) return
    setBusy(true); setError(null)
    try {
      const payload: Record<string, unknown> = {
        type, title, dtcList: dtcs, systemCodes, symptoms, vehicleScopes: scopes,
      }
      if (type === 'cause_fix') {
        payload.structuredData = {
          cause: structured.cause ?? '', correction: structured.correction ?? '',
          complaint: structured.complaint, first_check: structured.first_check,
        }
      } else if (type === 'bulletin') {
        payload.structuredData = {
          source: structured.source ?? '', bulletin_id: structured.bulletin_id ?? '',
          summary: structured.summary, body: structured.body, link: structured.link,
        }
      } else { // reference_doc or note
        payload.body = body
      }

      const res = await fetch('/api/knowledge/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.message || j.error || `HTTP ${res.status}`)
      }
      const { id } = (await res.json()) as { id: string }
      sessionStorage.removeItem('vk-paste-proposal')
      router.push(`/knowledge?detail=${id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed')
    } finally {
      setBusy(false)
    }
  }

  function discard() {
    if (!confirm('Throw away the paste and the AI sort?')) return
    sessionStorage.removeItem('vk-paste-proposal')
    router.push('/knowledge')
  }

  if (!hydrated) return <div className="vk-form">Loading…</div>
  if (!stored) return null

  return (
    <form className="vk-form" onSubmit={e => { e.preventDefault(); handleSave() }}>
      <FieldGroup label="Type" aiAttributed={!editedFields.has('type') && !!sources.type} source={sources.type}>
        <select value={type} onChange={e => { setType(e.target.value as SimpleType); markEdited('type') }}>
          {SIMPLE_TYPES.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
        </select>
      </FieldGroup>

      <FieldGroup label="Title" aiAttributed={!editedFields.has('title') && !!sources.title} source={sources.title}>
        <input value={title} onChange={e => { setTitle(e.target.value); markEdited('title') }} required />
      </FieldGroup>

      {(type === 'reference_doc' || type === 'note') && (
        <FieldGroup label="Body" aiAttributed={!editedFields.has('body') && !!sources.body} source={sources.body}>
          <textarea rows={8} value={body} onChange={e => { setBody(e.target.value); markEdited('body') }} required />
        </FieldGroup>
      )}

      {type === 'cause_fix' && (['complaint', 'cause', 'correction', 'first_check'] as const).map(k => (
        <FieldGroup key={k} label={k.replace('_', ' ')}
          aiAttributed={!editedFields.has(k) && !!sources[k]} source={sources[k]}>
          <textarea rows={3} value={structured[k] ?? ''}
            onChange={e => { setStructured({ ...structured, [k]: e.target.value }); markEdited(k) }}
            required={k === 'cause' || k === 'correction'} />
        </FieldGroup>
      ))}

      {type === 'bulletin' && (['source', 'bulletin_id', 'summary', 'body', 'link'] as const).map(k => (
        <FieldGroup key={k} label={k.replace('_', ' ')}
          aiAttributed={!editedFields.has(k) && !!sources[k]} source={sources[k]}>
          <input value={structured[k] ?? ''}
            onChange={e => { setStructured({ ...structured, [k]: e.target.value }); markEdited(k) }}
            required={k === 'source' || k === 'bulletin_id'} />
        </FieldGroup>
      ))}

      <FieldGroup label="DTCs" aiAttributed={!editedFields.has('dtcList') && !!sources.dtcList} source={sources.dtcList}>
        <TagInput values={dtcs} setValues={v => { setDtcs(v); markEdited('dtcList') }} placeholder="P0562" />
      </FieldGroup>

      <FieldGroup label="System codes" aiAttributed={!editedFields.has('systemCodes') && !!sources.systemCodes} source={sources.systemCodes}>
        <ChipPicker values={systemCodes} options={[...SYSTEM_CODES]}
          setValues={v => { setSystemCodes(v); markEdited('systemCodes') }} />
      </FieldGroup>

      <FieldGroup label="Symptoms" aiAttributed={!editedFields.has('symptoms') && !!sources.symptoms} source={sources.symptoms}>
        <TagInput values={symptoms} setValues={v => { setSymptoms(v); markEdited('symptoms') }} placeholder="hard_shift" />
      </FieldGroup>

      <FieldGroup label="Vehicle scope" aiAttributed={!editedFields.has('scopes') && scopes.length > 0} source={undefined}>
        <ScopeEditor scopes={scopes} setScopes={v => { setScopes(v); markEdited('scopes') }} />
      </FieldGroup>

      {error && <div className="vk-form__error">{error}</div>}

      <footer className="vk-form__actions">
        <button type="button" className="vk-btn vk-btn--ghost" onClick={discard}>Discard</button>
        <button type="button" className="vk-btn" disabled title="Drafts ship in v2">Save draft</button>
        <button type="submit" className="vk-btn vk-btn--primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </footer>
    </form>
  )
}

function FieldGroup({
  label, aiAttributed, source, children,
}: { label: string; aiAttributed: boolean; source?: string; children: React.ReactNode }) {
  return (
    <div className={`vk-fg ${aiAttributed ? 'vk-fg--ai' : ''}`}>
      <div className="vk-fg__head">
        <label className="vk-fg__label">{label}</label>
        {aiAttributed && <span className="vk-fg__badge">AI</span>}
      </div>
      <div className="vk-fg__body">{children}</div>
      {aiAttributed && source && (
        <div className="vk-fg__source">
          <span className="vk-fg__source-prefix">AI · from your paste:</span>
          <mark>{source}</mark>
        </div>
      )}
    </div>
  )
}

function TagInput({ values, setValues, placeholder }: {
  values: string[]; setValues: (v: string[]) => void; placeholder?: string
}) {
  const [draft, setDraft] = useState('')
  return (
    <div className="vk-taginput">
      {values.map((v, i) => (
        <span className="vk-taginput__chip" key={i}>
          {v}
          <button type="button" onClick={() => setValues(values.filter((_, j) => j !== i))}>×</button>
        </span>
      ))}
      <input value={draft} onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            const t = draft.trim()
            if (t) setValues([...values, t])
            setDraft('')
          }
        }}
        placeholder={placeholder} />
    </div>
  )
}

function ChipPicker({ values, options, setValues }: {
  values: string[]; options: string[]; setValues: (v: string[]) => void
}) {
  return (
    <div className="vk-chippicker">
      {options.map(o => (
        <button type="button" key={o}
          className={`vk-chip ${values.includes(o) ? 'vk-chip--active' : ''}`}
          onClick={() => {
            if (values.includes(o)) setValues(values.filter(v => v !== o))
            else setValues([...values, o])
          }}
        >{o}</button>
      ))}
    </div>
  )
}

function ScopeEditor({ scopes, setScopes }: {
  scopes: Array<{ yearStart: number; yearEnd: number; make: string; model?: string; engine?: string }>
  setScopes: (s: typeof scopes) => void
}) {
  return (
    <div className="vk-scopes">
      {scopes.map((s, i) => (
        <div className="vk-scopes__row" key={i}>
          <input type="number" value={s.yearStart} onChange={e =>
            setScopes(scopes.map((x, j) => j === i ? { ...x, yearStart: Number(e.target.value) } : x))} />
          <input type="number" value={s.yearEnd} onChange={e =>
            setScopes(scopes.map((x, j) => j === i ? { ...x, yearEnd: Number(e.target.value) } : x))} />
          <input value={s.make} placeholder="Make" onChange={e =>
            setScopes(scopes.map((x, j) => j === i ? { ...x, make: e.target.value } : x))} />
          <input value={s.model ?? ''} placeholder="Model" onChange={e =>
            setScopes(scopes.map((x, j) => j === i ? { ...x, model: e.target.value || undefined } : x))} />
          <input value={s.engine ?? ''} placeholder="Engine" onChange={e =>
            setScopes(scopes.map((x, j) => j === i ? { ...x, engine: e.target.value || undefined } : x))} />
          <button type="button" onClick={() => setScopes(scopes.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button type="button" className="vk-btn vk-btn--ghost" onClick={() =>
        setScopes([...scopes, { yearStart: 2020, yearEnd: 2020, make: '' }])}>+ Add scope row</button>
    </div>
  )
}
```

- [ ] **Step 3: TS clean**

```bash
pnpm exec tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add app/\(app\)/knowledge/review-paste/page.tsx app/\(app\)/knowledge/review-paste/review-form.tsx
git commit -m "feat(knowledge-ui): paste review form with AI source spans (PR 5 task 15)"
```

---

# Phase G — Structured forms (4 tasks, one per type)

The four forms share a single shape: server page + client form. Each form re-uses the helper components (`TagInput`, `ChipPicker`, `ScopeEditor`) — extract them in Task 16 first, then re-use across tasks 17–20.

### Task 16: Extract shared form helpers

**Files:**
- Create: `components/knowledge/form-helpers.tsx`
- Modify: `app/(app)/knowledge/review-paste/review-form.tsx` (remove local copies, import shared)

- [ ] **Step 1: Move `TagInput`, `ChipPicker`, `ScopeEditor`, `FieldGroup` from review-form.tsx into a shared file**

Create `components/knowledge/form-helpers.tsx` and paste the four components verbatim from `review-form.tsx` (use the exact source from task 15), prefix file with `'use client'`.

- [ ] **Step 2: Update review-form.tsx to import**

In `app/(app)/knowledge/review-paste/review-form.tsx`:
- Delete the local definitions of `FieldGroup`, `TagInput`, `ChipPicker`, `ScopeEditor`.
- Add `import { FieldGroup, TagInput, ChipPicker, ScopeEditor } from '@/components/knowledge/form-helpers'` at top.

- [ ] **Step 3: TS clean**

```bash
pnpm exec tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add components/knowledge/form-helpers.tsx app/\(app\)/knowledge/review-paste/review-form.tsx
git commit -m "refactor(knowledge-ui): extract shared form helpers (PR 5 task 16)"
```

---

### Task 17: Pinout form (`/knowledge/new/pinout`)

**Files:**
- Create: `app/(app)/knowledge/new/pinout/page.tsx`
- Create: `app/(app)/knowledge/new/pinout/pinout-form.tsx`

Reference: `PinoutFormStates.jsx`. Behavior:
- If `?id=<uuid>` is in URL → server pre-loads via `getKnowledgeItem` and seeds the form.
- Otherwise blank form.
- Form has: title, vehicle scope, DTC/system/symptom chips, connector_ref input, pin-rows table editor.
- Validation: pin_number unique, ≥1 pin row, ≥1 vehicle scope, title required.
- Save POSTs to `/api/knowledge/save` (new) or PATCHes to `/api/knowledge/[id]` (edit).
- On success → `/knowledge?detail=<id>`.

- [ ] **Step 1: Build the server page**

```typescript
// app/(app)/knowledge/new/pinout/page.tsx
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { getServerSupabase } from '@/lib/supabase-server'
import { db } from '@/lib/db/client'
import { profiles } from '@/lib/db/schema'
import { canCurate } from '@/lib/curator/can-curate'
import { getKnowledgeItem } from '@/lib/knowledge/get-item'
import { PinoutForm } from './pinout-form'

export const metadata = { title: 'New pinout · Knowledge' }

export default async function NewPinoutPage({
  searchParams,
}: { searchParams: Promise<{ id?: string }> }) {
  const supabase = await getServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in?next=%2Fknowledge%2Fnew%2Fpinout')
  const [profile] = await db
    .select({ role: profiles.role, shopId: profiles.shopId }).from(profiles)
    .where(eq(profiles.userId, user.id)).limit(1)
  if (!canCurate(profile?.role) || !profile?.shopId) redirect('/')

  const sp = await searchParams
  const existing = sp.id
    ? await getKnowledgeItem(db, { id: sp.id, shopId: profile.shopId })
    : null
  if (sp.id && (!existing || existing.type !== 'pinout')) redirect('/knowledge')

  return (
    <main className="vk-page">
      <header className="vk-page__head">
        <div>
          <p className="vk-page__eyebrow">{existing ? 'EDIT PINOUT' : 'NEW PINOUT'}</p>
          <h1 className="vk-page__title">{existing ? existing.title : 'New pinout'}</h1>
        </div>
      </header>
      <PinoutForm existing={existing} />
    </main>
  )
}
```

- [ ] **Step 2: Build the client form**

```typescript
// app/(app)/knowledge/new/pinout/pinout-form.tsx
'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { KnowledgeListRow } from '@/lib/knowledge/list'
import { FieldGroup, TagInput, ChipPicker, ScopeEditor } from '@/components/knowledge/form-helpers'
import { SYSTEM_CODES } from '@/lib/knowledge/constants'

type Pin = { pin_number: string; signal_name: string; wire_color?: string; expected_voltage_or_waveform?: string; notes?: string }

export function PinoutForm({ existing }: { existing: KnowledgeListRow | null }) {
  const router = useRouter()
  const sd = (existing?.structuredData ?? {}) as { connector_ref?: string; pins?: Pin[] }

  const [title, setTitle] = useState(existing?.title ?? '')
  const [connectorRef, setConnectorRef] = useState(sd.connector_ref ?? '')
  const [pins, setPins] = useState<Pin[]>(sd.pins ?? [{ pin_number: '1', signal_name: '' }])
  const [dtcs, setDtcs] = useState<string[]>(existing?.dtcList ?? [])
  const [systemCodes, setSystemCodes] = useState<string[]>(existing?.systemCodes ?? [])
  const [symptoms, setSymptoms] = useState<string[]>(existing?.symptoms ?? [])
  const [scopes, setScopes] = useState(existing?.vehicleScopes.map(s => ({
    yearStart: s.yearStart, yearEnd: s.yearEnd, make: s.make,
    model: s.model ?? undefined, engine: s.engine ?? undefined,
  })) ?? [{ yearStart: 2020, yearEnd: 2020, make: '' }])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const duplicatePin = pins.length !== new Set(pins.map(p => p.pin_number)).size

  async function handleSave() {
    if (busy) return
    if (duplicatePin) { setError('duplicate pin numbers'); return }
    setBusy(true); setError(null)
    try {
      const payload = {
        type: 'pinout' as const,
        title,
        structuredData: { connector_ref: connectorRef, pins },
        dtcList: dtcs, systemCodes, symptoms, vehicleScopes: scopes,
      }
      const url = existing ? `/api/knowledge/${existing.id}` : '/api/knowledge/save'
      const method = existing ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method, headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.message || j.error || `HTTP ${res.status}`)
      }
      const id = existing ? existing.id : (await res.json() as { id: string }).id
      router.push(`/knowledge?detail=${id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed')
    } finally { setBusy(false) }
  }

  return (
    <form className="vk-form" onSubmit={e => { e.preventDefault(); handleSave() }}>
      <FieldGroup label="Title" aiAttributed={false}>
        <input value={title} onChange={e => setTitle(e.target.value)} required maxLength={200} />
      </FieldGroup>
      <FieldGroup label="Connector ref" aiAttributed={false}>
        <input value={connectorRef} onChange={e => setConnectorRef(e.target.value)}
          required maxLength={120} placeholder="C171 or component name" />
      </FieldGroup>

      <FieldGroup label="Vehicle scope" aiAttributed={false}>
        <ScopeEditor scopes={scopes} setScopes={setScopes} />
      </FieldGroup>

      <FieldGroup label="DTCs" aiAttributed={false}>
        <TagInput values={dtcs} setValues={setDtcs} placeholder="P0562" />
      </FieldGroup>

      <FieldGroup label="System codes" aiAttributed={false}>
        <ChipPicker values={systemCodes} options={[...SYSTEM_CODES]} setValues={setSystemCodes} />
      </FieldGroup>

      <FieldGroup label="Symptoms" aiAttributed={false}>
        <TagInput values={symptoms} setValues={setSymptoms} placeholder="battery_light_intermittent" />
      </FieldGroup>

      <FieldGroup label="Pin table" aiAttributed={false}>
        <table className="vk-pintable">
          <thead><tr><th>Pin</th><th>Signal</th><th>Wire</th><th>Expected</th><th>Notes</th><th></th></tr></thead>
          <tbody>
            {pins.map((p, i) => (
              <tr key={i}>
                <td><input value={p.pin_number} onChange={e =>
                  setPins(pins.map((x, j) => j === i ? { ...x, pin_number: e.target.value } : x))} /></td>
                <td><input value={p.signal_name} onChange={e =>
                  setPins(pins.map((x, j) => j === i ? { ...x, signal_name: e.target.value } : x))} /></td>
                <td><input value={p.wire_color ?? ''} onChange={e =>
                  setPins(pins.map((x, j) => j === i ? { ...x, wire_color: e.target.value || undefined } : x))} /></td>
                <td><input value={p.expected_voltage_or_waveform ?? ''} onChange={e =>
                  setPins(pins.map((x, j) => j === i ? { ...x, expected_voltage_or_waveform: e.target.value || undefined } : x))} /></td>
                <td><input value={p.notes ?? ''} onChange={e =>
                  setPins(pins.map((x, j) => j === i ? { ...x, notes: e.target.value || undefined } : x))} /></td>
                <td><button type="button" onClick={() => setPins(pins.filter((_, j) => j !== i))}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="vk-btn vk-btn--ghost" onClick={() =>
          setPins([...pins, { pin_number: String(pins.length + 1), signal_name: '' }])}>+ Add pin</button>
        {duplicatePin && <div className="vk-form__error">Duplicate pin numbers</div>}
      </FieldGroup>

      {error && <div className="vk-form__error">{error}</div>}

      <footer className="vk-form__actions">
        <button type="button" className="vk-btn vk-btn--ghost" onClick={() => router.push('/knowledge')}>Cancel</button>
        <button type="submit" className="vk-btn vk-btn--primary" disabled={busy || duplicatePin}>
          {busy ? 'Saving…' : existing ? 'Save changes' : 'Save'}
        </button>
      </footer>
    </form>
  )
}
```

- [ ] **Step 3: TS clean**

```bash
pnpm exec tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add app/\(app\)/knowledge/new/pinout/
git commit -m "feat(knowledge-ui): pinout form (PR 5 task 17)"
```

---

### Task 18: Connector form (`/knowledge/new/connector`)

**Files:**
- Create: `app/(app)/knowledge/new/connector/page.tsx`
- Create: `app/(app)/knowledge/new/connector/connector-form.tsx`

Reference: `ConnectorFormStates.jsx`. Behavior: same scaffolding as pinout but with `connector_id`, `component_name`, `location_description` text fields + two `<ImageUpload>` tiles (in-place required, mating-end optional). Image upload POSTs to existing `/api/knowledge/upload-image`, stores the returned URL.

- [ ] **Step 1: Build server page (mirror pinout/page.tsx with type='connector')**

```typescript
// app/(app)/knowledge/new/connector/page.tsx
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { getServerSupabase } from '@/lib/supabase-server'
import { db } from '@/lib/db/client'
import { profiles } from '@/lib/db/schema'
import { canCurate } from '@/lib/curator/can-curate'
import { getKnowledgeItem } from '@/lib/knowledge/get-item'
import { ConnectorForm } from './connector-form'

export const metadata = { title: 'New connector · Knowledge' }

export default async function NewConnectorPage({
  searchParams,
}: { searchParams: Promise<{ id?: string }> }) {
  const supabase = await getServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in?next=%2Fknowledge%2Fnew%2Fconnector')
  const [profile] = await db
    .select({ role: profiles.role, shopId: profiles.shopId }).from(profiles)
    .where(eq(profiles.userId, user.id)).limit(1)
  if (!canCurate(profile?.role) || !profile?.shopId) redirect('/')
  const sp = await searchParams
  const existing = sp.id
    ? await getKnowledgeItem(db, { id: sp.id, shopId: profile.shopId })
    : null
  if (sp.id && (!existing || existing.type !== 'connector')) redirect('/knowledge')

  return (
    <main className="vk-page">
      <header className="vk-page__head">
        <div>
          <p className="vk-page__eyebrow">{existing ? 'EDIT CONNECTOR' : 'NEW CONNECTOR'}</p>
          <h1 className="vk-page__title">{existing ? existing.title : 'New connector'}</h1>
        </div>
      </header>
      <ConnectorForm existing={existing} />
    </main>
  )
}
```

- [ ] **Step 2: Build client form with ImageUpload helper**

```typescript
// app/(app)/knowledge/new/connector/connector-form.tsx
'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { KnowledgeListRow } from '@/lib/knowledge/list'
import { FieldGroup, TagInput, ChipPicker, ScopeEditor } from '@/components/knowledge/form-helpers'
import { ImageUpload } from '@/components/knowledge/image-upload'
import { SYSTEM_CODES } from '@/lib/knowledge/constants'

export function ConnectorForm({ existing }: { existing: KnowledgeListRow | null }) {
  const router = useRouter()
  const sd = (existing?.structuredData ?? {}) as Record<string, string>
  const [title, setTitle] = useState(existing?.title ?? '')
  const [connectorId, setConnectorId] = useState(sd.connector_id ?? '')
  const [componentName, setComponentName] = useState(sd.component_name ?? '')
  const [location, setLocation] = useState(sd.location_description ?? '')
  const [imageRef, setImageRef] = useState<string>(sd.image_ref ?? '')
  const [matingImageRef, setMatingImageRef] = useState<string>(sd.mating_end_image_ref ?? '')
  const [dtcs, setDtcs] = useState<string[]>(existing?.dtcList ?? [])
  const [systemCodes, setSystemCodes] = useState<string[]>(existing?.systemCodes ?? [])
  const [symptoms, setSymptoms] = useState<string[]>(existing?.symptoms ?? [])
  const [scopes, setScopes] = useState(existing?.vehicleScopes.map(s => ({
    yearStart: s.yearStart, yearEnd: s.yearEnd, make: s.make,
    model: s.model ?? undefined, engine: s.engine ?? undefined,
  })) ?? [{ yearStart: 2020, yearEnd: 2020, make: '' }])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (busy) return
    if (!imageRef) { setError('In-place image is required'); return }
    setBusy(true); setError(null)
    try {
      const payload = {
        type: 'connector' as const, title,
        structuredData: {
          connector_id: connectorId, component_name: componentName,
          location_description: location || undefined,
          image_ref: imageRef, mating_end_image_ref: matingImageRef || undefined,
        },
        dtcList: dtcs, systemCodes, symptoms, vehicleScopes: scopes,
      }
      const url = existing ? `/api/knowledge/${existing.id}` : '/api/knowledge/save'
      const method = existing ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method, headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.message || j.error || `HTTP ${res.status}`)
      }
      const id = existing ? existing.id : (await res.json() as { id: string }).id
      router.push(`/knowledge?detail=${id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed')
    } finally { setBusy(false) }
  }

  return (
    <form className="vk-form" onSubmit={e => { e.preventDefault(); handleSave() }}>
      <FieldGroup label="Title" aiAttributed={false}>
        <input value={title} onChange={e => setTitle(e.target.value)} required maxLength={200} />
      </FieldGroup>
      <FieldGroup label="Connector ID" aiAttributed={false}>
        <input value={connectorId} onChange={e => setConnectorId(e.target.value)} required maxLength={60} />
      </FieldGroup>
      <FieldGroup label="Component" aiAttributed={false}>
        <input value={componentName} onChange={e => setComponentName(e.target.value)} required maxLength={120} />
      </FieldGroup>
      <FieldGroup label="Location" aiAttributed={false}>
        <textarea rows={3} value={location} onChange={e => setLocation(e.target.value)} maxLength={2_000} />
      </FieldGroup>

      <FieldGroup label="In-place image (required)" aiAttributed={false}>
        <ImageUpload value={imageRef} onChange={setImageRef} />
      </FieldGroup>
      <FieldGroup label="Mating end image (optional)" aiAttributed={false}>
        <ImageUpload value={matingImageRef} onChange={setMatingImageRef} />
      </FieldGroup>

      <FieldGroup label="Vehicle scope" aiAttributed={false}>
        <ScopeEditor scopes={scopes} setScopes={setScopes} />
      </FieldGroup>
      <FieldGroup label="DTCs" aiAttributed={false}>
        <TagInput values={dtcs} setValues={setDtcs} placeholder="P0562" />
      </FieldGroup>
      <FieldGroup label="System codes" aiAttributed={false}>
        <ChipPicker values={systemCodes} options={[...SYSTEM_CODES]} setValues={setSystemCodes} />
      </FieldGroup>
      <FieldGroup label="Symptoms" aiAttributed={false}>
        <TagInput values={symptoms} setValues={setSymptoms} placeholder="battery_light_intermittent" />
      </FieldGroup>

      {error && <div className="vk-form__error">{error}</div>}

      <footer className="vk-form__actions">
        <button type="button" className="vk-btn vk-btn--ghost" onClick={() => router.push('/knowledge')}>Cancel</button>
        <button type="submit" className="vk-btn vk-btn--primary" disabled={busy}>
          {busy ? 'Saving…' : existing ? 'Save changes' : 'Save'}
        </button>
      </footer>
    </form>
  )
}
```

- [ ] **Step 3: Create the image-upload helper**

```typescript
// components/knowledge/image-upload.tsx
'use client'
import { useRef, useState } from 'react'

const MAX_MB = 10

export function ImageUpload({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function upload(file: File) {
    setError(null)
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`That's ${(file.size / 1024 / 1024).toFixed(1)} MB — pick something under ${MAX_MB} MB.`)
      return
    }
    if (!/^image\/(jpeg|png|svg\+xml)$/.test(file.type)) {
      setError(`Unsupported format ${file.type}. JPG, PNG, or SVG only.`)
      return
    }
    setBusy(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/knowledge/upload-image', { method: 'POST', body: form })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.message || j.error || `HTTP ${res.status}`)
      }
      const { url } = (await res.json()) as { url: string }
      onChange(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'upload failed')
    } finally { setBusy(false) }
  }

  if (value) {
    return (
      <div className="vk-imgupload vk-imgupload--filled">
        <img src={value} alt="" />
        <div className="vk-imgupload__meta">
          <button type="button" className="vk-btn vk-btn--ghost" onClick={() => fileInput.current?.click()}>
            Replace
          </button>
          <button type="button" className="vk-btn vk-btn--ghost" onClick={() => onChange('')}>Remove</button>
        </div>
        <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/svg+xml" hidden
          onChange={e => { const f = e.target.files?.[0]; if (f) upload(f) }} />
      </div>
    )
  }

  return (
    <label className="vk-imgupload vk-imgupload--empty">
      <input type="file" accept="image/jpeg,image/png,image/svg+xml"
        onChange={e => { const f = e.target.files?.[0]; if (f) upload(f) }} />
      <span className="vk-imgupload__prompt">{busy ? 'Uploading…' : 'Drop the image, or click to pick.'}</span>
      <span className="vk-imgupload__hint">JPG · PNG · SVG · ≤ {MAX_MB} MB</span>
      {error && <span className="vk-imgupload__error">{error}</span>}
    </label>
  )
}
```

- [ ] **Step 4: TS clean**

```bash
pnpm exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/knowledge/new/connector/ components/knowledge/image-upload.tsx
git commit -m "feat(knowledge-ui): connector form + image-upload helper (PR 5 task 18)"
```

---

### Task 19: Wiring form (`/knowledge/new/wiring`)

**Files:**
- Create: `app/(app)/knowledge/new/wiring/page.tsx`
- Create: `app/(app)/knowledge/new/wiring/wiring-form.tsx`

Reference: `WiringFormStates.jsx`. Same scaffolding as pinout but with:
- `name` text input
- `image_ref` (required, via `ImageUpload`)
- `connections` table editor (optional rows)

- [ ] **Step 1: Server page (mirror connector/page.tsx with type='wiring_diagram')**

(Copy connector/page.tsx, rename `ConnectorForm`→`WiringForm`, change paths and metadata.)

- [ ] **Step 2: Client form**

```typescript
// app/(app)/knowledge/new/wiring/wiring-form.tsx
'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { KnowledgeListRow } from '@/lib/knowledge/list'
import { FieldGroup, TagInput, ChipPicker, ScopeEditor } from '@/components/knowledge/form-helpers'
import { ImageUpload } from '@/components/knowledge/image-upload'
import { SYSTEM_CODES } from '@/lib/knowledge/constants'

type Conn = {
  from_component: string; from_pin?: string; to_component: string; to_pin?: string;
  wire_color?: string; splice_id?: string; notes?: string
}

export function WiringForm({ existing }: { existing: KnowledgeListRow | null }) {
  const router = useRouter()
  const sd = (existing?.structuredData ?? {}) as { name?: string; image_ref?: string; connections?: Conn[] }
  const [title, setTitle] = useState(existing?.title ?? '')
  const [name, setName] = useState(sd.name ?? '')
  const [imageRef, setImageRef] = useState<string>(sd.image_ref ?? '')
  const [connections, setConnections] = useState<Conn[]>(sd.connections ?? [])
  const [dtcs, setDtcs] = useState<string[]>(existing?.dtcList ?? [])
  const [systemCodes, setSystemCodes] = useState<string[]>(existing?.systemCodes ?? [])
  const [symptoms, setSymptoms] = useState<string[]>(existing?.symptoms ?? [])
  const [scopes, setScopes] = useState(existing?.vehicleScopes.map(s => ({
    yearStart: s.yearStart, yearEnd: s.yearEnd, make: s.make,
    model: s.model ?? undefined, engine: s.engine ?? undefined,
  })) ?? [{ yearStart: 2020, yearEnd: 2020, make: '' }])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (busy) return
    if (!imageRef) { setError('Diagram image is required'); return }
    setBusy(true); setError(null)
    try {
      const payload = {
        type: 'wiring_diagram' as const, title,
        structuredData: { name: name || title, image_ref: imageRef, connections },
        dtcList: dtcs, systemCodes, symptoms, vehicleScopes: scopes,
      }
      const url = existing ? `/api/knowledge/${existing.id}` : '/api/knowledge/save'
      const method = existing ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method, headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.message || j.error || `HTTP ${res.status}`)
      }
      const id = existing ? existing.id : (await res.json() as { id: string }).id
      router.push(`/knowledge?detail=${id}`)
    } catch (e) { setError(e instanceof Error ? e.message : 'save failed') }
    finally { setBusy(false) }
  }

  return (
    <form className="vk-form" onSubmit={e => { e.preventDefault(); handleSave() }}>
      <FieldGroup label="Title" aiAttributed={false}>
        <input value={title} onChange={e => setTitle(e.target.value)} required maxLength={200} />
      </FieldGroup>
      <FieldGroup label="Diagram name" aiAttributed={false}>
        <input value={name} onChange={e => setName(e.target.value)} maxLength={200}
          placeholder="defaults to title if blank" />
      </FieldGroup>
      <FieldGroup label="Diagram image (required)" aiAttributed={false}>
        <ImageUpload value={imageRef} onChange={setImageRef} />
      </FieldGroup>

      <FieldGroup label="Vehicle scope" aiAttributed={false}>
        <ScopeEditor scopes={scopes} setScopes={setScopes} />
      </FieldGroup>
      <FieldGroup label="DTCs" aiAttributed={false}>
        <TagInput values={dtcs} setValues={setDtcs} placeholder="P0562" />
      </FieldGroup>
      <FieldGroup label="System codes" aiAttributed={false}>
        <ChipPicker values={systemCodes} options={[...SYSTEM_CODES]} setValues={setSystemCodes} />
      </FieldGroup>
      <FieldGroup label="Symptoms" aiAttributed={false}>
        <TagInput values={symptoms} setValues={setSymptoms} placeholder="battery_light_intermittent" />
      </FieldGroup>

      <FieldGroup label="Connections (optional)" aiAttributed={false}>
        <table className="vk-conntable">
          <thead><tr><th>From</th><th>Pin</th><th>To</th><th>Pin</th><th>Wire</th><th>Splice</th><th>Notes</th><th></th></tr></thead>
          <tbody>
            {connections.map((c, i) => (
              <tr key={i}>
                <td><input value={c.from_component} onChange={e =>
                  setConnections(connections.map((x, j) => j === i ? { ...x, from_component: e.target.value } : x))} /></td>
                <td><input value={c.from_pin ?? ''} onChange={e =>
                  setConnections(connections.map((x, j) => j === i ? { ...x, from_pin: e.target.value || undefined } : x))} /></td>
                <td><input value={c.to_component} onChange={e =>
                  setConnections(connections.map((x, j) => j === i ? { ...x, to_component: e.target.value } : x))} /></td>
                <td><input value={c.to_pin ?? ''} onChange={e =>
                  setConnections(connections.map((x, j) => j === i ? { ...x, to_pin: e.target.value || undefined } : x))} /></td>
                <td><input value={c.wire_color ?? ''} onChange={e =>
                  setConnections(connections.map((x, j) => j === i ? { ...x, wire_color: e.target.value || undefined } : x))} /></td>
                <td><input value={c.splice_id ?? ''} onChange={e =>
                  setConnections(connections.map((x, j) => j === i ? { ...x, splice_id: e.target.value || undefined } : x))} /></td>
                <td><input value={c.notes ?? ''} onChange={e =>
                  setConnections(connections.map((x, j) => j === i ? { ...x, notes: e.target.value || undefined } : x))} /></td>
                <td><button type="button" onClick={() => setConnections(connections.filter((_, j) => j !== i))}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="vk-btn vk-btn--ghost" onClick={() =>
          setConnections([...connections, { from_component: '', to_component: '' }])}>+ Add connection</button>
      </FieldGroup>

      {error && <div className="vk-form__error">{error}</div>}

      <footer className="vk-form__actions">
        <button type="button" className="vk-btn vk-btn--ghost" onClick={() => router.push('/knowledge')}>Cancel</button>
        <button type="submit" className="vk-btn vk-btn--primary" disabled={busy}>
          {busy ? 'Saving…' : existing ? 'Save changes' : 'Save'}
        </button>
      </footer>
    </form>
  )
}
```

- [ ] **Step 3: TS clean + commit**

```bash
pnpm exec tsc --noEmit
git add app/\(app\)/knowledge/new/wiring/
git commit -m "feat(knowledge-ui): wiring-diagram form (PR 5 task 19)"
```

---

### Task 20: Theory form (`/knowledge/new/theory`)

**Files:**
- Create: `app/(app)/knowledge/new/theory/page.tsx`
- Create: `app/(app)/knowledge/new/theory/theory-form.tsx`

Reference: `TheoryFormStates.jsx`. Sections editor: ≥1 section, each `{ heading, body }`.

- [ ] **Step 1: Server page (mirror wiring/page.tsx with type='theory_of_operation')**

(Copy wiring/page.tsx, rename to TheoryForm, change paths and metadata.)

- [ ] **Step 2: Client form**

```typescript
// app/(app)/knowledge/new/theory/theory-form.tsx
'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { KnowledgeListRow } from '@/lib/knowledge/list'
import { FieldGroup, TagInput, ChipPicker, ScopeEditor } from '@/components/knowledge/form-helpers'
import { SYSTEM_CODES } from '@/lib/knowledge/constants'

type Section = { heading: string; body: string }

export function TheoryForm({ existing }: { existing: KnowledgeListRow | null }) {
  const router = useRouter()
  const sd = (existing?.structuredData ?? {}) as { title?: string; sections?: Section[] }
  const [title, setTitle] = useState(existing?.title ?? '')
  const [theoryTitle, setTheoryTitle] = useState(sd.title ?? '')
  const [sections, setSections] = useState<Section[]>(sd.sections ?? [{ heading: '', body: '' }])
  const [dtcs, setDtcs] = useState<string[]>(existing?.dtcList ?? [])
  const [systemCodes, setSystemCodes] = useState<string[]>(existing?.systemCodes ?? [])
  const [symptoms, setSymptoms] = useState<string[]>(existing?.symptoms ?? [])
  const [scopes, setScopes] = useState(existing?.vehicleScopes.map(s => ({
    yearStart: s.yearStart, yearEnd: s.yearEnd, make: s.make,
    model: s.model ?? undefined, engine: s.engine ?? undefined,
  })) ?? [{ yearStart: 2020, yearEnd: 2020, make: '' }])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (busy) return
    setBusy(true); setError(null)
    try {
      const payload = {
        type: 'theory_of_operation' as const, title,
        structuredData: { title: theoryTitle || title, sections },
        dtcList: dtcs, systemCodes, symptoms, vehicleScopes: scopes,
      }
      const url = existing ? `/api/knowledge/${existing.id}` : '/api/knowledge/save'
      const method = existing ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method, headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.message || j.error || `HTTP ${res.status}`)
      }
      const id = existing ? existing.id : (await res.json() as { id: string }).id
      router.push(`/knowledge?detail=${id}`)
    } catch (e) { setError(e instanceof Error ? e.message : 'save failed') }
    finally { setBusy(false) }
  }

  return (
    <form className="vk-form" onSubmit={e => { e.preventDefault(); handleSave() }}>
      <FieldGroup label="Title" aiAttributed={false}>
        <input value={title} onChange={e => setTitle(e.target.value)} required maxLength={200} />
      </FieldGroup>
      <FieldGroup label="Theory title" aiAttributed={false}>
        <input value={theoryTitle} onChange={e => setTheoryTitle(e.target.value)} maxLength={200}
          placeholder="defaults to title if blank" />
      </FieldGroup>

      <FieldGroup label="Sections (≥ 1)" aiAttributed={false}>
        {sections.map((s, i) => (
          <div className="vk-section-row" key={i}>
            <span className="vk-section-row__num">{i + 1}</span>
            <div className="vk-section-row__body">
              <input className="vk-section-row__head" value={s.heading} placeholder="Heading"
                onChange={e => setSections(sections.map((x, j) => j === i ? { ...x, heading: e.target.value } : x))} />
              <textarea rows={4} value={s.body} placeholder="Body"
                onChange={e => setSections(sections.map((x, j) => j === i ? { ...x, body: e.target.value } : x))} />
            </div>
            <button type="button" disabled={sections.length === 1}
              onClick={() => setSections(sections.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        <button type="button" className="vk-btn vk-btn--ghost"
          onClick={() => setSections([...sections, { heading: '', body: '' }])}>+ Add section</button>
      </FieldGroup>

      <FieldGroup label="Vehicle scope" aiAttributed={false}>
        <ScopeEditor scopes={scopes} setScopes={setScopes} />
      </FieldGroup>
      <FieldGroup label="DTCs" aiAttributed={false}>
        <TagInput values={dtcs} setValues={setDtcs} placeholder="P0562" />
      </FieldGroup>
      <FieldGroup label="System codes" aiAttributed={false}>
        <ChipPicker values={systemCodes} options={[...SYSTEM_CODES]} setValues={setSystemCodes} />
      </FieldGroup>
      <FieldGroup label="Symptoms" aiAttributed={false}>
        <TagInput values={symptoms} setValues={setSymptoms} placeholder="rough_idle" />
      </FieldGroup>

      {error && <div className="vk-form__error">{error}</div>}

      <footer className="vk-form__actions">
        <button type="button" className="vk-btn vk-btn--ghost" onClick={() => router.push('/knowledge')}>Cancel</button>
        <button type="submit" className="vk-btn vk-btn--primary" disabled={busy}>
          {busy ? 'Saving…' : existing ? 'Save changes' : 'Save'}
        </button>
      </footer>
    </form>
  )
}
```

- [ ] **Step 3: TS clean + commit**

```bash
pnpm exec tsc --noEmit
git add app/\(app\)/knowledge/new/theory/
git commit -m "feat(knowledge-ui): theory-of-operation form (PR 5 task 20)"
```

---

# Phase H — Nav link

### Task 21: Add owner-gated `/knowledge` link to today-home

**Files:**
- Modify: `components/screens/today-home.tsx`

- [ ] **Step 1: Add the link**

In `components/screens/today-home.tsx`, find the `canCurate &&` block (around line 49 — the `/curator` "Reviewer →" link). Add a second link immediately after it, before the `canWriteCounterOrder` block:

```typescript
{canCurate && (
  <Link
    href="/knowledge"
    aria-label="Knowledge"
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '6px 12px',
      fontSize: 13,
      textDecoration: 'none',
      color: 'var(--vt-fg-2)',
      fontFamily: 'var(--vt-font-mono)',
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
    }}
  >
    Knowledge →
  </Link>
)}
```

- [ ] **Step 2: TS clean + commit**

```bash
pnpm exec tsc --noEmit
git add components/screens/today-home.tsx
git commit -m "feat(knowledge-ui): owner-gated 'Knowledge →' link on /today (PR 5 task 21)"
```

---

# Phase I — Cleanup

### Task 22: Delete placeholder paste-form.tsx and rich-form.tsx

**Files:**
- Delete: `app/(app)/knowledge/paste-form.tsx`
- Delete: `app/(app)/knowledge/rich-form.tsx`

These were placeholders from PR 2/3 and are now superseded by `components/knowledge/paste-sheet.tsx` + the per-type form routes.

- [ ] **Step 1: Confirm no other files import them**

```bash
grep -rn 'KnowledgePasteForm\|RichKnowledgeForm' app/ components/ lib/ tests/ --include='*.tsx' --include='*.ts' 2>/dev/null | grep -v 'paste-form\.tsx\|rich-form\.tsx'
```

Expected: only the page.tsx import is left, and the page.tsx was already rewritten in Task 12 — should be 0 hits.

If hits: investigate and fix before deleting.

- [ ] **Step 2: Delete and verify build**

```bash
rm app/\(app\)/knowledge/paste-form.tsx app/\(app\)/knowledge/rich-form.tsx
pnpm exec tsc --noEmit
pnpm build 2>&1 | tail -10
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add -A app/\(app\)/knowledge/
git commit -m "chore(knowledge-ui): delete PR 2/3 placeholder forms (PR 5 task 22)"
```

---

# Phase J — E2E tests

### Task 23: Owner happy-path Playwright spec

**Files:**
- Create: `tests/e2e/knowledge.spec.ts`

Cover: owner navigates to `/knowledge` → sees list (likely empty) → clicks "+ Add knowledge" → picks Pinout → fills form → saves → drawer opens with new item → edits title → retires → restores → mobile viewport snapshot.

The existing `tests/e2e/curator.spec.ts` is the closest analog for setup and auth helpers — read it first to match the pattern.

- [ ] **Step 1: Inspect the curator e2e setup helper**

```bash
cat tests/e2e/curator.spec.ts | head -40
```

Note how it logs in / picks a user / handles base URL. The new spec follows the same pattern.

- [ ] **Step 2: Write `tests/e2e/knowledge.spec.ts`**

```typescript
import { test, expect } from '@playwright/test'
// Reuse the existing auth helper pattern from curator.spec.ts.
// (Adapt these imports to whatever helper your e2e setup uses.)

test.describe('Knowledge UI — owner flow', () => {
  test.beforeEach(async ({ page }) => {
    // Sign in as the e2e owner test user.
    // Follow the same login flow as tests/e2e/curator.spec.ts.
    await page.goto('/')
    // ...login steps...
  })

  test('owner can add a pinout, edit it, retire and restore', async ({ page }) => {
    await page.goto('/knowledge')
    await expect(page.getByRole('heading', { name: 'Knowledge' })).toBeVisible()

    // Open picker
    await page.getByRole('link', { name: /Add knowledge/i }).click()
    await page.getByRole('link', { name: /Pinout/i }).click()
    await expect(page).toHaveURL(/\/knowledge\/new\/pinout/)

    // Fill the pinout form
    await page.getByLabel('Title').fill('E2E test pinout — alternator')
    await page.getByLabel('Connector ref').fill('C171')
    // Add one vehicle scope
    await page.getByPlaceholder('Make').first().fill('Ford')
    // Pin row already starts with pin 1
    await page.getByPlaceholder(/Signal/i, { exact: false }).first().or(
      page.locator('input').nth(2)
    ).fill('B+ sense').catch(() => undefined)
    // Save
    await page.getByRole('button', { name: 'Save' }).click()

    // Drawer should open with the new item
    await expect(page).toHaveURL(/detail=/)
    await expect(page.getByText('E2E test pinout — alternator')).toBeVisible()

    // Retire
    page.on('dialog', d => d.accept())
    await page.getByRole('button', { name: 'Retire' }).click()
    await expect(page.getByText('RETIRED')).toBeVisible({ timeout: 10_000 })

    // Restore (within 24h window — should be immediately available)
    await page.getByRole('button', { name: 'Restore' }).click()
    await expect(page.getByText('RETIRED')).toBeHidden({ timeout: 10_000 })
  })

  test('renders on iPhone 15 viewport (393×852)', async ({ page }) => {
    await page.setViewportSize({ width: 393, height: 852 })
    await page.goto('/knowledge')
    await expect(page.getByRole('heading', { name: 'Knowledge' })).toBeVisible()
    await expect(page.getByRole('link', { name: /Add knowledge/i })).toBeVisible()
  })
})

test.describe('Knowledge UI — tech-role gate', () => {
  test('tech role is redirected away from /knowledge', async ({ page }) => {
    // Sign in as the e2e tech-role user (no curator/owner role).
    // ...login steps from curator.spec.ts adapted for tech...
    await page.goto('/knowledge')
    await expect(page).not.toHaveURL(/\/knowledge$/)
  })
})
```

- [ ] **Step 3: Run the spec**

```bash
pnpm exec playwright test tests/e2e/knowledge.spec.ts --reporter=list 2>&1 | tail -40
```

If the existing test setup needs an owner-role user that isn't seeded, follow the same seeding pattern used in `tests/e2e/curator.spec.ts`. Iterate until green.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/knowledge.spec.ts
git commit -m "test(knowledge-ui): e2e owner happy-path + tech 403 + mobile viewport (PR 5 task 23)"
```

---

# Phase K — Final verification

### Task 24: Full verification + push

**Files:** none (verification only)

- [ ] **Step 1: Run all unit tests**

```bash
pnpm test 2>&1 | tail -20
```

Expected: all green. If PGlite fork-pool flake appears (per memory `feedback_vitest_pglite_flake`), re-run once.

- [ ] **Step 2: TypeScript clean**

```bash
pnpm exec tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Production build clean**

```bash
pnpm build 2>&1 | tail -20
```

Expected: successful build.

- [ ] **Step 4: Mobile smoke check on Vercel preview**

Once the branch is pushed:
- Open the Vercel preview URL on `iPhone 15 (393px)` viewport
- Verify: knowledge page header reads, filter chips visible, picker rises as bottom-sheet on mobile, paste sheet is full-bleed on mobile, drawer is bottom-sheet on mobile, forms are single-column
- Verify: tech-role user is redirected away from `/knowledge`
- Verify: owner can add at least one pinout end-to-end

- [ ] **Step 5: Push branch + open PR**

```bash
git push -u origin feat/knowledge-page-ui
```

Then Brandon opens the PR via GitHub UI from `feat/knowledge-page-ui` → `staging` and validates on the preview.

- [ ] **Step 6: Print the next paste-line**

At the end of the final session message, print verbatim:

> Continue PR 6 of the vehicle knowledge platform. Read `docs/superpowers/handoffs/2026-05-16-knowledge-pr6-kickoff.md` and execute it.

---

## Self-review checklist

Before declaring the plan complete, verify:

1. **Spec coverage** — Every bullet in the kickoff scope is mapped to a task:
   - `/knowledge` page → Task 12
   - 5 contribution forms → Tasks 14–15 (paste flow) + 17–20 (rich forms)
   - `GET /api/knowledge` → Task 6
   - `GET/PATCH/DELETE /api/knowledge/[id]` → Task 7
   - `POST /api/knowledge/[id]/restore` → Task 8
   - Card detail drawer → Task 11
   - Top-nav link → Task 21
   - Owner-gating → in every server page + every API route
   - Mobile validation → Task 23 + Task 24 step 4
   - Integration tests for paste→save → existing PR 2/3 tests cover; review form is client-only
   - Integration tests for structured form per type → existing PR 3 tests cover save route per type
   - Integration tests for list filters → Task 2 (lib) + Task 6 (route)
   - E2E owner add/edit/retire/restore → Task 23
   - E2E tech 403 → Task 23
2. **No placeholders** — All steps have concrete code or commands.
3. **Type consistency** — `KnowledgeListRow` is used by list/get/drawer/forms consistently. `KnowledgeListFilter` is used by both `lib/list.ts` and the API route.

---

## Where to ask for help

If any task hits a blocker:
- API/lib task fails → re-read the existing `tests/helpers/test-db.ts` setup; check whether `createShop()` actually exists or needs writing.
- Form behavior diverges from design → open the corresponding `*States.jsx` in `designs/design_handoff_vehicle_knowledge/` and check the JSX shape.
- CSS class doesn't render → confirm `components/knowledge/knowledge.css` was imported into the build (Task 1 step 2).
- E2E fails on auth → match the existing `tests/e2e/curator.spec.ts` pattern exactly.
