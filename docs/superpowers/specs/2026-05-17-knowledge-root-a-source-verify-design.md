# Root A — Source-verify the paste assistant ("show your work")

**Status:** Spec'd 2026-05-17, scope locked after brainstorm with Brandon.

**Branch:** `feat/knowledge-root-a-source-verify` off `origin/staging`.

**Parent roadmap:** `docs/superpowers/specs/2026-05-17-knowledge-trust-and-integrity-roadmap.md` → "Root A".

## What this fixes

Three trust-breakers in the paste-to-knowledge flow:

1. **Hallucinated values** — the parser invents a field with no support in the paste, but the form looks confident.
2. **Silent truncation** — long pastes lose content without the curator being told.
3. **Sparse-paste-invented-content** — paste is 5 words, parser confidently generates a full TSB-shaped entry.

All three share one root cause: the parser is on the honor system to ground its output in the paste. Nothing forces it. Root A fixes that with layered defense.

## Architecture — layered defense

Three layers; two ship in this PR.

- **Layer 1 — Templated extraction (regex, no parser).** Pre-extract structured fields (DTCs, TSB IDs, years) before the parser runs. **Deferred** to a follow-up root. DTC handling already lives in Root B (planned).
- **Layer 2 — Grounding-required system prompt.** Rewrite the parser's marching orders so it must locate verbatim grounding BEFORE filling a field, or leave the field blank. Empty is correct; fabricated is wrong.
- **Layer 3 — Server-side substring verifier.** After the parser returns, the server checks every claimed receipt against the paste. Receipts that aren't verbatim substrings → field stripped + top-of-form note. Fields populated without any receipt → ⚠ VERIFY badge.

A **minimum paste guard** rounds out the defense: pastes below 30 chars OR fewer than 6 words skip the parser entirely. The form opens empty with "Paste too short to assist — fill the form manually."

## Locked decisions

| Decision | Choice | Why |
|---|---|---|
| Fabricated-receipt handling | Strip the field, top-of-form note listing field names | Cleanest mental model: a present-and-matching receipt means trusted; otherwise it's not. Fake-positive risk acceptable because Layer 2 drives these to near-zero. |
| No-receipt populated fields | Keep value, ⚠ VERIFY chip | Less curator friction; chip signals "look at this." Same treatment as synthesized values. |
| Min paste length | Both thresholds required: ≥30 chars AND ≥6 words. Failing either → `paste_too_short`. | Lets short DTC reports with context through; blocks single-code "P0420" abuse. Tunable post-launch. |
| Verbatim normalization | Case-fold + collapse whitespace + Unicode dashes → `-` + smart quotes → ASCII | Catches real-world paste noise without accepting paraphrases. |
| Word "AI" in user-facing copy | Removed everywhere (badge, source label, errors) | The parser is invisible plumbing. Labels frame around the paste. |
| Existing "AI" chip on attributed fields | Removed. Receipt quote IS the affordance. | Lighter UI; the highlighted quote communicates origin without a label. |
| ⚠ VERIFY chip placement | Inline next to field label, amber/warning color | Eye lands on it during review. |
| Layer 1 templated regex | Deferred (future Root A2) | Layer 2+3 should drive leak-through to near-zero. Add Layer 1 only if real-world data shows it's needed. |

## Files

### New

**`lib/knowledge/verify-source-spans.ts`** — pure function.

```ts
export type VerifyResult = {
  draft: ClassifiedPasteResult['draft']           // possibly with fields stripped
  sourceSpans: Record<string, string>             // possibly with bad spans removed
  stripped: string[]                              // field names whose value was wiped
  unverified: string[]                            // field names with data but no receipt
}

export function verifySourceSpans(
  paste: string,
  draft: ClassifiedPasteResult['draft'],
  sourceSpans: Record<string, string>,
): VerifyResult
```

Logic: for each populated field in `draft`:

