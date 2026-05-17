# PR 4 — Retrieval + AI Tools — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add vetted-knowledge retrieval as Anthropic tool-use that the diagnostic AI calls when a vehicle-specific fact is needed. Empty results MUST fall through silently — no refusal language to the tech.

**Architecture:**
- Pure SQL retrieval lives in `lib/knowledge/retrieval.ts` (one function per AI tool, no AI in the path).
- Tool definitions in `lib/knowledge/tools.ts` (Anthropic's tool-use shape).
- `lib/ai/tree-engine.ts` adds a tool-use loop (first in the codebase) — when the AI returns `tool_use` blocks, execute, append `tool_result`, repeat; when it returns text only, parse JSON.
- Wrappers in `lib/retrieval/wire-into-tree.ts` close over `shopId` and pass a bound dispatcher into tree-engine.
- Routes return `citedItems` + `consultedItems` as additive payload fields.
- System prompt clauses (verbatim from spec) added to `TREE_ENGINE_SYSTEM` in `lib/ai/prompts.ts`.

**Tech Stack:** TypeScript, Drizzle ORM, PGlite (test DB), Anthropic SDK (tool-use feature), Vitest.

---

## Spec references

- Master spec on branch `feat/vehicle-knowledge-platform-spec`: `docs/superpowers/specs/2026-05-16-vehicle-knowledge-platform-design.md`
- PR 4 kickoff (same branch): `docs/superpowers/handoffs/2026-05-16-knowledge-pr4-kickoff.md`
- Highest-stakes behavior: spec `### Rule 2 — Vetted DB preferred when present; fall through silently when absent` and memory `feedback_no_unvetted_technical_data`.

## File map

**New files:**
- `lib/knowledge/retrieval.ts` — 6 SQL-backed retrieval functions + `fire_count` increment.
- `lib/knowledge/tools.ts` — Anthropic Tool shapes (6 tools).
- `lib/knowledge/citations.ts` — extract `[ref:item_id]` markers from AI message; hydrate from `consultedItems`.
- `tests/unit/knowledge-retrieval.test.ts` — PGlite-backed tests for the 6 functions + `fire_count`.
- `tests/unit/knowledge-tool-defs.test.ts` — Anthropic Tool schema sanity.
- `tests/unit/knowledge-citations.test.ts` — `[ref:item_id]` parser.
- `tests/unit/tree-engine-tool-loop.test.ts` — mocked tool-use → tool_result loop, max-rounds cap.
- `tests/unit/wire-into-tree-knowledge.test.ts` — wrapper binds shopId-scoped dispatcher.
- `tests/unit/knowledge-ai-session.test.ts` — AI cites tool results (integration-flavor, mocked AI).
- `tests/unit/knowledge-empty-fallthrough.test.ts` — **CRITICAL** — empty tool result → no refusal language.
- `tests/unit/knowledge-shop-scope.test.ts` — cross-shop blocked at retrieval.

**Modified files:**
- `lib/ai/prompts.ts` — append "Vehicle knowledge tools" section to `TREE_ENGINE_SYSTEM`.
- `lib/ai/tree-engine.ts` — accept tool definitions + dispatcher; tool-use loop in both `generateInitialTree` and `updateTree`; new return shape with `consultedItems`.
- `lib/retrieval/wire-into-tree.ts` — both wrapper builders accept `shopId` + dispatcher factory; return shape includes `consultedItems` and `citedItems`.
- `app/api/sessions/[id]/advance/route.ts` — plumb shopId; propagate `citedItems`/`consultedItems` to JSON response.
- `app/api/sessions/[id]/advance/stream/route.ts` — same, but as a stream event.
- `app/api/sessions/route.ts` (intake submit calls `generateInitialTree`) — same plumbing.
- `lib/sessions.ts` if it constructs the response — verify whether it touches the tree-engine return shape; if so, plumb fields through.

**Test convention deviation flagged:** spec lists `tests/integration/` paths; PR 2/3 put everything in `tests/unit/`. We follow PR 2/3's actual convention. No `tests/integration/` directory is created.

---

## Task 1: SQL retrieval — `lookupKnowledge` (sets all patterns)

**Files:**
- Create: `lib/knowledge/retrieval.ts`
- Create: `tests/unit/knowledge-retrieval.test.ts`

- [ ] **Step 1: Write the failing test scaffold + first 3 test cases for `lookupKnowledge`**

```ts
// tests/unit/knowledge-retrieval.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/db'
import { createShop, createProfile } from '@/lib/db/queries'
import { knowledgeItems, knowledgeItemVehicles } from '@/lib/db/schema'
import { lookupKnowledge } from '@/lib/knowledge/retrieval'

async function seedItem(
  db: TestDb,
  args: {
    shopId: string
    profileId: string
    title: string
    type?: 'cause_fix' | 'pinout' | 'connector' | 'wiring_diagram' | 'theory_of_operation' | 'bulletin' | 'reference_doc' | 'note'
    dtcList?: string[]
    systemCodes?: string[]
    symptoms?: string[]
    fireCount?: number
    retired?: boolean
    structuredData?: Record<string, unknown>
    scopes?: Array<{
      yearStart: number
      yearEnd: number
      make: string
      model?: string | null
      engine?: string | null
    }>
  },
): Promise<string> {
  const [item] = await db
    .insert(knowledgeItems)
    .values({
      shopId: args.shopId,
      type: args.type ?? 'cause_fix',
      title: args.title,
      dtcList: args.dtcList ?? [],
      systemCodes: args.systemCodes ?? [],
      symptoms: args.symptoms ?? [],
      fireCount: args.fireCount ?? 0,
      retired: args.retired ?? false,
      structuredData: args.structuredData ?? null,
      createdByUserId: args.profileId,
    })
    .returning()
  for (const s of args.scopes ?? [{ yearStart: 2018, yearEnd: 2020, make: 'Ford', model: 'F-250', engine: '6.7L Powerstroke' }]) {
    await db.insert(knowledgeItemVehicles).values({
      knowledgeItemId: item.id,
      yearStart: s.yearStart,
      yearEnd: s.yearEnd,
      make: s.make,
      model: s.model ?? null,
      engine: s.engine ?? null,
    })
  }
  return item.id
}

describe('lookupKnowledge', () => {
  let db: TestDb
  let shopId: string
  let profileId: string
  let otherShopId: string

  beforeEach(async () => {
    db = await createTestDb()
    const shop = await createShop(db, 'Test Shop')
    shopId = shop.id
    const profile = await createProfile(db, { email: 't@example.com', shopId })
    profileId = profile.id
    const other = await createShop(db, 'Other Shop')
    otherShopId = other.id
  })

  afterEach(async () => {
    await db.close()
  })

  it('ranks DTC overlap above system/symptom overlap', async () => {
    const dtcMatchId = await seedItem(db, {
      shopId, profileId, title: 'DTC match', dtcList: ['P0420'],
    })
    await seedItem(db, {
      shopId, profileId, title: 'System match', systemCodes: ['emissions'],
    })
    await seedItem(db, {
      shopId, profileId, title: 'Symptom match', symptoms: ['rough_idle'],
    })
    const matches = await lookupKnowledge(db, {
      shopId,
      vehicle: { year: 2019, make: 'Ford', model: 'F-250', engine: '6.7L Powerstroke' },
      dtcs: ['P0420'],
      systemCodes: ['emissions'],
      symptoms: ['rough_idle'],
      limit: 10,
    })
    expect(matches[0].id).toBe(dtcMatchId)
    expect(matches[0].score).toBe(150)
  })

  it('scopes to shopId — other shops never leak', async () => {
    await seedItem(db, {
      shopId: otherShopId, profileId, title: 'Other shop match',
      dtcList: ['P0420'],
    })
    const matches = await lookupKnowledge(db, {
      shopId,
      vehicle: { year: 2019, make: 'Ford', model: 'F-250', engine: '6.7L Powerstroke' },
      dtcs: ['P0420'],
    })
    expect(matches).toHaveLength(0)
  })

  it('excludes retired items', async () => {
    await seedItem(db, {
      shopId, profileId, title: 'Retired', dtcList: ['P0420'], retired: true,
    })
    const matches = await lookupKnowledge(db, {
      shopId,
      vehicle: { year: 2019, make: 'Ford', model: 'F-250', engine: '6.7L Powerstroke' },
      dtcs: ['P0420'],
    })
    expect(matches).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run the failing test**

```bash
pnpm test tests/unit/knowledge-retrieval.test.ts
```

Expected: FAIL with `Cannot find module '@/lib/knowledge/retrieval'`.

- [ ] **Step 3: Implement `lookupKnowledge`**

```ts
// lib/knowledge/retrieval.ts
import { sql, type SQL } from 'drizzle-orm'
import { normalizeDtc, normalizeEngine } from '@/lib/knowledge/normalize'

export type RetrievalVehicle = {
  year: number
  make: string
  model: string
  engine?: string
}

export type KnowledgeItemType =
  | 'cause_fix'
  | 'reference_doc'
  | 'bulletin'
  | 'note'
  | 'pinout'
  | 'connector'
  | 'wiring_diagram'
  | 'theory_of_operation'

export type MatchedKnowledgeItem = {
  id: string
  shopId: string
  type: KnowledgeItemType
  title: string
  body: string | null
  structuredData: Record<string, unknown> | null
  dtcList: string[]
  systemCodes: string[]
  symptoms: string[]
  fireCount: number
  score: number
}

export type LookupKnowledgeInput = {
  shopId: string
  vehicle: RetrievalVehicle
  dtcs?: string[]
  systemCodes?: string[]
  symptoms?: string[]
  typeFilter?: KnowledgeItemType
  limit?: number
}

// Postgres array literal builder. Drizzle's `sql` template interpolates JS
// arrays as a comma-spread which Postgres reads as a row constructor. The
// `&&` overlap operator needs a real `text[]`, so we build the literal
// inline. Inputs are caller-supplied; we escape single quotes defensively.
function arrayLit(arr: string[]): SQL {
  const elements = arr.map((s) => `'${s.replace(/'/g, "''")}'`).join(',')
  return sql.raw(`ARRAY[${elements}]::text[]`)
}

// Drizzle's DB type isn't exported cleanly from queries.ts; use a structural
// type so unit tests can inject the PGlite-backed test DB.
export type RetrievalDb = {
  execute<T = unknown>(query: SQL): Promise<{ rows: T[] } | T[]>
}

function rows<T>(res: { rows: T[] } | T[]): T[] {
  return Array.isArray(res) ? res : res.rows
}

type Row = {
  id: string
  shop_id: string
  type: KnowledgeItemType
  title: string
  body: string | null
  structured_data: Record<string, unknown> | null
  dtc_list: string[]
  system_codes: string[]
  symptoms: string[]
  fire_count: number
  score: number
}

function toMatched(r: Row): MatchedKnowledgeItem {
  return {
    id: r.id,
    shopId: r.shop_id,
    type: r.type,
    title: r.title,
    body: r.body,
    structuredData: r.structured_data,
    dtcList: r.dtc_list,
    systemCodes: r.system_codes,
    symptoms: r.symptoms,
    fireCount: r.fire_count,
    score: r.score,
  }
}

export async function lookupKnowledge(
  db: RetrievalDb,
  input: LookupKnowledgeInput,
): Promise<MatchedKnowledgeItem[]> {
  const normalizedDtcs = (input.dtcs ?? [])
    .map((d) => normalizeDtc(d))
    .filter((d): d is string => d !== null)
  const dtcs = arrayLit(normalizedDtcs)
  const systems = arrayLit(input.systemCodes ?? [])
  const symptoms = arrayLit(input.symptoms ?? [])
  const limit = input.limit ?? 3
  const normalizedEngine = normalizeEngine(input.vehicle.engine ?? null)
  const typeFilter = input.typeFilter ?? null

  const res = await db.execute<Row>(sql`
    SELECT items.id, items.shop_id, items.type, items.title, items.body,
      items.structured_data, items.dtc_list, items.system_codes, items.symptoms,
      items.fire_count,
      ((CASE WHEN items.dtc_list && ${dtcs} THEN 100 ELSE 0 END) +
       (CASE WHEN items.system_codes && ${systems} THEN 25 ELSE 0 END) +
       (CASE WHEN items.symptoms && ${symptoms} THEN 25 ELSE 0 END))
      AS score
    FROM knowledge_items items
    JOIN knowledge_item_vehicles v ON v.knowledge_item_id = items.id
    WHERE items.shop_id = ${input.shopId}
      AND items.retired = false
      AND v.make = ${input.vehicle.make}
      AND (v.model IS NULL OR v.model = ${input.vehicle.model})
      AND (v.engine IS NULL OR v.engine = ${normalizedEngine} OR v.engine = ${input.vehicle.engine ?? null})
      AND ${input.vehicle.year}::int BETWEEN v.year_start AND v.year_end
      AND (${typeFilter}::text IS NULL OR items.type = ${typeFilter})
      AND (
        items.dtc_list && ${dtcs}
        OR items.system_codes && ${systems}
        OR items.symptoms && ${symptoms}
      )
    ORDER BY score DESC, items.fire_count DESC, items.updated_at DESC
    LIMIT ${limit}
  `)
  return rows(res).map(toMatched)
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
pnpm test tests/unit/knowledge-retrieval.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Add coverage for remaining lookupKnowledge cases (limit, fire_count tiebreak, typeFilter, normalization)**

```ts
  it('respects limit', async () => {
    for (let i = 0; i < 5; i++) {
      await seedItem(db, { shopId, profileId, title: `Item ${i}`, dtcList: ['P0420'], fireCount: i })
    }
    const matches = await lookupKnowledge(db, {
      shopId,
      vehicle: { year: 2019, make: 'Ford', model: 'F-250', engine: '6.7L Powerstroke' },
      dtcs: ['P0420'],
      limit: 2,
    })
    expect(matches).toHaveLength(2)
  })

  it('ties on score break by fire_count DESC', async () => {
    const lowFireId = await seedItem(db, { shopId, profileId, title: 'Low', dtcList: ['P0420'], fireCount: 1 })
    const highFireId = await seedItem(db, { shopId, profileId, title: 'High', dtcList: ['P0420'], fireCount: 50 })
    const matches = await lookupKnowledge(db, {
      shopId,
      vehicle: { year: 2019, make: 'Ford', model: 'F-250', engine: '6.7L Powerstroke' },
      dtcs: ['P0420'],
      limit: 10,
    })
    expect(matches[0].id).toBe(highFireId)
    expect(matches[1].id).toBe(lowFireId)
  })

  it('filters by typeFilter when provided', async () => {
    await seedItem(db, { shopId, profileId, title: 'Note item', type: 'note', dtcList: ['P0420'] })
    const pinoutId = await seedItem(db, {
      shopId, profileId, title: 'Pinout item', type: 'pinout', dtcList: ['P0420'],
      structuredData: { connector_ref: 'X', pins: [{ pin_number: '1', signal_name: 'V' }] },
    })
    const matches = await lookupKnowledge(db, {
      shopId,
      vehicle: { year: 2019, make: 'Ford', model: 'F-250', engine: '6.7L Powerstroke' },
      dtcs: ['P0420'],
      typeFilter: 'pinout',
    })
    expect(matches).toHaveLength(1)
    expect(matches[0].id).toBe(pinoutId)
  })

  it('normalizes DTC variants (P0420-00 → P0420)', async () => {
    await seedItem(db, { shopId, profileId, title: 'P0420 item', dtcList: ['P0420'] })
    const matches = await lookupKnowledge(db, {
      shopId,
      vehicle: { year: 2019, make: 'Ford', model: 'F-250', engine: '6.7L Powerstroke' },
      dtcs: ['P0420-00'],
    })
    expect(matches).toHaveLength(1)
  })

  it('matches when v.engine is NULL (wildcard) regardless of caller engine', async () => {
    await seedItem(db, {
      shopId, profileId, title: 'Any engine',
      dtcList: ['P0420'],
      scopes: [{ yearStart: 2018, yearEnd: 2020, make: 'Ford', model: 'F-250', engine: null }],
    })
    const matches = await lookupKnowledge(db, {
      shopId,
      vehicle: { year: 2019, make: 'Ford', model: 'F-250', engine: '6.7L Powerstroke' },
      dtcs: ['P0420'],
    })
    expect(matches).toHaveLength(1)
  })
```

- [ ] **Step 6: Run tests to verify all pass**

```bash
pnpm test tests/unit/knowledge-retrieval.test.ts
```

Expected: 8 tests pass.

- [ ] **Step 7: Commit**

```bash
git add lib/knowledge/retrieval.ts tests/unit/knowledge-retrieval.test.ts
git commit -m "feat(knowledge-retrieval): lookupKnowledge SQL fn + 8 tests (PR 4 task 1)"
```

---

## Task 2: Specialized retrieval functions

Add 5 specialized tools sharing the lookupKnowledge skeleton.

**Files:**
- Modify: `lib/knowledge/retrieval.ts` (append exports)
- Modify: `tests/unit/knowledge-retrieval.test.ts` (append `describe` blocks)

- [ ] **Step 1: Write failing tests for `getConnectorPinout`**

```ts
describe('getConnectorPinout', () => {
  let db: TestDb, shopId: string, profileId: string
  beforeEach(async () => {
    db = await createTestDb()
    const s = await createShop(db, 'Shop'); shopId = s.id
    const p = await createProfile(db, { email: 't@e.com', shopId }); profileId = p.id
  })
  afterEach(async () => { await db.close() })

  it('returns the pinout for a matching connector_ref', async () => {
    const id = await seedItem(db, {
      shopId, profileId, title: 'Alt 4-pin',
      type: 'pinout',
      structuredData: { connector_ref: 'Alternator 4-pin', pins: [{ pin_number: '1', signal_name: 'B+' }] },
    })
    const matches = await getConnectorPinout(db, {
      shopId,
      connectorRef: 'Alternator 4-pin',
      vehicle: { year: 2019, make: 'Ford', model: 'F-250', engine: '6.7L Powerstroke' },
    })
    expect(matches.map((m) => m.id)).toContain(id)
  })

  it('only returns pinout type, never other types', async () => {
    await seedItem(db, {
      shopId, profileId, title: 'Note about Alternator 4-pin',
      type: 'note',
      structuredData: { connector_ref: 'Alternator 4-pin' },
    })
    const matches = await getConnectorPinout(db, {
      shopId,
      connectorRef: 'Alternator 4-pin',
      vehicle: { year: 2019, make: 'Ford', model: 'F-250', engine: '6.7L Powerstroke' },
    })
    expect(matches).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run failing test**

```bash
pnpm test tests/unit/knowledge-retrieval.test.ts -t "getConnectorPinout"
```

Expected: FAIL `getConnectorPinout is not defined`.

- [ ] **Step 3: Implement `getConnectorPinout`**

```ts
// Append to lib/knowledge/retrieval.ts
export type GetConnectorPinoutInput = {
  shopId: string
  connectorRef: string
  vehicle: RetrievalVehicle
  limit?: number
}

export async function getConnectorPinout(
  db: RetrievalDb,
  input: GetConnectorPinoutInput,
): Promise<MatchedKnowledgeItem[]> {
  const limit = input.limit ?? 3
  const normalizedEngine = normalizeEngine(input.vehicle.engine ?? null)
  const res = await db.execute<Row>(sql`
    SELECT items.id, items.shop_id, items.type, items.title, items.body,
      items.structured_data, items.dtc_list, items.system_codes, items.symptoms,
      items.fire_count, 0::int AS score
    FROM knowledge_items items
    JOIN knowledge_item_vehicles v ON v.knowledge_item_id = items.id
    WHERE items.shop_id = ${input.shopId}
      AND items.retired = false
      AND items.type = 'pinout'
      AND items.structured_data->>'connector_ref' = ${input.connectorRef}
      AND v.make = ${input.vehicle.make}
      AND (v.model IS NULL OR v.model = ${input.vehicle.model})
      AND (v.engine IS NULL OR v.engine = ${normalizedEngine} OR v.engine = ${input.vehicle.engine ?? null})
      AND ${input.vehicle.year}::int BETWEEN v.year_start AND v.year_end
    ORDER BY items.fire_count DESC, items.updated_at DESC
    LIMIT ${limit}
  `)
  return rows(res).map(toMatched)
}
```

- [ ] **Step 4: Run tests; expect pass**

```bash
pnpm test tests/unit/knowledge-retrieval.test.ts -t "getConnectorPinout"
```

- [ ] **Step 5: Repeat steps 1-4 for the four remaining specialized tools**

`getTheoryOfOperation(systemCode, vehicle)` — `type = 'theory_of_operation'` + `system_codes && [systemCode]`.

```ts
export type GetTheoryOfOperationInput = {
  shopId: string
  systemCode: string
  vehicle: RetrievalVehicle
  limit?: number
}

export async function getTheoryOfOperation(
  db: RetrievalDb,
  input: GetTheoryOfOperationInput,
): Promise<MatchedKnowledgeItem[]> {
  const limit = input.limit ?? 3
  const normalizedEngine = normalizeEngine(input.vehicle.engine ?? null)
  const systems = arrayLit([input.systemCode])
  const res = await db.execute<Row>(sql`
    SELECT items.id, items.shop_id, items.type, items.title, items.body,
      items.structured_data, items.dtc_list, items.system_codes, items.symptoms,
      items.fire_count, 0::int AS score
    FROM knowledge_items items
    JOIN knowledge_item_vehicles v ON v.knowledge_item_id = items.id
    WHERE items.shop_id = ${input.shopId}
      AND items.retired = false
      AND items.type = 'theory_of_operation'
      AND items.system_codes && ${systems}
      AND v.make = ${input.vehicle.make}
      AND (v.model IS NULL OR v.model = ${input.vehicle.model})
      AND (v.engine IS NULL OR v.engine = ${normalizedEngine} OR v.engine = ${input.vehicle.engine ?? null})
      AND ${input.vehicle.year}::int BETWEEN v.year_start AND v.year_end
    ORDER BY items.fire_count DESC, items.updated_at DESC
    LIMIT ${limit}
  `)
  return rows(res).map(toMatched)
}
```

`getWiringPath(fromComponent, toComponent, vehicle)` — `type = 'wiring_diagram'`, then JS-side filter on `structured_data.connections[].from_component` + `to_component`. (Spec calls this a post-filter; we keep it in TS to avoid brittle JSON-path SQL across PGlite/Postgres.)

```ts
export type GetWiringPathInput = {
  shopId: string
  fromComponent: string
  toComponent: string
  vehicle: RetrievalVehicle
  limit?: number
}

export async function getWiringPath(
  db: RetrievalDb,
  input: GetWiringPathInput,
): Promise<MatchedKnowledgeItem[]> {
  const limit = input.limit ?? 3
  const normalizedEngine = normalizeEngine(input.vehicle.engine ?? null)
  const res = await db.execute<Row>(sql`
    SELECT items.id, items.shop_id, items.type, items.title, items.body,
      items.structured_data, items.dtc_list, items.system_codes, items.symptoms,
      items.fire_count, 0::int AS score
    FROM knowledge_items items
    JOIN knowledge_item_vehicles v ON v.knowledge_item_id = items.id
    WHERE items.shop_id = ${input.shopId}
      AND items.retired = false
      AND items.type = 'wiring_diagram'
      AND v.make = ${input.vehicle.make}
      AND (v.model IS NULL OR v.model = ${input.vehicle.model})
      AND (v.engine IS NULL OR v.engine = ${normalizedEngine} OR v.engine = ${input.vehicle.engine ?? null})
      AND ${input.vehicle.year}::int BETWEEN v.year_start AND v.year_end
    ORDER BY items.fire_count DESC, items.updated_at DESC
    LIMIT 50
  `)
  const filtered = rows(res)
    .map(toMatched)
    .filter((m) => {
      const conns = (m.structuredData as { connections?: Array<{ from_component?: string; to_component?: string }> } | null)?.connections
      if (!Array.isArray(conns)) return false
      return conns.some((c) =>
        c.from_component === input.fromComponent && c.to_component === input.toComponent ||
        c.from_component === input.toComponent && c.to_component === input.fromComponent,
      )
    })
  return filtered.slice(0, limit)
}
```

`getComponentLocation(componentName, vehicle)` — `type = 'connector'` + match `structured_data.component_name`.

```ts
export type GetComponentLocationInput = {
  shopId: string
  componentName: string
  vehicle: RetrievalVehicle
  limit?: number
}

export async function getComponentLocation(
  db: RetrievalDb,
  input: GetComponentLocationInput,
): Promise<MatchedKnowledgeItem[]> {
  const limit = input.limit ?? 3
  const normalizedEngine = normalizeEngine(input.vehicle.engine ?? null)
  const res = await db.execute<Row>(sql`
    SELECT items.id, items.shop_id, items.type, items.title, items.body,
      items.structured_data, items.dtc_list, items.system_codes, items.symptoms,
      items.fire_count, 0::int AS score
    FROM knowledge_items items
    JOIN knowledge_item_vehicles v ON v.knowledge_item_id = items.id
    WHERE items.shop_id = ${input.shopId}
      AND items.retired = false
      AND items.type = 'connector'
      AND items.structured_data->>'component_name' = ${input.componentName}
      AND v.make = ${input.vehicle.make}
      AND (v.model IS NULL OR v.model = ${input.vehicle.model})
      AND (v.engine IS NULL OR v.engine = ${normalizedEngine} OR v.engine = ${input.vehicle.engine ?? null})
      AND ${input.vehicle.year}::int BETWEEN v.year_start AND v.year_end
    ORDER BY items.fire_count DESC, items.updated_at DESC
    LIMIT ${limit}
  `)
  return rows(res).map(toMatched)
}
```

`getSpec(specName, vehicle)` — v1 simple keyword scan across title/body/structuredData JSON cast to text. Spec calls out v2 as a dedicated `spec` type.

```ts
export type GetSpecInput = {
  shopId: string
  specName: string
  vehicle: RetrievalVehicle
  limit?: number
}

export async function getSpec(
  db: RetrievalDb,
  input: GetSpecInput,
): Promise<MatchedKnowledgeItem[]> {
  const limit = input.limit ?? 3
  const normalizedEngine = normalizeEngine(input.vehicle.engine ?? null)
  const pattern = `%${input.specName.replace(/[%_]/g, '\\$&')}%`
  const res = await db.execute<Row>(sql`
    SELECT items.id, items.shop_id, items.type, items.title, items.body,
      items.structured_data, items.dtc_list, items.system_codes, items.symptoms,
      items.fire_count, 0::int AS score
    FROM knowledge_items items
    JOIN knowledge_item_vehicles v ON v.knowledge_item_id = items.id
    WHERE items.shop_id = ${input.shopId}
      AND items.retired = false
      AND (
        items.title ILIKE ${pattern}
        OR items.body ILIKE ${pattern}
        OR items.structured_data::text ILIKE ${pattern}
      )
      AND v.make = ${input.vehicle.make}
      AND (v.model IS NULL OR v.model = ${input.vehicle.model})
      AND (v.engine IS NULL OR v.engine = ${normalizedEngine} OR v.engine = ${input.vehicle.engine ?? null})
      AND ${input.vehicle.year}::int BETWEEN v.year_start AND v.year_end
    ORDER BY items.fire_count DESC, items.updated_at DESC
    LIMIT ${limit}
  `)
  return rows(res).map(toMatched)
}
```

Each function gets at least one happy-path test and one type/scope-isolation test. ~10 test cases total across the four functions.

- [ ] **Step 6: Commit**

```bash
git add lib/knowledge/retrieval.ts tests/unit/knowledge-retrieval.test.ts
git commit -m "feat(knowledge-retrieval): 5 specialized retrieval fns + tests (PR 4 task 2)"
```

---

## Task 3: `fire_count` background increment

**Files:**
- Modify: `lib/knowledge/retrieval.ts` (export `incrementFireCount`)
- Modify: `tests/unit/knowledge-retrieval.test.ts` (one new test)

- [ ] **Step 1: Write failing test**

```ts
describe('incrementFireCount', () => {
  let db: TestDb, shopId: string, profileId: string
  beforeEach(async () => {
    db = await createTestDb()
    const s = await createShop(db, 'Shop'); shopId = s.id
    const p = await createProfile(db, { email: 't@e.com', shopId }); profileId = p.id
  })
  afterEach(async () => { await db.close() })

  it('increments fire_count atomically for each id', async () => {
    const a = await seedItem(db, { shopId, profileId, title: 'A', dtcList: ['P0420'], fireCount: 0 })
    const b = await seedItem(db, { shopId, profileId, title: 'B', dtcList: ['P0420'], fireCount: 5 })
    await incrementFireCount(db, [a, b, a]) // duplicate id increments twice
    const result = await db.execute<{ id: string; fire_count: number }>(sql`
      SELECT id, fire_count FROM knowledge_items WHERE id IN (${a}, ${b}) ORDER BY id
    `)
    const map = new Map(rows(result).map((r) => [r.id, r.fire_count]))
    expect(map.get(a)).toBe(2)
    expect(map.get(b)).toBe(6)
  })
})
```

- [ ] **Step 2: Run failing test**

- [ ] **Step 3: Implement**

```ts
// Append to lib/knowledge/retrieval.ts
export async function incrementFireCount(
  db: RetrievalDb,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return
  // Each id may appear N times in the input; the SQL counts occurrences so
  // duplicate hits in one retrieval round (rare but possible) increment N×.
  const counts = new Map<string, number>()
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
  for (const [id, n] of counts) {
    await db.execute(sql`
      UPDATE knowledge_items SET fire_count = fire_count + ${n}
      WHERE id = ${id}
    `)
  }
}
```

- [ ] **Step 4: Run test; expect pass.**

- [ ] **Step 5: Commit**

```bash
git add lib/knowledge/retrieval.ts tests/unit/knowledge-retrieval.test.ts
git commit -m "feat(knowledge-retrieval): incrementFireCount helper (PR 4 task 3)"
```

---

## Task 4: Anthropic tool definitions

**Files:**
- Create: `lib/knowledge/tools.ts`
- Create: `tests/unit/knowledge-tool-defs.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/knowledge-tool-defs.test.ts
import { describe, it, expect } from 'vitest'
import {
  lookupKnowledgeTool,
  getConnectorPinoutTool,
  getTheoryOfOperationTool,
  getWiringPathTool,
  getComponentLocationTool,
  getSpecTool,
  KNOWLEDGE_TOOLS,
} from '@/lib/knowledge/tools'

describe('knowledge tool definitions', () => {
  it('all tools have name + description + input_schema', () => {
    for (const tool of KNOWLEDGE_TOOLS) {
      expect(tool.name).toMatch(/^[a-z_]+$/)
      expect(tool.description.length).toBeGreaterThan(40)
      expect(tool.input_schema.type).toBe('object')
      expect(tool.input_schema.properties).toBeDefined()
    }
  })

  it('lookup_knowledge requires vehicle', () => {
    expect(lookupKnowledgeTool.name).toBe('lookup_knowledge')
    expect(lookupKnowledgeTool.input_schema.required).toContain('vehicle')
  })

  it('get_connector_pinout requires connector_ref + vehicle', () => {
    expect(getConnectorPinoutTool.name).toBe('get_connector_pinout')
    expect(getConnectorPinoutTool.input_schema.required).toEqual(
      expect.arrayContaining(['connector_ref', 'vehicle']),
    )
  })

  it('exports exactly 6 tools', () => {
    expect(KNOWLEDGE_TOOLS).toHaveLength(6)
  })
})
```

- [ ] **Step 2: Run failing test**

- [ ] **Step 3: Implement `lib/knowledge/tools.ts`**

```ts
import type Anthropic from '@anthropic-ai/sdk'

const vehicleSchema = {
  type: 'object',
  properties: {
    year: { type: 'integer' },
    make: { type: 'string' },
    model: { type: 'string' },
    engine: { type: 'string' },
  },
  required: ['year', 'make', 'model'],
} as const

export const lookupKnowledgeTool: Anthropic.Tool = {
  name: 'lookup_knowledge',
  description:
    "Look up vetted shop knowledge for the current vehicle. Use when you need vehicle-specific information " +
    "(failure patterns, references, bulletins, notes). Returns up to N matching items above the relevance threshold. " +
    "Empty result means the shop has not curated knowledge matching this context — continue your normal diagnostic guidance.",
  input_schema: {
    type: 'object',
    properties: {
      vehicle: vehicleSchema,
      dtcs: { type: 'array', items: { type: 'string' } },
      symptoms: { type: 'array', items: { type: 'string' } },
      system_codes: { type: 'array', items: { type: 'string' } },
      type_filter: {
        type: 'string',
        enum: ['cause_fix', 'reference_doc', 'bulletin', 'note', 'pinout', 'connector', 'wiring_diagram', 'theory_of_operation'],
      },
      limit: { type: 'integer', default: 3 },
    },
    required: ['vehicle'],
  },
}

export const getConnectorPinoutTool: Anthropic.Tool = {
  name: 'get_connector_pinout',
  description:
    "Get the pin table for a specific connector on this vehicle. Use when you need pin numbers, signal names, " +
    "wire colors, or expected voltages for a connector. Empty result means the shop has not curated this connector " +
    "— continue with general guidance and ask the tech to look up the OEM pinout.",
  input_schema: {
    type: 'object',
    properties: {
      connector_ref: { type: 'string' },
      vehicle: vehicleSchema,
    },
    required: ['connector_ref', 'vehicle'],
  },
}

export const getTheoryOfOperationTool: Anthropic.Tool = {
  name: 'get_theory_of_operation',
  description:
    "Get the theory of operation for a specific vehicle system. Use when the tech needs to understand HOW the " +
    "system works on this exact vehicle (control strategy, communication bus, sensor logic). Empty result means " +
    "no vetted theory document — fall back to general system principles.",
  input_schema: {
    type: 'object',
    properties: {
      system_code: { type: 'string', description: 'System code (e.g. "charging", "fuel_delivery", "can_bus")' },
      vehicle: vehicleSchema,
    },
    required: ['system_code', 'vehicle'],
  },
}

export const getWiringPathTool: Anthropic.Tool = {
  name: 'get_wiring_path',
  description:
    "Get the wiring path between two components on this vehicle. Use when you need to follow a signal or power " +
    "path between named components. Empty result means the shop has not curated this wiring path.",
  input_schema: {
    type: 'object',
    properties: {
      from_component: { type: 'string' },
      to_component: { type: 'string' },
      vehicle: vehicleSchema,
    },
    required: ['from_component', 'to_component', 'vehicle'],
  },
}

export const getComponentLocationTool: Anthropic.Tool = {
  name: 'get_component_location',
  description:
    "Get the physical location of a named component on this vehicle. Use when the tech needs to find a component " +
    "(connector, sensor, module) physically. Empty result means the shop has not curated this component location.",
  input_schema: {
    type: 'object',
    properties: {
      component_name: { type: 'string' },
      vehicle: vehicleSchema,
    },
    required: ['component_name', 'vehicle'],
  },
}

export const getSpecTool: Anthropic.Tool = {
  name: 'get_spec',
  description:
    "Get a vehicle-specific spec value (torque, voltage, fluid capacity, ride height, etc.). Use when you need a " +
    "numeric spec for this exact vehicle. Empty result means no vetted spec — defer to the tech's OEM lookup.",
  input_schema: {
    type: 'object',
    properties: {
      spec_name: { type: 'string' },
      vehicle: vehicleSchema,
    },
    required: ['spec_name', 'vehicle'],
  },
}

export const KNOWLEDGE_TOOLS: Anthropic.Tool[] = [
  lookupKnowledgeTool,
  getConnectorPinoutTool,
  getTheoryOfOperationTool,
  getWiringPathTool,
  getComponentLocationTool,
  getSpecTool,
]

export type KnowledgeToolName =
  | 'lookup_knowledge'
  | 'get_connector_pinout'
  | 'get_theory_of_operation'
  | 'get_wiring_path'
  | 'get_component_location'
  | 'get_spec'
```

- [ ] **Step 4: Run tests; expect pass**

- [ ] **Step 5: Commit**

```bash
git add lib/knowledge/tools.ts tests/unit/knowledge-tool-defs.test.ts
git commit -m "feat(knowledge-retrieval): Anthropic tool defs for 6 retrieval tools (PR 4 task 4)"
```

---

## Task 5: System prompt — `Vehicle knowledge tools` section

**Files:**
- Modify: `lib/ai/prompts.ts` (append section to `TREE_ENGINE_SYSTEM`)

- [ ] **Step 1: Write the new section verbatim from spec lines 489-549**

Append this block to the end of the `TREE_ENGINE_SYSTEM` template literal (right before the closing backtick):

```
\n\nVEHICLE KNOWLEDGE TOOLS — vetted shop knowledge:

You have tools that look up vetted shop knowledge for the vehicle being diagnosed. The vetted base is the highest-trust source — when a tool returns data, use it, cite it, and lean on it over conflicting training knowledge.

WHEN TO CALL — when you need a specific technical fact about the vehicle (pin number, wire color, voltage spec, torque value, connector ID, component location, system-specific theory), call the appropriate tool FIRST before stating the fact:
- lookup_knowledge — for cause/fix patterns, bulletins, notes, generic references
- get_connector_pinout — for pin tables
- get_theory_of_operation — for system theory
- get_wiring_path — for wiring between components
- get_component_location — for where a component is physically located
- get_spec — for specs (torques, voltages, fluid capacities, ride heights)

WHEN A TOOL RETURNS DATA — treat it as authoritative. Cite items inline using [ref:item_id] so the UI can render the source link / embedded view. If the data conflicts with your training, the data wins.

WHEN A TOOL RETURNS EMPTY — continue your normal diagnostic guidance using general reasoning. DO NOT surface the absence to the user. DO NOT refuse. DO NOT say "I don't have verified data." Just continue.

WHAT YOU MUST NOT DO — do not SKIP the tool call when a specific technical fact about THIS vehicle is needed (pin number, wire color, voltage spec, torque value, connector ID, component location, vehicle-specific theory). Always call the appropriate tool FIRST. Once the tool returns (data OR empty), you may proceed:
- Returned data → use it as authoritative; cite with [ref:item_id].
- Returned empty → fall through to your normal diagnostic guidance using training data and general reasoning. The tool-call was the gate; what comes after is your normal behavior.

Generic principles are always allowed from training, no tool call required:
- "Undercharging means the field isn't being commanded fully" — principle, OK.
- "On a 6.7L Powerstroke, pin 3 is the LIN bus" — vehicle-specific, MUST come after a tool call (data or empty).

The line is: principles vs. specifics. Principles ARE training-allowed. Specifics REQUIRE a tool call first; what you do after depends on the tool's return.

CONTEXTUAL CALLING — don't fetch reference data preemptively. Don't fetch for general orientation. Fetch only when:
1. You're about to suggest a specific test that requires pin numbers / wire colors / voltages.
2. You're interpreting a measurement the tech just gave you.
3. You're walking the tech through a procedure that needs the diagram.
4. The tech explicitly asks for the data ("show me the alternator pinout").

Most diagnostics never reach steps that require tool calls. That's fine — simple cases stay simple.
```

- [ ] **Step 2: TS check + ensure existing prompts.ts tests pass**

```bash
pnpm exec tsc --noEmit
pnpm test tests/unit/ -t "TREE_ENGINE_SYSTEM"
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/ai/prompts.ts
git commit -m "feat(knowledge-retrieval): system-prompt clauses for knowledge tools (PR 4 task 5)"
```

---

## Task 6: Tree-engine tool-use loop

This is the biggest single delta. The current `generateInitialTree` and `updateTree` do single-shot text completions. We add a multi-turn loop that handles `tool_use` blocks.

**Files:**
- Modify: `lib/ai/tree-engine.ts`
- Create: `tests/unit/tree-engine-tool-loop.test.ts`

- [ ] **Step 1: Define new return shape + dispatcher type**

Add to top of `lib/ai/tree-engine.ts`:

```ts
import type Anthropic from '@anthropic-ai/sdk'
import type { MatchedKnowledgeItem } from '@/lib/knowledge/retrieval'

export type TreeEngineResult = {
  tree: TreeState
  consultedItems: MatchedKnowledgeItem[]
}

export type ToolDispatcher = (
  toolName: string,
  toolInput: Record<string, unknown>,
) => Promise<{ items: MatchedKnowledgeItem[] }>

export type ToolUseDeps = {
  tools?: Anthropic.Tool[]
  dispatcher?: ToolDispatcher
}

const MAX_TOOL_ROUNDS = 5
```

- [ ] **Step 2: Write failing tests for tool-use loop**

```ts
// tests/unit/tree-engine-tool-loop.test.ts
import { describe, it, expect, vi } from 'vitest'
import { generateInitialTree, updateTree } from '@/lib/ai/tree-engine'

const fakeIntake = {
  vehicleYear: 2019,
  vehicleMake: 'Ford',
  vehicleModel: 'F-250',
  vehicleEngine: '6.7L Powerstroke',
  customerComplaint: 'Battery light on, dim headlights',
  mileage: 90000,
  ambientConditions: null,
} as const

describe('tree-engine tool-use loop', () => {
  it('handles tool_use → tool_result → final text', async () => {
    const create = vi.fn()
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: 'tu_1', name: 'lookup_knowledge', input: { vehicle: { year: 2019, make: 'Ford', model: 'F-250' }, dtcs: ['P0620'] } },
        ],
      })
      .mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [
          { type: 'text', text: JSON.stringify({
            nodes: [{ id: 'scan-codes', label: 'Pull DTCs', status: 'active' }],
            currentNodeId: 'scan-codes',
            message: 'Found it in vetted knowledge [ref:abc-123]. Start with a pin test.',
          }) },
        ],
      })

    const dispatcher = vi.fn().mockResolvedValue({
      items: [{ id: 'abc-123', shopId: 's1', type: 'cause_fix', title: 'P0620 LIN', body: null, structuredData: null, dtcList: ['P0620'], systemCodes: ['charging'], symptoms: [], fireCount: 0, score: 100 }],
    })

    const result = await generateInitialTree(fakeIntake, undefined, undefined, {
      tools: [{ name: 'lookup_knowledge', description: 'x', input_schema: { type: 'object', properties: {}, required: [] } }],
      dispatcher,
      client: { messages: { create } } as never,
    })

    expect(create).toHaveBeenCalledTimes(2)
    expect(dispatcher).toHaveBeenCalledTimes(1)
    expect(result.tree.message).toContain('[ref:abc-123]')
    expect(result.consultedItems.map((i) => i.id)).toContain('abc-123')
  })

  it('handles pure-text response (no tool calls) — backwards compatible', async () => {
    const create = vi.fn().mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify({
        nodes: [{ id: 'a', label: 'a', status: 'active' }],
        currentNodeId: 'a',
        message: 'Hello.',
      }) }],
    })
    const dispatcher = vi.fn()
    const result = await generateInitialTree(fakeIntake, undefined, undefined, {
      client: { messages: { create } } as never,
    })
    expect(dispatcher).not.toHaveBeenCalled()
    expect(result.tree.message).toBe('Hello.')
    expect(result.consultedItems).toEqual([])
  })

  it('caps tool rounds at MAX_TOOL_ROUNDS', async () => {
    const toolUseResp = {
      stop_reason: 'tool_use',
      content: [
        { type: 'tool_use', id: 'tu_x', name: 'lookup_knowledge', input: {} },
      ],
    }
    const create = vi.fn().mockResolvedValue(toolUseResp)
    const dispatcher = vi.fn().mockResolvedValue({ items: [] })
    await expect(
      generateInitialTree(fakeIntake, undefined, undefined, {
        tools: [{ name: 'lookup_knowledge', description: 'x', input_schema: { type: 'object', properties: {}, required: [] } }],
        dispatcher,
        client: { messages: { create } } as never,
      }),
    ).rejects.toThrow(/tool-use round cap/)
  })

  it('continues normally on dispatcher error — sends error tool_result + no throw', async () => {
    const create = vi.fn()
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tu_err', name: 'lookup_knowledge', input: {} }],
      })
      .mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify({
          nodes: [{ id: 'a', label: 'a', status: 'active' }],
          currentNodeId: 'a',
          message: 'OK — continuing.',
        }) }],
      })
    const dispatcher = vi.fn().mockRejectedValue(new Error('db down'))
    const result = await generateInitialTree(fakeIntake, undefined, undefined, {
      tools: [{ name: 'lookup_knowledge', description: 'x', input_schema: { type: 'object', properties: {}, required: [] } }],
      dispatcher,
      client: { messages: { create } } as never,
    })
    expect(result.tree.message).toBe('OK — continuing.')
    expect(result.consultedItems).toEqual([])
  })
})
```

- [ ] **Step 3: Run failing test**

```bash
pnpm test tests/unit/tree-engine-tool-loop.test.ts
```

Expected: FAIL — `generateInitialTree` signature doesn't accept the deps object.

- [ ] **Step 4: Refactor `generateInitialTree` and `updateTree` to use a shared tool-use loop**

Refactor pattern (apply to both functions):

```ts
type AnthropicClient = {
  messages: {
    create: (args: unknown, opts?: { signal?: AbortSignal }) => Promise<{
      stop_reason?: string
      content: Array<
        | { type: 'text'; text: string }
        | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
      >
    }>
  }
}

