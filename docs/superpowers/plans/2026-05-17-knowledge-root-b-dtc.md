# Knowledge Root B (DTC) — Normalize-on-input + sub-code preservation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the same DTC saving as five different strings (drift) and start preserving sub-code tails (`-00`, `:11`) as orthogonal metadata. Same fix recipe, regardless of which scan tool's tail format reached the tech.

**Architecture:** `normalizeDtc` is the single source of truth — every input path (the 5 form DTC chips, the `/knowledge` filter bar, the AI paste flow that already calls it) funnels through it. The function returns `{ canonical, subCode } | null` instead of `string | null`. The library's identity / dedup / search / AI-lookup keep operating on bare canonical codes; sub-codes ride alongside in a sparse JSONB map on the row. Plus a latent bug fix: today the normalizer rejects hex bodies (`P0A80`), this PR allows them.

**Tech Stack:** TypeScript, Next.js App Router, Drizzle ORM (Postgres), Vitest, happy-dom for component tests. PGlite test DB. Supabase prod.

**Spec:** `docs/superpowers/specs/2026-05-17-knowledge-root-b-dtc-design.md`

---

## File structure

| File | Role | Action |
|---|---|---|
| `lib/knowledge/normalize.ts` | Rewrite `normalizeDtc` (new return shape, bug fix, new behaviors). Add `normalizeDtcForChip` wrapper for TagInput. | Modify |
| `tests/unit/normalize-dtc.test.ts` | Unit tests for the rewritten normalizer | **Create** |
| `drizzle/migrations/0015_knowledge_dtc_subcodes.sql` | Add `dtc_sub_codes jsonb` column | **Create** |
| `lib/db/schema.ts` | Add `dtcSubCodes` field to `knowledgeItems` table def | Modify |
| `lib/knowledge/save.ts` | Persist sub-codes; extend zod schema | Modify |
| `lib/knowledge/update-item.ts` | Persist sub-codes on edit; clean stale entries | Modify |
| `lib/knowledge/retrieval.ts` | Extract `.canonical` from new return shape (no other change) | Modify |
| `tests/unit/knowledge-save.test.ts` | Add sub-code persistence cases | Modify (or create if absent) |
| `tests/unit/knowledge-update.test.ts` | Add sub-code round-trip cases | Modify (or create if absent) |
| `components/knowledge/form-helpers.tsx` | TagInput `normalize` + `displaySuffix` props; `useDtcChips` hook | Modify |
| `tests/unit/tag-input.test.tsx` | Component tests for normalize / displaySuffix / hard-reject UX | **Create** |
| `app/(app)/knowledge/new/connector/connector-form.tsx` | DTC TagInput wired via `useDtcChips`, sends sub-codes on save | Modify |
| `app/(app)/knowledge/new/pinout/pinout-form.tsx` | Same | Modify |
| `app/(app)/knowledge/new/theory/theory-form.tsx` | Same | Modify |
| `app/(app)/knowledge/new/wiring/wiring-form.tsx` | Same | Modify |
| `app/(app)/knowledge/review-paste/review-form.tsx` | Same | Modify |
| `app/(app)/knowledge/page.tsx` | Normalize `dtc` query param on read | Modify |
| `lib/knowledge/list.ts` | Normalize filter input; short-circuit to `[]` on garbage | Modify |
| `tests/unit/knowledge-list.test.ts` | Add filter normalization cases | Modify (or create) |
| `components/knowledge/filter-bar.tsx` | DTC input normalizes on blur | Modify |
| `components/knowledge/drawer.tsx` | Render sub-code suffix on DTC chips | Modify |
| `components/knowledge/row.tsx` | Same chip rendering | Modify |
| `components/knowledge/knowledge.css` | Sub-code suffix style + chip-input error styles | Modify (append) |

---

## Task 1: Rewrite `normalizeDtc` (atomic — keeps build green)

**Files:**
- Modify: `lib/knowledge/normalize.ts`
- Create: `tests/unit/normalize-dtc.test.ts`
- Modify: `lib/knowledge/save.ts` (extract `.canonical` only — full sub-code wiring lands in Task 3)
- Modify: `lib/knowledge/update-item.ts` (same)
- Modify: `lib/knowledge/retrieval.ts` (same)

The signature changes from `string | null` to `NormalizedDtc | null`. The three current callers (`save`, `update`, `retrieval`) each get a minimal patch in this task to extract `.canonical` so the build stays green and behavior is unchanged. **Sub-code persistence lands in Tasks 3 + 4.**

- [ ] **Step 1: Write the failing normalizer tests**