- `sourceSpans[field]` present (non-empty) AND normalized-substring of normalized-paste → keep, no warning.
- `sourceSpans[field]` present but NOT a normalized substring → strip the field value, remove from `sourceSpans`, push field name to `stripped`.
- `sourceSpans[field]` missing OR empty string → keep value, push field name to `unverified`.

**Verification scope:**

- **Verified:** top-level `title`, `body`, `dtcList`, `systemCodes`, `symptoms`; every string-valued OR string-array-valued key inside `structuredData`.
- **Walked, never blocked:** values that are nested objects, booleans, numbers, or null. Verifier ignores them.
- **Skipped from verification entirely in this PR:** `vehicleScopes`. Scopes can come from the curator's scope-picker (not the paste), so receipt-checking them creates false positives. Treated as pass-through. (Future improvement: per-scope-row receipt when picker is auto-suggesting from paste.)
- **Orphan source-span keys** (a key in `sourceSpans` with no matching field in `draft`): silently ignored. No warning, no error.

Normalization function (internal):

```ts
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[–—‐‑‒―]/g, '-')   // dash variants
    .replace(/[‘’‚‛]/g, "'")               // smart single quotes
    .replace(/[“”„‟]/g, '"')               // smart double quotes
    .replace(/\s+/g, ' ')                                       // collapse whitespace
    .trim()
}
```

Field iteration: walks top-level `title`, `body`, `dtcList`, `systemCodes`, `symptoms`, plus every entry inside `structuredData`. Arrays use a single receipt per array (no per-item granularity in this PR).

**`tests/unit/verify-source-spans.test.ts`** — covers:

- Exact substring → kept
- Case-insensitive substring → kept
- Whitespace-collapsed match → kept
- Em-dash vs hyphen (`F‒150` vs `F-150`) → kept
- Smart-quote vs straight quote → kept
- Non-substring → stripped, listed
- Missing span → unverified, listed
- Empty-string span → unverified, listed (same as missing)
- Mixed payload (3 verified, 1 stripped, 1 unverified) → result shape correct
- `dtcList` array with whole-list receipt → handled
- Empty draft + empty spans → returns empty, no errors
- **Empty paste + hallucinated draft** → ALL populated draft fields stripped (paste has no substrings to match against)
- **Orphan sourceSpan key** (key in spans, no matching field in draft) → silently ignored, no warning, no crash
- **`vehicleScopes` present** → passes through; not verified, not listed in stripped/unverified

### Modified

**`lib/knowledge/classify-paste.ts`**

- Add exported constants `MIN_PASTE_CHARS = 30`, `MIN_PASTE_WORDS = 6`.
- Add new status value `'paste_too_short'` to `ClassifiedPasteResult['status']`.
- Short-circuit at top of `classifyPaste` (before any model call): if trimmed length < `MIN_PASTE_CHARS` OR word count (`trimmed.split(/\s+/).filter(Boolean).length`) < `MIN_PASTE_WORDS`, return `{ status: 'paste_too_short', draft: {}, sourceSpans: {} }`. The `paste_too_short` status is server-only — the model never returns it.
- Rewrite `CLASSIFY_PASTE_SYSTEM` to add a grounding-mandatory section, placed **as the first rule** (before the type guidance) so the model sees it before deciding what to extract. Key text (verbatim):

  > **GROUNDING RULE** — Before filling any field, locate the exact verbatim text in the paste that supports it. Copy that text into `sourceSpans[fieldName]`. If you cannot find verbatim text supporting a value, **leave the field empty**. Empty is correct; fabricated is wrong.

  (No "re-read your sourceSpans before returning" line — that's a deterministic substring check the server handles in Layer 3. Asking the model to do it duplicates work it can't reliably perform.)

- Add one worked example block to the system prompt showing a sparse paste and the correct response (most fields omitted).

**`tests/unit/classify-paste.test.ts`** (new or extended)

