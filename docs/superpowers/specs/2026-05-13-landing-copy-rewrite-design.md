# Landing Page Copy Rewrite — Design

**Date:** 2026-05-13
**Status:** Drafted, awaiting founder review
**Scope:** Text-only rewrite of the marketing landing page (`app/page.tsx` + `components/marketing/`). No layout, no design system, no new sections, no removed sections. Screenshots are a follow-up PR.

---

## 1. Problem

The current landing page reads as AI-generated to a working tech. Specific failure modes:

1. **AI-tell language patterns** — em-dash dramatic pivots, the "X isn't just Y, it's Z" construction, counted-list headlines ("Five things this gets right," "Six common ones"), three-fragment escalations ("No drop-downs. No checklists. Plain words."), performative honesty ("Honest 'I don't know'"), academic vocabulary ("conflate," "calibrated confidence," "decision trees").
2. **Audience-targeting eyebrow** ("For working master techs") — narrows the audience and contradicts the founder's "let the product self-sell" direction.
3. **Two truth-flag claims** — references to "AllData" and "iATN" as data sources, when the actual retrieval pulls only from forums + open web + tech-uploaded photos. Plus a made-up "75 / 300 / 1–2 updates per week" line.
4. **One inaccurate "what it can't do" claim** — page says "Doesn't read your photos" but the wiring-diagram vision adapter is wired up.
5. **No early credibility signal** — the only social proof today is a one-liner in the footer ("built by working techs"). The page has no "real beta users, real diagnostics" beat anywhere readers will see it before the FAQ.

## 2. Goals

Rewrite all user-facing text on the landing page so that:
- A working tech reading it at first glance does not clock it as AI-written.
- Every claim is true today (no aspirational promises).
- The founder's voice (concrete, blunt, plain-spoken, lightly confrontational toward AI hype) carries through every section.
- A new credibility beat — "built by a tech, used by four every day, hand-tuned weekly" — replaces the current "Always improving" abstraction.

## 3. Non-goals

- No layout changes.
- No design-system changes.
- No new sections, no removed sections.
- No screenshot work. (Real-screenshot swap is a separate follow-up PR. The "every screenshot is real" claim is NOT shipped in this PR.)
- No copy changes to the in-app routes (`/today`, `/intake`, `/sign-in`, etc.). Marketing surface only.

## 4. Voice rules (apply to every section)

These rules govern every rewrite below.

