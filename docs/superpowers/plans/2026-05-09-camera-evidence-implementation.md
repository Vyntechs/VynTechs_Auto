# Camera evidence — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the AI's confidence on a `proposedAction` falls below the calibrated gating threshold, surface an interactive gap-closer at the Decline-or-Defer screen — `[ Yes ] [ No ]` for tech-attestable confirms, or a one-tap camera button for photos of the source — instead of a free-text `whatWouldClose` string the tech can't act on.

**Architecture:** Extend `whatWouldClose` from `string` to `string | { kind: 'confirm' | 'photo', ... }` end-to-end (model prompt → parser → gate decision → page → live wrapper → presentational screen). Add a new `extractGenericPhoto` to the vision module so the inert `photo` artifact kind becomes a real read. New "hero ask" card renders above the existing 3-spoke compass on the gating screen for the structured shapes; legacy string `whatWouldClose` falls through to today's behavior.

**Tech Stack:** Next.js 16 App Router, Drizzle, Supabase, Anthropic SDK 0.92 (Claude Sonnet 4.6), Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-05-09-camera-evidence-design.md`
**Branch:** `staging/camera-vision` (off `origin/main`). Brandon promotes to main; agent does not push to main.

---

## File map

**Modify:**
- `lib/ai/prompts.ts` — extend `TREE_ENGINE_SYSTEM` with structured `whatWouldClose` rule; add `GENERIC_PHOTO_VISION_SYSTEM`
- `lib/ai/tree-engine.ts` — extend `ProposedAction` type; validate structured `whatWouldClose` in `parseTreeJson`
- `lib/ai/vision.ts` — add `extractGenericPhoto`
- `lib/ai/extraction-worker.ts` — replace inert `photo` case with `extractGenericPhoto` call sourcing `extractFor` from session state
- `lib/ai/artifact-kinds.ts` — add `'photo'` to `HIGH_SIGNAL_KINDS`
- `lib/gating/gap-handler.ts` — widen `GateDecision.whatWouldClose` to `string | WhatWouldClose`
- `app/(app)/sessions/[id]/decline/page.tsx` — pass-through type widening
- `components/screens/decline-or-defer.tsx` — add optional `confirmAsk` / `photoAsk` props + hero card render
- `components/screens/decline-or-defer-live.tsx` — detect structured `whatWouldClose`, wire hero card to advance/capture endpoints

**Test (modify or extend):**
- `tests/unit/tree-engine.test.ts` — parser test cases for new shapes + legacy string + invalid shapes
- `tests/unit/vision.test.ts` — `extractGenericPhoto` happy / unreadable / MIME gate
- `tests/unit/extraction-worker.test.ts` — replace `photo` describe-first stub test with real-extraction tests
- `tests/unit/decline-or-defer-screen.test.tsx` — hero ask render + interaction wiring

---

## Task 1: Extend `whatWouldClose` to a structured type and update the parser

**Files:**
- Modify: `lib/ai/tree-engine.ts:18-24` (ProposedAction type), `lib/ai/tree-engine.ts:196-236` (parseTreeJson)
- Test: `tests/unit/tree-engine.test.ts`

- [ ] **Step 1: Add new failing parser tests**

Append to `tests/unit/tree-engine.test.ts`:

```typescript
describe('parseTreeJson — structured whatWouldClose', () => {
  function makeTree(proposedAction: unknown) {
    return JSON.stringify({
      nodes: [{ id: 'n1', label: 'Step', status: 'active' }],
      currentNodeId: 'n1',
      message: 'm',
      proposedAction,
    })
  }

  it('accepts whatWouldClose as a confirm object', () => {
    const result = parseTreeJson(
      makeTree({
        description: 'back-probe pin 4',
        confidence: 0.7,
        confidenceGap: 'unsure pin layout',
        whatWouldClose: { kind: 'confirm', prompt: 'reseat clean? yes / no?' },
      }),
    )
    expect(result.proposedAction?.whatWouldClose).toEqual({
      kind: 'confirm',
      prompt: 'reseat clean? yes / no?',
    })
  })

  it('accepts whatWouldClose as a photo object', () => {
    const result = parseTreeJson(
      makeTree({
        description: 'back-probe pin 4',
        confidence: 0.7,
        confidenceGap: 'unsure pin layout',
        whatWouldClose: {
          kind: 'photo',
          prompt: 'snap the C171 pinout',
          extractFor: 'full pinout for C171',
        },
      }),
    )
    expect(result.proposedAction?.whatWouldClose).toEqual({
      kind: 'photo',
      prompt: 'snap the C171 pinout',
      extractFor: 'full pinout for C171',
    })
  })

  it('accepts whatWouldClose as a legacy string (back-compat)', () => {
    const result = parseTreeJson(
      makeTree({
        description: 'back-probe pin 4',
        confidence: 0.7,
        confidenceGap: 'unsure pin layout',
        whatWouldClose: 'Quote the IPC supply spec from the FSM.',
      }),
    )
    expect(result.proposedAction?.whatWouldClose).toBe(
      'Quote the IPC supply spec from the FSM.',
    )
  })

  it('rejects photo whatWouldClose missing extractFor', () => {
    expect(() =>
      parseTreeJson(
        makeTree({
          description: 'd',
          confidence: 0.7,
          whatWouldClose: { kind: 'photo', prompt: 'snap something' },
        }),
      ),
    ).toThrow(/extractFor/)
  })

  it('rejects whatWouldClose with unknown kind', () => {
    expect(() =>
      parseTreeJson(
        makeTree({
          description: 'd',
          confidence: 0.7,
          whatWouldClose: { kind: 'somethingElse', prompt: 'p' },
        }),
      ),
    ).toThrow(/kind/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/tree-engine.test.ts -t "structured whatWouldClose"`
Expected: 5 tests fail. Reasons will vary — likely missing validation throws and possible type errors. We are about to make all 5 pass.

- [ ] **Step 3: Extend the `ProposedAction` type and add a `WhatWouldClose` union**

Replace `lib/ai/tree-engine.ts:18-24` (the existing `ProposedAction` block) with:

```typescript
export type WhatWouldClose =
  | { kind: 'confirm'; prompt: string }
  | { kind: 'photo'; prompt: string; extractFor: string }

export type ProposedAction = {
  description: string
  confidence: number
  expectedSignal?: string
  confidenceGap?: string
  whatWouldClose?: string | WhatWouldClose
}
```

- [ ] **Step 4: Validate `whatWouldClose` shape in `parseTreeJson`**

Edit `lib/ai/tree-engine.ts` — at the end of `parseTreeJson` (just before `return parsed as TreeState` on the existing line ~235), insert:

```typescript
  const proposedAction = (parsed as { proposedAction?: { whatWouldClose?: unknown } })
    .proposedAction
  const wwc = proposedAction?.whatWouldClose
  if (wwc !== undefined && typeof wwc !== 'string') {
    if (typeof wwc !== 'object' || wwc === null) {
      throw new Error('invalid whatWouldClose: must be string or object')
    }
    const obj = wwc as { kind?: unknown; prompt?: unknown; extractFor?: unknown }
    if (typeof obj.prompt !== 'string') {
      throw new Error('invalid whatWouldClose: prompt must be a string')
    }
    if (obj.kind !== 'confirm' && obj.kind !== 'photo') {
      throw new Error(`invalid whatWouldClose: unknown kind "${String(obj.kind)}"`)
    }
    if (obj.kind === 'photo' && typeof obj.extractFor !== 'string') {
      throw new Error('invalid whatWouldClose: photo kind requires extractFor')
    }
  }
```

- [ ] **Step 5: Run the new tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/tree-engine.test.ts -t "structured whatWouldClose"`
Expected: all 5 pass.

- [ ] **Step 6: Run the full tree-engine test file to verify no regressions**

Run: `pnpm exec vitest run tests/unit/tree-engine.test.ts`
Expected: all tests pass (existing + new 5).

- [ ] **Step 7: Commit**

```bash
git add lib/ai/tree-engine.ts tests/unit/tree-engine.test.ts
git commit -m "feat(tree-engine): structured whatWouldClose (confirm | photo) with parser validation"
```

---

## Task 2: Update `TREE_ENGINE_SYSTEM` prompt with the structured rule

**Files:**
- Modify: `lib/ai/prompts.ts:11-14` (the existing `whatWouldClose` paragraph in the `ProposedAction` type), and the WHEN-confidence-below-0.95 paragraph
- Test: no new test (system prompt is text); covered indirectly by Task 1's parser tests

- [ ] **Step 1: Replace the inline `ProposedAction` type doc**

In `lib/ai/prompts.ts`, locate the existing `ProposedAction` TS type block inside `TREE_ENGINE_SYSTEM` (currently around lines 7-14). Replace the `whatWouldClose?: string` line with a structured union:

```
type WhatWouldClose =
  | { kind: "confirm"; prompt: string }
  | { kind: "photo"; prompt: string; extractFor: string }

type ProposedAction = {
  description: string
  confidence: number
  expectedSignal?: string
  confidenceGap?: string
  whatWouldClose?: WhatWouldClose
}
```

(Drop the prior comment lines that described `whatWouldClose` as a free-text instruction; the new rule replaces it.)

- [ ] **Step 2: Replace the "WHEN confidence < 0.95" paragraph with the decision rubric**

Locate the existing paragraph that begins `WHEN your proposedAction.confidence is below 0.95, you MUST ALSO populate "confidenceGap"...`. Replace the entire paragraph with the verbatim rule from the spec:

```
WHEN proposedAction.confidence is below 0.95, you MUST populate:
  - confidenceGap: one sentence naming the specific uncertainty.
  - whatWouldClose: a confirm OR photo ask.

Default to confirm. The tech is a trained diagnostician; their attestation
is sufficient for anything they can verify in a sentence. Escalate to photo
ONLY when (a) the gap is closed by data the tech cannot easily attest to
in words AND (b) a photo would let YOU extract that data directly.

  Confirm: "Coolant in the reservoir milky / cloudy — yes / no?"
  Photo:   "Snap the pinout page from your service info for connector C171
            — I'll grab all pins at once." (extractFor: "full pinout for C171")

NEVER ask for a photo of something the tech can verify with eyes and hands
and report in one sentence (latched, chafed, milky, belt routing, etc.) —
those are confirms.

When a photo IS warranted, request the BROADEST useful frame, never the
narrow piece. extractFor is a one-line, specific instruction to the vision
extractor: "full pinout for C171" beats "pin numbers".
```

- [ ] **Step 3: Run the full test suite**

Run: `pnpm test`
Expected: green. The prompt is text; no test asserts its content directly. Existing prompt-using tests mock the model anyway.

- [ ] **Step 4: Commit**

```bash
git add lib/ai/prompts.ts
git commit -m "feat(prompts): tree-engine emits structured whatWouldClose (confirm vs photo decision rule)"
```

---

## Task 3: Widen `GateDecision.whatWouldClose` to accept the structured shape

**Files:**
- Modify: `lib/gating/gap-handler.ts:8-18` (`GateDecision` type)
- Test: any existing gating tests still pass; no new test needed (pass-through)

- [ ] **Step 1: Update the `GateDecision` type**

Replace `lib/gating/gap-handler.ts:17` (the `whatWouldClose?: string` line) with:

```typescript
  whatWouldClose?: string | import('@/lib/ai/tree-engine').WhatWouldClose
```

- [ ] **Step 2: Run the full test suite + type check**

Run: `pnpm test && pnpm exec tsc --noEmit`
Expected: green. The gating function already passes `input.action.whatWouldClose` through unchanged (line 49) — the widening is a no-op at runtime.

- [ ] **Step 3: Commit**

```bash
git add lib/gating/gap-handler.ts
git commit -m "feat(gating): widen GateDecision.whatWouldClose to accept structured shape"
```

---

## Task 4: Add `extractGenericPhoto` and `GENERIC_PHOTO_VISION_SYSTEM`

**Files:**
- Modify: `lib/ai/prompts.ts` (append new system prompt export), `lib/ai/vision.ts` (append new function + export)
- Test: `tests/unit/vision.test.ts` (append new describe block)

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/vision.test.ts`:

```typescript
describe('extractGenericPhoto', () => {
  beforeEach(() => {
    mockCreate.mockReset()
  })

  it('returns structured + summary + confidence per the extractFor instruction', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            text: 'pin 1 KEY/RUN, pin 2 GROUND, pin 3 HSCAN-, pin 4 HSCAN+, pin 5 LIN',
            structured: {
              pins: [
                { number: 1, function: 'KEY/RUN' },
                { number: 4, function: 'HSCAN+' },
              ],
            },
            summary: 'C171 pinout — 5 pins identified, HSCAN+ on pin 4',
            confidence: 0.92,
          }),
        },
      ],
      stop_reason: 'end_turn',
    })

    const { extractGenericPhoto } = await import('@/lib/ai/vision')
    const result = await extractGenericPhoto({
      bytes: new Uint8Array([0xff, 0xd8, 0xff]),
      mimeType: 'image/jpeg',
      extractFor: 'full pinout for connector C171',
    })

    expect(result.summary).toMatch(/HSCAN\+/)
    expect(result.confidence).toBeGreaterThan(0.5)
    expect(result.structured).toBeDefined()
  })

  it('returns confidence < 0.4 with re-snap suggestion when image is unreadable', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            summary: 'pin column glared — re-snap with light angled away from the page',
            confidence: 0.2,
          }),
        },
      ],
      stop_reason: 'end_turn',
    })

    const { extractGenericPhoto } = await import('@/lib/ai/vision')
    const result = await extractGenericPhoto({
      bytes: new Uint8Array([0xff, 0xd8, 0xff]),
      mimeType: 'image/jpeg',
      extractFor: 'full pinout for connector C171',
    })

    expect(result.confidence).toBeLessThan(0.4)
    expect(result.summary).toMatch(/re-snap/i)
  })

  it('rejects unsupported mime type', async () => {
    const { extractGenericPhoto } = await import('@/lib/ai/vision')
    await expect(
      extractGenericPhoto({
        bytes: new Uint8Array([0]),
        mimeType: 'application/pdf',
        extractFor: 'anything',
      }),
    ).rejects.toThrow(/unsupported/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/vision.test.ts -t "extractGenericPhoto"`
Expected: 3 fail with "extractGenericPhoto is not a function" or similar.

- [ ] **Step 3: Add the new system prompt**

Append to `lib/ai/prompts.ts`:

```typescript
export const GENERIC_PHOTO_VISION_SYSTEM = `You extract structured facts from an automotive technician's photo.

The user message will tell you EXACTLY what to extract — follow that instruction precisely. Common targets: factory pinouts, wiring diagrams, build stickers, scan-tool screens, capacity placards, OEM tags, fuse-box layouts, part-condition close-ups.

OUTPUT FORMAT — respond with valid JSON and nothing else. No intro, no commentary, no fences.

type GenericPhotoExtraction = {
  text?: string                    // verbatim OCR of any visible text relevant to the instruction
  structured?: object              // structured data per the instruction (e.g. pins array, build code fields)
  summary: string                  // one-line summary of what you extracted
  confidence: number               // 0-1, your confidence in the extraction
}

If the image is unreadable for the requested extraction (blur, glare, wrong subject, cropped), set confidence < 0.4 and put a SPECIFIC re-snap suggestion in summary (e.g., "pin column glared — re-snap with light angled away from the page", "build code partially obscured — center the decal in frame and re-snap"). Never fabricate data to fill the fields.

LEGAL: never reproduce large extracts of OEM text verbatim. Extract only the structured facts the tech asked for. Original photo is stored in the case evidence record.`
```

- [ ] **Step 4: Add `extractGenericPhoto` to `lib/ai/vision.ts`**

Append after the existing `extractWiringDiagram` function and before the audio section:

```typescript
import { GENERIC_PHOTO_VISION_SYSTEM } from './prompts'

export type GenericPhotoExtraction = {
  text?: string
  structured?: Record<string, unknown>
  summary: string
  confidence: number
}

export async function extractGenericPhoto(input: {
  bytes: Uint8Array
  mimeType: string
  extractFor: string
}): Promise<GenericPhotoExtraction> {
  const baseMime = input.mimeType.split(';')[0].trim()
  if (!VISION_MIME_TYPES.has(baseMime)) {
    throw new Error(`unsupported image type for vision: ${input.mimeType}`)
  }
  return withRetry(async () => {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: cachedSystem(GENERIC_PHOTO_VISION_SYSTEM),
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: input.mimeType as
                  | 'image/jpeg'
                  | 'image/png'
                  | 'image/gif'
                  | 'image/webp',
                data: toBase64(input.bytes),
              },
            },
            {
              type: 'text',
              text: `Extract per this instruction: ${input.extractFor}\n\nReturn JSON only.`,
            },
          ],
        },
      ],
    })

    const block = res.content.find((b: { type: string }) => b.type === 'text')
    if (!block || block.type !== 'text') throw new Error('no text block in response')
    if (res.stop_reason === 'max_tokens') {
      throw new Error(`generic-photo response truncated at max_tokens (len=${block.text.length})`)
    }
    const result = parseJson<GenericPhotoExtraction>(block.text, res.stop_reason ?? undefined)
    if (typeof (result as Record<string, unknown>).summary !== 'string') {
      throw new Error('generic-photo response missing required field: summary')
    }
    if (typeof (result as Record<string, unknown>).confidence !== 'number') {
      throw new Error('generic-photo response missing required field: confidence')
    }
    return result
  })
}
```

Note: the import line goes at the top of the file with the other prompt imports. The existing import at `lib/ai/vision.ts:3` already imports several prompts — append `GENERIC_PHOTO_VISION_SYSTEM` to that list and remove the duplicate import line above.

- [ ] **Step 5: Run the new vision tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/vision.test.ts -t "extractGenericPhoto"`
Expected: 3 pass.

