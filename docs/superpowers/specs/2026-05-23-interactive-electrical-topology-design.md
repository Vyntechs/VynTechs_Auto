# Interactive Electrical Topology — Design Spec

**Date:** 2026-05-23
**Status:** Direction locked by Brandon's hand-built prototype; spec drafted, awaiting Brandon approval
**Feature branch:** `feat/topology-guided-walk` (name predates the framing change; concept underneath is different — see §1)
**Predecessor PRs:** PR-A #87 (data foundation) + PR-B #88 (browse-only topology UI) + #89 (fast-follow polish) — all merged
**Supersedes:** the 7-section "guided diagnostic walk" draft in `docs/superpowers/handoffs/2026-05-22-topology-guidance-brainstorm-kickoff.md`
**Source artifact:** Brandon's hand-built prototype at `mockups/topology-guidance/round-3-opus/topology.html`
**Design rationale:** `mockups/topology-guidance/round-3-opus/RATIONALE.md`
**Premium-UI research (still load-bearing for type / motion):** `docs/superpowers/research/2026-05-23-premium-ui-research.md`
**Existing-flow context:** `docs/superpowers/research/2026-05-22-existing-diagnostic-flow.md`

---

## 0. TL;DR

The shipped wiring topology is a static, browse-only diagram. This PR turns it into a **live electrical instrument**:

- A **scenario bar** at the top lets the tech pick the operating state — Key off / Key on / Idle / Light / Medium / Heavy load — plus two fault simulations (Pegged high pressure, No pressure).
- **Wires animate** the power flow for that scenario. Pulse cadence ∝ activity / PWM duty cycle. Colour is the wire's **electrical role** — Signal (green), 5V Ref (burnt orange), Low Ref (graphite), PWM (chartreuse), 12V (red coral), Ground (black) — not the real wire colour from the WSM (techs already know those).
- **Pins are first-class clickable elements** on every electrical component. Clicking a pin isolates its wire path (others dim), and the side panel shows where to back-probe + the live reading for the current scenario + the overall expected range + diagnostic logic for what a wrong reading means.
- Clicking a **component** (the box, not a pin) shows kind / location / role / wire summary + body prose + probing tactic + a clickable pin list.
- A **Captured / Not captured** footer makes the data gap visible — "enough to diagnose from theory" on the left, "labels still missing" on the right. Memory's *"partial data IS the design goal"* made literal.
- **No outcome recording, no `tech_outcomes` writes** in this PR. Diagnosis is the tech's judgment, informed by the live diagram; capture is a separate later PR.
- **No "AI" anywhere in user-facing copy.** Visible plumbing only.

The framing changed mid-brainstorm — see §1. Branch name `feat/topology-guided-walk` stays for shipping continuity; the concept underneath is different.

---

## 1. The concept (and what changed)

### 1.1 What this is

The interactive wiring topology IS the diagnostic. The tech doesn't get walked through a sequence. They see the live electrical system at a chosen operating state, probe the truck, compare. Diagnosis is the tech's judgment informed by the live diagram — not the system's pre-sequenced answer.

This is the standing project principle from memory: *"wiring tool is diagnostic-complete from topology alone — canonical topology from theory is enough to diagnose; wire colors/pin numbers are labels that accelerate, not facts that enable."*

### 1.2 What changed from the kickoff

The 2026-05-22 brainstorm cast this PR as a "guided walk on the topology" — the tech tapped through sequenced tests (PASS / FAIL / WARN), the diagram filled in as a scoreboard, each result wrote a `tech_outcomes` row. Brandon hand-built a prototype on 2026-05-23 that settled a different model: no sequencing, no per-step taps, no outcome writes. The diagram is the instrument; the scenario simulator drives it; the tech reads + probes + judges.

A round-3 Service Bulletin mockup attempt got built against the old framing, then archived to `mockups/topology-guidance/round-3-opus/_rejected/` when the framing shifted. The standing memory *"wiring tool is diagnostic-complete from topology alone"* was already on disk; the kickoff had anchored past it. The rationale doc captures the framing-change story for the record.

### 1.3 Why the branch name didn't change

`feat/topology-guided-walk` already has commits on it (research, brainstorm kickoff, Claude Design handoff). Renaming after the fact would force-push the branch and break references in the merged-to-main commit history. The branch name is a shipping artifact; the spec, plan, PR title, and feature copy all use the new framing.

---

## 2. Decisions locked

| # | Decision | Source | Notes |
|---|---|---|---|
| D1 | Diagram is the diagnostic surface — no wizard, no sequenced walk | Brandon's prototype, 2026-05-23 | Memory: *wiring tool is diagnostic-complete from topology alone* |
| D2 | Scenario simulator: 6 operating states + 2 fault sims | prototype | Key off · Key on · Idle · Light · Medium · Heavy + Pegged high · No pressure |
| D3 | Wires animate at activity rate; colour = electrical **role**, not real wire colour | prototype | Activity expressed as dash pulse cadence; colour is semantic to the role |
| D4 | Pins are first-class clickable elements | prototype | Net-new on top of the existing component-connection graph |
| D5 | Pin selection isolates its wire path (others dim ~25 %) | prototype | Single circuit at a time, never two highlighted at once |
| D6 | Scenario change re-tunes all wire states; selected pin/component refreshes its "right now" reading | prototype | Selection persists across scenario change |
| D7 | No outcome recording (no `tech_outcomes` writes) in this PR | inferred — prototype has no notion of "step" | Outcome capture is a separate later PR if/when warranted |
| D8 | No "AI" word in any user-facing copy | memory: *no AI word in UI* | Plumbing only |
| D9 | Captured / Not captured footer surfaces the data gap | prototype | Memory: *partial data IS the design goal* — made visible, not hidden |
| D10 | v1 system + platform scope = fuel on the 6.7L Power Stroke only | inherited from PR-A/PR-B scope | Same `(platform, system)` slice as the shipped browse topology |
| D11 | **Scenario persists across reloads** + active scenario name shown prominently on every load | Research (PicoScope 7 Auto, VS Code, every audio editor) + Brandon, 2026-05-23 PM | Persistence matches every pro tool; prominent badge mitigates the next-day-stale-state gotcha |
| D12 | Page is framed as **diagnostic-complete from theory** — not "guided walk", not "service procedure" | Brandon's prototype + standing memory | The eyebrow copy reflects the framing (replaces the shipped "Wiring topology · <system> system") |
| D13 | **Scenario picker is a compositional UI** mirroring physical truck controls — ignition switch + engine state + load level + fault sims | Brandon, 2026-05-23 PM | Replaces the flat 8-pill row from the prototype; same underlying 8 scenarios, more semantic controls. See §4.8 + §5.1. |
| D14 | **Mobile baseline = inline panel below the diagram** (tech scrolls to see details after tapping a pin) | Brandon, 2026-05-23 PM ("ship working then polish") | Research-recommended bottom sheet is parked for the Claude Design polish pass — simpler baseline gets shipped first |
| D15 | **Captured/missing footer = hybrid**: hand-written framing wrapper + closing note; bullet rows derived from data | Research (every expert tool that earned trust by being honest about gaps) | Preserves voice on the parts that matter; scales the rest |
| D16 | **Seed data**: Claude re-reads + validates the prototype's prose for accuracy + spec-fit before apply; Brandon validates the live tool | Brandon, 2026-05-23 PM | Per standing "Claude validates first, Brandon validates last" pattern |
| D17 | **Default scenario for fuel on 6.7L PSD = Idle** (engine running, just sitting at idle) | Brandon, 2026-05-23 PM | Most diagnostic probing happens at idle; natural baseline. In the new compositional UI: Ignition = On, Engine = Running, Load = Idle |
| D18 | **Claude Design visual polish parked** — pick up after baseline ships | Brandon, 2026-05-23 PM | Handoff doc at `docs/superpowers/handoffs/2026-05-23-claude-design-interactive-electrical-topology.md` stays valid; marked "DEFERRED — pick up after baseline" |

