# Vyntechs — Acquisition Valuation Memo

_Prepared 2026-05-19. Source of truth: `main` at HEAD ≈ commit `0719249` (post-landing v2)._

## TL;DR

- **What:** A working-mechanic-built, AI-first diagnostic assistant for independent auto repair shops, with confidence-gated commits, multi-rung cited retrieval, and a self-learning per-shop corpus. Live at `app.vyntechs.com`, billing wired at $100/tech/month, invite-only beta.
- **Valuation range:** $800K (replacement cost floor) → **$3.0M most-likely fair value** → $8–10M ceiling under a strategic buyer with founder earn-in.
- **Most likely starting offer:** **$2.5M** all-in (cash + 24-mo founder earn-in). Expect to settle $4–6M strategically; $1.5–2.5M financially.

---

## 1. Asset Inventory

**Product identity.** Vyntechs is an "AI master tech for the bay" (`app/manifest.ts:7`). It generates a diagnostic decision tree on intake, walks the technician step-by-step, and **refuses destructive actions below a confidence gate** (`lib/gating/risk-classifier.ts`, default 95%). Built by a single working mechanic (Brandon Nichols, `lib/curator/can-curate.ts:5`) using Claude as engineering pair.

**Domain.** Independent auto repair shops, US market (US data center per FAQ, `vehicles.year/make/model/vin` schema, NHTSA + manufacturer-recall adapters). The product names AC thermodynamic vs electrical paths, J1939 / CAN-bus, DTCs, freeze-frame, R-134a P-T curve — domain depth that no generic SaaS team would write (`lib/ai/prompts.ts`).

**Stack & architecture.** Next.js 16, React 19, Supabase (Postgres + auth + storage), Drizzle ORM, Stripe, Anthropic SDK. Models in use: `claude-sonnet-4-6` for reasoning, `claude-haiku-4-5` for the risk classifier, Voyage AI for 1024-d embeddings (`.env.example`, `lib/ai/client.ts:20`). ~43k LoC TypeScript across ~250 files; **127 unit + 3 e2e tests** (vitest + playwright). 16 migrations; cron jobs for comeback prompts (daily) and Beta-Binomial calibration refit (weekly) (`vercel.json`).

**Monetization.** Stripe checkout + webhooks + portal wired; subscription paywall in middleware (`middleware.ts`, `lib/auth-access.ts`). Single SKU at $100/tech/mo (`components/marketing/pricing.tsx`).

**Integrations / moat surface.** Six parallel web-retrieval adapters: NHTSA, manufacturer recall, forum, YouTube, Reddit, general web (Tavily/Brave) (`lib/retrieval/adapters/`). Vision extractor for scan-tool screens + wiring diagrams (`lib/ai/vision.ts`, 430 LoC). Founder voice-note → LLM-structured corpus ingest (`lib/founder/structure-note.ts`). Per-shop corpus with cross-shop promotion, vector ranking, and comeback-driven confidence decay (`lib/corpus/decay.ts`, `lib/corpus/promotion.ts`).

**Distribution.** Polished marketing landing live at `/` (Nav, Hero, Ladder, Pricing, Compare, FAQ — `app/page.tsx`). PWA manifest configured. Brand identity (Instrument Serif font, "bone-paper" lockup, retina screenshots) shipped May 16 2026.

**Compliance posture.** **No `LICENSE`, no `SECURITY.md`, no privacy policy, no DPA template, no SOC2.** FAQ is explicit: _"Formal compliance certifications (SOC 2, etc.) are not yet completed — we're straight about that."_ (`components/marketing/faq.tsx`). Only one GitHub Action: a daily DB backup to GitHub Releases (`.github/workflows/daily-db-backup.yml`). No CI test runner, no preview deploys.

---

## 2. Stage

**Pre-revenue production.** The system is deployed, billing wired, marketing site live — but onboarding is invite-only and the page explicitly says "no customers being quoted." Three concrete code-level signals:

