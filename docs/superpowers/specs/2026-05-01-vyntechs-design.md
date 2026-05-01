# Vyntechs — Product Design Spec

**Date:** 2026-05-01
**Status:** Draft — pending user review
**Brand:** Vyntechs

---

## 1. Executive Summary

**Vyntechs is a multi-modal AI master tech that rents to independent auto shops as SaaS.** Every diagnostic-bay job runs through an AI that generates a custom decision tree from live multi-modal inputs (tech-relayed scan-tool data, photos, audio, voice), retrieves knowledge live from the open internet, and directs a junior-to-mid technician through every step. The technician is the actuator — the hands and physical senses. The AI is the brain.

The product replaces the senior-tech bottleneck inside shops without requiring senior-tech labor as the safety net. The cross-shop **corpus of confirmed-fix outcomes**, contributed by every technician on the network and validated for specificity, is the senior tech, distilled and shared.

**Buyer:** independent shop owners and dealership service managers. **Launch market:** Dallas-Fort Worth metro. **User:** junior-to-mid technicians (0-5 years experience). **Pricing:** flat SaaS at ~$700/mo per shop, all-inclusive.

---

## 2. The Pain

A typical 8-bay independent shop runs ~$2M/yr on ~10K repair orders. Industry comeback rate of 12% × 2× redo cost × $200 ARO ≈ **$48-60K/yr of pure waste per shop** — most of it junior-tech misdiagnosis on driveability, electrical, and intermittent cases. Add the master-tech bottleneck cost (overtime, attrition, lost throughput when one senior tech is the only one who can solve the hard cases) and the real annual cost of the diagnostic-skill gap is closer to **$80-120K per shop**.

This isn't a tooling problem the existing market has solved. Mitchell ProDemand and AllData are reference databases, not diagnosticians. Identifix Direct-Hit is a hotline, not real-time guidance. Generic AI tools have no automotive-specific retrieval, no multi-modal inputs from the bay, no calibrated confidence, and no outcome flywheel.

---

## 3. The Promise

- Cut comeback rate by half within 6 months of adoption.
- Make every junior-to-mid tech effectively senior-capable inside their bay.
- Free the master tech (or shop owner who acts as master tech) from being the bottleneck on every hard ticket.
- Provide a complete audit trail of every diagnostic decision and the evidence behind it — useful for warranty disputes, customer trust, and forensic reconstruction if anything goes wrong.

---

## 4. Why Now

Two new capabilities make this product possible in 2026 that were not possible 24 months ago:

1. **Multi-modal LLMs (Claude Sonnet/Opus 4.x).** A single model can fuse audio + image + structured PIDs + retrieved text in one reasoning step. Earlier LLMs could not.
2. **LLMs with tool-use + live retrieval.** Models can do just-in-time research against the open internet and validate sources contextually. This eliminates the need for pre-curated reference content (the Mitchell/AllData business model).

Mitchell, AllData, and Identifix were all built before either capability existed. Their architecture is the wrong shape for what's now possible.

---

## 5. Wedge / Defensibility

Four moat layers, ranked by long-term defensibility:

1. **Cross-shop outcome corpus.** Every diagnosis-to-actual-fix-to-comeback-or-not outcome is logged with structured, AI-validated specificity. Within 12-18 months this dataset is unique and uncopyable. This is the primary moat.
2. **Retrieval orchestration layer.** Knowing which sources to query, in what order, weighted how, fused with multi-modal observations from the bay, with bounded retry budgets. This is hard engineering and accumulates know-how over time.
3. **Risk-stratified confidence calibration.** A per-(risk_class × vehicle_family × symptom_class) calibration table, updated weekly from outcomes. The accuracy of stated confidence numbers becomes a competitive advantage.
4. **Local market reputation in DFW.** Concentrated metro launch creates a peer-network effect among shop owners. Adopt-or-fall-behind dynamics within a tight geography.

---

## 6. Locked Design Decisions

Each decision below was made deliberately and represents a constraint on subsequent work.

