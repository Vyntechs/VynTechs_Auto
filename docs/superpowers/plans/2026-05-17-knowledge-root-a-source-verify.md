# Knowledge Root A — Source-verify Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add layered defense (grounding-required prompt + server-side substring verifier + min-paste guard) so the paste-to-knowledge flow can't fabricate field values or citations.

**Architecture:** Three layers. (Layer 2) Rewrite `CLASSIFY_PASTE_SYSTEM` so the parser is required to find verbatim grounding before filling any field. (Layer 3) New pure verifier `verifySourceSpans()` runs after the parser and either keeps, strips, or flags every populated field. UI changes a binary "AI / no-AI" badge to a tri-state `attribution: 'verified' | 'unverified' | 'none'` and surfaces a top-of-form note when fields were stripped. A min-paste guard short-circuits before the model is called.

**Tech Stack:** TypeScript, Next.js App Router, Anthropic SDK (Haiku model), Vitest, happy-dom for component tests.

**Spec:** `docs/superpowers/specs/2026-05-17-knowledge-root-a-source-verify-design.md`

---

## File structure

| File | Role | Action |
|---|---|---|
| `lib/knowledge/verify-source-spans.ts` | Pure verifier (Layer 3) | **Create** |
| `tests/unit/verify-source-spans.test.ts` | Verifier unit tests | **Create** |
| `lib/knowledge/classify-paste.ts` | Add min-paste guard + grounding-required prompt | Modify |
| `tests/unit/knowledge-classify-paste.test.ts` | Add guard + prompt tests | Modify |
| `app/api/knowledge/paste/route.ts` | Wire verifier + new statuses | Modify |
| `tests/unit/knowledge-paste-route.test.ts` | New scenarios | Modify |
| `components/knowledge/form-helpers.tsx` | `FieldGroup` attribution enum | Modify |
| `tests/unit/field-group.test.tsx` | Component test | **Create** |
| `components/knowledge/paste-sheet.tsx` | Update response type | Modify (trivial) |
| `app/(app)/knowledge/review-paste/review-form.tsx` | Top-of-form notes + new prop + copy | Modify |
| `app/(app)/knowledge/review-paste/page.tsx` | Page title copy | Modify (one-line) |
| `components/knowledge/knowledge.css` | Chip + notice styles | Modify (append) |

---

## Task 1: Pure verifier function