- Word/char threshold edge cases: 29 chars / 6 words → short; 30 chars / 5 words → short; 30 chars / 6 words → proceeds.
- System prompt snapshot includes the GROUNDING RULE block (regression guard).

**`app/api/knowledge/paste/route.ts`**

- After `classifyPaste()`, branch on status:
  - `paste_too_short` → return 200 `{ status: 'paste_too_short', message: 'Paste too short to assist — fill the form manually.' }`.
  - `failed` → unchanged.
  - `parsed` → run `verifySourceSpans()`, return `{ status, draft, sourceSpans, stripped, unverified, llmNotes? }`.

**`tests/unit/knowledge-paste-route.test.ts`** (new)

- Mocks the Anthropic client. Three cases:
  1. Parser returns a clean payload (all receipts verbatim). Route returns `stripped: [], unverified: []`.
  2. Parser returns a payload where one receipt isn't in the paste. Route returns the field stripped from `draft`, name in `stripped`.
  3. Parser returns a payload where one field has no receipt. Route returns the field present, name in `unverified`.
  4. Short paste → route returns `paste_too_short`, no model call (assert via mock).

**`components/knowledge/form-helpers.tsx`** — `FieldGroup`:

- Replace `aiAttributed: boolean` with a single enum prop: `attribution: 'verified' | 'unverified' | 'none'` (default `'none'`). Plus the existing optional `source: string` (only meaningful when `attribution === 'verified'`).
- Drop the `AI` chip entirely.
- When `attribution === 'verified'` AND `source` non-empty: render the highlighted source quote under the field. Label: `From your paste:`.
- When `attribution === 'verified'` AND `source` empty: defensive fallback — treat as `'unverified'`. Should not happen under correct usage but won't crash.
- When `attribution === 'unverified'`: render a `⚠ VERIFY` chip next to the field label, with `aria-label="needs verification"` for screen readers. No source quote.
- When `attribution === 'none'`: nothing extra.

**`app/(app)/knowledge/review-paste/review-form.tsx`**

- Update fetch response typing to include `stripped: string[]`, `unverified: string[]`, new `status` value.
- `status === 'failed'` handling unchanged from today.
- `status === 'paste_too_short'`: render a top-of-form note "Paste too short to assist — fill the form manually." with the raw text already in the body field if applicable; no other field pre-fill.
- `status === 'parsed'` with `stripped.length > 0`: render a sticky top-of-form note: `Couldn't find these in your paste — fill them yourself: [field labels]`. Comma-separated. Dismissible.
- Compute the `attribution` prop per `<FieldGroup>` callsite:
  - in `unverified` → `'unverified'`
  - non-empty `sources[fieldName]` AND not in `unverified` → `'verified'`
  - else → `'none'`
- **Field-name → human-label map** lives in `review-form.tsx` alongside the existing labels (so the stripped-fields note reads "Title, Complaint, Cause" not "title, complaint, cause"). Reuses the labels already wired to each `<FieldGroup>`.

**`components/knowledge/knowledge.css`** (append)

- `.vk-fg--unverified` — amber border-left or background tint on the chip.
- `.vk-fg__chip--verify` — chip style for `⚠ VERIFY`.
- `.vk-fg__notice` — top-of-form sticky note for stripped fields and paste-too-short.

## Data flow

```
1. Curator pastes text → POST /api/knowledge/paste
2. Route:
   a. requireCurator + schema validate
   b. classifyPaste(input)
      → if paste_too_short: short-circuit, return early (no model call)
      → else: call Haiku with new grounding-mandatory prompt
   c. verifySourceSpans(paste, draft, sourceSpans)
   d. Return { status, draft, sourceSpans, stripped, unverified, llmNotes? }
3. review-paste page hydrates form
4. Form renders:
   - Top: paste_too_short message OR stripped-fields note (if any)
   - Each field: verified-quote highlight / ⚠ VERIFY chip / nothing
5. Curator reviews, edits, saves (existing flow)
```

## Error handling

