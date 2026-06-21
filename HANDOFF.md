# HANDOFF — Diagnostic-loop design APPROVED + prototyped; next is BUILD THE LOOP (forward work, new branch)

**Last updated:** 2026-06-21
**Work branch:** `feat/diagnostic-loop` ← THE branch for this new version. Created off the latest code (NOT local `main`, which is stale). All forward work on the new interactive diagnostic lives here. Do not bounce back to `fix/topology-symptom-reconcile` or other branches.
**Nature of this session:** Designed + prototyped the new user-facing diagnostic (the topology loop) and pressure-tested it with two team panels. No product code yet — design spec, Figma prototype, lessons/memory. Next session starts BUILDING on this branch.

---

## WHERE WE ARE (forward track — the new diagnostic)
The user-facing "money shot" — the interactive topology/wiring diagram that IS the diagnostic — has an agreed **design law** (the loop) and an **approved clickable prototype** (Brandon: "I like what I'm seeing"). This is the NEW version that replaces the old AI-wizard path. We are building it FORWARD. We are NOT going back to patch the legacy product (see PARKED below).

## THE DESIGN LAW (the loop — encoded, do not regress)
Diagnostics is **one elimination at a time**. The tool always picks the **single highest-yield next check** (rules out the most, raises confidence fastest), made **painless**. **Accuracy first** (a fast, painless, wrong answer is a failure). **Confidence is a true compass, never a scoreboard** — built only from real confirmed checks, never faked; a low number is the cue to find the next best check, never a scary % and never "give up." **"Never give up" = always find the next useful check; honest hand-off is the last resort only.** **Safety on every directive.** **Painless language everywhere.** Triage ("where do I start") is just the first elimination. It all happens on the one diagram — never a wizard/chatbot.
- Spec: `docs/interactive-diagnostics/2026-06-21-diagnostic-loop-and-triage-design.md`
- Open UX problems: `docs/interactive-diagnostics/diagnostic-ux-open-problems.md`
- Lessons added this session (`tasks/lessons.md`): `diagnostics-is-one-elimination-asking-is-the-craft`, `confidence-is-a-true-compass-not-a-scoreboard`, `painless-language-is-a-hard-invariant`, `route-craft-questions-to-persona`.

## WHAT WE PRODUCED THIS SESSION
- **Design spec** (above) — the loop law, today-vs-grows-into, build reality, accuracy guardrails.
- **Figma prototype** — file `4wbjY4CHEcO6RqkF9HGJlf`, the "loop" row: **L1 First check (node 34:2)**, **L2 Narrowing-honestly (34:96)**, **L3 Answer (34:190)**. APPROVED. New vs. the prior surface: a confidence **COMPASS** (progress, not a number), the **safety line** on directives, the honest **"still unproven — N causes left"** state, the master-tech **"I already know it — skip"** affordance, and an honest **verdict with its story** ("high confidence: your 3 checks line up, 41 techs saw this") instead of a %.

## IMMEDIATE NEXT STEP (forward — BUILD THE LOOP)
Turn the approved prototype into the working diagnostic, on the one flow that already has seeded data: the **fuel-rail pressure flow (P0087/P0088, 6.7 PSD)**. Build the live loop:
**reading entry → the map rules causes out → confidence climbs ONLY from confirmed checks → verdict → honest hand-off**, rendering the prototype's new elements (compass, safety line, "still unproven" state, skip-ahead, honest verdict-with-its-story).
- The plumbing exists and is NOT wired yet: `lib/diagnostics/step-sequence.ts` has advance/back/route reducers + `resolveFork`; schema has `diagnostic_sessions.cumulative_confidence` (`lib/db/schema.ts:980`) built from confirmed checks only. Today the topology screen shows only the **first step, static** — wiring the loop is the net-new work.
- **Use the toolkit:** `brainstorming`/`writing-plans` (or `systematic-debugging` if fixing) → `test-driven-development` → `verification-before-completion`. Propose the plan, get Brandon's approval, then build on `feat/diagnostic-loop`.
- **Success criteria (verify-by):** on the fuel-rail flow, a tech can enter a reading, see a cause get ruled out on the map, watch confidence rise from that confirmed check (never AI self-grading, never a fabricated number), and reach an honest verdict — exercised end-to-end (real session render + tests), not "looks right."

