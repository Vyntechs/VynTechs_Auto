# Marketing Visuals Redo — Brief

**Date:** 2026-05-15
**Branch (work):** `staging/marketing-visuals` (cuts from `settings-page`)
**Source-of-truth branch for app UI being captured:** `settings-page`
**Final destination:** `main`, AFTER `settings-page` has merged

---

## 1. Why this exists

We are getting ready to start posting publicly. The landing page (`app/page.tsx`) is the surface every prospect hits first. The screenshots in `public/marketing/screenshots/` look terrible — blurry, mushy edges, soft type. We are not shipping screenshots like this.

The marketing structure itself (Hero / WhatItIs / Problem / Motion / OnLaptop / HowItWorks / Different / NotYet / Improving / Pricing / FAQ / FinalCTA) is fine and stays. This brief is about the **visuals** — primarily the phone + laptop screenshots — with room for design polish if Claude design sees obvious wins.

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
| Laptop hero | `laptop-hero.png` | Locked diagnosis on the laptop — same diagnostic surface, bigger screen, hamburger header visible. | `/sessions/[id]` in laptop viewport (1280×800), session in locked state. |

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

- **Marketing-page IA / section list.** Stays as in `app/page.tsx:26-42`. We are not removing or adding sections in this pass.
- **Pricing / Stripe / paywall surfaces.** Already shipped (PR #43). Don't redesign.
- **Logo redesign.** V° lockup is final (PR #46).
- **Dark-mode marketing variant.** Light only for now.
- **Animations / scroll choreography beyond what `Motion` already does.** The pinned-scroll motion section is the one piece of choreography on the page and it works. Don't add more.

---

## 8. Done criteria

1. All 7 screenshots replaced at the exact pixel dimensions above.
2. Every screenshot captured from a build of the app at `settings-page` (or later, if `settings-page` has merged to main by the time you're reading this).
3. Hamburger header visible on all screens that include the AppHeader.
4. Scenario coherence: every shot belongs to the same diagnostic session (2019 F-150, cyl 4 misfire after hot soak).
5. `app/page.tsx` renders without layout regression on iPhone SE (375px), iPhone 14 Pro (393px), iPad portrait (768px), MacBook (1280px), and a 1920px desktop.
6. No 1x assets left in `public/marketing/screenshots/`.

---

## 9. Open questions for Brandon

Drop answers inline here as they come in.

- **Are there original specs from when the marketing page was first built that should override anything above?** (Brandon mentioned having some.)
- **Should the laptop screenshot show the hamburger menu OPEN (revealing settings/team/billing nav) or closed?** Open advertises the new settings work; closed is cleaner.
- **Do we want a `/settings` screenshot in marketing at all?** Not in the current section list, but worth asking before captures start.
