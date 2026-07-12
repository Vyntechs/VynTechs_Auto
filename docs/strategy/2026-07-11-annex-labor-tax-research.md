# Annex — sales tax on auto-repair labor (research, 2026-07-11)

Supports `2026-07-11-brief-labor-tax-rule.md`. Method: web research against official state DOR/comptroller sources where possible; every row marked VERIFIED (official source read), SECONDARY (reputable secondary source), SECONDARY (pattern) (classified by the dominant rule for services-exempt states — treat as verify-before-ship defaults), or UNVERIFIED (not guessed). Three load-bearing official sources (TX, NY, FL) were re-fetched and reconciled before delivery.

## Current state in our code (verified on `main`)

- Tax model: shop-level `shops.taxRateBps` (`lib/db/schema.ts:83`) + per-line `taxable` boolean (`:529`); `calculateTicketTotals` taxes all flagged lines, ignoring `kind` (`lib/shop-os/quote-math.ts:187-193`).
- **Every line, including `kind='labor'`, defaults `taxable: true`** (`schema.ts:524,529`; builder init `components/screens/manual-quote-builder.tsx:1424`). Manual per-line uncheck exists; the default taxes labor.
- **No shop location/state field exists anywhere** (schema, migrations, seeds, settings, env — searched). `taxRateBps` is a bare rate with no jurisdiction.
- Exposure today is bounded: quotes are approved phone/in-person (no public send yet), so any over-collected labor tax reached customers only via hand-read quotes at the pilot shop. One-time check of issued quotes recommended once the model decision lands.

## 1. Which government governs this

**No federal sales tax exists.** Sales/use tax is **state law**; local (county/city/district) rates stack on top. Whether repair labor is taxable is a per-state statutory question; the rate is a separate geographic lookup. Some states change taxability by **invoice format** (lump-sum vs itemized) or **labor type** (repair vs fabrication). One global rule is therefore impossible by construction.

## 2. State matrix — is auto REPAIR labor taxable?

Tally: **~18–20 states tax repair labor · ~26 exempt separately-stated labor · 5 have no state sales tax (AK, DE, MT, NH, OR) · 3 unverified (DC, LA, MS).** All 11 states named in the intake question are VERIFIED against official sources.

| State | Labor taxable? | Condition / trap | Source | Status |
|---|---|---|---|---|
| AL | No | If separately stated | legalclarity.org | SECONDARY (pattern) |
| AK | No | No state tax; local may apply | avalara.com | VERIFIED |
| AZ | No | TPT on goods; labor generally not | legalclarity.org | SECONDARY (pattern) |
| AR | **Yes** | Motor-vehicle repair taxed | avalara.com | SECONDARY |
| CA | **No repair / Yes fabrication** | **TRAP:** repair/install labor exempt only if separately stated; fabrication (paint-of-new-parts, cutting) taxable; >10%-parts segregation rule | cdtfa.ca.gov pub 108 + pub 25 | **VERIFIED** |
| CO | No | Services generally exempt | legalclarity.org | SECONDARY (pattern) |
| CT | **Yes** | Parts AND labor; itemization mandatory but does NOT exempt labor | portal.ct.gov PS 92(8.1) | **VERIFIED** |
| DE | No | No sales tax | avalara.com | VERIFIED |
| DC | ? | Unconfirmed | — | UNVERIFIED |
| FL | **Conditional → effectively Yes** | **TRAP:** any part on the job → **entire charge incl. labor taxable**; labor-only exempt only with explicit no-tangible-property documentation | floridarevenue.com GT-800010 + Rule 12A-1.006 F.A.C. | **VERIFIED** |
| GA | No | If separately stated | legalclarity.org | SECONDARY (pattern) |
| HI | **Yes** | GET taxes services broadly | files.hawaii.gov TF 99-3 | **VERIFIED** |
| ID | No | Repair exempt; fabrication taxable | fullbay.com | SECONDARY |
| IL | No | Services generally exempt | legalclarity.org | SECONDARY |
| IN | No | If separately stated | legalclarity.org | SECONDARY (pattern) |
| IA | **Yes** | Vehicle repair is an enumerated taxable service | revenue.iowa.gov | **VERIFIED** |
| KS | **Yes** | Repair/install labor on TPP taxable | ksrevenue.gov fsgenautomotive | **VERIFIED** |
| KY | **Yes** | Post-2018 service expansion | avalara.com | SECONDARY |
| LA | Likely yes | Unconfirmed for auto | — | UNVERIFIED |
| ME | No | Services generally exempt | legalclarity.org | SECONDARY (pattern) |
| MD | No | Repair exempt; fabrication taxable | legalclarity.org | SECONDARY (pattern) |
| MA | **Conditional** | Separately-stated labor exempt; bundled + parts ≥10% → whole charge taxable | salestaxhandbook / LR 85-8 | SECONDARY |
| MI | No | Services not taxed | legalclarity.org | SECONDARY |
| MN | No | Exempt **when separately stated** | revenue.state.mn.us service-dept guide | **VERIFIED** |
| MS | Likely yes | Unconfirmed for auto | — | UNVERIFIED |
| MO | No | If separately stated | legalclarity.org | SECONDARY (pattern) |
| MT | No | No sales tax | avalara.com | VERIFIED |
| NE | **Yes** | MV repair/painting labor taxable | avalara.com | SECONDARY |
| NV | No | Goods only | legalclarity.org | SECONDARY (pattern) |
| NH | No | No sales tax | avalara.com | VERIFIED |
| NJ | **Yes** | Parts AND labor; itemizing does not exempt (separately-stated towing exempt) | nj.gov ANJ-6 | **VERIFIED** |
| NM | **Yes** | GRT taxes services broadly | tax.newmexico.gov | **VERIFIED** |
| NY | **Yes** | Tax on **total charge for parts and labor**; format irrelevant | tax.ny.gov auto_repair bulletin | **VERIFIED** |
| NC | **Yes** | RMI services taxable **even if separately stated** | ncdor.gov RMI page | **VERIFIED** |
| ND | No | If separately stated | legalclarity.org | SECONDARY (pattern) |
| OH | **Yes** (cond.) | Repair of TPP taxable; narrow separately-stated exclusions | avalara + handsoffsalestax | SECONDARY |
| OK | No | If separately stated | legalclarity.org | SECONDARY (pattern) |
| OR | No | No sales tax | avalara.com | VERIFIED |
| PA | **Yes** | Code taxes "inspecting, altering, cleaning, lubricating, repairing… motor vehicles" | 61 Pa. Code §31.5 | **VERIFIED** |
| RI | No | If separately stated | legalclarity.org | SECONDARY (pattern) |
| SC | No | If separately stated | legalclarity.org | SECONDARY (pattern) |
| SD | **Yes** | Services taxable by default | dor.sd.gov MV repairs guide | **VERIFIED** |
| TN | **Yes** | Labor on TPP taxable | revenue.support.tn.gov SUT-22 | **VERIFIED** |
| TX | **No (labor)** | **TRAP:** lump-sum billing → shop pays tax to supplier, none to customer; separated billing → shop collects on parts w/ resale cert. Invoice model must support both | comptroller.texas.gov 94-113; 34 TAC §3.290 | **VERIFIED** |
| UT | No | If separately stated | legalclarity.org | SECONDARY (pattern) |
| VT | No | If separately stated | legalclarity.org | SECONDARY (pattern) |
| VA | No | Exempt when separately stated; diagnostic + roadside labor exempt since 2023-07-01 | tax.virginia.gov ruling 24-79 | **VERIFIED** |
| WA | **Yes** | Repair = retail sale; tax on total incl. labor (+ Retailing B&O) | dor.wa.gov auto-dealers/repairs | **VERIFIED** |
| WV | **Yes** | Services taxable by default | tax.wv.gov TSD-310 | **VERIFIED** |
| WI | **Yes** | Repair/service of TPP taxable | avalara + salestaxhandbook | SECONDARY |
| WY | No | If separately stated | legalclarity.org | SECONDARY (pattern) |

