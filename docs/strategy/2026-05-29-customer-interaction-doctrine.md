# Vyntechs — Customer & Interaction Doctrine

**Date:** 2026-05-29
**Source:** 8-agent grounding + embodiment workflow (run `wf_9deb4a81-745`) — three agents grounding reality (internal evidence, cited real-world field research, full interaction inventory), four agents embodying the customer personas, one synthesizing. Findings below were spot-verified against the code by the main thread.
**Purpose:** Establish, from evidence (not assumption), *who our customers actually are* and the bar for *how every interaction (click / tap / view / read) should blow them away*. This is a doctrine we hold every future feature to.

---

## ⚠️ Verified live finding — the confidence gate fabricates its evidence (on `main`)

The confidence-gate / decline-or-defer screen (`components/screens/decline-or-defer.tsx`, rendered live by `decline-or-defer-live.tsx`) is **on `origin/main` (the paid, live line)** and renders four hardcoded design-preview defaults to real techs, because the live wrapper never passes the real session data:

- **Confidence dial** defaults to `confidence = 73`, `gate = 85` → every gated case shows "73/100, −12 below threshold" regardless of the real number.
- **"WHERE I LOOKED" tape** falls through to `DEFAULT_TAPE_BODY` → a fabricated ledger ("past_cases 0/5 miss… K-CAN wire colors not retrievable") on every vehicle.
- **Defer spoke** falls through to `SPOKE_META.defer.meta` → "ROUTES TO MARCUS T. · BMW N-SERIES CURATOR" — a curator who doesn't exist, on whatever vehicle the tech is actually working.
- **Engraved plate** defaults to "BLOCK 7B-3 · TECHS QUEUED 3".

This is the single highest-priority trust fix in the app: it inverts the product's core promise (honest, cited evidence) on the exact screen meant to demonstrate it. All four personas independently named it as the interaction that makes them quit and warn other shops. Fix: pass the real session values, or render an honest empty/“nothing conclusive yet” state — never the preview placeholder.

---

## 1. Who our customers actually are

**The Owner-Tech (our real buyer).** Owns the shop, still turns wrenches, signs the checks. Buys as a shop-license decision, never per-seat — the code proves this: every self-signup is created as `'owner'`, only owners can invite and manage billing, and Stripe is gated at the shop level (`auth-access.ts`). He pays because the tool gets his guys to the right repair without him hovering, and because a wrong call costs his shop a free comeback. He cancels the day a tech screenshots something fake and sends it to the group chat.
*Evidence vs. Assumption:* **Evidenced** — Brandon + Mac at YMS are exactly this. Riskiest claim: that the buyer is *always also a wrenching tech*; the code makes every signup an owner, so a non-wrenching shop owner/office manager who just buys seats is structurally enabled but never modeled or met.

**The Gate (the master tech who decides if the shop adopts).** 15-25 years, runs three monitors, knows ScannerDanner by name, triangulates AllData + Identifix today. Not the buyer but the kingmaker — if he respects it, the bay adopts; if he catches one fabricated source, he kills it shopwide. Wants a fast, sourced second opinion on the weird car; can smell a hallucinated answer from across the bay.
*Evidence vs. Assumption:* **Hypothesis.** We have YMS masters, but **zero evidenced master-tech converts outside YMS**. Our entire word-of-mouth growth engine rides on a persona we have not yet won in the wild.

**The Climber (the hungry B-tech, our daily-active heart).** 3-6 years, volume shop, lives in YouTube and Facebook groups. Wants to confirm-or-redirect his own call without looking dumb when the master isn't around — and on flat rate, a wrong call he pushes is *his* free comeback. Forgives ugly. Will not forgive getting played by fake theater.
*Evidence vs. Assumption:* **Evidenced** as a daily user (the YMS `'tech'` role). Riskiest claim: that he'd ever **pay out of pocket** — both persona and code say the economic unit is the shop. Treat "Climber as solo subscriber" as unvalidated.

