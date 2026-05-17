# PR 3 design — Structured forms for rich content types

**Status:** Brainstormed 2026-05-16 in fresh PR 3 session. Implementation-plan to follow this doc.
**Branch:** `feat/knowledge-rich-forms` cut from `origin/staging` (which has PR 2 merged at `523340e`).
**Master spec:** `docs/superpowers/specs/2026-05-16-vehicle-knowledge-platform-design.md` (lives on `feat/vehicle-knowledge-platform-spec`; not merged but treated as canonical for this work).
**Kickoff:** PR 3 kickoff at `docs/superpowers/handoffs/2026-05-16-knowledge-pr3-kickoff.md` (same branch as master spec).

This doc captures decisions made during PR 3's pre-implementation brainstorm — choices the master spec left open or that exploration of the existing codebase revealed.

---

## Decisions locked

### 1. Image bucket — reuse `artifacts`, not a new `knowledge-images` bucket

The master spec said "Supabase Storage bucket `knowledge-images` with shop-scoped RLS." Exploration found that `lib/storage/client.ts` already has working upload/signed-url helpers against an `artifacts` bucket (used by `/api/sessions/[id]/capture` and the existing audio-capture flow). The helpers run with the service-role key, so RLS on the bucket itself is moot — access control happens at the route layer (`requireCurator()`) plus path namespacing.

**Decision:** Reuse the `artifacts` bucket. Knowledge image keys follow the path:

```
knowledge/<shopId>/<knowledgeType>/<uuid>.<ext>
```

`knowledgeType` is one of `connector`, `wiring_diagram` (extensible if a future type needs images). The `shopId` segment is defense-in-depth — a leaked signed URL still cannot be reused after expiry, and the storage key inside `knowledge_items.structured_data` is only reachable via shop-scoped DB rows (which ARE under RLS).

**Why not a new bucket:** Two helpers, two monitors, two retention policies, two failure surfaces — for an internal tool where the auth boundary is already enforced at the row level, the second bucket would be ceremony without security gain.

### 2. Image formats — JPG, PNG, SVG (per spec)

Brandon overruled the JPG/PNG-only recommendation and kept SVG, which the master spec listed.

**SVG security handling:**
- Server-side: validate the uploaded bytes start with `<svg` (after BOM strip) — rejects HTML-with-`.svg`-extension tricks at upload time.
- Reject anything > 10MB regardless of format.
- Client-side: **never** inline-embed SVG into the DOM. Always render through `<img src={...} />` — this sandbox prevents `<script>` execution per the HTML spec.
- Documented in `lib/storage/knowledge-image.ts`: "SVG must be rendered via `<img>` tags only, never inlined."

**Why not full sanitization (DOMPurify, etc.):** Curator-only upload path + `<img>`-only render + path-scoped storage keys makes the residual risk extremely small for an internal tool. Adding a sanitization pass would bring a heavy dependency for marginal benefit. If we ever expose SVG to non-curator users, revisit.

### 3. AI prompt design — research-informed, then drafted in this PR

The kickoff doc explicitly said brainstorming applies for prompt shape. A Sonnet research subagent was dispatched to survey OEM pinout / theory-of-operation source formats (Mitchell1, AllData, Ford TIS, GM SI, Identifix). The prompt design folds in the survey findings before this design is finalized. Implementation will live in:

- `lib/knowledge/parse-pinout.ts` — Haiku call: raw OEM pinout paste → `{ status, draft: { pins: PinRow[], connector_ref?: string }, sourceSpans }`
- `lib/knowledge/parse-theory.ts` — Haiku call: long theory text → `{ status, draft: { title?: string, sections: TheorySection[] }, sourceSpans }`

Both follow the `classify-paste.ts` pattern exactly: same Haiku model env (`ANTHROPIC_HAIKU_MODEL`), same `cachedSystem()` helper, same DI-friendly `AnthropicLike` type for tests, same throw-on-bad-shape contract that the route handler turns into a 502.

---

## Files to add / modify

### New files