| # | Decision | Locked answer |
|---|---|---|
| 1 | Buyer / user | Independent shops + dealership service managers; junior-to-mid tech is the actuator. |
| 2 | Inputs | Multi-modal: tech-relayed scan-tool data via screen photos, plus camera, microphone, voice, text. **No direct scan-tool integration** (no BT, no J2534). |
| 3 | Diagnostic scope | All diagnostic-bay work — anything requiring code read, scan, or test drive. Excludes pure-mechanical (e.g., brake pad replacement) and out-of-scope domains (ADAS calibration, EV battery diagnostics) at MVP. |
| 4 | Diagnostic loop | AI generates a per-case decision tree. Tech walks it. AI updates the tree live as data comes in. |
| 5 | Knowledge sources | LLM reasoning + cross-shop corpus (retrieved first) + bounded internet retrieval (NHTSA, manufacturer recall, repair forums, YouTube transcripts, Reddit, OEM TSB indexes) + Tech-Assisted Retrieval (last resort). **No pre-scraping, no bulk OEM licensing at MVP.** |
| 6 | UX form factor | **Single responsive web app (Next.js, PWA-installable)** with four distinct viewport/route layouts: phone (tech), tablet (bay arm), desktop (service writer; intake route v1.0 dark / v1.5 enabled), curator console (async). One codebase, one deploy. See §15 row "Architecture stack" for the full stack decision. |
| 7 | Failure / liability model | Decider stance with **risk-stratified confidence gating**. ToS-waived liability at signup. **No real-time master-tech escalation.** Below-threshold high-risk actions trigger **Decline-or-Defer**, not escalation. |
| 8 | Pricing | Flat SaaS, ~$700/mo per shop, all-inclusive. No metered escalation. |
| 9 | Storage policy on tech-contributed artifacts | Cross-shop sharing from day 1. Mandatory structured outcome capture with AI-validated specificity. OEM artifacts (wiring diagrams, TSBs) used transiently in-session, never redistributed; structured derived facts are stored. |
| 10 | Brandon's role | Asynchronous corpus curator. Reviews deferred and uncertain cases in batches, contributes structured answers to the corpus. **Not** a real-time field-rescue resource. |
| 11 | GTM | Metro-concentrated. DFW first. National expansion only after corpus calibrates and per-metro economics validate. |
| 12 | Vision policy | **Describe-first, photo-on-demand.** Tech describes observations in text; AI vision invoked only when text is insufficient or for high-signal artifacts (scan-tool screens, wiring diagrams, hard-to-describe phenomena). |
| 13 | Bounded retrieval | Per knowledge gap: 1 corpus query, then ≤5 internet queries / 30s wall-clock / 50K tokens, then Tech-Assisted Retrieval (1 ask + 2 follow-ups), then Decline-or-Defer. |
| 14 | Photo storage | Tiered: hot (0-90d) S3 standard, warm (90d-2y) S3 IA, cold (2y+) Glacier. Structured AI extractions stored permanently. |
| 15 | Architecture stack | Single Next.js application, responsive layouts gated by viewport breakpoint, PWA-installable on iOS/Android/desktop. One repo, one deploy target, one auth/session/state model. Native iOS/Android apps explicitly out of scope at MVP. |

---

## 7. System Architecture

The diagram below shows the four UX layouts as separate boxes for clarity, but in implementation **all four are layouts of one Next.js application**, picked by viewport breakpoint and route. One codebase, one deploy. The PWA install promotes any of the four layouts into a home-screen-installable app on iOS, Android, and desktop.

```
                           ┌──────────────────────────┐
                           │      MULTI-SURFACE UX    │
        ┌──────────────────┼────────┬─────────────────┼───────────────────┐
        │                  │        │                 │                   │
┌──────────────┐  ┌──────────────────┐  ┌────────────────┐  ┌─────────────────┐
│ Phone (tech) │  │ Tablet (bay arm)  │  │ Desktop (SW)   │  │ Curator Console │
│ voice+camera │  │ tree visualization│  │ intake/quote   │  │ (Brandon, async)│
│ scan-tool    │  │                   │  │ v1.0 dark      │  │ deferred queue  │
│ SCREEN photo │  │                   │  │ v1.5 enabled   │  │ corpus authoring│
└──────┬───────┘  └─────────┬────────┘  └───────┬────────┘  └────────┬────────┘
       │                    │                   │                    │
       └────────────────────┴────────┬──────────┴────────────────────┘
                                     │
                              ┌──────▼───────┐
                              │   GATEWAY    │
                              └──────┬───────┘
                                     │
                  ┌──────────────────▼──────────────────┐
                  │       SESSION ORCHESTRATOR          │
                  │   (state machine per active case)   │
                  └─┬──────┬──────────┬───────┬─────────┘
                    │      │          │       │
       ┌────────────▼──┐  ┌▼──────┐ ┌─▼────┐ ┌▼─────────────────┐
       │ MULTI-MODAL   │  │ VISION│ │ TREE │ │ DECLINE-OR-DEFER │
       │ CAPTURE PIPE  │  │ OCR   │ │ ENGN │ │ (terminal safety)│
       └───────────────┘  └───────┘ └──┬───┘ └──┬───────────────┘
                                       │        │
                       ┌───────────────▼────────▼──────────────┐
                       │   TIERED REASONING CORE                │
                       │   • Haiku 4.5  → classification, gates │
                       │   • Sonnet 4.6 → routine reasoning 80% │
                       │   • Opus 4.7   → hard cases            │
                       │   prompt-cached system + corpus context│
                       └─┬─────────────────────────────┬────────┘
                         │                             │
              ┌──────────▼──────────────┐    ┌─────────▼──┐
              │  RETRIEVAL ORCHESTRATOR │    │  GAP       │
              │  cached per (vehicle,   │    │  HANDLER   │
              │  DTC, symptom)          │    │  3-tier    │
              └─────────────────────────┘    │  ladder    │
                                             └────────────┘

        ┌─────────────────────────────────────────────────────────┐
        │  CROSS-SHOP CORPUS (Direct-Hit-grade)                   │
        │  retrieved FIRST in every case                          │
        │  fed by: outcome capture (live) + curator entries (async)│
        └─────────────────────────────────────────────────────────┘
        ┌─────────────────────────────────────────────────────────┐
        │  OUTCOME CAPTURE (mandatory, structured, AI-validated)  │
        │  blocks tech from new session until prior closed        │
        └─────────────────────────────────────────────────────────┘
        ┌─────────────────────────────────────────────────────────┐
        │  CALIBRATION ENGINE (weekly batch)                      │
        │  re-fits confidence thresholds per                      │
        │  (risk_class × vehicle_family × symptom_class)          │
        └─────────────────────────────────────────────────────────┘
```

### 7.1 Component responsibilities

