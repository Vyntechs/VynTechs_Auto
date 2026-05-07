# Outcome-Validator Dead-End — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a tech close a real solved case in at most one retry — no more dead-ends from the AI specificity validator.

**Architecture:** Three layered changes: (1) schema gains an optional `override` field on `outcomeSchema`. (2) The validator reads both `rootCause` AND `notes` and phrases feedback as instructions. (3) When the client sends `override` (after one rejection), the server skips the validator and persists override metadata for admin review.

**Tech Stack:** Next.js 15 App Router, Drizzle ORM (jsonb column already typed via Zod-inferred type — no migration), Zod schemas, Anthropic SDK with cached system prompts, vitest + PGlite for unit tests, @testing-library/react for component tests.

**Branch:** `fix/outcome-validator-deadend-2026-05-07` (off `main`, spec already committed at `61aad9b`).

**Spec:** `docs/superpowers/specs/2026-05-07-outcome-validator-deadend-design.md`

---

## File Map

| File | Responsibility | Action |
|---|---|---|
| `lib/types.ts` | Outcome zod schema | Add optional `override: { at, lastFeedback }` |
| `lib/ai/prompts.ts` | Validator system prompt | Add notes-as-context + feedback-as-instruction rules |
| `lib/ai/outcome-validator.ts` | `validateSpecificity` Anthropic wrapper | Signature changes from `(text)` to `({ rootCause, notes? })` |
| `lib/sessions.ts` | `closeSessionForUser` server logic | If body has `override`, skip validator; persist override metadata |
| `components/screens/outcome-capture.tsx` | Close-case form | `attemptCount` state + button label change + send `override` on retry |
| `tests/unit/outcome-schema.test.ts` | Schema unit tests | Add: override field accepted; override field validates required nested keys |
| `tests/unit/outcome-validator.test.ts` | Validator unit tests | Update for new signature + add: notes is included in prompt user message |
| `tests/unit/close-session-handler.test.ts` | Server logic tests | Add: override path skips validator + persists override metadata |
| `tests/unit/outcome-capture.test.tsx` | Client component tests | Add: button label changes after 422; second submit includes override |

---

## Task 1: Extend outcomeSchema with optional `override` field

**Files:**
- Modify: `lib/types.ts:14-40`
- Test: `tests/unit/outcome-schema.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/outcome-schema.test.ts` (above the closing `})` at the end of the describe block):

```ts
  it('accepts an outcome with an override block', () => {
    const r = outcomeSchema.safeParse({
      rootCause: 'Wastegate vacuum line cracked at actuator-can end',
      actionType: 'part_replacement',
      partInfo: { name: 'Vacuum line, silicone 4mm' },
      verification: { codesCleared: true, testDrive: true, symptomsResolved: 'yes' },
      diagMinutes: 25,
      repairMinutes: 18,
      override: {
        at: '2026-05-07T18:00:00Z',
        lastFeedback: 'Add the bolt location to root cause.',
      },
    })
    expect(r.success).toBe(true)
  })

  it('rejects an override block missing required keys', () => {
    const r = outcomeSchema.safeParse({
      rootCause: 'Wastegate vacuum line cracked at actuator-can end',
      actionType: 'no_fix',
      verification: { codesCleared: true, testDrive: true, symptomsResolved: 'yes' },
      diagMinutes: 10,
      repairMinutes: 0,
      override: { at: '2026-05-07T18:00:00Z' }, // missing lastFeedback
    })
    expect(r.success).toBe(false)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --run tests/unit/outcome-schema.test.ts`
Expected: FAIL on the two new tests — first passes (zod allows unknown keys by default, but `success` is true) actually wait, let me reconsider. Zod by default strips unknown keys silently. So the new "override block" test will pass even without code changes (the override is just ignored). The "rejects an override block missing required keys" test ALSO won't fail by default — zod ignores the unknown key entirely.

Re-do this step: the test must assert that `r.data.override` is the parsed object, not just that `r.success` is true.

Replace the first new test block above with:

```ts
  it('accepts an outcome with an override block and exposes it on parsed data', () => {
    const r = outcomeSchema.safeParse({
      rootCause: 'Wastegate vacuum line cracked at actuator-can end',
      actionType: 'part_replacement',
      partInfo: { name: 'Vacuum line, silicone 4mm' },
      verification: { codesCleared: true, testDrive: true, symptomsResolved: 'yes' },
      diagMinutes: 25,
      repairMinutes: 18,
      override: {
        at: '2026-05-07T18:00:00Z',
        lastFeedback: 'Add the bolt location to root cause.',
      },
    })
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.data.override?.at).toBe('2026-05-07T18:00:00Z')
    expect(r.data.override?.lastFeedback).toMatch(/bolt location/)
  })

  it('rejects an override block missing required keys', () => {
    const r = outcomeSchema.safeParse({
      rootCause: 'Wastegate vacuum line cracked at actuator-can end',
      actionType: 'no_fix',
      verification: { codesCleared: true, testDrive: true, symptomsResolved: 'yes' },
      diagMinutes: 10,
      repairMinutes: 0,
      override: { at: '2026-05-07T18:00:00Z' }, // missing lastFeedback
    })
    expect(r.success).toBe(false)
  })
```

Run: `pnpm test -- --run tests/unit/outcome-schema.test.ts`
Expected: FAIL — first test fails because `r.data.override` is `undefined` (zod strips the unknown key). Second test fails because zod accepts (it strips the partial override). Both fail with shape-mismatch assertions.

- [ ] **Step 3: Add the override field to outcomeSchema**

Edit `lib/types.ts` lines 14-40, change to:

```ts
export const outcomeSchema = z.object({
  rootCause: z.string().min(10).max(2000),
  actionType: z.enum([
    'part_replacement',
    'repair',
    'adjustment',
    'cleaning',
    'no_fix',
    'referred',
  ]),
  partInfo: z
    .object({
      name: z.string().min(1),
      oemNumber: z.string().optional(),
      aftermarket: z.string().optional(),
      cost: z.number().nonnegative().optional(),
    })
    .optional(),
  verification: z.object({
    codesCleared: z.boolean(),
    testDrive: z.boolean(),
    symptomsResolved: z.enum(['yes', 'no', 'partial']),
  }),
  diagMinutes: z.number().nonnegative(),
  repairMinutes: z.number().nonnegative(),
  notes: z.string().max(2000).optional(),
  override: z
    .object({
      at: z.string(),
      lastFeedback: z.string(),
    })
    .optional(),
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- --run tests/unit/outcome-schema.test.ts`
Expected: PASS — all tests in the file pass.

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts tests/unit/outcome-schema.test.ts
git commit -m "schema(outcome): add optional override field for AI-validator bypass

Captures the override timestamp + the AI feedback that was overridden so
admin can fact-check via curator later. No DB migration — outcome column
is jsonb; type flows through OutcomePayload.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Validator accepts {rootCause, notes} + new prompt rules

**Files:**
- Modify: `lib/ai/prompts.ts:66-81`
- Modify: `lib/ai/outcome-validator.ts` (entire file)
- Modify: `lib/sessions.ts:267` (call site)
- Test: `tests/unit/outcome-validator.test.ts`

- [ ] **Step 1: Write the failing test (signature + notes-in-prompt)**

Replace the entire `tests/unit/outcome-validator.test.ts` body:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const createMock = vi.fn()
vi.mock('@/lib/ai/client', () => ({
  anthropic: {
    messages: {
      create: createMock,
    },
  },
  MODEL: 'claude-sonnet-4-6',
  cachedSystem: (t: string) => [{ type: 'text', text: t, cache_control: { type: 'ephemeral' } }],
}))

beforeEach(() => {
  createMock.mockReset()
})

