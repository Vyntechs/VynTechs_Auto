# Kickoff — Design Phase: the step-aware diagnostic canvas (+ experience & theming makeover)

**Date:** 2026-06-06 · **For:** the NEXT fresh session (run this FIRST after `/clear`) · **Owner:** Brandon (non-technical founder — plain English; he reacts to concrete options, he does not author specs).

**Session-start paste (one line):** "Run the design phase — read `docs/superpowers/handoffs/2026-06-06-design-phase-kickoff.md` on branch `feat/system-data-ingest`. Start with the workflow; bring me options before building."

---

## The mandate (Brandon's words, captured)
Don't just *finish* the canvas design — **refine the whole user/technician experience for maximum value, efficiency, and a felt sense of satisfaction with every interaction, view, click, tap, and read.** Bring a **team of master problem-solvers** to **reduce the cognitive load / thinking required of each user at each step.** **Theming and all user-facing UI are open for a makeover.**

## The spine (already decided — do NOT re-litigate; see the design brief)
Read first: **`docs/superpowers/handoffs/2026-06-06-claude-design-fullbleed-diagnostic-canvas.md`** — it carries Brandon's confirmed principle and the resolved details:
- **Diagram IS the workspace** (full real estate), on BOTH the tech's live screen and the curator preview.
- **Step-aware / only-what's-needed-now:** show only what the current step/test needs; everything else **fades (not vanishes)**; unneeded context actively hurts the tech.
- **Tap a part → pull (not push) its data:** connector, # wires/pins, what each wire does, location, and a short **"Operational Theori"** (spelled with the `i` — intentional, do NOT autocorrect). Short, concise, every word counts. What *leads* on tap is step-aware.
- **Curator-only completeness** ("captured / still-missing") — hidden from techs/owners.

## ⛔ The one hard guardrail
**Produce researched OPTIONS Brandon reacts to; build the one he picks; refine WITH him. Never black-box to a "final."** A workflow that auto-finishes a design with no options + no reactions yields the generic default-AI look Brandon explicitly rejects (dotted grids, verdict pills, uniform spacing, emoji cards). Research real premium pro-tool / diagnostic conventions BEFORE generating any UI.

## The approach — a Workflow (the "team of master problem-solvers")
Author a Workflow (ultracode is on) with these phases. The Figma BUILD is interactive on the main thread (Brandon present); the workflow does the research/critique/options fan-out.

1. **Phase: Panel (parallel expert lenses)** — independent agents, each returning concrete, researched direction + critique (NOT vibes):
   - *Premium pro-tool patterns* — how elite diagnostic/CAD/map/pro tools handle a full-bleed canvas + on-demand detail (research real products, cite them).
   - *Cognitive-load-per-step* — for each step of the diagnostic walk, what is the minimum the tech must see; what to fade; what one thing leads. Goal: zero unneeded thinking.
   - *Step-aware canvas mechanics* — how focus/fade/reframe behaves as the walk advances (the wizard's current step drives the canvas).
   - *Theming & visual language* — a premium system (type, color, motion, density) that can propagate app-wide; reuse the curator desktop kit (`components/vt/desktop/` + its v2 CSS) where it fits, supply mobile.
   - *Mobile (375–414px)* — how the full-bleed/step-aware idea degrades gracefully (hard gate).
   - *"Felt value" per interaction* — what makes each view/click/tap/read feel satisfying and trustworthy (incl. provenance honesty, see-source).
2. **Phase: Synthesize → 2–3 coherent DIRECTIONS** — distinct, named, each a complete take (not a feature list). Adversarially check each against the spine + guardrail.
3. **Phase: Brandon reacts & picks** — present the directions concretely (mockups/screens), he points at one (+ grafts).
4. **Phase: Build in Figma** — interactive, main thread. **Load the Figma skills FIRST** (`figma-use` before any `use_figma`; `figma-generate-design` for screens; `figma-generate-library`/tokens for theming). Figma is **already connected** (verified 2026-06-06 as Brandon's pro team, `brandon@vyntechs.com`) — a quick `whoami` to confirm it's still live, then build (no interactive auth expected).
5. **Phase: Implement + refine** — translate the chosen direction into code (the canvas first as spearhead), then refine per-interaction with Brandon. Propagate the visual language outward only after the canvas proves it.

## Sequencing (don't boil the ocean)
**Canvas is the spearhead** — it establishes the interaction feel + visual language. Theming and the broader user-facing UI makeover follow *from* the canvas direction, not in parallel. One coherent language, propagated — not five surfaces redesigned at once.

## Standing constraints (non-negotiable)
- **No "AI" word** in any user-facing copy/badge.
- **No "step N of M"** / no upcoming-work previews — show only done + now.
- **Mobile must pass** (375–414px).
- **Provenance honesty:** the AI's drafts read "inferred from theory," gaps read "needs field check"; keep a quiet see-source path. AI is a tool with evidence, never an oracle.
- **Don't touch the data/save path** (system-data-ingest PR0–PR3 are done; this is purely the surface). Don't change the DB or the loader contract.

## Inputs / where things are
- Design brief: `docs/superpowers/handoffs/2026-06-06-claude-design-fullbleed-diagnostic-canvas.md`
- System-data line state: `docs/superpowers/handoffs/2026-06-06-system-data-ingest-pr2-handoff.md` (PR0/PR1 viewer, PR2 write path, PR3 draft synthesis — all committed).
- Code: `components/screens/topology-diagnostic.tsx`, `components/topology/*`, `app/curator/topology/page.tsx`; data via `lib/diagnostics/load-system-topology.ts`.
- See it live: `PORT=3210 pnpm dev` → `/curator/topology?symptom=p0087-fuel-rail-pressure-too-low`. Screenshot tool: `node .design-shots/sheet.mjs`.
- Figma: https://www.figma.com/design/2yV1UfK9asjRnMoJds0eNG?node-id=2-2 (Brandon's earlier premium-look direction).

## First 3 moves for the next session
1. Read this kickoff + the design brief. Quick `whoami` to confirm Figma's still connected (it was, as Brandon's pro team) — proceed unless it's dropped.
2. Launch the Panel workflow (Phase 1–2) → bring Brandon 2–3 concrete directions.
3. Only after he picks: build in Figma, then implement the canvas. Refine with him.