- [ ] **Step 6: Run the full vision test file**

Run: `pnpm exec vitest run tests/unit/vision.test.ts`
Expected: all pass (existing + new 3).

- [ ] **Step 7: Commit**

```bash
git add lib/ai/vision.ts lib/ai/prompts.ts tests/unit/vision.test.ts
git commit -m "feat(vision): add extractGenericPhoto + GENERIC_PHOTO_VISION_SYSTEM"
```

---

## Task 5: Wire `extractGenericPhoto` into the extraction worker for `photo` kind

**Files:**
- Modify: `lib/ai/extraction-worker.ts` (replace the `photo` case in the switch)
- Modify: `lib/ai/artifact-kinds.ts` (add `'photo'` to `HIGH_SIGNAL_KINDS`)
- Modify: `lib/db/queries.ts` (add a query that fetches `treeState.proposedAction.whatWouldClose` by sessionId — see step 3)
- Test: `tests/unit/extraction-worker.test.ts`

- [ ] **Step 1: Extend the existing top-level mocks**

`vi.mock` calls must be hoisted at the top of the file — do NOT add new `vi.mock` blocks inline. Instead, edit the existing mocks at the top of `tests/unit/extraction-worker.test.ts`:

(a) Find the existing `vi.mock('@/lib/db/queries', () => ({...}))` block at the top of the file. Add `getWhatWouldCloseForNode: vi.fn()` to its return object.