**Multi-surface UX layer**
- *Phone (tech):* primary capture device. Voice prompts, camera (photos/video), scan-tool screen capture, microphone for engine sounds, hands-on input via tap/voice.
- *Tablet (bay arm):* visual decision tree, captured artifact gallery, current step / next action display. Read-mostly during active sessions.
- *Desktop (service writer):* customer intake, pre-bay diagnostic plan generation, customer-facing quote draft. **Built into v1.0 codebase, gated by feature flag (`desktop_intake_enabled`), enabled for v1.5 launch.**
- *Curator console:* asynchronous web interface for Brandon (and future curators). Deferred-queue review, corpus authoring, calibration drift monitoring.

**Session Orchestrator**
A state machine per active case. Tracks current tree node, captured data, pending AI requests, in-flight retrievals. Single source of truth for the case lifecycle. Survives reconnects and tab switches.

**Tiered Reasoning Core**
Three-tier model routing for cost control:
- **Haiku 4.5:** classification subtasks (risk-class assignment, "is this a destructive action?", scan-tool screen routing decisions). ~$1/M input.
- **Sonnet 4.6:** ~80% of reasoning — tree generation, tree updates, retrieval evaluation, outcome validation. ~$3/M input.
- **Opus 4.7:** hard cases that exceed Sonnet's reliability threshold (defined by automatic escalation rules: novel patterns, conflicting evidence, high-risk gating decisions). ~$15/M input.

System prompt is prompt-cached (~5K tokens). Per-vehicle-family corpus context is also cached when the same vehicle is in active session across the day.

**Multi-Modal Capture Pipeline**
Pre-processes audio (denoise, segment), images (auto-orient, label key components, OCR text), video (key-frame extract). Outputs structured representations.

**Vision OCR**
Specialized invocation of Sonnet vision for scan-tool screens, wiring diagrams from ProDemand/AllData, and high-signal artifacts. Subject to the describe-first policy (§10).

**Tree Engine**
Generates the initial decision tree from intake context + corpus matches. Updates live as new data resolves branches. Maintains tree state in the Session Orchestrator.

**Risk Classifier**
Tags every proposed action with a risk class: `zero` (read PID), `low` (visual inspection, smoke test), `medium` (back-probe non-power circuit, harness splice), `high` (back-probe power/CAN, voltage application), `destructive` (irreversible cuts, module reflashes).

Hard-coded rules for known action patterns; LLM-judged for novel actions; audited for safety drift.

**Confidence Calibrator**
Per-(risk_class × vehicle_family × symptom_class) threshold table. Updated weekly by the Calibration Engine from outcome data. Used by the Gap Handler to decide commit vs. Decline-or-Defer.

**Retrieval Orchestrator**
First rung of the bounded retrieval ladder (after corpus). Owns weighted query strategies per source. Sources: NHTSA recall API, manufacturer recall pages, F150Forum / EcoBoostForum / generic make-model forums, Reddit r/MechanicAdvice + r/AskMechanics, YouTube transcripts (via API), public OEM TSB indexes. Caches results per (vehicle, DTC, symptom) tuple. Validates retrieved content against case context before passing to the reasoning core.

**Gap Handler**
Implements the bounded retrieval ladder. Tracks budget consumption. Routes to the next rung when current rung exhausts or fails to resolve.

**Decline-or-Defer**
Terminal safety mechanism. When all retrieval rungs exhaust without high-confidence resolution on a high-risk action, surfaces three options to the tech: (a) gather more low-risk diagnostic data, (b) decline this job and refer the customer elsewhere, (c) defer for asynchronous curator review. Generates customer-facing language for option (b). Tags the case for the Curator Console queue if (c).

**Cross-Shop Corpus**
Structured, searchable database of confirmed-fix outcomes. Schema in §11.1. Retrieved as Rung 0 (before any other source) in every case. Fed by live outcome capture + curator-authored entries. Quality controls in §11.3.

**Outcome Capture**
Mandatory structured form, AI-validated for specificity. Blocks the tech from starting a new session until the prior case is closed with detailed answers. AI rejects vague text and prompts for landmarks, identifiers, and verification.

**Calibration Engine**
Offline batch job, weekly cadence. Re-fits the confidence threshold table from accumulating outcome data. Monitors for calibration drift and surfaces drift alerts to the Curator Console.

---

## 8. Core Workflows

### 8.1 Diagnostic Session Loop

```
1. Service writer (or tech) creates session with intake context.
2. Session Orchestrator pulls vehicle decode, customer complaint, prior service history.
3. Cross-Shop Corpus retrieved first: similar prior cases ranked by match score.
4. Tree Engine generates initial decision tree from intake + corpus.
5. Tech executes Step 1 of tree (typically scan + freeze frame).
6. Tech relays observation to AI:
     • Default: text/voice description.
     • On AI request OR tech-uncertainty: photo/video.
7. AI (Sonnet, prompt-cached) processes input, evaluates tree state.
8. If branch resolves cleanly: AI commits to next step, advances tree.
9. If knowledge gap: AI walks bounded retrieval ladder (§8.2).
10. If high-risk action proposed: AI applies risk-stratified gating (§8.3).
11. If gating fails or all retrieval exhausts: AI invokes Decline-or-Defer (§8.4).
12. Loop until root cause identified with high confidence + verified by tech action.
13. Outcome capture (§8.5) — mandatory, structured, AI-validated.
14. Corpus contribution + comeback follow-up scheduled.
15. Session closes; tech unblocked for next case.
```

### 8.2 Bounded Retrieval Ladder

Per knowledge gap during a session:

| Rung | Source | Budget | Cost / call | Tech burden |
|---|---|---|---|---|
| 0 | Cross-shop corpus | 1 query | ~$0 | none |
| 1 | Internet retrieval orchestrator | ≤5 weighted queries OR ≤30s wall-clock OR ≤50K tokens | ~$0.02-0.10 | none |
| 2 | Tech-Assisted Retrieval | 1 ask + max 2 follow-ups | ~$0 LLM + 60-180s tech time | small (last resort) |
| 3 | Decline-or-Defer | terminal | ~$0 | none — refers to shop business decision |

The AI never proceeds to a destructive action without resolving the gap through one of rungs 0-2. Rung 3 is the safety valve.

### 8.3 Risk-Stratified Confidence Gating

Every action proposed by the AI carries a risk-class tag. The confidence threshold to commit scales with the risk class:

| Risk class | Example actions | Required AI confidence (MVP starting values) |
|---|---|---|
| Zero | Read PID, listen for sound, observe instrument cluster | None — proceed |
| Low | Visual inspection, smoke test, fuse pull-and-replace | ≥70% |
| Medium | Back-probe non-power signal wire, fluid sample | ≥80% |
| High | Back-probe power/CAN circuit, voltage application | ≥90% |
| Destructive | Wire cut, module replacement, flash reprogram | ≥95% multi-source corroboration |

These thresholds are MVP starting values, deliberately conservative. The Calibration Engine (§7.1) updates per-(risk_class × vehicle_family × symptom_class) thresholds weekly from outcome data. Thresholds tighten or relax over time as calibration data accumulates.

If a proposed action's required threshold is not met after all retrieval rungs, the action is blocked. AI invokes Decline-or-Defer or proposes a lower-risk alternative path.

### 8.4 Decline-or-Defer

When a high-risk action cannot be safely committed to:

```
⚠ Confidence too low to commit to a destructive action.

Gap: <AI articulates the specific information or
     reasoning gap that prevents commit>

Options:
  ① Gather more low-risk data: <AI proposes 2-3 specific
     non-destructive tests that would resolve the gap safely>
  ② Decline this job: <AI generates customer-facing language
     recommending dealer or specialty referral>
  ③ Defer for curator review: 24-72h turnaround. Customer keeps
     vehicle until curator answer arrives. The answer enters the
     corpus for this and all future similar cases.
```

The tech and shop owner choose based on business context. The tech is never told "do this risky thing" without high AI confidence.

### 8.5 Outcome Capture

Every completed session must close with a structured outcome form:

| Field | Required | AI validation |
|---|---|---|
| Root cause description | Yes | Specificity required: location, identifier, landmark a future tech could find in 60s |
| Action type | Yes | Enum: Part replacement / Repair / Adjustment / Cleaning / No fix needed / Referred |
| Part info (if replacement) | Conditional | OEM #, aftermarket alternative if used, cost |
| Verification | Yes | Codes cleared, test drive, symptoms resolved (Y/N/Partial) |
| Time spent | Yes | Auto-calculated diagnostic time + manual repair time |
| Notes for the corpus | Optional | If provided, AI checks for added value / specificity |
| Follow-up consent | Yes | 7-day and 30-day comeback prompts auto-scheduled |

AI rejects vague text and pushes back: *"Be specific. WHERE was the crack? Other techs need to find this in 60 seconds."*

### 8.6 Curator Workflow

Curator (Brandon at MVP, additional curators post-PMF) works asynchronously through:

1. **Deferred queue:** cases the Decline-or-Defer mechanism flagged as "defer for curator review."
2. **Drift queue:** cases the Calibration Engine flagged as showing pattern drift (corpus answer was wrong, comeback rate elevated, conflict between live and corpus).
3. **Novel-pattern queue:** cases tagged by AI as new patterns not in corpus, awaiting validation.

Curator reviews each case, researches gaps, and contributes structured answers back to the corpus. Each contribution is permanent and benefits all future similar cases across the network.

---

## 9. Multi-Surface UX Specification

**Implementation:** one Next.js application, PWA-installable, deployed once. The four layouts below are picked by viewport breakpoint + route + user role. All four share auth, state, session orchestrator, and styling system.

### 9.1 Phone layout — `/session/:id` at viewport `< 640px` (tech, primary capture)

Camera/voice-first UI optimized for one-handed operation in greasy gloves.

- Voice-to-text via Web Speech API. Push-to-talk on a large bottom-screen button; always-on listening when in active session if granted.
- Camera capture via `<input type="file" capture>` + `getUserMedia`: photo + short video with one-tap upload.
- Specialized scan-tool screen capture mode (auto-rotates, OCR-optimizes, returns extracted text in <5s).
- Microphone capture via `MediaRecorder` for engine sounds (10-30s clips, with on-screen prompts like "hold mic 6 inches from valve cover at idle").
- Tree collapsed to current step + breadcrumbs; swipe gestures for advance/back.
- Tap-through tree node confirmation ("done — what did you find?").
- Vibration feedback on confirmations / errors.
- In-app dashboard prompts for comeback follow-ups (push notifications deferred to v1.5+).

### 9.2 Tablet layout — `/session/:id` at viewport `640-1280px` (bay arm)

Tree-visualization-first, read-mostly. Renders on the same `/session/:id` route as phone but with different layout breakpoint.

- Visual decision tree dominant, current step highlighted, branch-pruning animations as data resolves branches.
- Captured artifact gallery sidebar (photos, scan readings, retrieved sources).
- Optional voice input pass-through (if bay is quiet enough).
- Auto-rotate locked.
- Tech primarily interacts via the phone layout; tablet is mostly a read surface for situational awareness.

### 9.3 Desktop intake layout — `/intake` at viewport `≥ 1280px` (service writer)

