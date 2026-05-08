# Research-Grounded Diagnostic AI — Design

**Date:** 2026-05-08
**Author:** Brandon Nichols + Claude (collaborative brainstorm, evidence-driven)
**Source kickoff:** [`docs/superpowers/kickoffs/2026-05-07-diagnostic-research-first.md`](../kickoffs/2026-05-07-diagnostic-research-first.md)
**Status:** Ready for implementation planning

---

## Doctrine — the product goal

> **Vyntechs is the diagnostic AI a master tech actually trusts — because it speeds them up when it's right, cites real evidence behind every claim, and gets out of the way when it doesn't actually know.**

Research-grounded operation is the **means**. **Trust** is the end. Every architectural choice in this design checks against that.

What that produces on the shop floor:
- Tech doesn't walk doomed paths. Customer pays once, accurately. Advisor stands behind one quote.
- Master techs use the AI instead of swiping past it.
- Junior techs are protected from impulsive part-swaps — the AI shows WHY before HOW.
- The AI never tells a tech to find something that isn't there.

The moat: every other diagnostic product (Mitchell, Tekmetric, CarMD, Snap-On) treats AI as authoritative-by-default. Vyntechs being the one that *cites evidence and admits uncertainty* is the differentiator nobody else has shipped.

---

## The problem we're fixing

The existing AI engine generates diagnostic steps from training data. Training is generic. When the AI fills in vehicle-specific procedural details — port locations, part placements, fuel system layouts, torque specs — it confidently hallucinates details that aren't actually true for the specific vehicle in the shop.

Real evidence, four real sessions:

| Case | Failure mode |
|---|---|
| **2004 Camry 2.4L 2AZ-FE oil leak** | AI walked tech through valve cover gasket → head gasket → new head before surfacing TSB about pulled head bolt threads. **$1,500 wasted on a doomed repair path.** |
| **2009 Ram 1500 P0171/P0174** | AI actively pushed *away* from the vacuum-leak hypothesis. Tech took 168 minutes to find brake fluid leaking from master cylinder into vacuum booster — a pattern documented across 6+ public sources that the AI never surfaced. |
| **2008 Chevy 3500 6.6 LMM P0675** | AI suggested glow plug; actual cause was a high-resistance ground strap. 127 minutes diag time. |
| **2020 F-250 6.7L P0087 (live)** | AI confidently asserted Schrader port location (wrong — port is on filter housing *bottom*, not top, and is a 6mm Allen plug not a factory Schrader), dual-tank configuration (wrong — 2020 is single-tank standard), and "normal lift pump" architecture (wrong — frame-mounted on passenger side, not in-tank). All cross-generation generalizations from training. |

Common thread: **the AI made confident vehicle-specific claims it couldn't justify.** No grounding. No citations. No "I'm not sure on this generation."

---

## The one universal change

> **The AI calls a research tool before producing any vehicle-specific procedural output. The output is grounded in what research returns. If research is fragmented or contradictory, the AI says so explicitly. If no relevant data, the AI says "no authoritative source found — verify in the field."**

That's the architectural shift. Everything below is implementation surface for that one rule.

### What counts as "vehicle-specific procedural output"

Anything that names:
- Physical part locations ("test port on filter housing top, driver-side")
- Part placements / assemblies ("lift pump in driver-side tank")
- Test methods or procedures specific to the vehicle ("crank for 3 seconds, watch for X")
- Pressure / torque / electrical specifications
- Fuel / cooling / electrical system layouts
- Repair procedures unique to the model/generation

If the AI is generating any of those for a specific vehicle, it must research first.

### Why this works universally

Same flow regardless of vehicle, symptom, DTC, or generation. The AI's training is good for *interpretation* (parsing forum threads, synthesizing across sources, understanding TSB language). It is NOT for *vehicle-specific facts*. Research provides facts; training does interpretation. The two roles are now sorted correctly.

Validated on real cases:
- **F-250 Schrader port:** AI researches → finds forum sources saying "bottom of filter housing, 6mm Allen plug" → outputs that, cited. Wrong-layout claim disappears.
- **Camry pulled threads:** AI researches → Stage 1 finds gasket consensus → Stage 2 probes "fix not holding / TSB" → finds thread-pull TSB → surfaces both candidates. $1,500 mistake doesn't repeat.
- **Ram brake booster:** AI researches → Stage 2 probes "lean code brake booster" → finds 6+ sources → surfaces unusual cause from the start. 168-min case shortcut.
- **Workmanship issues / obscure ground straps:** AI researches → no consensus → stays silent. No regression vs today.