describe('validateSpecificity', () => {
  it('rejects vague text with feedback', async () => {
    createMock.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            ok: false,
            feedback: 'Add the bolt location to Root cause.',
          }),
        },
      ],
      usage: { input_tokens: 50, output_tokens: 30 },
    })
    const { validateSpecificity } = await import('@/lib/ai/outcome-validator')
    const r = await validateSpecificity({ rootCause: 'the wire was bad' })
    expect(r.ok).toBe(false)
    expect(r.feedback).toMatch(/add/i)
  })

  it('accepts specific text', async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({ ok: true }) }],
      usage: { input_tokens: 50, output_tokens: 10 },
    })
    const { validateSpecificity } = await import('@/lib/ai/outcome-validator')
    const r = await validateSpecificity({
      rootCause:
        'Wastegate actuator vacuum line cracked ~2in from the actuator-can end on driver-side turbo, F-150 3.5L EcoBoost. Smoke test confirmed leak.',
    })
    expect(r.ok).toBe(true)
  })

  it('includes the notes field in the user message when provided', async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({ ok: true }) }],
      usage: { input_tokens: 50, output_tokens: 10 },
    })
    const { validateSpecificity } = await import('@/lib/ai/outcome-validator')
    await validateSpecificity({
      rootCause: 'Ground fault on engine block',
      notes: 'Driver side, lower corner near the oil pan',
    })
    const call = createMock.mock.calls[0][0]
    const userMessage = call.messages[0].content as string
    expect(userMessage).toContain('Ground fault on engine block')
    expect(userMessage).toContain('Driver side, lower corner near the oil pan')
    expect(userMessage.toLowerCase()).toContain('notes')
  })

  it('marks notes as (none) when not provided', async () => {
    createMock.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify({ ok: true }) }],
      usage: { input_tokens: 50, output_tokens: 10 },
    })
    const { validateSpecificity } = await import('@/lib/ai/outcome-validator')
    await validateSpecificity({ rootCause: 'Ground fault on engine block' })
    const call = createMock.mock.calls[0][0]
    const userMessage = call.messages[0].content as string
    expect(userMessage).toContain('(none)')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- --run tests/unit/outcome-validator.test.ts`
Expected: FAIL — `validateSpecificity` still expects a string. The new tests pass `{ rootCause, notes }` object → TypeScript fails at compile / runtime fails with "rootCause text:\n[object Object]".

- [ ] **Step 3: Update the validator signature + user-message construction**

Replace `lib/ai/outcome-validator.ts` entirely:

```ts
import { anthropic, MODEL, cachedSystem } from './client'
import { OUTCOME_VALIDATOR_SYSTEM } from './prompts'

export type ValidatorResult = {
  ok: boolean
  feedback?: string
  suggested?: string
}

export type ValidatorInput = {
  rootCause: string
  notes?: string
}

export async function validateSpecificity(
  input: ValidatorInput,
): Promise<ValidatorResult> {
  const userMessage = `Root cause:
${input.rootCause}

Notes for next time:
${input.notes && input.notes.trim() ? input.notes.trim() : '(none)'}

Return JSON only.`

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 256,
    system: cachedSystem(OUTCOME_VALIDATOR_SYSTEM),
    messages: [{ role: 'user', content: userMessage }],
  })
  const block = res.content.find((b) => b.type === 'text')
  if (!block || block.type !== 'text') throw new Error('no text block')
  const cleaned = block.text
    .trim()
    .replace(/^```(?:json)?\n?/, '')
    .replace(/\n?```$/, '')
  return JSON.parse(cleaned) as ValidatorResult
}
```

- [ ] **Step 4: Update the OUTCOME_VALIDATOR_SYSTEM prompt**

Replace `lib/ai/prompts.ts` lines 66-81 with:

```ts
export const OUTCOME_VALIDATOR_SYSTEM = `You are Vyntechs' outcome-capture validator.

You receive TWO fields written by the same tech: a Root cause description and an optional Notes for next time. Both come from the same tech and both describe the same fix. Treat the Notes field as additional context for the Root cause when evaluating specificity. The location, identifier, or measured detail often lives in Notes.

Decide if the combined information is specific enough that another tech could find and fix the same issue in 60 seconds on a future similar vehicle.

REQUIREMENTS for "specific enough":
- Names a concrete component, connector, or location (not just "the wire" or "the system")
- Includes a landmark or identifier where applicable (pin number, connector ID, vehicle area, side of engine, etc.)
- Describes the actual fault state (cracked / corroded / disconnected / out of spec / etc.)

OUTPUT FORMAT — always respond with valid JSON:

type ValidatorResult = {
  ok: boolean              // true if specific enough
  feedback?: string        // see FEEDBACK RULES below
  suggested?: string       // optional rewritten Root cause that would pass
}

FEEDBACK RULES (when ok is false):
- Phrase the feedback as an INSTRUCTION telling the tech what to add to the Root cause field.
- Never describe what is missing — describe what to type.
- Bad: "The bolt size is missing."
- Good: "Add the bolt's location and observable condition to Root cause (e.g., 'driver-side block ground stud, lower corner; visibly corroded')."
- Be specific about which field to edit (Root cause).`
```

- [ ] **Step 5: Update the call site in closeSessionForUser**

Edit `lib/sessions.ts` line 267, change:

```ts
  const validation = await opts.validateSpecificity(parsed.data.rootCause)