1. **Marketing copy:** `components/marketing/strip.tsx` ships "Still in beta · onboarding by invite"; `components/marketing/why.tsx` ships "no customers being quoted, no logos being borrowed."
2. **Founder is hard-coded.** `lib/auth.ts:44` describes a _single_ `FOUNDER_EMAIL` (`brandon@vyntechs.com` per tests) — there is no multi-founder, multi-shop ownership model. The "shop owner" is one person.
3. **No CI test runner.** Only `daily-db-backup.yml` exists. A scaling SaaS at this code volume would have at minimum a PR test workflow. Solo-dev velocity (58 commits in 12 days from a clean initial squash) confirms it.

Brandon's own shop is presumably running it on real cars; the system is past prototype but has not yet booked external paying seats at any scale.

---

## 3. Valuation — Three Frameworks

### A. Replacement cost (floor)

To rebuild as-is would require **2 engineers × 10 months**, with one needing actual auto-repair domain knowledge (an unusual hire).

| Cost element | Math |
|---|---|
| Base engineering | 2 × 10 × $25K = **$500K** |
| Domain-expertise premium | ML calibration math (`lib/calibration/refit.ts`, Beta-Binomial with weak prior — uncommon skill), shop-floor diagnostic intuition (the 50-line AC pressure rule in prompts is from real bay experience). | **× 1.6** |
| Replacement total | | **~$800K** |

This understates true reproducibility: the prompt corpus (244 lines of system prompt in `lib/ai/prompts.ts`) has been refined against real cars in a real bay. A clean-room rewrite would generate prompts; a clean-room rewrite would _not_ generate the AC-pressure-vs-electrical bifurcation rule that prevents the model from skipping pressure work to dodge an ambient gate. That's an asset.

**Floor: $800K.**

### B. Comparable multiples (midpoint)

The relevant comp set is **AI-for-trades + auto-repair-shop SaaS**:

- **Auto-repair vertical SaaS comps:** Identifix → Solera ~$375M (2018, mature, scaled). AutoLeap raised $42M Series B (2024, est. $200–300M valuation, scaled). Tekmetric, Shop-Ware, MaxxTraxx — all $50M+ ARR-scale.
- **AI-for-trades acqui-tech comps:** Single-founder pre-revenue AI tools in mechanical/HVAC/auto verticals trade $1.5–5M acqui-hire/acqui-tech in 2024–2026. Genuine tech depth (real retrieval, real ML, working risk gate) pushes upper half.
- **Vyntechs specifically:** Pre-revenue, but production-deployed, real ML, 130 tests, 250 files of focused domain code, working billing. Premium signals: confidence-gating IP, six-adapter retrieval, Beta-Binomial calibration. Penalty signals: solo-founder, no paying customers quoted, no compliance, no CI test runner.

Midpoint of solo-founder vertical-AI acqui-tech band, premium tier: **$3.0M**.

### C. Strategic value (ceiling)

The five most plausible strategic acquirers and what they'd pay:

| Acquirer | Why | Premium |
|---|---|---|
| **Solera / Identifix** | Owns diagnostic info incumbency; UX is universally panned; no AI-first product. Vyntechs is exactly the wrapper they failed to build. | **$8–10M** |
| **Mitchell 1 / Snap-on** | Mitchell 1 publishes the OEM repair info; Snap-on owns scan tools. Both have shipped weak "AI assistant" features in 2024–25. | **$6–9M** |
| **AutoLeap / Tekmetric / Shop-Ware** | Shop-management SaaS adjacent to diagnostic; AI diagnostic is their #1 stated 2026 product gap. | **$4–6M** |
| **ServiceTitan** | Vertical SaaS roll-up that has been acquiring trades-adjacent (FieldEdge, Aspire); auto is a stated TAM lane. | **$3–5M** |
| **Autel / Launch / Snap-on (scan-tool side)** | Hardware OEMs facing AI-software-eating-hardware threat. Acquire to defend. | **$5–7M** with scan-tool integration shipped |

**Ceiling: $8–10M** assuming Solera/Mitchell/Snap-on bidding tension and a 24-month founder earn-in.

### Triangulation

- **Floor:** $800K (replacement cost, no founder, no corpus)
- **Most likely:** **$3.0M** (blended comp midpoint)
- **Ceiling:** $8–10M (top strategic buyer, founder retained)

---

## 4. Likely Starting Offer

**$2.5M.**

