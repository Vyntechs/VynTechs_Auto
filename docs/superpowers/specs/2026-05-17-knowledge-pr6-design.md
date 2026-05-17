# PR 6 design — Cited-source mini-cards on the Active Step card

**Status:** Brainstormed 2026-05-17 in fresh PR 6 session. **Supersedes the earlier `2026-05-16-knowledge-pr6-kickoff.md` plan** (which scoped inline `[ref:item_id]` token-based embeds + a "consulted N items" audit-trail surface). The new scope is tighter: card-style citations only, diagnose-phase only, no audit-trail surface. Repair-phase becomes PR 7.

**Branch:** `feat/knowledge-session-citations` — cut from `origin/main` per current branching rule.
**Master spec:** `docs/superpowers/specs/2026-05-16-vehicle-knowledge-platform-design.md` (lives on `feat/vehicle-knowledge-platform-spec`) — retrieval section provides context; PR 6 re-scopes the master plan's PR 6 section.
**Kickoff:** `docs/superpowers/handoffs/2026-05-17-knowledge-pr6-kickoff.md`
**Claude Design handoff:** drafted in chat at brainstorm completion; package lands at `designs/design_handoff_knowledge_pr6/` once Claude Design returns it.

---

## Why this scope, not the original

The original PR 6 plan assumed the AI would emit `[ref:item_id]` tokens inline in its reply text, and the client would parse and replace them with embed components. Two problems with that:

1. **AI reliability.** Asking the model to emit precise tokens (`[ref:01H...]`) inline alongside natural language adds a generation failure mode (forgotten brackets, malformed IDs, half-quoted refs). Better to keep citation IDs in a structured field on the tree node and let the UI render them as a stack — no parsing required.
2. **Surface complexity.** The original plan covered seven type-specific embed renderers (compact pinout table, theory excerpt, wiring thumbnail, connector mini-card, plus three chip variants) + an "AI consulted N items" trace surface + tap-to-expand animations. That's a lot for one PR. The new scope reuses the existing `KnowledgeDrawer` for ALL types — the inline surface is a single mini-card component with a per-type teaser, and tap → drawer for the full content.

The new scope also drops the explicit "consulted N items" trace. Per Q2 of the brainstorm, only `citedItems` surface; `consultedItems` and empty-lookup absence are silent. Onboarding teaches the convention.

---

## Decisions locked

### 1. Diagnose phase only

Surface PR 6 cards inside the **Active Step card** in `ActiveSession` (`components/screens/active-session.tsx`). Repair-phase chat-bubble citations land in PR 7.

Reasoning: "ground the next step" is diagnose-phase language. The Active Step card has a clear anchor (the italic-serif rationale paragraph) for citations. Chat-bubble citations are a different problem shape and earn their own PR.

### 2. Cited only — absence implicit

Show source cards for items in `citedItems` (AI explicitly referenced in its rationale). Don't surface `consultedItems` (AI looked but didn't cite) or empty-lookup events (AI checked, shop has no curated knowledge — falls back to training data). No chip on a step = "no shop-vetted source for this step" by convention.

Reasoning: techs are hand-trained weekly; the convention is teachable. Big-tech AI tools must surface absence loudly because they serve strangers; vyntechs doesn't.

### 3. Docket-row stack visual treatment

**Updated 2026-05-17 after Claude Design handoff.** The package shipped three variants and recommended **Docket** over Brandon's MiniCard lean. Brandon picked Docket.

Each citation renders as a hairline-divided row inside the Module body (no card chrome). Row anatomy:
- Type glyph (left, 22px, currentColor)
- Meta line: TYPE label (mono caps), optional "Retired" tag
- Title (serif, up to 2 lines)
- **Type-aware peek** — pinout shows first pin data inline (`pin 31 · Boost pressure · GN/WT · 0.5-4.5 V analog`); wiring shows first connection (`Boost sensor B → PCM C175 31 · GN/WT`); bulletin shows source + ID + summary; theory/cause-fix/connector/note show italic-serif prose
- Chevron (right)

Tap a row → existing `KnowledgeDrawer` opens in `ownerMode={false}` (hides Retire/Restore).

Reasoning Claude Design gave (visible in `Citations.jsx` and `citations.css` comments): the REASON a pinout gets cited is the pin data. Showing the first pin's data inline lets the tech recognize *why this card matters* before tapping. MiniCard's generic teaser is the same shape regardless of type. And hairline rows read as IN the Module rather than next to it.

The per-type peek shape is implemented in `lib/knowledge/citation-peek.ts` as a pure function returning either `{ kind: 'prose', text }` or `{ kind: 'data', segments }` (mono-rendered segments with optional dim styling for separators/labels).

### 4. Persistence on tree nodes

Citation IDs persist onto the `TreeNode` payload so cards survive page refresh, browser close, and return-to-session-later visits.

