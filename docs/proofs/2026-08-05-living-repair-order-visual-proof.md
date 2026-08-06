---
title: "Living Repair Order Visual Proof"
status: active
created: 2026-08-05
---

# UI direction: PRE-CODE-REVIEW

Project / revision: Shop OS, `codex/living-repair-order-visual-2026-08-05`, source SHA `3a3c71a05ba0c66fa4e60a7bfadfe2117a69d3c5`, proof revision uncommitted in the isolated worktree.

Mandate: prove that one mounted repair order can become a trustworthy quote through visible part and labor inputs, with no magical price and no role handoff fiction.

Authority: **SPEC-ONLY** — writes are limited to this receipt, `tests/e2e/living-repair-order-harness/**`, `tests/e2e/living-repair-order-visual-proof.spec.ts`, `playwright.living-repair-order.config.ts`, and generated/preserved proof artifacts. Production components, routes, APIs, schemas, dependencies, auth, data, commit, PR, merge, deploy, and publishing are hard no.

## Fresh source receipts

- Founder correction, Buzz event `5b73eda4af832df03ea3a656714fa16c604c0e35cb177c7608e69f9ecb970896`, received 2026-08-05: Brandon supplies his own parts and enters labor; technicians commonly build the full ticket, advisors can build or continue it, and owners can do both. O’Reilly First Call, PartsTech, and RepairLink are future supplier doors only; existing accounts do not imply a live integration.
- `components/screens/ticket-detail.tsx:302-399`, route `/tickets/[id]`: the shipped ticket already owns repair-order identity, the quote command, the embedded quote boundary, projection return, and opener focus return.
- `components/screens/ticket-detail.tsx:546-681`: “What brought it in” and the job ledger are durable ticket truths; the proof keeps the active builder inside this hierarchy.
- `components/screens/inline-quote-workspace.tsx:32-54` and `:63-108`: the real inline boundary owns focus, loading, retry, and recovery; `:162-175` mounts the real `ManualQuoteBuilder` and returns its projection without changing navigation semantics.
- `components/screens/manual-quote-builder.tsx:1599-1658`: the real builder already exposes part, labor, and fee line actions. `:2199-2279` owns real line inputs, including hours and rate-derived labor.
- `components/screens/manual-part-sourcing.tsx:120-139`: current markup math derives customer price from supplier cost; `:454-511`, `:522-584`, and `:630-644` establish current manual vendor choice, visible inputs, and save behavior. No external supplier connector is represented as live.
- `lib/shop-os/quote-builder-ui.ts:31-147`: shipped quote line and configuration contracts. `:476-500` summarizes subtotal, tax, and total; `:526-579` defines manual part/labor/fee inputs and computes labor from hours and rate.
- `lib/db/schema.ts:762-796`: job lines contain part, labor, fee, vendor, and ordering facts but no generic creator provenance. The proof therefore does not invent per-line technician/advisor authorship.
- `components/screens/customer-copy.tsx:102-241`, route `/tickets/[id]` Customer Copy: the real component owns print freshness, customer-safe work, and totals. The proof mounts this component, not a lookalike.
- `app/globals.css:132-177` and `:372-440`: the real Bone/Graphite/Signal tokens, shipped font roles, focus token, and Customer Copy print shell are reused unchanged.
- `tests/e2e/living-repair-order-harness/main.tsx:252-405`, local route `/?state=collapsed`: the rendered proof mounts ticket/job truth, one job-owned `Build ticket` action, in-place settlement, hidden `More`, and the real Customer Copy.
- `tests/e2e/living-repair-order-harness/main.tsx:465-578`: the local builder exposes no total before saved lines, derives part and labor values from visible inputs, keeps fee optional, and only then exposes `Prepare quote`.
- `tests/e2e/living-repair-order-harness/main.tsx:581-600`: O’Reilly First Call, PartsTech, and RepairLink are visibly labeled `Planned connectors · not live`; current actions remain attach/manual entry.
- `tests/e2e/living-repair-order-harness/main.tsx:602-676`: saved-line receipts and quote math stay visible through preparation and settlement.
- `tests/e2e/living-repair-order-harness/style.css:417-685`: proof-only source doors, 44px inputs, calculations, saved lines, and totals use the real token contract. `:801-825` keeps `Add work` behind `More`; `:846-974` owns phone-specific composition.
- Render receipt paths, refreshed by the final focused Playwright run:
  `docs/proofs/artifacts/living-repair-order/phone-ticket-entry-collapsed-390x844.png`,
  `phone-part-input-source-390x844.png`, `phone-lines-total-390x844.png`,
  `phone-prepared-settled-390x844.png`,
  `desktop-ticket-builder-lines-1440x900.png`, and
  `customer-copy-print.png`.

## Creative brief

Experience promise: **the ticket earns its total, line by line, in the same place the work is understood.**