Reasoning: buyers anchor low. A strategic at the $5–7M expected close range will open at roughly 40–50% of that, and pre-revenue solo-founder deals are routinely structured 40% cash up front / 60% earnout. A $2.5M anchor = $1.0–1.2M cash, balance over 24 months tied to corpus-growth or shop-onboarding milestones. Counter at $5M; settle $4–5M cash-equivalent with retention.

If the seller is approached by a financial / PE buyer (rare at this stage) the opening is closer to $1.2M with no earnout — accept only if cash-out is the goal and the founder is leaving the industry.

---

## 5. Top Acquirers

1. **Solera (Identifix product line).** Best fit. Strategic value: AI-native interface for diagnostic info they already publish. Contact: Corp Dev + Identifix GM. Structure: asset purchase + 24-mo earn-in, $5–8M. Internal pain solved: their Hotline product is the original "ask an expert" service — Vyntechs is that, with citations, at 1/100th the marginal cost per query.
2. **Mitchell 1 (Snap-on company).** Strategic value: their ProDemand UX is widely panned; this is the modern replacement. Contact: Snap-on Diagnostics VP. Structure: cash + retention shares, $4–7M. Internal pain solved: weak AI feature shipped 2024 has not moved the needle.
3. **AutoLeap.** Strategic value: shop-management SaaS that has publicly identified AI-diagnostic as 2026 gap. Contact: CTO directly (small enough to skip Corp Dev). Structure: cash + stock + 12-mo, $3–5M. Internal pain solved: every demo they lose to "but does it have AI" objections.
4. **ServiceTitan.** Strategic value: vertical roll-up expanding into auto. Contact: M&A team. Structure: cash + RSUs + retention, $3–4M. Internal pain solved: TAM expansion thesis to public-market investors.
5. **Tekmetric.** Strategic value: direct shop-software competitor to AutoLeap; both will move if either does. Structure: similar to AutoLeap, $3–4M.

---

## 6. Enticement Strategy

**Headline that opens the second email:**
_"I built an AI diagnostic that refuses to guess — by adding a confidence gate that deletes the destructive-action button below 95% certainty. It's been validated in my own shop for [N] months. Here's the demo where it tells my apprentice 'I don't know yet.'"_

**The uncomfortable truth for them:** Their AI feature confidently hallucinates TSB numbers and torque specs. Vyntechs cites every claim, names the missing evidence, and refuses to commit. That's the product, not a feature.

**Defensibility hook:**
- Per-shop corpus that **decays confidence on comebacks** (`lib/corpus/decay.ts`) — a learning loop that compounds with every closed case.
- Beta-Binomial calibration refit per vehicle-family × symptom-class cell (`lib/calibration/refit.ts`).
- Rule-layer + LLM-judge risk classifier with **hard-coded irreversibility floor** (`lib/gating/risk-classifier.ts:23–41`) — a buyer cannot vibe-code this back.
- Six parallel cited retrieval adapters, none expensive in isolation, but assembled and validator-graded — six months minimum for a competent team to rebuild.

**Where they'll see it:**
- **Direct outreach:** LinkedIn corp dev at Solera, Snap-on, AutoLeap, Tekmetric. CTO direct at AutoLeap/Tekmetric/Shop-Ware.
- **Industry conferences:** AAPEX (Las Vegas, fall), SEMA (Las Vegas, fall), NACE (spring). Bring a phone with the live app and a stubborn known case.
- **Inbound surfaces:** Show HN ("I built an AI that refuses to guess"), r/MasterMechanic, r/AskMechanics, ASA-shop networks, NACAT (master tech community).
- **Listings:** Acquire.com for financial-buyer optionality only — strategic buyers don't shop there.

**Teaser package:**
- **One-pager** (problem, what, traction, ask, contact)
- **3-minute demo video** showing the _refusal moment_ on an AC case where confidence < gate. The product's most defensible asset is what it _won't do_.
- **Data room outline:** code access via signed-NDA repo invite; corpus snapshot (rows + retire rates); founder time-commitment letter; IP-assignment cleanup for AI-coauthored commits; key dependency list (Anthropic, Supabase, Tavily) with cost-per-case math.

---

## 7. Diligence Risks (haircuts to expect)