(b) Find the existing `vi.mock('@/lib/ai/vision', () => ({...}))` block. Add `extractGenericPhoto: vi.fn()` to its return object.

(c) In the imports block (after the mocks), find `import { extractScanScreen, extractWiringDiagram, transcribeAudio } from '@/lib/ai/vision'` and add `extractGenericPhoto` to the destructure. Find `import { getArtifactById, setArtifactExtraction } from '@/lib/db/queries'` and add `getWhatWouldCloseForNode`.

After the imports the file should have these two updated mocks (illustrative — match the existing style):

```typescript
vi.mock('@/lib/db/queries', () => ({
  getArtifactById: vi.fn(),
  setArtifactExtraction: vi.fn(),
  getWhatWouldCloseForNode: vi.fn(),
}))

vi.mock('@/lib/ai/vision', () => ({
  extractScanScreen: vi.fn(),
  extractWiringDiagram: vi.fn(),
  transcribeAudio: vi.fn(),
  extractGenericPhoto: vi.fn(),
}))

import { extractGenericPhoto } from '@/lib/ai/vision'
import { getWhatWouldCloseForNode } from '@/lib/db/queries'
```

- [ ] **Step 2: Write the failing tests**

In `tests/unit/extraction-worker.test.ts`, find the existing `describe('processArtifactExtraction — photo (describe-first)')` block (and the matching `describe('processArtifactExtraction — video ...')` directly below it). Delete the **photo** describe block (keep video as-is — video stays inert per spec). Add the following describe block in its place:

```typescript
describe('processArtifactExtraction — photo', () => {
  it('invokes extractGenericPhoto when extractFor is resolvable from the session', async () => {
    ;(getArtifactById as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'art-1',
      kind: 'photo',
      sessionId: 'sess-1',
      nodeId: 'node-1',
      storageKey: 'k',
      mimeType: 'image/jpeg',
    } as Artifact)
    ;(downloadArtifact as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Uint8Array([0xff, 0xd8, 0xff]),
    )
    ;(getWhatWouldCloseForNode as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      kind: 'photo',
      prompt: 'snap pinout',
      extractFor: 'full pinout for C171',
    })
    ;(extractGenericPhoto as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      summary: 'pinout — 5 pins',
      structured: { pins: [] },
      confidence: 0.9,
    })

    await processArtifactExtraction({} as never, 'art-1')

    expect(extractGenericPhoto).toHaveBeenCalledWith(
      expect.objectContaining({ extractFor: 'full pinout for C171' }),
    )
    expect(setArtifactExtraction).toHaveBeenCalledWith(
      {},
      'art-1',
      expect.objectContaining({ summary: expect.stringMatching(/pinout/) }),
      'done',
    )
  })

  it('records a failed extraction when extractFor is not derivable', async () => {
    ;(getArtifactById as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'art-2',
      kind: 'photo',
      sessionId: 'sess-1',
      nodeId: 'node-stale',
      storageKey: 'k',
      mimeType: 'image/jpeg',
    } as Artifact)
    ;(downloadArtifact as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Uint8Array([0xff, 0xd8, 0xff]),
    )
    ;(getWhatWouldCloseForNode as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null)

    await expect(
      processArtifactExtraction({} as never, 'art-2'),
    ).rejects.toThrow(/extractFor/)

    expect(extractGenericPhoto).not.toHaveBeenCalled()
    expect(setArtifactExtraction).toHaveBeenCalledWith(
      {},
      'art-2',
      expect.objectContaining({ summary: expect.stringMatching(/extractFor/i) }),
      'failed',
    )
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/extraction-worker.test.ts -t "processArtifactExtraction — photo"`
Expected: 2 fail — `getWhatWouldCloseForNode is not a function` (or similar).