```

to:

```ts
  const validation = await opts.validateSpecificity({
    rootCause: parsed.data.rootCause,
    notes: parsed.data.notes,
  })
```

Also update the type of the `validateSpecificity` opts field. Edit `lib/sessions.ts` line 233:

Change:
```ts
  validateSpecificity: (text: string) => Promise<ValidatorResult>
```

to:
```ts
  validateSpecificity: (input: { rootCause: string; notes?: string }) => Promise<ValidatorResult>
```

- [ ] **Step 6: Update existing close-session-handler tests for new signature**

The existing tests in `tests/unit/close-session-handler.test.ts` mock `validateSpecificity` as `vi.fn()` calls — since they don't inspect the argument, they should still work. But TypeScript may complain about the type of the mocked function.

Search and verify: `grep -n "validateSpecificity" tests/unit/close-session-handler.test.ts` — confirm all call sites use `vi.fn().mockResolvedValueOnce({ ok: true })` style. These don't care about the argument shape, so no test changes needed.

If tsc complains, add explicit return type by changing `vi.fn().mockResolvedValueOnce({ ok: true })` to `vi.fn().mockResolvedValueOnce({ ok: true } as ValidatorResult)`. Likely not needed — vitest mock types are loose.

- [ ] **Step 7: Run tests to verify all pass**

Run: `pnpm test -- --run tests/unit/outcome-validator.test.ts tests/unit/close-session-handler.test.ts tests/unit/outcome-schema.test.ts`
Expected: PASS — all tests in those three files green.

Run: `pnpm exec tsc --noEmit` (in repo root)
Expected: PASS (exit 0) — no type errors.

- [ ] **Step 8: Commit**

```bash
git add lib/ai/outcome-validator.ts lib/ai/prompts.ts lib/sessions.ts tests/unit/outcome-validator.test.ts
git commit -m "feat(validator): read notes + phrase feedback as instruction

validateSpecificity now takes { rootCause, notes? } and the system prompt
tells the model to (a) treat Notes as additional context for the Root
cause, and (b) phrase 'ok=false' feedback as an instruction to the tech
('Add X to Root cause') rather than a critique.

Why: techs were dead-ending when they put location/specifics in Notes
and the validator only read Root cause.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Server skips validator on override + persists metadata

**Files:**
- Modify: `lib/sessions.ts:262-276` (closeSessionForUser body)
- Test: `tests/unit/close-session-handler.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/close-session-handler.test.ts` inside the `describe('closeSessionForUser', ...)` block (after the existing `it('returns 400 when the session is already closed')` test, before the nested `describe('corpus promotion (Phase K5)')`):

```ts
  it('skips the validator entirely when body has an override block', async () => {
    const { tech, session } = await seedOpenSession(db)
    const validate = vi.fn() // never called
    const result = await closeSessionForUser({
      db,
      userId: tech.userId,
      sessionId: session.id,
      body: makeOutcome({
        override: {
          at: '2026-05-07T18:00:00Z',
          lastFeedback: 'Add the bolt location to Root cause.',
        },
      }),
      validateSpecificity: validate,
    })
    expect(result.ok).toBe(true)
    expect(validate).not.toHaveBeenCalled()

    const [row] = await db.select().from(sessions).where(eq(sessions.id, session.id))
    expect(row.status).toBe('closed')
    expect(row.outcome?.override?.at).toBe('2026-05-07T18:00:00Z')
    expect(row.outcome?.override?.lastFeedback).toMatch(/bolt location/)
  })

  it('persists override metadata even if validator would have rejected', async () => {
    const { tech, session } = await seedOpenSession(db)
    const validate = vi.fn().mockResolvedValueOnce({
      ok: false,
      feedback: 'this would have been rejected',
    })
    const result = await closeSessionForUser({
      db,
      userId: tech.userId,
      sessionId: session.id,
      body: makeOutcome({
        rootCause: 'short root cause that AI would reject',
        override: {
          at: '2026-05-07T18:05:00Z',
          lastFeedback: 'Be more specific please.',
        },
      }),
      validateSpecificity: validate,
    })
    expect(result.ok).toBe(true)
    expect(validate).not.toHaveBeenCalled() // still skipped — override beats validator
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- --run tests/unit/close-session-handler.test.ts`
Expected: FAIL — both new tests fail because the validator IS called (mock has zero `mockResolvedValueOnce` queued so it returns undefined → throws or returns 422-ish).

