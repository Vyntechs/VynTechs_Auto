# Figma Make prompt — "The Manual, Filmed" (scroll-cinema landing)

**Date:** 2026-07-12 · **Status:** READY TO PASTE — motion-prototype lane for gate 2, alongside static v3
**Origin:** Brandon: full power of Figma in the real world; reference https://terminal-industries.com — "3d almost like a movie that plays based on scroll position… a video commercial for a Super Bowl"; deliverable = the Figma Make prompt.
**Relationship to gates:** this does not replace the v3 Figma approval — it is the *motion dimension of the same design language* (`2026-07-11-vyntechs-design-language.md`, motion spec §6.4 extended here). Claims discipline identical: shipped rows 1–22 + live FAQ facts; placeholders tagged on-screen.

## 1. What we take from the reference (grammar, not look)

Verified live 2026-07-12: terminal-industries.com is ~22 viewport-heights of scroll carrying roughly twenty sentences. The mechanics that make it feel like a film:

1. **Scroll is the timeline.** Scenes pin (`position: sticky`) and play across long scroll budgets (their "Yard Operating System" reveal alone owns several viewports, assembling letter by letter).
2. **The words are sparse; the world carries them.** Text arrives in short beats; the rendered world does the persuading.
3. **Chapter eyebrows** ("Built by the Industry", "How it Works") segment the film.
4. **The close is one line + one action.**

**The anti-familiarity line:** they render a logistics yard at dusk in WebGL. We render **paperwork under shop light**. Same grammar — scroll-as-timeline, pinned scenes, annotation-as-UI — opposite world. If the result feels like Terminal, it's wrong.

**Our structural advantage:** their 3D needs WebGL. Ours doesn't — *paper is flat*. The exploded quote is stacked flat planes in a CSS `perspective` container, the one kind of 3D generative tools execute flawlessly at 60fps.

## 2. The rule that makes it functional (Brandon's instinct, made law)

> **Every animation is information.** Numbers count because evidence is accumulating. Lines draw because a connection is being made. Stamps land because a fact just became official. Motion makes the reader *want* to read; it never replaces reading. With motion off, the page reads perfectly as a printed manual.

Plus two ethics rules that travel from the design language into motion: **the absent button never animates** (absence doesn't perform), and **the signature line never animates** (the human's act belongs to the human).

## 3. THE PROMPT — paste into Figma Make

