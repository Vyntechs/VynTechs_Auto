# Current-Production Security Wave 2E: Payment Retry Integrity

**Goal:** Close `CAND-S094-001` so one real-world payment attempt produces at most one durable payment row even when the server commits and the browser loses the response.

**Architecture:** Keep a client-side UUID bound to the normalized payment intent (`ticketId`, cents, method, normalized note) across every ambiguous outcome. Rotate only after confirmed success or a changed intent. At the existing server idempotency sink, require an existing key to match the original ticket, amount, method, note, and actor before returning replay success.

## Constraints

- Preserve the existing form, button, success/error copy, append-only ledger, authorization, and exact API shape.
- Never persist the raw note or payment attempt in browser storage; the key survives only while the mounted form exists.
- Network errors, invalid response JSON, and non-success responses retain the key because commit state can be ambiguous.
- Confirmed success clears the key. A changed normalized intent receives a fresh key.
- Same key plus different content fails `conflict`; it must never silently alias two intents.
- No real payment, Stripe call, production data, schema migration, or user prompt.

## Test-first execution

- [ ] Drop the first synthetic response, retry unchanged, and prove both request bodies must reuse one UUID.
- [ ] Change amount, method, or normalized note after an ambiguous outcome and prove the next submit uses a fresh UUID.
- [ ] Prove confirmed success clears the attempt key for the next legitimate payment.
- [ ] Prove the server returns idempotent success only for exact stored truth and returns `conflict` for same-key content mismatch, including the unique-race path.
- [ ] Run ring-out component, domain, route, ticket, type, build, and diff gates.
- [ ] Record closure while keeping Row 50 `in_progress`.