Create `tests/unit/normalize-dtc.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { normalizeDtc } from '@/lib/knowledge/normalize'

describe('normalizeDtc', () => {
  describe('canonical bare codes', () => {
    it('passes through canonical input', () => {
      expect(normalizeDtc('P0420')).toEqual({ canonical: 'P0420', subCode: null })
    })

    it('uppercases lowercase input', () => {
      expect(normalizeDtc('p0420')).toEqual({ canonical: 'P0420', subCode: null })
    })

    it('accepts all four valid first letters', () => {
      expect(normalizeDtc('P0001')?.canonical).toBe('P0001')
      expect(normalizeDtc('B0001')?.canonical).toBe('B0001')
      expect(normalizeDtc('C0001')?.canonical).toBe('C0001')
      expect(normalizeDtc('U0001')?.canonical).toBe('U0001')
    })

    it('accepts hex bodies (bug fix — today P0A80 is rejected)', () => {
      expect(normalizeDtc('P0A80')).toEqual({ canonical: 'P0A80', subCode: null })
    })

    it('accepts OEM-extended codes (second char 1-3)', () => {
      expect(normalizeDtc('P1234')?.canonical).toBe('P1234')
      expect(normalizeDtc('P2345')?.canonical).toBe('P2345')
      expect(normalizeDtc('P3456')?.canonical).toBe('P3456')
    })
  })

  describe('silent cleanup', () => {
    it('strips internal whitespace', () => {
      expect(normalizeDtc('P 0420')).toEqual({ canonical: 'P0420', subCode: null })
      expect(normalizeDtc('P 0 4 2 0')).toEqual({ canonical: 'P0420', subCode: null })
    })

    it('strips internal dashes', () => {
      expect(normalizeDtc('P-0420')).toEqual({ canonical: 'P0420', subCode: null })
    })

    it('strips leading/trailing whitespace', () => {
      expect(normalizeDtc('  P0420  ')).toEqual({ canonical: 'P0420', subCode: null })
    })

    it('strips a "code" prefix', () => {
      expect(normalizeDtc('code P0420')).toEqual({ canonical: 'P0420', subCode: null })
      expect(normalizeDtc('Code: P0420')).toEqual({ canonical: 'P0420', subCode: null })
      expect(normalizeDtc('CODE:P0420')).toEqual({ canonical: 'P0420', subCode: null })
    })

    it('strips a "DTC" prefix', () => {
      expect(normalizeDtc('DTC P0420')).toEqual({ canonical: 'P0420', subCode: null })
      expect(normalizeDtc('DTC: P0420')).toEqual({ canonical: 'P0420', subCode: null })
      expect(normalizeDtc('dtc:P0420')).toEqual({ canonical: 'P0420', subCode: null })
    })

    it('applies the letter-O → digit-0 fix in body positions only', () => {
      expect(normalizeDtc('PO420')).toEqual({ canonical: 'P0420', subCode: null })
      expect(normalizeDtc('POO20')).toEqual({ canonical: 'P0020', subCode: null })
    })

    it('does NOT swap the first-letter position', () => {
      // First char must stay as a letter; if a tech types '0' as the first char,
      // it's not a DTC (no valid first letter).
      expect(normalizeDtc('00420')).toBeNull()
    })
  })

  describe('sub-code capture', () => {
    it('captures dash-style sub-code', () => {
      expect(normalizeDtc('P0420-00')).toEqual({ canonical: 'P0420', subCode: '00' })
    })

    it('captures colon-style sub-code', () => {
      expect(normalizeDtc('P0420:11')).toEqual({ canonical: 'P0420', subCode: '11' })
    })

    it('captures hex sub-code', () => {
      expect(normalizeDtc('P0420-FF')).toEqual({ canonical: 'P0420', subCode: 'FF' })
      expect(normalizeDtc('P0420-AB')).toEqual({ canonical: 'P0420', subCode: 'AB' })
    })

    it('captures sub-code through letter-case mixing', () => {
      expect(normalizeDtc('p0420-ab')).toEqual({ canonical: 'P0420', subCode: 'AB' })
    })

    it('captures sub-code with prefix-strip and whitespace combined', () => {
      expect(normalizeDtc('DTC: p 0420-00')).toEqual({ canonical: 'P0420', subCode: '00' })
    })

    it('drops a malformed sub-code but preserves the base', () => {
      expect(normalizeDtc('P0420-XYZ')).toEqual({ canonical: 'P0420', subCode: null })
      expect(normalizeDtc('P0420-0')).toEqual({ canonical: 'P0420', subCode: null })
      expect(normalizeDtc('P0420-')).toEqual({ canonical: 'P0420', subCode: null })
    })
  })

  describe('hard rejects', () => {
    it('rejects empty input', () => {
      expect(normalizeDtc('')).toBeNull()
      expect(normalizeDtc('   ')).toBeNull()
    })

    it('rejects wrong first letter', () => {
      expect(normalizeDtc('Z0420')).toBeNull()
      expect(normalizeDtc('A1234')).toBeNull()
      expect(normalizeDtc('X0001')).toBeNull()
    })

    it('rejects wrong second char (must be 0-3)', () => {
      expect(normalizeDtc('P4420')).toBeNull()
      expect(normalizeDtc('PA420')).toBeNull()
    })

    it('rejects wrong length', () => {
      expect(normalizeDtc('P042')).toBeNull()
      expect(normalizeDtc('P04200')).toBeNull()
      expect(normalizeDtc('P02663')).toBeNull()
    })

    it('rejects non-hex chars in body', () => {
      expect(normalizeDtc('P0G20')).toBeNull()
      expect(normalizeDtc('P042X')).toBeNull()
      expect(normalizeDtc('P04ZZ')).toBeNull()
    })

    it('rejects missing first letter', () => {
      expect(normalizeDtc('0420')).toBeNull()
    })

    it('rejects pure jibberish', () => {
      expect(normalizeDtc('not a code')).toBeNull()
      expect(normalizeDtc('???')).toBeNull()
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test normalize-dtc -- --run`
Expected: ALL tests FAIL (current `normalizeDtc` returns `string | null`, not `{ canonical, subCode } | null`).

- [ ] **Step 3: Rewrite the normalizer**

Replace the existing `normalizeDtc` block in `lib/knowledge/normalize.ts` (lines 1–10):

```ts
// DTC = OBD-II Diagnostic Trouble Code. Canonical shape: one letter (P/B/C/U)
// followed by 4 hex chars (with the second char restricted to 0-3 per SAE J2012).
// An optional 2-hex-char "failure type byte" (FTB) tail comes after a `-` or `:`
// separator and carries fault-mode detail (e.g. P0420-11 = signal above range).
// We preserve the FTB tail as orthogonal metadata via `subCode`; the canonical
// base is the library-identity key (same fix recipe regardless of tail).
const DTC_BASE_RE = /^[PBCU][0-3][0-9A-F]{3}$/
const DTC_TAIL_RE = /^[0-9A-F]{2}$/

export type NormalizedDtc = { canonical: string; subCode: string | null }

export function normalizeDtc(input: string): NormalizedDtc | null {
  let s = input.trim()
  if (s.length === 0) return null
  s = s.toUpperCase()

  // Strip a "CODE" or "DTC" prefix (with optional `:` and whitespace separator).
  s = s.replace(/^(CODE|DTC)[\s:]+/, '')

  // Strip ALL whitespace anywhere in the remaining string.
  s = s.replace(/\s+/g, '')
  if (s.length === 0) return null

  // Find a `-` or `:` separator at position 6+ (i.e. AFTER the 5-char base).
  // Positions 1-5 use char-index 0-4; the separator we care about lives at
  // char-index 5 or later.
  let base = s
  let tail: string | null = null
  const sepIdx = (() => {
    for (let i = 5; i < s.length; i++) {
      if (s[i] === '-' || s[i] === ':') return i
    }
    return -1
  })()
  if (sepIdx !== -1) {
    base = s.slice(0, sepIdx)
    tail = s.slice(sepIdx + 1)
  }

  // Strip any `-` or `:` that remain INSIDE the base (positions 0-4 of a base
  // that started as e.g. "P-0420").
  base = base.replace(/[-:]/g, '')

  // Letter-O → digit-0 fix in body positions (chars 1-4 of the base). First
  // char (the letter prefix) is untouched.
  if (base.length >= 1) {
    base = base[0] + base.slice(1).replace(/O/g, '0')
  }

  // Validate the base.
  if (!DTC_BASE_RE.test(base)) return null

  // Validate the tail (or drop it if invalid; base survives).
  const subCode = tail !== null && DTC_TAIL_RE.test(tail) ? tail : null

  return { canonical: base, subCode }
}
```