- [ ] **Step 4: Add the `getWhatWouldCloseForNode` query**

In `lib/db/queries.ts`, add a new exported function. Place it near the other session-reading helpers (after `getArtifactById`, search for that to find the right spot):

```typescript
import type { WhatWouldClose } from '@/lib/ai/tree-engine'

export async function getWhatWouldCloseForNode(
  db: AppDb,
  input: { sessionId: string; nodeId: string },
): Promise<WhatWouldClose | null> {
  const rows = await db
    .select({ treeState: sessions.treeState })
    .from(sessions)
    .where(eq(sessions.id, input.sessionId))
    .limit(1)
  if (rows.length === 0) return null
  const treeState = rows[0]?.treeState as { currentNodeId?: string; proposedAction?: { whatWouldClose?: unknown } } | null
  if (!treeState) return null
  if (treeState.currentNodeId !== input.nodeId) return null
  const wwc = treeState.proposedAction?.whatWouldClose
  if (wwc && typeof wwc === 'object' && 'kind' in wwc) {
    return wwc as WhatWouldClose
  }
  return null
}
```

(Imports `sessions` and `eq` should already be in the file from existing queries — search for `from(sessions)` to confirm. If `eq` is not imported, add `import { eq } from 'drizzle-orm'` at top.)

- [ ] **Step 5: Replace the `photo` case in the extraction worker**

In `lib/ai/extraction-worker.ts`, find the existing `case 'photo':` block inside `processArtifactExtraction`'s switch (around line 106-111). Replace the entire `case 'photo':` block with:

```typescript
      case 'photo': {
        const wwc = await getWhatWouldCloseForNode(db, {
          sessionId: artifact.sessionId,
          nodeId: artifact.nodeId,
        })
        if (!wwc || wwc.kind !== 'photo') {
          await setArtifactExtraction(
            db,
            artifactId,
            { summary: 'Extraction failed: no extractFor on current node (tree may have advanced).' },
            'failed',
          )
          throw new Error('photo extraction failed: extractFor not derivable from session state')
        }
        const structured = await extractGenericPhoto({
          bytes,
          mimeType: artifact.mimeType,
          extractFor: wwc.extractFor,
        })
        extraction = {
          text: structured.text,
          structured: structured.structured,
          summary: structured.summary,
        }
        break
      }
```

Add at the top of the file (with the other imports):

```typescript
import { extractGenericPhoto } from './vision'
import { getWhatWouldCloseForNode } from '../db/queries'
```

- [ ] **Step 6: Add `'photo'` to `HIGH_SIGNAL_KINDS`**

In `lib/ai/artifact-kinds.ts:7`, change:

```typescript
export const HIGH_SIGNAL_KINDS = new Set<CaptureKind>(['scan_screen', 'wiring_diagram', 'audio'])
```

to:

```typescript
export const HIGH_SIGNAL_KINDS = new Set<CaptureKind>(['scan_screen', 'wiring_diagram', 'audio', 'photo'])
```

- [ ] **Step 7: Run extraction-worker tests**

Run: `pnpm exec vitest run tests/unit/extraction-worker.test.ts`
Expected: all pass (existing + new 2; old "photo describe-first" test was deleted).

- [ ] **Step 8: Run full test suite + type check**

Run: `pnpm test && pnpm exec tsc --noEmit`
Expected: green.

- [ ] **Step 9: Commit**

