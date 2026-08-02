# Shop OS Customer Copy — Design

**Status:** Approved for implementation
**Approved by:** Brandon Nichols in Buzz event `58a69d3e9976a2d24996d1bbda239c3f6dd75f1d87ca75bb9ecf5d74e636ada9` on 2026-08-02
**Tier:** T2 / A2 for branch work. Production migration, merge, and deployment remain A3 gates.

## Intent normalization

### Outcome

An advisor can open an existing repair order, reveal one customer-safe document in place, and print it from the browser. The same document becomes the estimate before authorization, the invoice while money remains due, and the paid receipt after close.

### Explicit requirements

- Start from the existing repair order; no new page.
- Before work, show the estimate and recorded customer decisions.
- At pickup, show the invoice or paid receipt.
- Include shop phone and address, customer, vehicle, VIN, odometer, jobs, parts, labor, tax, approvals, payments, and remaining balance.
- Use browser printing.
- Work on phone and desktop.
- Totals must come from the same immutable approved quote versions and ring-out calculation already used to charge the customer.

### Inferred requirements

- Advisors and owners may see and print money; technician and parts roles may not.
- The printable projection must exclude vendor cost, markup, technician notes, findings evidence, diagnostics, media, assignments, internal activity, and user identifiers.
- A malformed or missing price snapshot blocks printing instead of guessing or silently omitting money.
- Customer decisions mean recorded approve / no / later events, including recorded method and time when present. This is not a signature and must not be described as one.
- Shop identity is owner-editable in Settings. Printing is blocked until phone and a complete postal address are configured, because incomplete paperwork is not a finished customer artifact.

### Non-goals

- PDF generation or storage
- SMS or email delivery
- Deposit or payment links
- Statements, aging, A/R, reports, or data import
- Customer signatures or legal e-signature
- A second quote, invoice, or payment calculation
- A new route or page

## Capability packet

| Field | Contract |
|---|---|
| User | Advisor or owner at the service counter |
| Moment | The customer needs a price/decision record before work or finished paperwork at pickup |
| Visible result | One quiet, paper-shaped preview inside the repair order with a clear document state and print control |
| System behavior | Compose tenant-scoped customer, vehicle, shop, immutable quote, approval, and payment data into a customer-safe read model |
| States | Loading; not ready; shop identity incomplete; Estimate; Invoice; Paid receipt; print failure delegated to the browser |
| Out of scope | PDFs, sending, payment links, statements, importer, reports, new page |
| Verification | Unit/domain tests, component tests, route/schema tests, migration replay, full shards, typecheck, build, and real Chromium phone/desktop print-media inspection |

## Customer-visible behavior

The repair order gains one `Customer copy` action for advisors and owners. Tapping it reveals the preview in the mounted repair order and moves focus to the document heading. The preview carries one primary `Print customer copy` action, which invokes the browser print dialog.

Document state is deterministic:

- **Estimate** — no approved work is billable yet. Current priced jobs and each recorded decision are shown.
- **Invoice** — at least one job has an immutable approved price and the ticket is not both closed and fully paid. Approved work, declined/deferred decisions, payments, and balance are shown.
- **Paid receipt** — the ticket is closed and the ring-out balance is zero. The same charged work and payments remain visible.

Declined and deferred work may appear as decision history, but never contributes to invoice totals. Approved jobs use the exact pinned quote version attached to their approval. Draft estimates use the current prepared quote version. When either source cannot be decoded, the document says pricing must be repaired and printing stays unavailable.

## Data and authorization design

```text
repair-order page
  -> server customer-copy projection
       -> authenticated active profile + tenant shop
       -> role capability: advisor / owner only
       -> shop identity
       -> customer + vehicle
       -> prepared quote or pinned approved versions
       -> recorded quote decisions
       -> existing ring-out totals + payments
  -> customer-safe props only
  -> in-place preview
  -> browser print media
```