Also append the chip-input wrapper at the end of `lib/knowledge/normalize.ts`:

```ts
// TagInput-shaped wrapper: maps NormalizedDtc to the { value, suffix } shape
// expected by the TagInput's `normalize` prop.
export function normalizeDtcForChip(
  raw: string,
): { value: string; suffix: string | null } | null {
  const n = normalizeDtc(raw)
  if (!n) return null
  return { value: n.canonical, suffix: n.subCode }
}
```

- [ ] **Step 4: Update the three current callers to extract `.canonical`**

In `lib/knowledge/save.ts`, find the block at lines ~186–192:

```ts
const normalizedDtcs = Array.from(
  new Set(
    (input.dtcList ?? [])
      .map((d) => normalizeDtc(d))
      .filter((d): d is string => d !== null),
  ),
)
```

Replace with (Task 3 wires sub-codes; this task just keeps types green):

```ts
const normalizedDtcs = Array.from(
  new Set(
    (input.dtcList ?? [])
      .map((d) => normalizeDtc(d))
      .filter((n): n is NormalizedDtc => n !== null)
      .map((n) => n.canonical),
  ),
)
```

Add `NormalizedDtc` to the existing import from `@/lib/knowledge/normalize`.

In `lib/knowledge/update-item.ts`, find the equivalent block at lines ~19–22 and apply the same transformation.

In `lib/knowledge/retrieval.ts`, find at lines ~102–104:

```ts
const normalizedDtcs = (input.dtcs ?? [])
  .map((d) => normalizeDtc(d))
  .filter((d): d is string => d !== null)
```

Replace with:

```ts
const normalizedDtcs = (input.dtcs ?? [])
  .map((d) => normalizeDtc(d))
  .filter((n): n is NormalizedDtc => n !== null)
  .map((n) => n.canonical)
```

- [ ] **Step 5: Run normalizer tests + typecheck**

Run: `pnpm test normalize-dtc -- --run`
Expected: ALL tests PASS.

Run: `pnpm exec tsc --noEmit`
Expected: Zero new errors.

- [ ] **Step 6: Run the full test suite to confirm no regressions**

Run: `pnpm test -- --run`
Expected: All existing tests pass (no behavioral change for callers). If the Vitest pool flakes on cold cache (PGlite-closed errors), re-run once.

- [ ] **Step 7: Commit**

```bash
git add lib/knowledge/normalize.ts lib/knowledge/save.ts lib/knowledge/update-item.ts lib/knowledge/retrieval.ts tests/unit/normalize-dtc.test.ts
git commit -m "feat(knowledge): rewrite normalizeDtc to capture sub-codes (root B)"
```

---

## Task 2: Migration + schema definition

**Files:**
- Create: `drizzle/migrations/0015_knowledge_dtc_subcodes.sql`
- Modify: `lib/db/schema.ts`

- [ ] **Step 1: Inspect the most recent migration for header style**

Run: `head -10 drizzle/migrations/0014_knowledge_platform.sql`

Match the existing header style (statement-breakpoint markers, comment headers, etc.) when writing the new migration.

- [ ] **Step 2: Create the migration file**

Create `drizzle/migrations/0015_knowledge_dtc_subcodes.sql`:

```sql
-- Root B (DTC): preserve the sub-code "failure type byte" tail (e.g. "00", "11")
-- as orthogonal metadata. The library-identity key remains the bare canonical
-- DTC stored in dtc_list; this column holds a sparse map of bare_code → tail
-- for the codes on this item that arrived with a tail.
--
-- Shape: { "P0420": "00", "P0430": "11" }
-- Codes without a tail are simply absent from the map; we do not store nulls.
ALTER TABLE knowledge_items
  ADD COLUMN dtc_sub_codes jsonb;
```

(No data backfill — existing rows get `NULL`, which is the correct "no sub-codes" empty value.)

- [ ] **Step 3: Add the field to the Drizzle schema**

In `lib/db/schema.ts`, find the `knowledgeItems` table definition (around line 499 where `dtcList` is defined) and add the new field next to it:

```ts
dtcList: text('dtc_list').array().notNull().default([]),
dtcSubCodes: jsonb('dtc_sub_codes').$type<Record<string, string> | null>(),
systemCodes: text('system_codes').array().notNull().default([]),
```

Confirm `jsonb` is already imported from `drizzle-orm/pg-core` at the top of the file (it should be — `structuredData` uses it).

- [ ] **Step 4: Regenerate Drizzle types if needed**

