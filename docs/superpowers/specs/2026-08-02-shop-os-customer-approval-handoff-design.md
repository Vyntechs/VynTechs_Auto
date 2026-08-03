---
title: "Shop OS Customer Approval Handoff Design"
status: approved
created: 2026-08-02
---

# Customer Approval Handoff

## Outcome

An advisor prepares the current quote, copies one secure customer link, and stays on the mounted repair order. The customer opens a calm phone page, chooses approve or decline for each quoted job, reviews the exact selected total, and submits once. Shop screens then show the resulting approval truth without a reload-feeling handoff.

This is the first approved chunk in the sequence Customer Approval Handoff → Ticket Building and Correction → Quote Composition and Commitment.

## Product rule

The interaction should feel like a precision instrument settling into truth. The signature device is a restrained confirmation settle: the selected job card firms into place, the total updates beside it, and the final response becomes a quiet locked receipt. Motion explains state change; it never celebrates routine work or delays the next action.

Every control must help the user finish, correct, or recover:

- **Finish:** create the current link, choose per-job decisions, submit once, and show the answer in Shop OS.
- **Correct:** change a quote by creating a new immutable version; every prior active link becomes unable to act.
- **Recover:** an expired, superseded, already-used, malformed, or contended link reveals no repair-order data, records no decision, and gives one safe instruction to contact the shop.

## Smallest truthful flow

### Advisor

1. Prepare the quote using the existing immutable-version action.
2. Choose `Copy customer link` in the existing quote workspace.
3. The browser copies a URL whose raw bearer token lives only in the URL fragment.
4. The quote workspace confirms `Link copied · V{n}` and arms the same control as explicit `Replace customer link`. Only a successful clipboard write enables fresh bearer rotation; server, network, or clipboard failures retain the exact draft for retry. It does not claim the customer received or viewed it.

Generating or copying a link does not move the repair order to `Waiting on customer`. The first valid link load creates one immutable `viewed` event and changes still-undecided included jobs from `quote_ready` to `sent`. Customer-facing labels call this observed fact `Link opened`; they never claim the bearer was the customer or that Shop OS delivered the link.

### Customer

1. The public `/approve` shell reads the fragment token, removes it from the visible URL, and requests the exact immutable quote snapshot with a bearer header.
2. Each job shows the customer story, quoted work, and subtotal. Internal cost, margin, sourcing, technician, diagnostic, and raw identity fields never enter the payload.
3. The customer chooses `Approve` or `Decline` on every job. A sticky review rail shows the exact approved total.
4. The first `Send decisions` freezes one in-memory command containing the idempotency key and exact full decision set. An ambiguous result disables further choice changes and offers only an identical replay until the exact receipt returns.
5. The page becomes a non-editable receipt. The raw token is gone and the link cannot act again.

No question box, SMS, reminder, deposit, account, login, attachment, or new customer workflow ships in this chunk.

## Data contract

Evolve the existing `quote_sends` retention envelope rather than creating a second ungoverned token store:

- allow `channel = 'link'` alongside `sms`;
- a link row uses the existing `submitted` state while actionable; for `channel = 'link'`, the submission timestamps mean the secure link envelope was issued, never that a provider or customer received it;
- a valid response moves a link row from `submitted` to terminal `responded`;
- supersession or expiry moves it to terminal `expired`;
- SMS lifecycle rules and transitions remain unchanged;
- the advisor browser creates 32 random bytes with Web Crypto, keeps the raw token only in memory, and sends the server only its SHA-256 hash;
- only a SHA-256 token hash is stored;
- the required destination fingerprint is privacy-minimized with the random token hash as salt and the customer contact value as input; `fingerprint_key_version = 'link_v1'` distinguishes it from reproducible SMS-consent fingerprints;
- `subject_key` remains the customer ID, preserving the existing deletion/hold discovery path;
- terminal records retain for one year under the existing quote-send policy.

The database trigger owns the channel-aware lifecycle rules. Direct-client access remains denied by the existing server-only ACL.

## Concurrency and version truth

All authenticated mutations lock in this order: ticket → jobs → quote versions → actor → matching link rows. Public response mutations have no actor lock and use ticket → jobs → quote versions → matching link row. This matches the existing quote-mutation order while the ticket lock serializes both paths.

- Link creation succeeds only for the sole active immutable version and an active advisor/owner capability.
- One actor/request key plus token hash returns the same actionable link result; a mismatched replay conflicts. Because the browser retains the raw token during retry, a lost response never creates a dead end or requires server-side token recovery.
- At most one actionable link exists per quote version. A deliberate replacement remains available after a valid view when every exact-version job is still undecided (`quote_ready` or `sent`) and has no approved version. It expires the old row and creates a new row from a new browser-generated token in the same transaction; immutable link/view history remains and `sent` jobs stay `sent`.
- Approved, declined, and deferred jobs are terminal for link creation. The advisor control uses the same eligibility rule as the server.
- Creating a new quote version expires all actionable link rows for the superseded version in the same transaction before the new version becomes active.
- A public response locks and revalidates the link, ticket, jobs, and sole active version before inserting any event.
- The complete per-job response is atomic: every decision lands or none do.
- Network loss, an unparseable success, `429`, `503`, or another ambiguous response keeps the frozen command only in mounted memory, visibly locks the choices, and retries the byte-identical body and key. A definite non-`429` 4xx moves to the existing unavailable/contact-shop state. No browser persistence or recovery endpoint is added.

## Public boundary

- Exempt only `/approve` and `/api/public/quote-approval` from authenticated middleware.
- Defense in depth lives in the public handler: strict bearer-token grammar, token-hash lookup, expiry/version/tenant checks, a bounded database rate limit that fails closed, no cache, no referrer, and no indexing.
- Invalid-token responses are deliberately indistinguishable.
- The raw token is never placed in a query string, server-rendered HTML, ordinary log, error message, analytics event, or persisted browser storage.
- The page is served `no-store`; `pagehide` synchronously clears the bearer, quote, choices, command, and receipt before a browser-history snapshot, and a persisted `pageshow` remains unavailable.
- The public API accepts JSON only for mutation and rejects unknown keys.

## Visual system

- Paper/graphite foundation, not a generic dark gradient.
- One warm signal color for the current decision; green appears only after committed approval truth and muted red only for explicit decline.
- Job cards use deliberate small-radius geometry with a straight inner rule, echoing a repair-order folder rather than consumer checkout tiles.
- Motion duration stays short and transform/opacity-only; reduced-motion users receive the same state clarity without animation.
- The final receipt uses the same layout as the decision surface so completion feels like the instrument locked, not a page replacement.
- Phone is primary; desktop remains centered and calm rather than stretching into a dashboard.

## Acceptance

The chunk is complete only when:

1. An advisor can prepare and copy one exact-version link without leaving the quote workspace.
2. A customer can open it on a phone, decide every job, see the exact selected total, and submit once.
3. A mounted shop projection revalidates on the existing 20-second cadence and visibility return, merges only exact-version approval truth, preserves local drafts/focus, and shows link-opened/waiting plus final per-job decisions without close/reopen.
4. A corrected quote makes every old link inert while preserving its immutable history.
5. Invalid, expired, superseded, replayed, cross-shop, and contended attempts disclose nothing and write no false decision.
6. Full tests, TypeScript, production build, security review, phone/desktop browser journeys, accessibility, overflow, and cleanup pass on the exact PR head.

## Rollback

The runtime is additive until release. Before production merge, remove the public exemptions/routes and advisor control if migration application cannot be proven. After migration, runtime rollback leaves dormant server-only rows and constraints; no customer decision is deleted or rewritten.