Multi-pane keyboard-driven layout for the front counter. **Built into v1.0 codebase, gated by feature flag `desktop_intake_enabled` (default `false`). v1.5 launch flips the flag.**

- Customer intake form (complaint entry, VIN scan via webcam or USB scanner).
- AI-generated pre-bay diagnostic plan with estimated time + price range.
- Customer quote draft (printable / emailable).
- Work order creation that auto-links to the bay session (handoff to phone/tablet layouts when the tech opens the case).
- Comeback alerts when a customer returns within 30 days.

### 9.4 Curator console layout — `/curator` at viewport `≥ 1280px` (Brandon, async, role-gated)

Same Next.js app, separate route, gated by curator role. Optimized for batch-mode async work; not customer-facing.

- Deferred queue with case context, retrieval history, AI reasoning trace.
- Drift queue with pattern alerts and recommended investigations.
- Novel-pattern queue with newly-tagged cases.
- Corpus authoring interface: structured form for contributing entries.
- Calibration drift dashboard.

### 9.5 Cross-cutting

- **PWA install prompt** appears on first visit on phone/tablet/desktop, encouraging the tech and shop to add to home screen / install. Once installed, the app behaves like a native app: full-screen, app icon, persistent permissions.
- **Service worker** caches the app shell for fast cold-start; runtime data still requires connectivity (LLM and retrieval need internet).
- **Real-time session sync** via WebSockets / SSE: an action on the phone updates the tablet's tree visualization within ~200ms.
- **Supported browsers:** Chrome 120+, Safari 17+, Edge 120+. iOS Safari supported with documented PWA caveats. Older browsers show a graceful upgrade prompt.

---

## 10. Vision Policy: Describe-First, Photo-on-Demand

The technician's attention is the most expensive resource in the loop. The default exchange is: *AI says "look at X, tell me if you see Y";* tech responds in text or voice; AI ingests, updates state, advances.

**AI vision is invoked when:**
- Reading a scan-tool screen (structured data extraction; high signal).
- Reading a wiring diagram or service procedure photographed by the tech.
- Tech reports "I'm not sure what I'm seeing" or describes ambiguously.
- AI's confidence on a high-stakes action requires visual verification of an exact location/component.
- Phenomena that are hard to describe in text: hairline cracks, oil residue patterns, smoke escape locations, color-coded wire identification, broken pin tabs in connectors.
- Final fix verification where photo evidence has downstream value (warranty, customer trust).

**AI vision is not invoked when:**
- The tech can plainly see and describe the state.
- The visual confirmation is redundant with text the tech already provided.
- A photo would be taken proactively without AI need.

This policy reduces vision token spend ~5-10x vs. naive "every observation gets a photo" architecture, and proportionally reduces photo storage volume.

---

## 11. Cross-Shop Corpus & Outcome Flywheel

### 11.1 Schema

Each corpus entry is a structured record:

```
corpus_entry {
  id: uuid
  vehicle: { year, make, model, engine, build_date_range }
  symptoms: [structured symptom tags]
  dtcs: [code list]
  observations: [structured observations]
  freeze_frame_pattern: { rpm, load, temp, fuel_trim, etc. }
  root_cause: structured text (specificity validated)
  action_taken: { type, location, identifier, part_info }
  verification: { codes_cleared, test_drive, symptoms_resolved }
  contributor: { shop_id, tech_id, date }
  outcome_status: { 7d_check, 30d_check, comeback_recorded }
  success_rate: derived (across all matches with this resolution)
  confidence_score: derived (sample size + recency + comeback rate)
}
```

### 11.2 Contribution Pipeline

```
session closes → outcome capture validated → corpus entry candidate
    ↓
    7d follow-up: tech confirms no comeback
    ↓
    30d follow-up: confirms or auto-flag as drift
    ↓
    enters confirmed corpus (visible to all shops in network)
    ↓
    on subsequent similar cases: retrieved as Rung 0 match
```

Curator-authored entries skip the live-shop pipeline but are tagged as such for transparency.

### 11.3 Quality Control

Risk: a tech contributes a fix that "worked" by coincidence (e.g., MAF cleaner cleared a P0171 that was actually a vacuum leak about to fail again).

Mitigations:
- **N-way confirmation:** entries gain confidence as multiple independent shops contribute the same resolution to similar cases.
- **Comeback decay:** an entry's confidence drops automatically if comebacks accumulate against its resolution pattern.
- **Curator review:** drift-flagged entries route to the Curator Console for manual investigation.
- **Conflict surfacing:** when corpus and live retrieval disagree on a case, AI surfaces the conflict transparently rather than silently picking.

### 11.4 Legal Boundary

OEM service content (Mitchell ProDemand wiring diagrams, AllData TSBs, factory procedures) is used **transiently** in-session only. The AI extracts the structured fact (e.g., "K-CAN-H is white/red at pin 7 for this build date") and stores the fact, not the verbatim artifact. The original photo of the OEM material is stored only in the case's evidence record, accessible to the contributing shop, and is not redistributed to other shops via the corpus.

The cross-shop corpus is composed exclusively of **tech-contributed work product**: structured outcome descriptions, action narratives, verification data. The shop grants a license to this content via Terms of Service at signup.

This boundary needs legal review before launch.

---

## 12. Photo Storage Tiering

