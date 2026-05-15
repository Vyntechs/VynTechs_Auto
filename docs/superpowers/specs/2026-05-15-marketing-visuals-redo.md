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
- All copy must be **real-looking but anonymized**. Use the existing diagnostic scenario: `2019 Ford F-150 · 3.5L EcoBoost · 124k mi · cyl 4 misfire after hot soak` (see `components/marketing/screens.tsx` for the canonical scenario and copy). No real customer names, no real VINs.

---

## 5. Screen-by-screen capture inventory

Each row: marketing slot → file path → what the app needs to show → which app route to navigate to.

| Slot | File | What it shows | App route (on `settings-page`) |
| --- | --- | --- | --- |
| Hero phone | `hero.png` | "Propose" view — active step with reasoning, 97% confidence, 14-step plan. F-150 misfire. | `/sessions/[id]` for a session paused at step 01 with reasoning panel open. |
| Motion 01 — Open | `motion-01-open.png` | Intake form with vehicle + complaint typed in plain text. | `/intake` with vehicle filled and complaint typed. |
| Motion 02 — Research | `motion-02-research.png` | AI assembling the diagnostic plan, pulling references for the exact car. | `/sessions/[id]` showing the research/sources phase. |
| Motion 03 — Propose | `motion-03-propose.png` | Active step with reasoning, confidence bar, 14-step plan preview. | `/sessions/[id]` step 01 active, plan visible. Same shot family as hero but different framing. |
| Motion 04 — Confirm | `motion-04-confirm.png` | Tree updated after tech logs observation; step 02 active, plan refined to 12 steps, gap disclosure visible. | `/sessions/[id]` after a logged observation, with step 02 highlighted. |
| Motion 05 — Lock | `motion-05-lock.png` | Locked case summary: root cause, repair done, verification, notes. | `/sessions/[id]` locked-state view. |
| Laptop motion (×5) | `laptop-01-open.png` … `laptop-05-lock.png` | **NEW — see §10.** 5 laptop screens, one per phase, captured in laptop viewport (1280×800). Each shot demonstrates a laptop-only affordance (multi-pane, persistent citations, denser plan tree, etc.) — not just the phone UI scaled up. | `/intake`, `/sessions/[id]` at various phase states, in a 1280×800 Chrome viewport. |
| ~~Laptop hero~~ | ~~`laptop-hero.png`~~ | **RETIRED.** Replaced by the 5-slot laptop motion above. Delete the file and remove `laptopHero` from `screenshots.config.ts`. | n/a |

Alt text for each slot is already written in `components/marketing/screenshots.config.ts:55-81`. Don't rewrite it; just make the image match.

If a real session matching the F-150 scenario doesn't exist in dev, **seed one** — don't fake screenshots from Figma. The point is for prospects to see the real product. Faked mockups read as fake.

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
5. Hamburger header visible on all screens that include the AppHeader.
6. Scenario coherence: every shot belongs to the same diagnostic session (2019 F-150, cyl 4 misfire after hot soak).
7. `app/page.tsx` renders without layout regression on iPhone SE (375px), iPhone 14 Pro (393px), iPad portrait (768px), MacBook (1280px), and a 1920px desktop.
8. No 1x assets left in `public/marketing/screenshots/`.

---

## 9. Resolved decisions (Brandon)

- **Original specs:** match this brief; folded in. The "flip `null` to object" line in the original is stale (slots are already wired) — overwrite-in-place is the current workflow. See §2 note.
- **`/settings` screenshot in marketing:** skip. Not in this pass.
- **Laptop section composition:** change scope — `OnLaptop` becomes a scroll-pinned motion section with 5 laptop screens, mirroring the phone `Motion`. The point is to show that the laptop UI is **genuinely different** from mobile, not just "the same thing, bigger." See §10.
- **Hamburger menu state in laptop shots:** closed on every shot. Don't draw it open.

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

**Same constraints as phone Motion:** ratio, no chrome, app surface only, real session content, same F-150 scenario.
