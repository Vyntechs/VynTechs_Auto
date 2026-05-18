# Root B (DTC) — Normalize-on-input + sub-code preservation

**Status:** Spec'd 2026-05-17, scope locked after brainstorm with Brandon.

**Branch:** `feat/knowledge-root-b-dtc-normalize` off `origin/staging`.

**Parent roadmap:** `docs/superpowers/specs/2026-05-17-knowledge-trust-and-integrity-roadmap.md` → "Root B (DTC subset)".

## What this fixes

One root cause solved: **#5 — DTC format drift.** Today the same code typed five different ways becomes five different library strings, and the filter / AI lookup can't see across them.

Three concrete symptoms collapse onto this fix:

1. **Drift across input shapes.** `p0420`, `P 0420`, `P-0420`, `P0420-00` all save as different strings in the knowledge_items.dtc_list arrays.
2. **Filter blindness.** The `/knowledge` filter bar uppercases the input but does nothing else — `P-0420` typed into the filter literally fails to find a stored `P0420`.
3. **A latent bug in the existing normalizer.** `lib/knowledge/normalize.ts` rejects any DTC with a hex character in the body (e.g. `P0A80`, a real Toyota Prius hybrid code) because the regex is decimal-only.

This PR is also the first product-level decision about **sub-code tails** (`-00`, `:11`, the "failure type byte" per SAE J2012). Brandon's call: preserve them as orthogonal metadata, never as part of the library-identity key.

## Architecture — three changes, one mechanism

The normalizer is the single source of truth for what a DTC string is. Everything else is plumbing.

- **Layer A — Normalizer rewrite.** `normalizeDtc` returns `{ canonical, subCode } | null` instead of `string | null`. Fixes the hex-body bug, adds prefix-strip, letter-O → digit-0 auto-fix, sub-code capture.
- **Layer B — Wire to input.** TagInput accepts an optional `normalize` prop; the 5 DTC callsites pass it. FilterBar normalizes on blur. Hard-rejects (red border, inline error) replace silent acceptance.
- **Layer C — Persist + display sub-codes.** New optional `dtcSubCodes` JSONB column on `knowledge_items`. Storage of the canonical bare codes in `dtc_list` is unchanged; sub-codes ride alongside as a per-DTC map. UI renders `P0420 ·00` when a sub-code is present.

The library's identity / dedup / search / AI-lookup logic continues to operate on the bare canonical `dtc_list`. Sub-codes are pure metadata — they enrich display, they never gate matching.

## Locked decisions

| Decision | Choice | Why |
|---|---|---|
| Sub-code tail handling | Preserve as orthogonal metadata; library identity = bare code only | Same fix recipe for `P0420` regardless of which scan tool surfaced which tail. Tail still visible on the chip so the diagnostic detail isn't lost. |
| Storage shape for sub-codes | New `dtc_sub_codes JSONB` column on `knowledge_items`, shape `{ "P0420": "00" }` | Cleanest decoupling — `dtc_list` stays a plain `text[]` of canonical bare codes; sub-codes are a sparse map. No delimiter tricks, no schema gymnastics, search/dedup/AI-lookup logic untouched. |
| Garbage input | Hard reject inline; chip won't accept | DTCs are structured. One-second friction (retype) beats permanent bad data in the library forever. |
| `PO420` → `P0420` (letter O → digit 0) | Silently auto-fix in normalizer | Unambiguous: `O` is not a valid hex character, so the substitution can't collide. Single most common character-level typo per research. |
| Prefix-word stripping (`DTC P0420`, `code: P0420`) | Silently strip in normalizer | Real shop input pattern (copy-paste from emails / TSB write-ups). Strip the wrapper, normalize the code. |
| Existing rows | Leave as-is; no backfill | Risk discipline. Items will drift to canonical as they get re-edited. One-shot cleanup is a separate PR only if real usage shows demand. |
| AI parser prompt (`classify-paste.ts`) | Leave alone in this PR | Already says "bare OBD-II codes ('P0420' not 'P0420-00')." Changing the prompt to also surface sub-codes adds AI-tool-schema risk that should land with its own evidence. The AI's `dtcList` output already flows through `normalizeDtc` on save, so the new return shape just discards a `null` subCode — behavior unchanged from AI side. |
| Filter bar normalization | On blur only (not on every keystroke) | Keeps the filter responsive while the tech is typing partial codes (`P04`); only normalizes when they finish typing or move on. |