type RunToolLoopInput = {
  system: ReturnType<typeof cachedSystem>
  initialUserMessage: string
  tools?: Anthropic.Tool[]
  dispatcher?: ToolDispatcher
  client: AnthropicClient
  callName: 'generateInitialTree' | 'updateTree'
  inputSize: number
}

async function runToolLoop(input: RunToolLoopInput): Promise<TreeEngineResult> {
  const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [
    { role: 'user', content: input.initialUserMessage },
  ]
  const consulted: MatchedKnowledgeItem[] = []

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const t0 = Date.now()
    const res = await input.client.messages.create(
      {
        model: MODEL,
        max_tokens: 4096,
        system: input.system,
        messages,
        ...(input.tools && input.tools.length > 0 ? { tools: input.tools } : {}),
      },
      { signal: AbortSignal.timeout(45_000) },
    )
    console.log(
      `${input.callName}: anthropic call took ${Date.now() - t0}ms (round=${round}, input ~${input.inputSize} chars)`,
    )

    const toolUseBlocks = res.content.filter(
      (b): b is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } =>
        b.type === 'tool_use',
    )
    if (toolUseBlocks.length === 0 || res.stop_reason !== 'tool_use') {
      const textBlock = res.content.find((b): b is { type: 'text'; text: string } => b.type === 'text')
      if (!textBlock) throw new Error('no text block in response')
      const tree = parseTreeJson(textBlock.text, res.stop_reason ?? undefined)
      return { tree, consultedItems: consulted }
    }

    messages.push({ role: 'assistant', content: res.content })
    const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }> = []
    for (const tu of toolUseBlocks) {
      if (!input.dispatcher) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify({ items: [] }),
        })
        continue
      }
      try {
        const result = await input.dispatcher(tu.name, tu.input)
        consulted.push(...result.items)
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify({ items: result.items }),
        })
      } catch (err) {
        console.warn(`knowledge tool ${tu.name} failed:`, err)
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify({ items: [], error: 'tool_execution_failed' }),
          is_error: true,
        })
      }
    }
    messages.push({ role: 'user', content: toolResults })
  }

  throw new Error('generate/updateTree exceeded tool-use round cap (MAX_TOOL_ROUNDS=' + MAX_TOOL_ROUNDS + ')')
}
```

Update `generateInitialTree` to use the loop:

```ts
export async function generateInitialTree(
  intake: IntakePayload,
  corpus?: CorpusMatch[],
  retrieval?: RetrievalResult[],
  deps: ToolUseDeps & { client?: AnthropicClient } = {},
): Promise<TreeEngineResult> {
  const userMessage = buildIntakeUserMessage(intake, corpus, retrieval)
  return withRetry(async () =>
    runToolLoop({
      system: cachedSystem(TREE_ENGINE_SYSTEM),
      initialUserMessage: userMessage,
      tools: deps.tools,
      dispatcher: deps.dispatcher,
      client: deps.client ?? (anthropic as unknown as AnthropicClient),
      callName: 'generateInitialTree',
      inputSize: userMessage.length,
    }),
  )
}
```

Apply the same refactor to `updateTree`:

```ts
export async function updateTree(input: {
  intake: IntakePayload
  currentTree: TreeState
  observation: string
  artifacts?: Array<{ kind: string; summary?: string; structured?: Record<string, unknown>; text?: string }>
  corpus?: CorpusMatch[]
  retrieval?: RetrievalResult[]
  sessionDtcs?: string[]
  tools?: Anthropic.Tool[]
  dispatcher?: ToolDispatcher
  client?: AnthropicClient
}): Promise<TreeEngineResult> {
  const artifactBlock = /* existing computation, unchanged */ ''
  const corpusBlock = /* existing computation, unchanged */ ''
  const retrievalBlock = /* existing computation, unchanged */ ''
  const userMessage = `Initial intake: ${JSON.stringify(input.intake)}${ambientConditionsBlock(input.intake.ambientConditions)}\n\nCurrent tree state:\n${JSON.stringify(input.currentTree, null, 2)}\n\nTech's observation on current step (${input.currentTree.currentNodeId}):\n${input.observation}${artifactBlock}${corpusBlock}${retrievalBlock}\n\nUpdate the tree based on this observation, any artifact evidence, the corpus matches, and the retrieval results. If sources conflict, surface the conflict transparently in the message field. Resolve or prune branches as appropriate. Set the next current step. If you have enough information to identify the root cause, set done=true and provide rootCauseSummary.\n\nReturn JSON only — no prose, no fences.`

  return withRetry(async () =>
    runToolLoop({
      system: cachedSystem(TREE_ENGINE_SYSTEM),
      initialUserMessage: userMessage,
      tools: input.tools,
      dispatcher: input.dispatcher,
      client: input.client ?? (anthropic as unknown as AnthropicClient),
      callName: 'updateTree',
      inputSize: userMessage.length,
    }),
  )
}
```

(The three `/* existing computation, unchanged */` lines are the artifactBlock/corpusBlock/retrievalBlock constructions copied verbatim from the current implementation — see `lib/ai/tree-engine.ts:187-213` before the refactor.)

**Note: the return type changes from `TreeState` to `TreeEngineResult`** — every caller updates in subsequent tasks.

- [ ] **Step 5: Run tool-loop tests; expect pass**

```bash
pnpm test tests/unit/tree-engine-tool-loop.test.ts
```

- [ ] **Step 6: Confirm existing tree-engine tests still pass with new return shape**

This will break a number of existing tests that expect `TreeState` directly. Each needs `result.tree.*` instead of `result.*`. Fix them. Run:

```bash
pnpm test tests/unit/ -t "tree-engine" -t "advance"
```

If a test failure is caused by `result.message` vs `result.tree.message`, update the test. Do NOT change behavior.

- [ ] **Step 7: Commit**

```bash
git add lib/ai/tree-engine.ts tests/unit/tree-engine-tool-loop.test.ts tests/unit/<any updated>
git commit -m "feat(knowledge-retrieval): tree-engine tool-use loop + new return shape (PR 4 task 6)"
```

---

## Task 7: Citation extraction helper

**Files:**
- Create: `lib/knowledge/citations.ts`
- Create: `tests/unit/knowledge-citations.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { extractCitedItems, REF_MARKER_RE } from '@/lib/knowledge/citations'