## PARKED — separate OLD-PRODUCT track (Brandon's call when/if; NOT our forward work)
A team panel flagged a real **legal/trust exposure on the LIVE legacy product** (the old AI-wizard path we're replacing) — it shows a fabricated/defaulted "confidence %" and the marketing pages promise a "95% line" the engine doesn't enforce. This is REAL but it is a **separate patch to the thing we're replacing**, not the forward build, and it must not hijack this work. If/when Brandon schedules it, the specifics are: `lib/wizard-state.ts:129` (`?? 1.0` silent-100% bug), `components/screens/active-session.tsx:133` (confidence render), `lib/gating/gap-handler.ts:35` (must fail-safe), `lib/diagnostics/gate-thresholds.ts` (orphaned 0.8/0.85, no calibration), `components/marketing/pricing.tsx:14` + `compare.tsx:15` (the false 95% claim). It would be its own tiny PR off latest; deploying to the live paid product is a top-tier gate needing Brandon's explicit go.

## STRATEGIC SEQUENCE (forward)
1. **Build the loop** on the fuel-rail flow (immediate next step, above).
2. **Seed the diesel wedge job** — 2011–2016 6.7 DEF/limp-mode (`reduced-power-limp-mode-emissions-suspect` on `ford-super-duty-3rd-gen-67-psd`). Routing exists; **no content seeded behind it** (verify the live DB first) → real beachhead jobs fall to the old AI today. Curator content authoring, not new architecture. Pour content into the proven loop, not a half-built one.
3. **Willingness-to-pay test** — put the seeded wedge job in front of beachhead owner-techs on a real 6.7 limp-mode truck; watch for "I'd pay to keep this." Use it to decide seed-more vs. polish-loop.

## CEO DECISIONS PENDING (Brandon's calls)
- **Brand claim (parked track):** the public "95% line" — drop the number now (describe truthfully) vs. build real 95% refusal. Rec: drop now, re-add only with calibration data. (His brand promise.)
- **Hold all shop-management build (RO/estimate/invoice) until a shop pays + renews on the diagnostic alone?** Rec: yes.
- **PLATFORM-BLUEPRINT D1–D5** (`docs/platform/PLATFORM-BLUEPRINT.md`): altitude, the live trust fix (= parked track), brand PlainWrench-vs-Vyntechs, spine-boundary calls.

## HARD CONSTRAINTS / INVARIANTS
- The diagnostic UX is the diagram itself — never a wizard/chatbot.
- The loop law above.
- Triage/next-step selection stays **rule-based, ZERO AI calls** in intake/render (the 504 wound).
- Reconcile logic stays in **shared functions used by BOTH intake and session-render** (the slug-drift bug class).
- Confidence only rises from real confirmed checks; nothing fabricated ever shown — missing = "not captured yet."

## KEY FILES (forward build)
- Engine/loop: `lib/diagnostics/{step-sequence,symptom-resolver,reconcile-seeded-symptom,resolve-platform,load-system-topology}.ts` · `lib/db/schema.ts:980` (cumulative_confidence) · `app/(app)/sessions/[id]/page.tsx` (topology gate/render) · `components/screens/topology-diagnostic.tsx` (the diagram UI to grow into the loop) · `app/api/intake/submit/route.ts`

## RESUME PROMPT
```
Read HANDOFF.md in full. We're on branch feat/diagnostic-loop — the NEW interactive diagnostic (the topology LOOP), built forward. The design law + the approved Figma prototype (file 4wbjY4CHEcO6RqkF9HGJlf, frames L1/L2/L3) are done. NEXT: BUILD the working loop on the seeded fuel-rail flow (P0087/P0088) — reading entry → map rules causes out → confidence climbs from confirmed checks → honest verdict — matching the prototype (compass, safety line, "still unproven" state, skip-ahead, verdict-with-its-story). Plumbing exists in lib/diagnostics/step-sequence.ts + schema cumulative_confidence; the loop isn't wired yet. Use the toolkit: brainstorming/writing-plans → TDD → verification. Stay on feat/diagnostic-loop; do NOT go back to old branches or patch the legacy AI product (that live trust fix is PARKED, separate, Brandon's call). Constraints: zero AI calls in intake/render; reconcile stays shared across intake + session-render; never show a fabricated/uncalibrated number.
```
