# Interactive Electrical Topology — Screen Real Estate Redesign (Claude Design Handoff)

**Date:** 2026-05-24
**Status:** ACTIVE — supersedes the deferred 2026-05-23 polish handoff (which assumed the baseline layout was right; it isn't)
**From:** Claude Opus (engineering / planning lane) → Claude Design (visual lane)
**Branch:** `feat/topology-interactive-ui` (baseline shipped; this redesign opens a follow-up)
**Predecessor handoff (now superseded):** `docs/superpowers/handoffs/2026-05-23-claude-design-interactive-electrical-topology.md`

**Brandon's one-line paste to start a Claude Design session:**

```
Read docs/superpowers/handoffs/2026-05-24-claude-design-topology-screen-real-estate.md and design the layout redesign for the interactive electrical topology page. The current shipped layout has the canvas starved at <20% of viewport — your job is to make the canvas dominate, with all supporting UI as overlays / contextual reveals adapted per form factor.
```

---

## The assignment in one paragraph

The Vyntechs interactive electrical topology page shipped to preview on PR #91. The code works, the e2e tests pass, the visual polish that was parked is now urgent because the **macro layout is wrong**: page header (Sessions back-link + eyebrow + P0087 title + vehicle line, ~140 px tall) + scenario picker card with all 4 compositional controls visible (~120 px tall) + readout text (~30 px) + 380 px sticky right panel (empty placeholder when nothing is clicked) + captured/missing footer pill collectively eat 80%+ of the viewport on a 1440 × 900 desktop window. The actual diagram canvas occupies less than 20% of vertical space — only a tiny strip is visible, with components clipped at the bottom edge. The fix isn't typography or motion; it's a complete rethink of where chrome lives and how it adapts across **phone (375–414 px), iPad (768–1024 px), laptop (1280–1440 px), and desktop (1920+ px)**.

This is the polish pass that was deferred — but the scope grew. The earlier handoff treated the layout as locked and only opened typography / motion / mobile sheet treatment. We're now opening the layout itself.

---

## Who the user is

Master diesel technician. Coveralls. Hands often gloved or dirty. One hand on a multimeter, other on the screen. Often on a 13-inch laptop on a shop cart, sometimes on an iPad, sometimes on a phone in their pocket. Noisy bay. Eyes glance back-and-forth between the truck (probing) and the screen (reading). Has used Snap-on Verus, Autel MaxiSys, Mitchell 1 ProDemand, Identifix, PicoScope — knows what premium pro tools look like and rejects what looks generic.

Brandon's standing principles that govern this work:
- **The diagram IS the diagnostic surface.** Standing memory; product principle.
- **Friction-free.** "What's the most painless easiest way for a technician to do the interactive diagnostics?" — Brandon, 2026-05-24.
- **It's okay to be unorthodox.** Brandon, 2026-05-24.
- **No "AI" word in user-facing copy.** Visible plumbing only.
- **Mobile validation required.** Every page must pass 375–414 px before "done."
- **Cosmetic UI must soft-fail.** Missing data displays `—`, never crashes.
- **No cognitive load** ("step N of M," progress indicators, upcoming-work previews) — show only what's done and what's now.

---

## The research base — load before designing

A research synthesis lives at `docs/superpowers/research/2026-05-24-canvas-screen-real-estate-research.md`. **Read it before generating mockups.** Four parallel Sonnet research subagents covered: premium auto diagnostic tools (Mitchell, AllData, Autel, Snap-on, Bosch, PicoScope, etc.), professional canvas / CAD tools (KiCad + Altium are the closest analogs, plus Figma's failed UI3 floating experiment), maps + AR + spatial UI (Apple Maps' 3-state sheet is the gold standard; Launch X-431 already color-codes status on canvas objects), and cross-form-factor adaptive products + unorthodox patterns.

The 7 highest-confidence findings (from the synthesis doc):

1. **Persistent right-side detail rails are an anti-pattern** across the entire category. Figma reverted from floating panels after testing showed they slow workflow — the corrected rule: floating works for **incidental** chrome, fails for **continuous working** chrome.
2. **Phone = bottom sheet; iPad / desktop = sidebar.** Apple's codified rule. The spatial grammar flips at ~768 px.
3. **Tap-to-split (Autel Topology 3.0)** is a real shipping pattern in a competitor diesel diagnostic tool. Canvas full-screen at rest, splits 50/50 on tap, fills back on deselect.
4. **Status color on the canvas object itself**, not in a separate legend. Launch X-431 does this. ETAS ActiveSchematics renders live values directly on wire segments.
5. **Spotlight / net-highlight** (KiCad + Altium): click a wire, others dim to ~25% transparent wash. Nearly free in CSS.
6. **HUD-at-cursor** (Altium Board Insight): hover a feature, floating badge appears near the cursor with role + voltage. Desktop / laptop only.
7. **Procreate QuickMenu radial**: tap-and-hold → 6-button radial at touch point, dismissed by flick. Best pattern for gloved-hand phone use.

---

## What's locked — do NOT redesign

These were settled by Brandon's prototype + the live spec. Round 4 (this handoff) keeps them intact:

1. **Diagram is the diagnostic surface.** No wizard, no sequenced walk, no per-step taps.
2. **Wire role palette** — Signal = fresh green, 5V Ref = burnt orange, Low Ref = graphite, PWM Control = chartreuse mustard, 12V = red coral, Ground = black. Semantic to electrical role, NOT real wire colors.
3. **Wire animation states (13)** — `off`, `steady-12v`, `steady-5v`, `steady-gnd`, `signal-rest/low/med/high/pegged`, `pwm-low/med/high/max`. Each has its own dash pattern + cycle duration. CSS already shipped.
4. **Component / pin / splice rendering structure** — component = 1.2 px bordered rect with name + location + wire summary; mechanical = dashed bone-400 + italic; splice = bone-200 + rx:8 + role label inside; pins = bone-200 rects on edges with role abbreviation (`S`, `5V`, `LR`, `A`, `B`, `12V`, `GND`).
5. **Pin selection isolation behavior** — selected pin's wire = bold + glow, others dim to 25% opacity. Click another pin = clean transfer. Click background = clear.
6. **Side panel content STRUCTURE** (kind, title, subtitle, KV rows, body, sections) — what's in the panel stays the same. WHERE the panel lives is open.
7. **"Captured / Not captured" footer CONTENT** — two columns, captured (green dot) + not-captured (amber circle), hand-written framing + derived rows. WHERE the footer lives is open.
8. **Token system** — bone palette (warm paper oklch), Instrument Serif (display), Inter Tight (sans / chrome), JetBrains Mono (labels / metadata).
9. **Vocabulary** — "diagnostic" (never "walk"), no "AI" in copy.
10. **Compositional scenario picker semantics** — 4 controls (Ignition Off/On, Engine Off/Running, Load Idle/Light/Medium/Heavy, Fault buttons). The 8 underlying scenarios stay. WHERE / HOW the picker lives is open.

If you want to change any of these, write it up as a "round-5 candidate" and let Brandon decide.

---

## What's open — design these

### 1. The three direction options (this is the core question)

Brandon needs to **see** all three at phone / iPad / desktop to decide. The verbal descriptions below are starting points — push back, blend, propose a 4th if the research supports one. The job is mockups that compare cleanly, not implementing one and skipping the others.

**Option 1 — "Maps for wiring" (safest, recognizable)**
- Phone: canvas full-bleed top; persistent peek sheet (~15% screen height) at the bottom with the active scenario name + drag handle. Drag → half (~50%) with scenario controls + readout; drag again → full (~90%) with selected pin's detail. Non-modal at all positions.
- iPad: bottom sheet becomes a left sidebar (~280–320 px wide). Sidebar holds scenario picker, readout, selection detail. Canvas owns the right ~70%.
- Desktop / laptop: same left-sidebar pattern (~300 px). Canvas owns ~75%.
- Always-on: spotlight mode + live values on wire segments.
- Risk: recognizable but slightly less differentiated; "we're a maps app."

**Option 2 — "Split-on-tap" (Recommended — Autel pattern, proven precedent)**
- At rest, every form factor: canvas fills 100% of the screen. Only floating edge chrome — back-link + vehicle ID + scenario-name pill (top), captured/missing count chip (bottom corner).
- Tap a pin / component → canvas slides up to ~50%, detail panel opens below (phone) or to the right (desktop / iPad). Tap outside or × → split closes, canvas back to 100%.
- Scenario picker: a floating pill that expands into the compositional UI (Ignition / Engine / Load) on tap. Tap a different state → updates + collapses.
- Spotlight mode + live values on wires same as Option 1.
- Risk: split-on-tap is less recognizable than bottom sheets; users might miss the affordance.

**Option 3 — "Spatial callouts" (most unorthodox, GIS pattern)**
- Canvas 100% always, every form factor. Only thin floating edge chips.
- Tap a pin → anchored callout bubble appears on the canvas next to the pin with a leader line. Inside: top-line detail (kind, expected, reading now). Tap "more →" → bubble expands to full detail (sheet on phone, expanded callout on desktop).
- Hover a wire (desktop / laptop only): HUD-at-cursor with role + live voltage. Auto-dismisses on move.
- Phone: callouts slide up from below the selection, ~40% of screen height.
- Risk: callouts in denser diagrams can get cluttered when we add cooling / charging / ignition systems. Higher design risk, highest potential payoff.

### 2. The shared moves all three options should include

Regardless of which direction Brandon picks, design these into all three mockups:

- **Spotlight mode** (always-on): tap a pin → wires connected to that pin glow at full saturation; every other wire dims to 25% opacity. Already in the spec; visual treatment of the dim-state is yours.
- **Live values ON the wire** (ETAS pattern, replaces the readout paragraph): tiny inline badges on wire segments showing the role + value for the active scenario. Spec change — surface this in your design + flag it for Brandon's review.
- **56–72 pt minimum tap targets** for any element a tech interacts with during a probe. Current pins are ~32 pt. Doubling is the floor.
- **Per-form-factor redesign** — Procreate / Things 3 / Apple Maps DNA. Not "shrunk-down desktop." Phone gets phone treatment, iPad gets iPad treatment, desktop gets desktop. Same gesture vocabulary across all.
- **Auto-dismiss for transient tools** (Tesla pattern): zoom controls + legend appear on tap, vanish after 4–5 s idle. Never permanently visible.
- **No glassmorphism / backdrop-blur over the canvas.** NN/g iOS 26 critique. The current `CapturedMissingFooter` uses `backdrop-filter: blur(12px)` over the diagram — fix this; use opaque dark surface cards with explicit borders.
- **Glove / dirty-hand friendly.** Procreate QuickMenu radial pattern is the gold standard for phone (long-press anywhere → 6-button radial at touch point). At minimum, large tap targets + no precision-required gestures.

### 3. The unorthodox candidates Brandon is open to (decide which to mock)

These came out of research with non-trivial confidence. Pick which to include in the mockups; the others stay in the backlog for a future round. Defend your picks.

- **Live values on wire segments** (ETAS) — high leverage, replaces the readout paragraph entirely. Spec changes from "Now showing · Engine Idle — lift pump steady, both PWM regulators at moderate duty…" as a paragraph to inline badges on the wires themselves.
- **HUD-at-cursor on desktop** (Altium Board Insight) — hover a wire → floating badge near cursor with role + voltage. Auto-dismiss on move.
- **Procreate QuickMenu radial on phone** — long-press anywhere → 6-button radial. Eliminates persistent mobile toolbar.
- **Status color on canvas objects** (Launch X-431) — extend the existing component box fill to encode state (powered = green tint, fault = red tint, not tested = dim gray). Eliminates the need for a separate status legend.
- **Bluetooth foot pedal (HID keyboard)** — $40–80 hardware, no special API. Listen for keystrokes; tech advances scenarios with foot. Worth a "design the affordance for it" exercise. (Brandon would hand-distribute pedals to YMS techs.)
- **Push-to-talk voice control** — Web Speech API + push button. "Show pin 5," "switch to fault." Push-to-talk avoids shop-noise false triggers. Optional, design the affordance only if you think it earns its weight.

### 4. The form factors required for every mockup

Brandon will see all three options at each of these. **Mock everything.** Don't ship one form factor and skip the others:

- **Phone — 390 px** (iPhone 16 Pro standard width; the 375–414 range)
- **iPad portrait — 768 px**
- **iPad landscape — 1024 px**
- **Laptop — 1280 px** (13" MacBook common)
- **Desktop — 1440 px** (the form factor Brandon is currently testing on)

For each form factor, show: (a) at-rest state, (b) selected pin state, (c) scenario-change state, (d) any unique-to-this-direction state (e.g., split open for Option 2, callout open for Option 3).

That's 3 options × 5 form factors × 4 states = 60 mockup frames. Group sensibly; not every state needs every form factor if behavior is identical (e.g., Option 1's bottom sheet on phone vs sidebar on iPad is one frame each).

### 5. The motion choreography

Once the layout is settled, the transitions matter. From the prior handoff (still valid):

- **Scenario change.** Wires re-tune in stagger or simultaneous? Selected pin's "right now" reading updates with what animation?
- **Pin selection isolation.** Snap or fade to the dimmed state? Duration?
- **Panel / sheet / callout open + close.** Apple Maps' sheet uses `cubic-bezier(0.2,0,0,1)` (deceleration) for entry, accelerate for exit. Asymmetric easing reads as "weight."
- **Fault scenario shift.** Subtle pulse to signal "fault engaged" or just static state change?
- **Spotlight engage / clear.** Curve + duration for the dim-cascade.

Premium-UI research's rule: *"If you disable animations, the flow should feel broken."* Motion conveys weight, not speed.

### 6. The empty / no-selection state

What does the page LOOK like at first load with nothing tapped? In the current layout, the right panel says "Click anything on the diagram." In Option 1 the bottom sheet would show similar. In Option 2 the canvas owns 100%. In Option 3 the canvas owns 100%.

For each option: design the at-rest invitation. How does a new tech know what to do? Where do the first-second-eye-paths land? The empty state matters because it's literally the most-viewed state.

### 7. Diagnostic clarity (Brandon raised this 2026-05-24)

Brandon's exact observation looking at the current shipped page: *"this is an interactive diagnostics but it's very unclear on the diagnostics."*

The interactive surface is visible (clickable pins, scenario controls, panel reveals on selection). The **diagnostic invitation** — what to do with the interactivity to find the fault for THIS code — is not. To a tech glancing at the page, it reads as "browse a wiring diagram + change scenarios + click things" rather than "diagnose P0087."

**The problem to solve:** how does the page make it visibly obvious that —

- This page exists to diagnose THIS code (P0087 — Fuel Rail Pressure Too Low — in the live example).
- The interactive surface is the diagnostic method.
- Diverging probe readings from the expected values are how the tech finds the fault.
- The fault scenarios (Pegged high / No pressure) are part of the diagnostic workflow, not just "extra" controls next to operating states.

**Constraints — must hold:**
- **No sequenced wizard, no "step N of M," no upcoming-work previews.** Standing principle: show only what's done and what's now ([[feedback_remove_cognitive_load_in_diagnostic]]).
- **The topology IS the diagnostic.** Don't add a side-panel "theory of operation" or a separate "guided procedure" surface ([[feedback_theory_of_operation_is_source_not_panel]] + [[project_wiring_tool_diagnostic_complete]]).
- **The tech is a master diesel tech.** Don't condescend. No tutorial overlays, no help bubbles, no "for first-time users" copy.
- **No "AI" in user-facing copy** ([[feedback_no_ai_word_in_ui]]).
- **Plain shop-floor English** ([[feedback_marketing_voice_rules]]).
- **The eyebrow currently says "ELECTRICAL TOPOLOGY · DIAGNOSTIC-COMPLETE FROM THEORY"** — that's jargon. Open to rewrite.
- **The empty-state currently says "Click any part or line to see what it is, where it is, and what to expect when you probe it"** — that's tooltip-vague. Open to rewrite.
- **The fault scenario buttons are currently labeled "Pretend Fault: Pegged high pressure" / "Pretend Fault: No pressure" and sit visually adjacent to operating-state controls.** Open to relabel and / or relocate.

**Open to you:** the framing, the copy, the visual hierarchy, the affordances. Anything that makes it visibly obvious *this is a diagnostic, and here is how you use it*. Defend your choices against the constraints above.

### 8. Push back

If during your work you discover a fourth direction that the research supports better than these three — propose it. Brandon's quote: "I don't want to read [options] and just have to meet them up with a better option."

If you discover that one of the "locked" items above should actually shift (e.g., the wire role palette doesn't survive the canvas-dominant treatment for some reason), surface it as a "round-5 candidate" with the reasoning.

---

## The success tests

The mockups succeed if, looking at any one of them, Brandon (or any master tech glancing at it cold) can answer in ≤ 3 seconds:

1. What truck and what code is this diagnosing?
2. What operating state is the system in right now?
3. If I tap on this pin, what happens?
4. What's a "fault" vs an "operating state"?
5. On a phone with one gloved finger, can I do this?

If any answer is "maybe" or "I'd have to think about it," simplify further. The current shipped layout passes #1 (eyebrow + title), partially passes #2 (the readout line), fails #3–5 (the panel is empty until you tap, the fault buttons are visually mixed with state controls, the pin tap targets are below glove-friendly minimum).

---

## What's NOT in scope for this round

- **DB schema changes.** The scenarios, pins, scenario_wire_states, pin_scenario_readings tables stay as-is. The data model is fine; the rendering is what changes.
- **Adding systems beyond fuel.** v1 stays on the 6.7 L Power Stroke fuel system.
- **Outcome recording / `tech_outcomes` writes.** Out of scope per the original spec.
- **The browse-only topology page (cached-overview).** Already decommissioned in PR-A/PR-B; don't re-introduce.

---

## How Brandon flows from here

1. Pastes the one-line above into a fresh Claude Design session.
2. Claude Design reads this handoff + the research synthesis + the live spec at `docs/superpowers/specs/2026-05-23-interactive-electrical-topology-design.md`.
3. Claude Design produces mockups for all 3 options × form factors, plus its own pushback / 4th option if warranted.
4. Brandon picks a direction (or asks for revisions).
5. Brandon returns to this Opus session with the chosen direction + Claude Design's mockup file path.
6. Opus writes a new spec (revising the existing 2026-05-23 spec's §4.1 + §6) and a writing-plans implementation plan.
7. Execute the implementation plan in fresh sessions per the per-PR-session pattern.

---

## References

- **Research synthesis (read first):** `docs/superpowers/research/2026-05-24-canvas-screen-real-estate-research.md`
- **Live spec to be revised:** `docs/superpowers/specs/2026-05-23-interactive-electrical-topology-design.md`
- **Brandon's hand-built prototype (locked design language):** `mockups/topology-guidance/round-3-opus/topology.html`
- **Prototype rationale:** `mockups/topology-guidance/round-3-opus/RATIONALE.md`
- **Prior premium-UI research (type / motion / color discipline still applies):** `docs/superpowers/research/2026-05-23-premium-ui-research.md`
- **Predecessor (now superseded) Claude Design handoff:** `docs/superpowers/handoffs/2026-05-23-claude-design-interactive-electrical-topology.md`
- **Current shipped code (the baseline you're redesigning):**
  - `components/screens/topology-diagnostic.tsx` (the page shell)
  - `components/topology/topology.css` (the chrome-heavy grid that's the problem)
  - `components/topology/scenario-bar.tsx` (compositional picker — moves to floating pill / sidebar / etc.)
  - `components/topology/captured-missing-footer.tsx` (currently a glassmorphism pill — fix)
  - `components/topology/topology-detail-panel.tsx` (the 380 px sticky rail to relocate)
  - `components/topology/topology-diagram.tsx` (the diagram itself — minimal changes here)
- **Visual evidence of the problem:** Brandon's screenshot from 2026-05-24 12:49 PM showing chrome eating ~80% of a 1440 px viewport on the live preview deploy.
- **The standing principle this work serves:** memory `project_vyntechs_product_goal.md` — *"AI master techs actually trust... speeds techs to correct repair with cited evidence."* The current layout makes the cited evidence (the diagram) too small to trust.