Recommended direction: a shared, job-mounted Ticket Builder. The technician can build a full ticket; the advisor can build or continue it; the owner can do both. Roles share the same ticket truth without a handoff ceremony, role toggle, or invented per-line authorship. The phone sequence begins honestly empty, exposes a planned supplier horizon without fake connectivity, derives a part price from supplier cost plus markup, derives labor from hours × rate, and withholds totals and quote preparation until those saved inputs exist.

Signature move / restraint rule: the existing truth seam extends from the active job into the temporary builder, then resolves beside the prepared version and amount. It visualizes causality only. There is one filled action per state; future supplier doors are passive and labeled; `Add work` stays behind `More`; no gradient, glass, card grid, decorative motion, or role-color theater is introduced.

Rejected concept logic: the prior Quote Bench concept began with `Build price` and could reveal a complete total without showing where parts and labor came from. It was visually coherent but operationally false, and implied an advisor-priced handoff. This revision supersedes every earlier expanded/settled screenshot and rejects that logic completely.

## Surface × state map

| Surface / role | State / viewport | Must notice | Must do | Distinct treatment | Shared contract | Proof artifact |
| --- | --- | --- | --- | --- | --- | --- |
| Technician / advisor / owner phone | Ticket entry / 390×844 | The customer request, current job, and `No lines yet` | Build ticket | One job-owned filled action; no price or quote-preparation control | Same ticket and one filled action; all three roles may contribute within authorization | `phone-ticket-entry-collapsed-390x844.png` |
| Technician / advisor / owner phone | Part source + visible inputs / 390×844 | Planned supplier doors are not live; current source, quantity, cost, markup, and customer price are visible | Attach or enter the part, then save | Passive O’Reilly First Call / PartsTech / RepairLink horizon; current path stays tactile | Customer line price derives from visible supplier inputs | `phone-part-input-source-390x844.png` |
| Technician / advisor / owner phone | Part + labor saved / 390×844 | Part $140.00, labor $187.50, subtotal, tax, total | Add optional fee or Prepare quote | Dense line receipt with `1.25 hr × $150.00/hr`; total appears only now | Total = saved lines + tax; no provenance fiction | `phone-lines-total-390x844.png` |
| Technician / advisor / owner phone | Prepared and settled / 390×844 | Quote V1, visible breakdown, prepared total $338.70 | Record customer approval | Temporary builder folds away; short truth seam receipt remains inside the job | No route change; focus returns to job; one filled action | `phone-prepared-settled-390x844.png` |
| Technician / advisor / owner desktop | Saved lines + total / 1440×900 | Request truth and ticket math can be compared in parallel | Prepare quote | Two-column bench, not enlarged phone UI | Same nouns, tokens, math, and command rank | `desktop-ticket-builder-lines-1440x900.png` |
| Customer print | Estimate / print | Customer, vehicle, committed lines, subtotal, tax, total | Read or retain | Narrow black-on-white projection from real `CustomerCopy` | No internal assignment or planned supplier claims | `customer-copy-print.png` |
| Technician / advisor / owner phone + desktop | Equal-ranked jobs | Two jobs need attention without false ordering | Choose a job, then build the same ticket | Compact equal-rank command; all jobs remain visible | Selection changes focus only, not role or state semantics | Browser assertion; no founder-sequence screenshot |
| Phone | Reduced motion settlement | Prepared meaning remains legible | Continue to approval | Truth seam appears without animation | Same state and focus result | Browser assertion; no duplicate screenshot |

## Scope and implementation slice

In scope: one synthetic repair order; empty builder, part source/input, part saved, labor input/saved, optional fee door, totals, preparation, settlement, equal-rank job selection, phone 390×844, desktop 1440×900, and real Customer Copy print. Proof files only.

Behavior preserved: no production game/work logic, navigation, ticket state, quote persistence, approvals, authorization, recovery, schema, API, tax configuration, or dependency contract changes. The harness is explicit local state for visual proof; it does not claim a production implementation.

Role authority preserved: technicians can build the full ticket; advisors can build or continue; owners can do both. The proof shows a shared surface and does not manufacture a handoff, role toggle, or per-line author label.

Out of scope: live O’Reilly First Call, PartsTech, or RepairLink connectivity; credentials; catalog search; production pricing policy changes; authenticated production baselines; production source writes; migrations 0050/0051; commit, PR, merge, deploy, and publishing.

Thin vertical slice: one job proceeds from zero lines to a saved part, saved labor, mathematically inspectable total, prepared quote, and real customer estimate projection across phone and desktop.

## Source-to-production component mapping

