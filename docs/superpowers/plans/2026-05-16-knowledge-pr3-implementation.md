# Knowledge PR 3 — Structured Forms for Rich Types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing `/api/knowledge/save` endpoint to handle the 4 rich knowledge types (pinout, connector, wiring_diagram, theory_of_operation), add Haiku-powered AI assists for parsing OEM pinout text and theory-of-operation text into structured rows, add an image upload pipeline scoped to knowledge artifacts, and add a placeholder UI so the data path is end-to-end testable on Vercel preview.

**Architecture:** Pure additive work on top of PR 2's foundations. Save endpoint extends its `z.discriminatedUnion` schema with 4 new branches. AI helpers mirror `lib/knowledge/classify-paste.ts` exactly (Haiku model, `cachedSystem()`, DI-friendly `AnthropicLike` for tests). Image uploads reuse the existing `artifacts` Supabase Storage bucket with a `knowledge/<shopId>/<type>/<uuid>.<ext>` path namespace, using a new focused helper in `lib/storage/knowledge-image.ts` that mirrors `lib/storage/client.ts` shape. Placeholder UI: a second `<RichKnowledgeForm>` client component mounted on the existing `/knowledge` page.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM, Zod, Supabase Storage (artifacts bucket), Anthropic Haiku, Vitest + happy-dom + PGlite test DB.

**Spec:** `docs/superpowers/specs/2026-05-16-knowledge-pr3-design.md` (this branch) plus master spec `docs/superpowers/specs/2026-05-16-vehicle-knowledge-platform-design.md` (lives on `feat/vehicle-knowledge-platform-spec` branch, treated as canonical).

---

## File Structure

### Files to create

- `lib/knowledge/parse-pinout.ts` — Haiku-backed OEM pinout parser. Mirrors `classify-paste.ts` patterns: `AnthropicLike` injectable, `cachedSystem` system prompt, throws on bad shape.
- `lib/knowledge/parse-theory.ts` — Haiku-backed theory-of-operation parser. Same shape.
- `lib/storage/knowledge-image.ts` — `uploadKnowledgeImage()` + `knowledgeImageSignedUrl()` helpers; reuses `supabase` proxy from `lib/storage/client.ts` and the `artifacts` bucket; new shop-scoped path namespace.
- `app/api/knowledge/parse-pinout/route.ts` — owner-only thin wrapper that calls `parsePinout()`.
- `app/api/knowledge/parse-theory/route.ts` — owner-only thin wrapper that calls `parseTheory()`.
- `app/api/knowledge/upload-image/route.ts` — owner-only multipart upload; MIME + magic-byte + size validation; returns `{ storageKey, signedUrl }`.
- `app/(app)/knowledge/rich-form.tsx` — placeholder client component for the 4 rich types (type picker, per-type fields, AI-assist textarea for pinout/theory, image upload control for connector/wiring_diagram).
- `tests/unit/knowledge-parse-pinout.test.ts` — parser shape + edge cases (header-less paste, GM circuit number column, Toyota color codes, prose-embedded).
- `tests/unit/knowledge-parse-theory.test.ts` — parser shape + edge cases.
- `tests/unit/knowledge-image-upload.test.ts` — upload helper MIME/magic-byte/size/path tests.
- `tests/unit/knowledge-rich-save-schema.test.ts` — Zod schema accepts well-formed and rejects malformed rich-type payloads.
- `tests/unit/knowledge-rich-save-route.test.ts` — integration test: POST each rich type via the save route end-to-end against PGlite.
- `tests/unit/knowledge-upload-image-route.test.ts` — integration test: POST multipart to upload route; gate + validation behavior.

### Files to modify

- `lib/knowledge/save.ts` — extend `SimpleSaveSchema` → `KnowledgeSaveSchema` covering all 8 types (re-export old name as alias for one release to keep import sites stable while PR 3 ships). Remove `RICH_TYPES_NOT_YET_SUPPORTED` (or leave the export defined but as an empty tuple; deleting cleanly is preferred).
- `app/api/knowledge/save/route.ts` — drop the rich-type 400 gate; use `KnowledgeSaveSchema`.
- `app/(app)/knowledge/page.tsx` — mount `<RichKnowledgeForm>` alongside `<KnowledgePasteForm>`.

---

## Task ordering rationale

Pure-schema work first (no DB, no I/O, fastest feedback). Then save-route integration (verifies the new schemas land in DB correctly). Then storage helper + route (independent track; could parallelize). Then AI parsers + routes (most complex; benefits from the rest being green so any test failure clearly points at the parser). Finally UI + final verification.

Each task ends with a commit. Pre-existing tests should stay green after every commit.

---

## Task 1: Add the 4 rich-type Zod schemas to KnowledgeSaveSchema

**Files:**
- Modify: `lib/knowledge/save.ts`
- Test: `tests/unit/knowledge-rich-save-schema.test.ts` (create)

This task adds the schema validators in isolation. The save route still rejects rich types until Task 2 — we'll update one of the existing route tests to expect that the rich-type 400 message is gone after Task 2, not now.

- [ ] **Step 1: Write the failing schema test**

Create `tests/unit/knowledge-rich-save-schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { KnowledgeSaveSchema } from '@/lib/knowledge/save'

const baseVehicleScope = { yearStart: 2017, yearEnd: 2019, make: 'Ford', model: 'F-250', engine: '6.7L Powerstroke' }

describe('KnowledgeSaveSchema — pinout', () => {
  it('accepts a well-formed pinout with 2 pins', () => {
    const result = KnowledgeSaveSchema.safeParse({
      type: 'pinout',
      title: 'Alternator 4-pin pinout',
      vehicleScopes: [baseVehicleScope],
      systemCodes: ['charging'],
      structuredData: {
        connector_ref: 'Alternator 4-pin',
        pins: [
          { pin_number: '1', signal_name: '12V SUPPLY', wire_color: 'RED' },
          { pin_number: '3', signal_name: 'LIN BUS', wire_color: 'GRN/WHT', expected_voltage_or_waveform: 'Steady 5V' },
        ],
      },
    })
    expect(result.success).toBe(true)
  })

  it('rejects duplicate pin_number values', () => {
    const result = KnowledgeSaveSchema.safeParse({
      type: 'pinout',
      title: 'Bad pinout',
      structuredData: {
        connector_ref: 'C1',
        pins: [
          { pin_number: '1', signal_name: 'A' },
          { pin_number: '1', signal_name: 'B' },
        ],
      },
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty pins array', () => {
    const result = KnowledgeSaveSchema.safeParse({
      type: 'pinout',
      title: 'No pins',
      structuredData: { connector_ref: 'C1', pins: [] },
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing connector_ref', () => {
    const result = KnowledgeSaveSchema.safeParse({
      type: 'pinout',
      title: 'No connector ref',
      structuredData: { pins: [{ pin_number: '1', signal_name: 'X' }] },
    })
    expect(result.success).toBe(false)
  })
})

describe('KnowledgeSaveSchema — connector', () => {
  it('accepts a connector with image refs', () => {
    const result = KnowledgeSaveSchema.safeParse({
      type: 'connector',
      title: 'BCM C2280',
      vehicleScopes: [baseVehicleScope],
      systemCodes: ['body_electrical'],
      structuredData: {
        connector_id: 'C2280',
        component_name: 'Body Control Module',
        location_description: 'Behind driver kick panel',
        image_ref: 'knowledge/shop1/connector/abc.jpg',
        mating_end_image_ref: 'knowledge/shop1/connector/def.jpg',
      },
    })
    expect(result.success).toBe(true)
  })

  it('accepts a connector without images', () => {
    const result = KnowledgeSaveSchema.safeParse({
      type: 'connector',
      title: 'Alternator 4-pin',
      structuredData: {
        connector_id: 'alt_4pin',
        component_name: 'Alternator',
      },
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing component_name', () => {
    const result = KnowledgeSaveSchema.safeParse({
      type: 'connector',
      title: 'X',
      structuredData: { connector_id: 'C1' },
    })
    expect(result.success).toBe(false)
  })
})

describe('KnowledgeSaveSchema — wiring_diagram', () => {
  it('accepts a wiring diagram with image and connections', () => {
    const result = KnowledgeSaveSchema.safeParse({
      type: 'wiring_diagram',
      title: 'BCM ↔ Alternator',
      structuredData: {
        name: 'BCM to Alternator charging circuit',
        image_ref: 'knowledge/shop1/wiring_diagram/xyz.png',
        connections: [
          { from_component: 'BCM', from_pin: '3', to_component: 'Alternator', to_pin: '3', wire_color: 'GRN' },
        ],
      },
    })
    expect(result.success).toBe(true)
  })

  it('accepts a wiring diagram with image but no connections', () => {
    const result = KnowledgeSaveSchema.safeParse({
      type: 'wiring_diagram',
      title: 'Image-only',
      structuredData: { name: 'X', image_ref: 'knowledge/shop1/wiring_diagram/x.png' },
    })
    expect(result.success).toBe(true)
  })

  it('rejects wiring diagram without image_ref', () => {
    const result = KnowledgeSaveSchema.safeParse({
      type: 'wiring_diagram',
      title: 'No image',
      structuredData: { name: 'X' },
    })
    expect(result.success).toBe(false)
  })
})

describe('KnowledgeSaveSchema — theory_of_operation', () => {
  it('accepts theory with multiple sections', () => {
    const result = KnowledgeSaveSchema.safeParse({
      type: 'theory_of_operation',
      title: '6.7L charging system theory',
      structuredData: {
        title: '6.7L Powerstroke Charging System',
        sections: [
          { heading: 'Overview', body: 'The 6.7L uses a smart alternator...' },
          { heading: 'LIN bus control', body: 'BCM commands the field via LIN...' },
        ],
      },
    })
    expect(result.success).toBe(true)
  })

  it('rejects empty sections array', () => {
    const result = KnowledgeSaveSchema.safeParse({
      type: 'theory_of_operation',
      title: 'No content',
      structuredData: { title: 'X', sections: [] },
    })
    expect(result.success).toBe(false)
  })

  it('rejects section with empty body', () => {
    const result = KnowledgeSaveSchema.safeParse({
      type: 'theory_of_operation',
      title: 'X',
      structuredData: { title: 'X', sections: [{ heading: 'h', body: '' }] },
    })
    expect(result.success).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test — expect failure (KnowledgeSaveSchema does not exist yet)**

Run: `pnpm test tests/unit/knowledge-rich-save-schema.test.ts`
Expected: FAIL — `KnowledgeSaveSchema is not exported`.

- [ ] **Step 3: Extend `lib/knowledge/save.ts` with the 4 new schemas**

Modify `lib/knowledge/save.ts`. Add these schema definitions after the existing simple-type schemas (after `NoteSchema`, before the `SAVE_SIMPLE_TYPES` constant):

```ts
const PinRowSchema = z.object({
  pin_number: z.string().min(1).max(8),
  signal_name: z.string().min(1).max(120),
  wire_color: z.string().max(40).optional(),
  expected_voltage_or_waveform: z.string().max(200).optional(),
  notes: z.string().max(500).optional(),
})

const PinoutSchema = z.object({
  type: z.literal('pinout'),
  ...CommonFields,
  body: z.string().max(20_000).optional(),
  structuredData: z.object({
    connector_ref: z.string().min(1).max(120),
    pins: z
      .array(PinRowSchema)
      .min(1)
      .max(120)
      .refine(
        (arr) => new Set(arr.map((p) => p.pin_number)).size === arr.length,
        { message: 'duplicate pin_number values' },
      ),
  }),
})

const ConnectorSchema = z.object({
  type: z.literal('connector'),
  ...CommonFields,
  body: z.string().max(20_000).optional(),
  structuredData: z.object({
    connector_id: z.string().min(1).max(60),
    component_name: z.string().min(1).max(120),
    location_description: z.string().max(2_000).optional(),
    image_ref: z.string().max(500).optional(),
    mating_end_image_ref: z.string().max(500).optional(),
  }),
})

const WiringConnectionSchema = z.object({
  from_component: z.string().min(1).max(120),
  from_pin: z.string().max(20).optional(),
  to_component: z.string().min(1).max(120),
  to_pin: z.string().max(20).optional(),
  wire_color: z.string().max(40).optional(),
  splice_id: z.string().max(60).optional(),
  notes: z.string().max(500).optional(),
})

const WiringDiagramSchema = z.object({
  type: z.literal('wiring_diagram'),
  ...CommonFields,
  body: z.string().max(20_000).optional(),
  structuredData: z.object({
    name: z.string().min(1).max(200),
    image_ref: z.string().min(1).max(500),
    connections: z.array(WiringConnectionSchema).max(200).optional().default([]),
  }),
})

const TheorySectionSchema = z.object({
  heading: z.string().min(1).max(200),
  body: z.string().min(1).max(20_000),
})

