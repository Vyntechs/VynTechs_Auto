# AutoEYE competitive intelligence + VynTechs diagnostic dominance thesis

Status: **INTERNAL STRATEGY DRAFT — not public claims, procurement approval,
or implementation authority.** Research snapshot: 2026-07-14. Vendor
capabilities below are vendor-reported unless an independent benchmark is
explicitly named.

## 1. Decision in one sentence

AutoEYE should not become another scan tool, service-manual search box, or AI
chat page. It should become the vendor-neutral **diagnostic intelligence API**
that turns every permitted vehicle signal, authoritative procedure, technician
observation, and verified repair outcome into one provenance-aware causal case
graph; VynTechs should be its first reference application through the living
repair order.

That makes the product relationship simple:

```text
vehicle + licensed information + technician evidence
                         │
                         ▼
             AutoEYE diagnostic intelligence API
       observe → normalize → reason → ask → verify → learn
                         │
                         ▼
            VynTechs living repair order / Shop OS
   intake → job → evidence → decision → quote → repair → proof
```

AutoEYE owns diagnostic truth and structured reasoning. VynTechs owns the
shop workflow, human decisions, customer communication, money, and durable
repair-order record. Each remains valuable without forcing the other into a
second user interface.

## 2. The current leaders to beat or connect

Threat and partner scores are directional, not purchasing decisions. `5` is
highest. “No public API found” means no suitable outward API appeared in the
official material reviewed; it is not a vendor confirmation.