```
Build a one-page, scroll-driven cinematic website in React. The scrollbar is a
film's timeline — but the film is a factory service manual. Not a loose metaphor:
the page IS the manual, and scrolling reads it.

PRODUCT
Vyntechs Shop OS — software for independent auto-repair shops (1–20 bays). It runs
the whole job: counter check-in → tech assignment → diagnosis → an evidence-backed
story the customer can read → quote approval → closeout. Its signature is the
refuse-to-guess engine: below a calibrated confidence line, the send-quote action
does not exist. Audience: skeptical shop owners who still wrench, and engineers who
will inspect this page like source code. Voice: factory service manual —
declarative, measured, zero adjectives; dry wit only in small rust-colored margin
notes.

THE RULE THAT GOVERNS ALL MOTION
Every animation is information. Numbers count up because evidence is accumulating.
Lines draw because a connection is being made. Stamps land because a fact just
became official. Nothing floats, pulses, or shimmers for atmosphere. Under
prefers-reduced-motion, every scene renders as its final static state and the page
reads perfectly as a printed manual.

DESIGN TOKENS (exact — invent no others)
Background MANUAL #F7F7F4 (cold manual white, never cream). Ink CARBON #181512.
Goldenrod TICKET #E8AC3F — index tabs, part tags, stamps; never body text.
OXIDE #A35129 — margin notes and small marks only. NAVY #1C3A5B — the ONLY action
color. TRACE #7FA3C8 — signal color on carbon backgrounds only. MANILA #F2EAD9 for
shop-copy paper. No gradients anywhere. Corner radius 0–4px. Hairline rules 1px
carbon; section rules 3px.

TYPE (all on Google Fonts)
Display: Barlow Condensed Black/Bold, ALL CAPS, tight leading — headlines feel like
stencilled panel labels. Body: Barlow Regular/Medium. Data: JetBrains Mono for
everything measured, timed, numbered, or logged. Instrument Serif Italic appears
ONLY when a human being is speaking — one customer sentence and one founder
sentence. Nowhere else, ever.

PERSISTENT CHROME
Top strip, mono, tiny: SERVICE & OPERATION MANUAL — THE MODERN REPAIR SHOP ·
DOC VYN-LP-004 · REV D. Fixed right edge: a rail of goldenrod index tabs — 01 THE
PITCH · 02 DIAGNOSIS · 03 THE LINE · 04 ONE TICKET · 05 SPECS · 06 AUTHORIZATION.
The tabs ARE the navigation and the scroll-progress indicator: the active tab
extends slightly and fills as its section plays; clicking a tab scrolls there. On
mobile the rail collapses to a thin goldenrod progress spine.

SCENE 1 — COVER (100vh)
Manual-white. The doc header types itself in mono, fast and mechanical. The title
sets like type locked into a press, line by line: "THE SHOP OS THAT" in carbon,
then "SHOWS ITS WORK." in navy — and on its arrival a 3px rule draws across the
page and one goldenrod stamp lands: EVERY CLAIM ON THIS PAGE CARRIES A RECEIPT.
Mono scroll cue: SECTION 01 OF 06 — SCROLL TO READ. Buttons: navy RUN ONE DAY'S
TICKETS THROUGH IT; ghost READ A FINISHED TICKET ↓.

SCENE 2 — FIG. 1, THE EXPLODED QUOTE (pin for 300vh) — THE SHOWPIECE
Center: one white card holding a customer sentence in Instrument Serif Italic:
"The pipe that feeds your turbo is leaking at a clamp seam. We're replacing the
clamp — not your turbo." As the visitor scrolls, the card explodes into four
stacked paper plies in real 3D — a CSS perspective container, planes separating on
translateZ and tilting ~30° into an isometric fan. Paper is flat: build the 3D as
layered flat planes, not WebGL.
· PLY 01 — THE WORDS: the sentence itself, white paper.
· PLY 02 — THE EVIDENCE: manila paper, mono rows — SMOKE TEST: PASS AT IDLE ·
  FAIL UNDER LOAD · CLAMP SEAM WEEP CONFIRMED.
· PLY 03 — THE MEASUREMENT: a carbon instrument strip — BOOST 11.2 PSI · SPEC
  17.4 PSI, mono, in TRACE blue.
· PLY 04 — THE NAME ON IT: white slip — CALLED BY M. RIVERA · 14:41 ·
  CONFIDENCE 87.0.
As each ply separates, a 1px leader line draws outward to a goldenrod part tag:
01 THE WORDS / 02 THE EVIDENCE / 03 THE MEASUREMENT / 04 THE NAME ON IT. The
camera dollies slowly (a few degrees of container rotation across the whole pin —
restrained). Final beat: the plies snap flat back into one card and a goldenrod
stamp lands: EVERY QUOTE CARRIES ITS PROOF. Caption, mono: FIG. 1 — ONE QUOTE,
PULLED APART · EXAMPLE CASE — TICKET №1042 · F-150 3.5L ECOBOOST. The word
EXAMPLE stays visible the entire scene.

SCENE 3 — DIAGNOSE YOUR OWN SHOP (150vh)
A ruled diagnostic table: SYMPTOM → TEST IT YOURSELF → CORRECTIVE ACTION. As each
row crosses viewport center it "runs": the test types itself in mono, then the
action stamps in. Three rows:
· "You eat comebacks on flat rate." → PULL LAST MONTH'S TICKETS. COUNT "REPLACED,
  DIDN'T FIX." MULTIPLY BY YOUR LABOR RATE. → Below the line, the guess never
  reaches the customer.
· "Customers doubt every quote over $400." → READ YOUR LAST DECLINED ESTIMATE.
  COUNT THE SENTENCES THAT PROVE ANYTHING. → Every quote ships with its evidence
  and the name that called it.
· "Your software files tickets. It helps nobody." → OPEN YOUR SYSTEM. FIND ONE
  SCREEN THAT MADE A TECH FASTER TODAY. → An OS that runs the job, not a cabinet
  that stores it.
Oxide margin note: (THE TESTS RUN ON YOUR RECORDS, NOT OUR MARKETING. WE'D RATHER
YOU CHECK US.)

SCENE 4 — THE CARBON CENTERFOLD (pin for 250vh) — THE SECOND SHOWPIECE
The page turns: a full-bleed carbon-black spread wipes up like flipping to the
manual's centerfold. Headline: BELOW THE LINE, THERE IS NO BUTTON.
A raised instrument gauge reads 43.4 in amber, and beneath it sits a dashed empty
outline where a button would be, labeled: (NOT DISABLED. NOT GREYED OUT. GONE.) ·
WHAT EXISTS INSTEAD: THE NEXT TEST WORTH RUNNING.
HARD RULE: this void NEVER animates. No fade, no dissolve, no shimmer. Absence
does not perform.
As scroll advances, evidence receipts slam in one at a time as goldenrod tags —
SECOND SOURCE CONFIRMED · MEASUREMENT LOGGED: 11.2 PSI vs SPEC · SIGNED:
M. RIVERA — and the gauge counts 43.4 → 87.0 in mono with a thin needle sweep.
(The needle may keep a 0.5px idle tremor — the only ambient motion on the site.)
At exactly 87.0, the navy SEND QUOTE → button is pressed into existence with one
hard stamp. Beside it: (EARNED. TWO SOURCES, ONE MEASUREMENT, ONE NAME.) Closing
lines: SAME ENGINE. DIFFERENT EVIDENCE. DIFFERENT RIGHTS. and (YOUR CURRENT
SCANNER HAS NEVER ONCE SAID "I DON'T KNOW.")

SCENE 5 — ONE TICKET, START TO FINISH (pin for 200vh, horizontal)
Back to manual-white with a page-turn wipe. A horizontal day-ledger tracks
right-to-left as the visitor scrolls — seven stations from 07:42 CHECK-IN AT THE
COUNTER to 16:15 CLOSED, PAID, DOCUMENTED, each timestamp stamping in mono as it
crosses center. Persistent chip: EXAMPLE DAY — NOT A LIVE FEED. Closing line: THE
REFUSE-TO-GUESS ENGINE IS STEP 3 AND 4 — BUT THE SYSTEM IS THE WHOLE ROW.

SCENE 6 — SPECIFICATIONS, THEN AUTHORIZATION (200vh, the close)
Pricing as a torque-spec table, ruled lines drawing in:
PRICE — $100 / TECHNICIAN / MONTH, stamped once (no pulse, no confetti), tagged
PLACEHOLDER — PRICING MODEL PENDING. THE MATH — Eight techs is $800 a month. If
that doesn't beat one eaten comeback this year, don't buy it. CONTRACT — NONE.
CANCEL ANY MONTH. YOUR DATA LEAVES WITH YOU. SPECS INVENTED — 0. SECURITY — NO
SOC 2 BADGE YET. WE'D RATHER SAY SO.
Then all motion stops. A quiet white authorization sheet: YOU'VE READ THE MANUAL.
A signature line X ______________ and DATE ______________ — these two lines are
the only elements on the site that never animate at all; they wait. Founder line
in Instrument Serif Italic: "I built this because I was tired of watching good
techs eat the blame for bad guesses." — THE FOUNDER, VYNTECHS · WRITTEN, NOT
GHOSTWRITTEN. Navy button: AUTHORIZE THE WORK — START AT $100/MO. Ghost: RUN ONE
DAY'S TICKETS THROUGH IT. Mono footer: DOC VYN-LP-004 · REV D · IF A CLAIM HAS NO
RECEIPT, IT DIDN'T SHIP.

MOTION GRAMMAR (global)
Paper and machinery only: stamp, slam, draw, sweep, type, count. Durations
150–400ms, ease cubic-bezier(0.16,1,0.3,1). Ink never fades in — it types, draws,
or stamps. No parallax drift on text, no floating elements, no springs, no
infinite loops (except the needle tremor). Pin scenes with sticky positioning;
animate only transform and opacity; hold 60fps.

NEVER
Purple, or any gradient. Glassmorphism. Particle fields. Floating 3D blobs.
Testimonials, logos, star ratings. Countdown timers or urgency. "AI-powered" as a
selling point. Lorem ipsum. Any number not written in this prompt — invent
nothing; every figure above is canonical.
```