const TheoryOfOperationSchema = z.object({
  type: z.literal('theory_of_operation'),
  ...CommonFields,
  body: z.string().max(20_000).optional(),
  structuredData: z.object({
    title: z.string().min(1).max(200),
    sections: z.array(TheorySectionSchema).min(1).max(40),
  }),
})
```

Then replace the existing `SimpleSaveSchema` definition + the related exports. Find:

```ts
export const SAVE_SIMPLE_TYPES = ['cause_fix', 'reference_doc', 'bulletin', 'note'] as const
export const RICH_TYPES_NOT_YET_SUPPORTED = [
  'pinout',
  'connector',
  'wiring_diagram',
  'theory_of_operation',
] as const

export const SimpleSaveSchema = z.discriminatedUnion('type', [
  CauseFixSchema,
  BulletinSchema,
  ReferenceDocSchema,
  NoteSchema,
])

export type SimpleSaveInput = z.infer<typeof SimpleSaveSchema>
```

…and replace with:

```ts
export const SAVE_SIMPLE_TYPES = ['cause_fix', 'reference_doc', 'bulletin', 'note'] as const
export const SAVE_RICH_TYPES = ['pinout', 'connector', 'wiring_diagram', 'theory_of_operation'] as const
export const SAVE_ALL_TYPES = [...SAVE_SIMPLE_TYPES, ...SAVE_RICH_TYPES] as const

export const KnowledgeSaveSchema = z.discriminatedUnion('type', [
  CauseFixSchema,
  BulletinSchema,
  ReferenceDocSchema,
  NoteSchema,
  PinoutSchema,
  ConnectorSchema,
  WiringDiagramSchema,
  TheoryOfOperationSchema,
])

export type KnowledgeSaveInput = z.infer<typeof KnowledgeSaveSchema>
```

Update the `saveKnowledgeItem` function signature from `SimpleSaveInput` to `KnowledgeSaveInput`. The function body works as-is because it uses the discriminator + `'body' in input` / `'structuredData' in input` shape checks that already generalize.

```ts
export async function saveKnowledgeItem(
  input: KnowledgeSaveInput,
  ctx: SaveContext,
): Promise<SaveResult> {
  // ...existing body unchanged...
}
```

- [ ] **Step 4: Run the schema test — expect pass**

Run: `pnpm test tests/unit/knowledge-rich-save-schema.test.ts`
Expected: PASS (all 11 cases).

- [ ] **Step 5: Run pre-existing tests that reference the old name — confirm what needs updating**

Run: `pnpm exec tsc --noEmit 2>&1 | grep -E "SimpleSaveSchema|SimpleSaveInput|RICH_TYPES_NOT_YET_SUPPORTED" | head`
Expected: a list of files still importing the old names (the save route + maybe the route test).

- [ ] **Step 6: Update the save route to use KnowledgeSaveSchema + drop the rich-type gate**

Modify `app/api/knowledge/save/route.ts`. Replace the body of the POST handler with:

```ts
import { NextResponse } from 'next/server'
import { requireCurator } from '@/lib/curator/route-helpers'
import { saveKnowledgeItem, KnowledgeSaveSchema } from '@/lib/knowledge/save'

export async function POST(req: Request) {
  const auth = await requireCurator()
  if (auth.kind === 'forbidden') return auth.response

  let json: unknown
  try {
    json = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const parsed = KnowledgeSaveSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_input', issues: parsed.error.issues },
      { status: 422 },
    )
  }

  const result = await saveKnowledgeItem(parsed.data, {
    shopId: auth.shopId,
    createdByUserId: auth.profileId,
  })
  return NextResponse.json({ id: result.id }, { status: 201 })
}
```

The entire `RICH_TYPES_NOT_YET_SUPPORTED` import + the 400-gate block are gone.

- [ ] **Step 7: Update the pre-existing PR 2 route test that asserted the 400 gate**

Modify `tests/unit/knowledge-save-route.test.ts`. Find the test:

```ts
it('returns 400 when type is a rich type (pinout/connector/etc) — handled in PR 3', async () => {
  // ...
  expect(res.status).toBe(400)
})
```

…and replace its body to assert the rich-type now goes through the schema. Replace with:

```ts
it('returns 422 (not 400) when a rich type fails validation — gate dropped in PR 3', async () => {
  // PR 2 used to return 400 'rich_type_not_yet_supported' to signal "use the
  // structured form." PR 3 removes that gate; rich types are validated by the
  // unified schema like every other type. This empty-pinout payload is an
  // invalid pinout structure and should now return 422.
  await mockUser(OWNER_USER_ID)
  const { POST } = await import('@/app/api/knowledge/save/route')
  const res = await POST(
    new Request('http://localhost/api/knowledge/save', {
      method: 'POST',
      body: JSON.stringify({ type: 'pinout', title: 'x', body: 'x' }),
    }),
  )
  expect(res.status).toBe(422)
})
```

- [ ] **Step 8: Run all knowledge-related tests — expect green**

Run: `pnpm test tests/unit/knowledge-`
Expected: all knowledge unit/route tests pass.

- [ ] **Step 9: TypeScript check**

Run: `pnpm exec tsc --noEmit`
Expected: clean (no errors).

- [ ] **Step 10: Commit**

```bash
git add lib/knowledge/save.ts app/api/knowledge/save/route.ts \
  tests/unit/knowledge-rich-save-schema.test.ts tests/unit/knowledge-save-route.test.ts
git commit -m "$(cat <<'EOF'
feat(knowledge-rich-forms): extend save schema for 4 rich types (PR 3 task 1)

Replaces SimpleSaveSchema with KnowledgeSaveSchema covering all 8 knowledge
types (4 simple from PR 2 + pinout, connector, wiring_diagram,
theory_of_operation). Drops the rich-type 400 gate in the save route; rich
types are now validated by the unified discriminated union and return 422 on
malformed input like every other type.

Pinout enforces unique pin_number within an item; theory_of_operation
requires at least one section with a non-empty body; wiring_diagram requires
an image_ref but treats connections as optional (image-only diagrams are
valid v1 content per spec).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Integration test — save each rich type end-to-end via the route

**Files:**
- Test: `tests/unit/knowledge-rich-save-route.test.ts` (create)

This task verifies that rich-type payloads, once validated, actually land in PGlite with the right `structured_data` JSONB shape. No route changes — the route was updated in Task 1.

- [ ] **Step 1: Write the failing integration test**

Create `tests/unit/knowledge-rich-save-route.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import {
  knowledgeItems,
  knowledgeItemVehicles,
  profiles,
  shops,
} from '@/lib/db/schema'

let currentDb: TestDb
vi.mock('@/lib/db/client', () => ({
  db: new Proxy({} as TestDb, {
    get: (_t, prop) => {
      const value = (currentDb as unknown as Record<PropertyKey, unknown>)[prop as PropertyKey]
      return typeof value === 'function' ? value.bind(currentDb) : value
    },
  }),
}))

vi.mock('@/lib/supabase-server', () => ({
  getServerSupabase: vi.fn(),
}))

async function mockUser(userId: string | null, email: string | null = 'owner@shop.test') {
  const { getServerSupabase } = await import('@/lib/supabase-server')
  vi.mocked(getServerSupabase).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId, email } : null },
      }),
    },
  } as unknown as Awaited<ReturnType<typeof getServerSupabase>>)
}

const OWNER_USER_ID = '00000000-0000-0000-0000-000000000001'

describe('POST /api/knowledge/save — rich types', () => {
  let close: () => Promise<void>
  let shopId: string

  beforeEach(async () => {
    const created = await createTestDb()
    currentDb = created.db
    close = created.close

    const [shop] = await currentDb.insert(shops).values({ name: 'Shop' }).returning()
    shopId = shop.id
    await currentDb.insert(profiles).values({
      userId: OWNER_USER_ID,
      role: 'owner',
      shopId,
      fullName: 'Owner',
    })
  })

  afterEach(async () => {
    await close()
    vi.clearAllMocks()
  })

  it('saves a pinout with structured pins + vehicle scope', async () => {
    await mockUser(OWNER_USER_ID)
    const { POST } = await import('@/app/api/knowledge/save/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/save', {
        method: 'POST',
        body: JSON.stringify({
          type: 'pinout',
          title: 'Alternator 4-pin pinout — 6.7L Powerstroke',
          systemCodes: ['charging'],
          vehicleScopes: [
            { yearStart: 2017, yearEnd: 2019, make: 'Ford', model: 'F-250', engine: '6.7L Powerstroke' },
          ],
          structuredData: {
            connector_ref: 'Alternator 4-pin',
            pins: [
              { pin_number: '1', signal_name: '12V SUPPLY', wire_color: 'RED' },
              { pin_number: '2', signal_name: 'GROUND', wire_color: 'BLK' },
              { pin_number: '3', signal_name: 'LIN BUS', wire_color: 'GRN/WHT', expected_voltage_or_waveform: 'Steady 5V' },
              { pin_number: '4', signal_name: 'IGNITION ENABLE', wire_color: 'YEL' },
            ],
          },
        }),
      }),
    )
    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: string }

    const [row] = await currentDb.select().from(knowledgeItems).where(eq(knowledgeItems.id, id))
    expect(row.type).toBe('pinout')
    expect(row.shopId).toBe(shopId)
    expect(row.structuredData).toMatchObject({
      connector_ref: 'Alternator 4-pin',
      pins: expect.arrayContaining([
        expect.objectContaining({ pin_number: '3', signal_name: 'LIN BUS' }),
      ]),
    })

    const scopes = await currentDb
      .select()
      .from(knowledgeItemVehicles)
      .where(eq(knowledgeItemVehicles.knowledgeItemId, id))
    expect(scopes).toHaveLength(1)
    expect(scopes[0].engine).toBe('6.7L Powerstroke')
  })

  it('saves a connector with image refs', async () => {
    await mockUser(OWNER_USER_ID)
    const { POST } = await import('@/app/api/knowledge/save/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/save', {
        method: 'POST',
        body: JSON.stringify({
          type: 'connector',
          title: 'BCM C2280',
          structuredData: {
            connector_id: 'C2280',
            component_name: 'Body Control Module',
            location_description: 'Behind driver kick panel',
            image_ref: 'knowledge/shop1/connector/abc.jpg',
            mating_end_image_ref: 'knowledge/shop1/connector/def.jpg',
          },
        }),
      }),
    )
    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: string }

    const [row] = await currentDb.select().from(knowledgeItems).where(eq(knowledgeItems.id, id))
    expect(row.type).toBe('connector')
    expect(row.structuredData).toMatchObject({
      connector_id: 'C2280',
      image_ref: 'knowledge/shop1/connector/abc.jpg',
    })
  })

  it('saves a wiring_diagram with image and connections', async () => {
    await mockUser(OWNER_USER_ID)
    const { POST } = await import('@/app/api/knowledge/save/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/save', {
        method: 'POST',
        body: JSON.stringify({
          type: 'wiring_diagram',
          title: 'BCM ↔ Alternator',
          structuredData: {
            name: 'BCM to Alternator charging circuit',
            image_ref: 'knowledge/shop1/wiring_diagram/xyz.png',
            connections: [
              { from_component: 'BCM', from_pin: '3', to_component: 'Alternator', to_pin: '3', wire_color: 'GRN' },
            ],
          },
        }),
      }),
    )
    expect(res.status).toBe(201)
  })

  it('saves a theory_of_operation with sections', async () => {
    await mockUser(OWNER_USER_ID)
    const { POST } = await import('@/app/api/knowledge/save/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/save', {
        method: 'POST',
        body: JSON.stringify({
          type: 'theory_of_operation',
          title: '6.7L charging system theory',
          systemCodes: ['charging'],
          structuredData: {
            title: '6.7L Powerstroke Charging System',
            sections: [
              { heading: 'Overview', body: 'The 6.7L uses a smart alternator controlled via LIN bus.' },
              { heading: 'LIN bus control', body: 'BCM commands the field via LIN messages.' },
            ],
          },
        }),
      }),
    )
    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: string }
    const [row] = await currentDb.select().from(knowledgeItems).where(eq(knowledgeItems.id, id))
    const sd = row.structuredData as { sections: Array<{ heading: string }> }
    expect(sd.sections).toHaveLength(2)
    expect(sd.sections[0].heading).toBe('Overview')
  })

  it('returns 422 for a pinout with duplicate pin numbers', async () => {
    await mockUser(OWNER_USER_ID)
    const { POST } = await import('@/app/api/knowledge/save/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/save', {
        method: 'POST',
        body: JSON.stringify({
          type: 'pinout',
          title: 'Bad pinout',
          structuredData: {
            connector_ref: 'C1',
            pins: [
              { pin_number: '1', signal_name: 'A' },
              { pin_number: '1', signal_name: 'B' },
            ],
          },
        }),
      }),
    )
    expect(res.status).toBe(422)
  })
})
```

- [ ] **Step 2: Run the test — expect pass (schema + route already done in Task 1)**

