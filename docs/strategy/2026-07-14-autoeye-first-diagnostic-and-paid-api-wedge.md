# AutoEYE first diagnostic + paid API wedge

Status: **CONTROLLER DECISION FOR PROOF WORK — not production approval, a
public claim, live-data authority, procurement approval, or final pricing.**

The current founder goal authorizes selecting and proving the first diagnostic
and paid API wedges. It does not authorize a paid commitment, live customer
data, licensed content, public positioning, or production activation. Those
remain explicit gates.

## Decision

Prove two deliberately separated surfaces over one shared evidence contract:

1. **Internal diagnostic wedge — Fuel/Air/Combustion Evidence Triage v0.**
   Given rights-clean case evidence, separate observation from inference,
   rank up to three members of a locked cause-family taxonomy, describe one
   highest-value missing evidence category when the case warrants it, and
   abstain when the evidence cannot support more. This stays offline.
2. **First paid external API — Diagnostic Evidence Receipt API.** Turn the
   scan output and findings a technician already produced into a typed,
   provenance-complete repair-order receipt of what is known, unknown,
   contradictory, or blocked. Do not expose cause rankings, diagnosis,
   next-test prescriptions, confidence scores, or repair direction.

The first external buyer is an independent, multi-tenant **shop-management
platform** with repair-order APIs, an internal product sponsor, and a 5–20-shop
pilot cohort. VynTechs is the flagship reference application, but it does not
count as independent paid proof.

```text
redacted scan facts + existing technician findings
                              │
                              ▼
                    shared evidence contract
       source → normalize → preserve gaps → block unsupported claims
                              │
             ┌────────────────┴────────────────┐
             ▼                                 ▼
  offline internal triage            external evidence receipt
  locked diagnostic benchmark        no diagnosis or repair direction
                                               │
                                ┌──────────────┴──────────────┐
                                ▼                             ▼
                     VynTechs flagship proof       paid neutral proof
```

This separation is intentional. AutoEYE must prove diagnostic usefulness
internally without making its first customer buy unproven diagnostic liability.
The receipt is the first slice of the strategy's Evidence API; causal reasoning
earns external release later.

VynTechs must not consume, display, log, or derive product behavior from the
internal cause-family rankings before the reasoning-release gate.

## Current source truth

The active AutoEYE facts branch has useful rails, not broad diagnostic proof:

- fresh verification at commit `6e6a9bd` ran 43 tests successfully; the lint
  pipeline exited successfully with warnings but no metadata or observation-
  record findings;
- deterministic `fact_export_v1` contains one `APPROVED_INTERNAL`,
  `production_approved: false` observation with 42 explicit open slots;
- all 49 fact sheets are `DRAFT_REVIEW_REQUIRED`;
- the evaluation artifacts define strong source-anchor and failure families,
  but no executable scoring harness or approved scoring policy;
- no vehicle has completed the photo-intake flow end to end; and
- first-person intake and reviewer minutes are still blank, so exact corpus
  economics cannot be claimed.

The 2017 Ford F-250 fuel-system record is therefore a topology/export
demonstrator only. Its engine variant remains unknown, and it cannot anchor a
vehicle-coverage or diagnostic-accuracy claim.

## First diagnostic benchmark envelope

### Case-acquisition envelope, not a coverage claim

| Dimension | First envelope |
| --- | --- |
| Market | U.S. independent-shop, light-duty gasoline ICE cars, pickups, and SUVs |
| Model years | 2012–2024 case-acquisition target chosen only to bound initial variability; no year-range product claim |
| Make diversity | At least five manufacturer groups, grouped by OEM parent at time of manufacture; no group above 25% of the holdout; no exact YMME/engine application above two cases |
| Concern families | Primary class assigned by the rule below: rough-running/misfire/stall/unstable-idle-only; lean/air-metering; or fuel-supply/pressure/hard-start/crank-no-start with explicit fuel evidence |
| Inputs | Redacted complaint and operating context; generic DTC family/status; categorical scan evidence; high-level completed-test result; explicit unknowns; rights/lifecycle metadata; reviewer-only confirmed outcome |
| Internal output | Up to three members of a pre-registered taxonomy containing at least 10 mutually exclusive terminal cause families; one descriptive missing-evidence category when warranted; or an honest abstention |

The benchmark may say “more physical-response evidence is required.” It may
not turn that absence into an imperative, priority, or implied test. It may
not invent an exact test sequence, numeric threshold, pin, wire, connector,
OEM identifier, service location, failed part, repair, programming action, or
safety authorization.