Schema change: add `citationItemIds: string[]` field to `TreeNode` in `lib/ai/tree-engine.ts` (and matching zod validator). `tree_state` is already a JSON column on `sessions`, so **no SQL migration is required**.

Write semantics: **append + dedupe**, not overwrite. If a turn produces new cited items for the same `currentNodeId`, merge into the existing array (Set semantics). Reasoning: across turns the AI's grounding for a step may grow as it consults more knowledge; the step's source backing should accumulate.

### 5. Top 2 + "see N more sources"

Render based on `citationItemIds.length` (= N after hydration):

- **N = 0** → render nothing (no border, no placeholder, no header label).
- **N = 1** → one mini-card, no link.
- **N = 2** → two mini-cards, no link.
- **N ≥ 3** → two mini-cards + a faint "see N more sources" link that expands the rest in place; re-collapses on a second tap.

Ranking comes from the order the AI cited them in (the order they appear in `citationItemIds`). Not a numeric score — simpler than persisting scores and trusts AI's own ordering as the relevance signal.

### 6. Per-type peek formula

Claude Design proposed a type-aware peek (data vs. prose) instead of a uniform "teaser" line. Implemented in `lib/knowledge/citation-peek.ts` as `getCitationPeek(item)`:

| Type | Peek shape | Source fields | Example |
|---|---|---|---|
| `pinout` | data (mono) | first pin's `pin_number / signal_name / wire_color / expected_voltage_or_waveform` | `pin 31 · Boost pressure · GN/WT · 0.5-4.5 V analog` |
| `connector` | prose (italic-serif) | `location_description ?? component_name` | `Behind kick panel, driver side` |
| `wiring_diagram` | data (mono) | first connection's `from_component → to_component · wire_color` | `Boost sensor B → PCM C175 31 · GN/WT` |
| `theory_of_operation` | prose | first section's `body ?? heading` | `Commanded vs. actual boost…` |
| `cause_fix` | prose | `correction ?? cause ?? complaint` | `Replace cold-side CAC pipe.` |
| `bulletin` | data (mono) | `source bulletin_id · summary` | `Ford TSB 18-2218 · Updated CAC pipe…` |
| `note` / `reference_doc` | prose | `body` | (whatever's there) |

Missing/empty fields fall through to a type-specific generic label (`"Pin reference."`, `"Shop note."`, etc.). 20 unit tests in `tests/unit/citation-peek.test.ts` cover the formula per type + the robustness cases.

### 7. Retired-while-cited

If the cited item has `retired === true` at view-time, render the mini-card with a faint "retired" mark (e.g., corner mono caps). Tap → drawer opens normally (the drawer already shows a RETIRED indicator in its header at `components/knowledge/drawer.tsx:85-95`). The citation persists in the historical record of what AI saw at cite-time.

### 8. Tech-readable lookup endpoint

New route `GET /api/knowledge/[id]` returns one `KnowledgeListRow` shape, shop-scoped via `requireProfile()`, **no `canCurate` gate**. Used by the citation drawer to hydrate by id.

Authorization:
- Profile must belong to a shop (401 otherwise).
- Row must belong to the same shop (404 otherwise — not 403, to avoid leaking existence of cross-shop items).
- Retired items ARE returned (the historical-citation requirement).

---

## Files to add / modify

### New files

- `app/api/knowledge/[id]/route.ts` — GET, shop-scoped, no curator gate.
- `components/screens/active-step-citations.tsx` — reads `currentNode.citationItemIds`, hydrates via the new route, renders mini-card stack with top-2 + see-all logic, manages the see-more expand state.
- `components/knowledge/citation-mini-card.tsx` — the 2-line mini-card. Visual landed by Claude Design package; this file imports the Claude-Design-provided component.
- `lib/knowledge/teaser.ts` — per-type teaser formula. Pure function `getTeaser(item: KnowledgeListRow): string`.
- `tests/unit/knowledge-teaser.test.ts` — formula per type, truncation behavior.
- `tests/unit/active-step-citations.test.ts` — component renders correct number of cards; "see N more" toggle works; retired mark appears when applicable.
- `tests/integration/knowledge-id-route.test.ts` — shop-scoped read; cross-shop returns 404; unauth returns 401; retired item is returned.
- `tests/e2e/knowledge-session-citation.spec.ts` — diagnose session with an AI turn that cites a known pinout; tech sees the mini-card; tap opens the drawer in tech-mode (no Retire button); refresh persists the card.

### Modified files

- `lib/ai/tree-engine.ts` — extend the `TreeNode` zod schema with `citationItemIds: z.array(z.string()).optional()`. Backwards-compatible (optional field; older nodes have no field, render no citations).
- `app/api/sessions/[id]/advance/stream/route.ts` — after the advance turn produces a new tree state, attribute `citedItems.map(i => i.id)` onto the node matching `tree.currentNodeId`, merging with any existing IDs (Set semantics). Persist to DB as part of the normal tree-save path. Continue emitting `citedItems` in the `done` event for backwards compat (and for optimistic client-side render before refresh).
- `lib/use-advance-stream.ts` — stop discarding `citedItems` from the `done` event (currently dropped at lines 105–112). Hold them in hook state to support optimistic render. **No server round-trip from client** — the server already attributed them in the route handler.
- `components/screens/active-session.tsx` — render `<ActiveStepCitations citationItemIds={active.citationItemIds} />` directly below the rationale paragraph (currently lines 96–124). Server component; fetches happen via the new route.

### No-change files (reused as-is)

- `components/knowledge/drawer.tsx` — already supports `ownerMode={false}`. No edits (modulo any minor tech-mode polish Claude Design proposes).
- `lib/knowledge/retrieval.ts` — retrieval logic unchanged.
- `lib/knowledge/tools.ts` — tool wiring unchanged.
- `lib/advance-stream-events.ts` — event types already carry `citedItems` (PR 4 plumbed it through).

---

## Data model — citation IDs on the tree node

```ts
// lib/ai/tree-engine.ts
type TreeNode = {
  id: string
  label: string
  rationale?: string
  // ... existing fields ...
  /** PR 6. Knowledge item IDs the AI cited when grounding this node's
   *  rationale. Append-only with dedupe: new IDs appear at end if not
   *  already present; duplicates are skipped. Order reflects FIRST
   *  citation order, not most-recent. Older nodes have no field —
   *  render no citations. */
  citationItemIds?: string[]
}
```

`tree_state` is a JSON column on `sessions`. No SQL migration. Zod validator gets the optional field; existing sessions decode fine.

---

## Citation lifecycle

1. **Advance turn server-side** (`app/api/sessions/[id]/advance/stream/route.ts`) — AI calls a knowledge tool, retrieval produces `MatchedKnowledgeItem[]` with score ≥ threshold, items end up in `citedItems` per PR 4.
2. **Attribute to current node** — before emitting the `done` event, look up `tree.currentNodeId`, merge `citedItems.map(i => i.id)` into that node's `citationItemIds` array (Set semantics, preserve order). Persist the updated tree to the sessions table.
3. **Emit `done` event** — payload still includes `citedItems` per PR 4 (backwards-compat).
4. **Client receives `done`** — `useAdvanceStream` holds `citedItems` in state; the page can render citations optimistically against the new tree state before next reload.
5. **Page reload / return-to-session** — `ActiveSession` server-renders from DB-hydrated tree state. `active.citationItemIds` drives `<ActiveStepCitations>` which fetches the full rows via `/api/knowledge/[id]`.

---

## What Claude Design owns

A separate Claude Design session is briefed via the handoff prompt drafted in chat. The package they return at `designs/design_handoff_knowledge_pr6/` will include the visual layer:

- **Mini-card visual** — type-icon glyph (reuse `TypeGlyph`), title typography, teaser typography, border treatment, padding, hover/tap states.
- **Card stack layout** — gap between cards, alignment with the rationale paragraph above, "see N more sources" link styling (text vs. chevron vs. row).
- **Tech-mode drawer review** — beyond hiding Retire/Restore (already wired), does the footer need to shift (e.g., "fires count" relabeled, tag emphasis adjusted)? Expected minimal.
- **Retired badge** — visual treatment of the faint "retired" mark on a cited card; confirmation the drawer's existing RETIRED chip is enough.
- **Mobile layout (375–414px)** — the stack on a narrow viewport.
- **No-citation empty state** — confirm "no chip rendered, no border, no placeholder" is the deliberate visual.

The implementation plan (writing-plans output) will be drafted **after** the design package returns; UI-component file paths and styling details depend on what Claude Design ships.

---

## Acceptance gates (verification before merge)

**Automated:**
- All new unit / integration / e2e tests pass.
- TypeScript strict, build clean.
- Existing PR 4 tests still pass (no regression in `consultedItems`/`citedItems` plumbing).

**Manual (Brandon on iPhone + desktop):**
- Mobile viewport (375–414px) — citation stack reads cleanly; tap target ≥ 44pt; drawer opens.
- New diagnose session with a vehicle that has shop knowledge — AI cites a pinout, mini-card appears, tap opens drawer without Retire/Restore buttons.
- Refresh mid-session — mini-cards re-appear from persisted tree state.
- Vehicle with no shop knowledge — no chips, no awkward "no data" surface (silent fallback works).
- Owner viewing the same session — sees the same tech-mode drawer (no Retire on this surface; `/knowledge` page still has owner drawer with Retire).
- Cited item retired by owner mid-session — refresh shows "retired" mark; tap opens drawer with RETIRED chip; no error.
- "See N more sources" affordance — visible only when >2 citations; expands in place; re-collapses on second tap.

**Out of scope for this PR (PR 7+ work):**
- Repair-phase chat-bubble citations.
- "Consulted but not cited" audit-trail surface.
- "Honest absence" explicit indicator on no-citation steps.
- Cross-shop knowledge sharing (citations from another shop).