| Company / product | What it is strongest at now | Strategic reading for AutoEYE + VynTechs | Threat | Partner |
| --- | --- | --- | ---: | ---: |
| [Repairify + Opus IVS](https://repairify.com/the-future-of-diagnostics/) (`asTech`, `BlueDriver`, `DrivePro`, `DrewTech`) | The broadest combined remote-OEM scan, programming, ADAS, local tool, and human master-technician network reviewed. The combination closed 2026-07-02. | **Largest platform threat.** Treat its transport, remote experts, and J2534 hardware as possible replaceable capabilities; never make its closed network AutoEYE's memory or reasoning core. | 5 | 4 |
| [FutureAI Olympus](https://www.futureai.com/olympus/docs) | The closest public architecture benchmark: live OEM-tool control, module/DTC/data triage, cited service evidence, an eight-phase diagnosis, physical-check gates, re-scan verification, VIN memory, and voice. Public material currently emphasizes Ford and Porsche rather than universal coverage. | **Closest diagnostic-intelligence threat.** Benchmark AutoEYE against its complete case loop, then win on neutral multi-tool support, rights-clean provenance, all-vehicle scope, living-RO integration, passive capture, and an outward structured API. | 5 | 2 |
| [Snap-on Fast-Track / SureTrack](https://www.snapon.com/EN/US/Diagnostics/Products/ZEUS-Plus) | Mature technician guidance, vehicle/code-specific data filtering, known-good measurements, functional tests, likely fixes, and a very large closed repair-history corpus. | **Data-moat benchmark.** Do not imitate a code-to-fix popularity engine. Build causal evidence, verified outcomes, and exportable provenance that remain useful across hardware. | 5 | 2 |
| [TEXA IDC6](https://www.texa.com/idc6-software/) | Broadest domain benchmark reviewed: car, truck, bike, off-highway, and marine, with AI search/guidance, remote diagnosis, PassThru, RP1210, DoIP, and CAN FD. | **Coverage benchmark and possible specialty connector.** AutoEYE's application matrix must ultimately be broader than “passenger car OBD.” | 5 | 4 |
| [Noregon JPRO / TripVision](https://www.noregon.com/jpro/whats-new/) | Commercial/on- and off-highway diagnostics, guided repair, remote predictive diagnostics, telematics integrations, and a documented Data Collector API. | **Best heavy-duty connection candidate.** Use it to accelerate evidence ingestion while AutoEYE owns cross-domain reasoning and the case graph. | 5 | 5 |
| [Bosch ADS](https://www.boschdiagnostics.com/ads-software) | Deep independent-shop scanning, bidirectional controls, J2534 programming, ADAS, topology, and integrated MOTOR information. | Strong local capability and content endpoint. Evaluate report/data access; do not depend on a closed Bosch-only reasoning path. | 4 | 3 |
| [Autel Ultra / Remote Expert](https://store.autel.com/products/maxisys-ultra-s2) | Dense measurement endpoint: scan topology, bidirectional tests, J2534, scope, meter, waveform generator, CAN testing, ADAS, and remote expertise. | High-value evidence endpoint if commercial integration is available. Normalize outputs into AutoEYE rather than reproducing its hardware. | 4 | 4 |
| [LAUNCH SmartLink](https://launchtechusa.com/product/torque-link/) | Broad multi-brand local/remote diagnosis, J2534, PassThru, third-party-capable remote transport, and optional HD/EV/ADAS coverage. | Candidate transport and fallback route. Validate exact vehicle/application coverage and data rights before commitment. | 4 | 4 |
| [Revv](https://www.revvhq.com/features/estimating-integrations) | ADAS/collision requirements, VIN/as-built and estimate-line analysis, calibration workflow, evidence, reimbursement, and broad estimating integrations. | Best adjacent ADAS workflow partner/benchmark; not a substitute for full causal diagnosis. VynTechs can consume its determinations inside the same RO. | 4 | 5 |
| [Predii](https://www.predii.com/) | Automotive-specific data normalization, repair intelligence, ontology, and enterprise/API posture over large repair datasets. | Evaluate as an enrichment/normalization partner and benchmark its ontology. AutoEYE must retain ownership of its evidence graph, learning policy, and technician loop. | 4 | 4 |
| [Sonatus](https://www.sonatus.com/products/vehicle-platform/) | OEM-side software-defined vehicle data collection, automation, edge/cloud processing, and proactive diagnostic workflows. | **Future OEM threat and connection model.** Design for native vehicle agents and fleet telemetry before aftermarket scan tools stop being the only doorway. | 4 | 4 |
| [Fullbay + Pitstop](https://www.fullbay.com/blog/fullbay-acquires-pitstop-to-strengthen-ai-powered-fleet-intelligence-through-predictive-maintenance/) | Shop workflow joined with predictive maintenance for heavy-duty fleets. | Closest adjacent “Shop OS + prediction” pattern. VynTechs should win by joining causal diagnosis, repair truth, and customer operations rather than prediction alone. | 4 | 3 |

Second-ring watch list: [AirPro](https://airprodiagnostics.com/services/),
[TOPDON](https://www.topdon.us/collections/diagnostic-tools),
[THINKCAR](https://thinkcarus.com/), Sensigo, Ubiquiti Intelligent
Diagnostics, Jayda AI, Wrench, Diagniso, OnRamp, Repair.AI, Auto Triage, and
DiagTech.AI. These should be rescored quarterly; their public maturity and
integration posture are uneven.

## 3. What VynTechs should connect, license, and own

The winning stack is layered. A vendor can be replaced without losing the
case, the reasoning trace, the shop workflow, or the outcome history.

| Layer | Recommended candidates | VynTechs / AutoEYE posture |
| --- | --- | --- |
| Vehicle identity and configuration | [NHTSA vPIC](https://vpic.nhtsa.dot.gov/api/), Auto Care ACES + VCdb | License/use identifiers and normalized configuration. Preserve the source and version of every resolved fact. |
| North American service information | [MOTOR Data as a Service](https://www.motor.com/products/data-as-a-service/), MOTOR TruSpeed; [ALLDATA Connect](https://www.alldata.com/us/en/connect) as a secondary path | **License authoritative content; do not copy it into an owned corpus by assumption.** Negotiate API, excerpts, cache/offline, retention, derived-graph, embedding/RAG, training, termination, and downstream-display rights explicitly. |
| Global service information | [Autodata](https://www.autodata-group.com/), [HaynesPro](https://haynespro.com/), [TecRMI](https://www.tecalliance.net/solution/tecrmi) | Add by market and vehicle domain. Keep the retrieval adapter replaceable and preserve territory/licensing rules. |
| Live light-duty vehicle connection | SAE J2534 through DrewTech/Opus and compatible Bosch/Autel/LAUNCH hardware; UDS, DoIP, CAN/CAN FD | Own a normalized evidence contract above transport. An API/protocol permits connection; it does not grant OEM content or reuse rights. |
| Heavy/off-highway connection | Noregon/JPRO, RP1210, TEXA | Start with a partner API where possible while building the same AutoEYE evidence envelope across domains. |
| Connected vehicle/fleet data | Smartcar and Motorq in North America; High Mobility in Europe; direct OEM programs later | Treat as consented evidence streams, not diagnostic truth by themselves. Record sampling, latency, units, and source limitations. |
| Secure functions | NASTF and AutoAuth in North America; SERMI in Europe | Keep identity, authorization, audit, and human approval outside model discretion. Access is not permission to retain or republish content. |
| Visual inspection | [UVeye](https://uveye.com/dealerships/), [Tchek](https://www.tchek.ai/solution/inspection), Ravin AI, ProovStation, Monk AI, Anyline | Normalize observations and original media provenance. Never let image confidence silently become a repair authorization. |
| Battery/EV health | [AVILOO](https://aviloo.com/en-us/), [TWAICE](https://www.twaice.com/products/ev-battery-analytics/health) | Add battery state/health evidence and test conditions to the same topology/case graph. |
| Acoustic/NVH | [IAV SonicSeek](https://www.iav.com/products-and-services/iav-sonicseek/) plus future phone/tool microphones and vibration sensors | Build multimodal evidence capture now; partner for specialist classifiers where they outperform. |
| Future native diagnostics | [ISO 17978-3:2026 SOVD](https://www.iso.org/standard/86587.html), [Eclipse OpenSOVD](https://metrics.eclipse.org/projects/automotive.opensovd/), COVESA VSS | Make SOVD/REST/JSON and vehicle-native agents first-class adapter targets. AutoEYE's core objects must not assume OBD/J2534 forever. |

### Commercial-rights rule

Right-to-repair access, a technician subscription, an API, a protocol, and
permission to display information are five different rights. No partner is
approved until contracts answer:

- exact YMME/domain/territory coverage and update latency;
- API, SSO, bulk, sandbox, rate limits, and deprecation/SLA terms;
- cache, offline, retention, deletion, and post-termination behavior;
- excerpts, attribution, customer display, and technician-facing citations;
- derived graphs, embeddings/RAG, model training/evaluation, and feedback use;
- ownership of technician observations and verified repair outcomes;
- anonymization, aggregation, multi-tenant use, sublicensing, and downstream
  API rights; and
- security access, consent, audit, incident, and pricing obligations.

## 4. The product that can stay years ahead

“Years ahead” cannot be guaranteed by a feature list. It comes from a system
whose evidence and learning compound faster than competitors can copy its UI.
AutoEYE therefore needs twelve owned capabilities.

1. **Universal Vehicle Graph.** A versioned topology of systems, components,
   signals, energy/material flows, dependencies, locations, configuration,
   and known unknowns across light duty, EV/hybrid, heavy duty, off-highway,
   agriculture, construction, powersports, and marine.
2. **Rights-clean Evidence Fabric.** DTCs, freeze-frame, live PIDs, network
   traffic, waveforms, actuator results, photos/video, thermal, audio,
   vibration, battery tests, telemetry, licensed procedure references,
   technician observations, and repair outcomes share one typed envelope with
   source, time, units, conditions, rights, and confidence.
3. **Causal Case Graph.** Evidence supports or contradicts hypotheses and
   components; it is not flattened into a chat transcript or “most commonly
   replaced part.” Conflicts and unknowns stay visible.
4. **Next-Best-Test Engine.** Rank the next safe action by expected
   information gain, technician effort, bay time, tool availability, cost,
   risk, and reversibility. The target is fewer decisive tests, not more AI
   words.
5. **Ambient Capture.** Scanner imports, RO events, voice notes, photos,
   measurements, parts decisions, and post-repair results enter the case from
   work technicians already do. If a technician never opens AutoEYE, the job
   still works and the shop still retains permitted structured evidence.
6. **Closed-Loop Proof.** Every recommendation has a pre-repair basis, human
   verification gate, repair action, post-repair test, and outcome. Comebacks
   reopen the same causal thread instead of becoming unrelated tickets.
7. **Separated Memory.** VIN memory, shop memory, fleet memory, and aggregated
   model learning have explicit consent, retention, access, and provenance
   boundaries. A part replacement is never labeled a successful diagnosis
   without verification.
8. **Replaceable Capability Router.** AutoEYE chooses among available local
   tools, OEM applications, service-information sources, specialist sensors,
   and remote experts. No vendor owns the canonical case.
9. **Structured Diagnostic API.** Return typed evidence, hypotheses,
   contradictions, next tests, safety gates, citations, unknowns, repair
   candidates, verification requirements, and machine-readable state—not only
   prose.
10. **Human Consequence Gates.** Models may recommend; authenticated humans
    authorize programming, security functions, actuation, repair scope,
    spending, customer claims, and vehicle release. Safe degradation works
    when models, content, networks, or tools fail.
11. **All-Concern Router.** Symptom diagnosis, DTC/warning light, inspection,
    preventive maintenance, known repair, accessory/customer-supplied-part
    installation, recall/campaign, calibration/programming, collision,
    compliance, and “no fault found” start in the same job spine but invoke
    only the evidence and gates they actually require.
12. **Continuous Benchmark Harness.** A versioned, rights-clean case suite
    measures coverage, root-cause accuracy, decisive tests, time to proof,
    unsafe actions, unnecessary parts, citation validity, technician burden,
    post-repair verification, and comeback rate against current leaders every
    quarter.

The defensible moat is the combination of `1 + 2 + 3 + 5 + 6`: a universal
topology, provenance-aware multimodal evidence, causal reasoning, effortless
capture, and verified outcomes. Any model, scan tool, or content vendor can
then improve without replacing AutoEYE.

## 5. The no-technician-pain contract

AutoEYE is headless by default. VynTechs exposes it inside the existing living
repair order as one contextual action and an expandable evidence/next-test
surface—not as a new destination technicians must manage.

### Diagnostic add-on enabled

`Start diagnosis` opens the next useful step in place. Evidence and decisions
write back to the same job, `customerStory`, and quote-line path.

### Diagnostic add-on disabled

The same slot becomes `Record findings`. The technician completes work
normally; no dead tab, forced sales page, blocked quote, or duplicate entry.

### Technician uses their own diagnostic process

Never force them to replay the diagnosis for the AI. Capture permitted scan
reports, measurements, voice/photos, parts/actions, and post-repair proof from
normal workflow. Offer a quiet “organize what I captured” action afterward.
Missing evidence remains missing; the system must not invent it.

### Work that does not need diagnosis

A customer-supplied lift-kit install remains an installation job. AutoEYE may
surface applicable safety/configuration checks—fitment, fastener/torque source,
alignment, ride-height effects, ADAS calibration, headlamp aim, road-test and
release proof—but it does not manufacture a diagnostic session. The same
principle applies to maintenance, tires, accessories, known repairs, recalls,
and requested programming.

### Mobile and desktop

- Mobile: one next action, voice/photo/scan capture, thumb-reachable controls,
  resumable state, and no topology canvas required to move the job forward.
- Desktop/tablet: the same case expands into topology, evidence comparison,
  waveform/live-data review, and citations without becoming a separate
  workflow.
- Both: the repair order is the durable location; device changes never create
  a second case or require a technician to restate context.

## 6. Structured API north star

The current deterministic AutoEYE `fact_export_v1` is a good input contract,
not the finished intelligence API. The long-lived API should converge on
objects like:

```text
VehicleApplication
Concern
DiagnosticCase
SystemTopology
EvidenceItem
Hypothesis
TestAction
SafetyGate
SourceCitation
RepairCandidate
VerificationResult
Outcome
OpenQuestion
```

Every object needs stable IDs, schema/version, tenant and case scope,
provenance, rights/use class, created/observed time, author/collector,
confidence, and supersession history. Natural-language explanations are
renderings of those objects, never the only durable truth.

Initial integration operations should be intentionally small:

```text
POST /v1/cases                     create or resume an idempotent case
POST /v1/cases/{id}/evidence       append typed evidence
GET  /v1/cases/{id}/topology       read the relevant system slice
POST /v1/cases/{id}/next-test      rank the next permitted action
POST /v1/cases/{id}/decision       record the authenticated human decision
POST /v1/cases/{id}/verification   close or reopen the causal loop
GET  /v1/cases/{id}/summary        return structured customer/shop renderings
```

This is a design target only. Authentication, tenancy, retention, metering,
licensing, and safety contracts require their own approved implementation
design before an endpoint ships.

## 7. Sequenced market path

### Now — prove the wedge

1. Finish the per-shop entitlement seam without changing existing-customer
   access or diagnostic-engine semantics.
2. Treat `fact_export_v1` as the first read-only AutoEYE adapter and preserve
   promoted, owner-reviewed provenance.
3. Define the minimal structured `DiagnosticCase` / `EvidenceItem` /
   `TestAction` / `VerificationResult` contract.
4. Run licensing diligence with MOTOR first; keep ALLDATA and a global source
   as alternatives. No ingestion assumption precedes contract rights.
5. Import common scan reports and normal VynTechs job evidence before chasing
   direct control of every tool.
6. Build a 50–100-case rights-clean benchmark spanning no-code symptoms,
   network faults, electrical, drivability, ADAS, EV/battery, NVH, heavy duty,
   intermittent, prior-repair/comeback, and non-diagnostic work.
7. Benchmark FutureAI Olympus, Snap-on, TEXA, and the Repairify/Opus workflow
   using observable public/product behavior—never marketing claims alone.

### Next — own the evidence loop

1. Add J2534/DoIP/UDS and RP1210/Noregon adapters behind the same contract.
2. Add guided electrical/waveform, photo/thermal, acoustic/vibration, and
   battery-health evidence without creating separate technician apps.
3. Add authenticated remote-expert escalation as one routed test/action; the
   expert's evidence and result return to the same case.
4. Learn only from verified outcomes with clear shop/VIN/global boundaries.
5. Expand service-information coverage by territory and vehicle domain.

### Horizon — lead the native-vehicle era

1. Implement SOVD/OpenSOVD and COVESA-compatible adapters.
2. Support consented continuous/fleet telemetry and predictive case opening.
3. Run selected models at the edge for privacy, latency, and offline safety.
4. Let AutoEYE serve VynTechs and external customers through the same versioned
   API without leaking one shop's data, licensed content, or competitive
   learning into another.

## 8. Scorecard that prevents self-deception

Review monthly during build and quarterly against competitors:

| Outcome | Core measure |
| --- | --- |
| Coverage | % of target vehicle applications, systems, concern classes, and required evidence types with an honest supported/unsupported answer |
| Technician effort | Median required taps/typed fields and minutes of duplicate entry per case |
| Diagnostic quality | Verified root cause, calibrated confidence, contradiction handling, and unsafe-action rate |
| Efficiency | Decisive tests, bay time to proof, unnecessary parts avoided, remote-expert escalations |
| Evidence integrity | Provenance completeness, citation validity, units/test conditions, unknowns preserved |
| Repair quality | Post-repair verification completion, first-time fix, comeback/reopen rate |
| Platform resilience | Provider replacement time, offline/failure behavior, adapter conformance |
| Learning quality | % of training/evaluation cases with verified outcomes and permitted-use provenance |

No “AI diagnosis completed” metric counts unless physical evidence and
post-repair verification support it.

## 9. Hard boundaries

- No scraped/copied OEM manual corpus, hidden copyrighted procedure store, or
  partner data repurposed beyond contract rights.
- No public “more accurate,” “all vehicles,” autonomous, safety, or
  years-ahead claim without an independently defensible benchmark and legal
  review.
- No model-authorized programming, security access, vehicle actuation, repair,
  spend, customer promise, or release.
- No single vendor's IDs, ontology, hardware, or prose becomes AutoEYE's
  canonical diagnostic state.
- No forced AutoEYE flow for technicians or jobs that do not need it.
- No learning signal from “part replaced” unless the repair was verified.

## 10. Research basis and known gaps

Primary/vendor sources used include the linked official pages above plus
[Opus DrivePro 2](https://opusivs.com/drivepro-2/),
[asTech All-In-One](https://www.astech.com/products/aio),
[Noregon Data Collector integrations](https://www.noregon.com/wp-content/uploads/2025/05/Readme-RPS-On-Hwy-Coverage-050625.pdf),
[FutureAI Olympus CLI](https://www.futureai.com/olympus/cli),
[Bosch predictive diagnostics](https://www.bosch-mobility.com/en/solutions/diagnostics/predictive-diagnostics/),
[AVILOO testing distinctions](https://aviloo.com/en-us/read-out-vs-testing),
and [Microsoft/KPIT Trace2Fix](https://www.microsoft.com/en-us/microsoft-cloud/blog/mobility/2024/08/14/accelerating-the-automotive-sector-with-mobility-copilots/).

Still required before build/procurement claims: hands-on diagnostic accuracy
benchmarks, exact private API access, samples/sandboxes, YMME coverage files,
contract and content-rights review, security/privacy review, pricing, vendor
solvency/support review, and reference-customer calls.