**The Skeptic Who Stays — DEMOTE from customer to weather.** The framework already labels him "probably never a subscriber." His critique is gold as a *quality bar* — if the Skeptic catches a fake, everyone has — but he is not a buyer. Build to satisfy him as a side effect of honesty, not as a target.
*Evidence vs. Assumption:* **Correctly assumed non-customer.** Keep him as the toughest grader in the room, not a revenue line.

**The customer we're actually missing: the standalone solo diagnostic tester.** Real, live, paying-or-comped today (our beta testers), attached to *no* shop hierarchy and *no* master/apprentice context. None of the four personas is a lone tech with no shop. A present-tense segment with zero representation in our model — flag it.

---

## 2. The "blow them away" doctrine

Eight words run through every critique: *show me where you looked, and don't lie.* These are the standards. Every future feature gets held to them.

**1. Never show a thing you can't stand behind.** Serves all four. No fabricated data ever reaches a real tech — not even as placeholder.
*Excellent vs. flat:* the "WHERE I LOOKED" gate showing the real AllData pinout and tech-count for *this* truck (excellent) vs. today's hardcoded "K-CAN… BMW N-SERIES… ROUTES TO MARCUS T." printed on a Ford (flat — and disqualifying).

**2. Every number carries its story or it doesn't show.** Serves Gate, Climber, Owner-Tech. A confidence figure must say *because what* — what reading matched, how many techs confirmed.
*Excellent vs. flat:* "83% — the FICM voltage you logged matches the pattern 40 techs confirmed on the 6.7" (excellent) vs. "83.4% — based on AI reasoning + retrieval" (flat — a horoscope).

**3. Show what's done and what's now. Never the road ahead.** Serves Owner-Tech, Skeptic, and our standing cognitive-load principle. Counts and full step-trees tell a tech he's slow and let the customer count steps over his shoulder.
*Excellent vs. flat:* one next test, the rationale, the last thing logged (excellent) vs. the `TreeRail` listing all 9 steps with a "{n} steps" header (flat).

**4. Honest about what it doesn't know.** Serves Gate, Climber — this is the moat. A clean "I'd be guessing — handing this off" beats a confident wrong answer every time.
*Excellent vs. flat:* the confidence gate saying in plain English "I'm not sure enough to call this" and deferring (excellent — the line that makes the Climber text another tech) vs. a floating number that implies certainty it can't back.

**5. No fake controls. No theater. Ever.** Serves all four. Every dead button and canned animation taxes the trust of every honest answer.
*Excellent vs. flat:* a camera button that decodes the VIN, narration that plays only the stages that actually ran (excellent) vs. the scan toggle that flips a boolean, the fake "auto-saved" footer, the dead "More options" and disabled "Save draft," and the LogButton "Parsing photo · 3 frames" on a fixed 800ms timer when no photo was attached (flat — each one a caught lie).

**6. Grade the measurement against the spec it already knows.** Serves Skeptic, Climber, Gate. When a tech reads a value, the tool that has the expected value must say in or out of range — that's the job.
*Excellent vs. flat:* a numeric field — "11.7V read, 12.6V expected, 0.9 low, here's what that points to" (excellent) vs. typing "FICM 44v" into the same free-text box used for "customer's a jerk" (flat).

**7. Give the pivotal moment its weight.** Serves Gate, Climber. Locking a diagnosis is a tech signing his name — make it feel like a commitment, not a form submit.
*Excellent vs. flat:* a deliberate confirm that restates the call and the evidence behind it (excellent) vs. a plain button into a `router.refresh()` (flat).

**8. Two taps to the answer, gloves on.** Serves all four. The bay has glare, noise, nitrile gloves, a service writer five feet away. More than 2-3 taps to the answer is broken in the bay.

---

## 3. Where we're losing them today

Ranked by how fast and how permanently each one bounces a tech.