Run: `pnpm test tests/unit/knowledge-rich-save-route.test.ts`
Expected: PASS (all 5 cases).

If anything fails, the most likely cause is the `saveKnowledgeItem` function's `'structuredData' in input` check — verify it routes the rich `structuredData` to the JSONB column correctly.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/knowledge-rich-save-route.test.ts
git commit -m "$(cat <<'EOF'
test(knowledge-rich-forms): integration tests for rich-type save (PR 3 task 2)

End-to-end coverage that POST /api/knowledge/save persists each of the 4
rich types into PGlite with the right structured_data JSONB shape and
honors the same shop-scoping + vehicle scope behavior as the simple types.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Knowledge image upload helper

**Files:**
- Create: `lib/storage/knowledge-image.ts`
- Test: `tests/unit/knowledge-image-upload.test.ts` (create)

- [ ] **Step 1: Write the failing helper tests**

Create `tests/unit/knowledge-image-upload.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import {
  uploadKnowledgeImage,
  knowledgeImageSignedUrl,
  KNOWLEDGE_IMAGE_MAX_BYTES,
  validateKnowledgeImageBytes,
} from '@/lib/storage/knowledge-image'

const SHOP_ID = '11111111-1111-1111-1111-111111111111'

describe('uploadKnowledgeImage', () => {
  it('returns a shop-scoped key under the knowledge/ namespace', async () => {
    const upload = vi.fn().mockResolvedValue({ data: { path: 'ignored' }, error: null })
    const key = await uploadKnowledgeImage({
      shopId: SHOP_ID,
      knowledgeType: 'connector',
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'image/jpeg',
      upload,
    })
    expect(key).toMatch(new RegExp(`^knowledge/${SHOP_ID}/connector/[0-9a-f-]+\\.jpg$`))
  })

  it('uses png extension for image/png', async () => {
    const upload = vi.fn().mockResolvedValue({ data: { path: 'ok' }, error: null })
    const key = await uploadKnowledgeImage({
      shopId: SHOP_ID,
      knowledgeType: 'wiring_diagram',
      bytes: new Uint8Array([1]),
      mimeType: 'image/png',
      upload,
    })
    expect(key).toMatch(/\.png$/)
  })

  it('uses svg extension for image/svg+xml', async () => {
    const upload = vi.fn().mockResolvedValue({ data: { path: 'ok' }, error: null })
    const key = await uploadKnowledgeImage({
      shopId: SHOP_ID,
      knowledgeType: 'wiring_diagram',
      bytes: new Uint8Array([1]),
      mimeType: 'image/svg+xml',
      upload,
    })
    expect(key).toMatch(/\.svg$/)
  })

  it('passes bytes and content-type through to storage', async () => {
    const upload = vi.fn().mockResolvedValue({ data: { path: 'ok' }, error: null })
    const bytes = new Uint8Array([7, 8, 9])
    await uploadKnowledgeImage({
      shopId: SHOP_ID,
      knowledgeType: 'connector',
      bytes,
      mimeType: 'image/jpeg',
      upload,
    })
    const [, calledBytes, opts] = upload.mock.calls[0]
    expect(calledBytes).toBe(bytes)
    expect(opts).toEqual({ contentType: 'image/jpeg', upsert: false })
  })

  it('throws when storage returns an error', async () => {
    const upload = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } })
    await expect(
      uploadKnowledgeImage({
        shopId: SHOP_ID,
        knowledgeType: 'connector',
        bytes: new Uint8Array([1]),
        mimeType: 'image/jpeg',
        upload,
      }),
    ).rejects.toThrow(/upload failed.*boom/)
  })
})

describe('knowledgeImageSignedUrl', () => {
  it('returns the signed URL string', async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({
      data: { signedUrl: 'https://signed.example/x' },
      error: null,
    })
    const url = await knowledgeImageSignedUrl(
      `knowledge/${SHOP_ID}/connector/abc.jpg`,
      undefined,
      { createSignedUrl },
    )
    expect(url).toBe('https://signed.example/x')
  })

  it('defaults expiry to 3600s', async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({
      data: { signedUrl: 'https://x' },
      error: null,
    })
    await knowledgeImageSignedUrl('k', undefined, { createSignedUrl })
    expect(createSignedUrl).toHaveBeenCalledWith('k', 3600)
  })
})

describe('validateKnowledgeImageBytes', () => {
  it('accepts JPG with the FF D8 FF magic bytes', () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
    expect(validateKnowledgeImageBytes(bytes, 'image/jpeg')).toBe('ok')
  })

  it('accepts PNG with the 89 50 4E 47 magic bytes', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(validateKnowledgeImageBytes(bytes, 'image/png')).toBe('ok')
  })

  it('accepts SVG whose first non-whitespace token is <svg', () => {
    const svg = new TextEncoder().encode('<?xml version="1.0"?>\n<svg xmlns="..."></svg>')
    expect(validateKnowledgeImageBytes(svg, 'image/svg+xml')).toBe('ok')
  })

  it('accepts SVG without xml prolog', () => {
    const svg = new TextEncoder().encode('<svg></svg>')
    expect(validateKnowledgeImageBytes(svg, 'image/svg+xml')).toBe('ok')
  })

  it('rejects HTML pretending to be SVG', () => {
    const html = new TextEncoder().encode('<html><body><script>alert(1)</script></body></html>')
    expect(validateKnowledgeImageBytes(html, 'image/svg+xml')).toBe('bad_magic_bytes')
  })

  it('rejects JPG bytes claimed as PNG', () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff])
    expect(validateKnowledgeImageBytes(bytes, 'image/png')).toBe('bad_magic_bytes')
  })

  it('rejects an unsupported MIME type', () => {
    expect(validateKnowledgeImageBytes(new Uint8Array([1]), 'application/pdf')).toBe('bad_mime_type')
  })

  it('rejects bytes larger than the max size', () => {
    const huge = new Uint8Array(KNOWLEDGE_IMAGE_MAX_BYTES + 1)
    huge[0] = 0xff
    huge[1] = 0xd8
    huge[2] = 0xff
    expect(validateKnowledgeImageBytes(huge, 'image/jpeg')).toBe('too_large')
  })
})
```

- [ ] **Step 2: Run the test — expect failure (module does not exist)**

Run: `pnpm test tests/unit/knowledge-image-upload.test.ts`
Expected: FAIL — `Cannot find module '@/lib/storage/knowledge-image'`.

- [ ] **Step 3: Create the helper**

Create `lib/storage/knowledge-image.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { supabase } from '@/lib/storage/client'
import type {
  StorageUploadFn,
  StorageCreateSignedUrlFn,
} from '@/lib/storage/client'

// Knowledge images reuse the existing 'artifacts' Supabase Storage bucket
// (see lib/storage/client.ts). Access control is enforced at the route layer
// (requireCurator) plus the shop-scoped path namespace below; the bucket runs
// with the service-role client. Per the PR 3 design doc, this is intentional
// — a second bucket would not change the effective security model.

const BUCKET = 'artifacts'

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
}

export const KNOWLEDGE_IMAGE_MAX_BYTES = 10 * 1024 * 1024 // 10 MB per spec
export const KNOWLEDGE_IMAGE_ALLOWED_MIME = Object.keys(MIME_TO_EXT) as readonly string[]

export type KnowledgeImageType = 'connector' | 'wiring_diagram'

export type ValidationResult = 'ok' | 'bad_mime_type' | 'bad_magic_bytes' | 'too_large'

// Magic-byte validation — defends against HTML-with-.svg-extension tricks
// and MIME-spoofing. SVG must be rendered via <img> tags only (per the
// PR 3 design doc); never inline-embed.
export function validateKnowledgeImageBytes(
  bytes: Uint8Array,
  mimeType: string,
): ValidationResult {
  if (!(mimeType in MIME_TO_EXT)) return 'bad_mime_type'
  if (bytes.byteLength > KNOWLEDGE_IMAGE_MAX_BYTES) return 'too_large'

  if (mimeType === 'image/jpeg') {
    if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
      return 'bad_magic_bytes'
    }
    return 'ok'
  }
  if (mimeType === 'image/png') {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    if (bytes.length < sig.length) return 'bad_magic_bytes'
    for (let i = 0; i < sig.length; i++) {
      if (bytes[i] !== sig[i]) return 'bad_magic_bytes'
    }
    return 'ok'
  }
  if (mimeType === 'image/svg+xml') {
    // First non-whitespace token must be <?xml or <svg (case-insensitive).
    // We scan up to the first 512 bytes; anything beyond that is unlikely to
    // be a valid SVG header.
    const head = new TextDecoder('utf-8', { fatal: false })
      .decode(bytes.subarray(0, Math.min(bytes.length, 512)))
      .replace(/^﻿/, '') // strip BOM
      .trimStart()
      .toLowerCase()
    if (head.startsWith('<?xml')) {
      // skip the xml prolog and find the next < tag
      const after = head.slice(head.indexOf('?>') + 2).trimStart()
      if (after.startsWith('<svg')) return 'ok'
      return 'bad_magic_bytes'
    }
    if (head.startsWith('<svg')) return 'ok'
    return 'bad_magic_bytes'
  }
  return 'bad_mime_type'
}

export async function uploadKnowledgeImage(input: {
  shopId: string
  knowledgeType: KnowledgeImageType
  bytes: Uint8Array | Blob
  mimeType: string
  upload?: StorageUploadFn
}): Promise<string> {
  const baseMime = input.mimeType.split(';')[0].trim()
  const ext = MIME_TO_EXT[baseMime] ?? 'bin'
  const key = `knowledge/${input.shopId}/${input.knowledgeType}/${randomUUID()}.${ext}`
  const upload =
    input.upload ?? ((path, body, opts) => supabase.storage.from(BUCKET).upload(path, body, opts))
  const { error } = await upload(key, input.bytes, {
    contentType: input.mimeType,
    upsert: false,
  })
  if (error) throw new Error(`upload failed: ${error.message}`)
  return key
}

export async function knowledgeImageSignedUrl(
  storageKey: string,
  expiresInSec = 3600,
  opts: { createSignedUrl?: StorageCreateSignedUrlFn } = {},
): Promise<string> {
  const createSignedUrl =
    opts.createSignedUrl ??
    ((path, secs) => supabase.storage.from(BUCKET).createSignedUrl(path, secs))
  const { data, error } = await createSignedUrl(storageKey, expiresInSec)
  if (error || !data) throw new Error(`signed url failed: ${error?.message ?? 'no data'}`)
  return data.signedUrl
}
```

- [ ] **Step 4: Run the helper tests — expect pass**

Run: `pnpm test tests/unit/knowledge-image-upload.test.ts`
Expected: PASS (all 15 cases).

- [ ] **Step 5: TypeScript check**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/storage/knowledge-image.ts tests/unit/knowledge-image-upload.test.ts
git commit -m "$(cat <<'EOF'
feat(knowledge-rich-forms): image upload helper with magic-byte validation (PR 3 task 3)

uploadKnowledgeImage + knowledgeImageSignedUrl reuse the existing 'artifacts'
Supabase Storage bucket under a shop-scoped knowledge/<shopId>/<type>/<uuid>
path namespace — matches the lib/storage/client.ts pattern; no new bucket
provisioning.

validateKnowledgeImageBytes enforces MIME accept-list (JPG/PNG/SVG), 10MB
cap, and per-format magic-byte checks. SVG validation requires the file to
start with <?xml or <svg, rejecting HTML-with-.svg-extension tricks. Per the
design doc, SVG must be rendered via <img> tags only (not inlined) — that
discipline lives in the UI layer added later in this PR.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Image upload route

**Files:**
- Create: `app/api/knowledge/upload-image/route.ts`
- Test: `tests/unit/knowledge-upload-image-route.test.ts` (create)

- [ ] **Step 1: Write the failing route test**

Create `tests/unit/knowledge-upload-image-route.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/db'
import { profiles, shops } from '@/lib/db/schema'

let currentDb: TestDb
vi.mock('@/lib/db/client', () => ({
  db: new Proxy({} as TestDb, {
    get: (_t, prop) => {
      const value = (currentDb as unknown as Record<PropertyKey, unknown>)[prop as PropertyKey]
      return typeof value === 'function' ? value.bind(currentDb) : value
    },
  }),
}))
vi.mock('@/lib/supabase-server', () => ({
  getServerSupabase: vi.fn(),
}))

// Mock the storage upload + signedUrl so the route test never reaches Supabase.
vi.mock('@/lib/storage/knowledge-image', async () => {
  const actual = await vi.importActual<typeof import('@/lib/storage/knowledge-image')>(
    '@/lib/storage/knowledge-image',
  )
  return {
    ...actual,
    uploadKnowledgeImage: vi.fn(async ({ shopId, knowledgeType }) => {
      return `knowledge/${shopId}/${knowledgeType}/test-uuid.jpg`
    }),
    knowledgeImageSignedUrl: vi.fn(async (key) => `https://signed.example/${key}`),
  }
})