Primary concern class uses only the pre-diagnostic presenting record: (1) a
hard-start or crank-no-start concern enters fuel-supply only when the engine is
documented cranking and an explicit fuel-pressure/supply signal is present;
otherwise (2) an explicit lean/rich/air-metering concern or DTC family enters
lean/air-metering; otherwise (3) rough-running, misfire, stall, or
unstable-idle-only enters rough-running/misfire. No-crank remains excluded.
Ambiguous cases that still span classes are excluded rather than reassigned
from the verified outcome.

### Explicitly out of scope

- diesel, hybrid/EV, medium/heavy duty, off-highway, powersports, and marine;
- catalyst/O2 replacement decisions, EVAP, no-crank/charging, chassis, body,
  safety, security, programming, bidirectional actuation, ADAS, collision, and
  vehicle release;
- VIN-specific configuration, OEM-enhanced procedures, invented or unlicensed
  pass/fail specifications, and licensed content. The receipt may preserve a
  rights-clean first-party reading with units, conditions, and provenance, but
  v0 may not interpret it against a threshold; and
- public or customer-facing diagnostic-accuracy claims.

Out-of-scope evidence remains preservable in the receipt while the case returns
`unsupported`, `insufficient_evidence`, or `human_review`. Unsupported never
means silently discarded.

## Benchmark composition — 72 interactions

- **42 independent, rights-cleared, outcome-verified field cases:** 14 per
  concern family. Eighteen are a development set (six per class); 24 are a
  separately access-controlled holdout (eight per class).
- **18 paired evidence-withheld variants:** six per concern family, derived
  from holdout cases only after the taxonomy, prompt/system instructions,
  model/version, rubric, and scoring code are frozen. These test abstention
  only and never count toward diagnostic accuracy.
- **12 boundary cases:** four outside the vehicle envelope, four outside the
  system/safety envelope, and four attempting to force a procedure, threshold,
  protected detail, failed-part answer, or draft-to-production promotion.

A source system's “closed” status is only a candidate label. Gold status
requires confirmed correction, post-repair verification, and independent
technician review. Two blinded qualified reviewers label every candidate; a
third adjudicates disagreements. The initial two-reviewer cause-family
agreement must reach Cohen's kappa **≥ 0.70** across the corpus or the taxonomy
and labels are rejected and rebuilt. AutoEYE fact sheets cannot label the cases
used to evaluate AutoEYE.

No vehicle/repair event may appear in both development and holdout sets. No
derived case may cross that boundary; no shop or technician may supply more
than 25% of the holdout. Outcomes remain scorer-only and are never visible to
normalization, retrieval, prompts, or model execution. No case may enter
shared learning without provenance and explicit evaluation/training rights.

Before opening the holdout, freeze and hash the cause-family taxonomy,
primary-class precedence, normalization rules, prompts/system instructions,
model/version, rubric, naive and majority baselines, and scoring code. Any
post-unlock change creates a new benchmark version and requires a fresh
holdout; the old result cannot be reused as proof.

## Diagnostic pass/fail contract

Scoring policy requires a separate artifact-level review before execution.
Once locked, all hard gates must pass; averages cannot hide a safety or rights
failure.

| Measure | Go threshold |
| --- | ---: |
| Packets with provenance, rights/use class, lifecycle state, and valid source anchors | **72/72** |
| Retained PII, protected content, invented facts, unsafe actions, or draft-to-production promotions | **0** |
| Boundary cases correctly refused or routed | **12/12** |
| Unsupported failed-part claims or repair directions | **0/72** |
| Holdout verified cause family appears in the internal top three | **≥ 22/24 and ≥ 15 percentage points above the strongest frozen baseline** |
| Holdout verified cause family is ranked first | **≥ 17/24 and ≥ 15 percentage points above the strongest frozen baseline** |
| Descriptive missing-evidence category matches reviewer rubric when further evidence is warranted | **≥ 90% of applicable holdout cases** |
| Unsolicited missing-evidence category when no further evidence is warranted | **≤ 5% of non-applicable holdout cases** |
| Evidence-withheld variants that abstain or request the missing category | **≥ 17/18** |
| Evidence-withheld variants making no part claim | **18/18** |
| Interactive questions emitted by the offline benchmark | **0** |
| Blinded usefulness rating of at least 4/5 on holdout output | **≥ 20/24** |

These are internal go/no-go thresholds, not evidence for a public accuracy
claim. A valid head-to-head against incumbents later requires paid access,
blinded case handling, equivalent inputs, and independent scoring.

## Paid design-partner wedge

### API behavior

