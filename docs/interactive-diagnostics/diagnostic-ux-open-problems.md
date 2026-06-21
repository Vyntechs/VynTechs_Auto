# Diagnostic UX — Open Problems to Solve

**Logged:** 2026-06-21 (after pressure-testing the topology-as-diagnostic surface across 4 fault shapes).
**North star for every item below:** lowest possible cognitive load for the tech · highest productivity · deepest trust. If a solution adds a tap, a decision, or a doubt the tech shouldn't have to carry, it's wrong.

The interactive-topology surface (the diagram IS the diagnostic) held across a diesel fuel circuit, a mechanical misfire tree, a CAN-bus network, and a charging power-loop. These are the problems still in the way of it being friction-free for *every* job.

---

## P1 — Triage: "where do I even start?"  (highest priority)
**The problem.** Each diagram is *one system*. A real complaint often maps to several (a no-crank could be battery, starter, security, or PCM). The tech must land on the **right diagram** without already knowing the answer.
**The friction it creates.** Forcing the user to pick a system they can't yet identify = the exact cognitive load we're trying to remove.
**Design direction.** Complaint/code in → the engine ranks candidate systems → it **opens the most-likely diagram automatically**, with the runners-up one tap away. The topology decides where to start; the tech never guesses. Tie to the existing intake + resolver.
**Status:** not built. **Recommended next.**

## P2 — No-code / intermittent  ("stalls randomly, no codes")
**The problem.** There's no live circuit to probe right now — the fault isn't present.
**The friction it creates.** A probe-only surface dead-ends the tech and looks dumb.
**Design direction.** The surface flips into **capture-plan mode**: "next time it acts up, log these 3 readings at this condition." It arms a capture, the tech drives the truck, and the diagram resumes when the data lands. Different directive *mode*, same surface.
**Status:** not built. **The case most likely to break the concept — worth testing next.**

## P3 — Scale / zoom on a phone
**The problem.** A 15-module network or a full engine harness will not fit one phone screen.
**The friction it creates.** Overwhelm, or unreadable tiny nodes.
**Design direction.** Progressive disclosure — render only the **relevant slice**, let the tech expand outward; never draw the whole vehicle at once. Pan/zoom as a fallback, slice-first as the default.
**Status:** not built.

## P4 — Non-measurable complaints  (noise, vibration, leak, smell)
**The problem.** Some faults have no number to read — they're "where to look," not "what to measure."
**The friction it creates.** Forcing a measurement that doesn't exist.
**Design direction.** The directive becomes a **guided inspection** (where to look, what good vs. bad looks like, photo/video capture) instead of a numeric expected-vs-actual — same diagram, a different *directive type*. The directive-clarity contract still holds (scope + what-to-confirm + source + if-wrong).
**Status:** not built.

---

## Cross-cutting invariant (already core — do not regress)
Every actionable directive the tech sees must carry: **scope · expected (or what-good-looks-like) · safety · source · "if it reads wrong, here's where I take you."** No free-text-only directive reaches the bay. This is the moat; it applies to all four directive modes above (probe, resistance, capture, inspect).

## Sequencing recommendation
P1 (triage) first — every job starts there. P2 (no-code) next — it stress-tests whether the surface is truly universal. P3 and P4 are extensions of the same surface, lower risk.