```bash
git add lib/ai/extraction-worker.ts lib/ai/artifact-kinds.ts lib/db/queries.ts tests/unit/extraction-worker.test.ts
git commit -m "feat(extraction): generic photo extractor wired into worker, photo kind goes high-signal"
```

---

## Task 6: Add hero ask card props to the `DeclineOrDefer` presentational screen

**Files:**
- Modify: `components/screens/decline-or-defer.tsx`
- Test: `tests/unit/decline-or-defer-screen.test.tsx`

- [ ] **Step 1: Write failing component tests**

Add to `tests/unit/decline-or-defer-screen.test.tsx` inside the existing `describe('DeclineOrDefer (presentational)')` block:

```typescript
  it('renders a confirm hero with Yes/No when confirmAsk is provided', () => {
    const onYes = vi.fn()
    const onNo = vi.fn()
    render(
      <DeclineOrDefer
        vehicleName="x"
        vehicleVin="x"
        timer="x"
        gap="g"
        options={[
          { number: 1, title: 'A', description: 'a' },
          { number: 2, title: 'B', description: 'b' },
          { number: 3, title: 'C', description: 'c' },
        ]}
        confirmAsk={{
          prompt: 'Did C171 positively re-latch?',
          onYes,
          onNo,
        }}
      />,
    )
    expect(screen.getByText(/Did C171 positively re-latch/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^yes$/i }))
    expect(onYes).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /^no$/i }))
    expect(onNo).toHaveBeenCalledTimes(1)
  })

  it('renders a photo hero with Snap-it when photoAsk is provided', () => {
    const onSnap = vi.fn()
    render(
      <DeclineOrDefer
        vehicleName="x"
        vehicleVin="x"
        timer="x"
        gap="g"
        options={[
          { number: 1, title: 'A', description: 'a' },
          { number: 2, title: 'B', description: 'b' },
          { number: 3, title: 'C', description: 'c' },
        ]}
        photoAsk={{
          prompt: 'Snap the C171 pinout page',
          onSnap,
        }}
      />,
    )
    expect(screen.getByText(/Snap the C171 pinout page/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /snap it/i }))
    expect(onSnap).toHaveBeenCalledTimes(1)
  })

  it('renders no hero when neither confirmAsk nor photoAsk is provided', () => {
    render(
      <DeclineOrDefer
        vehicleName="x"
        vehicleVin="x"
        timer="x"
        gap="g"
        options={[{ number: 1, title: 'A', description: 'a' }]}
      />,
    )
    expect(screen.queryByRole('button', { name: /^yes$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /snap it/i })).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/decline-or-defer-screen.test.tsx -t "hero"`
Expected: 3 fail — `confirmAsk`/`photoAsk` props don't exist.

- [ ] **Step 3: Add props + hero render to the presentational component**

In `components/screens/decline-or-defer.tsx`, extend the `Props` type (around line 15-40). Add two new optional props above `back?`:

```typescript
  /** Hero interactive ask — yes/no for tech-attestable confirms. Renders above the compass. */
  confirmAsk?: { prompt: string; onYes: () => void; onNo: () => void; busy?: boolean }
  /** Hero interactive ask — single-tap camera button. Renders above the compass. */
  photoAsk?: { prompt: string; onSnap: () => void; busy?: boolean }
```

In the `DeclineOrDefer` function signature destructure list (around line 277-294), add `confirmAsk` and `photoAsk`.

In the JSX, between the `<h2 className="dod-headline">{headline}</h2>` line and the `<div className="dod-tape">` block (around line 334-355), insert:

```tsx
        {confirmAsk && (
          <div className="dod-hero-ask" role="group" aria-label="Confirm to close gap">
            <p className="dod-hero-ask__prompt">{confirmAsk.prompt}</p>
            <div className="dod-hero-ask__buttons">
              <button
                type="button"
                className="btn btn-primary"
                onClick={confirmAsk.onYes}
                disabled={confirmAsk.busy}
                style={{ minHeight: 48, flex: 1 }}
              >
                Yes
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={confirmAsk.onNo}
                disabled={confirmAsk.busy}
                style={{ minHeight: 48, flex: 1 }}
              >
                No
              </button>
            </div>
          </div>
        )}
        {photoAsk && (
          <div className="dod-hero-ask" role="group" aria-label="Snap to close gap">
            <p className="dod-hero-ask__prompt">{photoAsk.prompt}</p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={photoAsk.onSnap}
              disabled={photoAsk.busy}
              style={{ minHeight: 48, width: '100%' }}
            >
              {photoAsk.busy ? 'Uploading…' : 'Snap it'}
            </button>
          </div>
        )}
```