---

## 3. What the tech sees (the flow)

A tech opens a cache-hit session (e.g. the 2017 F-350 / P0087 case, session `681de115-5de9-474e-9721-263f65066e08`):

1. **The page loads.** The same loader path PR-A/PR-B established — pure structured DB reads, no AI in the hot path. Default scenario is **Idle**. Wires are already animating: 12V steady to the lift pump, PWM-medium to both regulators, signal-medium on the FRP signal wire, steady 5V and low-ref.
2. **The tech reads the live readout** under the canvas title: *"Now showing · **Engine Idle** — lift pump steady, both PWM regulators at moderate duty, FRP reading idle pressure."*
3. **They change the operating state** using the scenario picker — a compositional UI that mirrors physical truck controls (see §4.8 + §5.1). They might flip the ignition switch from On to Off; or with the engine running, bump the load level from Idle to Heavy; or hit one of the pretend-fault buttons (Pegged high pressure / No pressure) to see what the system does under a fault. Every wire re-tunes its animation cadence to match; the live readout updates. If a pin was selected, its "right now" reading updates too.
4. **They click a pin** — e.g. the FRP sensor's Signal pin. The wire connecting that pin to PCM goes bold + glows; every other wire dims to 25 % opacity. The side panel switches from empty / component-info to pin-detail: *Where to probe · Right now (the live reading for the current scenario) · Expected range (overall) · If the reading is wrong (diagnostic logic) · Label gap (what's not yet captured).*
5. **They probe the truck**, compare the multimeter reading to the panel's "right now" + expected range. The "If the reading is wrong" prose tells them what direction to look if it diverges. The reading and the diagnostic prose are scoped to the active scenario — the "right now" updates if the tech changes scenarios with the same pin still selected.
6. **They click another pin / component** to switch focus, or click the canvas background to clear.
7. **They scroll to the footer** to see what's known vs what's still labels-only for this system on this platform. Captured items are bullets with a green dot; missing items are bullets with an amber circle. A note explains: *"Each gap above closes one at a time as techs encounter the information in the bay — paste, save, label appears on the diagram. The diagram itself doesn't wait for completion to be useful."*

That's the loop. Open, read, choose state, probe, compare, judge.

---

## 4. Visual design

The prototype is the source of truth. This section captures the design language so the React port carries it faithfully.

### 4.1 Page layout (desktop ≥ 1080 px)

- **Page container:** 1320 px max width, centred, 40 px top padding / 32 px side / 80 px bottom.
- **Header (two columns):** title block (left) + wire-role legend (right). 1 px bone-300 bottom border, 32 px margin below.
- **Main (two columns):** diagram canvas (fluid `minmax(0, 1fr)`) + sticky right panel (380 px). 32 px gap.
- **Footer:** two equal columns (1fr 1fr), 40 px top margin, 28 px top padding, 1 px bone-300 top border.
- **Below 1080 px:** main collapses to single column (canvas above, panel below); panel loses `position: sticky`; legend collapses to three columns. Phone-specific behaviour in §6.

### 4.2 Canvas

- Background: subtle horizontal graph-paper grid (24 px line spacing, 0.06 opacity bone) over a bone-100 surface — engineering paper feel without the v0 "graph paper background" tell from the premium-UI research.
- 1 px bone-300 border, 2 px radius, 24 px padding.
- **Canvas head:** "Electrical topology" (Instrument Serif 22 px) left + live-readout meta (JetBrains Mono 10 px, uppercase, 0.14 em tracking) right. 12 px bottom padding, 1 px bone-200 bottom border.
- **Live readout** uses mono lowercase prose with the scenario label in amber (signal-navy + amber-500 emphasis): `Now showing · <b>Engine Idle</b> — …`. Becomes red-coral when a fault scenario is active.
- The grid background is the one place the spec deviates from the premium-UI research's "kill the grid-paper background" recommendation. The horizontal-only 0.06-opacity grid reads as "engineering ruled paper," not the v0 dotted-grid tell. Diagnose-able at the round-3 review step if Brandon disagrees.

### 4.3 Wire role palette

Roles, not real wire colours. Each is semantic to the wire's electrical function — the tech already knows the real wire colour from the WSM (and we don't have it captured anyway):

| Role | Token | Hex | Used for |
|---|---|---|---|
| Signal | `--role-signal` | `#4ca866` (fresh green) | Sensor signal wires |
| 5V Ref | `--role-5v-ref` | `#c97842` (burnt orange) | PCM 5V reference output |
| Low Ref | `--role-low-ref` | `#6b6657` (graphite) | Sensor analog ground / low reference |
| PWM Control | `--role-pwm` | `#b3a82e` (chartreuse mustard) | PCM-driven solenoid PWM lines |
| 12V | `--role-12v` | `#b34d4d` (red coral) | Power supply |
| Ground | `--role-ground` | `#1a1a1a` (black) | Chassis ground |

These add to the existing `app/globals.css` token system. They do not replace any existing palette.

### 4.4 Wire animation states

Dashed-line stroke patterns + `@keyframes flow` (`stroke-dashoffset` 0 → −16, linear, infinite). Speed = activity level:

| State class | Dash pattern | Cycle | Opacity | Meaning |
|---|---|---|---|---|
| `off` | (none) | (none) | 0.16 | Wire dead — no power, no signal |
| `steady-12v` | 12 4 | 2.4 s | 1.0 | Continuous 12 V supply |
| `steady-5v` | 10 4 | 2.8 s | 0.92 | Continuous 5 V reference |
| `steady-gnd` | 16 3 | 2.6 s | 0.85 | Sinking ground current |
| `signal-rest` | 6 8 | 3.2 s | 0.55 | Sensor at rest pressure |
| `signal-low` | 6 6 | 2.4 s | 0.70 | Sensor low activity |
| `signal-med` | 6 5 | 1.6 s | 1.0 | Sensor moderate activity |
| `signal-high` | 6 4 | 1.0 s | 1.0 | Sensor high activity |
| `signal-pegged` | 6 3 | 0.5 s | 1.0 | Sensor pegged (fault) |
| `pwm-low` | 5 4 | 1.5 s | 0.85 | Low duty |
| `pwm-med` | 5 3 | 0.85 s | 1.0 | Moderate duty |
| `pwm-high` | 4 2 | 0.42 s | 1.0 | High duty |
| `pwm-max` | 4 2 | 0.22 s | 1.0 | Near-max duty |

