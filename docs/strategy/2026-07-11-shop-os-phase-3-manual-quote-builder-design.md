# Shop OS row 18 — manual quote builder design

**Subject:** A working repair-order quote desk for an advisor or wrenching owner.

**Single job:** Turn the persisted jobs on one open ticket into an accurate manual quote, see the math continuously, and prepare one immutable version without implying that it was sent or approved.

## Product boundary

- Add a protected `/tickets/[id]/quote` surface and an honest `Build quote` entry on an open ticket only when the current actor has `canBuildQuotes` and paid access.
- Consume row 17's safe builder GET and line/version mutation routes; do not add a parallel quote domain.
- Support manual part, labor, and fee lines; edit and remove only the mutable manual fields exposed by row 17.
- Calculate visible money with row 17's integer-cent/basis-point functions. When tax is unconfigured, show known subtotal/taxable subtotal but render `Tax — Not configured` and `Total unavailable`; never treat missing tax as zero.
- `Prepare quote` creates or returns the immutable active version. It never says send, approve, authorize, order, or start work.
- Keep provisional-ticket, missing-rate, missing-tax, empty-quote, contention, access, and network states explicit and recoverable. Draft lines are allowed on an open provisional ticket; prepare/send/approval/delivery/closeout remain blocked until reconciliation.
- No phone/in-person approval UI, story generation/review, canned jobs, attachments, vendors, sends, repair execution, production schema work, or diagnostic-engine change.

## Visual direction — calibrated repair-order tape

The existing Workshop Instrument system remains authoritative. The builder should feel like a clean estimate sheet clipped beside a repair order, not a generic SaaS form.

- **Palette:** Bone paper `#FBFAF7` (`--vt-bone-50`), raised bone `#F5F1EA` (`--vt-bone-100`), graphite ink `#242325` (`--vt-fg`), signal navy `#1762C4` (`--vt-signal-500`), ignition amber `#F2B824` (`--vt-amber-500`), and rule gray `#D8D1C6` (`--vt-rule`). CSS uses the existing tokens; hex values are descriptive approximations only.
- **Type:** Instrument Serif for job names and human-readable descriptions; Inter Tight for controls and state guidance; JetBrains Mono for quantities, rates, amounts, and version numbers.
- **Layout:** A flexible repair-order ledger owns the page. On wide screens a narrow sticky quote tape owns the math; on narrow screens the same tape becomes an in-flow summary followed by a sticky prepare action that never covers form fields.
- **Motion:** One restrained total-change highlight after committed server truth returns. Respect reduced motion; no counting animation, fake save indicator, or decorative progress.
- **Signature:** The live quote tape. Its ruled subtotal/tax/total stack is the single memorable element, and every mark encodes actual money or readiness state.

### Wide layout

```text
┌─ RO / Quote header ─ customer + vehicle context ─ Back to ticket ─┐
│ Configuration/reconciliation truth strip                          │
├─ Job ledger (fluid) ───────────┬─ Quote tape (sticky 320px) ──┤
│ Repair job                       │ Subtotal             $0.00 │
│ ├─ PART  Pads            $000.00 │ Taxable              $0.00 │
│ ├─ LABOR  1.5 h           $000.00 │ Tax                   $0.00 │
│ └─ + Part  + Labor  + Fee         │ TOTAL                 $0.00 │
│ [one inline add/edit form at a time] │ [Prepare quote]             │
└─ Next job ──────────────────────┴─ Version/readiness truth ────┘
```

### Narrow layout

```text
┌─ Quote header / Back ─┐
│ Truth strip           │
├─ Job             ──────┤
│ Line                  │
│ Line                  │
│ + Part + Labor + Fee  │
│ Inline form           │
├─ Quote tape ───────┤
│ Subtotal / Tax / Total│
└─ Prepare quote (44px+) ┘
```

## Interaction contract