---

## The two-stage research pattern

Whenever the AI runs research:

**Stage 1 — Broad query.** Vehicle + symptom + DTC. Look at top 5–10 results. Apply quality heuristic:
- Lots of independent sources agreeing on cause + fix → **CONSENSUS FOUND** → go to Stage 2.
- Scattered / no agreement → **NO CONSENSUS** → stay SILENT. Don't dig further.

**Stage 2 — Aggressive exception probing.** When Stage 1 has consensus, Stage 2's job is: *"Is the popular answer the FULL answer?"*

Stage 2 fires targeted queries like:
- `<vehicle> <symptom> <common-fix> not holding`
- `<vehicle> <symptom> deeper cause TSB`
- `<vehicle> <symptom> brake booster` (or any documented exception pattern)
- `<vehicle> <DTC> <obscure-component>` (probe for unusual root causes)

If Stage 2 finds a deeper cause documented → **SURFACE BOTH** (common cause + deeper alternative).
If Stage 2 finds nothing extra → **SURFACE COMMON ALONE**.

Stage 1's failure mode (popular answer ≠ complete answer) is structural to search ranking — the loudest voices on the internet aren't always right. The fix is at the architecture layer, not the prompt: **Stage 2 always runs when Stage 1 has consensus**, especially when consensus seems strong. That's exactly when deep causes hide underneath.

---

## Surfaces — where the tech sees this

### Surface 1: Research-first card at session start

When a session is created (vehicle + complaint + optional DTC captured), the AI runs the two-stage research call **before generating the diagnostic tree**. If research returns useful consensus, the tech lands on a "Heads up" card before the tree generates.

Card content (illustrative — copy will be tightened in PR):

> **Heads up — looks like a known thing.**
>
> **From your shop:** *(if internal corpus matches: "You've fixed this before — N confirmed cases, fix-X every time.")*
> **From the web:** *(common cause documented across forums + YouTube + TSBs; sources cited)*
>
> **Quick test that'd tell us:** *(verification step)*
> **If that's it:** *(fix path)*
>
> `[ See the source links ]`  `[ Run verification ]`  `[ Just walk the tree ]`

If research returns nothing solid → no card. Standard tree generates as today. **No regression on cases that aren't research-shaped.**

If verification confirms → jump to repair planning. If verification fails → generate the rest of the tree using both the original symptom AND the failed-verification observation.

### Surface 2: Mid-session research-on-demand

Whenever the AI generates a diagnostic step that includes any vehicle-specific procedural fact, it researches BEFORE generating the step. The step is grounded in research output.

If research returns thin or contradictory data, the step explicitly says so — *"the test port location varies by generation; verify in the field before drilling."* Better silent than confidently wrong.

### Surface 3: Source-link affordance everywhere

Every research-grounded output (research-first card, mid-session step, repair guidance) includes clickable source links. Tech can always click through to a forum thread, YouTube tear-down, TSB PDF, repair guide, etc. and verify themselves.

This is the "research = tool, not truth" implementation. The AI assists; the tech remains the source of truth.

---

## Confidence behavior

Confidence flows from **research consensus**, not from the AI's training-based certainty.

- **High consensus** (multiple independent sources agreeing on cause + fix): SURFACE.
- **Mixed agreement** (some signal, but conflicting): expand search (Stage 2). Surface only what survives expansion.
- **Fragmented / no consensus**: SILENT. Standard tree runs as today.
- **No relevant data found**: AI explicitly says "no authoritative source found — verify in the field." Better honest than guessing.

The AI never says "I'm confident" without citing the consensus that grounds the confidence. Hedged language ("looks like", "lots of people online say", "worth checking") is the default for research-mediated output.

---

## Out of scope for v1 (deferred to future PRs)

These are real concerns but not blocking the v1 ship:

1. **Cross-shop corpus integration.** "From your shop" line in the card draws from the local corpus. Per-shop only on day one (each shop builds its own private memory). Cross-shop anonymized sharing requires privacy posture decisions and product pitch — future PR.
2. **Source-quality filtering.** Prefer forums + TSB pages over generic SEO clutter. v1 takes whatever the search engine returns. Filtering is v1.1.
3. **Curator review of research-grounded outputs.** Phase P curator already exists; integrating it with research outputs is future work.
4. **Cost / latency budgeting.** Each research call costs tokens + adds latency. Budget controls (caching, rate limits, request throttling) are future work.
5. **Multi-vehicle parts-compatibility heuristics** (e.g., 2011-12 vs 2013+ EcoBoost turbo BOV mount differences). Research surfaces these when present, but explicit AI awareness of model-year boundaries is future.