## 4. How to run it

1. figma.com → **Make** → new Make file.
2. Paste the prompt.
3. **Attach the v3 frames as visual grounding:** open the design file (`wsfRi93M41ts5ONQvkGrJZ`), copy the v3 desktop hero, FIG.1 section, and carbon centerfold frames, paste them into the Make chat before sending. Make locks onto attached visuals harder than onto hex codes.
4. Generate, then iterate **one scene per message** (below). Expect 70–80% on the first pass; the pins and the two never-animate rules are where generators slip.

## 5. Iteration kit (ready-made red-lines)

- "Scene 2: the plies separate too fast — spread the explosion across the full 300vh so mid-scroll holds a readable exploded state."
- "Scene 2: tilt is too extreme; flatten toward 20° and keep every ply's text legible at all times."
- "Scene 4: the dashed void animated — remove every transition from it; it must be identical at every scroll position."
- "Scene 4: the counter should be scroll-linked, not time-based — scrolling back down must run the evidence in reverse."
- "Stamps are too soft. One hard 150ms scale-settle with no bounce."
- "The tab rail: active tab fills top-to-bottom exactly with section progress."
- "Reduced-motion check: with animations off, every scene must show its final state — no blank panels."
- "Type check: serif appears in exactly two places. If it's anywhere else, remove it."