| Proof element | Fidelity | Current production source | Smallest future target after gates |
| --- | --- | --- | --- |
| Job-mounted shared `Build ticket` action, equal-rank selection, hidden More | Composition proof using shipped ticket nouns/tokens | `ticket-detail.tsx:302-399`, `:546-681` | `ticket-detail.tsx` and its module CSS only |
| Empty → part → labor → total → prepared sequence | Composition and behavior-contract proof; local state, not API-backed | `inline-quote-workspace.tsx:32-175`; `manual-quote-builder.tsx:1599-1658`, `:2199-2279` | Existing inline boundary plus `manual-quote-builder` visual hierarchy; no new route |
| Current part attach/manual entry and planned supplier horizon | Current manual paths are source-grounded; three future doors are stakeholder-labeled and intentionally inert | `manual-part-sourcing.tsx:120-139`, `:454-644` | Existing part-sourcing component; connectors require separate product/integration authority |
| Line and total arithmetic | Fixture proof matches the shape of shipped line/totals contracts | `quote-builder-ui.ts:476-579`; `jobLines` at `schema.ts:762-796` | Reuse current server contracts; do not duplicate proof math in production |
| Prepared customer estimate | Real component proof | `customer-copy.tsx:102-241`; print shell `globals.css:372-440` | Print-only styling refinement if separately approved |

## Browser and verification proof

Commands:

```bash
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/playwright test --config=playwright.living-repair-order.config.ts
```

Current receipts:

- TypeScript after the consolidated repair: exit 0 on 2026-08-05.
- Final focused Playwright control-lane run: **8 passed, 2 expected viewport
  skips, 8.2 seconds**, exit 0 on 2026-08-05. The final run regenerated all
  six durable artifacts at source SHA `3a3c71a05ba0c66fa4e60a7bfadfe2117a69d3c5`
  plus the uncommitted proof-only files.
- Assertions at `tests/e2e/living-repair-order-visual-proof.spec.ts:16-155` require: no `Build price`/`Price by hand`; hidden `Add work`; no total or `Prepare quote` before saved inputs; passive planned supplier labels; part price from visible unit cost × quantity + markup; labor from hours × rate; total = line values + tax; one filled action; no route change; job focus after settlement.
- Assertions at `:157-222` cover close focus return, equal-ranked selection, the real Customer Copy estimate and total, internal-assignment exclusion, print freshness/shell behavior, and reduced-motion equivalence.
- Surface health at `:240-273` checks horizontal overflow, every visible enabled button/link/summary/text input at 44px minimum, and serious/critical Axe findings.

Artifact refresh policy: the six paths named above replace the prior
`phone-collapsed`, `phone-expanded`, `phone-settled`, `phone-mixed-*`, and
`desktop-expanded` images. The superseded files were moved out of the active
artifact set to `/Users/brandonnichols/.buzz/.scratch/LIVING_RO_SUPERSEDED_2026-08-05/`.

## Hard-gate ledger

- Source / stakeholder / map / tokens-components / scope: **PASS for pre-code proof** — fresh repository receipts and founder event are cited; no production source changed.
- Accessibility / motion / occlusion / role responsiveness: **PASS for the
  proof** — 390×844 and 1440×900 have no horizontal overflow, enabled targets
  are at least 44px, Axe reported no serious/critical findings, focus contracts
  passed, and reduced-motion settlement retained meaning.
- Non-target regression: **UNVERIFIED / not applicable to proof files** — no production file changed. A later implementation would require authenticated production and non-target-theme baselines.
- Rendered artifacts: **PASS** — six corrected files were regenerated, promoted,
  and visually inspected; the active four-phone sequence begins with `Build
  ticket`, shows supplier/part inputs, then exact part/labor/tax math, then the
  settled prepared job.
- Independent critic: **PASS, 93/100** — a fresh read-only critic directly
  inspected all six corrected renders, current proof code, receipt, governing
  vision, and changed-file scope. No Critical or Important blockers remained.
- Human taste: **REQUIRED / UNMEASURED** — Brandon supplied product truth, not final visual calibration on the corrected renders.

## Quality score

**93/100, independent PASS.** Strongest element: the visible supplier cost →
markup → part price → labor hours × rate → tax → total sequence. Biggest residual
risk: this remains a synthetic harness and does not prove authenticated
authorization, concurrent editing, stale recovery, connector behavior,
persistence, or production pricing policy.

## Residual risks

- Supplier labels are planned product doors only. Search behavior, account connection, pricing freshness, ordering, credential storage, failure states, and commercial constraints remain unproved and out of scope.
- The proof fixture uses an explicit 40% markup and 8% part tax to make causality inspectable. Production must continue using its configured server-side policy, not these fixture constants.
- Shared role participation is founder-specified and visually represented without provenance. Production authorization still governs which controls each signed-in role receives.
- The local harness proves hierarchy, focus, arithmetic visibility, and rendering. It does not prove production persistence, concurrent editing, stale quote recovery, or authenticated role access.

## Next safe move

Atlas sends the four corrected phone renders to Brandon for the human direction
gate. Production implementation remains unauthorized until that decision.

## Skipped/Failed

- Skipped: production implementation, authenticated/live data, connector work, current production screenshot baselines, full repository suite/build, commit, PR, merge, deploy, and publishing by explicit authority boundary.
- Failed then recovered: the restricted visual-owner lane could not bind the
  local Playwright server (`listen EPERM 127.0.0.1:4183`); the identical
  control-lane command passed and regenerated the final artifacts.
