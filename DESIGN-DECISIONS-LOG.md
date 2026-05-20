# Phase 3 PR1 — Design Decisions Log (for Brandon)

**What this is:** While Brandon was asleep, Claude continued executing Phase 3 PR1
(W1–W6). When a design/product question came up that Claude wasn't certain about,
Claude answered it *as Brandon would* — using his judgment and the project memory —
and logged the call here so Brandon can review and override when he returns.

**This branch (`phase3-pr1-design-notes`) is a scratchpad, not code.** It branches
off `feat/phase3-pr1-platform-resolver`. Nothing here merges anywhere. Brandon reads
it, then either says "all good" or "change #N" and Claude adjusts the real PR branch.

**How to read it:** Each entry below is one decision. ✅ = Claude made a call and
moved on. ❓ = Claude wants Brandon's explicit answer before it's locked.

---

## Decisions made on Brandon's behalf

### ✅ D1 — Renamed "Start the walk" → "Start diagnosis" (W2/W4 CtaBar)

**Context:** The cached-overview screen has a bottom button that takes the tech from
the diagnosis summary into the step-by-step test procedure (the actual walkthrough
ships in PR2). The plan + design package labeled this button "Start the walk."

**Brandon's call (spoken 2026-05-19):** "start the walk is not a term that would be
used in automotive software." Confirmed not real shop language.

**Decision I made for you:** Renamed the button label to **"Start diagnosis"** across
PR1 — plain, passes the 10-year-old test, reads naturally to a tech (the overview is
the prep/summary, the button is "let's go"). Applied as the `CtaBar` default label.

**Easy to override:** It's a single `label` prop default. If you'd rather have
"Start testing", "Begin pinpoint tests", or anything else, it's a one-word change —
tell me and I'll swap it.

### ✅ D3 — Added a new brand token `--vt-amber-600` (darker ignition)

**Context:** The cached-overview CSS (from the Claude Design package) calls a color
token `--vt-amber-600` for the main button's hover state — but that token was never
defined; the amber scale stopped at `--vt-amber-500` (the canonical ignition amber).
So the button's hover currently does nothing.

**Decision I made for you:** Added `--vt-amber-600` as the next darker step on the
existing amber scale — `oklch(73% 0.20 74)`, following the same lightness/chroma/hue
progression as amber-200→500. A darker amber for a pressed/hover amber button.

**Why not the other option:** An old spec doc cross-referenced amber-600 to
`--vt-signal-600`, but signal-600 is the navy brand color — a navy hover on an amber
button would look broken. Claude Design's CSS clearly *intended* an amber-600 to
exist (they referenced it); they just didn't define it.

**Easy to override:** One line in `app/globals.css`. If Claude Design wants a
specific amber-600, swap the oklch value — nothing else depends on the exact shade.

### ❓ D2 — CtaBar sub-labels "Step 1 of plan" / "no commit" — need your read

The CtaBar primitive also shows two small sub-labels above the button. The design
package defaults them to "Step 1 of plan" and "no commit". "no commit" is unclear —
it may mean "you're not locked in yet" or relate to the engine's commit verdict.
I left the plan defaults in the generic primitive for now; the REAL on-screen copy
gets decided when the screen is built (W4). I'll propose plain wording there and log
it — flagging now so you know it's coming.

---

## Open questions for Brandon

_(none yet)_