Run: `pnpm exec drizzle-kit check` (or your project's drizzle generation script)
Expected: Schema check passes — the new migration is detected, no conflicts.

If the project uses `drizzle-kit generate` to produce migrations from the schema, **the migration file we created in Step 2 should match what would be auto-generated.** If `drizzle-kit generate` outputs a different file, prefer its output and update Step 2's hand-written SQL to match.

- [ ] **Step 5: Apply migration to local rehearsal DB**

Per the project's local rehearsal pattern (`vyntechs_rehearsal`):

```bash
psql vyntechs_rehearsal -f drizzle/migrations/0015_knowledge_dtc_subcodes.sql
```

Verify the column exists:

```bash
psql vyntechs_rehearsal -c "\d knowledge_items" | grep dtc_sub_codes
```

Expected: line shows `dtc_sub_codes | jsonb`.

- [ ] **Step 6: Confirm test DB picks up the migration**

PGlite test setup applies all migrations under `drizzle/migrations/` automatically. Verify:

Run: `pnpm test knowledge -- --run`
Expected: existing tests still pass; the new column doesn't break anything (default NULL is fine).

- [ ] **Step 7: Commit**

```bash
git add drizzle/migrations/0015_knowledge_dtc_subcodes.sql lib/db/schema.ts
git commit -m "feat(knowledge): add dtc_sub_codes column (root B migration)"
```

> **Live-DB note (DO NOT do now — apply pre-merge):** Per the "apply migrations to live DB" rule, the live Supabase migration is applied via MCP `apply_migration` AFTER the PR is otherwise ready and validated, BEFORE Brandon merges. Do not apply to prod during this task.

---

## Task 3: Save-path sub-code persistence

**Files:**
- Modify: `lib/knowledge/save.ts`
- Modify: `tests/unit/knowledge-save.test.ts` (or create if absent)

- [ ] **Step 1: Read the existing save test setup**

Run: `find tests -name "knowledge-save*" -o -name "*save*.test*" | head -5`

Read the file (or, if none, look at `tests/unit/knowledge-paste-route.test.ts` for the mock-DB pattern).

- [ ] **Step 2: Write failing tests**

Append to the existing save test file (or create new):

```ts
import { describe, expect, it } from 'vitest'
import { saveKnowledgeItem } from '@/lib/knowledge/save'
import { testDb, withTestShop } from '@/tests/helpers/db'  // adjust to project pattern

describe('saveKnowledgeItem — DTC sub-codes', () => {
  it('persists sub-codes alongside canonical DTCs', async () => {
    const { shopId, userId } = await withTestShop()
    const { id } = await saveKnowledgeItem(
      {
        type: 'note',
        title: 'test',
        body: 'whatever',
        dtcList: ['P0420'],
        dtcSubCodes: { P0420: '00' },
      },
      { shopId, createdByUserId: userId },
    )
    const row = await testDb.query.knowledgeItems.findFirst({ where: (k, { eq }) => eq(k.id, id) })
    expect(row?.dtcList).toEqual(['P0420'])
    expect(row?.dtcSubCodes).toEqual({ P0420: '00' })
  })

  it('normalizes DTC inputs with tails (the chip + the AI both run through here)', async () => {
    const { shopId, userId } = await withTestShop()
    const { id } = await saveKnowledgeItem(
      {
        type: 'note',
        title: 'test',
        body: 'whatever',
        dtcList: ['p0420-00', 'P0430:11'],
      },
      { shopId, createdByUserId: userId },
    )
    const row = await testDb.query.knowledgeItems.findFirst({ where: (k, { eq }) => eq(k.id, id) })
    expect(row?.dtcList?.sort()).toEqual(['P0420', 'P0430'])
    expect(row?.dtcSubCodes).toEqual({ P0420: '00', P0430: '11' })
  })

  it('omits the dtcSubCodes column when no DTC had a tail', async () => {
    const { shopId, userId } = await withTestShop()
    const { id } = await saveKnowledgeItem(
      {
        type: 'note',
        title: 'test',
        body: 'whatever',
        dtcList: ['P0420'],
      },
      { shopId, createdByUserId: userId },
    )
    const row = await testDb.query.knowledgeItems.findFirst({ where: (k, { eq }) => eq(k.id, id) })
    expect(row?.dtcSubCodes).toBeNull()
  })

  it('drops stale dtcSubCodes entries for DTCs not in the final dtc_list', async () => {
    const { shopId, userId } = await withTestShop()
    const { id } = await saveKnowledgeItem(
      {
        type: 'note',
        title: 'test',
        body: 'whatever',
        dtcList: ['P0420'],
        dtcSubCodes: { P0420: '00', P9999: 'FF' },  // P9999 not in dtcList
      },
      { shopId, createdByUserId: userId },
    )
    const row = await testDb.query.knowledgeItems.findFirst({ where: (k, { eq }) => eq(k.id, id) })
    expect(row?.dtcSubCodes).toEqual({ P0420: '00' })
  })

  it('rejects malformed sub-codes via zod', async () => {
    const { shopId, userId } = await withTestShop()
    await expect(
      saveKnowledgeItem(
        {
          type: 'note',
          title: 'test',
          body: 'whatever',
          dtcList: ['P0420'],
          // @ts-expect-error — testing runtime validation
          dtcSubCodes: { P0420: 'invalid-tail-format' },
        },
        { shopId, createdByUserId: userId },
      ),
    ).rejects.toThrow()
  })
})
```

If the helpers (`testDb`, `withTestShop`) don't exist, adapt to the actual test-DB patterns used elsewhere in `tests/unit/`. Don't invent new infrastructure — match what's there.

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test knowledge-save -- --run`
Expected: New tests FAIL (saveKnowledgeItem doesn't yet accept/persist dtcSubCodes).

- [ ] **Step 4: Update `save.ts` to persist sub-codes**

In `lib/knowledge/save.ts`:

(a) Extend `CommonFields` (around line 32) with the new optional input:

```ts
const CommonFields = {
  title: z.string().min(1).max(200),
  dtcList: z.array(z.string()).max(40).optional(),
  dtcSubCodes: z
    .record(
      z.string().regex(/^[PBCU][0-3][0-9A-F]{3}$/),
      z.string().regex(/^[0-9A-F]{2}$/),
    )
    .optional(),
  systemCodes: z.array(z.string()).max(20).optional(),
  // ... rest unchanged
}
```

(b) Replace the DTC-normalization block from Task 1 (currently extracting only `.canonical`) with full sub-code handling:

```ts
const normalizedPairs = (input.dtcList ?? [])
  .map((d) => normalizeDtc(d))
  .filter((n): n is NormalizedDtc => n !== null)

const dtcSet = new Set<string>()
const subCodesByDtc: Record<string, string> = {}

// 1. Sub-codes from the new dtcSubCodes input (typed in via the chip).
//    Only keep entries whose key passes normalizeDtc itself (defense in depth).
for (const [rawKey, val] of Object.entries(input.dtcSubCodes ?? {})) {
  const n = normalizeDtc(rawKey)
  if (n) subCodesByDtc[n.canonical] = val
}

// 2. Sub-codes inferred from dtcList entries that themselves carried a tail
//    (e.g. AI parser emitted "P0420-00" — rare but handled).
for (const p of normalizedPairs) {
  dtcSet.add(p.canonical)
  if (p.subCode !== null && !(p.canonical in subCodesByDtc)) {
    subCodesByDtc[p.canonical] = p.subCode
  }
}

// Filter stale sub-codes: only keep entries for DTCs in the final list.
for (const key of Object.keys(subCodesByDtc)) {
  if (!dtcSet.has(key)) delete subCodesByDtc[key]
}

const normalizedDtcs = Array.from(dtcSet)
const dtcSubCodes = Object.keys(subCodesByDtc).length > 0 ? subCodesByDtc : null
```

(c) Add `dtcSubCodes: dtcSubCodes,` to the `itemRow: NewKnowledgeItem` object next to `dtcList`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test knowledge-save -- --run`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/knowledge/save.ts tests/unit/knowledge-save.test.ts
git commit -m "feat(knowledge): persist DTC sub-codes on save (root B)"
```

---

## Task 4: Update-path sub-code persistence

**Files:**
- Modify: `lib/knowledge/update-item.ts`
- Modify: `tests/unit/knowledge-update.test.ts` (or equivalent)

- [ ] **Step 1: Read the update-item module to find its schema and DTC block**

Run: `head -50 lib/knowledge/update-item.ts`

Identify (i) where DTCs are normalized (around line 19), (ii) whether there is a separate zod schema or it reuses save's.

- [ ] **Step 2: Write failing tests for sub-code round-trip on edit**

Add to the equivalent update-item test file:

```ts
it('persists sub-codes on update', async () => {
  // create the item first
  const { id, shopId, userId } = await seedItemWithDtcs(['P0420'], { P0420: '00' })

  // update — remove P0420, add P0430 with sub-code
  await updateKnowledgeItem(
    id,
    {
      dtcList: ['P0430'],
      dtcSubCodes: { P0430: '11' },
    },
    { shopId, actorUserId: userId },
  )

  const row = await testDb.query.knowledgeItems.findFirst({ where: (k, { eq }) => eq(k.id, id) })
  expect(row?.dtcList).toEqual(['P0430'])
  expect(row?.dtcSubCodes).toEqual({ P0430: '11' })
})

it('cleans up sub-codes for DTCs removed during update', async () => {
  const { id, shopId, userId } = await seedItemWithDtcs(['P0420', 'P0430'], {
    P0420: '00',
    P0430: '11',
  })
  await updateKnowledgeItem(
    id,
    { dtcList: ['P0420'], dtcSubCodes: { P0420: '00' } },
    { shopId, actorUserId: userId },
  )
  const row = await testDb.query.knowledgeItems.findFirst({ where: (k, { eq }) => eq(k.id, id) })
  expect(row?.dtcList).toEqual(['P0420'])
  expect(row?.dtcSubCodes).toEqual({ P0420: '00' })  // P0430 entry dropped
})
```

- [ ] **Step 3: Run failing tests**

Run: `pnpm test knowledge-update -- --run`
Expected: New tests FAIL.

- [ ] **Step 4: Apply the same sub-code handling block to `update-item.ts`**

Mirror the Task 3 Step 4(b) block in `update-item.ts`. Add the zod field if `update-item.ts` validates its own schema; otherwise rely on save's schema.

Set `dtcSubCodes` on the update payload alongside `dtcList`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test knowledge-update -- --run`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/knowledge/update-item.ts tests/unit/knowledge-update.test.ts
git commit -m "feat(knowledge): persist DTC sub-codes on update (root B)"
```

---

## Task 5: TagInput `normalize` + `displaySuffix` + `useDtcChips` hook

**Files:**
- Modify: `components/knowledge/form-helpers.tsx`
- Create: `tests/unit/tag-input.test.tsx`

- [ ] **Step 1: Write the failing component tests**

Create `tests/unit/tag-input.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TagInput } from '@/components/knowledge/form-helpers'

