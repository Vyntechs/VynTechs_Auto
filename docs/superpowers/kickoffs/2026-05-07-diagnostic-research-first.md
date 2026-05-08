# Kickoff — Diagnostic Engine: Research-First TSB & Failure-Mode Lookup

**For:** A future Claude Code session focused on the diagnostic AI engine.
**From:** The 2026-05-07 session that shipped shop-management PR 1 (counter intake persistence) and watched Brandon walk a real diagnostic session that failed in a preventable way.
**Brandon's framing (verbatim):** *"Really good cost-effective research would have solved this. Right off the hit before any planning and other waste of token usage was used to plan a diagnostic path when this is — I'm pretty sure it's a TSB, and it even told me it's a TSB. Way, way later. It's not like here it was a little bit close. It was very close. That should've went to the top of the line."*

So: this doc tells you the WHAT and WHY. You do the brainstorming, planning, and execution.

---

## What needs to happen

Add a **research-first phase** to the diagnostic AI engine.

When a session is created (vehicle + complaint already captured), the AI should:

1. Run an upfront research pass against vehicle-specific TSBs, NHTSA recalls, known engine-specific failure modes, and the internal corpus.
2. Surface high-confidence matches as **leading hypotheses** BEFORE generating a diagnostic tree.
3. Bias the diagnostic tree's first nodes to confirm or refute those hypotheses, not to walk a generic "check the obvious things" path.
4. When a TSB match has high confidence + tight fingerprint to the symptom, surface it directly to the tech: *"This vehicle has a known TSB matching your symptom — here's what it says, here's the suggested test order before committing to repair parts."*

## Why it matters — real evidence from a real session

Session ID: `49a4905f-f56a-4f24-9334-178de1ad6e5d` (2026-05-07 evening)
Tech: Brandon (master technician, decades of automotive experience)
Vehicle: 2004 Toyota Camry, 2.4L 2AZ-FE engine
Complaint: Burning oil smell, valve cover area drenched, leak progressing downward

**What happened:**
- AI walked the tech through valve cover gasket + spark plug tubes + PCV diagnostic path (~5 minutes)
- Tech performed repair #1: valve cover gasket + plug tube seals + plugs + engine clean + 30-mile test drive → **STILL LEAKS, now visibly from rear passenger head-to-block mating surface**
- AI told tech to "check coolant cross-contamination" — tech had already explained the leak geometry; got frustrated, had to literally type "no oil in coolant" to advance
- Tech performed repair #2: new head gasket + new head + parts → **STILL LEAKS, head bolts won't torque properly**
- Tech discovers and reports: **"the threads are pulled out of the block"**
- **NOW** the AI surfaces the TSB about pulled threads on this engine
- Tech responds verbatim: *"I'm glad you told me about this TSB AFTER we put a head gasket on it after we put a valve cover gasket on it called the customer for multiple different price changes technician stress, service advisor stress, part stress because the tickets are stressful situation now"*
- Tech marks session deferred (incomplete). Walks away.

**The cost of the AI's failure:** ~$1,500 of customer money spent on a doomed repair path (head gasket + new head on an engine where the block can't hold the bolts), plus customer goodwill, plus tech/advisor stress. The repair was **always** going to fail.

**The fingerprint match that should have triggered the TSB upfront:** Year (2004) + Make (Toyota) + Model (Camry) + Engine (2.4L 2AZ-FE) + symptom (oil leak originating high, progressing down through head/block mating surface). This is one of the **most documented** Toyota engine issues of that era.

**The TSB:** T-SB-0015-11 (Toyota, March 2011)
- Affected: 2002-2006 Camry / 2004-2006 Camry Solara / 2001-2007 Highlander / 2004-2005 RAV4 (all with 2.4L 2AZ-FE)
- Root cause: aluminum block threads strip under thermal cycling
- Fix: Time-Sert thread inserts, or aftermarket ARP studs
- Source: http://media.fixed-ops.com/Toy_ServiceBulletins/sb0015t11.pdf

A Phase-0 research pass with year + make + model + engine + complaint as input should fire this TSB to the top with high confidence on the **first observation**, before the diagnostic tree is generated.

## What makes this strategically interesting

The Haiku research subagent dispatched in the parent session (2026-05-07) returned a finding that's worth highlighting:

> **Critical Gap:** None of the surveyed products (Mitchell1/ProDemand, Tekmetric, CarMD, Autel, Snap-On SureTrack) implement *upfront, vehicle-specific TSB search before generating a diagnostic hypothesis*. All treat TSBs as reference/sidebar info discovered *after* initial diagnosis.

That gap is **the moat**. Vyntechs being the diagnostic AI that surfaces TSBs *first* — before the tech commits parts and labor — is differentiating in a way no current competitor matches. The Camry session is the worked example of why that differentiation matters: a $1,500 mistake that the entire industry's tooling allows because they all do it backward.

## Current state of the diagnostic engine (what's there to integrate with)

- **`lib/ai/tree-engine.ts`** — generates and updates the diagnostic tree via Claude API. Core engine.
- **`lib/ai/prompts.ts`** — prompts for diagnostic guidance, repair guidance, etc.
- **`lib/sessions.ts`** — session lifecycle orchestration.
- **`lib/retrieval/`** — adapters for external sources:
  - `manufacturer-recall.ts` — *generates URLs* for recall pages but does not fetch.
  - `reddit.ts` — Reddit search adapter (scope unclear).
  - Other adapters may exist.
- **`lib/corpus/`** — vector-search corpus of past sessions. Already used during diagnosis. **Good for "have we seen this exact problem before?"** but not for "is there a known TSB about this engine + this symptom?" — that's the gap.
- **Drizzle schema:** `corpus_entries` table has vehicle year/make/model/engine, symptom_tags, dtcs, freeze_frame_pattern, and a `vector(1024)` embedding (Voyage AI). Schema is ready to extend with TSB-shaped entries if that's the chosen architecture.

## Constraints (read these — they matter)

1. **Brandon is non-engineer.** Plain English in every walkthrough. No SQL/Drizzle/git jargon. Reserve technical lingo for code + commit messages + spec docs.
2. **Brainstorm-first, plan-first.** Use `superpowers:brainstorming` then `superpowers:writing-plans` before any code. The doc you're reading is itself an example of "research-first": a Haiku research subagent already gathered the domain grounding (Appendix A); you should dispatch more if any specific question needs deeper data.
3. **Research-first applies to the AI's own engine.** This isn't just a workflow preference for the human side — it's the architectural change being designed. Internalize it.
4. **Cost-effective tooling.** Brandon's preference is "cost-effective" not "cheap" (he objected to that wording). Use Haiku via the `general-purpose` agent with web search for domain research. Use Sonnet/Opus for synthesis.
5. **Marathon, small PRs.** Expect 4-8 PRs to land this. Don't try to one-shot it. PR 1 might be just "wire NHTSA Recalls API and surface recall hits as a sidebar." PR 2 might be "add TSB-shaped corpus entries." Etc.
6. **Don't break the diagnostic engine.** Current engine works for cases that aren't TSB-shaped. Augment, don't replace.
7. **Memory:** Read `~/.claude/projects/-Volumes-Creativity-dev-projects-vyntechs/memory/MEMORY.md` first. Brandon has documented preferences (plain English, brevity, marathon mindset, validation rigor, research-first, NEVER say "cheap") that all apply.

## What you should figure out (open questions for brainstorming)

These are open questions to work through with Brandon — not predetermined answers.

