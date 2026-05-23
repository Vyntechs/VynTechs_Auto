# Round 3 — Opus Edition · Rationale (REVISED)

**Date:** 2026-05-23
**Status:** Direction locked by Brandon's hand-built prototype. Earlier Service Bulletin attempt archived in `_rejected/`.

## What this is now

Brandon hand-built `topology.html` to show the direction he actually wants. It's not a guided walk, it's not an editorial broadsheet, it's not a checklist. **The interactive wiring topology IS the diagnostic.**

This document records the design language extracted from his prototype so the spec phase can carry it faithfully.

## The framing change (the important one)

Earlier rounds were built around the "guided diagnostic walk" abstraction from the kickoff doc — the tech goes through tests in sequence, the active step gets highlighted, branches advance to the next. **That abstraction is wrong** for this product. The right abstraction was already in the memory:

> "Wiring tool is diagnostic-complete from topology alone — canonical topology from theory is enough to diagnose; wire colors/pin numbers are labels that accelerate, not facts that enable."

The tech doesn't need a wizard. They need to see the electrical system, change scenarios to see what *should* happen at each operating state, and probe the truck to compare. The diagnosis is the *tech's* judgment, not the system's pre-sequenced answer. The system surfaces information; the tech does diagnosis.

Implication: the next spec doc is not titled "topology guided walk" — it's "interactive electrical topology" (or "fuel system topology" or similar). The `feat/topology-guided-walk` branch name stays because it's already shipped, but the conceptual model is different.

## The design language

### Layout

- **1320px max-width page** centered, 40px page padding
- **Two-column main:** diagram canvas (fluid) + sticky right panel (380px)
- **Header:** eyebrow (Inter Tight mono caps) + 44px Instrument Serif title + mono vehicle line + wire-legend swatch grid right-aligned
- **Scenario bar:** Operation pills + Fault sim pills, with the active pill in solid bone-900, fault-actives in red-coral
- **Live readout** under the canvas title: "Now showing · Engine Idle — lift pump steady, both PWM regulators at moderate duty…" with the scenario name in amber
- **Subtle horizontal graph-paper grid** behind the diagram canvas (24px lines, 0.06 opacity) — engineering paper feel without being a v0 tell
- **Footer:** two-column known-vs-missing — "Captured from theory · enough to diagnose" (green dots) + "Labels not yet captured · make probing faster, not possible" (amber circles)

### Wire role color palette (the breakthrough)

Roles, not real wire colors:

| Role | Color | Used for |
|---|---|---|
| Signal | Fresh green (`#4ca866`) | Sensor signal wires |
| 5V Ref | Burnt orange (`#c97842`) | PCM 5V reference output |
| Low Ref | Graphite (`#6b6657`) | Sensor analog ground / low reference |
| PWM Control | Chartreuse mustard (`#b3a82e`) | PCM-driven solenoid PWM lines |
| 12V | Red coral (`#b34d4d`) | Power supply |
| Ground | Black (`#1a1a1a`) | Chassis ground |

The colors are semantic, not chromatically matched to real wire colors (which the tech would already know from the WSM). They convey **what the wire does** at a glance.

### Wire animation as power flow

Wires use dashed-line stroke patterns and `@keyframes flow` to pulse in the direction of power flow. Animation **speed = activity level**:

| State | Visual | Meaning |
|---|---|---|
| `off` | static, opacity 0.16 | Wire dead — no power, no signal |
| `steady-12v` | dashed `12 4`, 2.4s flow | Continuous 12V supply |
| `steady-5v` | dashed `10 4`, 2.8s flow | Continuous 5V reference |
| `steady-gnd` | dashed `16 3`, 2.6s flow | Sinking ground current |
| `signal-rest` | dashed `6 8`, 3.2s flow, 55% opacity | Sensor at rest pressure |
| `signal-low/med/high/pegged` | progressively tighter dash + faster | Sensor activity level |
| `pwm-low/med/high/max` | dashed `5 4` to `4 2`, 1.5s to 0.22s | PWM duty cycle pulse rate |

When the tech changes scenarios, every wire's class swaps and the animation re-tunes. Power flow becomes visible. That's what makes this *interactive diagnostics* — you can see what the system is doing.

### Components as boxes with pins

Each component is a 1.2px-bordered rectangle with name + location + wire-count inside. Pins are smaller rectangles along the edges, labeled with their role abbreviation (`S`, `5V`, `LR`, `A`, `B`, `12V`, `GND`). Pin numbers are intentionally `—` (em-dash) when not yet captured — calling out the gap rather than hiding it.

- Default component: bone-50 fill, ink-900 stroke
- Mechanical component (HP Pump, PS Rail): bone-100 fill, dashed bone-400 stroke, italic name in ink-500
- Splice (shared 5V, shared LR): bone-200 fill, rounded `rx: 8`, role label inside
- Selected: amber stroke, weight 2

Pin selection highlights the wire(s) for that pin (3.5px weight + drop-shadow glow) and dims all others to 25% opacity. This isolates the circuit path.

### Side panel content (the diagnostic depth)