describe('TagInput', () => {
  it('renders values as chips (unchanged baseline behavior)', () => {
    render(<TagInput values={['P0420', 'P0430']} setValues={() => {}} />)
    expect(screen.getByText('P0420')).toBeInTheDocument()
    expect(screen.getByText('P0430')).toBeInTheDocument()
  })

  it('without normalize: Enter adds the raw value', () => {
    const setValues = vi.fn()
    render(<TagInput values={[]} setValues={setValues} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'anything' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(setValues).toHaveBeenCalledWith(['anything'])
  })

  it('with normalize that returns a value: Enter adds the canonical value', () => {
    const setValues = vi.fn()
    const normalize = vi.fn((raw: string) =>
      raw === 'p0420' ? { value: 'P0420', suffix: null } : null,
    )
    render(<TagInput values={[]} setValues={setValues} normalize={normalize} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'p0420' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(setValues).toHaveBeenCalledWith(['P0420'])
  })

  it('with normalize that returns null: hard-rejects, no chip added, shows error', () => {
    const setValues = vi.fn()
    const normalize = vi.fn(() => null)
    render(<TagInput values={[]} setValues={setValues} normalize={normalize} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'garbage' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(setValues).not.toHaveBeenCalled()
    expect(input.className).toMatch(/error/i)
    expect(screen.getByText(/not a valid/i)).toBeInTheDocument()
  })

  it('displaySuffix renders the suffix next to the chip value', () => {
    render(
      <TagInput
        values={['P0420']}
        setValues={() => {}}
        displaySuffix={(v) => (v === 'P0420' ? '00' : null)}
      />,
    )
    expect(screen.getByText('P0420')).toBeInTheDocument()
    expect(screen.getByText(/·00/)).toBeInTheDocument()
  })
})
```

If `@testing-library/react` isn't installed (per Root A Task 6), install it:

```bash
pnpm add -D @testing-library/react
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tag-input -- --run`
Expected: Tests FAIL (TagInput doesn't have `normalize` / `displaySuffix` props).

- [ ] **Step 3: Update TagInput**

In `components/knowledge/form-helpers.tsx`, replace the existing `TagInput` (around lines 57–92) with:

```tsx
export function TagInput({
  values,
  setValues,
  placeholder,
  normalize,
  displaySuffix,
}: {
  values: string[]
  setValues: (v: string[]) => void
  placeholder?: string
  // When provided, runs on Enter/comma. Returns the canonical value (and an
  // optional suffix to display) — or null to hard-reject the input.
  normalize?: (raw: string) => { value: string; suffix: string | null } | null
  // Optional per-chip suffix renderer (for re-displaying suffixes loaded from
  // a parallel state map — e.g. dtcSubCodes — when values were not just typed).
  displaySuffix?: (value: string) => string | null
}) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const commit = () => {
    const t = draft.trim()
    if (!t) return
    if (normalize) {
      const result = normalize(t)
      if (!result) {
        setError('Not a valid DTC — try P/B/C/U + 4 hex digits (e.g. P0420).')
        return
      }
      setValues([...values, result.value])
      // The caller is responsible for stitching suffixes into its parallel
      // state map via the form-level handler (see useDtcChips below).
    } else {
      setValues([...values, t])
    }
    setDraft('')
    setError(null)
  }

  return (
    <div className="vk-taginput">
      {values.map((v, i) => {
        const suffix = displaySuffix?.(v)
        return (
          <span className="vk-taginput__chip" key={i}>
            {v}
            {suffix && <span className="vk-taginput__chip-sub"> ·{suffix}</span>}
            <button type="button" onClick={() => setValues(values.filter((_, j) => j !== i))}>
              ×
            </button>
          </span>
        )
      })}
      <input
        className={error ? 'vk-taginput__input vk-taginput__input--error' : 'vk-taginput__input'}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
          if (error) setError(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            commit()
          }
        }}
        placeholder={placeholder}
      />
      {error && <div className="vk-taginput__error">{error}</div>}
    </div>
  )
}
```

> **Note:** TagInput stays "values-only" externally. The suffix is added/removed via the form-level `useDtcChips` hook below — TagInput never needs to know about sub-codes as state; it just renders them via the `displaySuffix` callback.

- [ ] **Step 4: Add the `useDtcChips` hook**

Append to `components/knowledge/form-helpers.tsx`:

```tsx
import { normalizeDtcForChip } from '@/lib/knowledge/normalize'