- **Data source priority.** NHTSA Recalls API is free and structured but covers only safety recalls. The 2AZ-FE TSB is a *service* bulletin, not a recall — NHTSA alone won't catch it. Three options: (a) build on free NHTSA only and accept the coverage gap; (b) add AllData budget tier (~$20/mo) which gives broad TSB coverage; (c) scrape manufacturer technical info portals (Toyota TIS, GM SI, Ford ETIS) where free portions exist. Brandon's call.
- **Architecture: pre-flight vs in-flight research.** Does research happen ONCE at session creation (cached for the session)? Or iteratively as new observations come in (so "leak progressed to head/block surface" can re-query for a tighter TSB match)? Both have tradeoffs — pre-flight is simpler and cheaper; in-flight is more responsive to new evidence but spends more tokens.
- **Hypothesis presentation UX.** When a high-match TSB is found, how is it presented to the tech without being condescending? A master tech hates being told something they already know. A junior tech needs the explanation. The UX has to handle both gracefully — maybe a one-line "Known issue on this engine: X. Want detail?" with optional drill-down.
- **Confidence scoring.** Year + make + model match alone is too broad. Year + make + model + engine + symptom shape is much tighter. What numerical threshold should trigger a "leading hypothesis" surface vs. a "possibility worth knowing" sidebar? Calibration data from real sessions will inform this.
- **Build-vs-buy curve.** Research subagent recommended: NHTSA free for MVP, AllData ~$20/mo for production, ProDemand ~$200-400/mo for scale. What level does Brandon want to pay for at MVP, given he's running shop validations himself and doesn't yet have paying customers?
- **Integration with the existing corpus.** The corpus is already vector-searched during diagnosis. Should TSB-shaped entries live in the same `corpus_entries` table (with a `kind: 'tsb'` discriminator), or in a separate table? The same-table approach reuses retrieval; the separate-table approach gives clearer ownership and lifecycle.

## Resources

- **Failed session evidence:** session ID `49a4905f-f56a-4f24-9334-178de1ad6e5d`. Use the Supabase MCP `execute_sql` tool to fetch the full transcript:
  ```sql
  SELECT created_at, node_id, event_type, observation_text, ai_response
  FROM session_events WHERE session_id = '49a4905f-f56a-4f24-9334-178de1ad6e5d'
  ORDER BY created_at ASC
  ```
- **Research findings (Appendix A below):** automotive TSB/recall data sources, competitor architectural patterns, cost curve, the 2AZ-FE TSB specifics.
- **Existing engine code to integrate with:** `lib/ai/tree-engine.ts`, `lib/ai/prompts.ts`, `lib/sessions.ts`, `lib/retrieval/*`, `lib/corpus/*`, `lib/db/schema.ts` (`corpus_entries` table).
- **Free data sources to start with:**
  - NHTSA Recalls API: https://api.nhtsa.gov (free, structured, recalls only)
  - Auto.dev wrapper: https://auto.dev (1000 free calls/mo, NHTSA-backed)
- **Memory:** `~/.claude/projects/-Volumes-Creativity-dev-projects-vyntechs/memory/MEMORY.md`
- **Related shop-management track:** `docs/superpowers/specs/2026-05-07-counter-intake-persistence-design.md` (PR 1) and `docs/superpowers/plans/2026-05-07-counter-intake-persistence-plan.md`. Adjacent but separate; don't entangle.

## Suggested first move

1. **Read `MEMORY.md`** for Brandon's preferences fresh.
2. **Read the failed session transcript** (the SQL query above) — feel the painfulness firsthand. Walk it as the master tech.
3. **Read the existing engine** (`lib/ai/tree-engine.ts` → `lib/sessions.ts` → `lib/retrieval/*`) to understand what exists.
4. **Dispatch a Haiku research subagent if any question is still unclear** — e.g., "what's the JSON shape of NHTSA Recalls API for `recalls.json?vehicleId=...`?" or "what does AllData's API authentication look like at the budget tier?" The parent session's research (Appendix A) is broad-strokes; you may need targeted follow-ups.
5. **Invoke `superpowers:brainstorming`** with Brandon to align on architecture (data source priority, pre-flight vs in-flight, hypothesis presentation UX, confidence scoring, build-vs-buy curve, corpus integration).
6. **Then `superpowers:writing-plans`** to break the work into small PRs (probably 4-8 of them).

You're not bringing this home in one shot. Brandon expects a marathon of small PRs. Make peace with that up front.

## Final note

Brandon may not be available the moment you start. If he's offline, do the project-context exploration (this doc + the failed session + the existing engine + the research in Appendix A) and wait. **Don't proceed past Phase 1 of brainstorming without his input** — he's the master technician whose domain expertise is the highest-leverage input you have, and he's the one who'll validate every PR on a real shop floor.

---

## Appendix A — Domain research grounding

*Generated 2026-05-07 by a Haiku research subagent dispatched from the parent session. Treat as evidence/grounding for your brainstorm, not as final design.*

### A.1 Data sources for TSBs / recalls / known-failure-modes