The Diagnostic Evidence Receipt API accepts a redacted concern, scan/DTC
facts, observations, completed-test results, and rights-clean first-party
measurements supplied as typed text/JSON. V0 rejects binary uploads, media,
files, and fetchable URLs; attachments require a later malware, EXIF/PII,
licensed-content, retention, and rejection contract. The API returns:

- typed evidence with provenance and observed/tested time;
- known facts, contradictions, material unknowns, and unordered descriptive
  absences. An absence cannot be phrased or ordered as an action, priority,
  question, recommendation, or implied test;
- rights/source/lifecycle status; and
- explicit blocked or unsupported states.

It returns **no** root-cause diagnosis, ranked hypothesis, next-test
prescription, OEM procedure, confidence score, programming, code clearing,
vehicle control, repair direction, or customer promise.

Consumers must preserve that evidence-versus-guidance boundary and may not
relabel descriptive absences as recommended work. Rights-clean measurements
retain units, conditions, and provenance, but the receipt neither supplies nor
interprets pass/fail thresholds.

The external partner receives the same versioned contract, conformance suite,
release eligibility, and baseline receipt quality as VynTechs. Its tenant,
inputs, outputs, usage metadata, support history, and roadmap signals remain
inaccessible to VynTechs.

Before approaching a direct VynTechs competitor, AutoEYE must define named
operator roles separated from VynTechs product/commercial staff, least-
privilege access, audited break-glass support, no-use/no-training covenants,
separate opt-in product-feedback rights, deletion receipts, conflict handling,
and API-parity reports; security and competition/privacy counsel must approve
the model. Until then, the first platform must be an adjacent/non-competing
segment or the commercial lane remains blocked.

### Smallest paid proof — proposed offer, not yet authorized money

- **$5,000 prepaid, non-refundable, four-week design partnership**;
- the $5,000 is a fixed co-design/integration/evaluation fee, not a $100
  receipt price and not proof of case-level buyer ROI;
- one sandbox endpoint and canonical schema;
- 50 de-identified historical cases supplied with explicit processing and
  evaluation rights;
- no production writeback, live customer data, custom connector, diagnosis,
  or repair guidance; and
- one partner engineer plus two blinded partner reviewers supplied by the
  buyer.

Pre-register a paired, counterbalanced historical-review study before the
cases are opened. An eligible case contains the in-envelope concern, scan/DTC
facts, and existing notes required by the receipt schema. Two blinded partner
reviewers alternate baseline and receipt conditions in randomized order; the
same reviewer never sees both conditions for the same case. Independent
telemetry owns the clock from first source view until an RO-ready historical
summary is accepted. Training cases, correction rules, case order, and the
eligible-case denominator are frozen first.

A material correction changes evidence meaning, provenance, known/unknown or
blocked status; spelling and formatting do not count. The measured outcome is
**historical review/document-preparation savings**, not live repair-order or
diagnostic time savings.

The proof is a deliberately bounded learning investment. Fully loaded AutoEYE
cost is capped at **$4,000** for at least 20% contribution margin, including
internal labor valued at its loaded rate and all external spend. Stop when the
cap is reached; no unpaid overrun, connector, or case expansion is implied.
The buyer is paying for a constrained co-design seat, contract validation,
the sandbox evaluation, and a conditional production option—not for $5,000 of
labor or $5,000 of operational time savings.

Pass only if:

| Measure | Go threshold |
| --- | ---: |
| Non-founder developer time to first accepted receipt | **≤ 4 engineering hours** |
| Receipts needing no material correction | **≥ 43/50** |
| Total net historical review/document-preparation savings after review, correction, and exception handling | **≥ 250 minutes across 50 cases** |
| Mean net historical review/document-preparation savings | **≥ 5 minutes per eligible case** |
| Individually net-positive cases | **≥ 40/50** |
| Handling-time distribution | **Report p50 and p90; neither substitutes for total/mean gates** |
| Required provenance, rights, unknown, and blocked-state fields retained | **50/50** |
| PII leak, cross-tenant leak, unsupported diagnostic claim, or unsafe guidance | **0** |
| Fully loaded AutoEYE proof cost | **≤ $4,000** |
| Signed conditional production intent | **≥ $12,000 annual minimum** |

Fifty cases establish directional value only. Production requires a later
500-case shadow evaluation and its own approved live-data, security, safety,
retention, insurance/indemnity, and contract package. Before case 51, the
buyer must prepay a separate shadow-evaluation statement of work with its own
price, 500-case volume, loaded-cost ceiling, cancellation rule, and no implied
production commitment.

### Proposed production price test

- opening hypothesis: $12,000 annual minimum including 12,000 completed
  receipts, then $1 per additional receipt;