async function mockUser(userId: string | null, email: string | null = 'owner@shop.test') {
  const { getServerSupabase } = await import('@/lib/supabase-server')
  vi.mocked(getServerSupabase).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId, email } : null },
      }),
    },
  } as unknown as Awaited<ReturnType<typeof getServerSupabase>>)
}

const OWNER_USER_ID = '00000000-0000-0000-0000-000000000001'
const TECH_USER_ID = '00000000-0000-0000-0000-000000000002'

// JPG magic bytes (FF D8 FF E0) followed by minimal padding so byteLength > 4
const VALID_JPG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46])

function multipartFile(opts: { kind: string; bytes: Uint8Array; mimeType: string; filename?: string }) {
  const form = new FormData()
  form.append('knowledgeType', opts.kind)
  form.append(
    'file',
    new Blob([opts.bytes.slice().buffer as ArrayBuffer], { type: opts.mimeType }),
    opts.filename ?? 'upload.bin',
  )
  return form
}

describe('POST /api/knowledge/upload-image', () => {
  let close: () => Promise<void>
  let shopId: string

  beforeEach(async () => {
    const created = await createTestDb()
    currentDb = created.db
    close = created.close
    const [shop] = await currentDb.insert(shops).values({ name: 'Shop' }).returning()
    shopId = shop.id
    await currentDb
      .insert(profiles)
      .values({ userId: OWNER_USER_ID, role: 'owner', shopId, fullName: 'Owner' })
    await currentDb
      .insert(profiles)
      .values({ userId: TECH_USER_ID, role: 'tech', shopId, fullName: 'Tech' })
  })

  afterEach(async () => {
    await close()
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    await mockUser(null)
    const { POST } = await import('@/app/api/knowledge/upload-image/route')
    const form = multipartFile({ kind: 'connector', bytes: VALID_JPG_BYTES, mimeType: 'image/jpeg' })
    const res = await POST(
      new Request('http://localhost/api/knowledge/upload-image', { method: 'POST', body: form }),
    )
    expect(res.status).toBe(401)
  })

  it('returns 403 for a tech-role user', async () => {
    await mockUser(TECH_USER_ID)
    const { POST } = await import('@/app/api/knowledge/upload-image/route')
    const form = multipartFile({ kind: 'connector', bytes: VALID_JPG_BYTES, mimeType: 'image/jpeg' })
    const res = await POST(
      new Request('http://localhost/api/knowledge/upload-image', { method: 'POST', body: form }),
    )
    expect(res.status).toBe(403)
  })

  it('returns 400 when no multipart body is present', async () => {
    await mockUser(OWNER_USER_ID)
    const { POST } = await import('@/app/api/knowledge/upload-image/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/upload-image', {
        method: 'POST',
        body: JSON.stringify({ foo: 'bar' }),
        headers: { 'content-type': 'application/json' },
      }),
    )
    expect(res.status).toBe(400)
  })

  it('returns 422 when knowledgeType is missing', async () => {
    await mockUser(OWNER_USER_ID)
    const { POST } = await import('@/app/api/knowledge/upload-image/route')
    const form = new FormData()
    form.append('file', new Blob([VALID_JPG_BYTES.slice().buffer as ArrayBuffer], { type: 'image/jpeg' }))
    const res = await POST(
      new Request('http://localhost/api/knowledge/upload-image', { method: 'POST', body: form }),
    )
    expect(res.status).toBe(422)
  })

  it('returns 422 when knowledgeType is not connector or wiring_diagram', async () => {
    await mockUser(OWNER_USER_ID)
    const { POST } = await import('@/app/api/knowledge/upload-image/route')
    const form = multipartFile({ kind: 'pinout', bytes: VALID_JPG_BYTES, mimeType: 'image/jpeg' })
    const res = await POST(
      new Request('http://localhost/api/knowledge/upload-image', { method: 'POST', body: form }),
    )
    expect(res.status).toBe(422)
  })

  it('returns 422 when MIME type is not in the accept-list', async () => {
    await mockUser(OWNER_USER_ID)
    const { POST } = await import('@/app/api/knowledge/upload-image/route')
    const form = multipartFile({
      kind: 'connector',
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      mimeType: 'application/pdf',
    })
    const res = await POST(
      new Request('http://localhost/api/knowledge/upload-image', { method: 'POST', body: form }),
    )
    expect(res.status).toBe(422)
  })

  it('returns 422 when bytes do not match the declared MIME type', async () => {
    await mockUser(OWNER_USER_ID)
    const { POST } = await import('@/app/api/knowledge/upload-image/route')
    // Claim PNG MIME but send JPG bytes
    const form = multipartFile({ kind: 'connector', bytes: VALID_JPG_BYTES, mimeType: 'image/png' })
    const res = await POST(
      new Request('http://localhost/api/knowledge/upload-image', { method: 'POST', body: form }),
    )
    expect(res.status).toBe(422)
  })

  it('returns 201 with storageKey and signedUrl on success', async () => {
    await mockUser(OWNER_USER_ID)
    const { POST } = await import('@/app/api/knowledge/upload-image/route')
    const form = multipartFile({ kind: 'connector', bytes: VALID_JPG_BYTES, mimeType: 'image/jpeg' })
    const res = await POST(
      new Request('http://localhost/api/knowledge/upload-image', { method: 'POST', body: form }),
    )
    expect(res.status).toBe(201)
    const json = (await res.json()) as { storageKey: string; signedUrl: string }
    expect(json.storageKey).toMatch(/^knowledge\/.+\/connector\/.+\.jpg$/)
    expect(json.signedUrl).toContain('signed.example')
  })

  it('accepts SVG with valid <svg start', async () => {
    await mockUser(OWNER_USER_ID)
    const { POST } = await import('@/app/api/knowledge/upload-image/route')
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    const form = multipartFile({ kind: 'wiring_diagram', bytes: svg, mimeType: 'image/svg+xml' })
    const res = await POST(
      new Request('http://localhost/api/knowledge/upload-image', { method: 'POST', body: form }),
    )
    expect(res.status).toBe(201)
  })

  it('rejects SVG whose bytes are actually HTML', async () => {
    await mockUser(OWNER_USER_ID)
    const { POST } = await import('@/app/api/knowledge/upload-image/route')
    const html = new TextEncoder().encode('<html><script>alert(1)</script></html>')
    const form = multipartFile({ kind: 'wiring_diagram', bytes: html, mimeType: 'image/svg+xml' })
    const res = await POST(
      new Request('http://localhost/api/knowledge/upload-image', { method: 'POST', body: form }),
    )
    expect(res.status).toBe(422)
  })
})
```

- [ ] **Step 2: Run the test — expect failure (route does not exist)**

Run: `pnpm test tests/unit/knowledge-upload-image-route.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/knowledge/upload-image/route'`.

- [ ] **Step 3: Create the upload route**

Create `app/api/knowledge/upload-image/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { requireCurator } from '@/lib/curator/route-helpers'
import {
  uploadKnowledgeImage,
  knowledgeImageSignedUrl,
  validateKnowledgeImageBytes,
  KNOWLEDGE_IMAGE_MAX_BYTES,
  type KnowledgeImageType,
} from '@/lib/storage/knowledge-image'

// Image uploads can be 10MB and span a coast-to-coast round trip; give the
// route a generous-but-bounded budget. Matches the maxDuration set on the
// session capture route.
export const maxDuration = 60

const ALLOWED_TYPES: ReadonlySet<KnowledgeImageType> = new Set(['connector', 'wiring_diagram'])

function isKnowledgeImageType(s: string): s is KnowledgeImageType {
  return ALLOWED_TYPES.has(s as KnowledgeImageType)
}

export async function POST(req: Request) {
  const auth = await requireCurator()
  if (auth.kind === 'forbidden') return auth.response

  const form = await req.formData().catch(() => null)
  if (!form) {
    return NextResponse.json({ error: 'multipart_required' }, { status: 400 })
  }

  const knowledgeTypeRaw = form.get('knowledgeType')
  if (typeof knowledgeTypeRaw !== 'string' || !isKnowledgeImageType(knowledgeTypeRaw)) {
    return NextResponse.json(
      { error: 'invalid_input', message: 'knowledgeType must be "connector" or "wiring_diagram"' },
      { status: 422 },
    )
  }
  const knowledgeType = knowledgeTypeRaw

  const file = form.get('file')
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: 'invalid_input', message: 'file field required' }, { status: 422 })
  }
  if (file.size > KNOWLEDGE_IMAGE_MAX_BYTES) {
    return NextResponse.json(
      { error: 'too_large', message: `file exceeds ${KNOWLEDGE_IMAGE_MAX_BYTES} bytes` },
      { status: 422 },
    )
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const baseMime = file.type.split(';')[0].trim()

  const validation = validateKnowledgeImageBytes(bytes, baseMime)
  if (validation !== 'ok') {
    return NextResponse.json(
      { error: 'invalid_input', reason: validation },
      { status: 422 },
    )
  }

  let storageKey: string
  try {
    storageKey = await uploadKnowledgeImage({
      shopId: auth.shopId,
      knowledgeType,
      bytes,
      mimeType: baseMime,
    })
  } catch (err) {
    return NextResponse.json(
      { error: 'upload_failed', message: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    )
  }

  let signedUrl: string
  try {
    signedUrl = await knowledgeImageSignedUrl(storageKey)
  } catch (err) {
    // The upload succeeded — return the key with no signedUrl. The UI can
    // request one later, and the row references the key anyway.
    return NextResponse.json(
      {
        storageKey,
        signedUrl: null,
        signedUrlError: err instanceof Error ? err.message : 'unknown',
      },
      { status: 201 },
    )
  }

  return NextResponse.json({ storageKey, signedUrl }, { status: 201 })
}
```

- [ ] **Step 4: Run the test — expect pass**

Run: `pnpm test tests/unit/knowledge-upload-image-route.test.ts`
Expected: PASS (10 cases).

- [ ] **Step 5: TypeScript check**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add app/api/knowledge/upload-image/route.ts tests/unit/knowledge-upload-image-route.test.ts
git commit -m "$(cat <<'EOF'
feat(knowledge-rich-forms): POST /api/knowledge/upload-image route (PR 3 task 4)

Owner-only multipart upload accepting connector/wiring_diagram images.
Enforces the 10MB cap, MIME accept-list (JPG/PNG/SVG), and per-format
magic-byte validation before sending bytes to Supabase Storage. Returns
{ storageKey, signedUrl } on success; the storageKey is what gets persisted
into the knowledge_items.structured_data.image_ref / mating_end_image_ref
fields when the form is saved.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: parse-pinout AI helper

**Files:**
- Create: `lib/knowledge/parse-pinout.ts`
- Test: `tests/unit/knowledge-parse-pinout.test.ts` (create)

The output structure is locked; the prompt content is the new piece. Prompt rules come straight from the PR 3 design doc.

- [ ] **Step 1: Write the failing parser tests**

