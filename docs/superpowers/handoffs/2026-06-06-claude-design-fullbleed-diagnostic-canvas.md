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

## Resolved with Brandon (content/behavior — his calls; the *look* is still yours)
1. **The focus unit is the step/test.** The canvas shows **only the data needed for that specific step/test**, contextually — nothing more. (Not "a part" or "a neighborhood" as the unit — it's *what this step/test requires*.)
2. **Recede = fade, not vanish.** As the walk progresses, irrelevant parts fade to a faint background (the tech keeps their place in the whole truck); they don't disappear.
3. **Tap a part → a concise, part-specific detail surface.** When the tech taps a part, show the data that pertains to *that part*. For the fuel-pressure regulator, e.g. (illustrative, not exhaustive):
   - the **connector**
   - **how many wires / pins** (e.g. "10")
   - **what each wire does**
   - **location**
   - a short **"Operational Theori"** — a tight theory-of-operation snippet. **"Operational Theori" is the intended label, spelled with an `i` on purpose — do NOT autocorrect to "Theory."**
   - **Hard content rule: short and concise — every word must count for the tech.** No filler. This is the only place prose appears, and it earns its space or it's cut.
   - *(Data source note: pins/wires/location already exist per-component in the data model — `componentPins` + `components.location`; the Operational Theori snippet draws from the component's own prose — `components.function`/`role`/`wireSummary`/`body` — NOT the architecture-facts theory rows. See the principle note below.)*
4. **Curator-only completeness.** The "X captured / Y still missing" data-status is for **curator-access roles only** — hidden from technicians and owners. (All users with curator access see it; no one else.)

### ⚠️ Principle check (carried from a standing decision — confirm, don't trip it)
Brandon previously set: *"theory of operation is a SOURCE that feeds the canonical topology + diagnostic engine — it must NEVER render as a side panel on a wiring/diagnostic surface."* The per-part **Operational Theori** above is consistent with that **only if** it is the tight, on-tap, single-part snippet drawn from the component's own prose (`function`/`role`) — NOT a persistent theory panel and NOT a dump of the architecture-facts theory rows. Keep it on-demand, one-part, every-word-counts. If it grows into a standing panel, it violates the principle.

---

**Cross-ref:** This surface draws data produced by the system-data-ingest line (`docs/superpowers/handoffs/2026-06-06-system-data-ingest-pr2-handoff.md` — PR0/PR1 viewer, PR2 write path, PR3 draft synthesis). Heading toward the staging-curator / V2 line, not prod, for a while.
