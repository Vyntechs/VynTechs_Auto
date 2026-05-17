# Claude Design handoff prompt — PR 6 diagnose-step citations

**For:** a fresh Claude Design session.
**How Brandon uses it:** paste the everything below the `---` divider into a new Claude Design chat. Returns a package at `designs/design_handoff_knowledge_pr6/`.

---

You're Claude Design for **Vyntechs** — a tool for car-shop techs to diagnose and repair vehicles with AI guidance. Codebase: `/Volumes/Creativity/dev/projects/vyntechs/`. Existing visual language: serif + mono typography, ivory/bone backgrounds, paper-on-paper layering, sparse "document feel" — not a typical SaaS dashboard. CSS tokens are prefixed `vt-*` (e.g. `--vt-paper`, `--vt-bone-50`, `--vt-rule`, `--vt-fg-2`, `--vt-font-serif`). Knowledge-domain classes are prefixed `vk-*`.

## What's shipping (PR 6 of the vehicle knowledge platform)

When the AI proposes a diagnostic step ("check connector C0561 for backed-out pins"), it can cite specific items from the shop's curated knowledge — a pinout, a wiring diagram, a theory of operation. The tech needs to see what the AI cited so they can verify it before acting. **Trust, not productivity, is the feature.**

Cited items appear as a small stack of mini-cards directly below the AI's rationale on the Active Step card. Tap a mini-card → existing detail drawer opens with the full content (pin table, image, theory sections).

If there are zero citations, nothing renders — by convention, no chip means the AI used its general training data, not a shop-vetted source. We don't make absence loud; the tech learns the rule in onboarding.

## Important — this supersedes the existing PR 6 draft

The PR 5 design package at `designs/design_handoff_vehicle_knowledge/` already contains a `SessionInlineEmbedStates.jsx` you drafted earlier for the ORIGINAL PR 6 plan (inline `[ref:...]` token replacement, expandable embeds inside chat-message text, "AI consulted N items" audit trace). **That plan was scrapped.** New scope:

- No inline `[ref:...]` tokens — AI doesn't emit them; citation IDs are stored structurally on the tree node.
- No audit trace ("consulted" items are not surfaced — only "cited" ones).
- No type-specific inline embed renderers — ALL types render as the same 2-line mini-card; the existing `KnowledgeDrawer` handles full content on tap.
- No expand-inline for embed content — the only inline-expansion is the "see N more sources" link when >2 items cited.
- Diagnose phase only (the step-card UI in `ActiveSession`). Repair-phase chat-bubble citations are PR 7.

You can REUSE visual vocabulary from your old draft (the `vk-embed` shell shape, type chips, hairline borders, scope chip styling) — just for a different overall shape.

## Design surfaces needed

### 1. The mini-card itself

Compact, 2 lines, full step-card width. Reads like a small index card with a glyph on the left.

- **Row 1** — TYPE icon (reuse the existing `<TypeGlyph type={item.type} />` from `components/knowledge/glyph.tsx`) + item title (the same title the drawer shows in its header).
- **Row 2** — type-specific teaser (one line, mid-word truncated with `…` at 60 chars):

| Type | Teaser content |
|---|---|
| pinout | `connector_ref · N pins` — e.g. `C0561 · 22 pins` |
| connector | `location_description` — e.g. `Behind kick panel, driver side` |
| wiring_diagram | `name · N connections` — e.g. `Body wiring · 14 connections` |
| theory_of_operation | `first section heading · N sections` — e.g. `Mass airflow basics · 5 sections` |
| cause_fix | `complaint` — e.g. `Hesitation off idle` |
| bulletin | `source · bulletin_id` — e.g. `GM · TSB 23-NA-046` |
| note / reference_doc | body, first 60 chars |

Treat the mini-card as a tap target (≥44pt). Match the existing visual vocabulary (`vt-paper`, `vt-rule`, `vt-fg-2/3`, `vt-font-serif/mono`). Tap states should feel like the existing `<Module>` cards — same hairline border treatment, same hover lightness.

### 2. The stack layout