1. **The fake "WHERE I LOOKED" gate — disqualifying (verified, on `main`).** See the callout above. All four personas named this as the thing that makes them quit and warn other shops. Highest-priority fix in the app.
2. **No cited sources anywhere in the live loop — the whole pitch, missing.** We sell "cited evidence." The diagnostic loop, the lock, and the repair chat show *zero* citations (grep-confirmed). The one place sources appear is the fiction above.
3. **Confidence as a naked number.** "Based on AI reasoning + retrieval" under a big percentage reads as a guess with a decimal. Every persona rejected it against the Identifix "124 techs confirmed" bar.
4. **Hardcoded "low risk" on every job + full step-tree.** Two different jobs both showing "low risk" is the Skeptic's tell that the computer doesn't know one from the other. The step count tells the Owner-Tech's guy he's slow.
5. **Theater the techs catch:** camera-scan toggle, fake auto-save, canned LogButton narration, dead More-options/Save-draft. Individually small; together they say "a demo wearing a tool's clothes."
6. **The 422 "Be more specific" argument at the close.** Arguing with a tired, greasy master tech at the finish line with two terse words. Tell him what's *missing* or take it.
7. **Measurements as free text.** We cache the expected value and never diff it. The Skeptic calls this "a notepad with a subscription."

*(Items 4-7 are the interaction audit's findings; verified the #1/#2 anchor directly in code. The rest warrant a quick verification pass before fixing.)*

---

## 4. Top 5 highest-leverage interaction upgrades

1. **Kill the fabricated gate; wire real sources into "WHERE I LOOKED."** Pass real values for *this* vehicle, or show an honest empty state. *Wins:* all four. *Serves:* Principles 1 + 2. *Why "damn":* the same screen that's currently disqualifying becomes the one the Owner-Tech screenshots to another owner. The whole moat sits in one component that doesn't pass its own data — fix that first.
2. **Put the story under every confidence number.** Replace "AI reasoning + retrieval" with the *because* — the reading that matched and the count of techs/cases that confirmed it on this vehicle. *Wins:* Gate, Climber, Owner-Tech. *Serves:* Principle 2.
3. **Make the "I don't know" handoff a loud, proud moment.** When confidence is below the gate, say it plainly: "I'd be guessing — handing this to a curator." *Wins:* Climber, Gate. *Serves:* Principle 4. The literal interaction the Climber said makes him text another tech.
4. **Structured measurement with live expected-vs-actual.** Numeric field + unit; the tool diffs the read against the spec it already has and reacts to the gap. *Wins:* Skeptic, Climber, Gate. *Serves:* Principle 6.
5. **Strip the loop to now + give the lock its weight.** Remove the full `TreeRail` and "{n} steps" count; show only last-done and next test. Make Lock a deliberate confirm that restates the call and its evidence. *Wins:* Owner-Tech, Skeptic, Gate. *Serves:* Principles 3 + 7.

*(Cross-cutting, do alongside: delete every fake affordance. Principle 5. Each removed lie restores trust in every honest answer.)*

---

## 5. The sharpest conflict between personas

**Proof (the Gate) vs. Speed-with-gloves (everyone in the bay).** The Gate wants click-through, citeable depth — the real pinout, the confirmed-fix count, the source he can verify — because one wrong answer ends it forever. But the bay reality (gloves, glare, service writer waiting) says more than 2-3 taps to the answer is broken, and the Owner-Tech doesn't want his tech reading a research paper while the next car waits. Depth and speed pull opposite directions.

**Recommendation — don't average. Layer it: lead with the verdict, make the proof one tap beneath, never inline.** The loop stays ruthlessly fast — one test, one sharp rationale, the confidence number *with its one-line because* right there ("matches 40 confirmed cases"). The full proof — the pinout, the tech-by-tech confirmations, the click-through source — lives one tap down behind that because-line, there when the Gate wants to verify, invisible when the Climber just wants to keep moving. The Climber rides the verdict and never taps deeper; the Gate taps the proof the first three times to decide if he trusts it, then rides the verdict too once it's earned. Averaging — a medium-depth screen for everybody — fails both. The one-line *because* is the hinge.

---

## Appendix A — Grounding: internal evidence (who we know uses Vyntechs)

**Headline:** App roles (from code) do NOT map to the personas.

- `profiles.role` defaults to `'tech'` (`lib/db/schema.ts:49`), but **every self-signup is created as `'owner'`** (`ensureProfileAndShop`, `queries.ts`). Only **invited** users get `'tech'` (`app/api/team/invite/route.ts:83`).
- **`'advisor'` does not exist in code.** Memory claims a 4th role; grep finds `advisor` only as `advisorProfileId` (a session field) in `lib/intake/`. The advisor role is **assumed/planned, not built.**
- **`'curator'`** is real as a gate (`lib/curator/can-curate.ts`: `role==='curator' || role==='owner' || isFounder`) but **no code path assigns it** — admins inherit it via `'owner'`, Brandon via `FOUNDER_EMAIL`.

| Persona / Role | Status | Evidence |
|---|---|---|
| Tech (Climber/Gate) | **EVIDENCED** | ~4 YMS techs + beta testers; `'tech'` role real; invite flow real |
| Owner-Tech | **EVIDENCED** | Brandon + Mac are YMS owners; `'owner'` is the real billing+admin role; `checkAccess` gates Stripe at shop level (`auth-access.ts:74-84`) — shop license, not per-seat, is the live payment unit |
| Curator | **EVIDENCED (N≈3, internal only)** | Full UI built (`app/curator/*`); internal content-authoring role, not a customer persona |
| Advisor | **ASSUMED** | Memory + planning docs only; zero code |
| The Gate (adopted) | **HYPOTHESIS** | No evidenced outside-YMS master-tech convert |
| The Skeptic Who Stays | **ASSUMED** | Framework self-labels "indirect only / probably never a customer" |
| The Climber paying solo | **UNVALIDATED** | Economic unit is the shop; no evidence a tech ever paid out of pocket |

The only behaviorally validated humans: YMS techs (`tech`/`owner`), YMS owners, and independent beta testers — and beta testers are standalone, diagnostic-only, which the persona set does not represent at all.

**Missing customer types:** the standalone solo diagnostic user (live today, unmodeled); the non-wrenching shop owner/office manager (structurally enabled — every signup is `owner`); the future contributor-shop curator (the diagnostic-authority moat depends on outside shops contributing outcome data); the dealer tech (different economics, likely "never a customer," worth naming).

---

## Appendix B — Grounding: real-world portrait of techs & shop owners (cited field research)

**How they get paid — and why it shapes everything.** Most US shop techs are paid flat rate: fixed book time per job regardless of actual time. Beat the book → pocket the difference; go over → eat it. "Comebacks" (a fix that didn't hold) are usually re-done **for free**, cutting pay. One diag.net tech: "I average 3 hours a night researching issues… It has to be absorbed into the rate I charge." Diagnostic time that can't be billed is a personal financial loss — this governs every second at the bay. Diesel/heavy-duty is sharper: misdiagnosis on a Class 8 truck means a customer's day of downtime and a possible free re-do.

**Physical reality at the bay.** IMR (2020): 99.6% of techs own a cell phone, 87.4% use one for work in the bay, 57% bring it into the working bay daily. They consult it with gloved/greasy hands, under glare, in noise, while a service writer asks for an ETA. Touchscreen-compatible work gloves and anti-glare rugged displays exist *because the problem is real*. Software consequence: **more than a 2-3 tap path to the answer is effectively broken in the bay.**

**The tools they already use — and what they think.** AllData: trusted for OEM-accurate wiring; "click a wire on this page, it highlights that wire on ALL pages." Mitchell1 ProDemand: harsher reviews — "jumbled, unorganized mess," "like a Google search… hard to navigate"; the estimator and component locator earn praise but navigation friction breeds resentment. Identifix Direct-Hit: trusted for a reason no OEM source can match — **collective verified repair patterns** ("124 people all reported fixing the same problem"). Most experienced shops subscribe to two+ and triangulate. Scan tools: Snap-on holds prestige but Autel/Topdon earn trust on price-to-capability; peer endorsement on forums (not marketing) drives adoption ("I have a Bosch ADS 625 and a Thinktool Pro — guess which one I reach for 99% of the time").

**How trust is earned, and lost instantly.** The Autologic case (diag.net) is the clearest evidence: techs bought $6,000+ tablets sold as subscription-free, then Autologic began remotely *bricking* them on subscription expiry. Community reaction was total: "holding my machine ransom even though I paid for it in full" → "getting rid of" it. **A tool that goes dark mid-job is not an annoyance; it's an income event.** The inverse builds trust: verified, cited information that proves out on the vehicle (the Identifix "80 techs confirmed this fix" model). What loses a tech immediately: a wrong spec that wastes a diagnostic hour; a confident answer with no cited basis; >3 taps under bay conditions; anything that feels like a paywall/ransom; recommending part replacement instead of testing the fault path. Techs talk (iATN, Diagnostic Network, ScannerDanner, YouTube); one wrong answer ripples outward.

**Blows them away:** an answer specific to *their exact vehicle*, that *cites where it came from*, and *proves correct on the first try*; honest about "I know" vs. "I think"; works with gloves on; fast with no wasted taps. **Loses them:** wrong spec, confident-but-unsourced, navigation friction, theater a senior tech spots as generic/hallucinated. "The 'free diag' shops already exist — techs know what an unfounded guess looks like, and don't need a $100/mo subscription to get one."

**Cited sources:** IMR Technician Cell Phone Usage Survey 2020 (NOLN; Equipment World); Chris Collins Inc. flat-rate pay; diag.net threads (flat-rate diagnostic pay; Autologic trust collapse; scanner recommendations); ScannerDanner forum (ProDemand vs Identifix vs AllData); The Garage Journal (AllData vs Mitchell vs Identifix); Fullbay (truck diagnostic tools); Anyline Automotive Service Technicians Survey 2024; Diagnostic Network (About); US Micro Products (anti-glare automotive displays).

---

## Appendix C — Interaction inventory (every click/tap/view/read in the app today)

Honest friction/flatness flags in **bold**.

**1. Sign-in / onboarding** (`app/(auth)/sign-in/page.tsx`) — Clean Google/email form → `router.push('/today')`. **No onboarding at all** — a brand-new tech lands cold on an empty My Jobs. Error states are raw Supabase strings.

**2. Today / My Jobs** (`components/screens/today-home.tsx`) — Header + actions; In-progress/Closed-today/follow-ups or empty state. **Every active row shows a hardcoded `<Risk level="low" />`** regardless of the real case, and a generic `step N / M`. Rows are visually uniform — nothing signals "this one's stuck / hot."

**3a. Intake — counter flow** (`components/screens/counter-intake.tsx`) — Predictive search or Customer/Vehicle/Complaint form; VIN "Scan with camera"; tech selector. **"Scan with camera" is a toggle that flips a boolean** (`setScanned`) — no camera, no decode. **"Auto-saved · last keystroke just now" footer is also fake** (no draft persistence).

**3b. New diagnosis — tech quick path** (`components/intake/new-session-form.tsx`) — Y/M/M/Engine, cached-complaint chips, DTCs, mileage, complaint → honest "Putting together your steps… 5-15 seconds" + progress; 409 gives a real Resume link. Good.

**4. Tree-generating interstitial** (`components/screens/tree-generating.tsx`) — **Fake elapsed `T+0:0X` ticking**; cosmetic (capped at 9s), not real progress.

**5. The diagnostic loop** (`active-session.tsx` + `active-step-form.tsx`) — Vehicle strip + timer; "Active step NN" + serif label + italic rationale. **Confidence as a big number + bar with basis literally "based on AI reasoning + retrieval"** — generic, floats without a story. **Reads the Plan as a flat numbered `TreeRail` of every step** — violates the standing "no step N of M / no upcoming-work preview" principle. Answer = free-text textarea + amber **LogButton** playing a **partly-canned 5-stage narration** (fixed 800ms) that animates whether or not those things happened. **Dead "More options" `…` button** (no onClick). On success: 700ms "Logged · advancing" → `router.refresh()`; **no streaming of reasoning. THE biggest gap: NO cited sources anywhere in the diagnostic UI** (grep-confirmed: source/citation appears only in curator/marketing/topology).

**6. Capturing observation/measurement/photo** (`components/session/*`) — When the AI requests an artifact, a clean capture control renders (PhotoCapture `capture="environment"`, Audio, Video, Ambient). **Measurements are typed as free text** into the same observation box — no numeric field, no unit, no expected-vs-actual diff (the cached plan has the expected value; the live loop never diffs it).

**7. Confidence gate / decline-or-defer** (`decline-or-defer.tsx` + `-live.tsx`) — Hero SVG dial, "fastest path forward" confirm/snap card, "compass" spokes. **VERIFIED FABRICATION (see top callout):** the live wrapper never passes `confidence`/`gate`/`tapeBody`/`engravedPlate`/defer-`meta`, so a real tech sees a hardcoded 73/100 dial, the `DEFAULT_TAPE_BODY` "K-CAN" ledger, "ROUTES TO MARCUS T. · BMW N-SERIES CURATOR," and "BLOCK 7B-3 · TECHS QUEUED 3" — fabricated provenance on a real, non-BMW vehicle. **This is the one place sources are shown, and it's fiction.**

**8. Locking the diagnosis** (`diagnosis-proposed-review.tsx` + `lock-diagnosis-button.tsx`) — Root-cause headline, recommended repair, "what to look for after," a "Push back?" module. **Flat reward:** locking is a plain button → `router.refresh()`; no confirmation, no weight for the pivotal decision. Confidence basis still the generic string.

**9. Repair coaching** (`repair-phase-view.tsx` + `repair-conversation.tsx`) — "Diagnosis locked 🔒" summary, chat thread, "Also worth checking," "Ask the AI" box. **Repair guidance is un-sourced chat text** — same trust gap. Emoji lock icon off-brand vs the typographic system.

**10. Closing / outcome capture** (`outcome-capture.tsx`) — Root-cause textarea (validated ≥10 chars, **AI can 422-reject as too vague** → terse "Be more specific," then override on retry), action-type, conditional part fields, verification chips, notes, auto time. **"Save draft" button is hard-disabled.** Closed case → tidy read-only summary.

**11. Curator / reviewer** (`app/curator/*`) — `/curator` → `/curator/drift`; sidebar nav. Case detail shows **raw `JSON.stringify(treeState)` in a `<pre>`** (explicit `TODO P+1`); **artifacts not viewable** ("signed URLs would need a server action" — reviewer sees filename + size, can't open the photo). Functional review forms; engineer-grade, no diff visualization of what the AI got wrong vs the outcome.

**Cross-cutting:** trust/evidence gap is systemic (zero citations in the live loop; the only "where I looked" view is fiction); cognitive-load principle violated (full step tree + counts); fake/dead affordances erode premium feel (camera toggle, auto-save footer, More-options, Save-draft, cosmetic gen timer, canned LogButton stages); cached "instant" path is a known dead-end ("the tap-through walkthrough is coming in the next update").

---

## Appendix D — Persona critiques (first person)

### The Gate (master tech / gatekeeper)
The honest "5-15 seconds" wait copy earns respect; the 409 "Resume" link matches real shop behavior (six cars going at once). The fake `T+0:0X` timer — clocked instantly; "if that number isn't tracking real work, it's a screensaver." The confidence basis "based on AI reasoning + retrieval" is "a horoscope… Identifix tells me 124 techs fixed the same thing on this exact truck. That's a number with a spine. Yours is a number that's embarrassed to tell me where it came from." The full TreeRail = "you telling me how long I'm gonna be standing here not getting paid." The canned LogButton narration and dead "More options" button → "now I'm wondering what else here is fake." Free-text measurements with a cached expected value never diffed = "that's the whole job." **The "WHERE I LOOKED" gate showing BMW/Marcus fiction on a Power Stroke** = "the one that'd make me close the laptop… the tool telling me it'll make things up with a straight face. Done." Locking = "me signing my name… and it feels like submitting a form." *Decider:* that gate screen — quits and warns every tech in his bays. Flip it to real sources and it's the only thing that'd make him evangelize. *Gets wrong:* (1) no real sources anywhere; (2) shows the work left, not the work done; (3) fake affordances — "you look smart and act unsure. I'm anti-wrong."

### The Climber (hungry B-tech)
"I'll forgive ugly. What I won't forgive is getting played." One next test instead of a wall of 14 maybes = "the move… better than thumbing through ProDemand's jumbled mess." Confidence with "AI reasoning" = "you blew it right there… show me 87% *because the FICM voltage you logged matches the pattern on 40 of these,* or don't show me a number." Canned narration caught on the second pass → distrusts the whole app. The BMW/Marcus sources screen = "the Autologic moment… I'm telling the group chat it's vaporware." Fake camera-scan and fake auto-save = "little lies, but I notice little lies, and they tax the big trust." Lock = "the scariest tap I make… and it's a plain button into a page refresh." *Blows him away if built right:* the AI saying "I don't know — deferring to a curator" instead of guessing — "a tool honest enough to shut up when it's unsure is a tool I can bet my flat-rate hours on." *Decider (positive):* the honest "I'm not sure enough to call this" handoff is the thing he texts another tech about. *Gets wrong:* (1) no real sources; (2) fake theater; (3) confidence with no "why."

### The Owner-Tech (pays, runs the shop)
The serif step label + italic "check X because Y" rationale "is the moment that could get me — a tech who isn't sure WHY he's testing is a tech throwing parts." But the "req. ≥ 70%" + "based on AI reasoning" + a **hardcoded `<Risk level="low" />` on every step** = "the eye-roll… a confidence number with no story is a slot machine." The step count "tells him he's slow when he's not, and lets the customer peer over his shoulder and ask why it's taking nine steps." The gate's fake "WHERE I LOOKED" on a 6.7 Power Stroke = "the day Angel screenshots that and sends it to the group chat, I'm done — and so is every shop he talks to." The 422 "Be more specific" = "your app is *arguing with him* at the finish line." *Decider:* the gate screen — "same screen, opposite outcomes. It's your whole moat sitting in one component that currently doesn't pass its own data." *Gets wrong:* (1) promise cited evidence, never show it; (2) expose step counts + hardcoded low-risk; (3) fight my tech at the close + dead/fake buttons — "they won't fight a screen for the privilege of paying me $100 a month."

### The Skeptic Who Stays (old-school holdout)
Empty My Jobs after sign-in = "nobody thought about the guy who didn't ask for this." Two different jobs both showing "low risk" = "the tell. The computer doesn't know one from the other… that's where I start hunting for the next fake thing." Fake camera-scan + fake auto-save = "two fakes in one form." Confidence off "AI reasoning" = "a kid guessing and putting a decimal on it." What would blow him away: "Coil #4 secondary resistance flags this — 80 techs on a 6.7 logged the same misfire pattern, here's the AllData pinout I'm reading off of. Show me where you looked, on this engine, and let me click it." The full tree = "I've got a binder of those collecting dust." Measurement as free text where the tool already knows the spec = "that's the entire job, and it's mailing it in." The BMW/Marcus gate = "the one screen supposed to prove the tool is honest is the one place it lies hardest." *Decider:* quits over fake sources. *Gets wrong:* (1) no real sources where he works; (2) confidence with no story; (3) treats the measurement like a diary entry. "The day this reads my actual VIN, shows me a real AllData pinout, and tells me 80 guys confirmed the fix — and it's right — that's the day I shut up and let the young guys use it."