- [ ] **Step 3: Add the override skip-path in closeSessionForUser**

Edit `lib/sessions.ts` lines 262-276. Change from:

```ts
  const parsed = outcomeSchema.safeParse(opts.body)
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.message }
  }

  const validation = await opts.validateSpecificity({
    rootCause: parsed.data.rootCause,
    notes: parsed.data.notes,
  })
  if (!validation.ok) {
    return {
      ok: false,
      status: 422,
      error: 'specificity_required',
      feedback: validation.feedback ?? 'Be more specific.',
    }
  }
```

to:

```ts
  const parsed = outcomeSchema.safeParse(opts.body)
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.message }
  }

  // Override path: tech retried after one rejection. Skip the validator entirely;
  // the override metadata is persisted on the outcome row for admin review.
  if (!parsed.data.override) {
    const validation = await opts.validateSpecificity({
      rootCause: parsed.data.rootCause,
      notes: parsed.data.notes,
    })
    if (!validation.ok) {
      return {
        ok: false,
        status: 422,
        error: 'specificity_required',
        feedback: validation.feedback ?? 'Be more specific.',
      }
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- --run tests/unit/close-session-handler.test.ts`
Expected: PASS — all tests in the file green (including the new override tests AND the existing ones).

- [ ] **Step 5: Commit**

```bash
git add lib/sessions.ts tests/unit/close-session-handler.test.ts
git commit -m "feat(sessions): override skips validator on close (one-retry rule)

When the close-case payload contains override = { at, lastFeedback }, the
server skips validateSpecificity entirely and closes the session. The
override metadata persists on outcome.override so admin can fact-check
via curator later (surfacing deferred to follow-up PR).

This is the second half of the dead-end fix: client offers an override
button after one rejection; server respects it.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Client retry-then-override

**Files:**
- Modify: `components/screens/outcome-capture.tsx` (entire file body — rewrite)
- Test: `tests/unit/outcome-capture.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/outcome-capture.test.tsx` inside the existing `describe('OutcomeCapture (wired)', ...)` block:

```ts
  it('after a 422, the button label changes to indicate override and second submit sends override', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: async () => ({
          error: 'specificity_required',
          feedback: 'Add the bolt location to Root cause.',
        }),
        text: async () => '',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
        text: async () => '',
      })
    vi.stubGlobal('fetch', fetchMock)

    render(<OutcomeCapture {...baseProps} sessionId="sess-abc" />)
    fillSpecificRootCause()
    fireEvent.change(screen.getByLabelText(/part name/i), {
      target: { value: 'Vacuum line' },
    })

    // First submit → 422
    fireEvent.click(screen.getByRole('button', { name: /submit & close/i }))
    await waitFor(() =>
      expect(screen.getByText(/Add the bolt location/i)).toBeInTheDocument(),
    )

    // Button label now indicates override
    const overrideBtn = await screen.findByRole('button', { name: /override/i })
    expect(overrideBtn).toBeInTheDocument()

    // Second submit (the override path)
    fireEvent.click(overrideBtn)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    const secondCallBody = JSON.parse(fetchMock.mock.calls[1][1].body as string)
    expect(secondCallBody.override).toBeDefined()
    expect(secondCallBody.override.lastFeedback).toMatch(/bolt location/i)
    expect(secondCallBody.override.at).toMatch(/\d{4}-\d{2}-\d{2}T/) // ISO-ish

    await waitFor(() => expect(hrefSetter).toHaveBeenCalledWith('/sessions'))
  })

  it('does NOT include override on the very first submit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
        text: async () => '',
      }),
    )
    render(<OutcomeCapture {...baseProps} sessionId="sess-abc" />)
    fillSpecificRootCause()
    fireEvent.change(screen.getByLabelText(/part name/i), {
      target: { value: 'Vacuum line' },
    })
    fireEvent.click(screen.getByRole('button', { name: /submit & close/i }))

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string)
    expect(body.override).toBeUndefined()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- --run tests/unit/outcome-capture.test.tsx`
Expected: FAIL on the new "after a 422, button label changes" test — the button still says "Submit & close case" (no /override/ regex match). The "does NOT include override on first submit" test PASSES already (no behavior change yet — but keeping it as a regression guard).

- [ ] **Step 3: Add `attemptCount` + `lastFeedback` state and override payload**

Edit `components/screens/outcome-capture.tsx`. Add the two state hooks after line 90 (`const [busy, setBusy] = useState(false)`):

```ts
  const [attemptCount, setAttemptCount] = useState(0)
  const [lastFeedback, setLastFeedback] = useState<string | null>(null)