When a component is selected:
- **Panel kind** (Module / Pump / Sensor / Solenoid / Mechanical / Splice) in amber mono caps
- **Title** in 26px Instrument Serif
- **Subtitle** in mono
- **Kind / Location / Wires / Role** as KV rows (mono label + sans value)
- **Body prose** explaining how the component fits in the circuit
- **Probing tactic** as a separate paragraph when relevant
- **Pin list** — clickable pins on this component
- **Unknown-note** in italic mono — what's not yet captured

When a pin is selected:
- Same panel kind / title / subtitle treatment
- **Where to probe** — back-probe instruction (plain English)
- **Right now** — the live reading for the current scenario, in a dark inset box (`bg ink-900`, `color bone-50`, amber-300 scenario label). When the scenario is a fault, the box gets a red-coral left border + darker bg.
- **Expected range (overall)** — in a mono `.expect` box, signal-navy emphasis on key numbers
- **If the reading is wrong** — diagnostic logic in a `.alarm` box with red-coral left border
- **Label gap** as italic mono note

### The "Captured / Not captured" footer

Two columns, equally weighted:
- **Captured from theory · enough to diagnose** — green dot bullets listing what's known
- **Labels not yet captured · make probing faster, not possible** — amber circle bullets listing what's still labels-only

Plus an italicized note in a signal-navy-bordered inset: "Each gap above closes one at a time as techs encounter the information in the bay — paste, save, label appears on the diagram. The diagram itself doesn't wait for completion to be useful."

This is **the product principle made visible.** The tool isn't gated on perfect data. It diagnoses with what theory provides and admits what it doesn't have.

## What's locked vs open in this direction

### Locked (Brandon's prototype settled these)
- Role-coded wires + animation = the diagnostic surface
- Scenario simulator at the top of the canvas
- Pin selection → live reading + expected + diagnostic logic
- Component selection → role + body + pin list
- "Captured vs Not captured" footer
- The 380px sticky panel layout on desktop
- The bone palette + Instrument Serif + Inter Tight + JetBrains Mono token system
- "Diagnostic-complete from theory" as the eyebrow / framing line

### Open (for round 4 / further iteration)
- **Mobile.** The prototype is desktop-only. Brandon's instinct: a 390px stacked layout with the topology on top and the panel below, scenario bar collapses or moves to a tap-to-open sheet
- **Other systems beyond fuel.** This is the fuel system; same pattern needs to repeat for cooling, charging, ignition, etc. — different components, same interaction model
- **Edge cases:** what happens when the tech is offline / the live data isn't loading? When pin labels become captured (the gap closes), how does the diagram update without re-flow?
- **Persistence:** does the scenario the tech selected persist across sessions for that vehicle? Or always default to Idle?
- **Multiple vehicles in the same session:** does the topology page key off the vehicle on the session row, or can it be browsed independently?
- **The "tech_outcomes" data writes** that the original kickoff envisioned — are those still part of this PR, or do they belong to a later one? (My read: probably later. This PR ships the interactive topology; outcome recording comes when the diagnostic concept gets layered back on, if it does.)

## The earlier Service Bulletin attempt — what was wrong

Archived in `_rejected/` for diff reference. The visual aesthetic (editorial broadsheet, hero-scale serif, ink rules, restraint) was beautiful but **solving the wrong problem.** I anchored on the kickoff's "guided walk" framing instead of questioning it. Brandon's "this isn't interactive diagnostics" feedback was pointing at exactly that: the editorial pages were *reading*, not *diagnosing*.

Lessons recorded for memory:
- The kickoff's locked decisions need pressure-testing against the existing product principles. Where they conflict, the product principles win.
- "Diagnostic-complete from topology alone" was in the memory the whole time. The Service Bulletin direction ignored it.
- A working tech wants to *see the electrical system live*, not read a beautifully-typeset paragraph about it. The diagram is the surface; the prose supports it.

## How the spec consumes this

When Brandon greenlights the lock, the next phase:

1. **Refine the design draft from the original kickoff** — but rewrite section 1 ("What a tech sees") and section 3 ("Routing") completely to match this direction. Section 2 ("Order of parts") goes away — there's no sequence. Section 4 ("What gets saved") shifts — outcome writes may move to a future PR.
2. **Write the new spec** at `docs/superpowers/specs/2026-05-23-interactive-electrical-topology-design.md` (NEW title — not "topology-guided-walk-design"). Cover the wire role palette, the animation states, the scenario state matrix, the pin/component selection model, the panel content shape, the footer pattern, the data shape needed to drive it all (which differs from `tech_outcomes` writes — see "Open" above).
3. **Self-review** the spec.
4. **Hand to Brandon** for approval.
5. **Plan + execute** via `superpowers:writing-plans` and `superpowers:subagent-driven-development`.

The Claude Design handoff doc may need updating too — Brandon's prototype effectively settles the visual direction that doc was asking Claude Design to figure out. Probably worth a follow-up message to Claude Design (if they're still working) saying "Brandon settled this — see `topology.html`."

## File map

- `topology.html` — Brandon's prototype, adopted as the lock
- `styles.css` — earlier Service Bulletin tokens (unused by topology.html which is self-contained; kept here in case future round-3-opus pages reuse it)
- `index.html` — cover page pointing to topology.html
- `RATIONALE.md` — this file
- `PACKAGE.md` — resume-from-here doc
- `_rejected/` — earlier Service Bulletin attempt (in-progress.html, just-started.html, diagnosis.html, all-passed.html, in-progress-mobile.html) preserved for diff
