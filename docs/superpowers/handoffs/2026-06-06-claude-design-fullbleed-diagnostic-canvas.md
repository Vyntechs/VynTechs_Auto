# Claude Design Brief — The Diagnostic Canvas (full-bleed, step-aware)

**Date:** 2026-06-06 · **From:** planning session (system-data-ingest line) · **For:** Claude Design (you own the visual + interaction design end-to-end).

**How to use this:** This is a problem statement + Brandon's intent + hard constraints + where the code lives. **Brandon's specifics are LEANINGS, not locked specs** — push back where your craft says better. The *how* (mechanics, motion, visual language, exact placement) is yours to invent. Resolve the open detail questions WITH Brandon in your session; don't guess.

---

## The problem (today)
The interactive diagnostic diagram is currently **one boxed element inside a document.** Look at the live page (`/curator/topology?symptom=p0087-fuel-rail-pressure-too-low`): a left nav rail, a header, a row of scenario controls, a right-hand "click a part" detail panel, and a captured/missing footer all **compete with the map for space.** The map is cramped into what's left, and the chrome around it is **static** — it shows the same things no matter what the tech is doing. It reads like a web page with a widget in it, not a tool.

## The intent (Brandon — confirmed, this is the spine)
1. **The diagram IS the workspace.** Full real estate. It shouldn't fight other elements for room — it gets the room, and everything else lives *within* it.
2. **Step-aware / only-what's-needed-now.** This is the governing rule: at each step of the diagnosis, the canvas shows **only the parts and the single piece of context that step needs.** Everything irrelevant **recedes.** Unneeded info/context is not neutral — it **actively causes pain and confusion** for the tech mid-job. A tech tracing the lift-pump circuit should not be staring at the whole harness.
3. **Diagnostic context lives within the canvas** (scenario state, the live "now showing" reading, the click-a-part probe info, data-status) — appearing when relevant and **getting out of the way**, never sitting on top of the part the tech is working on.
4. **Scope: BOTH surfaces.** The tech's live diagnostic screen AND the curator preview are the same canvas. (Curator-only meta — e.g. the "captured / still-missing" data-completeness summary — may differ by role; a tech doesn't need it.)

## Grounding context (keep it honest + consistent with the product)
- **The diagnostic "walk" already exists as a guided wizard (discrete steps).** The step-aware canvas is the *visual body* of that walk — the wizard's current step drives what the canvas shows. Don't design a separate stepper UI fighting the canvas; the canvas IS the step's expression.
- **Provenance honesty is core, not decoration.** Each part carries a source grade. Today: AI drafts read **"inferred from theory"** (the AI will *never* say "confirmed" until a human field-verifies — by design), and gaps render amber **"needs field check."** Keep a quiet **see-source / why-do-we-believe-this** affordance (AI is a tool with evidence, never an oracle) — woven in, not a loud badge wall.
- **Never show "step N of M" or upcoming-work previews.** Show only what's done + what's now; the system computes next silently. (Standing product principle — the step-aware idea is the same principle made visual.)
- **No "AI" word anywhere in the UI.** Frame around the source / the action / the part.
- **Mobile (375–414px) MUST pass.** The full-bleed, step-aware idea has to degrade gracefully to a phone — this is a hard gate, not a nice-to-have.
- **Premium pro-tool conventions, NOT default-AI aesthetic.** No decorative dotted grids, verdict pills, uniform-Tailwind-spacing, or emoji icon cards. The current renderer is plain react-flow (dotted grid, default node boxes) — that's the *starting point to elevate*, not the target. Research real premium diagnostic / pro-tool conventions first.
- **Reuse the finished curator desktop kit:** `components/vt/desktop/` (+ its v2 CSS, locate in-repo) is a curator-grade kit. It's **desktop-only** — supply your own mobile CSS.

## What's OPEN (your call — invent here)
- HOW the canvas **focuses and recedes** between steps (zoom-to-relevant, dim, collapse, reflow — your craft).
- WHERE/HOW the context elements appear and get out of the way. Brandon said "overlays" — that's a leaning. If a different model serves "only what's needed now" better (e.g. the canvas reframing itself around the active part rather than literal floating panels), **propose it.**
- The visual language; the form of the detail/probe surface, the scenario controls, the provenance/see-source affordance.

## Explicitly NOT in scope here
- The data + save path (the DB write contract / research-mining — separate, already built). Do **not** change the DB, the loader contract, or the `SystemDataDraft` shape. This brief is purely the diagnostic **surface's shape and behavior.**

## Where the code lives (to ground yourself + see it live)
- **Preview page:** `app/curator/topology/page.tsx` → renders `TopologyDiagnostic`.
- **Screen:** `components/screens/topology-diagnostic.tsx`.
- **Canvas + parts:** `components/topology/*` — `topology-diagram.tsx`, `topology-node.tsx`, `scenario-bar.tsx`, `topology-detail-panel.tsx`, `captured-missing-footer.tsx`, `topology.css`.
- **The data it draws:** `lib/diagnostics/load-system-topology.ts` (the `SystemTopology` shape — components, connections, scenarios, provenance, gaps) + `topology-layout.ts`.
- **See it live:** `PORT=3210 pnpm dev` → `/curator/topology?symptom=p0087-fuel-rail-pressure-too-low` (also `...?symptom=no-start-cranks-normally-fuel-system-suspect`). Reusable screenshot tool: `node .design-shots/sheet.mjs`.
- **Figma (Brandon's earlier premium-look direction):** https://www.figma.com/design/2yV1UfK9asjRnMoJds0eNG?node-id=2-2

## Open detail questions to resolve WITH Brandon (don't guess)
- **What is "a step" in tech terms?** One test action? One component under inspection? One branch of the walk? (This anchors the focus unit.)
- **During a probe, what single piece of context is non-negotiably on-screen?** (Likely the expected-vs-actual reading for the selected part — confirm.)
- **What does "recede" mean for the rest of the map** — dimmed-but-present (keep orientation) vs. hidden (max focus)? Trade-off: orientation vs. zero-noise.
- **Curator vs. tech deltas:** what does the curator need on-canvas that the tech must NOT see (and vice versa)?

---

**Cross-ref:** This surface draws data produced by the system-data-ingest line (`docs/superpowers/handoffs/2026-06-06-system-data-ingest-pr2-handoff.md` — PR0/PR1 viewer, PR2 write path, PR3 draft synthesis). Heading toward the staging-curator / V2 line, not prod, for a while.
