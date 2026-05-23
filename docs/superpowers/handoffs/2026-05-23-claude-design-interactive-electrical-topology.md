# Interactive Electrical Topology — Claude Design Handoff (Round 4)

> **⏸ DEFERRED — pick up after baseline ships.** Brandon's product call 2026-05-23 PM: ship the working baseline first, then engage Claude Design for the polish pass. This handoff stays valid as written — when the baseline is live and validated, Brandon pastes the line below to start the Claude Design session and the round-4 polish pass picks up from here. The baseline ships with: inline mobile panel (the research's bottom-sheet recommendation is what Claude Design upgrades to), a simple labelled ignition-switch widget (Claude Design upgrades to a real rotary-key-dial visual), a beefed-up live readout for the active scenario badge, hybrid captured/missing footer with a hand-written wrapper + derived rows. Everything else from the prototype is baseline-correct.

---

**Date:** 2026-05-23
**Branch:** `feat/topology-guided-walk` (name predates the framing change; concept underneath is now "interactive electrical topology" — see below)
**From:** Claude Opus (engineering / planning lane) — handing off to Claude Design (visual lane)
**Supersedes:** the earlier morning handoff `docs/superpowers/handoffs/2026-05-23-claude-design-topology-guided-diagnostic.md` (written before Brandon's prototype settled the macro direction)

**Brandon's one-line paste to start a Claude Design session:**

```
Read docs/superpowers/handoffs/2026-05-23-claude-design-interactive-electrical-topology.md — design the round-4 polish layer for the interactive electrical topology. You should be on branch feat/topology-guided-walk; if not, git fetch && git switch feat/topology-guided-walk.
```

---

## The assignment in one paragraph

Vyntechs is an AI diagnostic tool for automotive techs. Brandon (founder, master diesel tech) hand-built a prototype at `mockups/topology-guidance/round-3-opus/topology.html` that locks the macro visual direction for this PR: the wiring topology is a **live electrical instrument** with a scenario simulator (Idle / Heavy load / Pegged high pressure / etc.), role-coded animated wires, click-to-probe pins, and a "captured vs not captured" footer. The desktop language is settled. **Your round-4 job is the polish layer: mobile from scratch, the transitions, the states the prototype skipped, and a few specific visual additions called out below.** Push back where you see better; the research-grounded recommendations in this doc are leanings, not specs.

## Who the user is

Master technician. Coveralls. Hands often gloved. Phone in one hand, scanner cable / multimeter in the other. Noisy bay. Mobile is the primary surface (the tech is more often on their phone than at a workstation). Has used Snap-on Verus, Autel MaxiSys, Mitchell 1, Identifix, PicoScope — knows what premium pro tools look like and rejects what looks generic.

The "we succeeded" tests are at the bottom of this doc.

---

## What's locked — do NOT redesign

These are settled by Brandon's prototype. The round-4 deliverable should match these exactly:

1. **Page layout, desktop ≥ 1080 px.** 1320 px max-width, two-column main (fluid diagram canvas + sticky 380 px right panel), header with title block left + wire-role legend right, two-equal-column footer.
2. **Wire role palette.** Signal = fresh green, 5V Ref = burnt orange, Low Ref = graphite, PWM Control = chartreuse mustard, 12V = red coral, Ground = black. Tokens in the prototype's `:root`. These are semantic role colors, NOT real wire colors from the WSM.
3. **Wire animation states.** 13 of them — `off`, `steady-12v`, `steady-5v`, `steady-gnd`, `signal-rest/low/med/high/pegged`, `pwm-low/med/high/max` — each with its own dash pattern + cycle duration. Specific values are in the prototype's CSS; don't re-tune them.
4. **Component / pin / splice rendering structure.** Component = 1.2 px bordered rect with name + location + wire-summary inside. Mechanical = dashed bone-400 stroke + italic name. Splice = bone-200 fill + rx:8 + role label. Pins = small bone-200 rects on component edges with role abbreviation (`S`, `5V`, `LR`, `A`, `B`, `12V`, `GND`). Selected = amber stroke / fill.
5. **Pin selection isolation behavior.** Click a pin → its wire goes bold + glow, every other wire dims to 25% opacity. Click another pin = clean transfer. Click background = clear.
6. **Side panel content structure.** Three states: empty / component-selected / pin-selected. Each state's section ordering and field set is in the prototype + spec §4.6. The KV-row + section-title pattern is the language.
7. **"Captured / Not captured" footer.** Two-column structure, green-dot vs amber-circle bullets, signal-navy-bordered italic note at the bottom of the right column.
8. **Token system.** Bone palette (oklch warm paper), Instrument Serif (display), Inter Tight (sans/chrome), JetBrains Mono (labels/metadata). New `--role-*` palette adds to the existing `app/globals.css` token set — does not replace any existing token.
9. **Vocabulary.** "Diagnostic" (never "walk"), no "AI" in any user-facing copy (per Brandon's standing rule — visible plumbing only).

If you find yourself wanting to change any of these, write it up as a "round-5 candidate" rather than baking it into round 4 — Brandon decides whether to revisit.

## What's open — design these

The prototype skipped these. Each is genuinely creative work where your eye should drive the answer.

### 1. Mobile design, from scratch (375–414 px)

The prototype is desktop-only. The research that informs this leans toward a **non-modal bottom sheet** for the detail panel (rises from the bottom, overlays the lower part of the diagram, leaves the top of the diagram visible while the tech reads the panel). Reasoning: the tech is doing a dual-reference task (probe → diagram → panel → probe), and inline-below forces a scroll cycle every time. Apple Maps / Google Maps / Zillow / Redfin / Airbnb all converged on this pattern for the same problem. Apple HIG and Material Design 3 both name it as the right choice.

**Constraints from research:**
- Non-modal — diagram still interactive behind the sheet.
- Capped at ~55% screen height max snap point (so the diagram stays visible above).
- Drag handle target ≥ 56 px (gloved hands).
- Tap-above-the-sheet to dismiss as a second affordance.

**Open to you:**
- Snap points (one collapsed strip? half-height? near-full?), the visual treatment of the handle, the scrim look, the dismissed state.
- How the scenario bar behaves on mobile — horizontal scroll inside the bar (spec's current lean) vs collapse to a tap-to-open sheet vs something else. 8 operation + 2 fault pills will not fit horizontally on 375 px. Pick the path you'd defend.
- Diagram pin tap-targets at small zooms — the prototype rects are ~20×16 px; at fit-view zoom they shrink further. Need ≥ 32 × 32 px effective hit area at 1.0 zoom on 375 px without bloating the visual.

**If you disagree with bottom sheet** (think inline is better, or want a different pattern entirely): make the case, build the alternative, and let Brandon pick from comparable mockups.

### 2. The "active scenario" visibility badge

When the page loads (especially on returning to a session with a persisted scenario — see Open Question 1 below), the tech needs to see at a glance *what state they're currently in* before they tap a pin and read its "right now" value. The prototype's live-readout line ("Now showing · **Engine Idle** — …") under the canvas title carries this on desktop, but it's small and might not survive mobile compression.

**Constraint:** must be glance-readable at arm's length on a 375 px viewport.

**Open to you:** is the live-readout line enough? Does the scenario name want to be larger? Should it appear on the diagram itself (e.g., a subtle badge in a canvas corner)? Should the diagram have a one-time "you're picking up where you left off" subtle indication on returning sessions?

### 3. The hybrid footer's visual treatment

The footer has two parts: a **hand-written framing wrapper** (the headers + the closing italic note that explains "the diagram doesn't wait for completion to be useful") + **derived bullet rows** (captured items = rows that exist; missing items = rows where labels are null).

**Constraint:** must read as ONE footer, not two stitched-together pieces.

**Open to you:** styling that holds the hand-written voice and the auto-derived enumeration in the same composition. Avoid a stark visual seam between "Brandon wrote this" and "computer wrote this." Should the derived bullets get a subtle "live" indicator (since they update as field labels are captured)? Optional.

### 4. Motion choreography

The prototype animates wires via CSS dash-flow but doesn't choreograph the **transitions** between states. Your call on:

- **Scenario change.** Does every wire re-tune simultaneously, or stagger (e.g., 12V first, then PWM, then signal) for a sense of "system waking into the new state"?
- **Pin selection isolation.** How does "everything dims to 25%, one wire glows" feel? Snap or fade? Duration?
- **Panel content cross-fade.** When selection changes (pin → another pin, or component → pin), how does the panel content swap?
- **Fault scenario shift.** When a fault is engaged (Pegged high pressure / No pressure), the live-readout color shifts to red-coral and the active "right now" inset gets a red-coral border. Should there be a one-time micro-animation (subtle pulse, brief flash) to signal the fault engaged, or just the static state shift?
- **Scenario pill press.** Press → commit → settle is the premium-UI research's standing recommendation (60 / 120 / 200 ms). Your call on whether this is too much for a pill that fires once per probe.

**Constraint from premium-UI research:** *"If you disable animations, the flow should feel broken."* Motion should convey weight, not just speed.

### 5. The states the prototype didn't cover

For every interactive element, every state should be designed (premium-UI research's "six states" rule — default / hover / focus / active / disabled / loading). The prototype covers default, hover, and selected for most things. The rest are open:

- **Focus rings** (keyboard nav) on scenario pills, components, pins, splices, panel links.
- **Loading state** for the page on cold open (before the topology data resolves).
- **Empty state** for `(platform, system)` with no scenarios defined (per spec §9.A — the bar hides; what does the page look like overall?).
- **Empty state** for an electrical component with no pins captured yet.
- **Missing pin reading** ("no live reading captured for this scenario yet") — italic placeholder, but the visual treatment is yours.
- **Error / soft-fail states** — what does a soft-failed field look like when it renders as `—`?

### 6. Anything else you spot

If something feels like it would make a 30-year master diesel tech lean in (or roll their eyes), surface it — that's exactly the kind of catch this round is for.

---

## Research-grounded leanings (push back if you see better)

These are NOT locked. Brandon explicitly said "let Claude Design handle the creativity via the constraints at hand contextually" — meaning the constraints are the spec + the prototype, and the creative call is yours where it doesn't conflict. The recommendations below came from 3 Sonnet research agents I dispatched earlier today; the full reasoning is in this conversation's chat history (Brandon can paste the relevant chunks if you want them). Each one is "the research suggested this; if you see better, propose it and let Brandon pick."

1. **Scenario persistence across reloads.** Persist the last-picked scenario (matches PicoScope 7 Auto, VS Code, every audio editor). Mitigate the "next-day stale state" gotcha by showing the active scenario name big and obvious on every page load (your visual treatment per Open Item 2 above).
2. **Footer copy strategy.** Hybrid: hand-write the framing wrapper + closing note ONCE per system; derive the bullet rows from data.
3. **Mobile detail panel.** Non-modal bottom sheet, capped at ~55% screen height, 56 px drag handle, scrim-tap as secondary dismiss. (Per Open Item 1 above — the actual sheet design is yours.)

If your reading of the brief leads to a different recommendation on any of these, that's the conversation worth having. Don't pretend agreement.

## Anti-patterns Brandon has explicitly rejected (carry forward)

From the morning handoff — still applies:
- Dotted graph-paper backgrounds (v0/Cursor tell) — the prototype's horizontal-only 0.06-opacity grid is OK; full dotted grids are not.
- Verdict-icon-in-circle cards on branches (the prototype has no branches; if you find yourself needing them, route around it)
- "Step N of M" counters anywhere
- Tiny mono-uppercase letter-spaced labels for everything secondary (the universal AI dashboard tell)
- Default border-radius ladder (4/6/10 px Tailwind default)
- Uniform 16 px spacing everywhere (monotone)
- Generic `translateY(-1px) + shadow` lift on hover
- Color used as decoration (full-saturation status colors everywhere)
- `alert()` dialogs as feedback
- The word "AI" in any user-facing string

---

## References to load before designing

In this order:

1. **The spec** — `docs/superpowers/specs/2026-05-23-interactive-electrical-topology-design.md` — the full feature design (what the data model is, what the interactions are, what's in scope vs deferred). Authoritative for everything except visual creative calls.
2. **The rationale** — `mockups/topology-guidance/round-3-opus/RATIONALE.md` — the design language extracted from Brandon's prototype + the framing-change story. Read this before the prototype so you understand the "why" before the "what."
3. **The prototype itself** — `mockups/topology-guidance/round-3-opus/topology.html` — the macro visual direction. Open it in a browser at desktop width to feel it. Self-contained HTML / CSS / JS; no build step.
4. **Premium UI research** — `docs/superpowers/research/2026-05-23-premium-ui-research.md` — still load-bearing for type ramp, motion principles, and discipline. The "kill the grid-paper background" recommendation is the one place Brandon's prototype consciously overrules it (his horizontal-only grid is much subtler than the v0 tell the research was reacting to).
5. **Existing-flow research** — `docs/superpowers/research/2026-05-22-existing-diagnostic-flow.md` — how the product actually works today; the topology surface ships as browse-only PR-B today and gets transformed by this PR.
6. **Existing design tokens** — `app/globals.css` — palette, type, space, motion, materiality intent.
7. **Existing topology code (skim, don't replicate)** — `components/topology/`, `components/screens/topology-diagnostic.tsx`. You're not writing React; you're designing what React will render.

## Live data

All mock data must come from the real **2017–2019 Ford F-250/F-350 Super Duty · 6.7L Power Stroke Diesel** fuel-system case. The prototype already uses real strings — copy them. The grounding session for any data lookup is `681de115-5de9-474e-9721-263f65066e08` on Supabase project `ynmtszuybeenjbigxdyl`.

If you need data the prototype doesn't have (e.g., for a new mobile state mockup), query the Supabase MCP or pull from the prototype's `DATA` / `SCENARIOS` / `PIN_READINGS` constants.

---

## What to design (scenarios + viewports)

Mockups for the polish surface. Pick the scenarios that best exercise each open item:

- **Mobile, 390 px (the primary canvas)**
  - First-impression / cold-load state
  - Active state with a pin selected (the dual-reference moment)
  - Active state with a fault scenario engaged
  - The scenario bar at rest + at scroll-active
  - Bottom sheet at each snap point (collapsed strip / mid / max)
- **Mobile, 375 + 414 px** — sanity-check the two edges of the viewport range
- **Desktop, 1280 + 1440 px**
  - Cold-load (scenario badge prominent)
  - In-flight (pin selected, all the panel content showing)
  - Fault scenario engaged (the red-coral shift in the live-readout + panel inset)
  - The hybrid footer (showing the wrapper + the derived rows seamlessly)
  - Hover / focus states on representative elements
  - Loading / empty states

Plus the **motion choreography** for the major transitions — the HTML can demonstrate motion; the rationale doc explains the curves + durations.

## Deliverable shape

- **Output location:** `mockups/topology-guidance/round-4/` (new subdirectory; round-3-opus stays for diffing).
- **Format:** standalone HTML / CSS pages, no React, no build step. Local server: `python3 -m http.server 8765` from `mockups/topology-guidance/` (may already be running).
- **Real data only.** F-350 / 6.7L PSD throughout.
- **Design rationale doc:** alongside the HTML, write `mockups/topology-guidance/round-4/RATIONALE.md` — what you carried forward, what you added, what you pushed back on, what's still open. Specifically:
  - Motion choreography for each transition (durations, easings, what enters/exits)
  - Specific token additions (when you reached beyond the prototype's tokens, and why)
  - The mobile pattern you chose + why (especially if you pushed back on bottom sheet)
  - Any research-leaning you overruled + your reasoning
  - Open questions you couldn't resolve
- **Package summary:** when you finish, write `mockups/topology-guidance/round-4/PACKAGE.md` — what's in the dir, the rationale highlights, and any pending decisions for Brandon. This is the resume-from-here document for the next session.

---

## The "we succeeded" tests

**Test 1 — the 3-second scenario test.** Show the mobile mockup with a pin selected and a fault scenario active to a master tech for 3 seconds. Ask:

1. *What's the truck doing right now?* (Should answer the scenario name — they should not have to hunt for it.)
2. *What can you tap to learn more?* (Should answer "the pins" — pin-tappability should be self-evident.)
3. *Where do you probe?* (Should answer something tied to the active pin's "Where to probe" line — visible without scrolling.)

All three within 3 seconds, at arm's length, in a noisy bay = pass.

**Test 2 — the "any SaaS website" filter.** If a mockup screen could plausibly appear on any SaaS website, it's wrong. Premium means no other diagnostic tool looks like this. The wire animation + role colors + bone paper aesthetic are the unique identifiers — every screen should be unmistakable as Vyntechs.

**Test 3 — the master-tech-lean-in test.** If a 30-year master diesel tech would lean in or smile at any specific detail, name it in the rationale. If nothing in the design earns that reaction, the design is too safe.

---

## How Claude Opus will resume

When the package is ready, Brandon hands me the path. I:
1. Read your rationale + the new mockups
2. Update the spec to reflect any visual decisions that shift the design (e.g., if you pick a different mobile pattern than bottom sheet, the spec gets updated)
3. Re-run the spec self-review
4. Hand to Brandon for spec re-approval
5. Invoke `superpowers:writing-plans` for the implementation plan
6. Hand off implementation to a fresh execution session

You don't need to write any code — your output is design artifacts + rationale.

---

## Last word

The interactive electrical topology is the diagnostic. Every visual decision should reinforce: precise, confident, respectful of the tech's expertise. If a choice would make a 30-year master diesel tech roll their eyes, it's wrong. If it makes them lean in, it's right.

Push back where you see better. The macro is locked; the polish layer is where this round becomes great or stays merely competent. Ship what you'd put your name on.