| Tier | Window | Storage class | Cost @ scale | Purpose |
|---|---|---|---|---|
| Hot | 0-90 days (warranty / comeback window) | S3 standard | ~$0.023/GB/mo | Active dispute, customer follow-up |
| Warm | 90 days – 2 years | S3 IA | ~$0.0125/GB/mo | Long-tail customer disputes |
| Cold | 2+ years | Glacier Instant Retrieval | ~$0.004/GB/mo | Legal forensic record |
| Permanent | All eras | AI structured extraction (text fact in corpus) | ~$0 | Future case retrieval |

Optional shop setting: extend hot-tier window for fleet customers or shops in litigious jurisdictions.

---

## 13. Pricing Model & Unit Economics

**Pricing:** flat SaaS, $700/mo per shop, all-inclusive. No metered escalation, no per-bay charges, no per-diagnosis fees.

**Per-shop monthly COGS** (modeled at 750 cases/mo, mature corpus):

| Component | Cost |
|---|---|
| LLM (Sonnet primary, Opus on hard cases) | $75-190 |
| Vision OCR (describe-first applied) | $1-3 |
| Internet retrieval | $10-20 |
| Infra share (single-deploy, 50-shop pool) | $8-15 |
| **Total COGS / shop** | **$94-228** |

**Gross margin at maturity:** 67-86%.

**Revenue at 50-shop steady state:** $35K MRR. **COGS:** ~$5-12K. **Gross profit:** ~$23-30K/mo. Funds founder + one engineering hire + customer success.

Cold-corpus year-1 economics are tighter (LLM costs ~3x higher per case before corpus matures). Revenue still covers COGS but margin is closer to 50%.

---

## 14. GTM Phasing — DFW Concentration

| Phase | Window | Shops | Focus | Exit criteria |
|---|---|---|---|---|
| 0 — Pre-launch | M-3 to M0 | 0 | Build MVP. Brandon seeds corpus offline (200-500 reference cases). Recruit 3-5 design-partner shops. | MVP feature-complete; corpus seeded for top-30 DTC × top-20 vehicle combos; design partners signed. |
| 1 — Pilot | M1-M3 | 3-5 | Live design-partner usage. Heavy UX iteration. Brandon ~50% time on real-time observation + curator work. Calibration data starts flowing. | 500+ cases logged; tech NPS > 7; calibration thresholds updated; UX bugs killed. |
| 2 — DFW expansion | M4-M9 | 6-25 | Reference selling from pilot shops. Pricing live ($700/mo). Brandon ~30% real-time, 70% curator. | 25 shops; $17.5K MRR; corpus matches 60%+ of incoming cases; observable comeback-rate improvement at pilot shops. |
| 3 — DFW saturation | M10-M18 | 26-50 | First sales/CS hire. Calibration engineer hire if Brandon's curator load exceeds capacity. | 50 shops; $35-40K MRR; comeback-rate validated externally; corpus mature on top-80% of DFW vehicle population. |
| 4 — Adjacent metro | M19-M24 | 60-100 | Houston or Austin launch. Corpus transfers ~70% useful (vehicle-population overlap). New metro launches with calibrated AI from day 1. | Second metro at 10+ shops by M24; per-metro CAC and LTV economics validated. |

---

## 15. MVP Cut

| Feature | v1.0 status | Notes |
|---|---|---|
| Multi-surface UX (phone + tablet) | IN | Core. |
| Desktop service-writer intake | **IN, dark** | Built into v1.0; feature-flagged off; flag-flip = v1.5 launch. |
| Session orchestrator + tree engine | IN | Core. |
| Tiered reasoning (Haiku/Sonnet/Opus) | IN | Required for unit economics. |
| Vision OCR (scan-tool screens, diagrams) | IN | Replaces BT scan-tool integration entirely. |
| Multi-modal capture (audio/video) | IN | Describe-first vision policy applied. |
| Cross-shop corpus + retrieval | IN | The moat. |
| Bounded internet retrieval | IN | NHTSA, recall pages, repair forums, YouTube transcripts, Reddit. |
| Tech-Assisted Retrieval | IN | Last-rung gap-filler. |
| Risk-stratified confidence gating (basic) | IN | High/low classes at MVP; finer gradation v2. |
| Decline-or-Defer | IN | Safety mechanism replacing real-time escalation. |
| Mandatory structured outcome capture | IN | AI-validated specificity. |
| Cross-shop corpus from day 1 | IN | The flywheel. |
| Curator Console (Brandon) | IN | Async deferred queue + corpus authoring. |
| Comeback follow-up tracking (in-app) | IN | 7d + 30d auto-prompts. |
| ToS waiver + Stripe billing + auth | IN | Standard. |
| Photo storage tiering (hot/warm/cold) | IN | Day-1 policy; expensive to retrofit. |
| **Architecture: single Next.js responsive web app + PWA** | IN | One repo, one deploy. Four viewport/route layouts share auth + state + backend. PWA install on iOS/Android/desktop. Service worker for app-shell caching. |
| Real-time session sync across devices (WebSockets/SSE) | IN | Phone capture updates tablet tree in ~200ms. Required by multi-surface design. |
| Aftermarket-parts integration | OUT | Free-text part info at MVP. |
| Email / SMS / push notifications | OUT | In-app only at MVP. |
| Hands-free voice-only mode | OUT | Bay noise UX risk; v2. |
| Customer-facing repair-summary emails | OUT | v2. |
| Shop-OS integrations (Tekmetric, Shop-Ware) | OUT | v2/v3. |
| ADAS calibration support | OUT | Different domain. |
| EV-specific diagnostics (HV battery, BMS) | OUT | Out of MVP scope. |
| Multi-language UI | OUT | English at MVP; Spanish v2. |
| Live OBD-II streaming | OUT | Stripped by design. |
| Telematics / connected-car APIs | OUT | Not the wedge. |