// Manages parallel state for DTC chips + sub-codes. The form passes (dtcs,
// setDtcs, subCodes, displaySuffix) to TagInput. When a new chip is added via
// normalize, we intercept and update both arrays.
export function useDtcChips(initial: {
  dtcs: string[]
  subCodes: Record<string, string>
}) {
  const [dtcs, setDtcsRaw] = useState<string[]>(initial.dtcs)
  const [subCodes, setSubCodes] = useState<Record<string, string>>(initial.subCodes)

  // Custom setter for TagInput: it sends us the full next array of canonical
  // values. We diff to learn which value(s) were added; for those we re-run
  // the normalizer on the draft (stored in lastDraftRef) to recover the suffix.
  // Simpler approach: intercept commit via a wrapper normalize that captures
  // the suffix on each successful add.
  const lastSuffixRef = { current: null as string | null }

  const normalize = (raw: string) => {
    const result = normalizeDtcForChip(raw)
    lastSuffixRef.current = result?.suffix ?? null
    return result
  }

  const setDtcs = (next: string[]) => {
    // Determine added DTCs (values in next not in dtcs).
    const added = next.filter((v) => !dtcs.includes(v))
    const removed = dtcs.filter((v) => !next.includes(v))

    const nextSub = { ...subCodes }
    for (const v of removed) delete nextSub[v]
    if (added.length === 1 && lastSuffixRef.current !== null) {
      nextSub[added[0]] = lastSuffixRef.current
    }
    lastSuffixRef.current = null

    setDtcsRaw(next)
    setSubCodes(nextSub)
  }

  const displaySuffix = (value: string): string | null => subCodes[value] ?? null

  return { dtcs, subCodes, setDtcs, normalize, displaySuffix }
}
```

> **Simpler alternative (consider if the diff-detection above feels fragile):** track the next pending suffix in a ref keyed off the `normalize` call's return. The form integration is the same regardless.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test tag-input -- --run`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add components/knowledge/form-helpers.tsx tests/unit/tag-input.test.tsx
git commit -m "feat(knowledge): TagInput normalize+displaySuffix props, useDtcChips hook (root B)"
```

---

## Task 6: Wire 5 form callsites to `useDtcChips`

**Files:**
- Modify: `app/(app)/knowledge/new/connector/connector-form.tsx`
- Modify: `app/(app)/knowledge/new/pinout/pinout-form.tsx`
- Modify: `app/(app)/knowledge/new/theory/theory-form.tsx`
- Modify: `app/(app)/knowledge/new/wiring/wiring-form.tsx`
- Modify: `app/(app)/knowledge/review-paste/review-form.tsx`

Each follows the same pattern. Walk one carefully; the others are mechanical mirrors.

- [ ] **Step 1: Update connector-form.tsx**

Find (around line 26):

```tsx
const [dtcs, setDtcs] = useState<string[]>(existing?.dtcList ?? [])
```

Replace with:

```tsx
const { dtcs, subCodes: dtcSubCodes, setDtcs, normalize, displaySuffix } = useDtcChips({
  dtcs: existing?.dtcList ?? [],
  subCodes: existing?.dtcSubCodes ?? {},
})
```

Find the TagInput callsite (around line 141):

```tsx
<TagInput values={dtcs} setValues={setDtcs} placeholder="P0562" />
```

Replace with:

```tsx
<TagInput
  values={dtcs}
  setValues={setDtcs}
  placeholder="P0562"
  normalize={normalize}
  displaySuffix={displaySuffix}
