# Task brief — labor is never taxed wrong again (quote/invoice tax rule)

**Date:** 2026-07-11 · **Origin:** Brandon, intake session · **Lane:** quote domain (Shop OS phase 3+)
**Collision note:** touches the quote contract the control lane is actively planning (row 23). This brief should be read by the row-23/24 planner **before** invoice math ships. It adds a requirement; it does not change any shipped row.

## Goal

Quote and invoice math can never apply sales tax to a line it shouldn't: labor and parts carry distinct tax treatment, configured per shop, correct for that shop's state — never a hardcoded global rule.

## What Brandon said (intent, verbatim spirit)

"There is never tax allowed on labor. Parts and materials only." — with an explicit ask to verify whether that's local/state/federal law, where it applies, and to whom.

## Current code behavior (verified 2026-07-11, from `main`)

- Tax IS modeled: shop-level rate `shops.taxRateBps` (`lib/db/schema.ts:83`) + per-line `taxable` boolean (`lib/db/schema.ts:529`); `calculateTicketTotals` taxes the sum of flagged lines (`lib/shop-os/quote-math.ts:187-193`).
- **Labor is taxed by default today.** `job_lines.taxable` defaults `true` for every line kind including `labor` (`schema.ts:524,529`), and the quote builder initializes new lines — labor included — as taxable (`components/screens/manual-quote-builder.tsx:1424`). Tax math ignores line `kind` entirely. A user can uncheck "Taxable" per line by hand; the default violates Brandon's rule.
- **No shop location/state is modeled anywhere** (no address/state column on `shops`; searched schema, migrations, seeds, settings UI, env). `taxRateBps` is a bare rate with no jurisdiction attached.
- Exposure check: quotes are approved by phone/in-person today (no public send yet — rows 32–35 pending), so any over-taxed labor line reached a customer only via hand-read/charged quotes at the pilot shop. Worth a one-time check of issued quotes once the model decision lands.

## What research shows (summary — full annex: `2026-07-11-annex-labor-tax-research.md`)

- Sales tax is **state law** (plus local add-on rates); there is no federal sales tax. So "never" is a per-state fact, not a universal one.
- Many states do NOT tax auto repair labor — but several DO, and some flip taxability based on **how the invoice is written** (lump-sum vs separately itemized labor). Hardcoding "labor never taxed" is safe only inside states where that's true, and a liability everywhere else.
- Product consequence: taxability is a **property of the line-item class + shop's state + invoice itemization**, i.e., configuration with verified state defaults — the same shape competitors model.
- The annex carries the state matrix with per-state citations and confidence marks.

## Scope

- **In:** quote/invoice domain (`lib/shop-os/` quote files, quote schema, quote math tests), shop settings (tax rate + labor-taxability), estimate/invoice presentation of tax lines.
- **Out:** diagnostic engine (all of it), payment processing changes, tax *filing/remittance* features, non-US jurisdictions, historical invoice migration (unless research shows shipped invoices already taxed labor — then that becomes its own urgent correction slice).

## Steps

1. **Verify current behavior** — confirm from code what quote math does with tax today (does tax exist at all; are labor lines distinguishable). Recorded in the annex, §current-state.
2. **GATE (Brandon):** pick the tax model — (a) minimal: per-shop "tax labor? yes/no" + single rate, correct-by-configuration; or (b) state-aware: line-class × state defaults with per-shop override. Recommendation in annex §recommendation.
3. Design doc + plan in row style (design → plan → tests-first), inside the quote-domain seam, reconciled against whatever row 23/24 shipped by then.
4. Implement behind tests; estimates and invoices display tax only on taxable lines, itemized so trap-state formatting rules are satisfiable.
5. If any shipped invoice ever taxed labor for the pilot shop: separate correction slice with its own gate (customer money = stop condition).

## Verify by

- Focused tests: given a shop configured labor-nontaxable, a mixed labor+parts quote taxes parts only — exact cents asserted; given labor-taxable config, labor tax applies; itemized subtotals render separately.
- `pnpm test` + `tsc --noEmit` + `pnpm build` green.
- One manual estimate in staging for the pilot shop's state shows the correct tax line.

**Stop conditions:** any prod data correction, anything touching filed/sent invoices, spend, or legal ambiguity the annex can't resolve → back to Brandon.