**Files:**
- Create: `lib/knowledge/verify-source-spans.ts`
- Create: `tests/unit/verify-source-spans.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/verify-source-spans.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { verifySourceSpans } from '@/lib/knowledge/verify-source-spans'

describe('verifySourceSpans', () => {
  it('keeps a field with a span that is a verbatim substring of the paste', () => {
    const r = verifySourceSpans(
      'P0420 cylinder 1 misfire on 2018 F-150',
      { title: 'cylinder 1 misfire' },
      { title: 'cylinder 1 misfire' },
    )
    expect(r.stripped).toEqual([])
    expect(r.unverified).toEqual([])
    expect(r.draft.title).toBe('cylinder 1 misfire')
    expect(r.sourceSpans.title).toBe('cylinder 1 misfire')
  })

  it('keeps a field whose span matches case-insensitively', () => {
    const r = verifySourceSpans(
      'TSB 18-2218 — Customer concern: harsh shift',
      { title: 'TSB 18-2218' },
      { title: 'tsb 18-2218' },
    )
    expect(r.draft.title).toBe('TSB 18-2218')
    expect(r.unverified).toEqual([])
    expect(r.stripped).toEqual([])
  })

  it('keeps a field whose span matches after whitespace collapse', () => {
    const r = verifySourceSpans(
      'cylinder 1   misfire',
      { title: 'misfire' },
      { title: 'cylinder 1 misfire' },
    )
    expect(r.stripped).toEqual([])
  })

  it('keeps a field whose span uses an em-dash where paste has a hyphen', () => {
    const r = verifySourceSpans(
      'F-150 3.5L EcoBoost',
      { title: 'F-150 EcoBoost' },
      { title: 'F—150 EcoBoost' },
    )
    expect(r.stripped).toEqual([])
    expect(r.sourceSpans.title).toBe('F—150 EcoBoost')
  })

  it('keeps a field whose span uses smart quotes where paste has straight', () => {
    const r = verifySourceSpans(
      `tech's note about misfire`,
      { title: 'misfire note' },
      { title: `tech’s note` },
    )
    expect(r.stripped).toEqual([])
  })

  it('strips a field whose span is NOT in the paste', () => {
    const r = verifySourceSpans(
      'P0420 misfire',
      { title: 'rough idle' },
      { title: 'engine runs rough at idle' },
    )
    expect(r.stripped).toEqual(['title'])
    expect(r.draft.title).toBeUndefined()
    expect(r.sourceSpans.title).toBeUndefined()
  })

  it('marks a populated field as unverified when its span is missing', () => {
    const r = verifySourceSpans(
      'P0420 misfire',
      { title: 'a title' },
      {},
    )
    expect(r.unverified).toEqual(['title'])
    expect(r.draft.title).toBe('a title')
  })

  it('treats an empty-string span the same as a missing span', () => {
    const r = verifySourceSpans(
      'P0420 misfire',
      { title: 'a title' },
      { title: '' },
    )
    expect(r.unverified).toEqual(['title'])
    expect(r.draft.title).toBe('a title')
  })

  it('handles a mixed payload: verified + stripped + unverified', () => {
    const r = verifySourceSpans(
      'P0420 cylinder 1 misfire on 2018 F-150',
      {
        title: 'cylinder 1 misfire',
        body: 'engine runs rough',
        dtcList: ['P0420'],
      },
      {
        title: 'cylinder 1 misfire',
        body: 'rough running engine',
        // dtcList missing → unverified
      },
    )
    expect(r.stripped).toEqual(['body'])
    expect(r.unverified).toEqual(['dtcList'])
    expect(r.draft.title).toBe('cylinder 1 misfire')
    expect(r.draft.body).toBeUndefined()
    expect(r.draft.dtcList).toEqual(['P0420'])
    expect(r.sourceSpans).toEqual({ title: 'cylinder 1 misfire' })
  })

  it('verifies dtcList array with a whole-list receipt', () => {
    const r = verifySourceSpans(
      'codes: P0420 and P0430',
      { dtcList: ['P0420', 'P0430'] },
      { dtcList: 'P0420 and P0430' },
    )
    expect(r.stripped).toEqual([])
    expect(r.unverified).toEqual([])
  })

  it('walks structuredData fields and verifies them by key', () => {
    const r = verifySourceSpans(
      'Complaint: harsh 1-2 shift. Cause: TCM software needs reflash.',
      {
        type: 'cause_fix',
        structuredData: {
          complaint: 'harsh 1-2 shift',
          cause: 'rough idle module', // fake
        },
      },
      {
        complaint: 'harsh 1-2 shift',
        cause: 'rough idle module reset', // span not in paste
      },
    )
    expect(r.stripped).toEqual(['cause'])
    expect(r.draft.structuredData?.complaint).toBe('harsh 1-2 shift')
    expect(r.draft.structuredData?.cause).toBeUndefined()
  })

  it('returns empty arrays when both draft and spans are empty', () => {
    const r = verifySourceSpans('anything', {}, {})
    expect(r.stripped).toEqual([])
    expect(r.unverified).toEqual([])
    expect(r.sourceSpans).toEqual({})
  })

  it('strips ALL populated fields when the paste is empty', () => {
    const r = verifySourceSpans(
      '',
      { title: 'Hallucinated title', body: 'Hallucinated body' },
      { title: 'Hallucinated title', body: 'Hallucinated body' },
    )
    expect(r.stripped.sort()).toEqual(['body', 'title'])
    expect(r.draft.title).toBeUndefined()
    expect(r.draft.body).toBeUndefined()
  })

  it('silently ignores orphan source-span keys (no matching draft field)', () => {
    const r = verifySourceSpans(
      'P0420 misfire',
      { title: 'P0420' },
      { title: 'P0420', nonexistent: 'P0420' },
    )
    expect(r.stripped).toEqual([])
    expect(r.unverified).toEqual([])
    expect(r.sourceSpans).toEqual({ title: 'P0420' })
  })

  it('does NOT verify vehicleScopes — passes them through untouched', () => {
    const r = verifySourceSpans(
      'P0420 misfire',
      {
        title: 'P0420',
        vehicleScopes: [
          { yearStart: 2018, yearEnd: 2020, make: 'Ford', model: 'F-150' },
        ],
      },
      { title: 'P0420' },
    )
    expect(r.stripped).toEqual([])
    expect(r.unverified).toEqual([])
    expect(r.draft.vehicleScopes).toEqual([
      { yearStart: 2018, yearEnd: 2020, make: 'Ford', model: 'F-150' },
    ])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test verify-source-spans -- --run`
Expected: All 14 tests FAIL (module not found).

- [ ] **Step 3: Create the verifier implementation**

Create `lib/knowledge/verify-source-spans.ts`:

```ts
import type { ClassifiedPasteResult } from '@/lib/knowledge/classify-paste'

export type VerifyResult = {
  draft: ClassifiedPasteResult['draft']
  sourceSpans: Record<string, string>
  stripped: string[]
  unverified: string[]
}

const TOP_LEVEL_VERIFIABLE = ['title', 'body', 'dtcList', 'systemCodes', 'symptoms'] as const

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[–—‐‑‒―]/g, '-')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

function fieldHasContent(value: unknown): boolean {
  if (value == null) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  return false
}

export function verifySourceSpans(
  paste: string,
  draft: ClassifiedPasteResult['draft'],
  sourceSpans: Record<string, string>,
): VerifyResult {
  const np = normalize(paste)
  const outDraft: ClassifiedPasteResult['draft'] = { ...draft }
  if (outDraft.structuredData) {
    outDraft.structuredData = { ...outDraft.structuredData }
  }
  const outSpans: Record<string, string> = {}
  const stripped: string[] = []
  const unverified: string[] = []

  type Loc = 'top' | 'structured'
  const fields: Array<{ loc: Loc; key: string }> = []
  for (const key of TOP_LEVEL_VERIFIABLE) {
    fields.push({ loc: 'top', key })
  }
  if (outDraft.structuredData) {
    for (const key of Object.keys(outDraft.structuredData)) {
      fields.push({ loc: 'structured', key })
    }
  }

  const getVal = (loc: Loc, key: string): unknown =>
    loc === 'top'
      ? (outDraft as Record<string, unknown>)[key]
      : (outDraft.structuredData as Record<string, unknown> | undefined)?.[key]

  const clearVal = (loc: Loc, key: string): void => {
    if (loc === 'top') {
      ;(outDraft as Record<string, unknown>)[key] = undefined
    } else if (outDraft.structuredData) {
      ;(outDraft.structuredData as Record<string, unknown>)[key] = undefined
    }
  }

  for (const { loc, key } of fields) {
    if (!fieldHasContent(getVal(loc, key))) continue
    const span = sourceSpans[key]
    if (!span || span.trim().length === 0) {
      unverified.push(key)
      continue
    }
    if (np.includes(normalize(span))) {
      outSpans[key] = span
    } else {
      clearVal(loc, key)
      stripped.push(key)
    }
  }

  return { draft: outDraft, sourceSpans: outSpans, stripped, unverified }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test verify-source-spans -- --run`
Expected: All 14 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/knowledge/verify-source-spans.ts tests/unit/verify-source-spans.test.ts
git commit -m "feat(knowledge): pure source-span verifier (root A layer 3)"
```

---

## Task 2: Min-paste-length guard

**Files:**
- Modify: `lib/knowledge/classify-paste.ts`
- Modify: `tests/unit/knowledge-classify-paste.test.ts`

- [ ] **Step 1: Read the existing classify-paste tests to learn the mock pattern**

Run: `head -60 tests/unit/knowledge-classify-paste.test.ts`

Expected: tests import `classifyPaste` and pass a fake `AnthropicLike` client.

- [ ] **Step 2: Add failing tests for the min-paste guard**

Append to `tests/unit/knowledge-classify-paste.test.ts` (inside the existing `describe` block):

```ts
  describe('min-paste guard', () => {
    const noopClient = {
      messages: { create: vi.fn() },
    } as unknown as Parameters<typeof classifyPaste>[1]

    it('returns paste_too_short for a paste below 30 chars', async () => {
      const r = await classifyPaste({ rawText: 'P0420 misfire' }, noopClient)
      expect(r.status).toBe('paste_too_short')
      expect(r.draft).toEqual({})
      expect(r.sourceSpans).toEqual({})
    })

    it('returns paste_too_short for a paste with fewer than 6 words', async () => {
      const r = await classifyPaste(
        { rawText: 'transmission control module software calibration' },
        noopClient,
      )
      expect(r.status).toBe('paste_too_short')
    })

    it('proceeds to call the model when both thresholds are met', async () => {
      const client = {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  status: 'parsed',
                  draft: { type: 'note', title: 'ok' },
                  sourceSpans: {},
                }),
              },
            ],
          }),
        },
      } as unknown as Parameters<typeof classifyPaste>[1]
      const r = await classifyPaste(
        { rawText: 'Customer concern: harsh shift on the F-150 EcoBoost.' },
        client,
      )
      expect(r.status).toBe('parsed')
      expect(client.messages.create).toHaveBeenCalledOnce()
    })

    it('does NOT call the model when below threshold', async () => {
      const create = vi.fn()
      const client = {
        messages: { create },
      } as unknown as Parameters<typeof classifyPaste>[1]
      await classifyPaste({ rawText: 'short' }, client)
      expect(create).not.toHaveBeenCalled()
    })
  })
```

If the test file does not import `vi`, add it to the existing vitest imports.

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test knowledge-classify-paste -- --run`
Expected: 4 new tests FAIL (status `paste_too_short` doesn't exist; existing tests still pass).

- [ ] **Step 4: Implement the guard**

In `lib/knowledge/classify-paste.ts`:

(a) Add the status to the union, near the top after the existing types:

Find:
```ts
export type ClassifiedPasteResult = {
  status: 'parsed' | 'failed'
```

Replace with:
```ts
export type ClassifiedPasteResult = {
  status: 'parsed' | 'failed' | 'paste_too_short'
```

(b) Add the exported constants below `SIMPLE_TYPES`:

```ts
export const MIN_PASTE_CHARS = 30
export const MIN_PASTE_WORDS = 6
```

(c) Add the short-circuit at the top of `classifyPaste`. Find:

```ts
  const trimmed = input.rawText.trim()
  if (trimmed.length === 0) {
    return { status: 'failed', draft: {}, sourceSpans: {} }
  }
```

Replace with:

```ts
  const trimmed = input.rawText.trim()
  if (trimmed.length === 0) {
    return { status: 'failed', draft: {}, sourceSpans: {} }
  }

  const wordCount = trimmed.split(/\s+/).filter(Boolean).length
  if (trimmed.length < MIN_PASTE_CHARS || wordCount < MIN_PASTE_WORDS) {
    return { status: 'paste_too_short', draft: {}, sourceSpans: {} }
  }
```

- [ ] **Step 5: Run tests to verify guard passes**

Run: `pnpm test knowledge-classify-paste -- --run`
Expected: All tests PASS (existing + 4 new).

- [ ] **Step 6: Commit**

```bash
git add lib/knowledge/classify-paste.ts tests/unit/knowledge-classify-paste.test.ts
git commit -m "feat(knowledge): min-paste-length guard short-circuits the parser"
```

---

## Task 3: Grounding-required prompt rewrite

**Files:**
- Modify: `lib/knowledge/classify-paste.ts`
- Modify: `tests/unit/knowledge-classify-paste.test.ts`

- [ ] **Step 1: Write a failing test for the grounding-rule presence**

Append to `tests/unit/knowledge-classify-paste.test.ts`:

```ts
  describe('grounding-required prompt', () => {
    it('CLASSIFY_PASTE_SYSTEM contains the GROUNDING RULE block', async () => {
      const { CLASSIFY_PASTE_SYSTEM } = await import('@/lib/knowledge/classify-paste')
      expect(CLASSIFY_PASTE_SYSTEM).toContain('GROUNDING RULE')
      expect(CLASSIFY_PASTE_SYSTEM).toContain('leave the field empty')
    })

    it('GROUNDING RULE appears BEFORE the ALLOWED TYPES section', async () => {
      const { CLASSIFY_PASTE_SYSTEM } = await import('@/lib/knowledge/classify-paste')
      const gIdx = CLASSIFY_PASTE_SYSTEM.indexOf('GROUNDING RULE')
      const tIdx = CLASSIFY_PASTE_SYSTEM.indexOf('ALLOWED TYPES')
      expect(gIdx).toBeGreaterThan(-1)
      expect(tIdx).toBeGreaterThan(-1)
      expect(gIdx).toBeLessThan(tIdx)
    })
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test knowledge-classify-paste -- --run`
Expected: 2 new tests FAIL (no GROUNDING RULE in prompt).

- [ ] **Step 3: Rewrite the prompt**

In `lib/knowledge/classify-paste.ts`, find:

```ts
export const CLASSIFY_PASTE_SYSTEM = `You convert an automotive shop owner's pasted reference text into a structured draft for a vehicle-knowledge entry. Output is a proposal the owner reviews and edits before saving.

ALLOWED TYPES (exactly one):
```

Replace with:

```ts
export const CLASSIFY_PASTE_SYSTEM = `You convert an automotive shop owner's pasted reference text into a structured draft for a vehicle-knowledge entry. Output is a proposal the owner reviews and edits before saving.

GROUNDING RULE — Before filling any field, locate the exact verbatim text in the paste that supports it. Copy that text into sourceSpans[fieldName]. If you cannot find verbatim text supporting a value, leave the field empty. Empty is correct; fabricated is wrong.

EXAMPLE (sparse paste):

Input: "P0420 — check downstream O2"

Output:
{
  "status": "parsed",
  "draft": {
    "type": "note",
    "title": "P0420 — check downstream O2",
    "body": "P0420 — check downstream O2",
    "dtcList": ["P0420"]
  },
  "sourceSpans": {
    "title": "P0420 — check downstream O2",
    "body": "P0420 — check downstream O2",
    "dtcList": "P0420"
  }
}

(No invented complaint, cause, vehicle scope, or symptoms — the paste does not contain verbatim text for them, so they are omitted.)

ALLOWED TYPES (exactly one):
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test knowledge-classify-paste -- --run`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/knowledge/classify-paste.ts tests/unit/knowledge-classify-paste.test.ts
git commit -m "feat(knowledge): grounding-required system prompt (root A layer 2)"
```

---

## Task 4: Wire verifier into the paste route

**Files:**
- Modify: `app/api/knowledge/paste/route.ts`
- Modify: `tests/unit/knowledge-paste-route.test.ts`
- Modify: `lib/knowledge/classify-paste.ts` (add response type export)

- [ ] **Step 1: Add the response type to classify-paste.ts**

Append to `lib/knowledge/classify-paste.ts`:

```ts
export type PasteRouteResponse = {
  status: 'parsed' | 'failed' | 'paste_too_short'
  draft: ClassifiedPasteResult['draft']
  sourceSpans: Record<string, string>
  stripped: string[]
  unverified: string[]
  llmNotes?: string
  message?: string
}
```

- [ ] **Step 2: Write failing route tests**

Append to `tests/unit/knowledge-paste-route.test.ts` (inside the existing describe):

```ts
  it('attaches verifier output: stripped/unverified arrays on parsed status', async () => {
    await mockUser(OWNER_USER_ID)
    const { classifyPaste } = await import('@/lib/knowledge/classify-paste')
    vi.mocked(classifyPaste).mockResolvedValue({
      status: 'parsed',
      draft: {
        type: 'note',
        title: 'P0420 check downstream',
        body: 'random fabricated body text',
      },
      sourceSpans: {
        title: 'P0420 check downstream',
        body: 'not actually in the paste',
        // no span for any other field
      },
    })
    const { POST } = await import('@/app/api/knowledge/paste/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/paste', {
        method: 'POST',
        body: JSON.stringify({ rawText: 'P0420 check downstream' }),
      }),
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      status: string
      draft: { title?: string; body?: string }
      sourceSpans: Record<string, string>
      stripped: string[]
      unverified: string[]
    }
    expect(json.status).toBe('parsed')
    expect(json.stripped).toEqual(['body'])
    expect(json.unverified).toEqual([])
    expect(json.draft.title).toBe('P0420 check downstream')
    expect(json.draft.body).toBeUndefined()
    expect(json.sourceSpans).toEqual({ title: 'P0420 check downstream' })
  })

  it('flags fields with no span as unverified', async () => {
    await mockUser(OWNER_USER_ID)
    const { classifyPaste } = await import('@/lib/knowledge/classify-paste')
    vi.mocked(classifyPaste).mockResolvedValue({
      status: 'parsed',
      draft: { type: 'note', title: 'synthesized title', body: 'matched' },
      sourceSpans: { body: 'matched' },
    })
    const { POST } = await import('@/app/api/knowledge/paste/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/paste', {
        method: 'POST',
        body: JSON.stringify({ rawText: 'this paste contains matched text' }),
      }),
    )
    const json = (await res.json()) as { stripped: string[]; unverified: string[] }
    expect(json.unverified).toEqual(['title'])
    expect(json.stripped).toEqual([])
  })

  it('returns paste_too_short status with consistent empty fields', async () => {
    await mockUser(OWNER_USER_ID)
    const { classifyPaste } = await import('@/lib/knowledge/classify-paste')
    vi.mocked(classifyPaste).mockResolvedValue({
      status: 'paste_too_short',
      draft: {},
      sourceSpans: {},
    })
    const { POST } = await import('@/app/api/knowledge/paste/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/paste', {
        method: 'POST',
        body: JSON.stringify({ rawText: 'short' }),
      }),
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      status: string
      message: string
      draft: Record<string, unknown>
      sourceSpans: Record<string, string>
      stripped: string[]
      unverified: string[]
    }
    expect(json.status).toBe('paste_too_short')
    expect(json.message).toContain('Paste too short')
    expect(json.draft).toEqual({})
    expect(json.sourceSpans).toEqual({})
    expect(json.stripped).toEqual([])
    expect(json.unverified).toEqual([])
  })
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test knowledge-paste-route -- --run`
Expected: 3 new tests FAIL.

- [ ] **Step 4: Update the route**

Replace the body of `POST` in `app/api/knowledge/paste/route.ts`. The full file becomes:

```ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCurator } from '@/lib/curator/route-helpers'
import { classifyPaste } from '@/lib/knowledge/classify-paste'
import { verifySourceSpans } from '@/lib/knowledge/verify-source-spans'

const PasteSchema = z.object({
  rawText: z.string().min(1).max(20_000),
  scopeHint: z.string().max(500).optional(),
})

// POST /api/knowledge/paste — owner-only AI assist for simple-type knowledge
// entries. Returns a structured proposal the owner reviews and edits before
// hitting /api/knowledge/save. Output passes through verifySourceSpans —
// fields whose receipts can't be ground-truthed against the paste are stripped.
export async function POST(req: Request) {
  const auth = await requireCurator()
  if (auth.kind === 'forbidden') return auth.response

  let json: unknown
  try {
    json = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const parsed = PasteSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_input', issues: parsed.error.issues },
      { status: 422 },
    )
  }

  try {
    const result = await classifyPaste(parsed.data)

    if (result.status === 'paste_too_short') {
      return NextResponse.json({
        status: 'paste_too_short',
        draft: {},
        sourceSpans: {},
        stripped: [],
        unverified: [],
        message: 'Paste too short to assist — fill the form manually.',
      })
    }

    if (result.status === 'failed') {
      return NextResponse.json(result)
    }

    const verified = verifySourceSpans(parsed.data.rawText, result.draft, result.sourceSpans)
    return NextResponse.json({
      status: 'parsed',
      draft: verified.draft,
      sourceSpans: verified.sourceSpans,
      stripped: verified.stripped,
      unverified: verified.unverified,
      llmNotes: result.llmNotes,
    })
  } catch (err) {
    return NextResponse.json(
      {
        error: 'classifier_failed',
        message: err instanceof Error ? err.message : 'unknown classifier error',
      },
      { status: 502 },
    )
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test knowledge-paste-route -- --run`
Expected: All tests PASS (existing + 3 new).

- [ ] **Step 6: Commit**

```bash
git add app/api/knowledge/paste/route.ts tests/unit/knowledge-paste-route.test.ts lib/knowledge/classify-paste.ts
git commit -m "feat(knowledge): wire verifier + new statuses into paste route"
```

---

## Task 5: paste-sheet response type update

**Files:**
- Modify: `components/knowledge/paste-sheet.tsx`

This is a trivial cast update; no new behavior. Paste-sheet still navigates regardless of status. The review form handles the new statuses.

- [ ] **Step 1: Update the response cast**

In `components/knowledge/paste-sheet.tsx`, find:

```ts
import type { ClassifiedPasteResult } from '@/lib/knowledge/classify-paste'
```

Replace with:

```ts
import type { PasteRouteResponse } from '@/lib/knowledge/classify-paste'
```

Find:

```ts
      const proposal = (await res.json()) as ClassifiedPasteResult
```

Replace with:

```ts
      const proposal = (await res.json()) as PasteRouteResponse
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: No new type errors in paste-sheet.tsx.

- [ ] **Step 3: Commit**

```bash
git add components/knowledge/paste-sheet.tsx
git commit -m "refactor(knowledge): paste-sheet uses new PasteRouteResponse type"
```

---

## Task 6: FieldGroup attribution enum + component test

**Files:**
- Modify: `components/knowledge/form-helpers.tsx`
- Create: `tests/unit/field-group.test.tsx`

- [ ] **Step 1: Write the failing component test**

Create `tests/unit/field-group.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FieldGroup } from '@/components/knowledge/form-helpers'

describe('FieldGroup', () => {
  it('renders no badge and no source for attribution="none"', () => {
    render(
      <FieldGroup label="Title" attribution="none">
        <input />
      </FieldGroup>,
    )
    expect(screen.queryByText(/VERIFY/i)).toBeNull()
    expect(screen.queryByText(/from your paste/i)).toBeNull()
  })

  it('renders the source quote (no AI chip) when attribution="verified"', () => {
    render(
      <FieldGroup label="Title" attribution="verified" source="quoted text">
        <input />
      </FieldGroup>,
    )
    expect(screen.queryByText('AI')).toBeNull()
    expect(screen.getByText(/from your paste/i)).toBeInTheDocument()
    expect(screen.getByText('quoted text')).toBeInTheDocument()
  })

  it('renders the ⚠ VERIFY chip when attribution="unverified"', () => {
    render(
      <FieldGroup label="Title" attribution="unverified">
        <input />
      </FieldGroup>,
    )
    const chip = screen.getByLabelText('needs verification')
    expect(chip).toBeInTheDocument()
    expect(chip.textContent).toMatch(/VERIFY/i)
    expect(screen.queryByText(/from your paste/i)).toBeNull()
  })

  it('falls back to unverified rendering when attribution=verified but source is empty', () => {
    render(
      <FieldGroup label="Title" attribution="verified" source="">
        <input />
      </FieldGroup>,
    )
    expect(screen.queryByText(/from your paste/i)).toBeNull()
    expect(screen.getByLabelText('needs verification')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Check if @testing-library/react is installed**

Run: `grep "testing-library/react" package.json`
Expected: A version line exists. If NOT, install:

```bash
pnpm add -D @testing-library/react
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test field-group -- --run`
Expected: All 4 tests FAIL (prop `attribution` not accepted).

- [ ] **Step 4: Update FieldGroup**

In `components/knowledge/form-helpers.tsx`, find:

```tsx
export function FieldGroup({
  label,
  aiAttributed,
  source,
  children,
}: {
  label: string
  aiAttributed: boolean
  source?: string
  children: React.ReactNode
}) {
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
```

Replace with:

```tsx
export type FieldAttribution = 'verified' | 'unverified' | 'none'

export function FieldGroup({
  label,
  attribution = 'none',
  source,
  children,
}: {
  label: string
  attribution?: FieldAttribution
  source?: string
  children: React.ReactNode
}) {
  const effectiveAttribution: FieldAttribution =
    attribution === 'verified' && !source ? 'unverified' : attribution

  return (
    <div
      className={
        effectiveAttribution === 'verified'
          ? 'vk-fg vk-fg--verified'
          : effectiveAttribution === 'unverified'
            ? 'vk-fg vk-fg--unverified'
            : 'vk-fg'
      }
    >
      <div className="vk-fg__head">
        <label className="vk-fg__label">{label}</label>
        {effectiveAttribution === 'unverified' && (
          <span className="vk-fg__chip vk-fg__chip--verify" aria-label="needs verification">
            ⚠ VERIFY
          </span>
        )}
      </div>
      <div className="vk-fg__body">{children}</div>
      {effectiveAttribution === 'verified' && source && (
        <div className="vk-fg__source">
          <span className="vk-fg__source-prefix">From your paste:</span>
          <mark>{source}</mark>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test field-group -- --run`
Expected: All 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add components/knowledge/form-helpers.tsx tests/unit/field-group.test.tsx
git commit -m "refactor(knowledge): FieldGroup attribution enum, drop AI badge"
```

---

## Task 7: Review form — new prop, top-of-form notes, copy updates

**Files:**
- Modify: `app/(app)/knowledge/review-paste/review-form.tsx`
- Modify: `app/(app)/knowledge/review-paste/page.tsx`

- [ ] **Step 1: Update the page title**

In `app/(app)/knowledge/review-paste/page.tsx`, find:

```tsx
          <h1 className="vk-page__title">Review AI sort</h1>
```

Replace with:

```tsx
          <h1 className="vk-page__title">Review your paste</h1>
```

- [ ] **Step 2: Rewrite the review-form props + render**

In `app/(app)/knowledge/review-paste/review-form.tsx`:

(a) Add the imports near the existing ones:

Find:
```tsx
import type { ClassifiedPasteResult } from '@/lib/knowledge/classify-paste'
```

Replace with:
```tsx
import type { ClassifiedPasteResult, PasteRouteResponse } from '@/lib/knowledge/classify-paste'
```

(b) Replace the `Stored` type:

Find:
```tsx
type Stored = {
  proposal: ClassifiedPasteResult
  rawText: string
  scopeHint: string
}
```

Replace with:
```tsx
type Stored = {
  proposal: PasteRouteResponse
  rawText: string
  scopeHint: string
}
```

(c) Add a label map under the `SIMPLE_TYPES` const:

Find:
```tsx
const SIMPLE_TYPES = ['cause_fix', 'reference_doc', 'bulletin', 'note'] as const
type SimpleType = (typeof SIMPLE_TYPES)[number]
```

Replace with:
```tsx
const SIMPLE_TYPES = ['cause_fix', 'reference_doc', 'bulletin', 'note'] as const
type SimpleType = (typeof SIMPLE_TYPES)[number]

const FIELD_LABELS: Record<string, string> = {
  type: 'Type',
  title: 'Title',
  body: 'Body',
  complaint: 'Complaint',
  cause: 'Cause',
  correction: 'Correction',
  first_check: 'First check',
  source: 'Source',
  bulletin_id: 'Bulletin ID',
  summary: 'Summary',
  link: 'Link',
  dtcList: 'DTCs',
  systemCodes: 'System codes',
  symptoms: 'Symptoms',
}

function labelFor(field: string): string {
  return FIELD_LABELS[field] ?? field
}
```

(d) Add `unverified`/`stripped`/`tooShort` derived state. Find the `sources` useMemo:

```tsx
  const sources = useMemo(() => stored?.proposal.sourceSpans ?? {}, [stored])
```

Replace with:

```tsx
  const sources = useMemo(() => stored?.proposal.sourceSpans ?? {}, [stored])
  const unverified = useMemo(
    () => new Set(stored?.proposal.unverified ?? []),
    [stored],
  )
  const stripped = useMemo(() => stored?.proposal.stripped ?? [], [stored])
  const tooShort = stored?.proposal.status === 'paste_too_short'

  function attributionFor(field: string): 'verified' | 'unverified' | 'none' {
    if (editedFields.has(field)) return 'none'
    if (unverified.has(field)) return 'unverified'
    if (sources[field]) return 'verified'
    return 'none'
  }
```

(d2) Pre-fill `body` with `rawText` when paste_too_short. Find:

```tsx
      setTitle(d.title ?? '')
      setBody(d.body ?? '')
```

Replace with:

```tsx
      setTitle(d.title ?? '')
      const tooShortInit = parsed.proposal.status === 'paste_too_short'
      setBody(d.body ?? (tooShortInit ? parsed.rawText : ''))
```

(e) Update the discard confirm copy. Find:

```tsx
    if (!confirm('Throw away the paste and the AI sort?')) return
```

Replace with:

```tsx
    if (!confirm('Throw away this paste?')) return
```

(f) Update every `<FieldGroup>` callsite to use `attribution` instead of `aiAttributed`. There are 10 callsites in this file. Each has the pattern:

```tsx
        aiAttributed={!editedFields.has('X') && !!sources.X}
```

Replace with:

```tsx
        attribution={attributionFor('X')}
```

The full mapping (note: vehicle scope key in `attributionFor()` differs from its `editedFields` key):

| Callsite line region (today) | New prop |
|---|---|
| `aiAttributed={!editedFields.has('type') && !!sources.type}` | `attribution={attributionFor('type')}` |
| `aiAttributed={!editedFields.has('title') && !!sources.title}` | `attribution={attributionFor('title')}` |
| `aiAttributed={!editedFields.has('body') && !!sources.body}` | `attribution={attributionFor('body')}` |
| `aiAttributed={!editedFields.has(k) && !!sources[k]}` (cause_fix loop) | `attribution={attributionFor(k)}` |
| `aiAttributed={!editedFields.has(k) && !!sources[k]}` (bulletin loop) | `attribution={attributionFor(k)}` |
| `aiAttributed={!editedFields.has('dtcList') && !!sources.dtcList}` | `attribution={attributionFor('dtcList')}` |
| `aiAttributed={!editedFields.has('systemCodes') && !!sources.systemCodes}` | `attribution={attributionFor('systemCodes')}` |
| `aiAttributed={!editedFields.has('symptoms') && !!sources.symptoms}` | `attribution={attributionFor('symptoms')}` |
| `aiAttributed={!editedFields.has('scopes') && scopes.length > 0}` (vehicle scope) | `attribution="none"` (scopes are not receipt-verified — see Task 1 spec) |

For the vehicle-scope `<FieldGroup>` specifically, replace the prop with `attribution="none"` — scopes don't receive receipts in this PR.

(g) Add the top-of-form notice block. In the `return` JSX, find:

```tsx
    <form
      className="vk-form"
      onSubmit={(e) => {
        e.preventDefault()
        handleSave()
      }}
    >
      <FieldGroup
        label="Type"
```

Insert a notice block BEFORE the `<FieldGroup label="Type" ...>`:

```tsx
    <form
      className="vk-form"
      onSubmit={(e) => {
        e.preventDefault()
        handleSave()
      }}
    >
      {tooShort && (
        <div className="vk-fg__notice">
          Paste too short to assist — fill the form manually.
        </div>
      )}
      {!tooShort && stripped.length > 0 && (
        <div className="vk-fg__notice">
          Couldn&apos;t find these in your paste — fill them yourself:{' '}
          {stripped.map(labelFor).join(', ')}.
        </div>
      )}
      <FieldGroup
        label="Type"
```

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: No new type errors. (May surface that `FieldGroup` no longer accepts `aiAttributed` — this is intended; all sites updated.)

- [ ] **Step 4: Run the existing knowledge-paste-flow tests**

Run: `pnpm test knowledge-paste -- --run`
Expected: All pass — these tests focus on backend, but if any happen to render review-form, they may break. Fix them inline to use the new prop API if so.

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/knowledge/review-paste/page.tsx app/\(app\)/knowledge/review-paste/review-form.tsx
git commit -m "feat(knowledge): review-form surfaces verified/unverified/stripped/too-short states"
```

---

## Task 8: CSS for ⚠ VERIFY chip + top-of-form notice

**Files:**
- Modify: `components/knowledge/knowledge.css`

- [ ] **Step 1: Append new styles**

Append to `components/knowledge/knowledge.css`:

```css
/* Root A — ⚠ VERIFY chip + top-of-form notice
   (replaces the AI-attributed badge with a tri-state field attribution) */

.vk-fg--verified {
  /* attribution: verified — the highlighted source quote IS the affordance */
}

.vk-fg--unverified {
  /* attribution: unverified — eye-catching amber border so the chip lands */
  border-left: 3px solid #f59e0b;
  padding-left: 12px;
}

.vk-fg__chip {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  padding: 2px 8px;
  border-radius: 3px;
  margin-left: 8px;
  text-transform: uppercase;
}

.vk-fg__chip--verify {
  background: #fef3c7;
  color: #92400e;
  border: 1px solid #fbbf24;
}

.vk-fg__notice {
  background: #fef3c7;
  color: #78350f;
  border: 1px solid #fbbf24;
  border-radius: 6px;
  padding: 12px 16px;
  margin-bottom: 16px;
  font-size: 14px;
  line-height: 1.4;
}

@media (max-width: 414px) {
  .vk-fg__notice {
    padding: 10px 12px;
    font-size: 13px;
  }
  .vk-fg__chip {
    margin-left: 6px;
  }
}
```

- [ ] **Step 2: Visual sanity check (manual)**

Run: `pnpm dev`

Visit `/knowledge`, open the paste sheet, paste any text (even short, to exercise the too-short notice), and verify:
- ⚠ VERIFY chip is readable on desktop and at 375px viewport.
- Top-of-form notice (amber background) renders above the form fields.

Stop the dev server once verified.

- [ ] **Step 3: Commit**

```bash
git add components/knowledge/knowledge.css
git commit -m "feat(knowledge): styles for ⚠ VERIFY chip and top-of-form notice"
```

---

## Task 9: Final verification pass

**Files:** none modified. All quality gates.

- [ ] **Step 1: Full typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: Zero errors.

- [ ] **Step 2: Full lint**

Run: `pnpm lint`
Expected: Zero errors. (Warnings okay if they predate this PR.)

- [ ] **Step 3: Full test suite**

Run: `pnpm test -- --run`
Expected: All tests pass. If any tests using `aiAttributed` prop on `FieldGroup` exist outside the ones already touched, update them to use `attribution`.

If the Vitest pool flakes on cold cache (PGlite-closed errors), re-run once:

Run: `pnpm test -- --run`

- [ ] **Step 4: Verify no "AI" mentions remain in the paste flow's user-facing surfaces**

Run:
```bash
grep -n "AI " components/knowledge/paste-sheet.tsx components/knowledge/form-helpers.tsx app/\(app\)/knowledge/review-paste/page.tsx app/\(app\)/knowledge/review-paste/review-form.tsx
```

Expected: No matches (other than possible "AnthropicLike" or other non-user-facing identifiers, which is fine).

- [ ] **Step 5: Confirm spec coverage**

Open `docs/superpowers/specs/2026-05-17-knowledge-root-a-source-verify-design.md`. Walk the "Files" section; every file listed should now show modifications matching the spec.

- [ ] **Step 6: Confirm**

No commit on this step — it's a verification gate. If everything passes, proceed to opening the PR.

---

## Out of scope (deferred, log only)

- **Layer 1 — templated regex extraction** for TSB IDs / years. Wait for real-world leak-through rates.
- **Per-item receipts for `dtcList`/`systemCodes`/`symptoms`.** Today the whole array shares one receipt; overlaps with Root B-DTC normalization.
- **`vehicleScopes` per-row receipts.** Pass-through in this PR.
- **AI-language cleanup outside the paste flow** (e.g., `components/knowledge/empty-state.tsx`, `components/knowledge/add-picker.tsx`). Separate PR.
- **"Diff view of what was stripped"** beyond a field-name list. Defer until Brandon sees the notice in real use.

## Self-review notes (executor: read once before starting)

1. The TDD loop is strict: write test → run failing → write code → run passing → commit. Do NOT batch.
2. After every task's "Commit" step, verify with `git log --oneline -1` that the commit was created.
3. The verifier is the trust-critical layer — do NOT compress its test list. All 14 cases are load-bearing.
4. CSS color choices in Task 8 are first-pass picks. If the existing knowledge.css uses CSS variables for warning colors, prefer those over hex literals.
5. The `vehicleScopes` field is intentionally not verified in this PR — do not add a receipt check for it.
6. The grounding-rule worked-example in the prompt uses an em-dash (—). If the model echoes em-dashes back vs hyphens, the normalizer in Task 1 handles that.

## Done when

- All 9 tasks complete.
- Full test suite + typecheck + lint pass.
- Branch is `feat/knowledge-root-a-source-verify` based off `origin/staging`.
- Ready to push and open a PR against `staging`.