- Parser throws (HTTP error, malformed JSON): route returns 502 `classifier_failed` — unchanged from today.
- Verifier is a pure function over typed input — no runtime throws expected. If a future caller passes nullish, TypeScript will catch it; if it slips through, defensive `?? {}` keeps it safe.
- Empty draft from parser but `status === 'parsed'`: route returns 200, empty form, no top-of-form note. Curator fills manually.
- All fields stripped (parser hallucinated everything): route returns 200, top-of-form note explains. Form is blank.

## Testing strategy

- **Pure-function unit tests** for `verify-source-spans.ts` — ~14 cases (including empty-paste-with-hallucinated-draft, orphan span keys, vehicleScopes pass-through).
- **Pure-function unit tests** for min-paste-length guard in `classify-paste.ts`.
- **Integration test** for `/api/knowledge/paste` with a mocked classifyPaste — 4 scenarios (clean, fabricated-receipt, no-receipt, paste-too-short-no-model-call).
- **Prompt-content regression** — asserts `CLASSIFY_PASTE_SYSTEM` contains the GROUNDING RULE substring (simple `toContain` assertion, not a full snapshot — easier to maintain).
- **`FieldGroup` component test** — three rendering modes (`attribution: 'verified'` with source, `'unverified'`, `'none'`).

## What Brandon walks

On the Vercel preview after merge:

1. **Happy path** — paste a real F-150 TSB. Review form shows highlighted source quotes under filled fields, no ⚠ VERIFY chips. Save works.
2. **Sparse-source path** (exercises Layer 2) — paste a TSB but edit it to remove a critical sentence (e.g., the Cause line). The Cause field is either empty (Layer 2 working, parser refused to fabricate) OR shows ⚠ VERIFY (parser filled without a receipt). No fake confident value.
3. **Sparse-paste path** — paste under 30 chars (e.g., "P0420 bad sensor"). Form opens empty with "Paste too short to assist — fill the form manually." No fields pre-filled.
4. **Mobile (375px)** — same flows. Top-of-form note doesn't push content off-screen. ⚠ VERIFY chips readable. Tap targets ≥ 44pt.

Note: Layer 3 (server-side substring check) is hard to exercise manually because triggering a fabricated receipt is non-deterministic. The unit + integration tests cover Layer 3 directly.

## Out of scope (logged for future)

- **Layer 1 — templated regex extraction** for TSB IDs and years. Future Root A2. Revisit after a week in production.
- **Per-item receipts for arrays.** Today `dtcList` gets one whole-array receipt. Per-item receipts overlap with Root B-DTC.
- **Per-field-within-scope receipts** for `vehicleScopes`. One receipt per scope row in this PR; finer granularity is overkill.
- **Diff view of what was stripped.** Today we just list field names. Showing the fabricated receipt next to the empty field could help; defer until Brandon sees the top-of-form note in real use.
- **Retroactive verification of existing knowledge items.** Receipts only attach at creation time. Existing items keep their current state.

## Base + LOC

- **Base:** `origin/staging`.
- **LOC estimate:** ~150.
  - verifier + tests: ~80
  - prompt rewrite + min-paste guard + tests: ~30
  - route changes + tests: ~20
  - `FieldGroup` + review-form + CSS: ~20

## Followup signals (post-launch)

Watch for after merge:

- Real-world rate of `stripped` field names — high rate means Layer 2 isn't strong enough; investigate prompt or add Layer 1.
- Real-world rate of ⚠ VERIFY chips per session — high rate means parser is leaving fields ungrounded too often; tune prompt.
- Curator complaints about the 30-char/6-word threshold — adjust constants.

## Composition note

When PR 72 (knowledge-session-citations, tool-calling refactor) merges to staging, this branch will hit a merge conflict on `CLASSIFY_PASTE_SYSTEM`. Resolution: re-apply the GROUNDING RULE block to the tool-calling-shaped prompt. The grounding rule is behavioral, not parsing-shape-specific — it composes with either prompt structure.