1. **Plain reading level.** A tech who reads at 8th-grade level finishes any line without squinting. No jargon: no "calibrated confidence," no "decision trees," no "co-pilot," no "conflate," no "downstream," no "leverage / robust / seamless / comprehensive."
2. **Period-period rhythm, not em-dash drama.** Short declarative sentences, separated by periods. Em-dashes survive only when they serve grammar, not rhetoric.
3. **No counted-list headlines.** "Five things this gets right" → "What's different." "Three things it can't" → "What it can't do." "Six common ones" → "The common ones." "Four moves, in order" → a descriptive headline.
4. **No "X isn't just Y, it's Z" pivots, no "Picture this:" openers, no "Here's the thing," no three-fragment escalations.**
5. **No founder voice.** The page stays third-person about the product everywhere. Section 9 (Improving) uses collective "we" for the hand-retraining beat — not "I." (An earlier draft used "I retrain it by hand" but landed as founder bragging; v3 drops it.)
6. **Truth-flag rule.** No reference to "AllData," "iATN," "Mitchell," or any other licensed third-party data source as something the system pulls from. (The price comparison to AllData/Identifix in Pricing stays — that's competitive pricing, not a sourcing claim.)
7. **The parts-counter test.** Read each sentence out loud. If a guy at the parts counter would say it, ship it. If he'd squint at it, rewrite it.

## 5. Section-by-section rewrites

### 5.1 Sticky CTA (`components/marketing/sticky-cta.tsx`)

| Element | Today | Rewrite |
|---|---|---|
| Brand subtitle | `Diagnostic Co-Pilot` | `AI master tech` |

All button labels (Sign in / Subscribe / Go to app) unchanged.

### 5.2 Hero (`components/marketing/hero.tsx`)

| Element | Today | Rewrite |
|---|---|---|
| Eyebrow | `For working master techs` | *(removed entirely — delete the `<span className="mk__hero__eyebrow">` element, not just the text)* |
| H1 | `AI master tech for the bay.` | *(unchanged)* |
| Sub | `Decision trees with calibrated confidence. Built for techs who have to be right.` | `Picks the next check. Tells you how sure it is.<br>Shows you what it read.<br>Says "I don't know" when it doesn't.` (three short lines) |

### 5.3 What It Is (`components/marketing/what-it-is.tsx`)

Single paragraph rewrite. Three short declarative beats:

> Proprietary diagnostic reasoning.
> Tells you what to check next. Locks the diagnosis when it's sure. Coaches the fix.
> Won't turn the wrench. Will teach you the way through.

### 5.4 Problem (`components/marketing/problem.tsx`)

| Beat | Element | Today | Rewrite |
|---|---|---|---|
| 1 | Eyebrow | `The pain` | `The pain` |
| 1 | H | `The hard problems eat hours.` | `The hard cars eat your day.` |
| 2 | Eyebrow | `The tradeoff` | `The trade` |
| 2 | H | `You shouldn't have to choose between speed and being right.` | `Fast or right. Pick one. Then watch the bay back up.` |

### 5.5 Motion — 5 scroll steps (`components/marketing/motion.tsx`)

| # | Eyebrow | Headline (today → rewrite) | Sub (today → rewrite) |
|---|---|---|---|
| 01 | Open | `Start with the vehicle and what's wrong.` → `Start with the car and what's wrong.` | `No drop-downs. No checklists. Plain words.` → `Type what the customer told you. That's it.` |
| 02 | Research | `It studies the exact car you're working on.` → `It researches the exact car you're on.` | `Pulls service info, TSBs, forum reports — for this VIN. Cites every source.` → `Reads forums, TSBs, the open web. For the car in your bay. Shows you every source.` |
| 03 | Propose | `It asks what to check, and tells you why.` → `It tells you what to check, and why.` | `Each branch shows the reasoning, the calibrated confidence, and the citations behind it.` → `Every step shows the reasoning, how sure it is, and what it read.` |
| 04 | Confirm | `You confirm in your own words.` → `You tell it what you found.` | `Type what you saw at the harness, the connector, the smell. It updates everything downstream.` → `Type what you saw at the harness, the connector, the smell. The whole plan updates.` |
| 05 | Lock | `Diagnosis locks. Repair coaching opens.` *(unchanged)* | `Two phases. It doesn't conflate finding the problem with fixing it.` → `Two jobs, kept separate. Find the problem first. Fix it second.` |

### 5.6 On Laptop (`components/marketing/on-laptop.tsx`)

**Section heading:**

| Element | Today | Rewrite |
|---|---|---|
| Eyebrow | `Also on the laptop` | `On the laptop` |
| H2 | `Bigger screen. Same brain.` | `Same thing, bigger screen.` |

**Laptop placeholder content (inside the laptop frame):**

| Where | Today | Rewrite |
|---|---|---|
| Hero card body | `High-resistance corrosion at the harness connector. Replace harness pigtail; refresh adjacent grounds. Confidence 94 · cited from 8 sources across TSB, AllData, and 23 F150 forum threads.` | `High-resistance corrosion at the harness connector. Replace harness pigtail. Refresh adjacent grounds. 94 confidence. 8 sources cited.` |
| Citations panel, middle row | `AllData wiring · cyl 4 injector harness` | `Wiring photo · uploaded · cyl 4 pinout` |

All other placeholder text (nav, brand label, top bar, confidence panel) unchanged. The whole placeholder gets replaced wholesale in the follow-up screenshot PR; this cleanup keeps the live page truthful until then.

### 5.7 How It Works — 4 steps (`components/marketing/how-it-works.tsx`)

| Element | Today | Rewrite |
|---|---|---|
| Eyebrow | `How it works` | `How it works` |
| H2 | `Four moves, in order.` | `From "what's wrong" to the locked diagnosis.` |
| Step 1 | `You describe the vehicle and the symptom in plain text.` | `You type the car and what's wrong.` |
| Step 2 | `It researches the exact vehicle live, cites its sources, asks you what to check next.` | `It reads the open web for that exact car. Forums, TSBs, the works. Shows you every source.` |
| Step 3 | `It explains why it's asking — not just what to check. You see the reasoning, not a black-box answer.` | `It tells you what to check next, and why. Every step shows how sure it is.` |
| Step 4 | `It locks the diagnosis only when it has enough evidence. Then it coaches the repair.` | `It locks the diagnosis when the evidence is there. Then it walks you through the fix.` |

### 5.8 Different — 5 things (`components/marketing/different.tsx`)

| Element | Today | Rewrite |
|---|---|---|
| Eyebrow | `What's different` | `What's different` |
| H2 | `Five things this gets right.` | `Why this isn't more AI hype.` |
| 1 | `Every reasoning step cites a real source — no black box.` | `Every step shows you what it read. No black box.` |
| 2 | `Honest "I don't know" — silent when there's no evidence.` | `When it doesn't know, it says so. It doesn't guess.` |
| 3 | `Researches the exact vehicle live; doesn't guess from training data.` | `It reads the open web for the car in your bay. Not training data.` |
| 4 | `Two-phase: locks the diagnosis before coaching the repair.` | `Locks the diagnosis first. Then walks you through the fix.` |
| 5 | `Calibrated confidence at every step.` | `Every step shows how sure it is.` |

### 5.9 Not Yet — 3 things (`components/marketing/not-yet.tsx`)

| Element | Today | Rewrite |
|---|---|---|
| Eyebrow | `What it doesn't do yet` | `Not yet` |
| H2 | `Three things it can't.` | `What it can't do.` |
| 1 | `Doesn't read your scope, scan tool, or photos — you describe what you see in words.` | `Doesn't read scope traces or scan tool screens. Wiring diagrams it does — upload a photo.` |
| 2 | `Doesn't integrate with shop software.` | `Doesn't talk to shop software.` |
| 3 | `If the web doesn't have good info on your vehicle, it says so.` | `When the open web doesn't have info on your car, it tells you.` |

Bullet 1 fix is important: the page today claims the AI can't read photos, but the wiring-diagram vision adapter (`lib/ai/vision.ts`, `WIRING_DIAGRAM_VISION_SYSTEM` prompt) is shipped and working.

### 5.10 Improving / credibility (`components/marketing/improving.tsx`)

Repurposes the existing two-beat section. After two revision rounds with Brandon, the section drops both the "four techs" count (reads small, ages fast) and the first-person "I" (reads as founder bragging). Lands on the group-effort flywheel — the more it runs, the sharper it gets — with the hand-tuning beat preserved as collective "we."

| Element | Today | Rewrite |
|---|---|---|
| Eyebrow | `Always improving` | `Always improving` (kept) |
| H2 | `It gets sharper every week.` | `Sharper with every diagnostic.` |
| Beat 1 label | `The data deal` | `Used by techs, made sharper by techs` |
| Beat 1 body | `Your sessions train the engine. Every diagnosis you run makes it smarter — for you and every tech using it. The more you help it, the better it gets. That's the trade.` | `Every diagnostic teaches it. The more it runs, the better it gets.` |
| Beat 2 label | `The velocity` | `Hand-tuned every week` |
| Beat 2 body | `Some weeks 75 updates, some weeks 300, some weeks 1–2 — but it never stops getting smarter.` | `Every week we retrain it on what the bay learned. Your sessions go into that pile too.` |

No first-person on the page. "We retrain it" in Beat 2 keeps the trust signal that real humans tune this weekly, without naming the founder.

### 5.11 Pricing (`components/marketing/pricing.tsx`)

| Element | Today | Rewrite |
|---|---|---|
| Eyebrow | `Subscription` | `Subscription` |
| Price | `$100` | `$100` |
| Period | `per month / single seat` | `per month, one tech` |
| Terms | `Cancel anytime, no contract.` | `Cancel anytime. No contract.` |
| Comp | `Less than AllData ($209/mo) or Identifix ($180/mo). Thinks alongside you in real time.` | `Less than AllData ($209). Less than Identifix ($180).` |
| Button label | unchanged | unchanged |

### 5.12 FAQ (`components/marketing/faq.tsx`)

| # | Q today → rewrite | A today → rewrite |
|---|---|---|
| Eyebrow | `Questions` | `Questions` |
| H2 | `Six common ones.` | `The common ones.` |
| 1 | `What does it work on?` | `Any car you describe in words. Strongest where prior info is widely documented; honest "I don't know" otherwise.` → `Any car you can describe in words. Best on cars with a lot of forum and TSB history. When the open web doesn't have good info, it tells you.` |
| 2 | `Can I use it on customer cars from day one?` | `Yes.` *(unchanged — best one-word answer on the page)* |
| 3 | `How does it know it's right?` | `Every reasoning step cites the source it's pulling from. Tap a citation, see what it read.` → `It doesn't claim to be right. It shows you what it read. Tap any source. Check the work yourself.` |
| 4 | `Can I see past diagnoses on the same vehicle?` → `Can I see past diagnoses on the same car?` | `Yes — vehicle history view ships with launch.` → `Yes. Every car has its own history page. Past sessions, locked diagnoses, the lot.` |
| 5 | `Is my shop data private?` | `Your sessions train the engine — that's how it gets smarter. Sessions stay private between you and Vyntechs; we don't sell or share data.` → `Your sessions train the engine. That's how it gets sharper. We don't sell or share your data.` |
| 6 | `Can I cancel anytime?` | `Yes, instantly from your billing page.` → `Yes. Cancel button is on your billing page.` |

### 5.13 Final CTA (`components/marketing/final-cta.tsx`)

| Element | Today | Rewrite |
|---|---|---|
| H | `Built for techs who have to be right.` | `Take it on the next hard car.` |
| Button label | unchanged | unchanged |
| Terms line | `Single seat · cancel anytime` | `One tech · cancel anytime` |
| Legal | `Vyntechs · vyntechs.dev · A diagnostic co-pilot built by working techs.` | `Vyntechs · vyntechs.dev · Built by a working tech.` |

### 5.14 Phone screen placeholders (`components/marketing/screens.tsx`)

| Where | Today | Rewrite |
|---|---|---|
| `ScreenResearch` citation 2 | `AllData wiring · cyl 4 injector harness` | `Wiring photo · uploaded · cyl 4 pinout` |
| `ScreenResearch` citation 4 | `iATN case · 2022 · same symptom` | `Open web · cyl 4 misfire after hot soak` |

All other placeholder text in `screens.tsx` (intake, propose, confirm, lock) is plain shop-floor language already — left untouched.

## 6. What we are NOT changing

- Section count, order, layout, design system.
- In-app surfaces (`/today`, `/intake`, `/sign-in`, etc.).
- The Pricing comparison to AllData/Identifix — that's competitive pricing, not a sourcing claim.
- Screenshots (real-screenshot swap is a separate follow-up PR).
- The "real screenshots" claim — does NOT ship in this PR because the screenshots aren't real yet.

## 7. Branch + PR

- Branch: cut from current `origin/main` HEAD (commit `35e919c`). Branch name: `chore/landing-copy-rewrite`.
- PR opens against `main`. Brandon merges via the GitHub UI from his phone after viewing the Vercel preview.
- No merge to `main` or `staging` from this session.

## 8. Verification before opening PR

- Run the dev server, load `/` while signed-in and signed-out.
- Walk every section. Read every line out loud (parts-counter test).
- Confirm no "AllData" / "iATN" string remains in any marketing component (`grep -r 'AllData\|iATN' components/marketing/`).
- Confirm no `Decision trees with calibrated confidence`, `conflate`, `Some weeks 75 updates`, or `Bigger screen. Same brain.` strings remain.
- Confirm the Pricing comp line still has the AllData/Identifix prices (that one stays — competitive pricing).
- Build passes typecheck.