(The `dod-hero-ask` CSS classes don't exist yet — that's fine; default browser styling on the buttons is acceptable for v1, and the inline `style` attributes ensure tap-targets are 48px+ per UI toolkit. CSS polish can follow in a separate PR.)

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/decline-or-defer-screen.test.tsx -t "hero"`
Expected: 3 pass.

- [ ] **Step 5: Run the full screen test file**

Run: `pnpm exec vitest run tests/unit/decline-or-defer-screen.test.tsx`
Expected: all pass (existing + new 3).

- [ ] **Step 6: Commit**

```bash
git add components/screens/decline-or-defer.tsx tests/unit/decline-or-defer-screen.test.tsx
git commit -m "feat(decline-screen): hero ask card — Yes/No or Snap-it above the compass"
```

---

## Task 7: Wire the hero ask into `DeclineOrDeferLive`

**Files:**
- Modify: `components/screens/decline-or-defer-live.tsx`
- Modify: `app/(app)/sessions/[id]/decline/page.tsx` (pass-through type widening)
- Test: `tests/unit/decline-or-defer-screen.test.tsx` (extend live describe block)

- [ ] **Step 1: Write failing live-wrapper tests**

Append to the `describe('DeclineOrDeferLive (wired)')` block in `tests/unit/decline-or-defer-screen.test.tsx`:

```typescript
  it('renders a confirm hero and POSTs the choice as observation to /advance', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    render(
      <DeclineOrDeferLive
        {...baseProps}
        whatWouldClose={{ kind: 'confirm', prompt: 'Did C171 reseat cleanly?' }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /^yes$/i }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/sessions/sess-abc/advance',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('Yes'),
      }),
    )
    await waitFor(() => expect(pushSpy).toHaveBeenCalledWith('/sessions/sess-abc'))
  })

  it('renders a photo hero with a hidden file input that uploads to /capture', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ artifactId: 'art-xyz' }),
    })
    const { container } = render(
      <DeclineOrDeferLive
        {...baseProps}
        whatWouldClose={{
          kind: 'photo',
          prompt: 'Snap the C171 pinout page',
          extractFor: 'full pinout for C171',
        }}
      />,
    )
    expect(screen.getByText(/Snap the C171 pinout page/i)).toBeInTheDocument()
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    expect(fileInput).toBeTruthy()
    expect(fileInput.getAttribute('accept')).toMatch(/image/)
    expect(fileInput.getAttribute('capture')).toBe('environment')

    const file = new File(['x'], 'pinout.jpg', { type: 'image/jpeg' })
    Object.defineProperty(fileInput, 'files', { value: [file] })
    fireEvent.change(fileInput)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/sessions/sess-abc/capture',
      expect.objectContaining({ method: 'POST' }),
    )
    await waitFor(() => expect(pushSpy).toHaveBeenCalledWith('/sessions/sess-abc'))
  })

  it('does not render the hero when whatWouldClose is a legacy string', () => {
    render(<DeclineOrDeferLive {...baseProps} whatWouldClose="quote the FSM page" />)
    expect(screen.queryByRole('button', { name: /^yes$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /snap it/i })).not.toBeInTheDocument()
  })
```

(Update the `baseProps` `whatWouldClose` typing — `whatWouldClose` is currently `string | undefined` on the live wrapper's prop type; the type widening in step 3 covers it.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/decline-or-defer-screen.test.tsx -t "DeclineOrDeferLive"`
Expected: existing pass; the 3 new tests fail (props/types missing).

- [ ] **Step 3: Widen `DeclineOrDeferLive` prop type and add hero wiring**

In `components/screens/decline-or-defer-live.tsx`:

(a) At the top, add the import:

```typescript
import type { WhatWouldClose } from '@/lib/ai/tree-engine'
import { useRef } from 'react'
```

(b) Change line 46 (`whatWouldClose?: string`) to:

```typescript
  whatWouldClose?: string | WhatWouldClose
```

(c) Inside the `DeclineOrDeferLive` function body (after the existing `const [error, setError] = useState<string | null>(null)`), add:

```typescript
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [heroBusy, setHeroBusy] = useState(false)

  // Detect structured shape vs legacy string
  const wwc = props.whatWouldClose
  const wwcObj = wwc && typeof wwc === 'object' ? wwc : null

  async function handleConfirm(answer: 'Yes' | 'No') {
    setHeroBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/sessions/${props.sessionId}/advance`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          observation: `${answer} — ${wwcObj?.kind === 'confirm' ? wwcObj.prompt : ''}`,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `${res.status}`)
      }
      router.push(`/sessions/${props.sessionId}`)
    } catch (err) {
      setHeroBusy(false)
      setError(err instanceof Error ? err.message : 'Request failed')
    }
  }

  function handleSnap() {
    fileInputRef.current?.click()
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setHeroBusy(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('kind', 'photo')
      // The current node is the gated node; capture endpoint pulls nodeId from session state if absent.
      // We send no nodeId — captureArtifact defaults to session.treeState.currentNodeId.
      const res = await fetch(`/api/sessions/${props.sessionId}/capture`, {
        method: 'POST',
        body: form,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `${res.status}`)
      }
      router.push(`/sessions/${props.sessionId}`)
    } catch (err) {
      setHeroBusy(false)
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }
```

(d) Replace the existing `<DeclineOrDefer ... />` JSX return block. Build the props for the hero card and the hidden file input, then render:

```tsx
  return (
    <>
      {wwcObj?.kind === 'photo' && (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFile}
          style={{ display: 'none' }}
          aria-hidden="true"
          tabIndex={-1}
        />
      )}
      <DeclineOrDefer
        vehicleName={props.vehicleName}
        vehicleVin={props.vehicleVin}
        timer={props.timer}
        riskLabel={riskLabel}
        gap={props.gap}
        confidenceGap={props.confidenceGap}
        options={options}
        onSelectOption={handleSelect}
        pending={pending}
        error={error}
        back={{ href: `/sessions/${props.sessionId}`, label: 'Diagnosis' }}
        confirmAsk={
          wwcObj?.kind === 'confirm'
            ? {
                prompt: wwcObj.prompt,
                onYes: () => handleConfirm('Yes'),
                onNo: () => handleConfirm('No'),
                busy: heroBusy,
              }
            : undefined
        }
        photoAsk={
          wwcObj?.kind === 'photo'
            ? {
                prompt: wwcObj.prompt,
                onSnap: handleSnap,
                busy: heroBusy,
              }
            : undefined
        }
      />
    </>
  )