- `lib/knowledge/parse-pinout.ts` — Haiku-backed parser; system prompt, schema, DI.
- `lib/knowledge/parse-theory.ts` — Haiku-backed parser; system prompt, schema, DI.
- `lib/storage/knowledge-image.ts` — upload + signed-url helpers scoped to the `knowledge/` path namespace. Re-uses `supabase.storage.from('artifacts')`; mirrors `lib/storage/client.ts` shape (DI-friendly upload fn).
- `app/api/knowledge/parse-pinout/route.ts` — owner-only; thin wrapper around `parsePinout()`.
- `app/api/knowledge/parse-theory/route.ts` — owner-only; thin wrapper around `parseTheory()`.
- `app/api/knowledge/upload-image/route.ts` — owner-only; multipart upload; size + MIME + magic-byte validation; returns `{ storageKey, signedUrl }`.
- `tests/unit/knowledge-parse-pinout.test.ts` — prompt-output-shape tests with mocked Anthropic client.
- `tests/unit/knowledge-parse-theory.test.ts` — same.
- `tests/unit/knowledge-image-upload.test.ts` — MIME validation, size cap, SVG magic-byte gate.
- `tests/unit/knowledge-rich-save.test.ts` — schema validators reject malformed `pinout` / `connector` / `wiring_diagram` / `theory_of_operation` and accept well-formed ones.

### Modified files

