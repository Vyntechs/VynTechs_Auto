# Claude Design handoff prompt — PR 6 diagnose-step citations

**For:** a fresh Claude Design session.
**How Brandon uses it:** paste everything below the `---` divider into a new Claude Design chat. Returns a package at `designs/design_handoff_knowledge_pr6/`.

---

You're Claude Design for **Vyntechs** — a tool for car-shop techs to diagnose and repair vehicles with AI guidance. Codebase: `/Volumes/Creativity/dev/projects/vyntechs/`.

## The problem

The AI proposes diagnostic steps. Sometimes it cites items from the shop's curated knowledge (a pinout, a wiring diagram, a theory of operation) to back its reasoning. When it cites, the tech needs to see *what* the AI cited so they can verify before acting. **Trust, not productivity, is the feature.**

If the AI has no shop-vetted source for a step, it silently falls back to general training data — no "no source" indicator. Techs learn the convention in onboarding.

## Product calls locked (don't redesign these)

- **WHERE** — citation surface lives in the Active Step card (under the italic rationale in `components/screens/active-session.tsx:61-130`).
- **WHEN** — diagnose phase only. Repair-phase chat-bubble citations are PR 7.
- **WHAT** — only `citedItems` (AI explicitly referenced). `consultedItems` and empty-lookup events stay silent.

## Product calls you OWN

Brandon brainstormed leanings, but they're starting points, not requirements. If you see a stronger play, propose it.

- **How does a citation appear?** Brandon's lean was a 2-line "mini-card" (type icon + title + one teaser line per type). Alternatives worth considering: inline excerpt with key data, a chip-strip that hover-cards on tap, a single accordion-style row, something hybrid.
- **Multi-item handling** — when the AI cites 3+ items, what reads best? Brandon leaned "top 2 + see-N-more." Stack-of-3 might be fine if the cards are slim enough. Your call.
- **Tap path to full content** — the existing `KnowledgeDrawer` (`components/knowledge/drawer.tsx`) already supports `ownerMode={false}` (hides Retire/Restore). Brandon leans "tap → drawer," but inline expand-in-place is also viable if it reads better on the step card.
- **Per-type teaser content** — what's the minimum info per type that lets a tech recognize which-card-is-which before tapping? Pinout, connector, wiring diagram, theory of operation, cause/fix, bulletin, note all have different structured data — design the teaser pattern accordingly.
- **Tech-mode drawer adjustments** — beyond hiding Retire/Restore (already wired via the `ownerMode={false}` prop), does anything else shift? "X fires · last edited Y" reads owner-flavored; tag emphasis might want a tweak; or maybe it's fine as-is. Keep proposals minimal — the owner experience is the source of truth.
- **Retired-but-cited treatment** — an item the AI cited earlier that the owner has since retired. The citation persists historically (we don't scrub the past). How should that read in the citation surface?
- **Empty state** — when the AI returns a step with zero citations, Brandon's lean is "render nothing — no border, no placeholder." Confirm or push back.

## Mobile is critical

375–414px viewports. Most techs use iPhone. Tap targets ≥ 44pt. The "see more" affordance (or whatever you design) must remain tappable on narrow.

## The data you're designing for

A cited item is a `KnowledgeListRow` (see `lib/knowledge/list.ts`). Fields available:

- `type` — one of `pinout`, `connector`, `wiring_diagram`, `theory_of_operation`, `cause_fix`, `bulletin`, `note`, `reference_doc`.
- `title` — same string the drawer shows in its header.
- `structuredData` — type-specific:
  - **pinout**: `connector_ref` + `pins[]` (pin_number, signal_name, wire_color, expected_voltage_or_waveform, notes)
  - **connector**: `connector_id`, `component_name`, `location_description`, `image_ref`, `mating_end_image_ref`
  - **wiring_diagram**: `name`, `image_ref`, `connections[]` (from_component, from_pin, to_component, to_pin, wire_color, splice_id, notes)
  - **theory_of_operation**: `sections[]` (heading, body)
  - **cause_fix**: `complaint`, `cause`, `correction`, `first_check`
  - **bulletin**: `source`, `bulletin_id`, `link`, `summary`, `body`
- `vehicleScopes` — array of year/make/model/engine/trim.
- `dtcList`, `systemCodes`, `symptoms`, `fireCount`, `retired`, `retiredAt`, `updatedAt`, `body`.

## Important — this supersedes an earlier draft

The PR 5 design package at `designs/design_handoff_vehicle_knowledge/` already contains a `SessionInlineEmbedStates.jsx` you drafted earlier for the ORIGINAL PR 6 plan (inline `[ref:item_id]` token replacement, expandable embeds inside chat-message text, "AI consulted N items" audit trace). **That plan was retired.** Product needs above are different. Visual vocabulary you developed (the `vk-embed` shell, type chips, hairline borders, scope chip styling) is reusable — the overall shape isn't. Free to remix or start fresh.

## Constraints

- Existing visual language: serif + mono typography, ivory/bone backgrounds, paper-on-paper layering, document feel. CSS tokens are prefixed `vt-*` (`--vt-paper`, `--vt-bone-50`, `--vt-rule`, `--vt-fg-2`, `--vt-font-serif`, etc.). Knowledge-domain classes are `vk-*`. No arbitrary hex.
- No new dependencies.
- Owner experience on `/knowledge` must NOT regress — tech-mode is purely additive (drawer prop already wired).

## Read first

- `components/screens/active-session.tsx` — Active Step card layout.
- `components/knowledge/drawer.tsx` — the existing drawer; note `ownerMode` prop.
- `components/knowledge/glyph.tsx` — TYPE icons (`<TypeGlyph type={item.type} />`).
- `components/vt/` — Module, Pill, Risk, Tag primitives.
- `designs/design_handoff_vehicle_knowledge/` — your prior package and the superseded inline-embed draft.
- `app/globals.css` for `vt-*` token definitions and existing card/module patterns.

## Output

Land the package at `designs/design_handoff_knowledge_pr6/`. Match the PR 5 package shape:

- `README.md` — your design decisions and rationale (especially where you deviated from Brandon's leanings).
- `SPEC.md` — design spec at the same depth as PR 5's.
- React component files for whatever you design (mini-card, stack wrapper, anything else).
- CSS file with any new classes.
- `canvas.html` + `design-canvas.jsx` (or extend the existing one) — visual preview.
- `SampleData.jsx` extension — sample citation items per type so the canvas has real content.
- PNGs of the states you decide are worth seeing, desktop + mobile.

## What you DO NOT need to design

- Retrieval logic, server route, schema migration, hook wiring — main session handles all that. You're the visual layer.
- "Honest absence" indicators or "consulted but not cited" surfaces — explicitly out of scope.
- Repair-phase chat bubble citations — that's PR 7, different shape.
