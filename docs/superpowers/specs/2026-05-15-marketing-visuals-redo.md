# Marketing Visuals Redo — Brief

**Date:** 2026-05-15
**Branch (work):** `staging/marketing-visuals` (cuts from `settings-page`)
**Source-of-truth branch for app UI being captured:** `settings-page`
**Final destination:** `main`, AFTER `settings-page` has merged

---

## 1. Why this exists

We are getting ready to start posting publicly. The landing page (`app/page.tsx`) is the surface every prospect hits first. The screenshots in `public/marketing/screenshots/` look terrible — blurry, mushy edges, soft type. We are not shipping screenshots like this.

The marketing structure (Hero / WhatItIs / Problem / Motion / OnLaptop / HowItWorks / Different / NotYet / Improving / Pricing / FAQ / FinalCTA) **mostly** stays — one structural change: `OnLaptop` becomes a scroll-pinned motion section mirroring `Motion`, with 5 laptop screenshots instead of a single hero. See §10 for the requirement. The rest of this brief is about the **visuals** — primarily the phone + laptop screenshots — with room for design polish if Claude design sees obvious wins.

---

## 2. What's actually broken

**Root cause: the captured PNGs are 1x. The frames render at retina.**

Spec already in `components/marketing/screenshots.config.ts:18-26` requires:
- **Phone:** `1170 × 2532 px` PNG (iPhone 14/15/16 Pro · 3x retina · capture at DPR 3).
- **Laptop:** `2560 × 1600 px` PNG (MacBook · 16:10 · 1280×800 logical × 2).

What's actually checked in (`public/marketing/screenshots/`):
| File | Actual | Required | Multiplier |
| --- | --- | --- | --- |
| `hero.png` | 390 × 844 | 1170 × 2532 | **3.0x short** |
| `motion-01-open.png` … `motion-05-lock.png` | 390 × 844 | 1170 × 2532 | **3.0x short** |
| `laptop-hero.png` | 1280 × 800 | 2560 × 1600 | **2.0x short** |

The phone aspect ratio is actually fine (390:844 vs frame 393:852, off by 0.2%) — `object-fit: cover` is barely cropping. **"Not fitted right" reads from blur on the edges, not from real cropping.** Fix the resolution and the perceived fit problem dissolves.

This regressed in PR #45 — placeholders shipped as real assets at 1x.

**Note on the swap workflow.** Brandon's original spec describes the swap as *"change `null` to `{ src, alt }` in `screenshots.config.ts`."* That was the pre-PR-#45 workflow. The slots are already non-null today, pointing at the same paths the new captures will land at, so the live workflow is **just overwrite the PNGs in place** — no config edit needed for the phone + hero-laptop slots. Config edits ARE needed for the new laptop-motion slots in §10.

---

## 3. Why `settings-page` is the source-of-truth branch (NOT main)

Captures must show the **current** Vyntechs UI as users will see it after the settings work merges. That includes:

- **New `AppHeader` hamburger menu** (`components/vt/app-header-menu.tsx`) — first persistent nav element in the app. Any screenshot that includes the header should show the hamburger.
- **Shop name display** in the header (`components/vt/app-header-shop-name.tsx`).
- **V° logo lockup** at top-left (already on main via PR #46, but also present here).
- **`/settings` routes** (account / shop / team / billing) exist on this branch — if marketing wants to add a "Settings" screenshot somewhere, capture from here.
- **Sign-out button** + responsive mobile header polish.

If we capture from `main`, the screenshots will be stale the moment `settings-page` lands. Capture from `settings-page` (this branch's parent) and the assets stay valid through the merge.

`main` is also missing: forgot-password flow, account section, shop section, team section. None of those are marketed yet, but the **header** appears in every other screenshot, and it differs.

---

## 4. Asset specs — non-negotiable

### Phone (6 slots: 1 hero + 5 motion)
- **Size:** 1170 × 2532 px exact.
- **Format:** PNG, no rounded corners, no notch, no status bar overlay — the marketing `PhoneFrame` (`components/marketing/phone-frame.tsx`) adds its own bezel + notch.
- **Capture method:** real iPhone 14/15/16 Pro **OR** Chrome DevTools device mode at 390×844 viewport with `deviceScaleFactor: 3`, then PNG export.
- **Content area:** entire screen, edge to edge. Don't pad. Don't add chrome.

### Laptop (1 slot)
- **Size:** 2560 × 1600 px exact.
- **Format:** PNG, no browser chrome — `LaptopFrame` (`components/marketing/laptop-frame.tsx`) adds its own titlebar with traffic lights + `vyntechs.dev` URL.
- **Capture method:** MacBook viewport (1280×800 logical) at DPR 2, app surface only.

### Both
- Background must be the actual app background (`var(--vt-bone-50)` light, `var(--vt-graphite-950)` if dark mode is shown).
- No mouse cursor. No dev tools. No `localhost:3000` artifacts.
- All copy must be **real-looking but anonymized**. No real customer names, no real VINs.
- **Scenarios are per-slot — see §11.** Do NOT ship one diagnostic session repeated 11 times. Each shot is a chance to demo a distinct Vyntechs capability. Coherence applies *within* a scenario (e.g. the two Vibration shots are the same session), not across the whole page.

---

## 5. Screen-by-screen capture inventory

Each row: marketing slot → file path → what the app needs to show → which app route to navigate to.

| Slot | File | Scenario (§11) | Phase view | Route |
| --- | --- | --- | --- | --- |
| Hero phone | `hero.png` | **A — AC + ambient (REQUIRED)** | Propose: pressure diagnostic + auto-pulled humidity/temp panel + reasoning calling out the delta | `/sessions/[id]` paused on the AC pressure-check step |
| Motion 01 — Open | `motion-01-open.png` | D — Vibration | Intake: vehicle + "Vibration 55–65 mph, feels like wheel hop, worse on right turns" | `/intake` |
| Motion 02 — Research | `motion-02-research.png` | B — Electrical | Research: AI reading TSBs, wiring diagrams, forum threads for the harness fault | `/sessions/[id]` research phase, sources panel surfaced |
| Motion 03 — Propose | `motion-03-propose.png` | A — AC | Propose: active pressure-test step, ambient panel visible, confidence + plan tree | `/sessions/[id]` AC session, propose step |
| Motion 04 — Confirm | `motion-04-confirm.png` | C — Oil leak | Confirm: tech logged observation ("oil at PCV grommet, valve cover dry"), plan refined | `/sessions/[id]` oil-leak session, post-observation |
| Motion 05 — Lock | `motion-05-lock.png` | D — Vibration | Lock: locked finding "right rear wheel bearing — heat-induced play above 50 mph" + notes | `/sessions/[id]` vibration session, locked |
| Laptop L1 — Open | `laptop-01-open.png` | D — Vibration | Open at laptop width: vehicle history sidebar + customer search + complaint field | `/intake` in 1280×800 viewport |
| Laptop L2 — Research | `laptop-02-research.png` | B — Electrical | Research with **persistent citations/sources panel** alongside the plan — the laptop-only affordance | `/sessions/[id]` in 1280×800, research phase, sources panel pinned open |
| Laptop L3 — Propose | `laptop-03-propose.png` | A — AC | Propose multi-pane: pressure diagnostic + ambient panel + reasoning + 14-step plan all on screen | `/sessions/[id]` in 1280×800, AC propose step |
| Laptop L4 — Confirm | `laptop-04-confirm.png` | C — Oil leak | Confirm with **photo evidence + observation log + plan refinement** in one view | `/sessions/[id]` in 1280×800, oil-leak session, post-observation |
| Laptop L5 — Lock | `laptop-05-lock.png` | D — Vibration | Lock with full citations panel + confidence-over-time chart visible | `/sessions/[id]` in 1280×800, vibration session, locked |
| ~~Laptop hero~~ | ~~`laptop-hero.png`~~ | **RETIRED.** Replaced by the 5-slot laptop motion above. Delete the file and remove `laptopHero` from `screenshots.config.ts`. | — | — |

**Alt text needs rewriting.** The existing alt strings in `components/marketing/screenshots.config.ts:55-81` describe the old F-150 misfire scenario which is now retired. Rewrite each `alt` to describe what the new shot actually shows per the table above — keep the sentences specific (vehicle, complaint, what's on screen) so a screen reader user gets the same "this is a real product" feel a sighted user does.

If a real session matching each scenario doesn't exist in dev, **seed it** — don't fake screenshots from Figma. The point is for prospects to see the real product. Faked mockups read as fake.

---

## 6. Wiring — how to plug in new screenshots

**The swap is one file.** `components/marketing/screenshots.config.ts` already points at `/marketing/screenshots/{filename}.png`. Drop new PNGs at the same paths (overwriting in place) and:

```bash
public/marketing/screenshots/hero.png            # overwrite at 1170×2532
public/marketing/screenshots/motion-01-open.png  # overwrite at 1170×2532
public/marketing/screenshots/motion-02-research.png
public/marketing/screenshots/motion-03-propose.png
public/marketing/screenshots/motion-04-confirm.png
public/marketing/screenshots/motion-05-lock.png
public/marketing/screenshots/laptop-hero.png     # overwrite at 2560×1600
```

`pnpm dev` will pick them up. No code change required for the screenshot swap itself.

**If Claude design wants to adjust the frames** (bezel radius, notch shape, laptop chrome): the CSS lives in `components/marketing/marketing.css:201-243` (phone) and `:413-473` (laptop). Edit there, don't fork the components.

**If Claude design wants to adjust marketing copy or section order**: `app/page.tsx` is the composition root; section files are in `components/marketing/*.tsx`. The recent landing copy rewrite (`docs/superpowers/specs/2026-05-13-landing-copy-rewrite-design.md`) is the current voice — match it.

---

## 7. Out of scope

- **Marketing-page IA / section list.** Stays as in `app/page.tsx:26-42`. We are not removing or adding sections in this pass — but `OnLaptop` is becoming a scroll-pinned motion section (see §10). That's a re-implementation of an existing slot, not a new one.
- **`/settings` screenshot in marketing.** Confirmed skipped. Settings doesn't sell the diagnostic loop; not in this pass.
- **Pricing / Stripe / paywall surfaces.** Already shipped (PR #43). Don't redesign.
- **Logo redesign.** V° lockup is final (PR #46).
- **Dark-mode marketing variant.** Light only for now.
- **New scroll choreography beyond Motion + the new OnLaptop motion.** Two pinned-scroll sections is the cap. Don't add more.

---

## 8. Done criteria

1. All 6 phone screenshots replaced at 1170 × 2532 px.
2. Old single `laptop-hero.png` retired; **5 new laptop motion screenshots** (see §10) shipped at 2560 × 1600 px.
3. `OnLaptop` re-implemented as a scroll-pinned motion section (see §10).
4. Every screenshot captured from a build of the app at `settings-page` (or later, if `settings-page` has merged to main by the time you're reading this).
5. Hamburger header visible (closed) on all screens that include the AppHeader.
6. Scenarios per §11: AC + auto-pulled humidity/temp (mandatory in the hero), electrical, oil leak, vibration/drivability all represented across the 11 shots. Within-scenario coherence: shots that share a scenario share the same session, VIN, and complaint text.
7. `app/page.tsx` renders without layout regression on iPhone SE (375px), iPhone 14 Pro (393px), iPad portrait (768px), MacBook (1280px), and a 1920px desktop.
8. No 1x assets left in `public/marketing/screenshots/`.

---

## 9. Resolved decisions (Brandon)

- **Original specs:** match this brief; folded in. The "flip `null` to object" line in the original is stale (slots are already wired) — overwrite-in-place is the current workflow. See §2 note.
- **`/settings` screenshot in marketing:** skip. Not in this pass.
- **Laptop section composition:** change scope — `OnLaptop` becomes a scroll-pinned motion section with 5 laptop screens, mirroring the phone `Motion`. The point is to show that the laptop UI is **genuinely different** from mobile, not just "the same thing, bigger." See §10.
- **Hamburger menu state in laptop shots:** closed on every shot. Don't draw it open.
- **Scenario coverage:** stop reusing one F-150 misfire across every shot. Use four distinct scenarios (AC + auto-pulled humidity/temp, electrical, oil leak, vibration/drivability), each chosen to demo a capability scan tools don't have. The AC + ambient shot is the hero. See §11 for the full per-slot mapping.

---

## 10. NEW: `OnLaptop` becomes a scroll-pinned motion section

**What changes.** Today `OnLaptop` (`components/marketing/on-laptop.tsx`) renders a single `LaptopFrame` with one screenshot. Brandon wants it re-implemented as a pinned-scroll section that mirrors the phone `Motion` (`components/marketing/motion.tsx`): one laptop frame stays pinned while the user scrolls, and the laptop screen swaps through 5 phases. Section heading stays "On the laptop. Same thing, bigger screen." — but the **content** demonstrates that the laptop surface is structurally different (more density, side panels, citations visible inline, etc.), not literally the same UI scaled up.

**Why.** The single laptop hero shot doesn't pay off the "On the laptop" promise. Two motion sections back-to-back lets prospects feel the diagnostic loop on both form factors and signals that we built each surface for its medium.

**New asset slots — laptop motion (5 × 2560 × 1600 px PNG):**

| Slot | Filename | Phase | What the laptop should show |
| --- | --- | --- | --- |
| L1 | `laptop-01-open.png` | Open | Intake at full laptop width. Vehicle search + recent customers + complaint field side-by-side. Not the cramped phone intake. |
| L2 | `laptop-02-research.png` | Research | Plan being assembled with a **persistent citations/sources panel** alongside — something the phone can't do. Reading the open web for THIS car. |
| L3 | `laptop-03-propose.png` | Propose | Multi-pane: active step + reasoning on the left, full 14-step plan tree on the right. Confidence bar visible. |
| L4 | `laptop-04-confirm.png` | Confirm | Tree updated after a logged observation. Observation log + plan refinement visible at the same time. Step 02 active. |
| L5 | `laptop-05-lock.png` | Lock | Locked case summary with all citations, the confidence-over-time chart, and the "Open repair coaching" CTA — the existing `LaptopPlaceholder` is a sketch of this; ship the real thing. |

**Retire:** `public/marketing/screenshots/laptop-hero.png`. Delete from the repo and from `screenshots.config.ts`.

**Add to config:** new `laptopMotion` array in `components/marketing/screenshots.config.ts` (alongside `motionPhone`), typed as `[ScreenshotAsset, ScreenshotAsset, ScreenshotAsset, ScreenshotAsset, ScreenshotAsset]`. Remove `laptopHero` from the config type.

**Implementation pattern.** Copy the scroll/pin logic from `components/marketing/motion.tsx:46-60`. Likely viable to extract a shared `<MotionSection>` primitive that both `Motion` (phone) and the new `OnLaptopMotion` consume. Judgment call — don't refactor if it's awkward.

**Copy.** Each phase keeps the same eyebrow/headline/sub as the phone `Motion` (Open / Research / Propose / Confirm / Lock — see `motion.tsx:8-39`) **unless** a laptop-specific sub-line reads better. Optional: add one short laptop-specific sub-line per phase that names the laptop-only affordance ("Citations panel stays open while you work" for Research, etc.). Brandon to approve copy if changed.

**Same constraints as phone Motion:** ratio, no chrome, app surface only, real session content. Per §11, the laptop motion shots show the **same scenarios** as their corresponding phone phases (Open→D vibration, Research→B electrical, Propose→A AC + ambient, Confirm→C oil leak, Lock→D vibration), so a prospect scrolling through both motions feels the same loop on both form factors AND sees Vyntechs handling four genuinely different problem types.

---

## 11. Scenarios — what each shot is selling

We are **NOT** shipping one diagnostic session repeated 11 times. Each shot is an opportunity to demonstrate a distinct Vyntechs capability that scan tools and shop-management software don't have. Pick the scenario per slot to maximize the "this is wild" reaction.

### Scenario A — AC pressure diagnostic with auto-pulled humidity + temperature (MANDATORY · HERO)

**Confirmed real feature (verified with Brandon 2026-05-15).** When a diagnostic plan reaches a step that needs AC pressure, Vyntechs **pops up a location prompt, retrieves the user's location, fetches current weather (ambient temperature + humidity), and uses those values to compute target high-side pressure ranges** for the active diagnostic. Refrigerant high-side pressure is a direct function of ambient conditions — most techs eyeball it, most diagnostic tools ignore it entirely. We compute it and call out deltas.

**The actual flow to capture:**
1. Plan reaches an AC pressure step. Native location-permission popup appears in the app (or the in-app prompt that triggers it).
2. User grants location. App retrieves location → fetches weather.
3. Active step renders with the live ambient values inline and a target pressure range computed against those values.
4. If actual pressure reading is logged, reasoning calls out the delta vs. the ambient-adjusted target.

**What the hero shot shows (step 3 — the payoff).** AC pressure diagnostic in the Propose view. Ambient panel reads something like `Ambient 84°F · 67% RH · Target high-side 165–185 PSI for these conditions`. Active step reasoning calls out: "Reading 210 PSI is ~25 PSI above target for these ambient conditions. Suggests overcharge or restricted condenser airflow — check fan operation and condenser face before recovery." Don't show the permission popup in the hero — show the result, which is where the magic lands.

**Where this shot goes.**
- **Hero phone (`hero.png`) is required** — show the payoff (step 3) with ambient values active.
- **Laptop L3 — Propose** — same scenario, multi-pane (pressure diagnostic + ambient panel + reasoning + plan all visible at once). This is the laptop affordance moment.
- **Optional supporting shot:** if Claude design wants to demonstrate the flow rather than just the payoff, capture the location-permission popup mid-flow on the laptop variant. Don't do this on the phone — popup mid-screen on a hero shot reads as "asking for permission" rather than "this is what the product does."

### Scenario B — Detailed electrical diagnostic

**The strength.** Pin-level reasoning. Citations panel that reads TSBs, wiring diagrams, and forum threads inline. Voltage drop testing as a directed, reasoned step — not a generic "check for power."

**What the shot shows.** Cyl 4 injector harness diagnostic with active step "Measure voltage drop pin 2 to ground under crank." Citations panel visible with Ford TSB 21-2156, an F150forum thread, an uploaded wiring photo. Reasoning explains the why.

**Where this shot goes.** Motion 02 — Research, Motion 03 — Propose, Laptop L2 — Research (citations panel is the headline affordance on the laptop research shot).

### Scenario C — Oil leak diagnostic

**The strength.** Non-electrical, non-obvious problem. Visual + under-car. The AI handles photo evidence and refines the plan when the tech logs what they actually saw.

**What the shot shows.** "Trace oil seepage upper engine, driver side." Active step suggests degrease + 200 mi re-run + photo. After tech logs observation ("oil at PCV grommet, valve cover dry"), plan refines from "valve cover / PCV / rear main" to focused PCV grommet replacement + breather check.

**Where this shot goes.** Motion 04 — Confirm (the observation-and-refine loop is the headline). Laptop L4 — Confirm.

### Scenario D — Vibration / drivability

**The strength.** Fuzzy, subjective complaint. The AI handles ambiguity without dismissing it or jumping to "balance the wheels."

**What the shot shows.** Intake: "Vibration between 55–65 mph, feels like wheel hop, worse on right turns." Locked case converges to "right rear wheel bearing — heat-induced play above 50 mph, lateral load on right turns amplifies." Notes: "Customer described 'wheel hop' — the lateral component matches bearing failure, not tire balance."

**Where this shot goes.** Motion 01 — Open (the plain-English intake is the headline). Motion 05 — Lock (the locked case demonstrates the AI nailing a fuzzy complaint). Laptop L1 — Open. Laptop L5 — Lock.

### Coverage matrix — recommended slot → scenario mapping

| Slot | Scenario | Why this slot |
| --- | --- | --- |
| Hero phone | **A — AC + humidity/temp** | Strongest "this is wild" demo. Must be hero. |
| Motion 01 — Open | D — Vibration intake | Plain-English fuzzy complaint shines in the Open shot. |
| Motion 02 — Research | B — Electrical sources | Citations panel reads TSBs + wiring diagrams. |
| Motion 03 — Propose | A — AC reasoning | Pressure-vs-ambient reasoning in the active-step view. |
| Motion 04 — Confirm | C — Oil leak observation | Tech logs photo + observation; plan refines. |
| Motion 05 — Lock | D — Vibration locked case | AI converged on bearing from a fuzzy complaint. |
| Laptop L1 — Open | D — Vibration, wide intake | Vehicle history + customer search visible alongside complaint. |
| Laptop L2 — Research | B — Electrical, persistent citations | Citations panel stays open — the laptop-only affordance. |
| Laptop L3 — Propose | A — AC, multi-pane | Pressure diagnostic + ambient panel + reasoning + plan all visible. |
| Laptop L4 — Confirm | C — Oil leak, photo evidence | Photo upload + observation log + plan refinement in one view. |
| Laptop L5 — Lock | D — Vibration locked, full citations + chart | Confidence-over-time chart + 8 cited sources visible. |

This is a recommendation. Claude design can swap scenarios per slot if a better fit emerges during capture, with two hard rules:

1. **Scenario A appears in the hero.** Non-negotiable. It's the killer demo.
2. **All four scenarios appear somewhere across the 11 shots.** Don't drop any.

### Within-scenario coherence

When a scenario spans multiple shots (e.g. Scenario D in Motion 01 + Motion 05 + Laptop L1 + Laptop L5), all four shots must be the same session — same VIN, same complaint text, same plan refinement arc. Don't show "vibration on a 2020 Tacoma" in one shot and "vibration on a 2018 Silverado" in another.

### Cross-scenario constraint

Use four genuinely different vehicles across A/B/C/D so the page reads as "Vyntechs works on every car," not "Vyntechs is a Ford tool." Suggested split:
- Scenario A (AC): late-model domestic SUV (e.g. 2022 Chevy Tahoe).
- Scenario B (electrical): 2019 Ford F-150 (carries the original brief vehicle — keeps `motion-02-research` and `motion-03-propose` recognizable if Brandon wants).
- Scenario C (oil leak): older import (e.g. 2014 BMW 328i — known oil-leak prone, demonstrates the AI handles non-domestic).
- Scenario D (vibration): mid-2010s domestic truck or SUV (e.g. 2017 Ram 1500).

Final vehicle picks: Claude design's call, with Brandon approving the slate before captures start.