**Pin-isolated state (when a pin is selected):**
- The wire(s) connected to the selected pin get class `is-active` → `stroke-width: 3.5`, drop-shadow glow of the wire's `currentColor`. The animation cadence keeps the scenario's tempo.
- Every other wire gets class `dim` → `opacity: 0.25`.
- Scenario-change clears + re-applies these classes so the selected pin's isolation survives a scenario switch.

### 4.5 Component / pin / splice rendering

Each component is a 1.2 px-bordered rectangle (2 px radius) with three text rows inside:
- **Name** — Instrument Serif 15 px, ink-900.
- **Location** — JetBrains Mono 9 px, uppercase, 0.08 em tracking, ink-500.
- **Wire summary** — JetBrains Mono 9 px, bone-700.

Variants:
- **Default electrical component** — bone-50 fill, ink-900 stroke.
- **Mechanical** (HP pump, passenger rail) — bone-100 fill, dashed bone-400 stroke (4 3), italic ink-500 name; wire summary line reads *"mechanical only · no electrical wires"*.
- **Splice** — bone-200 fill, ink-700 stroke, rounded `rx: 8`; the splice's role abbreviation (`5V`, `LR`) renders inside as the only label.
- **Selected** (any kind) — amber-500 stroke @ 2 px weight, drop-shadow on hover (0 2px 6px rgba signal-navy/0.18).

**Pins** are small bone-200 rectangles (~20×16 px) with a 0.6 px ink-700 stroke and 1.5 px radius, placed along the edges of their component. Each pin label inside is the **role abbreviation** in JetBrains Mono 8.5 px:
- `S` = Signal, `5V` = 5V Ref, `LR` = Low Ref, `A` / `B` = PWM-side designators, `12V` = Power, `GND` = Ground.
- When the pin **number** is not yet captured (the v1 default), the prototype shows `—` (em-dash). Per memory *cosmetic UI must soft-fail*, pin numbers display `—` when unknown — never crash, never hidden.

Pin states:
- Default — bone-200 fill, ink-700 stroke.
- Hover — amber-300 fill.
- Selected — amber-500 fill, amber-500 stroke; the role label flips to bone-50.

### 4.6 Side panel content

The right panel has three states: **empty**, **component selected**, **pin selected**. (Splice selection uses the component state; see §5.4.)

#### Empty state

Centred, 420 px min-height, ink-500 text. A 48 px dashed-circle icon (the `⌖` crosshair glyph in JetBrains Mono 18 px), then:
- Title — Instrument Serif 18 px: *"Click anything on the diagram"*
- Sub — Inter Tight 13 px, ink-500, max 240 px wide: *"Each component, pin, and shared splice carries its location, role, expected reading, and what an abnormal reading means."*

#### Component selected

Top:
- **Kind** — JetBrains Mono 10 px, uppercase, 0.14 em tracking, amber-500. (E.g. *MODULE*, *PUMP*, *SENSOR*, *SOLENOID*, *MECHANICAL*, *SPLICE*.)
- **Title** — Instrument Serif 26 px, ink-900, line-height 1.1, letter-spacing −0.015 em.
- **Subtitle** — JetBrains Mono 12 px, ink-700.
- **Rule** — 1 px bone-300 horizontal line edge-to-edge (negative side-margin to bleed into panel padding).

Then KV rows (92 px label column + value):
- Kind · Location · Wires · Role

Then:
- **Body prose** — Inter Tight 13.5 px, ink-700, line-height 1.55. Plain-shop-floor English describing the component's role in the system.
- **Probing tactic** (optional, only when present) — same prose face, preceded by an inline `<h4>` label.
- **Pin list** (only for electrical components with pins; not on PCM, mechanical, or splice) — clickable list of pins on this component. Each row: pin name (left) + role badge (right). Hover lifts to bone-100 + amber-500 border.
- **Unknown note** (optional, only when set) — JetBrains Mono 11 px, italic, ink-500. E.g. *"PCM connector IDs and cavity numbers — not yet captured."*

The PCM in particular has no pin list — its pins are addressed at the **other end** (you back-probe at the component, not at PCM). Brandon's prototype encodes this judgment by suppressing the PCM pin list. Carry that judgment forward.

#### Pin selected

Top:
- **Kind** — `Pin · <role>` (e.g. *"Pin · PWM Control"*), same mono / amber treatment as component kind.
- **Title** — `<Component> · <Pin>` (e.g. *"FRP Sensor · Signal"*), 26 px Instrument Serif.
- **Subtitle** — *"click another to compare · click the diagram background to clear"*.
- **Rule** — same horizontal line.

Body sections (each preceded by a 10 px uppercase Inter Tight 600-weight section title):
- **Where to probe** — back-probe instruction, plain English. (E.g. *"Back-probe the signal pin at the FRP sensor connector (front of DS rail)."*)
- **Right now** — the live reading for the active scenario, in a dark inset box:
  - Background ink-900, text bone-50, padding 12/14, radius 2 px, JetBrains Mono 12.5 px.
  - Scenario label inside in amber-300 @ 9.5 px uppercase tracking.
  - When the scenario is a fault: ink-900 → `#2d1818`, add 3 px red-coral left border.
- **Expected range (overall)** — in a `.expect` box: bone-50 background, 1 px bone-300 border, 2 px radius, JetBrains Mono 12 px; **signal-navy** colour on numeric emphasis.
- **If the reading is wrong** — in an `.alarm` box: faint red-coral wash background (`rgba(179,77,77,0.06)`), 2 px red-coral left border, sans-serif 12.5 px ink-700, with **red-coral bold** "Diagnostic:" prefix.
- **Label gap** — JetBrains Mono 11 px italic, ink-500. (E.g. *"Wire color, sensor pin number, and the exact voltage-to-pressure curve for this sensor — not yet captured."*)

### 4.7 Captured / Not captured footer

Two columns, equally weighted.

**Left — Captured from theory · enough to diagnose:**
- 11 px uppercase Inter Tight 600 section heading; "enough to diagnose" as a mono 10 px count chip in ink-500.
- Bullets — green `●` (role-signal) + Inter Tight 13 px ink-700 + 1 px bone-200 bottom border per item.

**Right — Labels not yet captured · make probing faster, not possible:**
- Same heading treatment.
- Bullets — amber `○` (amber-500) + same prose treatment.
- Below the bullets, a footer-note inset:
  - Background bone-100, 2 px signal-navy left border, padding 12/14, italic 12.5 px ink-700:
  - *"Each gap above closes one at a time as techs encounter the information in the bay — paste, save, label appears on the diagram. The diagram itself doesn't wait for completion to be useful."*

### 4.8 Scenario picker (compositional, per D13)