- Only one add/edit form is open at a time. Choosing Part, Labor, or Fee immediately presents only fields valid for that kind.
- Part quantity is descriptive while `Line price` is the complete persisted extended customer charge, including any core charge; the UI never invents a unit-price multiplication or adds core again. Row 18 omits core editing and labels an existing core amount `Included in line price`.
- Labor defaults to the configured shop rate and shows the calculated extended price. When no shop labor rate exists, the current labor line requires an explicit line price; already priced labor does not block preparation merely because the shop rate is null.
- Taxability is explicit. Monetary entry accepts nonnegative dollars with at most two decimals and converts to integer cents without floating-point rounding.
- Dollar parsing and formatting use decimal strings plus BigInt quotient/remainder throughout, including values near `Number.MAX_SAFE_INTEGER`; display code never divides cents by 100.
- A create attempt keeps one browser UUID across ambiguous transport or same-input retries. Successful creation or changed input rotates it.
- Every mutation waits for the server result, then reloads builder truth. Same-line concurrent edits are honestly last-write-wins in v1 because row 17 has no expected revision; there is no stale-write claim, optimistic total, or fake autosave.
- A retryable conflict says `Quote is busy. Refresh and retry.` A non-retryable conflict or opaque 422 says to review visible fields and refresh without inventing a server cause. Field-specific copy is limited to client validation and facts present in the builder projection.
- A 401 routes to sign-in; a 403 routes to the returned deactivated/subscription boundary; a privacy-safe 404 leaves no quote data and returns to the ticket/not-found boundary.
- Switching away from a dirty editor requires an explicit keep-editing or discard decision. A clean editor may switch immediately.
- Keyboard focus returns to the affected line or add control after save/remove. Errors are announced; all actionable targets are at least 44px.
- Numeric controls use visible labels, decimal `inputMode`, no spinner-only interaction, and appropriate autocomplete suppression. The mobile action respects `env(safe-area-inset-bottom)`, does not cover the final field/error, and yields while the software keyboard is active.

## Source-of-truth rule

- The protected server page authenticates, applies the same subscription/deactivation policy as the API, checks `canBuildQuotes`, then calls the injected `getTicketDetail` and `getQuoteBuilder` handlers directly. It never self-fetches HTTP.
- Client refreshes and mutations use the row-17 API routes. Server and client consume the exact exported `QuoteBuilderResult` projection and preserve equivalent privacy-safe denial semantics. No second quote assembler exists.
- The visible total is complete only while every persisted quote line is exposed by the safe builder projection. Before row 19 or any later row inserts `guide`, `diagnosis_seed`, or `vendor_offer` lines, that row must first extend the safe projection to return all customer-safe lines or server-computed complete totals. Hidden non-manual lines may never coexist with a `live total` claim.

## Self-critique

The first concept risked becoming a generic two-column admin editor. The revised quote tape is specific to repair estimating and earns its space by exposing the exact math and version readiness. Numbered workflow steps, decorative cards, gradients, and multiple accent colors were removed because quoting is not a forced sequence and the product must feel like a trustworthy instrument, not a demo.

## Acceptance proof

- Component tests cover each line kind, BigInt dollar/cents conversion and exact near-safe-limit formatting, totals/tax/overflow edges, missing-tax unavailable total, no-rate explicit-price labor, core informational display without double-counting, one-form/dirty-switch behavior, idempotent create retry, last-write-wins refresh, edit/remove, version preparation, configuration/provisional/access gates, opaque/retryable errors, network failures, focus, and privacy-safe rendering.
- Static/CSS tests cover 375px layout, 44px targets, focus visibility, reduced motion, sticky behavior, and no clipped controls.
- A protected loaded happy-path browser pass checks the wired route at desktop and 375px widths, including safe-area/keyboard overlap and accessibility findings. An unauthenticated redirect alone is not acceptable proof; if credentials/environment block the loaded surface, report the exact gate.