---

## 16. Open Questions

Numbered and tracked. Each must be resolved before or during plan-writing. Numbering preserved across revisions for stable cross-reference.

1. **Brandon's curator capacity at scale.** At 50 shops with 5-15 deferred + flagged cases/day @ 20-60 min each = 2-4 hr/day curator labor. Sustainable solo. Plan for second-curator hire by M12-M15.
2. **Legal review pre-launch.** Three documents need a tech-product attorney's review:
   - Terms of Service (liability waiver, gross-negligence carve-outs, cross-shop corpus license grant, transient OEM-content disclaimer).
   - Privacy policy (photo / audio / scan data retention; customer-vehicle data handling).
   - Shop license agreement (corpus contribution license + use rights).
3. **Cold-start corpus seeding.** Pre-launch curator work covers 200-500 cases. Coverage will be sparse; first design-partner shops will hit corpus misses frequently. Brandon's Phase 1 time allocation reflects this.
4. **Calibration cold-start.** Confidence numbers in months 1-6 are uncalibrated. Risk-stratified gating provides safety, but stated confidence won't reflect true probability until 1000+ cases of outcome data accumulate. Be honest with design partners.
5. **Notification channel for comeback follow-ups.** In-app at MVP. Add email-to-shop-owner at v1.5 if in-app miss rate is too high.
6. **Vehicle-coverage gaps for rare or imported vehicles.** Recommend best-effort with low confidence (Decline-or-Defer triggers more often) rather than hard block-list at intake.
7. **Corpus quality control under coincidence-fix risk.** Mitigations described in §11.3 must be implemented day-one; cannot be retrofitted.
8. **MVP pre-flight validation.** Brandon runs AI through 50-100 simulated cases offline before any live shop session. Pre-flight checklist gated on no critical failures.
9. **Operational liability insurance / E&O.** Get quotes early; automotive E&O can be expensive and shapes the pricing math.
10. **Corpus-vs-retrieval conflict handling.** Trust hierarchy: structured corpus > forum posts (corpus is verified outcomes; forum is unverified opinion). When they conflict, AI surfaces the conflict transparently.
11. **Tech adoption resistance.** Some experienced techs may resist AI direction culturally. Pilot shops should select techs open to the tool. Plan a "trust-building" onboarding period (5-10 sessions where AI defers more often, builds rapport).
12. ~~**Final brand name.**~~ **Resolved 2026-05-01: Vyntechs.**
13. **Shop management system question (deferred from MVP).** Whether to build our own SMS, integrate with existing ones, or sidestep entirely is a post-PMF strategic decision. Tracked but not blocking MVP.

---

## 17. Risks

Top risks ordered by impact.

1. **Calibration cold-start risk.** Without sufficient outcome data in Phase 1, confidence numbers may misrepresent true probability. A confidently-wrong commit in early months could damage shop relationships permanently. Mitigation: aggressive Decline-or-Defer in Phase 1, conservative gating thresholds, transparent communication with design partners.
2. **Single bad incident risk.** One $5K+ module fry traceable to AI guidance could become a trade-publication story and stall sales. Mitigation: risk-stratified gating + audit trail + Decline-or-Defer + ToS waiver with a clear destructive-action carve-out.
3. **Legal exposure on cross-shop corpus.** Mitchell or AllData could allege redistribution of their content. Mitigation: rigorous transient-use boundary on OEM artifacts; only structured derived facts persist; legal review (per Open Q2).
4. **Brandon-bottleneck risk.** Curator load is solo until M12-M15. If shop count grows faster than calibration tightens, curator queue blows up. Mitigation: hire trigger at curator queue >2 days SLA; can also pause new shop onboarding if needed.
5. **Tech rejection risk.** If junior techs feel AI is "bossing them around" rather than "helping them succeed," adoption fails inside the shop even if shop owner buys. Mitigation: explicit minimize-tech-burden design principle; describe-first vision policy; AI explains its reasoning ("here's why I'm asking").
6. **Vehicle-coverage gap risk.** Rare or imported vehicles return weak corpus + weak retrieval results. Customer-facing impact: shop sometimes can't help. Mitigation: Decline-or-Defer creates a graceful fallback; over time, curator-seeded entries fill major gaps.
7. **Comeback measurement reliability.** Self-reported comeback data could be biased; some comebacks are silent (customer goes elsewhere). Mitigation: external survey of pilot shops at M6 to validate self-report against ground truth.

---

## 18. Appendix — Sample Session Walkthroughs

Two end-to-end walkthroughs that exercise the design under different conditions. Used to stress-test the design during brainstorming. Reference implementations for engineering.

### 18.1 Clean case — 2018 F-150 P0299 underboost

**Vehicle:** 2018 Ford F-150 3.5L EcoBoost, ~85K miles, fleet vehicle.
**Complaint:** Loss of power going up hills, intermittent wrench light.
**Tech:** Marcus, 18 months experience.

**Timeline:**