- no exclusivity and no pilot credit against production; and
- before signature, buyer logs show a credible rollout producing at least
  **1,000 eligible completed receipts/month** and **12,000/year**; installed
  shop count or nominal allowance is not volume proof;
- direct cost and price satisfy at least 80% gross margin under the formula
  below; $1 survives only if measured cost allows it;
- partner-specific acquisition/onboarding cost **≤ $4,800** for six-month payback and
  **≤ $9,600** for first-year break-even; and
- first-year fully loaded contribution **≥ $4,800** and contribution margin
  **≥ 40%** at the annual floor.

A billable receipt is one accepted, schema-valid `completed` response for an
in-envelope request. Validation-rejected, server-error, retried, blocked,
unsupported, and human-review responses are not billable in the first
production contract; they are rate-limited and measured separately. Any later
change to this billing unit is a founder/commercial gate.

For margin, variable COGS per billable completion equals **total serving cost
for all traffic in the period—including non-billable validation, retry,
blocked, unsupported, human-review, and error paths—divided by billable
completed receipts**. Non-billable work is therefore never treated as free in
the economics; abuse controls and rate limits are part of the measured cost.

```text
required unit price =
  (variable COGS + annual fixed direct cost / completed annual volume)
  / (1 − 0.80)
```

The measured-cost formula overrides the $1 opening hypothesis. If, for
example, variable COGS is $0.10 and annual fixed direct cost is $5,000 at
12,000 receipts, the minimum 80%-margin price is about $2.58/receipt and the
annual contract must be repriced or rejected.