/>
```

Find the save payload (around line 60):

```tsx
dtcList: dtcs,
```

Replace with:

```tsx
dtcList: dtcs,
dtcSubCodes: Object.keys(dtcSubCodes).length > 0 ? dtcSubCodes : undefined,
```

Add the import:

```tsx
import { TagInput, useDtcChips, /* other existing imports */ } from '@/components/knowledge/form-helpers'
```

- [ ] **Step 2: Mirror the change to pinout-form, theory-form, wiring-form, review-form**

Apply the same four-edit pattern in each file. The line numbers will differ; the shape is identical. For `review-paste/review-form.tsx`, the existing line that initializes from the AI proposal also needs updating — the AI flow won't pre-populate `dtcSubCodes` (the prompt strips tails), so it starts as `{}` from the proposal.

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: Zero errors. Forms compile with the new hook.

- [ ] **Step 4: Smoke-test one form via dev server**

Run: `pnpm dev`

Open the `/knowledge/new/connector` page (or whichever form's route exists). Type `P0420-00` in the DTC chip input + Enter. Chip should appear as `P0420 ·00`. Type `garbage` + Enter. Should hard-reject with red border + error line. Stop dev server.

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/knowledge/new/connector/connector-form.tsx \
        app/\(app\)/knowledge/new/pinout/pinout-form.tsx \
        app/\(app\)/knowledge/new/theory/theory-form.tsx \
        app/\(app\)/knowledge/new/wiring/wiring-form.tsx \
        app/\(app\)/knowledge/review-paste/review-form.tsx
git commit -m "feat(knowledge): wire 5 DTC chip callsites to useDtcChips (root B)"
```

---

## Task 7: Filter bar + page param + list.ts normalization

**Files:**
- Modify: `components/knowledge/filter-bar.tsx`
- Modify: `app/(app)/knowledge/page.tsx`
- Modify: `lib/knowledge/list.ts`
- Modify: `tests/unit/knowledge-list.test.ts` (or create)

- [ ] **Step 1: Write failing tests for list.ts filter normalization**

In the appropriate list-test file:

```ts
it('matches an item stored as P0420 when filter input is "p-0420"', async () => {
  const { shopId } = await seedItemWithDtcs(['P0420'])
  const items = await listKnowledgeItems(testDb, {
    shopId,
    filter: { dtc: 'p-0420' },
  })
  expect(items.map((i) => i.id)).toContain(/* the seeded item's id */)
})

it('returns empty list when filter DTC is unnormalizable (no 500)', async () => {
  const { shopId } = await seedItemWithDtcs(['P0420'])
  const items = await listKnowledgeItems(testDb, {
    shopId,
    filter: { dtc: 'garbage' },
  })
  expect(items).toEqual([])
})

it('matches an item stored as P0420 when filter input is "P0420-00" (tail tolerant)', async () => {
  const { shopId } = await seedItemWithDtcs(['P0420'])
  const items = await listKnowledgeItems(testDb, {
    shopId,
    filter: { dtc: 'P0420-00' },
  })
  expect(items.length).toBeGreaterThan(0)
})
```

- [ ] **Step 2: Run failing tests**

Run: `pnpm test knowledge-list -- --run`
Expected: Tests FAIL (filter currently exact-matches the input string).

- [ ] **Step 3: Update list.ts**

In `lib/knowledge/list.ts`, find the existing filter block (around line 54–56):

```ts
if (filter.dtc) {
  conditions.push(sql`${filter.dtc} = ANY(${knowledgeItems.dtcList})`)
}
```

Replace with:

```ts
if (filter.dtc) {
  const n = normalizeDtc(filter.dtc)
  if (!n) return []  // unnormalizable filter → no possible matches
  conditions.push(sql`${n.canonical} = ANY(${knowledgeItems.dtcList})`)
}
```

Add the import at the top:

```ts
import { normalizeDtc } from '@/lib/knowledge/normalize'
```

- [ ] **Step 4: Update page.tsx**

In `app/(app)/knowledge/page.tsx`, find the dtc param parsing (around line 108):

```ts
const dtc = singleParam(sp.dtc); if (dtc) filter.dtc = dtc.toUpperCase()
```

Replace with:

```ts
const dtcRaw = singleParam(sp.dtc)
if (dtcRaw) {
  const n = normalizeDtc(dtcRaw)
  filter.dtc = n ? n.canonical : dtcRaw  // pass garbage through so list.ts can short-circuit
}
```

Add the import at the top of the file:

```ts
import { normalizeDtc } from '@/lib/knowledge/normalize'
```

- [ ] **Step 5: Update filter-bar.tsx**

In `components/knowledge/filter-bar.tsx`, find the DTC input (around line 91–99):

```tsx
<label className="vk-chip">
  DTC
  <input
    className="vk-chip__input"
    type="text"
    value={dtc}
    placeholder="P0562"
    onChange={e => update({ dtc: e.target.value.toUpperCase() || null })}
  />
</label>
```

Replace with:

```tsx
<label className="vk-chip">
  DTC
  <input
    className="vk-chip__input"
    type="text"
    value={dtc}
    placeholder="P0562"
    onChange={e => update({ dtc: e.target.value.toUpperCase() || null })}
    onBlur={e => {
      const v = e.target.value.trim()
      if (!v) return
      const n = normalizeDtc(v)
      if (n && n.canonical !== v.toUpperCase()) {
        update({ dtc: n.canonical })
      }
    }}
  />
</label>
```

Add the import at the top of the file:

```tsx
import { normalizeDtc } from '@/lib/knowledge/normalize'
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test knowledge-list -- --run`
Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/knowledge/list.ts app/\(app\)/knowledge/page.tsx components/knowledge/filter-bar.tsx tests/unit/knowledge-list.test.ts
git commit -m "feat(knowledge): normalize DTC filter input on /knowledge (root B)"
```

---

## Task 8: Chip display in drawer + row

**Files:**
- Modify: `components/knowledge/drawer.tsx`
- Modify: `components/knowledge/row.tsx`

- [ ] **Step 1: Update drawer.tsx**

Find the DTC chip render (around line 132):

```tsx
{item.dtcList.map(d => <span className="vk-tag vk-tag--dtc" key={d}>{d}</span>)}
```

Replace with:

```tsx
{item.dtcList.map(d => {
  const sub = item.dtcSubCodes?.[d]
  return (
    <span className="vk-tag vk-tag--dtc" key={d}>
      {d}
      {sub && <span className="vk-tag__sub"> ·{sub}</span>}
    </span>
  )
})}
```

- [ ] **Step 2: Update row.tsx**

Find the equivalent DTC chip render (around line 58) and apply the same pattern.

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: Zero errors. (KnowledgeListRow inherits `dtcSubCodes` from the schema row.)

- [ ] **Step 4: Commit**

```bash
git add components/knowledge/drawer.tsx components/knowledge/row.tsx
git commit -m "feat(knowledge): render DTC sub-code suffix on drawer + row chips (root B)"
```

---

## Task 9: CSS for sub-code suffix + chip-input error

**Files:**
- Modify: `components/knowledge/knowledge.css`

- [ ] **Step 1: Append new styles**

Append to `components/knowledge/knowledge.css`:

```css
/* Root B — DTC sub-code suffix on chips (·00) */
.vk-tag__sub,
.vk-taginput__chip-sub {
  margin-left: 2px;
  font-size: 0.85em;
  color: #6b7280;
  font-weight: 400;
}

/* Root B — chip input hard-reject error state */
.vk-taginput__input--error {
  border-color: #ef4444;
  background: #fef2f2;
}

.vk-taginput__error {
  color: #b91c1c;
  font-size: 12px;
  margin-top: 4px;
  width: 100%;
}

@media (max-width: 414px) {
  .vk-taginput__error {
    font-size: 11px;
  }
}
```

If `knowledge.css` already uses CSS variables for warning / error colors, prefer those over hex literals.

- [ ] **Step 2: Visual sanity check (manual)**

Run: `pnpm dev`

Visit `/knowledge`. Open any item with a DTC — verify the chip renders cleanly. Try typing a bad DTC in a chip input — verify the red border + error line are readable on desktop and at 375px viewport. Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add components/knowledge/knowledge.css
git commit -m "feat(knowledge): styles for DTC sub-code suffix + chip hard-reject (root B)"
```

---

## Task 10: Final verification pass

**Files:** none modified. All quality gates.

- [ ] **Step 1: Full typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: Zero errors.

- [ ] **Step 2: Full lint**

Run: `pnpm lint`
Expected: Zero errors. (Pre-existing warnings okay.)

- [ ] **Step 3: Full test suite**

Run: `pnpm test -- --run`
Expected: All tests pass. If Vitest pool flakes on cold cache (PGlite-closed errors), re-run once.

- [ ] **Step 4: Sanity-grep for stale `normalizeDtc` callers we might have missed**

Run:
```bash
grep -rn "normalizeDtc" --include="*.ts" --include="*.tsx" .
```

Expected: Every caller pulls `.canonical` (or treats the return as `NormalizedDtc | null`). No old `(d): d is string` filters remain.

- [ ] **Step 5: Confirm spec coverage**

Open `docs/superpowers/specs/2026-05-17-knowledge-root-b-dtc-design.md`. Walk the "Files" section; every file listed should now show modifications matching the spec.

- [ ] **Step 6: Confirm**

No commit. Verification gate.

---

## Out of scope (deferred, log only)

- **One-shot cleanup of pre-existing non-canonical DTCs** — only relevant if real-world search misses surface a need.
- **AI paste-flow prompt update** to capture sub-codes from pasted text — prompt currently strips tails; flowing through the new normalizer means no regression, but we won't gain sub-code coverage from the AI flow until/unless usage shows demand.
- **Vehicle make/model normalization** — Root B (vehicle picker), separate root.
- **Symptom / system-code normalization** — different problem shape (free-text vs. enum), separate scope.
- **Sub-code-specific knowledge entries** (e.g. "this fix applies only to `-11`") — out of scope by design; if needed, that's body text, not library forks.

## Live-DB migration step (DO BEFORE MERGE)

After Task 10 passes and before opening the PR for merge:

1. Apply the migration to live Supabase via MCP `apply_migration`:
   - Migration path: `drizzle/migrations/0015_knowledge_dtc_subcodes.sql`
   - Surface the migration to Brandon for approval before applying (per the "no dangerous prod ops without per-op approval" rule).
2. Verify the column appears on the live `knowledge_items` table.
3. Note the migration's application in the PR body so Brandon knows it's done.

## Self-review notes (executor: read once before starting)

1. **The TDD loop is strict:** write test → run failing → write code → run passing → commit. Do NOT batch. One commit per task.
2. **Task 1 is atomic and intentionally larger** — it changes the signature of an exported function with 3 callers. Splitting would leave the build red between intermediate commits.
3. **The normalizer is the trust-critical layer** — do NOT compress its test list. Cover every shape: cleanup cases, sub-code cases, hard-reject cases.
4. **CSS colors in Task 9 are first-pass picks.** If `knowledge.css` uses CSS variables for warnings, prefer those over hex literals.
5. **The 5 form callsites in Task 6 are mechanically identical** — but read each form first; a few have additional state-management logic around DTCs (e.g. `markEdited`) that needs to keep working.
6. **`useDtcChips` hook's diff-based suffix capture is fragile** if the same chip value is added twice in quick succession. Real-world flow is one-at-a-time so this is acceptable; if testing reveals a regression, switch to a ref-based pending-suffix queue.
7. **Live DB migration is the LAST step before merge,** not during the build. Per "no dangerous prod ops" rule, surface it to Brandon for explicit approval.

## Done when

- All 10 tasks complete.
- Full test suite + typecheck + lint pass.
- Branch is `feat/knowledge-root-b-dtc-normalize` based off `origin/staging`.
- Live-DB migration applied to live Supabase (post-build, pre-merge).
- Ready to open a PR against `staging`.