Create `tests/unit/knowledge-parse-pinout.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { parsePinout, type AnthropicLike } from '@/lib/knowledge/parse-pinout'

function makeClient(responseText: string): AnthropicLike {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: responseText }],
      }),
    },
  }
}

describe('parsePinout', () => {
  it('returns parsed pinout with multiple pin rows', async () => {
    const client = makeClient(
      JSON.stringify({
        status: 'parsed',
        draft: {
          connector_ref: 'Alternator 4-pin',
          pins: [
            { pin_number: '1', signal_name: '12V SUPPLY', wire_color: 'RED' },
            { pin_number: '3', signal_name: 'LIN BUS', wire_color: 'GRN/WHT', expected_voltage_or_waveform: 'Steady 5V' },
          ],
        },
        sourceSpans: { 'pins[0]': '1  RED  12V SUPPLY' },
      }),
    )
    const result = await parsePinout(
      { rawText: '1  RED  12V SUPPLY\n3  GRN/WHT  LIN BUS  Steady 5V' },
      client,
    )
    expect(result.status).toBe('parsed')
    expect(result.draft.pins).toHaveLength(2)
    expect(result.draft.pins[0]).toMatchObject({ pin_number: '1', wire_color: 'RED' })
    expect(result.draft.connector_ref).toBe('Alternator 4-pin')
  })

  it('returns failed for empty paste without calling the LLM', async () => {
    const create = vi.fn()
    const client: AnthropicLike = { messages: { create } }
    const result = await parsePinout({ rawText: '   ' }, client)
    expect(result.status).toBe('failed')
    expect(create).not.toHaveBeenCalled()
  })

  it('passes connector hint to the LLM when provided', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'parsed',
          draft: { pins: [{ pin_number: '1', signal_name: 'A' }] },
          sourceSpans: {},
        }),
      }],
    })
    const client: AnthropicLike = { messages: { create } }
    await parsePinout(
      { rawText: '1  RED  A', connectorHint: 'BCM C2280' },
      client,
    )
    const call = create.mock.calls[0][0] as { messages: Array<{ content: string }> }
    expect(call.messages[0].content).toContain('BCM C2280')
  })

  it('strips fenced code blocks from the LLM response', async () => {
    const client = makeClient(
      '```json\n' +
        JSON.stringify({
          status: 'parsed',
          draft: { pins: [{ pin_number: '1', signal_name: 'X' }] },
          sourceSpans: {},
        }) +
        '\n```',
    )
    const result = await parsePinout({ rawText: '1 X' }, client)
    expect(result.status).toBe('parsed')
    expect(result.draft.pins[0].pin_number).toBe('1')
  })

  it('throws on malformed JSON', async () => {
    const client = makeClient('not json at all')
    await expect(parsePinout({ rawText: 'something' }, client)).rejects.toThrow()
  })

  it('throws when the LLM returns no pins on a parsed status', async () => {
    const client = makeClient(
      JSON.stringify({ status: 'parsed', draft: { pins: [] }, sourceSpans: {} }),
    )
    await expect(parsePinout({ rawText: 'x' }, client)).rejects.toThrow(/at least one pin/i)
  })

  it('preserves slash-separated tracer colors (GRN/WHT) without splitting', async () => {
    const client = makeClient(
      JSON.stringify({
        status: 'parsed',
        draft: {
          pins: [{ pin_number: '3', signal_name: 'LIN', wire_color: 'GRN/WHT' }],
        },
        sourceSpans: {},
      }),
    )
    const result = await parsePinout({ rawText: '3 GRN/WHT LIN' }, client)
    expect(result.draft.pins[0].wire_color).toBe('GRN/WHT')
  })
})
```

- [ ] **Step 2: Run the test — expect failure (module does not exist)**

Run: `pnpm test tests/unit/knowledge-parse-pinout.test.ts`
Expected: FAIL — `Cannot find module '@/lib/knowledge/parse-pinout'`.

- [ ] **Step 3: Create the parser**

Create `lib/knowledge/parse-pinout.ts`:

```ts
import { anthropic, cachedSystem } from '@/lib/ai/client'

const HAIKU = process.env.ANTHROPIC_HAIKU_MODEL ?? 'claude-haiku-4-5-20251001'

export type ProposedPinRow = {
  pin_number: string
  signal_name: string
  wire_color?: string
  expected_voltage_or_waveform?: string
  notes?: string
}

export type ParsedPinoutResult = {
  status: 'parsed' | 'failed'
  draft: {
    connector_ref?: string
    pins: ProposedPinRow[]
  }
  sourceSpans: Record<string, string>
  llmNotes?: string
}

export type AnthropicLike = {
  messages: {
    create: (args: unknown) => Promise<{
      content: Array<{ type: string; text?: string }>
    }>
  }
}

export const PARSE_PINOUT_SYSTEM = `You convert raw OEM pinout text — pasted by an automotive shop owner — into structured pin rows. Output is a proposal the owner reviews and edits before saving.

OUTPUT FORMAT — return valid JSON matching this TypeScript type:

type Result = {
  status: "parsed" | "failed"
  draft: {
    connector_ref?: string         // a name or OEM ID for the connector (e.g. "BCM C2280", "Alternator 4-pin"); omit if you can't infer it
    pins: Array<{
      pin_number: string           // e.g. "1", "12", "A3", "C1-3" — preserve exactly as in the source
      signal_name: string          // e.g. "12V SUPPLY", "LIN BUS", "GROUND" — preserve OEM terminology
      wire_color?: string          // preserve exactly as pasted (see RULES below)
      expected_voltage_or_waveform?: string   // free text; only fill when the source explicitly states a voltage / waveform / spec
      notes?: string               // anything else the owner should see
    }>
  }
  sourceSpans: { [fieldName: string]: string }   // optional verbatim quotes from the paste
  llmNotes?: string                              // 1-2 sentences if something was ambiguous
}

RULES — these reflect REAL variation in OEM pinout pastes across Mitchell1, AllData, Ford TIS, GM SI, and Identifix:

1. Don't require a header row. Real pastes are often body-only — techs select rows, not the table header. Infer column meaning from content shape: a token starting with a digit or letter-then-digit ("1", "12", "A3", "C1-3") is a pin number.

2. Wire color conventions vary by manufacturer. Preserve color tokens EXACTLY as pasted. Do NOT canonicalize. Examples that are all valid:
   - GM: "BLK", "LT GRN", "DK BLU/WHT", "PNK/BLK" (space-separated "LT"/"DK" modifiers are part of the color, NOT separators)
   - Ford: "YEL", "GRY/BLK", "LT GRN/RED"
   - Toyota: "B" (Black), "W", "R", "G" (Green), "L" (Blue), "R/G" (Red w/ Green tracer)
   - Chrysler: "BK", "BK*" (asterisk = tracer), "BK/RD*"
   - SAE J1128: "BRN", "WHT", "BLU", "GRY"

3. SLASH IS A TRACER SEPARATOR — keep slashes intact. "DK BLU/WHT" is ONE color (dark blue with white tracer), NOT two fields. Never split on slash.

4. GM CIRCUIT-NUMBER COLUMN TRAP. Real GM tables often have 4 columns: Pin | Color | Circuit# | Function. The circuit number is a 3-4 digit integer (e.g. "1867", "451") that is NOT pin data. If a column between color and function contains only 3-4 digit integers with no alphabetic characters, treat it as an OEM circuit reference and DROP it — do NOT stuff it into expected_voltage_or_waveform.

5. Empty cells stay empty. "—", "N/A", "N.C.", or blank — all map to OMITTED optional fields. Never coerce to "0" or "null".

6. Prose-embedded pin descriptions count. "Pin 3 is the 5V reference (LT GRN wire)" → { pin_number: "3", signal_name: "5V reference", wire_color: "LT GRN" }.

7. Non-breaking spaces ( ) in pasted OEM HTML should be treated as regular spaces.

8. Connector ID inline. "C1-3" means Connector 1, Pin 3 — preserve as pin_number "C1-3"; the form has a separate connector_ref field.

STATUS:
- "parsed" if you extracted at least one pin row.
- "failed" if the paste is empty, gibberish, or fundamentally not a pinout (e.g. someone pasted theory text by mistake).

Never invent pins. Do not fabricate wire colors that aren't in the source.

Return JSON only — no prose, no fences.`

export type ParsePinoutInput = {
  rawText: string
  connectorHint?: string
}

export async function parsePinout(
  input: ParsePinoutInput,
  client: AnthropicLike = anthropic as unknown as AnthropicLike,
): Promise<ParsedPinoutResult> {
  const trimmed = input.rawText.trim()
  if (trimmed.length === 0) {
    return { status: 'failed', draft: { pins: [] }, sourceSpans: {} }
  }

  const userContent = input.connectorHint
    ? `Connector hint: ${input.connectorHint}\n\nPaste:\n${trimmed}\n\nReturn JSON only.`
    : `Paste:\n${trimmed}\n\nReturn JSON only.`

  const res = await client.messages.create({
    model: HAIKU,
    max_tokens: 2048,
    system: cachedSystem(PARSE_PINOUT_SYSTEM),
    messages: [{ role: 'user', content: userContent }],
  })

  const block = res.content.find((b) => b.type === 'text')
  if (!block || block.type !== 'text' || !block.text) {
    throw new Error('parse-pinout returned no text block')
  }

  const cleaned = block.text
    .trim()
    .replace(/^```(?:json)?\n?/, '')
    .replace(/\n?```$/, '')

  const parsed = JSON.parse(cleaned) as Partial<ParsedPinoutResult>

  if (parsed.status !== 'parsed' && parsed.status !== 'failed') {
    throw new Error(`parse-pinout returned invalid status: ${String(parsed.status)}`)
  }

  const draft = (parsed.draft ?? { pins: [] }) as ParsedPinoutResult['draft']
  if (!Array.isArray(draft.pins)) {
    throw new Error('parse-pinout draft.pins must be an array')
  }
  if (parsed.status === 'parsed' && draft.pins.length === 0) {
    throw new Error('parse-pinout returned parsed status with at least one pin missing')
  }

  return {
    status: parsed.status,
    draft,
    sourceSpans:
      parsed.sourceSpans && typeof parsed.sourceSpans === 'object'
        ? (parsed.sourceSpans as Record<string, string>)
        : {},
    llmNotes: typeof parsed.llmNotes === 'string' ? parsed.llmNotes : undefined,
  }
}
```

- [ ] **Step 4: Run the parser tests — expect pass**

Run: `pnpm test tests/unit/knowledge-parse-pinout.test.ts`
Expected: PASS (7 cases).

- [ ] **Step 5: TypeScript check**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/knowledge/parse-pinout.ts tests/unit/knowledge-parse-pinout.test.ts
git commit -m "$(cat <<'EOF'
feat(knowledge-rich-forms): parsePinout Haiku helper (PR 3 task 5)

Mirrors lib/knowledge/classify-paste.ts: Haiku model from env, cachedSystem
prompt with ephemeral cache, AnthropicLike type for DI in tests, throw-on-
bad-shape contract.

Prompt encodes 8 explicit rules pulled from a Sonnet research subagent's
survey of real OEM pinout pastes across Mitchell1, AllData, Ford TIS, GM SI,
Identifix — wire-color preservation by manufacturer, slash-as-tracer (don't
split), GM circuit-number column trap, prose-embedded pin descriptions, and
non-breaking-space handling.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: parse-pinout API route

**Files:**
- Create: `app/api/knowledge/parse-pinout/route.ts`
- Test: `tests/unit/knowledge-parse-pinout-route.test.ts` (create)

- [ ] **Step 1: Write the failing route test**

Create `tests/unit/knowledge-parse-pinout-route.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/db'
import { profiles, shops } from '@/lib/db/schema'

let currentDb: TestDb
vi.mock('@/lib/db/client', () => ({
  db: new Proxy({} as TestDb, {
    get: (_t, prop) => {
      const value = (currentDb as unknown as Record<PropertyKey, unknown>)[prop as PropertyKey]
      return typeof value === 'function' ? value.bind(currentDb) : value
    },
  }),
}))
vi.mock('@/lib/supabase-server', () => ({
  getServerSupabase: vi.fn(),
}))

vi.mock('@/lib/knowledge/parse-pinout', async () => {
  const actual = await vi.importActual<typeof import('@/lib/knowledge/parse-pinout')>(
    '@/lib/knowledge/parse-pinout',
  )
  return {
    ...actual,
    parsePinout: vi.fn(async ({ rawText }: { rawText: string }) => {
      if (!rawText.trim()) {
        return { status: 'failed' as const, draft: { pins: [] }, sourceSpans: {} }
      }
      return {
        status: 'parsed' as const,
        draft: {
          connector_ref: 'Mock connector',
          pins: [{ pin_number: '1', signal_name: 'MOCK SIGNAL', wire_color: 'BLK' }],
        },
        sourceSpans: {},
      }
    }),
  }
})

async function mockUser(userId: string | null) {
  const { getServerSupabase } = await import('@/lib/supabase-server')
  vi.mocked(getServerSupabase).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId, email: 'x@y.test' } : null },
      }),
    },
  } as unknown as Awaited<ReturnType<typeof getServerSupabase>>)
}

const OWNER = '00000000-0000-0000-0000-000000000001'
const TECH = '00000000-0000-0000-0000-000000000002'