## 6. Expectations and fallback

Make's output is the **approval artifact for motion**, not automatically the shipped site. If it holds 60fps and the rules, its code becomes reference input to the implementation slice; if it can't hold the pins, the implementation slice builds this exact scene spec in code (the motion spec already lives in the design-language doc §6.4 — this document supersedes/extends it with the full scene choreography). Either way, production goes through the standard gates.

## 7. Ethics carried into motion (binding, unchanged)

Absence never performs. The signature never animates. EXAMPLE and PLACEHOLDER tags live on-screen inside their scenes, not in fine print. All numbers canonical from this prompt — the generator is told to invent nothing. Reduced-motion = complete static manual.

## 8. PROMPT B — the blank-canvas control (Brandon, 2026-07-12)

Same product, same goal, **zero design direction** — Make owns concept, palette, type, layout, motion, metaphor. Only two fences stay: the goal (they define success) and the truth rules (they are the brand, not art direction). Run in a **separate Make file with no attachments** — attaching v3 frames would contaminate the experiment.

```
Design and build a launch-grade marketing website for a real product. You own
every creative decision — concept, art direction, palette, typography, layout,
motion, imagery, metaphor, copy tone. We are deliberately giving you no design
direction. Surprise us. Take a real risk. The only failure is resembling what
everyone else makes: if the result could be mistaken for a typical AI or SaaS
landing page, it has failed, no matter how polished.

THE PRODUCT (facts — the only claims you may make)
Vyntechs Shop OS: software for independent auto-repair shops (1–20 bays). It runs
the entire job: counter check-in → tech assignment → diagnosis → an evidence-backed
story the customer can read → quote approval → closeout. Its signature: the
refuse-to-guess engine. Every diagnosis carries a calibrated confidence number;
below the line, the send-quote action does not exist — not disabled, gone. A quote
becomes sendable only when it carries its proof: the words, the evidence, the
measurement, and the name of the tech who called it.
True material you may show (nothing else):
· An example case, labeled EXAMPLE: ticket №1042, F-150 3.5L EcoBoost, boost
  measured 11.2 PSI against a 17.4 PSI spec, a smoke test confirming a clamp-seam
  leak, called by M. Rivera at 14:41, confidence 87.0. The customer is told: "The
  pipe that feeds your turbo is leaking at a clamp seam. We're replacing the
  clamp — not your turbo."
· A blocked case at confidence 43.4 — same engine, thinner evidence, no button.
· An example day, labeled EXAMPLE: seven steps, 07:42 check-in to 16:15 closed,
  paid, documented.
· Pricing, labeled PLACEHOLDER — PRICING MODEL PENDING: $100 per technician per
  month. No contract, cancel any month, your data leaves with you. No SOC 2
  badge yet — we say so ourselves.
· The founder's words: "I built this because I was tired of watching good techs
  eat the blame for bad guesses."

THE AUDIENCE
Primary: the owner of an independent repair shop who still turns wrenches. He has
bought shop software that filed tickets and helped nobody, and AI tools that
guessed. He is skeptical of everything, especially marketing. Secondary, reading
over his shoulder: software engineers and recruiters who will inspect this page
like source code to judge the founder who shipped it.

THE GOAL
One job: turn that skeptical owner into someone who runs one day's tickets through
the product. The page should make him feel it was built by someone who has eaten a
comeback — and make the engineer close the tab wanting to know who built this.
It must be a showpiece: the kind of site that gets screen-recorded and shared.
Motion and interaction should make a visitor want to read, never require them to.

TRUTH RULES (non-negotiable — they are the brand)
Invent nothing: no testimonials, no customer logos, no star ratings, no
statistics, no urgency, and no numbers beyond those listed above. The EXAMPLE and
PLACEHOLDER labels stay visible on-screen wherever that material appears. If
honesty and persuasion ever conflict, honesty wins — persuade with what is true,
or not at all.
```

**A/B protocol:** Prompt A tests Make's *obedience* (can it execute our art direction); Prompt B tests its *taste* (what it invents unconstrained). Judge B by the same bar as everything else: thumbnail test, familiarity test, receipt test. Expected outcome: B lands in an AI-default look — that result is data, not waste; if B beats A anywhere, we steal that piece.