---

## Implementation order — PR breakdown

The marathon. Each PR small, validated on real shop cases, shipped to production before the next starts. Per Brandon's marathon rule — small bites only.

**PR 1 — Wire a research tool into the AI engine.** Web search + fetch capability available at every prompt. No surface changes; plumbing only. Validation: AI can call the tool, gets results, parses them.

**PR 2 — System-prompt update for research-grounded operation.** New rule: *"Before any output with vehicle-specific physical or procedural facts, call the research tool. Ground your output in what research returns. If research is fragmented or contradictory, say so. If no relevant data, say 'no authoritative source found — verify in the field.'"* Affects existing tree generation immediately. Validation: re-run F-250 case, watch the wrong Schrader port claim turn into a grounded one (or an admitted-uncertain one).

**PR 3 — Research-first card at session start.** Two-stage research call at session creation. New "Heads up" card surface with source links and `[Run verification]` / `[Skip]` buttons. Tree generation conditional on verification result. Validation: re-run Camry case (with mandatory Stage 2), watch TSB surface; re-run Ram P0171/P0174, watch brake-booster pattern surface.

**PR 4 — Source-link affordance on all research outputs.** Every research-grounded output emits clickable source citations. Implementation: AI emits `[source: URL]` markup; renderer turns it into clickable evidence links.

**PR 5 — Mid-session research-on-demand UI.** Surface "I'm not sure on this generation" admissions clearly to the tech. Surface citations inline on diagnostic steps. Polished hedged-language tone throughout.

**Future PRs (out of v1 scope):**
- Source-quality filtering (forums > generic SEO)
- Cross-shop corpus integration
- Curator review of research outputs
- Cost / latency budgeting

---

## Evidence trail — what informed this design

- **Original kickoff:** [`docs/superpowers/kickoffs/2026-05-07-diagnostic-research-first.md`](../kickoffs/2026-05-07-diagnostic-research-first.md) — 2004 Camry $1,500 case + Haiku research subagent grounding (Appendix A).
- **Spike 1 (4 invented cases):** simplest single-search test. 3.5 of 4 correct. Camry was the failure that proved Stage 2 must be mandatory.
- **Spike 2 (7 real shop cases):** universal-applicability test. 5 of 6 correct with proper queries. Confirmed two failure modes: shallow-consensus hiding deep cause, and workmanship invisibility.
- **Spike 3 (re-test of Cases 2 + 3):** brake-booster pattern surfaced with sharper queries → 6+ independent sources → would have shortcut the 168-min Ram diagnosis. Proved query strategy is its own engineering work.
- **Spike 4 (live F-250 P0087):** caught three wrong physical-layout claims, surfaced CP4 production-window match, surfaced documented BJB burnt-terminal alternative cause. Ran while Brandon was actively diagnosing the same case — live demo of the architectural direction in action.

All four spikes informed this single design. The "one universal change" is the smallest piece that delivers everything tested.

---

## Open questions deferred to implementation planning

These get answered when the writing-plans skill breaks the spec into tasks. Listed here so they're not lost:

1. **Exact research tool API** — web search + fetch, or also Reddit / YouTube / forum-specific scrapers? Probably web search + fetch is sufficient for v1; specialized adapters can come later.
2. **Research output caching** — per-session? Per-vehicle (year/make/model/engine)? TTL?
3. **Stage 2 query generation** — templated patterns? AI-generated based on Stage 1 results? Hybrid?
4. **"Thin / contradictory" detection** — AI judgment via prompt? Heuristic on result count + source diversity? Both?
5. **Rollout plan** — shadow-mode behind a flag → A/B → full ship? Marathon discipline says ship-then-validate, so probably feature flag with small-shop rollout first.
6. **Cross-shop corpus timing** — when does the "from your shop" line graduate to anonymized cross-shop sharing?

---

## Final note

This design is the convergence of multiple spike tests on real shop data. Every architectural choice has been validated against actual cases (Camry, Ram, F-250, Silverado, Civic, Chevy 3500, Mitsubishi, etc.) — not invented examples. The "one universal change" is the smallest possible piece that delivers everything we tested.

**Trust is the product. Research-grounded operation is how trust gets built. Every PR ships in service of that.**