describe('POST /api/knowledge/parse-pinout', () => {
  let close: () => Promise<void>

  beforeEach(async () => {
    const created = await createTestDb()
    currentDb = created.db
    close = created.close
    const [shop] = await currentDb.insert(shops).values({ name: 'Shop' }).returning()
    await currentDb.insert(profiles).values({ userId: OWNER, role: 'owner', shopId: shop.id, fullName: 'O' })
    await currentDb.insert(profiles).values({ userId: TECH, role: 'tech', shopId: shop.id, fullName: 'T' })
  })

  afterEach(async () => {
    await close()
    vi.clearAllMocks()
  })

  it('returns 401 unauthed', async () => {
    await mockUser(null)
    const { POST } = await import('@/app/api/knowledge/parse-pinout/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/parse-pinout', {
        method: 'POST',
        body: JSON.stringify({ rawText: '1 BLK GROUND' }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it('returns 403 for a tech-role user', async () => {
    await mockUser(TECH)
    const { POST } = await import('@/app/api/knowledge/parse-pinout/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/parse-pinout', {
        method: 'POST',
        body: JSON.stringify({ rawText: '1 BLK GROUND' }),
      }),
    )
    expect(res.status).toBe(403)
  })

  it('returns 422 when rawText is missing', async () => {
    await mockUser(OWNER)
    const { POST } = await import('@/app/api/knowledge/parse-pinout/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/parse-pinout', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    )
    expect(res.status).toBe(422)
  })

  it('returns 200 with the parser result on success', async () => {
    await mockUser(OWNER)
    const { POST } = await import('@/app/api/knowledge/parse-pinout/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/parse-pinout', {
        method: 'POST',
        body: JSON.stringify({ rawText: '1  BLK  GROUND\n2  RED  12V', connectorHint: 'X' }),
      }),
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as { status: string; draft: { pins: unknown[] } }
    expect(json.status).toBe('parsed')
    expect(json.draft.pins).toHaveLength(1)
  })

  it('returns 502 when the parser throws', async () => {
    const { parsePinout } = await import('@/lib/knowledge/parse-pinout')
    vi.mocked(parsePinout).mockRejectedValueOnce(new Error('haiku unreachable'))

    await mockUser(OWNER)
    const { POST } = await import('@/app/api/knowledge/parse-pinout/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/parse-pinout', {
        method: 'POST',
        body: JSON.stringify({ rawText: '1 BLK GROUND' }),
      }),
    )
    expect(res.status).toBe(502)
    const json = (await res.json()) as { error: string }
    expect(json.error).toBe('parser_failed')
  })
})
```

- [ ] **Step 2: Run the test — expect failure (route does not exist)**

Run: `pnpm test tests/unit/knowledge-parse-pinout-route.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/knowledge/parse-pinout/route'`.

- [ ] **Step 3: Create the route**

Create `app/api/knowledge/parse-pinout/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCurator } from '@/lib/curator/route-helpers'
import { parsePinout } from '@/lib/knowledge/parse-pinout'

const InputSchema = z.object({
  rawText: z.string().min(1).max(40_000),
  connectorHint: z.string().max(200).optional(),
})

export const maxDuration = 30

export async function POST(req: Request) {
  const auth = await requireCurator()
  if (auth.kind === 'forbidden') return auth.response

  let json: unknown
  try {
    json = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const parsedInput = InputSchema.safeParse(json)
  if (!parsedInput.success) {
    return NextResponse.json(
      { error: 'invalid_input', issues: parsedInput.error.issues },
      { status: 422 },
    )
  }

  try {
    const result = await parsePinout(parsedInput.data)
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      { error: 'parser_failed', message: err instanceof Error ? err.message : 'unknown' },
      { status: 502 },
    )
  }
}
```

- [ ] **Step 4: Run the test — expect pass**

Run: `pnpm test tests/unit/knowledge-parse-pinout-route.test.ts`
Expected: PASS (5 cases).

- [ ] **Step 5: TypeScript check**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add app/api/knowledge/parse-pinout/route.ts tests/unit/knowledge-parse-pinout-route.test.ts
git commit -m "$(cat <<'EOF'
feat(knowledge-rich-forms): POST /api/knowledge/parse-pinout (PR 3 task 6)

Owner-only thin wrapper over parsePinout(). Validates rawText / connectorHint
shape, returns parser proposal on 200, 502 with explicit error on throw so
the UI can fall back to manual form fill without ambiguity.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: parse-theory AI helper

**Files:**
- Create: `lib/knowledge/parse-theory.ts`
- Test: `tests/unit/knowledge-parse-theory.test.ts` (create)

Same shape as parse-pinout. Different prompt body and output schema.

- [ ] **Step 1: Write the failing parser tests**

Create `tests/unit/knowledge-parse-theory.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { parseTheory, type AnthropicLike } from '@/lib/knowledge/parse-theory'

function makeClient(responseText: string): AnthropicLike {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: responseText }],
      }),
    },
  }
}

describe('parseTheory', () => {
  it('returns parsed theory with section splits', async () => {
    const client = makeClient(
      JSON.stringify({
        status: 'parsed',
        draft: {
          title: '6.7L Powerstroke Charging System',
          sections: [
            { heading: 'Overview', body: 'The 6.7L uses a smart alternator.' },
            { heading: 'LIN bus control', body: 'BCM commands the field via LIN.' },
          ],
        },
        sourceSpans: {},
      }),
    )
    const result = await parseTheory(
      { rawText: 'SYSTEM DESCRIPTION\nThe 6.7L uses a smart alternator.\n\nLIN BUS\nBCM commands the field via LIN.' },
      client,
    )
    expect(result.status).toBe('parsed')
    expect(result.draft.sections).toHaveLength(2)
    expect(result.draft.sections[0]).toMatchObject({ heading: 'Overview' })
  })

  it('returns failed for empty paste without calling the LLM', async () => {
    const create = vi.fn()
    const client: AnthropicLike = { messages: { create } }
    const result = await parseTheory({ rawText: '   ' }, client)
    expect(result.status).toBe('failed')
    expect(create).not.toHaveBeenCalled()
  })

  it('passes title hint to the LLM when provided', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'parsed',
          draft: { sections: [{ heading: 'h', body: 'b' }] },
          sourceSpans: {},
        }),
      }],
    })
    const client: AnthropicLike = { messages: { create } }
    await parseTheory({ rawText: 'X', titleHint: 'Charging System' }, client)
    const call = create.mock.calls[0][0] as { messages: Array<{ content: string }> }
    expect(call.messages[0].content).toContain('Charging System')
  })

  it('returns single-section result when no headings are present', async () => {
    const client = makeClient(
      JSON.stringify({
        status: 'parsed',
        draft: {
          sections: [{ heading: 'Description', body: 'One paragraph of prose with no section headings.' }],
        },
        sourceSpans: {},
      }),
    )
    const result = await parseTheory(
      { rawText: 'One paragraph of prose with no section headings.' },
      client,
    )
    expect(result.draft.sections).toHaveLength(1)
    expect(result.draft.sections[0].heading).toBe('Description')
  })

  it('throws when parsed status returns empty sections', async () => {
    const client = makeClient(
      JSON.stringify({ status: 'parsed', draft: { sections: [] }, sourceSpans: {} }),
    )
    await expect(parseTheory({ rawText: 'x' }, client)).rejects.toThrow(/at least one section/i)
  })

  it('throws on malformed JSON', async () => {
    const client = makeClient('not json')
    await expect(parseTheory({ rawText: 'x' }, client)).rejects.toThrow()
  })

  it('strips fenced code blocks from the LLM response', async () => {
    const client = makeClient(
      '```\n' +
        JSON.stringify({
          status: 'parsed',
          draft: { sections: [{ heading: 'A', body: 'B' }] },
          sourceSpans: {},
        }) +
        '\n```',
    )
    const result = await parseTheory({ rawText: 'X' }, client)
    expect(result.draft.sections[0].heading).toBe('A')
  })
})
```

- [ ] **Step 2: Run the test — expect failure**

Run: `pnpm test tests/unit/knowledge-parse-theory.test.ts`
Expected: FAIL — `Cannot find module '@/lib/knowledge/parse-theory'`.

- [ ] **Step 3: Create the parser**

Create `lib/knowledge/parse-theory.ts`:

```ts
import { anthropic, cachedSystem } from '@/lib/ai/client'

const HAIKU = process.env.ANTHROPIC_HAIKU_MODEL ?? 'claude-haiku-4-5-20251001'

export type ProposedTheorySection = {
  heading: string
  body: string
}

export type ParsedTheoryResult = {
  status: 'parsed' | 'failed'
  draft: {
    title?: string
    sections: ProposedTheorySection[]
  }
  sourceSpans: Record<string, string>
  llmNotes?: string
}

export type AnthropicLike = {
  messages: {
    create: (args: unknown) => Promise<{
      content: Array<{ type: string; text?: string }>
    }>
  }
}

export const PARSE_THEORY_SYSTEM = `You split raw OEM "theory of operation" or "description and operation" text — pasted by an automotive shop owner — into structured sections. Output is a proposal the owner reviews and edits before saving.

OUTPUT FORMAT — return valid JSON matching this TypeScript type:

type Result = {
  status: "parsed" | "failed"
  draft: {
    title?: string                 // a 1-line title for the whole document; omit if the paste doesn't suggest one
    sections: Array<{
      heading: string              // 1-line section title
      body: string                 // section body — plain text, paragraphs preserved with \\n\\n
    }>
  }
  sourceSpans: { [fieldName: string]: string }   // optional verbatim quotes from the paste
  llmNotes?: string                              // 1-2 sentences if something was ambiguous
}

RULES — these reflect REAL structure of OEM theory pastes (GM SI, Ford TIS, AllData, ProDemand, Toyota TIS):

1. Split on blank-line-preceded ALL-CAPS or Title Case lines. These are the section headings. Examples seen in real OEM theory text:
   - SYSTEM DESCRIPTION
   - COMPONENTS
   - SYSTEM OPERATION
   - MODES OF OPERATION
   - Description and Operation
   - System Description
   Accept ANY heading shape — don't require specific names.

2. Prose is the norm; bullets are the exception. OEM theory sections are 2-4 paragraph prose blocks per section, not bullet lists. Preserve paragraph structure within each section's body using \\n\\n between paragraphs.

3. Acronym spellings on first use are part of the body. "Engine Control Module (ECM)" — keep the spelled form in the body text, don't trim.

4. No markdown in raw paste. Bold/italic are lost in plain-text paste. The output body is plain text. Do NOT inject markdown syntax that wasn't in the source.

5. If no clear section structure exists, return ONE section with heading "Description" and the entire body. The owner can split manually in the form.

6. Non-breaking spaces ( ) in pasted OEM HTML should be treated as regular spaces.

7. Never invent content. Do not summarize. Preserve the original text verbatim within each section's body.

STATUS:
- "parsed" if you extracted at least one section with a non-empty body.
- "failed" if the paste is empty, gibberish, or fundamentally not theory text (e.g. a pinout was pasted by mistake).

Return JSON only — no prose, no fences.`

export type ParseTheoryInput = {
  rawText: string
  titleHint?: string
}

export async function parseTheory(
  input: ParseTheoryInput,
  client: AnthropicLike = anthropic as unknown as AnthropicLike,
): Promise<ParsedTheoryResult> {
  const trimmed = input.rawText.trim()
  if (trimmed.length === 0) {
    return { status: 'failed', draft: { sections: [] }, sourceSpans: {} }
  }

  const userContent = input.titleHint
    ? `Title hint: ${input.titleHint}\n\nPaste:\n${trimmed}\n\nReturn JSON only.`
    : `Paste:\n${trimmed}\n\nReturn JSON only.`

  const res = await client.messages.create({
    model: HAIKU,
    max_tokens: 4096,
    system: cachedSystem(PARSE_THEORY_SYSTEM),
    messages: [{ role: 'user', content: userContent }],
  })

  const block = res.content.find((b) => b.type === 'text')
  if (!block || block.type !== 'text' || !block.text) {
    throw new Error('parse-theory returned no text block')
  }

  const cleaned = block.text
    .trim()
    .replace(/^```(?:json)?\n?/, '')
    .replace(/\n?```$/, '')

  const parsed = JSON.parse(cleaned) as Partial<ParsedTheoryResult>

  if (parsed.status !== 'parsed' && parsed.status !== 'failed') {
    throw new Error(`parse-theory returned invalid status: ${String(parsed.status)}`)
  }

  const draft = (parsed.draft ?? { sections: [] }) as ParsedTheoryResult['draft']
  if (!Array.isArray(draft.sections)) {
    throw new Error('parse-theory draft.sections must be an array')
  }
  if (parsed.status === 'parsed' && draft.sections.length === 0) {
    throw new Error('parse-theory returned parsed status with at least one section missing')
  }

  return {
    status: parsed.status,
    draft,
    sourceSpans:
      parsed.sourceSpans && typeof parsed.sourceSpans === 'object'
        ? (parsed.sourceSpans as Record<string, string>)
        : {},
    llmNotes: typeof parsed.llmNotes === 'string' ? parsed.llmNotes : undefined,
  }
}
```

- [ ] **Step 4: Run the parser tests — expect pass**

Run: `pnpm test tests/unit/knowledge-parse-theory.test.ts`
Expected: PASS (7 cases).

- [ ] **Step 5: Commit**

```bash
git add lib/knowledge/parse-theory.ts tests/unit/knowledge-parse-theory.test.ts
git commit -m "$(cat <<'EOF'
feat(knowledge-rich-forms): parseTheory Haiku helper (PR 3 task 7)

Same architectural shape as parsePinout / classify-paste: Haiku model from
env, cachedSystem prompt, AnthropicLike DI, throw-on-bad-shape.

Prompt encodes 7 rules from the research subagent's survey of real OEM
theory text — split on blank-line-preceded heading lines, prose-not-bullets
default, preserve verbatim, never summarize, single-section fallback when
no heading structure is detectable. max_tokens raised to 4096 because
theory pastes can be multi-page.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: parse-theory API route

**Files:**
- Create: `app/api/knowledge/parse-theory/route.ts`
- Test: `tests/unit/knowledge-parse-theory-route.test.ts` (create)

- [ ] **Step 1: Write the failing route test**