## Files

### New

**`drizzle/migrations/0015_knowledge_dtc_subcodes.sql`** — migration.

```sql
ALTER TABLE knowledge_items
  ADD COLUMN dtc_sub_codes jsonb;
-- Nullable, default NULL. Shape: { "P0420": "00", "P0430": "11" }
-- Only populated when a sub-code tail was typed; entries are keyed by canonical
-- bare DTC. Entries WITHOUT a sub-code are simply absent from the map (we do
-- not store explicit nulls). The map is filtered on save/update to only include
-- keys whose DTC is currently in dtc_list.
```

No data backfill — existing rows get `NULL` and that's the correct empty value.

**`tests/unit/normalize-dtc.test.ts`** — unit tests for the rewritten normalizer.

### Modified

**`lib/knowledge/normalize.ts`** — rewrite `normalizeDtc`.

New shape:

```ts
export type NormalizedDtc = { canonical: string; subCode: string | null }

export function normalizeDtc(input: string): NormalizedDtc | null
```

Behavior:

1. Trim. Return null if empty.
2. Uppercase the whole string.
3. Strip a leading narrative prefix: `^(CODE|DTC)[\s:]+` (applied after step 2's uppercase). Handles `code P0420`, `DTC: P0420`, `DTC:P0420`, `Code  P0420`. Requires at least one space or colon after the prefix word so we don't strip prefixes off shapes like `CODEP0420` (which isn't a real input shape anyway).
4. Strip ALL remaining whitespace (e.g. `P 0 4 2 0` → `P0420`).
5. After steps 1–4 the string is a contiguous run of letters/digits with at most one `-` or `:` left as a separator before a sub-code tail. Split at the first `-` or `:` whose position is **6 or later** (i.e. immediately AFTER the 5-character base). Everything before is the base candidate; everything after is the sub-code tail. If no `-` / `:` exists at position ≥6, the whole string is the base candidate and tail is empty.
6. Strip any `-` or `:` characters that remain INSIDE the base candidate (e.g. `P-0420` → `P0420`). These are dashes/colons at positions 1–5; they can only exist if the original input had a dash/colon inside the 5-char base, like `P-0420`.
7. Apply the letter-O fix: in positions 2–5 of the base candidate only, replace any `O` with `0`. Position 1 stays as a letter.
8. Validate: base candidate must match `^[PBCU][0-3][0-9A-F]{3}$`. If not, return null.
9. If a sub-code tail was captured (non-empty), validate against `^[0-9A-F]{2}$`. If the tail is present but invalid, **the function still returns the canonical base** (the noisy tail is discarded) — `subCode` is set to null.
10. Return `{ canonical, subCode }`.

Cases:
- `"p0420"` → `{ canonical: 'P0420', subCode: null }`
- `"P 0420"` → `{ canonical: 'P0420', subCode: null }`
- `"P-0420"` → `{ canonical: 'P0420', subCode: null }`
- `"P0420-00"` → `{ canonical: 'P0420', subCode: '00' }`
- `"P0420:11"` → `{ canonical: 'P0420', subCode: '11' }`
- `"PO420"` → `{ canonical: 'P0420', subCode: null }` (letter-O fix)
- `"DTC: P0420"` → `{ canonical: 'P0420', subCode: null }`
- `"code p0420-FF"` → `{ canonical: 'P0420', subCode: 'FF' }`
- `"P0A80"` → `{ canonical: 'P0A80', subCode: null }` (hex body, bug fix)
- `"Z0420"` → `null` (invalid first letter)
- `"P042"` → `null` (too short)
- `"P0G20"` → `null` (G is not hex)
- `"P0420-XYZ"` → `{ canonical: 'P0420', subCode: null }` (bad tail dropped, base preserved)
- `""` → `null`
- `"   "` → `null`

**`lib/knowledge/save.ts`** — handle new return shape, persist sub-codes.

The current code:

```ts
const normalizedDtcs = Array.from(
  new Set(
    (input.dtcList ?? [])
      .map((d) => normalizeDtc(d))
      .filter((d): d is string => d !== null),
  ),
)
```

becomes:

```ts
const normalizedPairs = (input.dtcList ?? [])
  .map((d) => normalizeDtc(d))
  .filter((p): p is NormalizedDtc => p !== null)

const dtcSet = new Set<string>()
const subCodesByDtc: Record<string, string> = {}
for (const p of normalizedPairs) {
  dtcSet.add(p.canonical)
  if (p.subCode !== null) subCodesByDtc[p.canonical] = p.subCode
}
const normalizedDtcs = Array.from(dtcSet)
const dtcSubCodes = Object.keys(subCodesByDtc).length > 0 ? subCodesByDtc : null
```

Then the insert row sets `dtcSubCodes: dtcSubCodes`. **Conflict policy:** if the same canonical DTC appears multiple times with different tails (e.g. `["P0420-00", "P0420-11"]`), the **last one wins.** This matches existing dedup behavior (`new Set`) — the first save wins for the dtc itself; the iteration order wins for the tail. Documented in the function header.

**`lib/knowledge/update-item.ts`** — same treatment as save.ts (the same DTC-normalization block exists at update-item.ts:19).

**`lib/knowledge/retrieval.ts`** — extract `.canonical` only; sub-codes are not part of AI retrieval matching.

```ts
const normalizedDtcs = (input.dtcs ?? [])
  .map((d) => normalizeDtc(d))
  .filter((p): p is NormalizedDtc => p !== null)
  .map((p) => p.canonical)
```

No other change. The AI-retrieval scoring continues to operate on bare canonical codes from `dtc_list`.

**`lib/db/schema.ts`** — add the column to the `knowledgeItems` table definition.

```ts
dtcSubCodes: jsonb('dtc_sub_codes').$type<Record<string, string> | null>(),
```

**`components/knowledge/form-helpers.tsx`** — TagInput accepts an optional `normalize` and `displaySuffix` prop.

```ts
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
  // When provided, runs on commit. Returns the canonical string to store and an
  // optional suffix to display alongside the chip. Returning null hard-rejects.
  normalize?: (raw: string) => { value: string; suffix?: string | null } | null
  // When provided, looks up a per-chip suffix to display from a parallel map.
  // Used for re-rendering existing items where the suffix was captured in a
  // separate prop (e.g., dtcSubCodes).
  displaySuffix?: (value: string) => string | null
}) {
  // ... unchanged chip + input render structure ...
  // On Enter/comma:
  //   - if normalize is provided:
  //     - run it on draft; if null, set error state, do NOT add chip
  //     - if non-null, add { value, suffix } to a parallel internal map and call setValues
  //   - if no normalize, current behavior
  // Render chip: value + suffix (when present) rendered as a small grey span next to the value
}
```

The internal challenge: TagInput today takes `values: string[]` and stays stateless. To carry sub-codes per chip without breaking the simpler symptom/system callsites, we keep `values: string[]` as the canonical store and add a separate `suffixes?: Record<string, string>` prop on the *callsite* (the form). TagInput pulls suffix-for-display from `displaySuffix(value)`. Callers that don't pass `displaySuffix` get no suffix — unchanged behavior.

Hard-reject UX: when `normalize` returns null, the input gets a red `vk-taginput__input--error` class for one render cycle (cleared on next keystroke) plus a `vk-taginput__error` line showing "Not a valid DTC — try P/B/C/U + 4 digits (e.g. P0420)."

**`app/(app)/knowledge/new/connector/connector-form.tsx`** — DTC TagInput callsite.

```tsx
<TagInput
  values={dtcs}
  setValues={setDtcs}
  placeholder="P0562"
  normalize={normalizeDtcForChip}
  displaySuffix={(dtc) => dtcSubCodes[dtc] ?? null}
/>
```

Where `normalizeDtcForChip` is a small wrapper in `lib/knowledge/normalize.ts` adapter:

```ts
export function normalizeDtcForChip(raw: string): { value: string; suffix: string | null } | null {
  const n = normalizeDtc(raw)
  if (!n) return null
  return { value: n.canonical, suffix: n.subCode }
}
```

And `setDtcs` is extended to also update a sibling `dtcSubCodes` state map. New form state shape (per form):

```ts
const [dtcs, setDtcs] = useState<string[]>(existing?.dtcList ?? [])
const [dtcSubCodes, setDtcSubCodes] = useState<Record<string, string>>(
  existing?.dtcSubCodes ?? {},
)
```

A small helper in form-helpers.tsx makes this pair manageable:

```ts
export function useDtcChips(initial: { dtcs: string[]; subCodes: Record<string, string> }) {
  const [dtcs, setDtcsRaw] = useState(initial.dtcs)
  const [subCodes, setSubCodes] = useState(initial.subCodes)

  const handleNormalized = (next: Array<{ value: string; suffix: string | null }>) => {
    const newDtcs: string[] = []
    const newSub: Record<string, string> = {}
    for (const { value, suffix } of next) {
      newDtcs.push(value)
      if (suffix) newSub[value] = suffix
    }
    setDtcsRaw(newDtcs)
    setSubCodes(newSub)
  }
  // ... return handlers
}
```

Each of the 5 DTC TagInput callsites (connector, pinout, theory, wiring, review-paste) uses this hook. On save, the form passes `dtcSubCodes` alongside `dtcList`.

**`app/(app)/knowledge/new/pinout/pinout-form.tsx`** — DTC TagInput callsite (same pattern).

**`app/(app)/knowledge/new/theory/theory-form.tsx`** — DTC TagInput callsite (same pattern).

**`app/(app)/knowledge/new/wiring/wiring-form.tsx`** — DTC TagInput callsite (same pattern).

**`app/(app)/knowledge/review-paste/review-form.tsx`** — DTC TagInput callsite (same pattern). Sub-codes from the AI paste flow are unlikely (the AI prompt strips them today) — `dtcSubCodes` initializes empty unless the tech adds tails manually.

**`lib/knowledge/save.ts` schema** — extend `CommonFields` to accept the new optional input. Both the keys and values are constrained:

```ts
dtcSubCodes: z
  .record(
    z.string().regex(/^[PBCU][0-3][0-9A-F]{3}$/),  // key: canonical DTC
    z.string().regex(/^[0-9A-F]{2}$/),             // value: 2-hex-char tail
  )
  .optional(),
```

And on the insert row, set `dtcSubCodes: normalizedSubCodes` (computed as above) — filtered to only contain keys that are present in the final `dtc_list` (so stale entries can't sneak in).

**`lib/knowledge/list.ts`** — query-side normalization for the filter bar.

```ts
import { normalizeDtc } from '@/lib/knowledge/normalize'

// In listKnowledgeItems, replace:
//   if (filter.dtc) {
//     conditions.push(sql`${filter.dtc} = ANY(${knowledgeItems.dtcList})`)
//   }
// with:
if (filter.dtc) {
  const n = normalizeDtc(filter.dtc)
  if (n) {
    conditions.push(sql`${n.canonical} = ANY(${knowledgeItems.dtcList})`)
  } else {
    // Filter value didn't normalize — no item can possibly match.
    return []
  }
}
```

**`app/(app)/knowledge/page.tsx`** — apply normalization when reading the `dtc` query param.

```ts
// existing:
const dtc = singleParam(sp.dtc); if (dtc) filter.dtc = dtc.toUpperCase()
// becomes:
const dtcRaw = singleParam(sp.dtc)
if (dtcRaw) {
  const n = normalizeDtc(dtcRaw)
  // If the filter value is itself garbage, we still set it so the list code
  // can short-circuit to "no results" rather than dropping the filter silently.
  filter.dtc = n ? n.canonical : dtcRaw
}
```

**`components/knowledge/filter-bar.tsx`** — normalize on blur (not on every keystroke).

```tsx
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
```

**`components/knowledge/drawer.tsx`** — chip display picks up sub-codes.

```tsx
// existing line ~132:
{item.dtcList.map(d => <span className="vk-tag vk-tag--dtc" key={d}>{d}</span>)}
// becomes:
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

**`components/knowledge/row.tsx`** — same treatment for the row chip display.

**`lib/knowledge/list.ts` return type + `components/knowledge/drawer.tsx` props** — `KnowledgeListRow` and the drawer's item prop already inherit from `KnowledgeItem`, so adding `dtcSubCodes` to the schema row gives it to both surfaces automatically. No prop plumbing.

**`components/knowledge/knowledge.css`** — append:

```css
.vk-tag__sub {
  margin-left: 2px;
  font-size: 0.85em;
  color: #6b7280;
  font-weight: 400;
}

.vk-taginput__input--error {
  border-color: #ef4444 !important;
  background: #fef2f2;
}

.vk-taginput__error {
  color: #b91c1c;
  font-size: 12px;
  margin-top: 4px;
}
```

## Data flow

```
Owner types "p0420-00" in the chip
  → TagInput onKeyDown(Enter) → normalizeDtcForChip("p0420-00")
  → returns { value: "P0420", suffix: "00" }
  → form state: dtcs = [..., "P0420"], dtcSubCodes = { ..., "P0420": "00" }
  → chip renders: P0420 ·00

Owner submits the form
  → POST /api/knowledge → save.ts saveKnowledgeItem({ dtcList: ["P0420"], dtcSubCodes: { "P0420": "00" } })
  → save runs normalizeDtc again (defense in depth) → dtcList: ["P0420"], dtcSubCodes: { "P0420": "00" }
  → INSERT INTO knowledge_items (..., dtc_list, dtc_sub_codes) VALUES (..., '{P0420}', '{"P0420":"00"}')

Owner re-opens the item later
  → loaded as KnowledgeListRow { dtcList: ["P0420"], dtcSubCodes: { "P0420": "00" }, ... }
  → drawer + chip rendering shows P0420 ·00

Owner types "P-0420" in the /knowledge filter bar
  → onBlur → normalizeDtc → { canonical: "P0420", subCode: null }
  → URL updates: ?dtc=P0420
  → page server-component reads dtc, normalizes again (defense in depth), passes "P0420" to list.ts
  → SQL: "P0420" = ANY(dtc_list) → matches the item above

Owner types "Z0420" in the chip
  → normalizeDtcForChip → null
  → TagInput shows red border + "Not a valid DTC" inline
  → no chip added, no state change
```

## Error handling

- **Normalizer:** pure function, no throws. Returns null on every garbage shape.
- **TagInput hard-reject:** error-state UI only; no exceptions, no console noise.
- **Save / update:** garbage DTCs that somehow slip through the chip (e.g., API direct callers, the AI parser returning unexpected shapes) are still filtered out by `normalizeDtc().filter(p => p !== null)`. Sub-codes get filtered to only keys present in the final `dtc_list`.
- **Filter bar garbage input:** the page sets the filter to the raw uppercased string; `list.ts` runs `normalizeDtc` on it, gets null, returns `[]`. No 500. The filter UI shows the garbage value the user typed (so they see what they searched for) and an empty result set.
- **Existing rows with non-canonical DTCs:** unaffected. They'll match queries against their literal stored form, just like today.

## Testing strategy

- **Pure-function unit tests** for the rewritten `normalizeDtc` — cover every row in the table under "Files → normalize.ts" plus a few mixed-cases (multiple spaces, mixed-case sub-code, prefix-word edge cases).
- **`save.ts` integration test** — sub-codes flow through to the persisted row.
- **`update-item.ts` integration test** — sub-codes round-trip on edit, including the case where a chip is removed (its sub-code drops too).
- **`list.ts` filter test** — `?dtc=p-0420` finds an item stored as `P0420`; `?dtc=garbage` returns `[]` without 500.
- **TagInput hard-reject test** — typing `Z0420` + Enter doesn't add a chip; typing `P0420-00` + Enter adds a `P0420` chip with `·00` suffix display.
- **Drawer + row snapshot test** (or unit test) — chip rendering with sub-codes.

## What Brandon walks

On the Vercel preview after merge:

1. **Manual entry with tail** — open any DTC chip (e.g. on the connector form), type `P0420-00`, press Enter. Chip appears as `P0420 ·00`. Save the item. Re-open the drawer — chip still shows `P0420 ·00`. Filter `/knowledge` by `P0420` — finds it. Filter by `P0420-00` — also finds it.
2. **Letter-O typo fix** — type `PO420`. Chip appears as `P0420` (no warning, silent fix).
3. **Prefix word strip** — type `DTC: P0420`. Chip appears as `P0420`.
4. **Hex body** — type `P0A80`. Chip appears as `P0A80` (today this gets rejected; bug fix).
5. **Garbage reject** — type `Z0420`. Chip won't add; red border, inline "Not a valid DTC."
6. **Filter normalization** — in the `/knowledge` filter bar, type `p-0420` and tab away. Input collapses to `P0420`. List shows matching items.
7. **Mobile (375px)** — same flows. Inline error and sub-code suffix readable.
8. **Existing items unchanged** — open any pre-existing knowledge item — DTCs render as they did before (no sub-codes on legacy items).

## Out of scope (logged for future)

- **One-shot cleanup of pre-existing non-canonical DTCs** in the live DB. Could be a separate small script run via Supabase MCP if real usage shows search misses on legacy data.
- **AI paste-flow prompt change** to capture sub-codes from the paste. The prompt currently says "bare OBD-II codes" — leaving it alone. The AI output flows through the new normalizer on save and just discards `null` sub-codes (behavior unchanged). Revisit if curators ask for it.
- **Vehicle make/model normalization.** Root B (vehicle picker) — separate root.
- **Symptom / system-code normalization.** Different problem shape (free-text vs. structured list).
- **Sub-code-specific knowledge** (e.g. "this fix applies only to P0420-11"). If shop knowledge ever needs to fork by sub-code, it goes in the item body, not by fragmenting the library.
- **Re-display original-as-typed for legacy items.** The comment in the old `normalize.ts` ("UI re-displays the full code from the source paste") was never implemented and isn't worth retrofitting; new items get the sub-code suffix, old items render as-is.

## Base + LOC

- **Base:** `origin/staging`.
- **LOC estimate:** ~200.
  - normalizer rewrite + tests: ~80
  - save / update / retrieval call-site adjustments: ~30
  - TagInput + `useDtcChips` hook: ~40
  - 5 form callsite changes: ~25
  - filter bar + list.ts + page param: ~15
  - drawer + row chip rendering + CSS: ~10

Plus the small migration (1 new optional JSONB column, no backfill).

## Live-DB migration step

Per Brandon's "Apply migrations to live DB" rule, the build session must:

1. Apply migration to local rehearsal DB first (`vyntechs_rehearsal`).
2. Apply to live Supabase via MCP `apply_migration` BEFORE merging the PR.
3. Verify the `dtc_sub_codes` column appears on the live `knowledge_items` table.

## Followup signals (post-launch)

Watch for after merge:

- Real-world rate of hard-rejects on the chip → if high, the normalizer is missing a common shape; surface in logs.
- Sub-codes that show up on chips → confirms the workflow is exercised; informs whether to add the prompt change.
- `/knowledge` filter on a previously stored DTC that returns 0 results → suggests a legacy non-canonical row; consider the one-shot cleanup.

## Composition note

Root A's `verify-source-spans.ts` walks `dtcList` as a string array — no change needed for sub-codes (they're a separate field, not embedded in the dtcList strings). If a future Root A2 ever surfaces per-DTC source spans, that's the time to bring sub-codes into the receipt model.