**Premium commercial APIs:**
- **Mitchell1 / ProDemand** (~$200-400/month/seat). TSBs surface as "first card" in 1Search Plus results and via Quick Links. Integrates with shop management systems (Tekmetric, RepairPal). API access limited to licensed dealers/shops.
- **AllData** (~$20-30/month individual). Repair procedures, TSBs, DTCs, wiring diagrams. Strong OEM coverage; slower update cadence than Mitchell.
- **Identifix** (~$30-50/month). Web-based, "experience-based repair solutions" via Direct-Hit platform. Covers TSBs but API model unclear from public docs.
- **ProDemand / Snap-On SureTrack** (~$300+/month enterprise). Includes TSBs, functional test procedures, ECU reflash info.

**Manufacturer-specific (freemium / paid):**
- **Toyota TIS** (techinfo.toyota.com): paid (~$25 short-term, subscription available). Emergency-responder/dismantler info free. Covers detailed service bulletins, wiring, diagnostics.
- **GM SI** (gsitlc.ext.gm.com): professional technician portal; free public search via NHTSA integration.
- **Ford ETIS** (Electronic Technical Information System): subscription-based, dealer/shop registration required. TSBs available via Ford Support VIN lookup.

**Free / public government:**
- **NHTSA Recalls API** (api.nhtsa.gov): free, government-maintained. Search by make/model/year. Includes manufacturer communications tab with TSBs, service campaigns, investigations. JSON endpoint.
- **NHTSA Safety Data Search** (safercar.gov): free VIN/year-make-model lookup for recalls and TSBs.

**Third-party wrappers (freemium):**
- **Auto.dev** (auto.dev/open-recalls): wraps NHTSA, 1000 free calls/month, then usage-based. Returns clean JSON.
- **Apify** (apify.com): multiple free NHTSA recall scrapers with OpenAPI specs.

**Community / forum-based (unstructured):**
- **Reddit r/MechanicAdvice, r/Justrolledin**: TSB discussions, failure-mode crowdsourcing. Not machine-readable at scale.
- **Toyota Nation, RAV4 World, Camry forums**: make-specific TSB PDFs, workarounds. High expert density, no API.

**Data quality & gaps:**
- Mitchell/AllData: comprehensive but expensive; dealer/subscription walls.
- NHTSA: reliable but recalls lag real-world failure reports by 6-18 months; doesn't cover non-safety TSBs.
- Forums: high accuracy for known issues but unstructured, slow to search, no version control.

### A.2 Architectural patterns in existing diagnostic products

- **ProDemand (Mitchell1):** TSB surfaced as *first card* when 1Search Plus queries vehicle + symptom. "RECALLS/CAMPAIGNS" sidebar button, separate from diagnostic tree.
- **Tekmetric:** 100+ third-party app integrations including CarMD, RepairPal, AllData. Workflow: technician creates RO → integrations pull TSBs/DTCs as *sidebar* info, not primary hypothesis.
- **CarMD (consumer-facing):** scans via OBD-II → decodes DTCs → *then* alerts user to open recalls and TSBs. Diagnose first, reveal TSBs second.
- **Autel / Snap-On SureTrack:** TSB + functional test integration within the diagnostic interface. ECU reflash updates tied to TSB fixes. TSBs are *reference materials* accessed during repair, not predictive.

**Critical gap (the moat for vyntechs):** None of the surveyed products implement upfront, vehicle-specific TSB search *before generating a diagnostic hypothesis*. All treat TSBs as reference/sidebar info discovered *after* initial diagnosis.

### A.3 Cost-effective integration patterns for startups

| Approach | Cost | Effort | Coverage | Latency |
|---|---|---|---|---|
| NHTSA API only | ~$0/mo | 1-2 weeks | Recalls only, 6-18mo lag | Government-updated |
| NHTSA + forum scraping | ~$500/mo (hosting) | 2-3 months | TSBs + crowd failures | 24-72hr lag |
| NHTSA + AllData budget | ~$50/mo | 1 week | TSBs + recalls, good coverage | Real-time |
| ProDemand/Mitchell1 | ~$200-400/mo/seat | 1 day | Best-in-class | Real-time |