Create `tests/unit/knowledge-parse-theory-route.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/db'
import { profiles, shops } from '@/lib/db/schema'

let currentDb: TestDb
vi.mock('@/lib/db/client', () => ({
  db: new Proxy({} as TestDb, {
    get: (_t, prop) => {
      const value = (currentDb as unknown as Record<PropertyKey, unknown>)[prop as PropertyKey]
      return typeof value === 'function' ? value.bind(currentDb) : value
    },
  }),
}))
vi.mock('@/lib/supabase-server', () => ({
  getServerSupabase: vi.fn(),
}))

vi.mock('@/lib/knowledge/parse-theory', async () => {
  const actual = await vi.importActual<typeof import('@/lib/knowledge/parse-theory')>(
    '@/lib/knowledge/parse-theory',
  )
  return {
    ...actual,
    parseTheory: vi.fn(async ({ rawText }: { rawText: string }) => {
      if (!rawText.trim()) {
        return { status: 'failed' as const, draft: { sections: [] }, sourceSpans: {} }
      }
      return {
        status: 'parsed' as const,
        draft: { sections: [{ heading: 'Description', body: rawText.trim() }] },
        sourceSpans: {},
      }
    }),
  }
})

async function mockUser(userId: string | null) {
  const { getServerSupabase } = await import('@/lib/supabase-server')
  vi.mocked(getServerSupabase).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId, email: 'x@y.test' } : null },
      }),
    },
  } as unknown as Awaited<ReturnType<typeof getServerSupabase>>)
}

const OWNER = '00000000-0000-0000-0000-000000000001'
const TECH = '00000000-0000-0000-0000-000000000002'

describe('POST /api/knowledge/parse-theory', () => {
  let close: () => Promise<void>

  beforeEach(async () => {
    const created = await createTestDb()
    currentDb = created.db
    close = created.close
    const [shop] = await currentDb.insert(shops).values({ name: 'Shop' }).returning()
    await currentDb.insert(profiles).values({ userId: OWNER, role: 'owner', shopId: shop.id, fullName: 'O' })
    await currentDb.insert(profiles).values({ userId: TECH, role: 'tech', shopId: shop.id, fullName: 'T' })
  })

  afterEach(async () => {
    await close()
    vi.clearAllMocks()
  })

  it('returns 401 unauthed', async () => {
    await mockUser(null)
    const { POST } = await import('@/app/api/knowledge/parse-theory/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/parse-theory', {
        method: 'POST',
        body: JSON.stringify({ rawText: 'X' }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it('returns 403 for a tech-role user', async () => {
    await mockUser(TECH)
    const { POST } = await import('@/app/api/knowledge/parse-theory/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/parse-theory', {
        method: 'POST',
        body: JSON.stringify({ rawText: 'X' }),
      }),
    )
    expect(res.status).toBe(403)
  })

  it('returns 422 when rawText is missing', async () => {
    await mockUser(OWNER)
    const { POST } = await import('@/app/api/knowledge/parse-theory/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/parse-theory', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    )
    expect(res.status).toBe(422)
  })

  it('returns 200 with parser result on success', async () => {
    await mockUser(OWNER)
    const { POST } = await import('@/app/api/knowledge/parse-theory/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/parse-theory', {
        method: 'POST',
        body: JSON.stringify({ rawText: 'Some theory text about the charging system', titleHint: 'Charging' }),
      }),
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as { status: string; draft: { sections: unknown[] } }
    expect(json.status).toBe('parsed')
    expect(json.draft.sections).toHaveLength(1)
  })

  it('returns 502 when parser throws', async () => {
    const { parseTheory } = await import('@/lib/knowledge/parse-theory')
    vi.mocked(parseTheory).mockRejectedValueOnce(new Error('haiku down'))

    await mockUser(OWNER)
    const { POST } = await import('@/app/api/knowledge/parse-theory/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/parse-theory', {
        method: 'POST',
        body: JSON.stringify({ rawText: 'X' }),
      }),
    )
    expect(res.status).toBe(502)
  })
})
```

- [ ] **Step 2: Run the test — expect failure**

Run: `pnpm test tests/unit/knowledge-parse-theory-route.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/knowledge/parse-theory/route'`.

- [ ] **Step 3: Create the route**

Create `app/api/knowledge/parse-theory/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCurator } from '@/lib/curator/route-helpers'
import { parseTheory } from '@/lib/knowledge/parse-theory'

const InputSchema = z.object({
  rawText: z.string().min(1).max(80_000),
  titleHint: z.string().max(200).optional(),
})

export const maxDuration = 30

export async function POST(req: Request) {
  const auth = await requireCurator()
  if (auth.kind === 'forbidden') return auth.response

  let json: unknown
  try {
    json = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const parsedInput = InputSchema.safeParse(json)
  if (!parsedInput.success) {
    return NextResponse.json(
      { error: 'invalid_input', issues: parsedInput.error.issues },
      { status: 422 },
    )
  }

  try {
    const result = await parseTheory(parsedInput.data)
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      { error: 'parser_failed', message: err instanceof Error ? err.message : 'unknown' },
      { status: 502 },
    )
  }
}
```

- [ ] **Step 4: Run the test — expect pass**

Run: `pnpm test tests/unit/knowledge-parse-theory-route.test.ts`
Expected: PASS (5 cases).

- [ ] **Step 5: Commit**

```bash
git add app/api/knowledge/parse-theory/route.ts tests/unit/knowledge-parse-theory-route.test.ts
git commit -m "$(cat <<'EOF'
feat(knowledge-rich-forms): POST /api/knowledge/parse-theory (PR 3 task 8)

Same shape as parse-pinout route. Owner-only, validates rawText (up to 80K
chars — theory pastes can be multi-page), 502 on parser throw so UI can
fall back to manual fill.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Placeholder rich-form UI

**Files:**
- Create: `app/(app)/knowledge/rich-form.tsx`
- Modify: `app/(app)/knowledge/page.tsx`

Functional placeholder — type picker → per-type form → save. AI-assist textareas + image upload controls wired up so the data path is end-to-end exercisable on Vercel preview. Pretty UI is PR 5's job (Claude Design).

No new test file — the UI is too thin to warrant unit tests beyond what the API tests already cover. The acceptance gate is "end-to-end create on Vercel preview from iPhone."

- [ ] **Step 1: Create the rich-form component**

Create `app/(app)/knowledge/rich-form.tsx`:

```tsx
'use client'
import { useState } from 'react'

type RichType = 'pinout' | 'connector' | 'wiring_diagram' | 'theory_of_operation'

type PinRow = {
  pin_number: string
  signal_name: string
  wire_color?: string
  expected_voltage_or_waveform?: string
  notes?: string
}

type TheorySection = { heading: string; body: string }

type WiringConnection = {
  from_component: string
  from_pin?: string
  to_component: string
  to_pin?: string
  wire_color?: string
  splice_id?: string
  notes?: string
}

const fieldRow: React.CSSProperties = { display: 'block', marginBottom: 12, fontSize: 14 }
const labelStyle: React.CSSProperties = { display: 'block', color: '#444', marginBottom: 4 }
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: 8,
  border: '1px solid #ccc',
  borderRadius: 4,
  fontSize: 14,
  boxSizing: 'border-box',
}
const buttonStyle: React.CSSProperties = {
  padding: '8px 16px',
  border: '1px solid #0070f3',
  background: '#0070f3',
  color: 'white',
  borderRadius: 4,
  fontSize: 14,
  cursor: 'pointer',
}
const saveButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  border: '1px solid #16a34a',
  background: '#16a34a',
}