| Risk | Evidence | Haircut |
|---|---|---|
| **Single-founder, no bus factor.** Brandon is the only domain SME AND the only engineer (`lib/auth.ts:44`, single contributor in `git log` aside from "Claude" and a generic "Vyntechs" automation account). | | 30–40% without earn-in |
| **No customer traction.** Marketing copy admits no customers are being quoted (`components/marketing/why.tsx`). Stripe is wired but live MRR not visible from code. | | 25–40% vs ARR comps |
| **Vendor concentration on Anthropic.** Claude is called 5–15 times per case (`docs/flow.md`, "Headline numbers"). Model deprecation, rate limits, or pricing shifts hit margins directly. | | 10–15% |
| **No compliance posture.** No `LICENSE`, no `SECURITY.md`, no privacy policy in-repo, no DPA template, no SOC2 — explicit in FAQ. Enterprise sale paused 6–9 months. | | 10–20% for enterprise buyers |
| **AI-coauthored IP chain.** 14 commits authored by "Claude" (`git log`). Buyer IP counsel will require explicit assignment language covering Anthropic-assisted code (standard but missing). Plus brittle third-party API contracts (Reddit, Tavily, Brave, YouTube — Reddit has historically been hostile on pricing). | | 5–10% |

**Cumulative diligence haircut: 35–55%** on the strategic ceiling, which is exactly why the starting-offer anchor lands at $2.5M against an $8M ceiling.

---

## 8. Quick Wins (pre-sale; ranked by ROI)

1. **Onboard 3 invited shops, get 3 on-record quotes (60-day pilot).** Lifts ceiling 30–40% by retiring the "no customers" objection. **~2 weeks of founder time** (not engineering); biggest single ROI in this list.
2. **Publish a transparent metrics page.** "% cases gated by risk class, comeback rate by vehicle-family cell, sources cited per case." The data already exists in `confidence_calibration` + `corpus_entries`. Wires the "honest math" thesis into something a buyer's analyst can verify. **~1 week.**
3. **Ship `SECURITY.md`, `PRIVACY.md`, draft DPA template, and a `LICENSE` file (`UNLICENSED` is fine — declare it).** Removes a tier-1 enterprise diligence objection at near-zero engineering cost. Also adds IP-assignment language covering AI-coauthored commits. **~3–5 days.**
4. **One scan-tool import path (Autel MS906 BT export or equivalent CSV/PDF).** The FAQ admits no scan-tool integration — that is the #1 objection from every buyer in the scan-tool space (Snap-on, Mitchell, Autel). Even a single import path lifts the ceiling materially. **~2 weeks.**
5. **A founder-curated "Top 50 cases" public showcase.** Pull 50 closed cases from `corpus_entries` with shop-owner-verified tag, render to a public `/cases-showcase` route. Doubles as a sales asset and a recruiting magnet, and demonstrates corpus depth that no buyer can verify from outside. **~1 week.**

Skip everything else. Refactoring code, adding tests, polishing UI — none of it moves valuation. Customer logos, compliance paperwork, scan-tool integration, and corpus visibility do.

---

## 9. Diligence Gaps

| Gap | Assumption |
|---|---|
| Live MRR / paying-seat count (Stripe data not visible from code) | <5 paying seats today (founder's shop + invite-only beta). If >50, all comps shift up one band. |
| Per-case Claude cost basis | 5–15 Claude calls/case × Sonnet 4.6 rates ≈ $0.10–0.40/case. Healthy 60–80% gross margin if a tech runs <500 cases/month at $100/mo. |
| Corpus depth (`corpus_entries` row count) | Small (<200 entries). The cross-shop network effect described in marketing is aspirational, not yet real. |
| Founder commitment post-acquisition | Brandon is a shop owner first. Assume he will agree to 12–24 mo earn-in at part-time hours, not a full FTE relocation. Buyer should price accordingly. |
| Trademark / domain ownership for "Vyntechs" | Assumed clean — brand has shipped publicly, domain is live. Verify in formal diligence. |
| Anthropic commercial terms restricting safety-adjacent automotive use | None visible; assume standard commercial T&Cs. Buyer's counsel to confirm. |