**Suggested early-stage path:**
1. **MVP:** NHTSA free API only. Surfaces recalls at intake; no TSBs. ~$0, 1 week.
2. **Production:** NHTSA + scraping Toyota TIS free portions + AllData budget tier (~$20/mo) for TSB lookups. Covers 70%+ of small-shop vehicles (Toyota, Honda dominant in independents). ~$100/mo, 3 weeks.
3. **Scale:** Negotiate ProDemand/AllData volume discount (~$0.50-2/lookup). Retire scraping.

**Forum-scraping caveat:** Reddit + Toyota Nation crawls are legally/technically viable for non-commercial research but ethically murky for product features; fragile against site changes.

### A.4 Free / low-cost known-failure-mode databases

**Free:**
- NHTSA Recalls (safercar.gov, api.nhtsa.gov): free, ~20K active recalls; no TSBs.
- Auto.dev Open Recalls: 1000 free API calls/month.
- Open-Mechanic (github.com/speed785/open-mechanic): community DTC database, manufacturer-specific modules. Open-source, sparse TSB coverage.

**Low-cost (<$50/mo):**
- AllData budget tier (~$20/mo): basic TSB lookups, all makes/models, historical data back to 1980s.
- Identifix (~$30-50/mo): experience-based repair data; TSB integration.

**No other free TSB aggregators found.** NHTSA is the only government source; commercial vendors (Mitchell, AllData, Identifix) gate everything else.

### A.5 The 2AZ-FE thread-pull TSB — verified

- **TSB:** T-SB-0015-11, issued 2011-03-02 by Toyota.
- **Source:** http://media.fixed-ops.com/Toy_ServiceBulletins/sb0015t11.pdf
- **Affected:** 2002-2006 Camry (L4 2.4L 2AZ-FE), 2004-2006 Camry Solara, 2001-2007 Highlander, 2004-2005 RAV4.
- **Root cause:** Differential thermal expansion strips aluminum cylinder block threads when steel head bolts are torqued, especially at the three thinnest block zones (rear, under plastic intake manifold insulation).
- **Reported symptom:** spontaneous coolant loss followed by overheating, OR (per the failed session above) progressive oil leak through head/block mating after a head gasket replacement.
- **Factory fix:** Time-Sert thread repair inserts at the three affected locations.
- **Aftermarket alternatives:** ARP head studs, NS300L thread repair kits.

**Why it's relevant:** issued *after* this engine was already in wide circulation. A 2004 Camry brought in for head-gasket-shaped symptoms without upfront TSB lookup will not surface this known issue until *after* initial disassembly — exactly what happened in the failed session.

### A.6 What this means for vyntechs (research subagent's summary)

Architectural fix is non-negotiable: query vehicle-specific TSBs, recalls, and community-reported failure modes at intake (after VIN/symptom capture, before generating diagnostic hypothesis). Surface top 3 matches as upfront "known issues" before the AI proposes a diagnostic tree.

Technically: build MVP on free NHTSA + AllData budget tier (~$20/mo). Add scraping of OEM TIS sites for Toyota/Ford/GM as freemium pilots. Cost is ~$100/mo for early traction; upgrade to ProDemand only when volume justifies.

The 2AZ-FE TSB is a canonical example of *non-safety TSBs that NHTSA doesn't cover*. This argues for supplementing NHTSA with at least one paid TSB vendor from day one, even at MVP.

### A.7 Sources

- NHTSA Datasets and APIs: https://www.nhtsa.gov/nhtsa-datasets-and-apis
- Auto.dev Vehicle Recalls API: https://docs.auto.dev/v2/products/vehicle-recalls
- ProDemand "Finding and Using the Right TSB": https://mitchell1.com/shopconnection/finding-and-using-the-right-tsb/
- T-SB-0015-11 Toyota Service Bulletin: http://media.fixed-ops.com/Toy_ServiceBulletins/sb0015t11.pdf
- Toyota TIS Portal: https://techinfo.toyota.com/
- Open-Mechanic GitHub: https://github.com/speed785/open-mechanic
- Tekmetric Integrations: https://www.tekmetric.com/integrations
- Consumer Reports — How to Get a Free TSB: https://www.consumerreports.org/car-repair-maintenance/how-to-get-a-technical-service-bulletin-tsb-for-free/
- Apify NHTSA Recalls API: https://apify.com/wiry_kingdom/nhtsa-recalls-tracker/api/openapi