- **T+0:00** — Service writer Diana enters complaint + scans VIN at desktop. AI returns initial assessment from corpus (47 prior similar cases): top causes ranked, diagnostic time estimate 45-90 min, quote $150-250.
- **T+0:08** — Marcus opens case on bay tablet; initial decision tree displayed.
- **T+0:11** — Marcus snaps scan-tool screen photo. Vision OCR (4s) extracts P0299 + P0236, freeze frame underboost 3.6 psi at 73% load. Tree updates live, branches to boost-leak / wastegate path.
- **T+0:16** — AI: "Look at the cold-side intercooler pipe. Tell me if you see cracks, oil residue, or disconnections." (Describe-first.) Marcus reports text: no obvious damage. Suggests smoke test.
- **T+0:24** — Smoke test. Marcus uploads short video. Vision processes, identifies smoke escape at wastegate actuator vacuum line — not the CAC pipe.
- **T+0:24** — Knowledge gap: zero corpus matches for this exact pattern. AI walks Rung 1 retrieval (5 weighted queries, 6s elapsed). Returns 2 forum threads + 1 YouTube transcript on F-150 EcoBoost wastegate vacuum line failure at 60-100K miles. AI commits with 87% confidence. Risk class: low. No tech-assisted retrieval needed.
- **T+0:55** — Marcus replaces silicone vacuum line, clears codes, hard-pull verification drive: boost holds, no recurrence.
- **T+0:58** — Outcome capture. AI rejects vague text ("wastegate line was cracked") and prompts for specificity. Marcus revises: location, distance from actuator-can end, specific smoke leak conditions. AI accepts.
- **T+0:59** — Corpus contribution. Pattern (P0299 + P0236 + freeze-frame underboost ~3-5 psi at high load + smoke positive at wastegate actuator vacuum line, F-150 3.5L EcoBoost 60-100K miles) tagged for future case matching. 7-day comeback follow-up auto-scheduled.

**Design elements demonstrated:** multi-surface UX, describe-first vision, corpus-first retrieval, Rung 1 internet retrieval bounded by budget, vision invoked only when high-signal, mandatory structured outcome capture with AI validation, contribution pipeline.

### 18.2 Hard case — 2014 BMW 335i K-CAN no-start

**Vehicle:** 2014 BMW 335i (F30), 3.0L N55, ~110K miles.
**Complaint:** Intermittent crank-no-start with dash flicker.
**Tech:** Same Marcus.

**Timeline (compressed):**

- **T+0:00** — Service writer intake. AI returns assessment from corpus (8 prior cases). Top causes ranked: FRM failure (50%), JBE water intrusion (25%), wiring chafe (12.5%), battery/IBS (12.5%). Diagnostic time estimate 1.5-3.5 hr, quote $250-475.
- **T+0:11** — Tech opens case in bay. AI: "Open hood, describe battery condition." (Describe-first.) Marcus reports BMW AGM, 5 years old, terminals clean. AI requests carbon-pile load test before bus diagnostic.
- **T+0:25** — Battery load-tested borderline. AI offers (a) known-good battery swap to rule it out vs. (b) commit to bus diagnostic. Marcus chooses (a). Symptom reproduces with known-good battery → battery ruled out. Commits to bus diag path.
- **T+0:35** — Marcus uploads photo of Autel module-scan screen. Vision OCR extracts: FRM + CAS dark, U0140 + U0151 set on multiple modules. Cross-shop corpus: 4 prior FRM-alone failures, 0 prior dual FRM+CAS dropouts. Novel pattern.
- **T+0:35** — AI walks Rung 1 retrieval. Returns lead: dual FRM+CAS dropout = water intrusion at JBE harness connector under cabin filter. Conflicting forum opinions on next diagnostic step.
- **T+0:43** — AI invokes Tech-Assisted Retrieval (Rung 2). Asks Marcus to pull BMW K-CAN bus diagnostic flowchart from ProDemand and photograph it. Vision OCR extracts factory procedure: physical harness inspection at JBE before back-probing. Confidence rises.
- **T+0:43-0:52** — Marcus disassembles cabin filter housing, inspects JBE connector, reports green corrosion on K-CAN-H, K-CAN-L, and module-power pins. AI requests one verification photo (active corrosion vs. dielectric grease — visually similar at a glance, action paths differ). Confirmed corrosion.
- **T+0:52** — Risk-stratified gating moment. AI proposes splice-and-replace approach (medium risk: wrong wire cut bricks the bus). AI runs Rung 1 retrieval for build-date-specific wire colors — conflicting forum sources, budget exhausted. AI invokes Tech-Assisted Retrieval (Rung 2) for ProDemand wiring diagram. Marcus uploads diagram photo.
- **T+0:55** — AI extracts build-date-specific colors: K-CAN-H white/red pin 7, K-CAN-L white/brown pin 8. Confidence 96%. Risk-stratified gating cleared. Tech walks each cut verbally before making it; AI verifies each.
- **T+1:42** — Repair complete. Cabin drain unclogged (root cause of water intrusion). All modules respond on rescan; no codes; test drive normal.
- **T+1:48** — Outcome capture with AI-validated specificity. Marcus first attempt rejected; revised version provides connector location, vehicle area, water source, and specific repair steps. Corpus tags this as a NEW pattern (dual FRM+CAS dropout = JBE water intrusion, distinct from FRM-alone). Wire-color/build-date mapping stored as derived structured fact (legal boundary preserved).

**Design elements demonstrated:** describe-first throughout, vision invoked only at high-signal moments (scan screen, corrosion verification, wiring diagram), corpus-first retrieval with novel-pattern handling, Rung 1 with conflict surfacing, Tech-Assisted Retrieval (Rung 2) used twice gracefully, risk-stratified gating preventing a destructive action, build-date-specific knowledge captured as structured fact in corpus, legal boundary on artifact storage maintained.

---

## End of Spec

This document represents the locked design as of 2026-05-01. All open questions in §16 are tracked and must be resolved before or during implementation plan-writing. The implementation plan will be authored as a separate document and will reference this spec by section.