export function RichKnowledgeForm() {
  const [type, setType] = useState<RichType>('pinout')
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)

  // Pinout state
  const [pinoutConnectorRef, setPinoutConnectorRef] = useState('')
  const [pinoutPasteText, setPinoutPasteText] = useState('')
  const [pinoutPins, setPinoutPins] = useState<PinRow[]>([{ pin_number: '', signal_name: '' }])

  // Connector state
  const [connectorId, setConnectorId] = useState('')
  const [connectorComponentName, setConnectorComponentName] = useState('')
  const [connectorLocation, setConnectorLocation] = useState('')
  const [connectorImageKey, setConnectorImageKey] = useState('')
  const [connectorMatingImageKey, setConnectorMatingImageKey] = useState('')

  // Wiring diagram state
  const [wiringName, setWiringName] = useState('')
  const [wiringImageKey, setWiringImageKey] = useState('')
  const [wiringConnections, setWiringConnections] = useState<WiringConnection[]>([])

  // Theory state
  const [theoryTitle, setTheoryTitle] = useState('')
  const [theoryPasteText, setTheoryPasteText] = useState('')
  const [theorySections, setTheorySections] = useState<TheorySection[]>([{ heading: '', body: '' }])

  async function handleParsePinout() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/knowledge/parse-pinout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rawText: pinoutPasteText,
          connectorHint: pinoutConnectorRef || undefined,
        }),
      })
      if (!res.ok) {
        const j = (await res.json()) as { error?: string; message?: string }
        throw new Error(j.message || j.error || `HTTP ${res.status}`)
      }
      const { draft } = (await res.json()) as {
        draft: { connector_ref?: string; pins: PinRow[] }
      }
      if (draft.connector_ref && !pinoutConnectorRef) setPinoutConnectorRef(draft.connector_ref)
      if (draft.pins?.length) setPinoutPins(draft.pins)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI assist failed — fill the table manually.')
    } finally {
      setLoading(false)
    }
  }

  async function handleParseTheory() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/knowledge/parse-theory', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rawText: theoryPasteText,
          titleHint: theoryTitle || title || undefined,
        }),
      })
      if (!res.ok) {
        const j = (await res.json()) as { error?: string; message?: string }
        throw new Error(j.message || j.error || `HTTP ${res.status}`)
      }
      const { draft } = (await res.json()) as {
        draft: { title?: string; sections: TheorySection[] }
      }
      if (draft.title && !theoryTitle) setTheoryTitle(draft.title)
      if (draft.sections?.length) setTheorySections(draft.sections)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI assist failed — fill the sections manually.')
    } finally {
      setLoading(false)
    }
  }

  async function handleImageUpload(
    e: React.ChangeEvent<HTMLInputElement>,
    setKey: (s: string) => void,
    knowledgeType: 'connector' | 'wiring_diagram',
  ) {
    const file = e.target.files?.[0]
    if (!file) return
    setLoading(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('knowledgeType', knowledgeType)
      form.append('file', file)
      const res = await fetch('/api/knowledge/upload-image', { method: 'POST', body: form })
      if (!res.ok) {
        const j = (await res.json()) as { error?: string; message?: string; reason?: string }
        throw new Error(j.message || j.reason || j.error || `HTTP ${res.status}`)
      }
      const { storageKey } = (await res.json()) as { storageKey: string }
      setKey(storageKey)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'upload failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    setLoading(true)
    setError(null)
    setSavedId(null)
    try {
      let structuredData: Record<string, unknown>
      if (type === 'pinout') {
        structuredData = {
          connector_ref: pinoutConnectorRef,
          pins: pinoutPins.filter((p) => p.pin_number.trim() && p.signal_name.trim()),
        }
      } else if (type === 'connector') {
        structuredData = {
          connector_id: connectorId,
          component_name: connectorComponentName,
          ...(connectorLocation ? { location_description: connectorLocation } : {}),
          ...(connectorImageKey ? { image_ref: connectorImageKey } : {}),
          ...(connectorMatingImageKey ? { mating_end_image_ref: connectorMatingImageKey } : {}),
        }
      } else if (type === 'wiring_diagram') {
        structuredData = {
          name: wiringName,
          image_ref: wiringImageKey,
          ...(wiringConnections.length > 0 ? { connections: wiringConnections } : {}),
        }
      } else {
        structuredData = {
          title: theoryTitle || title,
          sections: theorySections.filter((s) => s.heading.trim() && s.body.trim()),
        }
      }

      const res = await fetch('/api/knowledge/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type, title, structuredData }),
      })
      if (!res.ok) {
        const j = (await res.json()) as { error?: string; message?: string; issues?: unknown[] }
        throw new Error(j.message || JSON.stringify(j.issues ?? j.error) || `HTTP ${res.status}`)
      }
      const { id } = (await res.json()) as { id: string }
      setSavedId(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ marginTop: 32, padding: 16, border: '1px solid #eee', borderRadius: 8 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Rich knowledge type (preview)</h2>

      <label style={fieldRow}>
        <span style={labelStyle}>Type</span>
        <select value={type} onChange={(e) => setType(e.target.value as RichType)} style={inputStyle}>
          <option value="pinout">pinout</option>
          <option value="connector">connector</option>
          <option value="wiring_diagram">wiring_diagram</option>
          <option value="theory_of_operation">theory_of_operation</option>
        </select>
      </label>

      <label style={fieldRow}>
        <span style={labelStyle}>Title</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={inputStyle}
          placeholder="e.g. Alternator 4-pin pinout — 6.7L Powerstroke"
        />
      </label>

      {type === 'pinout' && (
        <>
          <label style={fieldRow}>
            <span style={labelStyle}>Connector reference</span>
            <input
              type="text"
              value={pinoutConnectorRef}
              onChange={(e) => setPinoutConnectorRef(e.target.value)}
              style={inputStyle}
              placeholder="e.g. C2280, Alternator 4-pin"
            />
          </label>
          <label style={fieldRow}>
            <span style={labelStyle}>Paste OEM pinout text (AI assist)</span>
            <textarea
              value={pinoutPasteText}
              onChange={(e) => setPinoutPasteText(e.target.value)}
              rows={5}
              style={{ ...inputStyle, resize: 'vertical' }}
              placeholder={'1  RED  12V SUPPLY\n2  BLK  GROUND\n3  GRN/WHT  LIN BUS\n4  YEL  IGNITION ENABLE'}
            />
          </label>
          <button
            type="button"
            onClick={handleParsePinout}
            disabled={loading || pinoutPasteText.trim().length === 0}
            style={buttonStyle}
          >
            {loading ? 'Parsing…' : 'Parse with AI'}
          </button>

          <h3 style={{ fontSize: 14, fontWeight: 600, margin: '16px 0 8px' }}>Pins</h3>
          {pinoutPins.map((pin, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
              <input
                type="text"
                value={pin.pin_number}
                onChange={(e) => {
                  const next = [...pinoutPins]
                  next[i] = { ...next[i], pin_number: e.target.value }
                  setPinoutPins(next)
                }}
                placeholder="Pin #"
                style={{ ...inputStyle, width: 80, flex: '0 0 80px' }}
              />
              <input
                type="text"
                value={pin.signal_name}
                onChange={(e) => {
                  const next = [...pinoutPins]
                  next[i] = { ...next[i], signal_name: e.target.value }
                  setPinoutPins(next)
                }}
                placeholder="Signal"
                style={{ ...inputStyle, flex: '1 1 140px', minWidth: 0 }}
              />
              <input
                type="text"
                value={pin.wire_color ?? ''}
                onChange={(e) => {
                  const next = [...pinoutPins]
                  next[i] = { ...next[i], wire_color: e.target.value || undefined }
                  setPinoutPins(next)
                }}
                placeholder="Color"
                style={{ ...inputStyle, width: 100, flex: '0 0 100px' }}
              />
            </div>
          ))}
          <button
            type="button"
            onClick={() => setPinoutPins([...pinoutPins, { pin_number: '', signal_name: '' }])}
            style={{ ...buttonStyle, background: '#666', border: '1px solid #666', marginTop: 8 }}
          >
            Add pin row
          </button>
        </>
      )}

      {type === 'connector' && (
        <>
          <label style={fieldRow}>
            <span style={labelStyle}>Connector OEM ID</span>
            <input type="text" value={connectorId} onChange={(e) => setConnectorId(e.target.value)} style={inputStyle} placeholder="e.g. C2280" />
          </label>
          <label style={fieldRow}>
            <span style={labelStyle}>Component name</span>
            <input
              type="text"
              value={connectorComponentName}
              onChange={(e) => setConnectorComponentName(e.target.value)}
              style={inputStyle}
              placeholder="e.g. Body Control Module"
            />
          </label>
          <label style={fieldRow}>
            <span style={labelStyle}>Location description</span>
            <textarea
              value={connectorLocation}
              onChange={(e) => setConnectorLocation(e.target.value)}
              rows={2}
              style={{ ...inputStyle, resize: 'vertical' }}
              placeholder="e.g. Behind driver kick panel"
            />
          </label>
          <label style={fieldRow}>
            <span style={labelStyle}>Connector image (JPG/PNG/SVG, max 10MB)</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/svg+xml"
              onChange={(e) => handleImageUpload(e, setConnectorImageKey, 'connector')}
              style={inputStyle}
            />
            {connectorImageKey && (
              <small style={{ display: 'block', marginTop: 4, color: '#16a34a' }}>
                Uploaded: {connectorImageKey}
              </small>
            )}
          </label>
          <label style={fieldRow}>
            <span style={labelStyle}>Mating end image (optional)</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/svg+xml"
              onChange={(e) => handleImageUpload(e, setConnectorMatingImageKey, 'connector')}
              style={inputStyle}
            />
            {connectorMatingImageKey && (
              <small style={{ display: 'block', marginTop: 4, color: '#16a34a' }}>
                Uploaded: {connectorMatingImageKey}
              </small>
            )}
          </label>
        </>
      )}

      {type === 'wiring_diagram' && (
        <>
          <label style={fieldRow}>
            <span style={labelStyle}>Diagram name</span>
            <input
              type="text"
              value={wiringName}
              onChange={(e) => setWiringName(e.target.value)}
              style={inputStyle}
              placeholder="e.g. BCM to Alternator charging circuit"
            />
          </label>
          <label style={fieldRow}>
            <span style={labelStyle}>Diagram image (JPG/PNG/SVG, max 10MB) — required</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/svg+xml"
              onChange={(e) => handleImageUpload(e, setWiringImageKey, 'wiring_diagram')}
              style={inputStyle}
            />
            {wiringImageKey && (
              <small style={{ display: 'block', marginTop: 4, color: '#16a34a' }}>
                Uploaded: {wiringImageKey}
              </small>
            )}
          </label>
          <p style={{ fontSize: 12, color: '#666' }}>
            Structured connections list is optional in v1 — image-only diagrams are valid.
          </p>
        </>
      )}

      {type === 'theory_of_operation' && (
        <>
          <label style={fieldRow}>
            <span style={labelStyle}>Document title</span>
            <input
              type="text"
              value={theoryTitle}
              onChange={(e) => setTheoryTitle(e.target.value)}
              style={inputStyle}
              placeholder="e.g. 6.7L Powerstroke Charging System"
            />
          </label>
          <label style={fieldRow}>
            <span style={labelStyle}>Paste OEM theory text (AI assist)</span>
            <textarea
              value={theoryPasteText}
              onChange={(e) => setTheoryPasteText(e.target.value)}
              rows={8}
              style={{ ...inputStyle, resize: 'vertical' }}
              placeholder="SYSTEM DESCRIPTION&#10;The 6.7L uses a smart alternator controlled via LIN bus..."
            />
          </label>
          <button
            type="button"
            onClick={handleParseTheory}
            disabled={loading || theoryPasteText.trim().length === 0}
            style={buttonStyle}
          >
            {loading ? 'Parsing…' : 'Parse with AI'}
          </button>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: '16px 0 8px' }}>Sections</h3>
          {theorySections.map((sec, i) => (
            <div key={i} style={{ marginBottom: 12 }}>
              <input
                type="text"
                value={sec.heading}
                onChange={(e) => {
                  const next = [...theorySections]
                  next[i] = { ...next[i], heading: e.target.value }
                  setTheorySections(next)
                }}
                placeholder="Section heading"
                style={inputStyle}
              />
              <textarea
                value={sec.body}
                onChange={(e) => {
                  const next = [...theorySections]
                  next[i] = { ...next[i], body: e.target.value }
                  setTheorySections(next)
                }}
                rows={4}
                style={{ ...inputStyle, resize: 'vertical', marginTop: 4 }}
                placeholder="Section body"
              />
            </div>
          ))}
          <button
            type="button"
            onClick={() => setTheorySections([...theorySections, { heading: '', body: '' }])}
            style={{ ...buttonStyle, background: '#666', border: '1px solid #666' }}
          >
            Add section
          </button>
        </>
      )}

      <div style={{ marginTop: 16 }}>
        <button
          type="button"
          onClick={handleSave}
          disabled={loading || title.trim().length === 0}
          style={saveButtonStyle}
        >
          {loading ? 'Saving…' : 'Save'}
        </button>
      </div>

      {savedId && (
        <p style={{ marginTop: 12, color: '#16a34a', fontSize: 14 }}>Saved (id: {savedId})</p>
      )}
      {error && (
        <p style={{ marginTop: 12, color: '#b00020', fontSize: 14 }}>Error: {error}</p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Mount the form on the knowledge page**

Modify `app/(app)/knowledge/page.tsx`. Replace its current return block with:

```tsx
  return (
    <main style={{ maxWidth: 720, margin: '24px auto', padding: '0 16px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>Knowledge (preview)</h1>
      <p style={{ color: '#666', marginBottom: 24, fontSize: 14 }}>
        Placeholder for PR 5. Paste reference text for simple types (cause/fix,
        bulletin, reference, note); use the rich-type form below for pinouts,
        connectors, wiring diagrams, and theory of operation.
      </p>
      <KnowledgePasteForm />
      <RichKnowledgeForm />
    </main>
  )
```

…and update the imports at the top of the file:

```ts
import { KnowledgePasteForm } from './paste-form'
import { RichKnowledgeForm } from './rich-form'
```

- [ ] **Step 3: Run full test suite to confirm nothing regressed**

Run: `pnpm test`
Expected: all tests pass.

- [ ] **Step 4: TypeScript check**

Run: `pnpm exec tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Build check**

Run: `pnpm build`
Expected: build succeeds; new routes appear in the route manifest.

- [ ] **Step 6: Commit**

```bash
git add app/\(app\)/knowledge/rich-form.tsx app/\(app\)/knowledge/page.tsx
git commit -m "$(cat <<'EOF'
feat(knowledge-rich-forms): placeholder UI for rich knowledge types (PR 3 task 9)

Mounts <RichKnowledgeForm> on /knowledge alongside the existing paste form.
Type picker → per-type form fields → save. Pinout and theory forms include
'Parse with AI' textareas that call the new parse-* routes; connector and
wiring_diagram forms include image upload controls that call the new
upload-image route.

Inline styles match the PR 2 paste form aesthetic — placeholder until Claude
Design's PR 5 package replaces both forms with the real UI.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Final verification + push

**Files:** None modified.

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: all green. Count tests run; should be ~50 new tests over PR 2 baseline.

If any flake (the vitest fork-pool can show transient "PGlite is closed" errors on cold cache per memory), rerun once before investigating.

- [ ] **Step 2: TypeScript clean**

Run: `pnpm exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Build clean**

Run: `pnpm build`
Expected: build succeeds. Verify the new routes appear in output:
- `/api/knowledge/parse-pinout`
- `/api/knowledge/parse-theory`
- `/api/knowledge/upload-image`

- [ ] **Step 4: Inspect git log on this branch**

Run: `git log --oneline origin/staging..HEAD`
Expected: 10 commits — the design doc, then one per task.

- [ ] **Step 5: Push the branch (only after Brandon has reviewed local state)**

Branch push is the only point where Brandon should be in the loop before the bash runs. Surface the commit list + verification results, then push:

```bash
git push -u origin feat/knowledge-rich-forms
```

- [ ] **Step 6: Print the PR 4 paste-line verbatim for Brandon**

End the final session message with the literal next-PR paste-line from the kickoff doc:

> Continue PR 4 of the vehicle knowledge platform. Read `docs/superpowers/handoffs/2026-05-16-knowledge-pr4-kickoff.md` and execute it.

---

## Self-review

**1. Spec coverage:**
- Extend `/api/knowledge/save` for 4 rich types → Task 1 ✓
- `lib/knowledge/parse-pinout.ts` (Haiku) → Task 5 ✓
- `lib/knowledge/parse-theory.ts` (Haiku) → Task 7 ✓
- Image upload pipeline (`POST /api/knowledge/upload-image`, bucket + shop-scoped path) → Tasks 3, 4 ✓
- Unit tests per type's schema → Task 1 ✓
- Integration tests for per-type save → Task 2 ✓
- Integration tests for image upload (size + format gates) → Tasks 3, 4 ✓
- Placeholder UI per type → Task 9 ✓
- Owner-only gate verified per type → Tests in Tasks 2, 4, 6, 8 cover 401/403 ✓
- Mobile viewport validation → Task 10 (final manual gate on Vercel preview)
- Branch pushed → Task 10 ✓
- PR 4 paste-line printed → Task 10 ✓

**2. Placeholder scan:** No TBDs, no "add appropriate error handling," no "similar to Task N" without code. Every test body is present.

**3. Type consistency:** `KnowledgeSaveSchema` introduced in Task 1, referenced by name in Tasks 2 (test) and 6/8 (NOT referenced — those tasks use their own input schemas). `parsePinout` / `parseTheory` function signatures consistent between Tasks 5/7 (lib) and 6/8 (route). `uploadKnowledgeImage` signature consistent between Task 3 (lib) and Task 4 (route mock). `KnowledgeImageType` exported from Task 3 and imported in Task 4 ✓.

**4. Ambiguity check:** Each task's "Files" header lists exact paths. Each step prefixed with `- [ ] **Step N:**`. Each command exact. Each commit message includes co-author. Branch push only happens in Task 10 with explicit Brandon-checkpoint language.