Create a dedicated `lib/shop-os/customer-copy.ts` projection. It owns tenant scoping, role authorization, document-state selection, and the allowlist of fields that may cross to the client. It reuses the validated quote snapshot decoder from `lib/shop-os/quotes.ts`; it does not parse quote JSON independently and does not call external providers.

For invoices and receipts, every line is projected from `readApprovedJobPricing`. `priceCents` is already the stored extended customer price used by quote totals, so the document must not multiply it again. For estimates, add one exported customer-safe reader beside the existing approved readers so both paths share the same schema validation.

The projection returns only:

- shop display name, phone, and formatted postal address;
- repair-order number and document state;
- customer display name;
- vehicle year/make/model, VIN, and odometer;
- customer-facing job titles and line descriptions, quantities/hours, part number/brand, labor rate, customer price, and taxable marker;
- recorded approval state, method, and time when available;
- subtotal, tax, total, payments, paid amount, remaining balance, and closed time.

It never returns internal costs, vendor binding, markup, core charge, fitment evidence, diagnostic story evidence, technician notes, work notes, media, assignments, internal activity, profile IDs, or raw snapshot JSON.

## Shop identity

Migration `0049_shop_os_customer_copy_identity.sql` adds nullable text columns to `shops`:

- `phone`
- `address_line_1`
- `address_line_2`
- `city`
- `region`
- `postal_code`

They are nullable so the migration is non-destructive. Settings lets an owner edit them through the existing `/api/shop` route. Server validation trims values and enforces: phone 30, address lines 120, city 80, region 40, postal code 20. Empty optional address line 2 is stored as null. Print readiness requires phone, address line 1, city, region, and postal code.

The source migration is part of this branch. It must not be applied to production until Brandon authorizes the release step immediately before execution.

## Interface design

The preview is a restrained service-counter document, not a dashboard card. White paper sits inside the existing neutral workspace. A narrow status rail is the signature move: estimate uses the product accent; invoice uses ink; paid receipt uses a quiet success tone. The repair-order number, document state, shop identity, and balance form one immediate reading path.

Phone shows a single column and scrollable preview. Desktop uses a paper-width canvas. Print media hides application chrome, controls, notices, and all non-document siblings; sets page margins; avoids breaking job groups and the totals block; and preserves legible black-on-white output without relying on background color.

No animation is required. Focus, keyboard reachability, semantic headings, table alternatives on narrow screens, and contrast follow the existing Shop OS doctrine.

## Alternatives considered

1. **Dedicated customer-safe projection plus in-place print view — selected.** One money source, smallest privacy surface, no route or dependency.
2. Print the existing repair-order or ring-out screen — rejected. It contains internal controls, omits line detail and shop identity, and makes privacy depend on CSS hiding.
3. Generate a PDF or add a document route — rejected. It expands storage, authorization, rendering, and lifecycle risk beyond the approved slice.

## Failure and rollback

- Missing shop identity: preview explains exactly what is missing and links the owner to Shop Settings; print is disabled.
- Missing/corrupt quote price: no guessed totals; preview identifies that pricing must be repaired.
- Browser print cancellation/failure: no application state changes.
- Rollback: revert application commits. The nullable identity columns may safely remain unused; dropping them is unnecessary and destructive.

## Acceptance tests

1. An advisor/owner sees `Customer copy`; technician and parts roles do not receive the projection or control.
2. The preview changes among Estimate, Invoice, and Paid receipt from stored ticket facts, not UI guesses.
3. Invoice and receipt totals exactly match ring-out for the same repair order.
4. Approved line detail comes from pinned immutable quote versions; declined/deferred work never enters charged totals.
5. Shop identity, customer, vehicle, VIN, odometer, jobs, parts, labor, tax, recorded approvals, payments, and balance render when present.
6. The customer-safe object and rendered output contain none of the excluded staff-only fields.
7. Printing is unavailable when required shop identity or trustworthy pricing is missing.
8. Browser print media shows only the document at 390×844 and 1440×900, with no horizontal overflow, serious/critical accessibility findings, or browser faults.
9. Migration replay, all test shards, TypeScript, and production build pass on the exact reviewed head.