```

(e) Note: the `options` mapping at lines 54-60 currently uses `props.whatWouldClose` as the gather spoke description. Update it to handle the structured case:

```typescript
  const options = props.optionKeys.map((k) => {
    const base = OPTIONS_BY_REASON[k]
    if (k === 'gather_more_low_risk') {
      const wwcText =
        typeof props.whatWouldClose === 'string'
          ? props.whatWouldClose
          : wwcObj?.prompt ?? ''
      if (wwcText) return { ...base, description: wwcText }
    }
    return base
  })
```

- [ ] **Step 4: Update `app/(app)/sessions/[id]/decline/page.tsx` for the type widening**

This file already passes `whatWouldClose` through (line 39). The type widening in `GateDecision` (Task 3) and `DeclineOrDeferLive` (this task) means the value flows through unchanged. Run a quick type check to confirm:

Run: `pnpm exec tsc --noEmit`
Expected: clean.

If TS complains about the type, add an explicit cast at the page.tsx call site:

```typescript
      whatWouldClose={gate.whatWouldClose}
```

stays as-is — should not need a cast because the types now line up.

- [ ] **Step 5: Run the live-wrapper tests**

Run: `pnpm exec vitest run tests/unit/decline-or-defer-screen.test.tsx -t "DeclineOrDeferLive"`
Expected: all pass.

- [ ] **Step 6: Run the full test suite + tsc + build**

Run: `pnpm test && pnpm exec tsc --noEmit && pnpm build`
Expected: green across all three.

- [ ] **Step 7: Commit**

```bash
git add components/screens/decline-or-defer-live.tsx tests/unit/decline-or-defer-screen.test.tsx
git commit -m "feat(decline-live): wire confirm Yes/No and photo Snap to advance/capture endpoints"
```

---

## Task 8: Manual verification on staging Vercel preview

**Files:** none (verification task)

This satisfies the verification-rigor rule: unit-test green ≠ done. Brandon decides when this is satisfied.

- [ ] **Step 1: Push the branch (Brandon's call)**

If/when Brandon authorizes: `git push -u origin staging/camera-vision`
Wait for Vercel to finish the preview deploy.

- [ ] **Step 2: Verify the confirm flow on the preview as an authed tech**

  - Sign in as a test tech on the preview URL
  - Start a new diagnosis (intake form) for a vehicle/complaint that is likely to trigger a low-confidence proposedAction (e.g. a body-electrical concern on an older vehicle where corpus is thin)
  - Walk through the tree until a gate fires (you may need to seed the corpus with a known-tricky case, or temporarily lower the gating threshold via the calibration table)
  - Confirm: the Decline-or-Defer screen renders with a hero `Yes` / `No` card above the compass, with the AI's prompt
  - Click `Yes`. Verify the session advances; the next step shows the AI's response factoring in the confirmation

- [ ] **Step 3: Verify the photo flow on the preview as an authed tech**

  - In a session that triggers a photo-shaped `whatWouldClose`, confirm the hero card shows a `Snap it` button labeled with the AI's prompt
  - Tap `Snap it` on a real phone (or use a desktop file upload in dev tools) — upload a fixture image of a pinout page
  - Verify: the session advances, the AI's next message references the extracted pinout, and the artifact is visible in the case evidence list with `extractionStatus: done`

- [ ] **Step 4: Verify legacy string path still works**

  - Find or simulate a session whose `gate.whatWouldClose` is a legacy plain string. Confirm the gating screen renders without a hero card (just the existing 3-spoke compass), and the `Gather more low-risk data` spoke shows the string as its description.

- [ ] **Step 5: Verify the 1+2 follow-up budget still caps repetition**

  - Trigger a gate with a photo ask. Snap a deliberately unreadable image. Verify the AI returns a `confidence < 0.4` result and asks for a re-snap. Repeat until the budget is exhausted; verify the screen pivots to Decline / Defer (no fourth re-ask).

- [ ] **Step 6: Sign-off**

  - When all four flows verify, mark this task complete in the plan and notify Brandon.
  - Brandon promotes `staging/camera-vision` to `main` when satisfied. Agent does not push to main.

---

## Self-review checklist (run after writing this plan)

- [x] Spec coverage: every section of the spec maps to a task. Prompt → Task 2; parse → Task 1; UI → Tasks 6+7; vision extractor → Task 4; worker → Task 5; gating-decision pass-through → Task 3; manual verification → Task 8.
- [x] Placeholder scan: no "TBD"/"TODO"/"add appropriate validation"/"similar to Task N". Every step has the actual code or command to run.
- [x] Type consistency: `WhatWouldClose` is defined in Task 1 and referenced verbatim in Tasks 3, 5, 6, 7. `extractGenericPhoto` signature is consistent across Task 4 (definition) and Task 5 (consumer). `confirmAsk`/`photoAsk` props match between Task 6 (presentational) and Task 7 (live caller).
