# Topology Guided Diagnostic — Claude Design Handoff

**Date:** 2026-05-23
**Branch:** `feat/topology-guided-walk` (the branch name predates the vocab rename; internally code says "walk," UI says "diagnostic")
**From:** Claude Opus (engineering / planning lane) — handing off to Claude Design (visual lane)

**Brandon's one-line paste to start a Claude Design session:**

```
Read docs/superpowers/handoffs/2026-05-23-claude-design-topology-guided-diagnostic.md — design the topology guided diagnostic visuals. You should be on branch feat/topology-guided-walk; if not, git fetch && git switch feat/topology-guided-walk.
```

---

## The assignment in one paragraph

Vyntechs is an AI diagnostic tool for automotive techs. When a tech enters a vehicle + a symptom (e.g., 2017 F-350, P0087), the interactive wiring topology opens — instant, no AI in the loop. Today the topology is read-only browse. This PR turns it into a **guided diagnostic**: the tech taps results, the system records them, the diagram fills in as a quiet progress record, and the system silently sequences the next test. Your job: design the visuals — premium pro-tool aesthetic that removes cognitive load from a working tech in a noisy bay.

## Who the user is

Master technician. Coveralls. Hands possibly gloved. Phone or laptop in one hand, scanner cable in the other. Background noise. Not impressed by typical UI — wants to find the fault and get the truck out of the bay. Has used Snap-on, Autel, Mitchell 1, Identifix — knows what premium pro tools look like and rejects what looks generic.

Mobile-first. The tech is more often on their phone than at a workstation.

---

## What's locked (don't relitigate)

These are settled by prior brainstorm + Brandon's product calls. Don't argue with them; everything else is yours.

1. **Diagram-as-scoreboard.** The wiring topology IS the diagnostic surface — the active part lights up, done parts fill in, the topology is the progress record. Rejected alternative was "guide in the panel" (diagram stays static, side panel walks through). Locked.
2. **One thing to do at a time.** No "Step 6 of 10." No "4 to go." No numbered upcoming. Counters are retrospective only ("6 checked"). The system removes cognitive load; previewing future work adds it.
3. **Walk + save together** in this single PR. Every result is persisted to the database; the diagram state is *derived* from those rows on reload.
4. **Vocabulary:** the user-facing word is *diagnostic*, never *walk*. Internal code uses "walk" because the branch shipped with it; UI must say "diagnostic."
5. **No "AI" in user-facing copy.** The model is invisible plumbing.
6. **Existing design tokens.** Bone palette (warm paper) in oklch color space, Instrument Serif (default body face — distinctive), Inter Tight (sans for chrome), JetBrains Mono (labels), the spacing ramp at `app/globals.css`. You can add new tokens if you need them, but don't introduce a new palette or font family.
7. **Mobile validation required.** Every screen passes 375–414px before "done."

## What's open (your space)

Everything visual. Brandon has clear leanings below — read them as directional, not as specs. **Push back where you see a better path** — that's the point of handing visual design to you instead of locking it.

### Brandon's leanings (open to push-back)

- **Premium pro-tool feel — instrument, not consumer app.** References that came up in our research and felt right to Brandon: Linear's restraint, Stripe's discipline, Things 3's satisfaction physics, Teenage Engineering's confidence-through-limitation, Leica's no-explaining-yourself doctrine, Bloomberg's intentional density. The 5,200-word premium-UI research doc (path below) goes deeper. Try the direction; argue for a different one if your reading of the brief differs.
- **Hero scale on the active component name.** Round-2 used 56px Instrument Serif on desktop, 42px on mobile — the only thing the tech needs to read at arm's length. Pro tools commit to one dominant element (Things 3, Linear's issue detail). Try this scale; argue for a different ratio if the layout calls for it.
- **Color earned, not literal.** Brandon's lean: verdict colors (green/amber/red) only when the tech is about to commit or has committed — not as ambient decoration. Resting state is monochrome paper. If you find a case where more ambient color genuinely improves clarity, make it.
- **Motion conveys weight.** The branch-tap should sequence press → commit → settle (round-2 used 60 / 120 / 200ms). Stripe's test: *"if you disable animations, the flow should feel broken."* The round-1 mockup failed this test (alert dialogs). Treat motion as a first-class element of the design, not an afterthought.
- **Materiality: ink on bone paper, not tablet app.** Sharp corners (0–2px) on actionable elements. Heavier stroke weights (1.6–2.4px node borders, like a circuit schematic). Mobile sheet rises from a heavy bone-800 top edge — paper-fold instinct. Brandon's stated palette intent in `app/globals.css` is "Workshop Instrument: bone canvas, signal-navy blueprint ink on bond paper."

### Anti-patterns Brandon has explicitly rejected

These are the visual tells from round-1 that got called "vibecoded / cheap / plain":

- Dotted graph-paper backgrounds (v0/Cursor tell)
- Verdict-icon-in-circle cards (todo-app pattern)
- Progress pill strips at the top of the page
- "Step N of M" counters
- Tiny mono-uppercase letter-spaced placeholder labels (every Tailwind UI dashboard)
- Default border-radius ladder (4/6/10px — Tailwind-default)
- Uniform 16px spacing everywhere (monotone)
- Generic `translateY(-1px) + shadow` lift on hover
- Color used as decoration (green ✓ everywhere, red ✗ everywhere)
- Status colors at full saturation on bg + border + badge simultaneously
- `alert()` dialogs as feedback

If any of these creep back in, the design is wrong.

---

## References to load before designing

Read in this order:

1. **Original brainstorm kickoff** — `docs/superpowers/handoffs/2026-05-22-topology-guidance-brainstorm-kickoff.md` — what's locked and what's open at the product level. (Some decisions in here have since been adjusted — see "What's locked" above. Where this doc and the kickoff disagree, this doc wins because it's newer.)
2. **Existing-flow research** — `docs/superpowers/research/2026-05-22-existing-diagnostic-flow.md` — how the product actually works today. The topology surface ships as a free-browse map; the guided diagnostic *transforms* it, not replaces it.
3. **Premium UI research** — `docs/superpowers/research/2026-05-23-premium-ui-research.md` — 5,200 words on what premium pro-tool UI does and what mine didn't. The 10-step recipe at the bottom is the actionable section; it's a recipe Brandon broadly likes, but you're free to deviate where you can articulate a better answer.
4. **Existing design tokens** — `app/globals.css` — full token system: palettes, type, space, motion, materiality intent.
5. **Existing topology code** (skim, don't replicate) — `components/topology/` and `components/screens/topology-diagnostic.tsx`. You're not writing React; you're designing what React will eventually render.
6. **My iteration history** (round-1 and round-2 mockups) — `mockups/topology-guidance/` — round-1 is "what got rejected as vibecoded," round-2 is "the recipe applied." Both are data points, not specs. Open them in a browser to feel the difference Brandon felt; don't anchor to either.

## Live data (use this, no lorem)

All mock data must come from the real 2017 F-350 / P0087 fuel-system case in the Supabase project `ynmtszuybeenjbigxdyl`. The round-2 mockup at `mockups/topology-guidance/mid-walk.html` already has the real strings for the in-progress scenario — copy from there. For other scenarios you'll need:

- Real `branch_logic.condition` text per test action
- Real `nextAction` text for fail-branch recommendations
- Real component names + the topology connections

Query via the Supabase MCP or look at the round-2 mockup for examples. The grounding session id is `681de115-5de9-474e-9721-263f65066e08`.

---

## What to design — scenarios + viewports

Six scenarios, each in **desktop (1280–1440px)** + **mobile (375–414px)** variants:

1. **Just started** — the tech entered intake, the diagnostic opened, the first test is active. The diagram is full but quiet; nothing's been checked yet. (How does the first impression feel? Confidence-inspiring without overwhelming?)
2. **In progress** — partway through (the round-2 reference: 6 checked, PRV bleed-down active, the rest of the diagram quiet).
3. **Diagnosis — fix card** — a tech taps a fail branch; the active panel transforms into the answer reveal. Likely shows the recommendation + the trail of what was run. Premium "answer reveal" energy, not "alert dialog."
4. **All tests passed** — every implicated test came back OK; no fault found. Graceful escalation/handoff energy, not "FAILURE" or "TRY AGAIN."
5. **Resuming after reload** — the tech closed the tab mid-diagnostic. They reopen the same session. Sticky banner? Silent resume? Cold-start to active test? Pick the path that feels right.
6. **Can't run this test (escape)** — what happens when the tech taps "Can't run this →"? Skip silently, log a reason, prompt with a tight micro-interaction? Design it.

For each scenario, also draft the **motion choreography** for entering it and transitioning out of it. The HTML can demonstrate motion; the rationale doc explains it.

## Deliverable shape

- **Output location:** `mockups/topology-guidance/round-3/` (new subdirectory; round-1 and round-2 stay for diffing).
- **Format:** standalone HTML/CSS pages, no React, no build step. Served by `python3 -m http.server 8765` from the `mockups/topology-guidance/` dir. The local server may already be running; if not, start it.
- **Real data only.** F-350 / P0087 throughout.
- **Design rationale doc:** alongside the HTML, write `mockups/topology-guidance/round-3/RATIONALE.md` — what you borrowed, what you rejected, what's still open. This is what Claude Opus reads when picking up your output. Include:
  - The motion choreography for each transition (durations, easings, what enters/exits)
  - Specific token choices (when did you reach beyond the existing palette and why)
  - Open questions you couldn't resolve
- **Package summary:** when you finish, write `mockups/topology-guidance/round-3/PACKAGE.md` listing what's in the dir, the rationale highlights, and any pending decisions for Brandon. This is the resume-from-here document for the next session.

## The "we succeeded" test

Show the in-progress mockup to a master tech for **3 seconds** and ask:

1. *What component are you testing?*
2. *What do you do?*
3. *Where do you tap?*

If all three answers come within 3 seconds — no precision tap required, no jargon hunt, no "let me find the…" — the design works.

Second test: **if the screen looks like it could be on any SaaS website, it's wrong.** Premium means *no other diagnostic tool looks like this.*

---

## How Claude Opus will resume

When the package is ready, Brandon hands me the path. I:
1. Read your rationale + the new mockups
2. Refine the 7-section design draft (from the original kickoff) to match your visuals
3. Write the formal spec at `docs/superpowers/specs/2026-05-23-topology-guided-diagnostic-design.md`
4. Run a spec self-review
5. Hand back to Brandon for spec approval
6. Invoke `superpowers:writing-plans` for the implementation plan
7. Hand off implementation to a fresh execution session

You don't need to write any code — your output is design artifacts and rationale only.

---

## Last word

Brandon's "north star" for Vyntechs (from memory): *AI master techs actually trust.* Trust is the moat. Every visual decision should reinforce that the tool is precise, confident, and respects the tech's expertise. If a choice would make a 30-year master diesel tech roll their eyes, it's wrong. If it makes them lean in, it's right.

Push back where you see better. Ship what you'd put your name on.