```

Modify `handleSubmit` (currently lines 100-143). Replace the function body with:

```ts
  async function handleSubmit() {
    if (!sessionId) return
    setBusy(true)
    setError(null)

    const isOverride = attemptCount >= 1 && lastFeedback !== null

    const payload: Record<string, unknown> = {
      rootCause: rootCause.trim(),
      actionType,
      verification: {
        codesCleared,
        testDrive,
        symptomsResolved,
      },
      diagMinutes: diagMin,
      repairMinutes: repairMin,
    }
    if (requiresPart) {
      payload.partInfo = {
        name: partName.trim(),
        ...(oemNumber.trim() ? { oemNumber: oemNumber.trim() } : {}),
        ...(partCost ? { cost: Number(partCost) } : {}),
      }
    }
    if (notes.trim()) payload.notes = notes.trim()
    if (isOverride) {
      payload.override = {
        at: new Date().toISOString(),
        lastFeedback: lastFeedback ?? '',
      }
    } else {
      setFeedback(null) // clear any old feedback before a fresh attempt
    }

    const res = await fetch(`/api/sessions/${sessionId}/close`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setBusy(false)

    if (res.status === 422) {
      const data = await res.json().catch(() => ({}))
      const fb = data.feedback ?? 'Be more specific.'
      setFeedback(fb)
      setLastFeedback(fb)
      setAttemptCount((n) => n + 1)
      return
    }
    if (!res.ok) {
      setError((await res.text().catch(() => '')) || 'Failed to close session')
      return
    }
    window.location.href = successHref
  }
```

Modify the submit button label (currently line 311 `{busy ? 'Validating…' : 'Submit & close case'}`). Replace lines 304-313 with:

```tsx
        <button
          type="button"
          className="btn btn-primary"
          style={{ flex: 2 }}
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          {busy
            ? 'Validating…'
            : attemptCount >= 1
              ? 'Submit & close case (override AI)'
              : 'Submit & close case'}
        </button>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- --run tests/unit/outcome-capture.test.tsx`
Expected: PASS — all tests in the file green.

- [ ] **Step 5: Run the full unit suite to catch regressions**

Run: `pnpm test -- --run`
Expected: All tests pass (455+ from baseline, plus the new ones added in Tasks 1-4).

- [ ] **Step 6: Type-check**

Run: `pnpm exec tsc --noEmit`
Expected: PASS (exit 0).

- [ ] **Step 7: Commit**

```bash
git add components/screens/outcome-capture.tsx tests/unit/outcome-capture.test.tsx
git commit -m "feat(outcome): one-retry-then-override UX

After a 422 from the validator, the form: (a) shows the AI's actionable
feedback, (b) increments attemptCount, (c) flips the submit button label
to 'Submit & close case (override AI)'. The next click sends an override
block { at, lastFeedback } that the server respects to skip validation.

This closes the dead-end Brandon hit on the Chevy 3500 case where the
location specifics were in Notes (invisible to the validator) and there
was no escape from the validator's wall.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Verification + push + cherry-pick onto preview-curator

**Files:** No code changes. Verification only.

- [ ] **Step 1: Type-check + full unit suite + lint**

Run all three in parallel-able sequence:

```bash
pnpm exec tsc --noEmit
pnpm test -- --run
pnpm lint 2>&1 | tail -20
```

Expected: tsc exit 0, vitest "Tests N passed (N)" with N >= prior baseline + new tests, lint exit 0 (or at most warnings, no new errors).

- [ ] **Step 2: Push the fix branch**

```bash
git push -u origin fix/outcome-validator-deadend-2026-05-07
```

Expected: branch creates on origin.

- [ ] **Step 3: Cherry-pick the fix commits onto preview-curator for combined preview rebuild**

```bash
git checkout preview-curator
git pull origin preview-curator
git log fix/outcome-validator-deadend-2026-05-07 --oneline -10
# expect to see (newest first):
# <sha> feat(outcome): one-retry-then-override UX
# <sha> feat(sessions): override skips validator on close (one-retry rule)
# <sha> feat(validator): read notes + phrase feedback as instruction
# <sha> schema(outcome): add optional override field for AI-validator bypass
# <sha> docs(spec): outcome-validator dead-end fix — let tech override AI after one retry

# cherry-pick in chronological order (skip the spec doc since it's already on this branch's history? No — the spec doc was committed on the fix branch only. Cherry-pick all 5):
git cherry-pick <oldest 4 shas in order, oldest first>  # the 4 code commits, NOT the spec doc — spec stays on fix branch
```

Note: cherry-pick the 4 code commits only. The spec doc commit `61aad9b` doesn't need to ride the preview branch.

If a conflict arises (it shouldn't — preview-curator hasn't touched these files since the M-phase work, and the M-phase only added repair-phase code; outcome-capture.tsx was modified by d4472df to add the AbandonButton inline link, which lives in a different region of the file than our new state hooks):

- Read the conflict markers
- Keep BOTH the AbandonButton inline link AND the new attemptCount state
- `git add` resolved files
- `git cherry-pick --continue`

- [ ] **Step 4: Push preview-curator**

```bash
git push origin preview-curator
```

Expected: Vercel rebuilds the preview at the stable alias `https://vyntechs-dev-git-previ-65929f-brandon-nichols-projects-f7e6d2a9.vercel.app`.

- [ ] **Step 5: Wait for Vercel build, then ask Brandon to retest**

Poll Vercel build status:

```bash
gh api 'repos/Vyntechs/VynTechs_Auto/commits/preview-curator/statuses' --jq '[.[] | select(.context == "Vercel")] | .[0] | "\(.state): \(.description)"'
```

Wait until state is `success` (description: "Deployment has completed").

Tell Brandon: "Fix is on preview. Reproduce the dead-end you hit: open the same close-case form with a vague Root cause and clarifying info in Notes. The first submit should give a clearer instruction. The second submit should accept and close the case. Confirm both behaviors."

- [ ] **Step 6: Open PR off main**

Once Brandon confirms the fix works:

```bash
git checkout fix/outcome-validator-deadend-2026-05-07
gh pr create --title "fix(outcome): one-retry-then-override on AI specificity validator" --body "$(cat <<'EOF'
## Summary
- Validator now reads both Root cause AND Notes (the Chevy 3500 case had specifics in Notes, invisible to the AI).
- Validator feedback is now phrased as an instruction ("Add X to Root cause") not a critique.
- After one rejection, the tech can override and close the case. Override metadata persists on outcome.override for admin review (curator surface deferred to follow-up).

## Spec
docs/superpowers/specs/2026-05-07-outcome-validator-deadend-design.md

## Test plan
- [x] All existing unit tests still pass (455+ baseline)
- [x] New schema tests: override field accepted + missing-keys rejected
- [x] New validator tests: notes included in user message; (none) when missing
- [x] New server tests: override skips validator entirely + persists metadata
- [x] New client tests: button label flips after 422; second submit sends override
- [x] Brandon validated on preview-curator with the original reproducing case

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR opens on GitHub. Capture URL.

---

## Self-Review (run before committing the plan)

**Spec coverage check:**
| Spec section | Task |
|---|---|
| Validator reads Root cause + Notes | Task 2 |
| Feedback as instruction (prompt change) | Task 2 |
| One retry, then accept (server) | Task 3 |
| Schema additions | Task 1 |
| Client state + button label + override payload | Task 4 |
| Out of scope: admin surfacing, > 1 retry, re-run validator on override | (intentionally not in plan) |

All spec requirements have a task. ✓

**Placeholder scan:** No "TBD", "TODO", "Add appropriate error handling", "Similar to Task N", or undefined types. ✓

**Type consistency:**
- `ValidatorInput = { rootCause: string; notes?: string }` — defined Task 2, used Task 2 (call site update) and implicitly by Task 3 (no signature change inside Task 3).
- `outcome.override = { at: string; lastFeedback: string }` — defined Task 1 (schema), used Task 3 (server persists), Task 4 (client sends).
- `attemptCount: number` — local React state in Task 4 only. ✓
- All file paths exact. ✓

Plan ready.
