# The Diagnostic Loop — and "where do I start" (Triage) as its first step

**Date:** 2026-06-21
**Status:** Design spec — pending Brandon's review.
**Plain-language rule:** this whole doc is written so a technician can read it. No engineer-speak.

---

## The one idea

A diagnosis is a chain of eliminations — you rule things out one at a time until one cause is proven.

The tool's whole job, at every moment, is to pick the **single best next thing** for the tech to check or answer — the one that rules out the most possible causes and pushes confidence up the fastest — and make doing it as painless as possible. Then do it again. And again. Until the answer is proven.

**"Where do I even start?" is not a special problem.** It's just the first elimination. Same loop as every step after it.

---

## The law — every step must obey this

1. **Accuracy first, always.** A fast, painless, *wrong* answer is a failure. Confidence is earned by real checks the tech actually confirmed — it is never faked.
2. **Highest-yield next step.** At each point the tool picks the one check/test/question that knocks out the most remaining possible causes and raises confidence the most, for the least effort. Most ruled out, least pain.
3. **Never give up as the posture.** When it's unsure, the answer is NOT "I can't tell — go find a specialist." The answer is "here's the smartest next thing to narrow it down." It keeps finding the next high-yield step. An honest hand-off to a specialist is the **last** resort — only when there's genuinely no next step that would help — never the opening move.
4. **One thing at a time.** One check on the screen. Never a wall of them.
5. **Painless and motivating.** Every step is built so the tech *wants* to answer it (the rules for that are below).
6. **It all happens on the diagram.** No separate quiz, no wizard, no chatbot. The wiring/system diagram is where the asking happens.

---

## What the tech actually does (the loop)

1. **Describe the problem** at intake — codes, vehicle, what it's doing. *(unchanged from today)*
2. **First check (this is "triage"):** the tool shows the single best first check — the one that rules out the most. It says *what* to check, *what a good reading looks like*, and *why* (e.g. "this tells us fuel-in or fuel-out"). The tech does it and enters what they got.
3. **The map updates:** it crosses off what's now ruled out, confidence ticks up, and it shows the next single best check.
4. **Repeat** until one cause is proven (confidence over the bar) — or, rarely, until there's genuinely no next step worth doing, in which case it hands off honestly, *with everything it already learned*.

**Walk-through — intermittent no-start, cranks fine, no codes, '13 F-250 6.7:**
- Step 1 (triage): instead of "is it fuel, injectors, or the computer?", it shows one check — *"check fuel rail pressure while cranking — you want 4,000+ psi."* The tech cranks and reads.
- Reads low → fuel side stays in play, everything else is crossed off, the fuel system opens with that reading already logged. Reads good → fuel is crossed off, it moves to the injector/computer side.
- One check. The most possibilities knocked out. Confidence up. No guessing.

---

## The rules that make each step painless (and make them *want* to answer)

- **One thing, never two.**
- **Always show what this check rules out.** Seeing the point kills the "why am I doing busywork" feeling.
- **Hand them what-good-looks-like.** No remembering specs, no feeling dumb.
- **Pay it off instantly.** The second they enter the reading, the map visibly crosses something off. Progress is the reward.
- **Confirm, don't quiz.** A master tech can say "I already know it's X" and jump ahead — never talked down to.
- **Cheapest/fastest check first.** Free or visual before teardown — least pain per answer.
- **Never make them feel wrong.** An unexpected reading *routes* them to the right place; it doesn't scold.
- **Painless words everywhere.** Every word self-evident, fewer words not more, no jargon.

---

## When the tool is unsure (the important part)

Unsure is the **normal** state at the start of every diagnosis — that's the entire reason the loop exists. So "unsure" is not a failure and not a reason to hand off. When two or more causes are still in play, the tool:

1. Finds the one check that best separates them (rules out the most).
2. Shows it as the next step — plainly, with what-good-looks-like.
3. Routes on the result and raises confidence.

Only when there is genuinely **no** next step that would raise confidence does it honestly hand off — and even then it hands off *with the eliminations already done*, so the specialist starts ahead, not from scratch.

---

## What's real today vs. what grows (honest build reality)

Grounded in the actual code (build-lead review):

- **Today** the tool picks *one* answer by matching keywords. It has no confidence score and no list of competing causes yet. The seeded knowledge is one system per complaint, two truck platforms.
- So "pick the highest-yield next step among competing causes" needs two things that are mostly **net-new**: (a) the tool knowing the competing causes for a complaint, and (b) knowing which check eliminates the most. Both are knowledge your **curator** seeds.
- The good news: the fast path (the topology read) is cheap and does **no** AI calls — so doing this well is cheap, **as long as** the "which step rules out the most" logic stays rule-based and doesn't call an AI mid-intake (that's what caused the earlier timeouts).
- **Build order:** it works great where the curator has seeded the competing causes + the high-yield checks, and gets smarter as more is seeded. It must **never** fake a confidence number or invent a check where the knowledge isn't there — that breaks the accuracy law (rule #1).

---

## Accuracy guardrails (how rule #1 stays true)

- Confidence only goes **up** from real checks the tech confirmed.
- Every confidence number carries its story (what checks earned it).
- Nothing — step, value, source — is ever shown unless it's real. Missing = "not captured yet," never a fabricated default. *(This is also the live trust fix already flagged as Phase 0.)*

---

## Out of scope (separate problems, same loop later)

- **P2** no-code / intermittent ("stalls randomly, no codes")
- **P3** zoom/scale on a phone for big systems
- **P4** complaints with no number to read (noise, vibration, leak)

These are handled later and obey the same loop.

---

## What I need from Brandon

Just confirm the law above is right (accuracy first · highest-yield next step · never give up as the posture · painless · on the diagram · triage = the first step). If it is, this goes straight into the implementation plan. If any line is off, tell me which one.
