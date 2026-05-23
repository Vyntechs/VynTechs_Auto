# Round 3 — Opus Edition · Package (REVISED)

**Date:** 2026-05-23
**Status:** Direction locked by Brandon's hand-built prototype. Earlier Service Bulletin attempt archived in `_rejected/`.

## What's in this directory

| File | What |
|---|---|
| `topology.html` | **The lock.** Brandon's hand-built prototype. Interactive fuel system topology with role-coded animated wires + scenario simulator + click-to-probe pin panel. |
| `index.html` | Cover page · points to topology.html |
| `styles.css` | Earlier Service Bulletin tokens (unused by topology.html — that file is self-contained; this stylesheet stays for the cover and any follow-up pages built in the same direction) |
| `RATIONALE.md` | Design language extracted from the prototype + the framing change from "guided walk" to "interactive topology" |
| `_rejected/` | Earlier Service Bulletin attempt — kept for diff reference, not for review |

## How to view

Local server should be running on port 8765. If not:

```
cd mockups/topology-guidance
python3 -m http.server 8765
```

Open <http://localhost:8765/round-3-opus/> → click the "6.7L Power Stroke fuel system" card.

## The headline insight

The earlier "guided walk on the topology" framing in the kickoff was **the wrong abstraction.** Brandon's standing product principle — "wiring tool is diagnostic-complete from topology alone" — was already on disk in memory but I anchored on the kickoff instead.

The right model: **the interactive electrical topology IS the diagnostic.** Tech picks a scenario (Idle / Light load / Medium load / Heavy load / Pegged high pressure / No pressure), wires animate at the speeds those scenarios produce, tech probes the truck and compares. Diagnosis = tech's judgment, informed by the live topology, not the system's pre-sequenced answer.

The spec doc that follows is no longer `topology-guided-walk-design.md` — it's something like `interactive-electrical-topology-design.md`. The `feat/topology-guided-walk` branch name stays because it's already shipped, but the product concept underneath is different.

## What's still open (for round 4 or for the spec to address)

1. **Mobile variant.** Prototype is desktop-only. Need a 390px layout — likely stacked topology-on-top / panel-below, scenario bar collapsed.
2. **Other systems.** Prototype is fuel. Same pattern applies to cooling, charging, ignition, etc. — different components, same interaction.
3. **Data shape.** The original kickoff envisioned `diagnostic_sessions` + `tech_outcomes` writes per step. Brandon's prototype doesn't have a notion of "step" — it has scenarios and pin selections. Outcome recording may belong to a later PR; this PR ships the interactive topology surface.
4. **Persistence:** does the selected scenario persist across reloads, or always default to Idle? Probably the latter — easier mental model.
5. **Offline / loading states:** if live data isn't loaded, what does the diagram show? Probably the static topology with no animation until data arrives.
6. **Edge state:** what happens when a label gap closes (e.g., the wire color gets captured)? The diagram should update without re-flow.

## How Claude Opus resumes

When Brandon greenlights the lock:

1. **Reframe the design draft.** Rewrite the 7-section draft from the original kickoff to match this direction. Some sections (sequencing, walk routing) go away; new sections (wire roles, scenario state matrix, pin selection model, panel content shape) replace them.
2. **Write the new spec** at `docs/superpowers/specs/2026-05-23-interactive-electrical-topology-design.md` (note: new title, not "guided walk").
3. **Self-review** the spec.
4. **Hand to Brandon** for approval.
5. **Invoke `superpowers:writing-plans`** for the implementation plan.
6. **Hand off to a fresh execution session** via `superpowers:subagent-driven-development`.

The Claude Design handoff doc may also need updating — Brandon's prototype settles the visual direction that doc was asking Claude Design to figure out. A short follow-up to Claude Design (if they're still running) saying "Brandon settled this — see `topology.html`" is appropriate.

## Files referenced

- The prototype: `mockups/topology-guidance/round-3-opus/topology.html`
- Existing tokens (matched by the prototype): `app/globals.css`
- Existing topology code (parent — gets transformed by this PR): `components/topology/`, `components/screens/topology-diagnostic.tsx`
- Existing-flow research: `docs/superpowers/research/2026-05-22-existing-diagnostic-flow.md`
- Premium-UI research: `docs/superpowers/research/2026-05-23-premium-ui-research.md` (still useful for type ramp + motion principles)
- Original kickoff (now outdated on framing): `docs/superpowers/handoffs/2026-05-22-topology-guidance-brainstorm-kickoff.md`
- Claude Design handoff (may need updating): `docs/superpowers/handoffs/2026-05-23-claude-design-topology-guided-diagnostic.md`
- Live data fixture: Supabase project `ynmtszuybeenjbigxdyl`