The Active Step card already has italic-serif rationale text (`components/screens/active-session.tsx:111-124` — the `<p>` element with `style={{ fontFamily: 'var(--vt-font-serif)', fontStyle: 'italic', ... }}`). The mini-card stack sits directly below it, before the `<ActiveStepForm>`.

- Render up to 2 mini-cards.
- If >2 items cited, render the top 2 + a faint affordance "see N more sources" (link / text button / chevron — your call) that expands the rest in place. Re-collapses on second tap.
- No header label needed (no "Sourced from:" eyebrow); cards speak for themselves.
- Vertical gap between cards: match the existing Module-list gap (~8–12px).

### 3. Tech-mode drawer review

The existing `KnowledgeDrawer` (`components/knowledge/drawer.tsx`) already supports `ownerMode={false}` (hides Retire/Restore footer buttons). Open it as-is for tech-tap → full content (pin tables, images, theory sections).

**Confirm or propose:** beyond hiding Retire/Restore, does anything else need to shift in tech-mode? (e.g., "X fires · last edited Y" metadata reads weird to a non-curator; tag emphasis feels owner-flavored.) Keep proposed changes minimal — the owner experience is the source of truth.

### 4. Retired-but-cited badge

If the cited item has been retired by an owner after being cited, the mini-card shows a faint "retired" mark (corner badge or eyebrow). Tap → drawer opens with its existing RETIRED chip in the header. The citation persists historically — the AI used it at the time.

Visual: minimal — small mono caps "RETIRED" in `vt-fg-3`, no big banner. Lower priority than the title.

### 5. Mobile layout (375–414px)

Critical. Most techs use iPhone. The stack must:
- Stay readable at 375px width.
- Not cause horizontal scroll.
- Tap targets ≥ 44pt.
- The "see N more sources" affordance must remain tappable.

### 6. Empty state

When the AI returns a step with zero citations, render nothing — no border, no placeholder, no "no sources" text. Confirm this is the deliberate visual (we are NOT surfacing "no shop source for this step" — by design).

## Existing visual context to study

- `components/screens/active-session.tsx` — Active Step card layout. Lines 61–130 are the relevant Module.
- `components/knowledge/drawer.tsx` — the drawer you'll open from a tap.
- `components/knowledge/glyph.tsx` — the TYPE icons.
- `components/vt/` — Module, Pill, Risk, Tag primitives.
- `designs/design_handoff_vehicle_knowledge/` — your PR 5 package, including the `SessionInlineEmbedStates.jsx` that's being superseded but whose visual vocabulary is reusable.
- `app/globals.css` for existing card/module patterns and `vt-*` token definitions.

## Constraints

- Use `vt-*` CSS variables, not arbitrary hex.
- Match existing typography (serif body, mono eyebrows).
- No new dependencies.
- Owner experience on the `/knowledge` page must NOT regress — tech-mode is purely additive (drawer prop already wired).

## Output

Land the package at `designs/design_handoff_knowledge_pr6/`:

- `README.md` — overview of decisions, surfaces, key visuals, and how this supersedes the older `SessionInlineEmbedStates.jsx`.
- `SPEC.md` — design spec at the same depth as PR 5's.
- `ActiveStepCitations.jsx` — stack wrapper with top-2 + see-all toggle.
- `CitationMiniCard.jsx` — the mini-card component, ready to drop in.
- `knowledge-pr6.css` (or extend `vehicle-knowledge.css`) — any new classes.
- `canvas.html` + `design-canvas.jsx` (or extend the existing one) — visual preview canvas.
- `SampleData.jsx` extension — sample citation items per type so the canvas has real content.
- Visual snapshots (PNG) of:
  - Desktop: Active Step card with 0, 1, 2, and 3+ citations.
  - Mobile (375px): same four states.
  - Retired-cited mini-card.
  - Drawer in tech-mode side-by-side with owner-mode for comparison.

Match the existing PR 5 package shape (look at `designs/design_handoff_vehicle_knowledge/` for structure).

## What you DO NOT need to design

- Retrieval logic, server route, schema migration, hook wiring — main session handles all that. You're purely the visual layer.
- "Honest absence" indicators or "consulted but not cited" surfaces — explicitly out of scope for PR 6.
- Repair-phase chat bubble citations — that's PR 7, different shape, different session.