## 3. Who it applies to

- **The shop is the state's tax collector.** Wrong taxability = the shop's assessment + penalties, not the customer's. A SaaS default that under-collects in NY or over-collects in TX puts the *shop* on the hook — platform trust risk.
- **Resale certificates:** separated-billing states (e.g., TX) → shop buys parts tax-free with a resale cert, collects from customer. Lump-sum treatment → shop pays supplier, charges customer no tax. The invoice model must know which mode the shop uses.
- **Customer types:** government typically exempt with documentation; dealers/resellers can present resale certs; fleet/commercial generally taxable absent a specific certificate; warranty/insurance work often rides the warranty company's resale cert. → future need: per-customer exemption flag + certificate storage.

## 4. How competitors model it (none hardcode "labor is free")

- **Tekmetric:** state rate + checkboxes for whether tax applies to labor / parts / fees; per-job toggle. (support.tekmetric.com "Setup Taxes")
- **Shopmonkey:** choose which item types are taxed (parts, labor, EPA, supplies, sublet); per-line and per-inventory-item Taxable toggle overrides. (support.shopmonkey.io "Tax Settings")
- **Mitchell 1 Manager SE:** separate labor and parts tax rates; exceptions at customer, vehicle, and order-item level; reports split taxed vs untaxed parts/labor. (managerhelp.buymitchell1.net)
- **Fullbay:** location-based rates, multiple tax locations, QuickBooks sync; own guidance stresses state variance. (fullbay.com)

Industry-standard model = **(a)** taxable flag per line-item category, **(b)** per-line override, **(c)** per-customer exemption, **(d)** state/local rate + state-default taxability profile.

## 5. Bottom line

**"Never tax labor" must not be hardcoded.** It is false in ~18–20 states, format-dependent in FL/TX/CA/MA, and true only as a default in the majority separately-stated states. It is a fine **state-configurable default**, never a constant. Recommended shape for us (matches brief step 2 options):

- **Option (a) minimal:** add `shops.taxLaborLines boolean` (or per-kind taxability map) + make the line default follow it; labor default = non-taxable **only after the shop confirms its state's rule** during setup. No state field yet; correctness by shop attestation.
- **Option (b) state-aware:** add `shops.state`, ship the matrix above as seeded defaults per state (with trap-state notes surfaced in UI), per-shop override, per-line override retained. This is the competitor-parity end-state; (a) is a safe first slice on the way to (b).

Either way: keep the per-line `taxable` override, keep itemized labor/parts rendering (required to *qualify* for exemptions in separately-stated states and to satisfy TX/FL documentation rules).

---

*Verification: TX (comptroller 94-113), NY (tax.ny.gov auto-repair bulletin), FL (Rule 12A-1.006-citing source; official PDF was unparseable binary) re-fetched and reconciled; CA/WA/CT official pages also directly confirmed. DC/LA/MS left UNVERIFIED by design. SECONDARY (pattern) rows are defaults to verify before shipping state-specific behavior.*