- `lib/knowledge/save.ts` — extend `SimpleSaveSchema` (rename to `KnowledgeSaveSchema` and re-export old name for backwards compat? No — `SimpleSaveSchema` was a deliberate name reflecting the PR 2 limitation; PR 3 replaces it with `KnowledgeSaveSchema` covering all 8 types. Remove `RICH_TYPES_NOT_YET_SUPPORTED` and its handling.
- `app/api/knowledge/save/route.ts` — drop the `RICH_TYPES_NOT_YET_SUPPORTED` 400-gate block; use the new full-coverage schema.
- `app/(app)/knowledge/page.tsx` + a new `rich-form.tsx` component — placeholder UI for the rich types (type picker, per-type form, image upload control, "parse with AI" button on pinout/theory). The current `paste-form.tsx` keeps handling the simple types.

### Storage helpers — minimal duplication strategy

`lib/storage/knowledge-image.ts` is a small, focused file that:
- Imports `supabase` from `lib/storage/client.ts` (reuses the lazy-proxy client; no second client instance).
- Defines an injectable upload type identical to `StorageUploadFn` in the existing file.
- Exposes `uploadKnowledgeImage({ shopId, knowledgeType, bytes, mimeType, upload? })` returning the storage key.
- Exposes `knowledgeImageSignedUrl(storageKey, expiresInSec?)` — thin wrapper over `createSignedUrl` on the artifacts bucket.

No refactor of `lib/storage/client.ts`. That file's `uploadArtifact` keeps its session-scoped semantics. The two helpers coexist cleanly.

---

## Per-type save schema shapes

```ts
PinoutSchema = z.object({
  type: z.literal('pinout'),
  ...CommonFields,
  body: z.string().max(20_000).optional(),
  structuredData: z.object({
    connector_ref: z.string().min(1).max(120),
    pins: z.array(z.object({
      pin_number: z.string().min(1).max(8),
      signal_name: z.string().min(1).max(120),
      wire_color: z.string().max(40).optional(),
      expected_voltage_or_waveform: z.string().max(200).optional(),
      notes: z.string().max(500).optional(),
    })).min(1).max(120).refine(arr => {
      const nums = arr.map(p => p.pin_number)
      return new Set(nums).size === nums.length
    }, { message: 'duplicate pin_number values' }),
  }),
})

ConnectorSchema = z.object({
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

WiringDiagramSchema = z.object({
  type: z.literal('wiring_diagram'),
  ...CommonFields,
  body: z.string().max(20_000).optional(),
  structuredData: z.object({
    name: z.string().min(1).max(200),
    image_ref: z.string().min(1).max(500),
    connections: z.array(z.object({
      from_component: z.string().min(1).max(120),
      from_pin: z.string().max(20).optional(),
      to_component: z.string().min(1).max(120),
      to_pin: z.string().max(20).optional(),
      wire_color: z.string().max(40).optional(),
      splice_id: z.string().max(60).optional(),
      notes: z.string().max(500).optional(),
    })).max(200).optional().default([]),
  }),
})

TheoryOfOperationSchema = z.object({
  type: z.literal('theory_of_operation'),
  ...CommonFields,
  body: z.string().max(20_000).optional(),
  structuredData: z.object({
    title: z.string().min(1).max(200),
    sections: z.array(z.object({
      heading: z.string().min(1).max(200),
      body: z.string().min(1).max(20_000),
    })).min(1).max(40),
  }),
})
```

Image reference fields (`image_ref`, `mating_end_image_ref`) store the storage key, not the signed URL. Signed URLs are generated on read by the future Knowledge UI (PR 5) and the AI tool result rendering (PR 6).

---

## Error contracts

Same as PR 2:

- `requireCurator()` → 401 unauthed / 403 forbidden.
- Invalid JSON → 400.
- Schema validation fails → 422 with Zod issues.
- AI assist call fails → 502 with error message (form falls back to manual fill per master spec failure-mode table).
- Image upload validation fails (too big, bad MIME, bad magic bytes) → 422 with explicit reason.
- Storage upload fails → 500 (rare; logged).

---

## Test plan

### Unit

1. `parse-pinout.test.ts` — feeds known OEM-style pastes through a mocked Anthropic client returning expected JSON; verifies the parser returns the right shape, normalizes wire colors per the prompt rules, and throws on bad JSON / wrong status.
2. `parse-theory.test.ts` — same shape for theory paste → sections.
3. `knowledge-image-upload.test.ts` — MIME accept-list, 10MB cap, magic-byte gate (SVG must start with `<svg`, JPG must have `FFD8FF` header, PNG must have `89504E47` header), shop-scoped path generation.
4. `knowledge-rich-save.test.ts` — for each of the 4 rich types, schema accepts a well-formed example and rejects: missing required field, duplicate pin numbers (pinout), empty sections array (theory), image_ref over length cap.

### Integration

5. `knowledge-rich-save-route.test.ts` — POST to `/api/knowledge/save` with each rich type; verifies the row + vehicle rows land in DB; owner gate enforced; cross-shop write rejected (RLS).
6. `knowledge-upload-image-route.test.ts` — POST multipart to `/api/knowledge/upload-image`; verifies storage key returned, gate enforced, oversize/wrong-MIME rejected.

### Verification

- `pnpm test` — full suite green.
- `pnpm exec tsc --noEmit` — clean.
- `pnpm build` — clean.
- Mobile viewport (375–414px) — the placeholder rich-form is usable (no horizontal scroll, image upload control visible).
- Manual on Vercel preview: create one item per rich type end-to-end, including image upload from iPhone.

---

## What this PR explicitly does NOT do

- Pretty UI. Per kickoff: "Frontend design (UI is placeholder until PR 5)." The forms work but look like the PR 2 paste form — system fonts, inline styles, no design polish.
- Retrieval / AI tool integration. That's PR 4.
- Cross-references (`related_item_ids`) UI. Item-detail view doesn't exist yet; manual linking is a PR 5 surface.
- Draft saves. The `structured_data.draft = true` flag is planned for PR 5 when the list filter UI exists; PR 3 saves are always final.
- Edit / retire / restore. Same — those surfaces live on item detail (PR 5).

---

## AI prompt rules (locked from research findings)

Research subagent surveyed Mitchell1 ProDemand, AllData, Ford TIS, GM SI, Identifix, and several OEM-format references for what real pinout / theory paste content looks like. Findings drive these rules baked into the system prompts.

### `parse-pinout.ts` — rules taught to Haiku

1. **Don't require a header row.** Real pastes are often body-only (techs select rows, not the table header). Infer column meaning from content shape: a token starting with a digit or letter-then-digit (`1`, `12`, `A1`, `C3`, `C1-3`) is a pin number.

2. **Wire color conventions vary by manufacturer.** Preserve color tokens exactly as pasted — do NOT canonicalize to a single style. Examples that are all valid:
   - GM: `BLK`, `LT GRN`, `DK BLU/WHT`, `PNK/BLK` (space-separated `LT`/`DK` modifiers are part of the color, NOT separators)
   - Ford: `YEL`, `GRY/BLK`, `LT GRN/RED`
   - Toyota: `B` (Black), `W`, `R`, `G` (Green), `L` (Blue), `BR`, `R/G` (Red w/ Green tracer)
   - Chrysler: `BK`, `BK*` (asterisk = tracer), `BK/RD*`
   - Generic SAE J1128: `BRN`, `WHT`, `BLU`, `GRY`

3. **Slash means tracer — keep slashes intact.** `DK BLU/WHT` is ONE color (dark blue with white tracer), not two fields. Never split on slash.

4. **GM circuit-number column trap.** Real GM tables often have 4 columns: `Pin | Color | Circuit# | Function`. The circuit number is a 3–4 digit integer (e.g., `1867`, `451`) that is NOT pin data. If a column between color and function contains only 3–4 digit integers with no alphabetic chars, treat it as a circuit reference and DROP it (do not stuff it into `expected_voltage_or_waveform`).

5. **Empty cells stay empty.** `—`, `N/A`, `N.C.`, blank — all map to omitted optional fields. Never coerce to `0` or `null`-as-string.

6. **Prose-embedded pin descriptions count.** "Pin 3 is the 5V reference (LT GRN wire)" should parse as `{ pin_number: "3", signal_name: "5V reference", wire_color: "LT GRN" }`.

7. **Non-breaking spaces in pasted OEM HTML.** Treat ` ` as a regular space when extracting fields.

8. **Connector ID inline.** `C1-3` means Connector 1, Pin 3 — store `pin_number: "C1-3"` (preserve as-is); the form's `connector_ref` field captures the connector separately.

### `parse-theory.ts` — rules taught to Haiku

1. **Split on blank-line-preceded ALL-CAPS or Title Case lines.** These are the section headings. Examples seen in real OEM theory text: `SYSTEM DESCRIPTION`, `COMPONENTS`, `SYSTEM OPERATION`, `MODES OF OPERATION`, `Description and Operation`, `System Description`. Accept any heading shape; don't require specific names.

2. **Prose is the norm; bullets are the exception.** OEM theory sections are 2–4 paragraph prose blocks per section, not bullet lists. Preserve paragraph structure within each section's `body`.

3. **Acronym spellings on first use are part of the body.** `"Engine Control Module (ECM)"` — keep the spelled form in the body text, don't trim.

4. **No markdown in raw paste.** Bold/italic are lost in plain-text paste. The output `body` is plain text; the UI renders as-is. Do NOT inject markdown syntax that wasn't there.

5. **If no clear section structure exists, return one section.** A single paragraph of theory text becomes `{ sections: [{ heading: "Description", body: "<text>" }] }`. The owner can split manually in the form.

### Status field behavior

Same as `classify-paste.ts`:
- `"parsed"` — extracted at least one pin row (pinout) or one section (theory).
- `"failed"` — paste is empty, gibberish, or fundamentally not a pinout / theory text.

Throw on bad JSON or wrong-shape responses; route handler returns 502 so the UI falls back to manual form fill.

### Cited sources (for future tuning)

- GM 4-column format examples: prostreetonline.com, troubleshootmyvehicle.com
- Color code references: SAE J1128 standard, stanwatkins.com (Chrysler), automasterx.com (Toyota)
- Theory text structure: GM SI documentation, autoditex.com generic OEM format reference

---

## Open items (resolved in execution)

- **Placeholder UI shape.** The PR 2 paste form is one screen with a "Get AI proposal" button + a review pane. The PR 3 rich-form needs a type picker first, then per-type form fields, then a save button. Drafting in code; no separate design pass.