const items = [
  { id: 'a-1', shopId: 's', type: 'cause_fix' as const, title: 'A', body: null, structuredData: null, dtcList: [], systemCodes: [], symptoms: [], fireCount: 0, score: 0 },
  { id: 'b-2', shopId: 's', type: 'pinout' as const, title: 'B', body: null, structuredData: null, dtcList: [], systemCodes: [], symptoms: [], fireCount: 0, score: 0 },
]

describe('citations', () => {
  it('extracts cited ids from text', () => {
    const cited = extractCitedItems('See [ref:a-1] and also [ref:b-2].', items)
    expect(cited.map((c) => c.id)).toEqual(['a-1', 'b-2'])
  })

  it('ignores cite markers that do not match any consulted item', () => {
    const cited = extractCitedItems('See [ref:ghost-id] for details.', items)
    expect(cited).toEqual([])
  })

  it('deduplicates repeated cites', () => {
    const cited = extractCitedItems('[ref:a-1] [ref:a-1] [ref:a-1]', items)
    expect(cited.map((c) => c.id)).toEqual(['a-1'])
  })

  it('REF_MARKER_RE matches with hyphens and uuid characters', () => {
    expect('[ref:11111111-2222-3333-4444-555555555555]'.match(REF_MARKER_RE)).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run failing test**

- [ ] **Step 3: Implement**

```ts
// lib/knowledge/citations.ts
import type { MatchedKnowledgeItem } from '@/lib/knowledge/retrieval'

export const REF_MARKER_RE = /\[ref:([A-Za-z0-9-]+)\]/g

export function extractCitedItems(
  message: string,
  consulted: MatchedKnowledgeItem[],
): MatchedKnowledgeItem[] {
  const byId = new Map(consulted.map((i) => [i.id, i]))
  const cited: MatchedKnowledgeItem[] = []
  const seen = new Set<string>()
  for (const match of message.matchAll(REF_MARKER_RE)) {
    const id = match[1]
    if (seen.has(id)) continue
    seen.add(id)
    const item = byId.get(id)
    if (item) cited.push(item)
  }
  return cited
}
```

- [ ] **Step 4: Run tests; expect pass**

- [ ] **Step 5: Commit**

```bash
git add lib/knowledge/citations.ts tests/unit/knowledge-citations.test.ts
git commit -m "feat(knowledge-retrieval): [ref:item_id] citation extractor (PR 4 task 7)"
```

---

## Task 8: Wire dispatcher into `wire-into-tree.ts` wrappers

**Files:**
- Modify: `lib/retrieval/wire-into-tree.ts`
- Create: `tests/unit/wire-into-tree-knowledge.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/unit/wire-into-tree-knowledge.test.ts
import { describe, it, expect, vi } from 'vitest'
import { buildUpdateTreeWithRetrieval } from '@/lib/retrieval/wire-into-tree'

describe('wire-into-tree knowledge dispatcher', () => {
  it('binds shopId into the dispatcher passed to updateTree', async () => {
    const updateTree = vi.fn().mockResolvedValue({
      tree: { nodes: [], currentNodeId: '', message: '' },
      consultedItems: [],
    })
    const buildKnowledgeDispatcher = vi.fn().mockReturnValue(async () => ({ items: [] }))
    const runRetrieval = vi.fn().mockResolvedValue({ results: [] })
    const validateRetrievalResults = vi.fn().mockResolvedValue([])

    const wrapped = buildUpdateTreeWithRetrieval({
      db: {} as never,
      adapters: [],
      updateTree,
      runRetrieval,
      validateRetrievalResults,
      buildKnowledgeDispatcher,
      shopId: 'shop-abc',
    })

    await wrapped({
      intake: { vehicleYear: 2019, vehicleMake: 'Ford', vehicleModel: 'F-250', customerComplaint: 'x' } as never,
      currentTree: { nodes: [], currentNodeId: '', message: '' },
      observation: 'x',
    })

    expect(buildKnowledgeDispatcher).toHaveBeenCalledWith({ db: expect.anything(), shopId: 'shop-abc' })
    const callArgs = updateTree.mock.calls[0][0]
    expect(callArgs.tools).toBeDefined()
    expect(callArgs.dispatcher).toBeDefined()
  })
})
```

- [ ] **Step 2: Run failing test**

- [ ] **Step 3: Add `buildKnowledgeDispatcher` + `shopId` to deps, plus knowledge tools import**

In `lib/retrieval/wire-into-tree.ts`:

```ts
import { KNOWLEDGE_TOOLS } from '@/lib/knowledge/tools'
import {
  lookupKnowledge,
  getConnectorPinout,
  getTheoryOfOperation,
  getWiringPath,
  getComponentLocation,
  getSpec,
  incrementFireCount,
  type MatchedKnowledgeItem,
} from '@/lib/knowledge/retrieval'

export type KnowledgeDispatcher = (
  toolName: string,
  toolInput: Record<string, unknown>,
) => Promise<{ items: MatchedKnowledgeItem[] }>

export function defaultBuildKnowledgeDispatcher(args: {
  db: AppDb
  shopId: string
}): KnowledgeDispatcher {
  return async (toolName, toolInput) => {
    const vehicle = (toolInput.vehicle as { year?: unknown; make?: unknown; model?: unknown; engine?: unknown } | undefined) ?? {}
    const v = {
      year: Number(vehicle.year),
      make: String(vehicle.make ?? ''),
      model: String(vehicle.model ?? ''),
      engine: typeof vehicle.engine === 'string' ? vehicle.engine : undefined,
    }
    let items: MatchedKnowledgeItem[] = []
    try {
      switch (toolName) {
        case 'lookup_knowledge':
          items = await lookupKnowledge(args.db, {
            shopId: args.shopId,
            vehicle: v,
            dtcs: toStringArray(toolInput.dtcs),
            systemCodes: toStringArray(toolInput.system_codes),
            symptoms: toStringArray(toolInput.symptoms),
            typeFilter: toolInput.type_filter as never,
            limit: typeof toolInput.limit === 'number' ? toolInput.limit : undefined,
          })
          break
        case 'get_connector_pinout':
          items = await getConnectorPinout(args.db, {
            shopId: args.shopId, vehicle: v,
            connectorRef: String(toolInput.connector_ref ?? ''),
          })
          break
        case 'get_theory_of_operation':
          items = await getTheoryOfOperation(args.db, {
            shopId: args.shopId, vehicle: v,
            systemCode: String(toolInput.system_code ?? ''),
          })
          break
        case 'get_wiring_path':
          items = await getWiringPath(args.db, {
            shopId: args.shopId, vehicle: v,
            fromComponent: String(toolInput.from_component ?? ''),
            toComponent: String(toolInput.to_component ?? ''),
          })
          break
        case 'get_component_location':
          items = await getComponentLocation(args.db, {
            shopId: args.shopId, vehicle: v,
            componentName: String(toolInput.component_name ?? ''),
          })
          break
        case 'get_spec':
          items = await getSpec(args.db, {
            shopId: args.shopId, vehicle: v,
            specName: String(toolInput.spec_name ?? ''),
          })
          break
        default:
          console.warn(`unknown knowledge tool: ${toolName}`)
      }
    } catch (err) {
      console.warn(`knowledge tool ${toolName} threw:`, err)
      throw err
    }
    if (items.length > 0) {
      incrementFireCount(args.db, items.map((i) => i.id)).catch((e) =>
        console.warn('fire_count increment failed:', e),
      )
    }
    return { items }
  }
}

function toStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  return v.filter((x): x is string => typeof x === 'string')
}
```

Extend deps and the wrapper body of `buildUpdateTreeWithRetrieval`:

```ts
export type BuildUpdateTreeWithRetrievalDeps = {
  db: AppDb
  adapters: RetrievalAdapter[]
  updateTree: typeof updateTreeFn
  runRetrieval: typeof runRetrievalFn
  validateRetrievalResults: typeof validateResultsFn
  retrieveCorpus?: typeof retrieveCorpusFn
  sessionId?: string
  onProgress?: (event: AdvanceStreamEvent) => void

  /** PR 4. Inject so tests can stub. Production callers pass
   *  `defaultBuildKnowledgeDispatcher`. When omitted, no tools are
   *  registered with the AI (back-compat). */
  buildKnowledgeDispatcher?: (args: { db: AppDb; shopId: string }) => KnowledgeDispatcher
  shopId?: string
}
```

In the wrapper body, after Promise.all:

```ts
const tools = deps.buildKnowledgeDispatcher && deps.shopId ? KNOWLEDGE_TOOLS : undefined
const dispatcher =
  deps.buildKnowledgeDispatcher && deps.shopId
    ? deps.buildKnowledgeDispatcher({ db: deps.db, shopId: deps.shopId })
    : undefined

return deps.updateTree({
  ...input,
  retrieval,
  ...(corpus !== undefined ? { corpus } : {}),
  ...(tools && dispatcher ? { tools, dispatcher } : {}),
})
```

`updateTree`'s input type needs the new optional fields — since `updateTree` already takes a single object, extend its `UpdateTreeInput` (or add to the public type).

Apply the same change to `buildGenerateInitialTreeWithRetrieval`. Its dep type adds `buildKnowledgeDispatcher` and `shopId`:

```ts
export type BuildGenerateInitialTreeWithRetrievalDeps = {
  db: AppDb
  adapters: RetrievalAdapter[]
  generateInitialTree: typeof generateInitialTreeFn
  runRetrieval: typeof runRetrievalFn
  validateRetrievalResults: typeof validateResultsFn
  retrieveCorpus?: typeof retrieveCorpusFn
  buildKnowledgeDispatcher?: (args: { db: AppDb; shopId: string }) => KnowledgeDispatcher
  shopId?: string
}
```

And the wrapper body's final return becomes:

```ts
const tools = deps.buildKnowledgeDispatcher && deps.shopId ? KNOWLEDGE_TOOLS : undefined
const dispatcher =
  deps.buildKnowledgeDispatcher && deps.shopId
    ? deps.buildKnowledgeDispatcher({ db: deps.db, shopId: deps.shopId })
    : undefined

return deps.generateInitialTree(
  intake,
  corpus,
  retrieval,
  tools && dispatcher ? { tools, dispatcher } : {},
)
```

- [ ] **Step 4: Run all wire-into-tree tests; expect pass**

```bash
pnpm test tests/unit/wire-into-tree
```

- [ ] **Step 5: Commit**

```bash
git add lib/retrieval/wire-into-tree.ts tests/unit/wire-into-tree-knowledge.test.ts
git commit -m "feat(knowledge-retrieval): wire-into-tree binds shopId-scoped dispatcher (PR 4 task 8)"
```

---

## Task 9: Route plumbing — pass shopId, propagate citedItems/consultedItems

**Files:**
- Modify: `app/api/sessions/route.ts`
- Modify: `app/api/sessions/[id]/advance/route.ts`
- Modify: `app/api/sessions/[id]/advance/stream/route.ts`
- Modify: existing route tests to match new payload shape

- [ ] **Step 1: Find current `generateInitialTree`/`updateTree` call sites**

(Already mapped from exploration.)

- [ ] **Step 2: Wire `shopId` + `buildKnowledgeDispatcher` into each builder call**

In each route, locate the `buildUpdateTreeWithRetrieval(...)` / `buildGenerateInitialTreeWithRetrieval(...)` call and add:

```ts
import { defaultBuildKnowledgeDispatcher } from '@/lib/retrieval/wire-into-tree'

// inside the route, after we have shopId from auth/profile:
const wrapper = buildUpdateTreeWithRetrieval({
  /* existing deps */,
  buildKnowledgeDispatcher: defaultBuildKnowledgeDispatcher,
  shopId,
})
```

- [ ] **Step 3: Extract `citedItems`, return both in the response payload**

After awaiting the wrapped call, the route already gets back `TreeEngineResult`. Replace the previous `return NextResponse.json({ ...tree, /* other fields */ })` pattern with:

```ts
import { extractCitedItems } from '@/lib/knowledge/citations'

const { tree, consultedItems } = await wrapper(input)
const citedItems = extractCitedItems(tree.message, consultedItems)

// Preserve every field the route returned before this PR exactly as it
// was. Spread `tree` for the TreeState fields and append the two new
// additive arrays at the end.
return NextResponse.json({
  ...tree,
  citedItems,
  consultedItems,
})
```

When opening each route file, look for the existing `await wrappedUpdateTree(...)` / `await wrappedGenerateInitialTree(...)` line and the JSON response that follows it. The only change is destructuring `{ tree, consultedItems }` from the awaited result and adding two fields to the response body. No other fields move.

For the stream route, emit `citedItems` and `consultedItems` as a `stage`-shaped event or attach to the final `tree-update` event. **Inspect** the existing stream-event types in `lib/advance-stream-events.ts` and pick the additive event shape that doesn't break existing consumers.

- [ ] **Step 4: Update route tests**

Each existing route test that asserts on response shape needs the additive fields. Use empty arrays where the test doesn't set up consulted/cited items.

- [ ] **Step 5: Run route tests; expect pass**

```bash
pnpm test tests/unit/advance-session-handler.test.ts tests/unit/advance-stream-route.test.ts tests/unit/create-session-handler.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add app/api/sessions tests/unit/advance-*.test.ts tests/unit/create-session-handler.test.ts lib/advance-stream-events.ts
git commit -m "feat(knowledge-retrieval): route plumbing — shopId, citedItems, consultedItems (PR 4 task 9)"
```

---

## Task 10: Cross-shop scope integration test

**Files:**
- Create: `tests/unit/knowledge-shop-scope.test.ts`

- [ ] **Step 1: Write the cross-shop test**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/db'
import { createShop, createProfile } from '@/lib/db/queries'
import { knowledgeItems, knowledgeItemVehicles } from '@/lib/db/schema'
import { defaultBuildKnowledgeDispatcher } from '@/lib/retrieval/wire-into-tree'

describe('cross-shop scoping', () => {
  let db: TestDb, shopAId: string, shopBId: string, profA: string

  beforeEach(async () => {
    db = await createTestDb()
    const a = await createShop(db, 'Shop A'); shopAId = a.id
    const b = await createShop(db, 'Shop B'); shopBId = b.id
    const profile = await createProfile(db, { email: 'a@e.com', shopId: shopAId }); profA = profile.id
    // Shop B has a P0420 item; Shop A does not.
    const [item] = await db.insert(knowledgeItems).values({
      shopId: shopBId, type: 'cause_fix', title: 'B-only', dtcList: ['P0420'],
      systemCodes: [], symptoms: [], createdByUserId: profA,
    }).returning()
    await db.insert(knowledgeItemVehicles).values({
      knowledgeItemId: item.id, yearStart: 2019, yearEnd: 2019, make: 'Ford', model: 'F-250', engine: '6.7L Powerstroke',
    })
  })
  afterEach(async () => { await db.close() })

  it('lookup_knowledge for Shop A returns zero items even when Shop B has matches', async () => {
    const dispatcher = defaultBuildKnowledgeDispatcher({ db, shopId: shopAId })
    const result = await dispatcher('lookup_knowledge', {
      vehicle: { year: 2019, make: 'Ford', model: 'F-250', engine: '6.7L Powerstroke' },
      dtcs: ['P0420'],
    })
    expect(result.items).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run; expect pass (relies on Tasks 1-2 + Task 8).**

- [ ] **Step 3: Commit**

```bash
git add tests/unit/knowledge-shop-scope.test.ts
git commit -m "test(knowledge-retrieval): cross-shop scope isolation (PR 4 task 10)"
```

---

## Task 11: CRITICAL — empty fall-through integration test

This is the highest-stakes test in PR 4. It guarantees that an empty tool result does NOT cause the AI to refuse.

**Files:**
- Create: `tests/unit/knowledge-empty-fallthrough.test.ts`

- [ ] **Step 1: Write the failing/passing test**

```ts
import { describe, it, expect, vi } from 'vitest'
import { generateInitialTree } from '@/lib/ai/tree-engine'
import { KNOWLEDGE_TOOLS } from '@/lib/knowledge/tools'

// Language patterns that would inverse the product's UX: the AI surfaces
// the absence of vetted data to the tech. The system prompt forbids this.
// If this regex ever matches, PR 4's silent-fall-through guarantee is broken
// and the model must be re-prompted.
const REFUSAL_PATTERNS = [
  /no\s+(verified|vetted|confirmed)\s+data/i,
  /i\s+don't\s+have\s+(verified|vetted|specific)/i,
  /unable\s+to\s+find\s+(verified|vetted|reliable)/i,
  /no\s+(matching|matches?)\s+in\s+(the|our)\s+(knowledge|vetted|shop)/i,
  /knowledge\s+base\s+(is\s+empty|has\s+no|returned\s+nothing)/i,
]

describe('empty fall-through (CRITICAL)', () => {
  it('AI message contains NO refusal language when tool returns empty', async () => {
    const create = vi.fn()
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tu_x', name: 'lookup_knowledge', input: { vehicle: { year: 2019, make: 'Hyundai', model: 'Sonata' }, dtcs: ['P0420'] } }],
      })
      .mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify({
          nodes: [{ id: 'scan-codes', label: 'Pull DTCs and freeze frame', status: 'active' }],
          currentNodeId: 'scan-codes',
          // Spec-compliant fallthrough: AI continues normal diagnostic — no
          // mention of the empty knowledge base. THIS IS THE BEHAVIOR WE TEST.
          message: 'Start by pulling codes and freeze frame. With the cat-efficiency code we will look at upstream/downstream O2 trends.',
        }) }],
      })

    const dispatcher = vi.fn().mockResolvedValue({ items: [] })
    const result = await generateInitialTree(
      {
        vehicleYear: 2021, vehicleMake: 'Hyundai', vehicleModel: 'Sonata',
        vehicleEngine: '2.5L', customerComplaint: 'Check engine on',
        mileage: 45000, ambientConditions: null,
      } as never,
      undefined,
      undefined,
      { tools: KNOWLEDGE_TOOLS, dispatcher, client: { messages: { create } } as never },
    )

    for (const re of REFUSAL_PATTERNS) {
      expect(result.tree.message, `refusal pattern matched: ${re}`).not.toMatch(re)
    }
    expect(result.consultedItems).toEqual([])
  })
})
```

Note: this test mocks the Anthropic response, so it does NOT empirically prove the production prompt elicits the right behavior. What it proves is: the *infrastructure* honors the spec — empty results return clean, no item references, and downstream consumers see an empty `consultedItems`. The prompt's behavior is sharpened via manual smoke + the system prompt language (Task 5). The regex is a guardrail against future drift if anyone ever edits the test fixture to include refusal language.

- [ ] **Step 2: Run; expect pass**

- [ ] **Step 3: Commit**

```bash
git add tests/unit/knowledge-empty-fallthrough.test.ts
git commit -m "test(knowledge-retrieval): empty fall-through guarantee — refusal-language guardrail (PR 4 task 11)"
```

---

## Task 12: AI cites tool results integration test

**Files:**
- Create: `tests/unit/knowledge-ai-session.test.ts`

- [ ] **Step 1: Write test**

```ts
import { describe, it, expect, vi } from 'vitest'
import { generateInitialTree } from '@/lib/ai/tree-engine'
import { extractCitedItems } from '@/lib/knowledge/citations'

const f250Item = {
  id: '11111111-2222-3333-4444-555555555555',
  shopId: 's1', type: 'cause_fix' as const,
  title: 'P0620 LIN bus pull-up failure on 6.7L',
  body: null, structuredData: null,
  dtcList: ['P0620'], systemCodes: ['charging'], symptoms: [],
  fireCount: 3, score: 100,
}

describe('AI cites vetted tool results', () => {
  it('cited [ref:item_id] from message → hydrated citedItems', async () => {
    const create = vi.fn()
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'tu_1', name: 'lookup_knowledge', input: { vehicle: { year: 2019, make: 'Ford', model: 'F-250', engine: '6.7L Powerstroke' }, dtcs: ['P0620'] } }],
      })
      .mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify({
          nodes: [{ id: 'verify-pull-up', label: 'Verify LIN bus pull-up', status: 'active' }],
          currentNodeId: 'verify-pull-up',
          message: 'Shop has a vetted case for this exact code [ref:11111111-2222-3333-4444-555555555555]. Start with pin-3 voltage check.',
        }) }],
      })
    const dispatcher = vi.fn().mockResolvedValue({ items: [f250Item] })
    const result = await generateInitialTree(
      { vehicleYear: 2019, vehicleMake: 'Ford', vehicleModel: 'F-250', vehicleEngine: '6.7L Powerstroke', customerComplaint: 'Battery light', mileage: 90000, ambientConditions: null } as never,
      undefined, undefined,
      { tools: [{ name: 'lookup_knowledge', description: 'x', input_schema: { type: 'object', properties: {}, required: [] } }], dispatcher, client: { messages: { create } } as never },
    )

    expect(result.consultedItems.map((i) => i.id)).toContain(f250Item.id)
    const cited = extractCitedItems(result.tree.message, result.consultedItems)
    expect(cited.map((c) => c.id)).toEqual([f250Item.id])
    expect(cited[0].title).toBe(f250Item.title)
  })
})
```

- [ ] **Step 2: Run; expect pass**

- [ ] **Step 3: Commit**

```bash
git add tests/unit/knowledge-ai-session.test.ts
git commit -m "test(knowledge-retrieval): AI cites tool results — [ref:] hydration (PR 4 task 12)"
```

---

## Task 13: Final verification + branch push

- [ ] **Step 1: Full test suite**

```bash
pnpm test
```

Expected: green. If `tests/unit/pglite-*` is flaky on cold cache, rerun once (see memory `feedback_vitest_pglite_flake`).

- [ ] **Step 2: TypeScript clean**

```bash
pnpm exec tsc --noEmit
```

- [ ] **Step 3: Build clean**

```bash
pnpm build
```

- [ ] **Step 4: Manual smoke (Brandon)**

This is the part Claude cannot run — Brandon must do it on the Vercel preview after he merges the PR. Manual smoke per kickoff Definition of Done:
- Open a session for `2019 Ford F-250 6.7L Powerstroke` with `P0620` after seeding a `cause_fix` item → AI cites it inline in the diagnostic message.
- Open a session for `2021 Hyundai Sonata` (DB empty) → AI's response is normal diagnostic guidance, NO refusal language.

- [ ] **Step 5: Push branch**

```bash
git push -u origin feat/knowledge-retrieval
```

- [ ] **Step 6: Print PR 5 paste-line for Brandon (verbatim per kickoff)**

> Continue PR 5 of the vehicle knowledge platform. Read `docs/superpowers/handoffs/2026-05-16-knowledge-pr5-kickoff.md` and execute it.

Plus the reminder: PR 5 needs the Claude Design package at `designs/design_handoff_vehicle_knowledge/` locally; if missing, that session pauses to ask before doing UI work.

---

## Self-review notes

**Coverage check vs spec kickoff:**

| Kickoff requirement | Plan task |
|---|---|
| `lib/knowledge/retrieval.ts` — 6 fns | Tasks 1, 2 |
| `lib/knowledge/tools.ts` — Anthropic tool defs | Task 4 |
| Update `lib/ai/prompts.ts` — verbatim clauses | Task 5 |
| Integrate into `lib/ai/tree-engine.ts` — tool result loop | Task 6 |
| Extend `aiResponse` payload (citedItems, consultedItems) | Tasks 7, 9 |
| `fire_count` non-blocking increment | Tasks 3, 8 |
| Telemetry hook for empty-result tool calls | **Deferred** — see Open Questions below |
| Unit tests per kickoff §8 | Tasks 1-4, 7, 10 |
| Integration tests §9 (vetted-priority, fall-through, cross-shop) | Tasks 10, 11, 12 |
| AI receives empty tool result → continues normally | Task 11 (CRITICAL) |
| System prompt forbids unvetted technical specifics | Task 5 (verbatim) |

**Open questions for Brandon before execution starts:**

1. **Telemetry hook (kickoff item 7).** The kickoff lists "log empty-result tool calls with vehicle context (for the v2 gaps-to-fill backlog)." This needs a new log/store target. Options:
   - (a) `console.log` JSON-shaped — cheapest, lives in Vercel logs.
   - (b) New `knowledge_tool_telemetry` table — proper but adds a migration.
   - **Recommendation:** (a) for v1. Re-evaluate before PR 7 content lands.

2. **Test convention deviation.** Plan puts everything under `tests/unit/`; spec wrote `tests/integration/`. Following PR 2/3's active convention. Flagging.

3. **`generateInitialTree` return shape changes from `TreeState` to `{ tree, consultedItems }`.** Every caller updates. ~3-5 routes + a handful of tests. No semantic change, just unwrap.

4. **No `tests/integration/` E2E Playwright tests in PR 4.** Spec §9 lists `tests/e2e/knowledge-f250-charging.spec.ts` etc., but those depend on PR 5 (UI) and PR 7 (content). They land later.

5. **Stream route — citedItems via event vs final payload.** Need to inspect `lib/advance-stream-events.ts` to choose. Default plan: attach as a field on the final tree-update event.