The prototype's flat row of 8 operation + 2 fault pills is **replaced** at the spec level by a compositional picker that mirrors physical truck controls. The underlying data model stays 8 scenarios; the UI just composes them with semantic controls instead of opaque pill labels.

**Four controls, top of the canvas:**

1. **Ignition switch** — clickable, 2 positions: **Off** · **On**. Visual = an ignition-switch widget (baseline: simple labelled toggle; Claude Design's polish pass may upgrade to a rotary-key-dial visual matching the truck).
2. **Engine state** — visible only when ignition is On. 2 positions: **Off** · **Running**.
3. **Load level** — visible only when engine is Running. 4 positions: **Idle** · **Light** · **Medium** · **Heavy**. Baseline = labelled pill row; polish may upgrade to a slider.
4. **Pretend-fault buttons** — small separate group, always visible: **Pegged high pressure** · **No pressure**. These are "what would the system look like if this was broken" scenarios, not real driving states — kept separate so the tech doesn't confuse them with the live operating controls.

**State → scenario slug mapping** (the UI computes the active scenario slug from the compound control state, then calls the same `applyScenario(slug)` from §5.1):

| Compound UI state | Scenario slug |
|---|---|
| Ignition Off | `key-off` |
| Ignition On, Engine Off | `key-on` |
| Ignition On, Engine Running, Load Idle | `idle` |
| Ignition On, Engine Running, Load Light | `light-load` |
| Ignition On, Engine Running, Load Medium | `medium-load` |
| Ignition On, Engine Running, Load Heavy | `heavy-load` |
| Fault button: Pegged high pressure | `fault-high` |
| Fault button: No pressure | `fault-low` |

**Default on first ever load:** Ignition On + Engine Running + Load Idle = scenario `idle` (per D17). After that, the last-picked compound state is remembered across reloads (per D11).

**Engaging a fault button** overrides the operation controls — the fault state becomes the active scenario. Re-engaging an operation control (e.g. tapping any ignition / engine / load position) returns to that operation state.

**Baseline visual treatment** = simple labelled toggles + pill rows in the bone palette. The "looks like a real ignition switch" visual upgrade is parked for Claude Design's polish pass (per D18).

**Data model implication.** Each `system_scenarios` row needs additional metadata so the UI can compose: `keyPosition` (`off` | `on`), `engineState` (`off` | `running` | null when keyPosition is off), `loadLevel` (`idle` | `light` | `medium` | `heavy` | null when engine is off), `isFault` (bool). See §7.3.

### 4.9 Type / spacing / colour token discipline

- All existing tokens from `app/globals.css` carry forward. The new `--role-*` palette is the only addition to globals.
- All radii on actionable elements (pills, pin rectangles, panel, canvas, expect/alarm boxes) stay in the 0–2 px range. The only round corners are the splice's 8 px `rx` (semantically "splice") and the empty-state icon's 50 % (intentionally archetypal).
- Spacing follows the prototype's hand-tuned irregular cadence, not a uniform 8/16 px ramp. Where the prototype goes 6 / 14 / 24 px between sibling elements, the React port keeps those exact gaps.
- Per memory *no AI in UI copy* — no instance of "AI", "smart", "powered", or any AI-adjacent vocabulary in any visible text.

---

## 5. Interaction model

### 5.1 Scenario selection (via the compositional picker, §4.8)

- Default scenario on first-ever load: Ignition On + Engine Running + Load Idle = scenario `idle` (per D17).
- On subsequent loads: the page restores the last-picked compound state from a per-tech, per-session persisted value (per D11). The active scenario name is shown prominently above the diagram on every load (the live-readout line, beefed up to ~13 px Inter Tight with the scenario name in amber per the spec's mitigation).
- Each picker control (ignition / engine / load / fault button) exposes `aria-pressed` so screen readers announce toggle state correctly.

**The control-change handler** runs on every picker click:
1. Recompute the active scenario slug from the compound UI state (mapping in §4.8).
2. Look up the scenario's pin-state map.
3. For every `<wire>` SVG path, swap its wire-state class.
4. Update the live readout above the diagram (label + sub + fault flag).
5. Persist the new compound state (per-session storage; see §7.x — design detail handled by the plan).
6. If a pin is currently selected, re-render the panel (the pin's "right now" reading is scenario-dependent). Component-selected panels do not change with scenario.

**Fault buttons** override the operation controls. Engaging Pegged high pressure or No pressure sets the active scenario to that fault; the operation controls stay visually present but show "no-op" state (visually deemphasised, still tappable to return to the corresponding operation state). Re-engaging any operation control clears the fault.

**Selection survives scenario change.** Switching from Idle to Heavy load with a pin selected = same pin still selected, same wire still highlighted, new reading.

**Visibility rules** for picker controls:
- Ignition always visible.
- Engine state visible only when ignition is On (otherwise hidden — no engine state when key is off).
- Load level visible only when engine is Running.
- Fault buttons always visible.

### 5.2 Component selection

- Click a component box → its `comp-rect` class adds `is-selected` (amber stroke @ 2 px). The detail panel renders the component variant of the panel.
- Selecting a component does **not** isolate wires — wires stay at their scenario-driven animation state. Only **pin** selection isolates.

### 5.3 Pin selection

- Click a pin rectangle → its `pin-rect` adds `is-selected` (amber fill + stroke). The wire(s) carrying that pin's `data-pin` attribute add `is-active` (3.5 px weight + glow). Every other wire adds `dim` (0.25 opacity). The detail panel renders the pin variant.
- Click another pin → clear previous, apply to the new pin (no multi-select).
- Clicking the component box that owns the pin clears the pin selection and shows the component panel — clicking back to the pin reapplies the isolation.

### 5.4 Splice selection

- Splices render as a special component variant (rounded fill, role abbreviation inside).
- Clicking a splice opens the **component** panel (kind = Splice), with body prose explaining the splice's role and an "unknown" note for which other sensors share it.
- Splices do not have pins of their own in v1.

### 5.5 Clear

- Click empty canvas background → clear selection, panel returns to empty state.
- Escape key → same.

### 5.6 Keyboard & accessibility

- Components, pins, and splices are focusable (`tabindex="0"`, `role="button"`, `aria-label`). Enter / Space activates them (same handler as click).
- Tab order: scenario bar → diagram (components + pins in DOM order) → panel.
- React Flow's existing keyboard handling from PR-B is preserved — Escape clears selection.
- All ARIA labels are descriptive plain English (e.g. *"FRP sensor signal pin"*, *"Volume control valve pin A"*).
- Scenario pills carry `aria-pressed` (§5.1).
- **Colour-blindness fallback.** Wire roles are colour-coded, but every wire's role is also surfaced as text — in the panel KV rows, in the pin's `Pin · <role>` header, and in the role abbreviation inside the pin rect. Colour is supplemental, not the only signal. The header legend names every colour. v1 does not add a high-contrast / monochrome mode; flag as a follow-up if a colour-blind tech reports difficulty.

---

## 6. Mobile adaptation (375–414 px)

Per standing memory *mobile validation required*, every screen must pass 375–414 px before "done." The prototype is desktop-only; this is the spec for the phone view.

**Layout collapse:**
- Header: title and legend stack vertically; legend wraps to 2 columns.
- Main: single column. Canvas on top, panel below.
- Panel: no longer sticky. Renders inline below the canvas. (Bottom-sheet behaviour was considered and rejected — see §10 for reasoning.)

**Scenario picker on mobile:**
- The compositional picker (§4.8) collapses naturally on mobile because most controls are hidden by default — when ignition is Off, only the ignition switch + fault buttons render. When the tech turns the key on, the engine state appears below it. When they start the engine, the load level appears below that.
- The full vertical stack at "ignition On, engine Running" = 4 control groups, which fits on a 375 px viewport without scrolling (each group is one row of small pills + a label).
- Operation controls render in a single column on mobile; the fault buttons render as a separate row underneath.

**Diagram:**
- Existing React Flow pan/zoom (from PR-B + fast-follow #89) carries over. Tech pinches to zoom, drags to pan.
- Initial fit-view zoom must keep all 5 electrical components readable. The fast-follow already raised the floor to `minZoom: 0.7` for legibility — keep that floor here too.
- Pin tap targets must be ≥ 32 × 32 px effective hit-area at 1.0 zoom on a 375 px viewport. If the rendered pin rect is smaller, add invisible padding via a stroked outer rect to expand the hit area without expanding the visual.

**Side panel (mobile baseline per D14):**
- Renders **inline below the canvas**, but **only when a selection is active**. On mobile, the empty-state ("Click anything on the diagram") is suppressed — it would waste a screenful of viewport between the diagram and the footer. The footer renders directly below the canvas until the tech taps something.
- When a selection lands, the panel scrolls into view (smooth scroll behaviour, not jarring).
- Same content as desktop. The "right now" inset box and the expect / alarm boxes are full-width on mobile.
- **Bottom-sheet pattern parked for Claude Design polish pass.** The research today recommended a non-modal bottom sheet (~55 % screen height, 56 px drag handle) because the dual-reference probing task benefits from keeping the diagram visible while reading the panel. Brandon chose to ship the simpler inline baseline first (per D14, "we need this to work, then we can have Claude Design rework it"). The Claude Design handoff at `docs/superpowers/handoffs/2026-05-23-claude-design-interactive-electrical-topology.md` carries this forward.

**Footer:**
- Two columns collapse to single column (Captured first, Not-captured second).

Mobile validation captures: scenario change · pin selection isolation · scenario change while pin is selected · scroll-into-view of active scenario · clear-selection.

---

## 7. Data model — what gets added

This PR adds substantial structured data on top of what PR-A established. **Schema-level detail (column types, FK constraints, migration numbering) is finalised in the implementation plan; this section describes shape and meaning.**

### 7.0 Component prose fields (additive columns on `components`)

The current `components` table has `function` (single sentence) + `electricalContract` (electrical-summary one-liner). The prototype's component panel renders richer prose. Adds the following nullable text columns to `components`:

| Field | Purpose | Example (PCM) |
|---|---|---|
| `subtitle` | Sub-line under the panel title | *"Powertrain Control Module"* |
| `role` | One-sentence functional role | *"Controller — every electrical wire in this system terminates here"* |
| `wireSummary` | Editorial summary of wire count + grouping | *"9 wires routed into this system (4 of which go to two PWM regulators, 3 go to the FRP sensor, 2 go to the lift pump)"* |
| `body` | Plain-shop-floor prose: how the component fits in the circuit | *"PCM drives the lift pump command, modulates the two PWM regulators…"* |
| `probingTactic` | Optional prose for "where to start probing this part" | *"PCM connector itself is rarely the failure. Probe at the COMPONENT end first…"* |
| `unknownNote` | Italic note for what's not captured yet on this component | *"PCM connector IDs and cavity numbers for each wire — not yet captured."* |

All nullable; missing values soft-fail (memory: *cosmetic UI must soft-fail*) — the panel suppresses the row rather than rendering an empty heading.

The existing `function` and `electricalContract` columns are **not** dropped — keeping them preserves PR-A's data and lets the panel use either path. The new panel design (§4.6) uses the richer fields; consolidating to one set is a later cleanup.

### 7.1 Pins as first-class entities

A new `component_pins` table. One row per pin per component. Per memory *vetted DB preferred when present*, this is structured data the diagram and panel render directly.

| Field | Purpose |
|---|---|
| `id` (uuid) | PK |
| `slug` (text) | Stable id for cross-references (e.g. `frp-signal`, `vcv-a`) |
| `componentId` (uuid → components) | Owner |
| `name` (text) | Human label (e.g. *"Pin A"*, *"Signal"*, *"12V Power"*) |
| `roleAbbreviation` (text) | Compact label inside the pin rect on the diagram (`S`, `5V`, `LR`, `A`, `B`, `12V`, `GND`) |
| `pinNumber` (text, nullable) | Actual connector pin number when captured; `null` → diagram shows `—` |
| `edge` (enum: top/right/bottom/left) | Which edge of the component box this pin lives on — drives positioning |
| `displayOrder` (int) | Order on the edge, top-to-bottom or left-to-right |
| `probeLocation` (text) | Back-probe instruction (e.g. *"Back-probe the signal pin at the FRP sensor connector (front of DS rail)"*) |
| `expectedReading` (text, with markup) | Overall expected range prose; supports a narrow HTML subset (`<b>`) for emphasising key numbers — see §7.7 |
| `missingLogic` (text, with same markup) | Diagnostic prose for *"if the reading is wrong"* |
| `labelGap` (text, nullable) | What's not yet captured — the italic note on the pin panel |
| `sourceProvenance` (enum, same as components) | TRAINING-CONFIRMED / TRAINING-INFERRED / FIELD-VERIFIED / GAP |
| `isRetired` (bool) | Same soft-delete pattern as the rest of the topology schema |

The PCM is a partial special case. Diagnostically, you back-probe at the **component end** of a wire (at the sensor, not at the module), so the PCM's component panel **suppresses the pin list** to discourage thinking of PCM as the probe target. But each PCM pin is still individually clickable on the diagram, and clicking one opens its own pin panel (e.g. *"PCM · Lift Pump Power Output"*) — useful when isolating which PCM-side wire owns a problem. So: PCM pins exist as rows, render on the diagram, are clickable, and have their own panel; the only thing suppressed is the listing-from-the-component-panel UI affordance.

Mechanical components and splices have no pins.

### 7.2 Wire electrical role on connections

Add to `component_connections`:

| Field | Purpose |
|---|---|
| `electricalRole` (enum, nullable) | One of `signal` · `5v-ref` · `low-ref` · `pwm` · `12v` · `ground`. `null` for non-electrical connections (fluid lines, mechanical linkages). |
| `fromPinId` (uuid → component_pins, nullable) | Pin endpoint at the from-component (when applicable) |
| `toPinId` (uuid → component_pins, nullable) | Pin endpoint at the to-component (when applicable) |

When a pin is selected, the diagram highlights every connection where either `fromPinId` or `toPinId` matches.

The existing `connectionKind` column (`electrical-wire` / `fluid-line` / `mechanical-linkage` / `can-bus` / `controlled_by` / `reports_to` — see PR-B spec D4) stays unchanged. `electricalRole` is a sub-classification of `electrical-wire` connections — null for the others.

Shared splices add a wrinkle: PCM's 5V output goes to one splice, then the splice has multiple outputs to multiple sensors. Each leg is its own row in `component_connections`. The role is `5v-ref` on each leg. For the leg ending at a splice, the splice-side endpoint has `toPinId = null` — the splice itself **is** the endpoint, not a pin on the splice (per §5.4, splices have no pins in v1). The renderer treats a `null` pin endpoint at a splice-kind component as "wire terminates at the splice body."

### 7.3 Scenarios per system

A new `system_scenarios` table.

| Field | Purpose |
|---|---|
| `id` (uuid) | PK |
| `slug` (text) | Stable id (`idle`, `heavy-load`, `fault-low`, …) |
| `platformId` (uuid → platforms) | Per-platform |
| `system` (text) | Reuses the `components.systems` vocabulary (`fuel`, `cooling`, …) |
| `label` (text) | Display label on the pill (*"Idle"*, *"Heavy load"*, *"Pegged high pressure"*) |
| `sub` (text) | The sub-text in the canvas live readout (*"lift pump steady, both PWM regulators at moderate duty …"*) |
| `kind` (enum: operation/fault) | `operation` = real driving state; `fault` = pretend "what would this look like broken" scenario |
| `keyPosition` (enum: `off` / `on`, nullable for fault kinds) | The ignition-switch state this scenario corresponds to (per §4.8) |
| `engineState` (enum: `off` / `running`, nullable when keyPosition is `off` or kind is `fault`) | Engine state for this scenario |
| `loadLevel` (enum: `idle` / `light` / `medium` / `heavy`, nullable when engineState is not `running`) | Load level for this scenario |
| `isDefault` (bool) | The scenario applied on a tech's first-ever load — exactly one per `(platform, system)` |
| `displayOrder` (int) | Display order within its kind group (mostly informational; the compositional picker derives layout from the keyPosition/engineState/loadLevel fields) |
| `isRetired` (bool) | Soft-delete |

Unique constraint: one default per `(platform, system)`. Migration enforces that exactly one row with `isDefault = true` exists per slice.

### 7.4 Per-pin per-scenario wire state

A join table `scenario_wire_states`. The scenario assigns a wire-animation state to each pin's wire. (Keyed by pin, not by connection — see §7.7 for why.)

| Field | Purpose |
|---|---|
| `scenarioId` (uuid → system_scenarios) | Owner |
| `pinId` (uuid → component_pins) | Subject |
| `wireState` (enum: `off` / `steady-12v` / `steady-5v` / `steady-gnd` / `signal-rest` / `signal-low` / `signal-med` / `signal-high` / `signal-pegged` / `pwm-low` / `pwm-med` / `pwm-high` / `pwm-max`) | The animation class |

Composite primary key `(scenarioId, pinId)`. Missing rows default to `off` at render time (the loader fills the gap so the renderer always has a state).

### 7.5 Per-pin per-scenario reading text

A join table `pin_scenario_readings`.

| Field | Purpose |
|---|---|
| `pinId` (uuid → component_pins) | Subject |
| `scenarioId` (uuid → system_scenarios) | Subject |
| `reading` (text, with `<b>` markup) | The "right now" prose surfaced in the pin panel — *"PWM · MAX duty — PCM trying to build pressure"* |

Composite primary key `(pinId, scenarioId)`. Missing rows render as an italic *"no live reading captured for this scenario"* — never crash.

### 7.6 Captured / Not captured footer surfacing

**Decision per D15: hybrid.** Hand-write the framing wrapper once per (platform, system); derive the bullet rows from data automatically.

- **Hand-written wrapper:** the two column headers ("Captured from theory · enough to diagnose" / "Labels not yet captured · make probing faster, not possible") + the closing italic note ("Each gap above closes one at a time as techs encounter the information in the bay…"). Stored in `system_data_status` with two text columns (`capturedHeader`, `missingHeader`) plus a single `closingNote` text column per (platform, system).
- **Derived rows:** the actual bullet items are enumerated from the loaded topology at render time. "Captured" lists what exists (every component name + count, every pin role + count, every scenario label, etc.); "Not captured" lists rows where structured fields are null (e.g. count of pins with null `pinNumber`, count of connections with null `wireColor` if that column is later added).

This preserves voice on the parts that earn trust (the framing) while letting the bullet rows stay live + scale across systems. As field labels are captured (e.g. a tech pastes a pin number), the "Not captured" bullet count decrements automatically — itself a trust-building moment.

Rationale for hybrid: research found that every expert tool that earned trust did it by being honest about gaps (Identifix confirmed-fix badges, aviation AHRS DEGRADED, radiology AI calibrated uncertainty, Bloomberg data flags). The framing wrapper carries the editorial intent ("the diagram doesn't wait for completion to be useful"); the derived rows carry the live state.

### 7.7 Why state is keyed by pin, not by connection

A pin's wire activity is intrinsic to the pin (what is PCM commanding on this output? what is the sensor reading on this input?). A connection between two components carries that activity along its length — but in the splice case, **one pin's wire state flows through multiple connection rows** (PCM 5V out → splice → 3 sensor inputs = 3 connection rows, all animated at the same `steady-5v` cadence because the splice doesn't gate). Keying state on the pin keeps the splice case sane: PCM's 5V-out pin has state `steady-5v` in every scenario where 5V is live; every connection whose `fromPinId` matches gets that state at render.

Connections without electrical role (fluid lines, mechanical linkages) ignore wire state entirely — they render as a static, un-animated path in a neutral colour. (Style for these is the existing `topology.css` treatment from PR-B; carries over unchanged.)

### 7.8 Inline emphasis in prose fields

Several text fields (`expectedReading`, `missingLogic`, `pin_scenario_readings.reading`) support a narrow inline markup subset: `<b>` for bolding key numbers / verdicts. The renderer escapes everything else and only re-enables `<b>`. This keeps the prototype's signal-navy "12V" / "5V" emphasis pattern alive without a full Markdown layer.

Alternative considered: dedicated `emphasis_spans` join table with start/end offsets. Rejected as over-engineering for a v1 with one tag and ~50 pin rows.

---

## 8. Codebase delta

### 8.1 Files modified

- **`lib/diagnostics/load-system-topology.ts`** — extend the return type with `pins` (per component), `electricalRole` + `fromPinId` + `toPinId` (per connection), `scenarios[]`, and `pin_scenario_readings` resolved as a map. New DB joins for the four new tables (§7.1, §7.3–7.5).
- **`components/screens/topology-diagnostic.tsx`** — extend the page to hold the active scenario in state (`useState<string>('default-scenario-slug')`), the scenario bar, the live readout, the captured/missing footer, and the new wider selection state (component vs pin vs splice vs empty).
- **`components/topology/topology-diagram.tsx`** — switch from React Flow's default smoothstep edges to a custom edge type that supports CSS animation classes. Pin handles add to each custom node.
- **`components/topology/topology-flow.ts`** — extend `toFlowElements` to emit per-pin React Flow `Handle` config on each component node, and to stamp `electricalRole` + `state` + `pinId` data onto each edge for the custom edge renderer.
- **`components/topology/topology-node.tsx`** — extend to render the component's pins as React Flow Handle children, role abbreviations as inner SVG text. Splice + mechanical variants per §4.5.
- **`components/topology/topology-detail-panel.tsx`** — extend `TopologySelection` to add a `pin` kind. Add panel content for pin selection per §4.6.
- **`components/topology/topology.css`** — add wire-role colour utility classes + the 13 wire animation state classes (§4.4) + pin styles + scenario bar styles + footer styles.
- **`lib/db/schema.ts`** — Drizzle types for `componentPins`, `systemScenarios`, `scenarioWireStates`, `pinScenarioReadings`, `systemDataStatus` (per Option A). New columns on `componentConnections`.

### 8.2 Files added

- **`lib/diagnostics/wire-state.ts`** — pure mapping helpers: pin slug → wire state for a scenario; scenario default lookup. Unit-testable in isolation.
- **`components/topology/scenario-bar.tsx`** — the operation + fault pill row with active-state management.
- **`components/topology/captured-missing-footer.tsx`** — the two-column footer.
- **`components/topology/wire-edge.tsx`** — custom React Flow edge type with the role + state class application.
- **`drizzle/migrations/<NNNN>_pins_scenarios_wire_states.sql`** — hand-written per *drizzle-kit broken since 0011b*; rehearsed on `vyntechs_rehearsal` first, applied to live Supabase via the MCP `apply_migration` with Brandon's per-op approval (memory: *apply migrations to live DB, not just test DB*; *no dangerous fixes on prod*).
- **`drizzle/data/2026-05-23-fuel-pins-scenarios.sql`** — the seed data for fuel pins + scenarios + readings on the 6.7L Power Stroke. Brandon-reviewed before apply.

### 8.3 Files unchanged (explicit)

- `lib/diagnostics/topology-layout.ts` — pure dagre layout, still correct.
- `lib/diagnostics/cached-lookup.ts` + `components/screens/cached-overview.tsx` — already off the cache-hit path per PR-B; removal is still a later cleanup.
- The intake / platform resolver / cache-hit routing path — unchanged.

### 8.4 React Flow strategy

React Flow stays. The PR-B canvas already handles pan / zoom / selection / keyboard / touch; rebuilding that as hand-drawn SVG (the prototype's approach) is regression.

Custom edge rendering swaps the default smoothstep for a custom edge type whose CSS class is `wire wire--<role> <state>`. The animation runs from CSS `@keyframes flow` against `stroke-dasharray` + `stroke-dashoffset`, applied to the edge's underlying SVG path. Layout-wise: dagre still positions component nodes; pin handles attach to component-node DOM at the edge specified by `pin.edge` + `pin.displayOrder`.

Pin selection isolation happens at the diagram level — toggle CSS classes on edges, no React Flow API change.

---

## 9. Scope boundaries

### In v1

- The interactive electrical topology with scenario simulator on a cache hit for the 6.7L Power Stroke fuel system.
- Per-pin per-scenario wire animation + live reading + diagnostic-if-wrong prose.
- Captured / Not captured footer (Option A — hand-authored copy).
- Mobile (375–414 px) per §6.
- Schema additions per §7; seed data for fuel.

### Explicitly deferred

- **Outcome recording.** No `tech_outcomes` writes, no notion of "step", no save-as-you-go. If outcome capture is wanted later, it's a separate PR — likely a sidebar "Capture finding" affordance, not a sequenced walk.
- **Systems other than fuel.** Same `(platform, system)` slice as the shipped browse topology (PR-A/PR-B). Adding cooling / charging / ignition / etc. is a per-system seed-data exercise, not a code change.
- **Platforms other than the 6.7L PSD.** Same reason. New platforms get tagged + seeded; the code is platform-agnostic.
- **Scenario persistence across sessions / reloads.** Per D11, always defaults to Idle. Revisit if Brandon wants stickiness.
- **Capturing real wire colours and pin numbers as field data.** The schema accepts `pinNumber` (and accepts a future `wireColor` add) but v1 ships with these blank — the diagram shows `—` and the captured/missing footer surfaces the gap. Filling labels is field work, not code work; the diagram is fully useful without them, which is the standing principle.
- **Splice pin model.** Splices are addressable as components in v1, not as pins. If pin-level addressing of splices ever matters, add later.
- **A "compare scenarios side-by-side" view.** Brandon's prototype doesn't have one; the spec doesn't add one.
- **Removing the now-unused `cached-lookup.ts` / `<CachedOverview>`.** Same later-cleanup posture as PR-B left it.

### Out of scope until further notice

- A vehicle-profile page showing past topology sessions. (Phase 3 PR roadmap — different surface.)
- AI on-demand for new symptoms. (Different surface, different PR.)
- Cross-platform topology inheritance. (Phase 3 PR roadmap.)

---

## 9.A Edge cases & fallbacks

- **No scenarios defined for this (platform, system).** The loader returns scenarios as an empty array. The scenario bar + live readout are hidden; wires render static (no animation, opacity 1.0, the wire's role colour); pin panels suppress the "Right now" section but still render expected range + diagnostic logic. The surface gracefully degrades to a richer browse mode — never errors out.
- **No pins defined for an electrical component.** Component still renders + still clickable + still shows its body + probing tactic. The pin list section in the component panel suppresses. Connections terminate at the component body (same handling as splices, per §7.2).
- **`pin_scenario_readings` row missing for the active (pin, scenario).** The "Right now" inset renders italic *"no live reading captured for this scenario yet"* — never blank, never crash.
- **Loader returns `null`** (platform / symptom missing, system unset, no fuel components tagged). Same empty state PR-B already ships (memory: *cosmetic UI must soft-fail*).
- **Scenario data references a `pinId` that doesn't exist.** The wire-state mapping ignores it; the wire defaults to `off`. Logged at the loader, not surfaced to the tech.

## 10. Decisions made (2026-05-23 PM)

All open questions from the spec draft were resolved on 2026-05-23 PM via a combination of Sonnet research (Q1–Q3) and Brandon's direct calls (Q4 + the seed + the picker).

1. **Scenario persistence (D11).** **Persist** the last-picked scenario across reloads + show the active scenario name **prominently** on every load (live-readout beefed to ~13 px Inter Tight with the scenario name in amber). Mitigates the next-day-stale-state gotcha. Source: Sonnet research — PicoScope 7 Auto, VS Code, every audio editor; the persistence pattern is universal in expert-facing software.

2. **Captured / Not captured footer (D15).** **Hybrid** — hand-written framing wrapper + derived bullet rows. See §7.6 for the schema split. Source: Sonnet research found that expert-tool trust is consistently earned through honest data-gap surfacing (Identifix, aviation, radiology AI, Bloomberg).

3. **Mobile detail panel (D14).** **Inline below the diagram** as the baseline. Research recommended a non-modal bottom sheet for the dual-reference probing task; Brandon chose inline baseline + Claude Design polish to the sheet pattern later (per "ship working first, polish second"). See §6.

4. **Inline emphasis markup.** **`<b>` only.** Italic styling on the label-gap line is applied per-element via CSS, not inline. See §7.8.

5. **Seed-data authoring (D16).** Claude re-reads the prototype's prose + validates accuracy + spec-fit before apply. Brandon validates the live tool, not the seed SQL line-by-line. Per the standing "Claude validates first, Brandon validates last" pattern.

6. **Default scenario for fuel on 6.7L PSD (D17).** **Idle** (Ignition On + Engine Running + Load Idle in the compositional picker). The state most diagnostic probing happens at.

7. **Scenario picker UI (D13).** **Compositional** — ignition switch + engine state + load level + fault buttons, mirroring physical truck controls. See §4.8 + §5.1. Same 8 underlying scenarios; semantic controls replace the flat 8-pill row from the prototype.

8. **Claude Design visual polish (D18).** **Parked** until after baseline ships. Handoff doc at `docs/superpowers/handoffs/2026-05-23-claude-design-interactive-electrical-topology.md` stays valid; marked "DEFERRED — pick up after baseline."

### Flagged for record (not v1 decisions)

- **Splice pin model** — v1 treats splices as components; future PR can add splice-pin addressing if "which leg is open" diagnostic moves come up.
- **Seed-data authoring scaling** — at ~72 cells per (system × platform), v1's hand-authoring is fine; at ~4,000 cells for full diesel coverage, may want a CSV-to-SQL authoring path. Future ergonomics item, not v1.

---

## 11. Testing & validation

Same posture as PR-A/PR-B. TDD for every unit; PGlite for DB tests; real authed app for live validation.

### Unit tests

- **`load-system-topology.test.ts`** — extended: pins resolved per component; electrical role + pin endpoints resolved per connection; scenarios returned with correct kind/order/default; per-pin per-scenario wire state and reading resolved; missing readings surface as `null`, never throw.
- **`wire-state.test.ts`** — pure helpers: pin-state lookup with missing default = `off`; scenario default lookup; pin-id → role lookup.
- **`scenario-bar.test.tsx`** — pill click swaps active class; fault pills route to the fault group; horizontal scroll-into-view on active.
- **`topology-diagram.test.tsx`** — pin click sets `is-active` on the right wires + `dim` on others; component click does not isolate wires; scenario change re-applies state across all wires while preserving any active pin's isolation.
- **`topology-detail-panel.test.tsx`** — empty / component / pin / splice states render correctly; pin's "right now" updates on scenario change; missing fields soft-fail to `—` or italic placeholder.

Per memory *test-driven bug capture*: any manual-testing bug Brandon reports gets a failing test first, then the fix.

### Integration / live validation

Live validation depends on the PR-C/A seed (pins + scenarios + readings for fuel on 6.7L PSD) having been applied to live Supabase. The validation checklist below is for **after** PR-C/A merge:

- Open the 2017 F-350 / P0087 session on the real authed app (memory: *fixes aren't fixed until proven on real authed user-facing surface*).
- Walk all 8 scenarios at desktop (1280–1440 px) + mobile (375 + 390 + 414 px); confirm wire animations track the scenario and selection isolation survives.
- Probe every pin (~9 of them) and read the panel content end-to-end for accuracy against the seed data Brandon reviewed.
- Verify scenario change while a pin is selected updates the "Right now" reading without losing pin selection.
- Verify clicking the diagram background clears selection; clicking another pin transfers isolation cleanly.
- Verify the captured/missing footer renders the correct copy.
- Verify the no-scenarios fallback (§9.A) by temporarily setting a non-fuel cached symptom locally — it should still render the browse mode without errors.
- Confirm `cached-lookup.ts` / `<CachedOverview>` are still off the route (regression check from PR-B).
- Screenshot the result at desktop 1440 + mobile 390 and post to Brandon before merge.

### Pre-existing flake to watch

- `pnpm test` cold-cache PGlite flake (memory: *Vitest fork-pool flake on cold cache*) — rerun once before treating as regression.

---

## 12. Build sequence

The implementation plan (`superpowers:writing-plans` runs after Brandon's spec approval) will finalise task ordering. Sketch:

**PR-C/A — Schema + loader.**
- The migration (hand-written; rehearsed on `vyntechs_rehearsal`; applied to live Supabase via MCP with per-op approval).
- The `fuel-pins-scenarios` seed SQL — Brandon-reviewed before apply.
- Drizzle schema additions; `loadSystemTopology` extension; unit tests.
- Done when: live DB has the new tables + fuel seed; the loader returns the extended `SystemTopology` shape; tests pass.

**PR-C/B — Interactive UI.**
- Scenario bar; custom wire edge type with role + state classes; pin handles on custom node; extended detail panel with pin variant; captured/missing footer.
- Mobile collapse + scroll behaviour.
- Live validation, screenshots, mobile sweep.
- Done when: a cache hit renders the interactive topology with all 8 scenarios working on desktop + phone.

Stacked: PR-C/A merges into the staging branch; PR-C/B branches from PR-C/A and merges in turn. (Memory: *stacked PR to de-risk a large in-flight PR* — splits the schema-vs-UI review surface.)

---

## 13. Open items — none

All open items from the spec draft were resolved 2026-05-23 PM. See §10 for the decisions + reasoning.

---

## 14. References

- Brandon's prototype: `mockups/topology-guidance/round-3-opus/topology.html`
- Rationale: `mockups/topology-guidance/round-3-opus/RATIONALE.md`
- Premium-UI research (type / motion / colour discipline): `docs/superpowers/research/2026-05-23-premium-ui-research.md`
- Existing-flow research: `docs/superpowers/research/2026-05-22-existing-diagnostic-flow.md`
- PR-A/PR-B spec (the topology this PR extends): `docs/superpowers/specs/2026-05-20-interactive-topology-diagnostic-design.md`
- PR-B fast-follow spec: `docs/superpowers/specs/2026-05-22-topology-pr-b-fast-follow-design.md`
- Original guided-walk kickoff (superseded): `docs/superpowers/handoffs/2026-05-22-topology-guidance-brainstorm-kickoff.md`
- Claude Design handoff (now stale — visual direction settled by prototype): `docs/superpowers/handoffs/2026-05-23-claude-design-topology-guided-diagnostic.md`
- Live-data grounding session: `681de115-5de9-474e-9721-263f65066e08` on Supabase project `ynmtszuybeenjbigxdyl`
- Topology code that gets extended: `components/topology/`, `components/screens/topology-diagnostic.tsx`, `lib/diagnostics/load-system-topology.ts`