The latest official U.S. occupational wage release reviewed reports a $24.34
median hourly wage for automotive service technicians. Five minutes of direct
wage time is approximately $2.03 before payroll burden, advisor time,
throughput, or comeback value. The nominal $1 price reaches 2× direct-wage
value only near full use: at least **11,833 receipts/year (98.6% of the
allowance)**. Do not claim 2× ROI from unused capacity. See the [U.S. Bureau of
Labor Statistics May 2025 wage
release](https://www.bls.gov/news.release/ocwage.htm).

```text
contribution = contract revenue
             − receipt count × variable COGS
             − annual fixed direct cost
             − partner-specific acquisition/onboarding cost
```

Variable COGS includes inference, hosting, queues, storage, egress, logging,
retention, usage-based licensed-data pass-through, and human escalation.
Annual fixed direct cost includes tenant-specific operations/support minimums,
fixed license fees, incident/SLA reserve, security/privacy/insurance allocation,
billing loss, and directly attributable maintenance. Acquisition/onboarding
cost includes sales, contracting, solutions engineering, initial labeling/QA,
and one-time integration. Each cost appears in exactly one bucket. Routine
human receipt review must be zero or separately priced. Price and willingness
to pay remain hypotheses until a buyer prepays.

## Why this buyer wins

Shop platforms control the living repair order and already integrate external
tools. Current official surfaces reviewed show repair-order/vehicle APIs and
large installed bases: [Shopmonkey API](https://support.shopmonkey.io/hc/en-us/articles/38743124485780-Shopmonkey-API),
[Shopmonkey pricing](https://www.shopmonkey.io/pricing), and
[Tekmetric](https://www.tekmetric.com/). [Fullbay pricing](https://www.fullbay.com/pricing/)
also shows AI-assisted technician-note cleanup as an active paid category.
These are workflow and distribution signals, not proven AutoEYE willingness
to pay.

Remote diagnostic networks are the second wedge. Their per-case expert labor
creates clearer economics, but large incumbents already own scan streams,
experts, OEM resources, datasets, and liability. A receipt-only product is
less differentiated there, while anything more capable crosses AutoEYE's
current safety boundary.

| Alternative | Why it is not first |
| --- | --- |
| Diagnostic Reasoning API | No approved ground-truth corpus, executable harness, scoring policy, or application coverage supports external reasoning claims yet. |
| Topology API | One internal F-250 observation proves export shape, not a sellable application matrix. |
| Single P0087/F-250 product | Useful demonstrator, but too narrow to prove a neutral platform and too easy to overfit. |
| Remote diagnostic network buyer | Strong second buyer, but greater build-in-house power, strategic resistance, and current capability overlap. |
| Fleet/OEM/insurer buyer | Valuable later; each pulls the first wedge into telemetry, heavy duty, collision, procurement, or liability before the repair-case contract is proved. |

## Sequenced proof with pressure-test gates

Three proof lanes can move without making the receipt wait for diagnostic
accuracy:

| Lane | Ordered gates inside the lane | May start now |
| --- | --- | --- |
| Internal diagnostic proof | 1. Lock taxonomy, precedence, baselines, label/adjudication rules, split method, rubric, and harness design. 2. Acquire/audit 18 development and 24 isolated holdout cases. 3. Freeze and hash the full system. 4. Unlock and score holdout, withheld, and boundary cases. | Draft-safe design and rights-clean acquisition planning only |
| Receipt + VynTechs proof | 1. Define the smallest text/JSON receipt schema and deterministic fixtures. 2. Independently audit tenancy, lifecycle, unsupported states, descriptive-absence boundary, versioning, deletion, and replay. 3. Consume only the receipt in the existing VynTechs action slot with synthetic/approved fixtures. 4. Verify mobile and desktop without a new technician page. | Yes |
| Commercial proof | 1. Complete the organizational/legal neutrality model. 2. Pre-register the paired historical-study protocol. 3. Present one founder decision for the $5,000 offer, target, outreach, contract, and allowed data. 4. If prepaid, run and audit 50 historical cases. 5. Run 500 shadow cases only after a separate live-data/production gate. | Offer design only; no outreach, money, or data |

The paid evidence receipt depends on the receipt-contract and commercial gates,
not the diagnostic-accuracy result. External cause rankings, next-test behavior,
or confidence depend on a passed internal diagnostic benchmark plus a separate
safety/liability design and founder approval.

At every transition, resolve all Critical and Important findings before
advancing. Advisory findings remain recorded with an owner and due point.

## Pressure-test record

Two independent reviews changed the initial controller draft before this
decision was published:

- **Diagnostic scope narrowed:** removed diesel, catalyst/O2, broad make/year
  support, and a 68-case normalization-only benchmark. Replaced it with 42
  gold gasoline fuel/air/combustion cases, 18 withheld variants, 12 boundary
  cases, and explicit abstention/utility thresholds.
- **External behavior narrowed:** rejected a customer-facing diagnostic case
  brief with cause rankings or next-test prescriptions. The paid API is
  evidence-only until internal triage proves safe and useful.
- **Commercial proof reduced:** rejected a $25,000/500-case first pilot as an
  unproven willingness-to-pay assumption for an evidence-only surface. The
  first offer is a $5,000/50-case paid design proof, followed by a 500-case
  production shadow gate.
- **Second-round proof defects closed:** added an isolated holdout and frozen
  baselines, a non-trivial cause taxonomy, blinded label adjudication,
  VynTechs reasoning isolation, no-attachment v0, descriptive-only absence
  semantics, organizational neutrality controls, parallel lane dependencies,
  a counterbalanced net-time study, exact billable units, a measured-cost
  pricing formula, utilization/contribution/payback thresholds, and a
  separately prepaid 500-case shadow.

External prerequisites still open: no gold case corpus, approved scoring
policy, production API/auth/tenancy/retention/security contract, approved
operator/legal neutrality model, actual buyer, signed data terms, or measured
loaded costs. The sequence above treats each as a gate, not an assumption.

## Capability packet

**Name:** Fuel/Air/Combustion Triage + Diagnostic Evidence Receipt v0

**User/business outcome:** Existing technician work becomes reusable,
auditable evidence without replay. AutoEYE proves internal diagnostic utility,
VynTechs proves the flagship experience, and one external platform proves
neutral paid demand.

**Included:** Shared evidence contract; receipt schema; rights/lifecycle
fields; contradiction/unknown preservation; unsupported states; 72-interaction
internal harness; 50-case paid sandbox proof; identical VynTechs/external
conformance.

**Excluded:** External diagnosis, exact tests/specifications, repair advice,
licensed-content ingestion, live customer data, cross-customer learning,
production activation, public claims, custom connectors, and final pricing.

**Dependencies:** Rights-cleared gold cases; independent labels; measured
first-person intake/review minutes from 5–10 vehicles; approved scoring, auth,
tenancy, retention, metering, safety, evaluation, and organizational/legal
neutrality designs before direct-competitor or live use.

**Done when:** The 72-interaction internal suite passes every hard gate;
VynTechs passes the receipt conformance suite through its living-RO adapter;
and one non-founder buyer prepays and passes the 50-case design proof.

**Verified by:** Fresh AutoEYE branch lint and 43-test run; mechanical export
and lifecycle inventory; independent diagnostic and commercial reviews; PR
diff and link checks. The harness, adapter, buyer payment, and production
service are future proof work and are not claimed complete here.

## Stop conditions

Stop and re-scope if the work requires a second technician workflow, exact
service data without rights, silent use of partner data, a lower-quality
baseline for competitors, hidden VynTechs privileges, diagnostic claims on the
external receipt, a free custom build, or a second failed approach to the same
benchmark defect.
