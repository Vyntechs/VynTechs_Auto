# Shop OS Row 25 — A2P Consent, Policy, and Disclosure Execution Plan

> This is a docs-only owner-approval packet. It authorizes no legal-page publication, provider registration, spend, credential, production message, customer send, or schema/runtime implementation.

## Intended change

Approve one conservative transactional-SMS program contract: exact customer opt-in copy, message templates, revocation behavior, proof requirements, draft Privacy/Terms direction, and painless non-SMS fallbacks.

## Why this is the smallest path

Rows 31–35 cannot safely design consent storage, public approval sends, or STOP/HELP behavior while sender identity, permitted message purpose, proof, and customer disclosures are ambiguous. This packet resolves those product requirements without selecting or purchasing a provider and without changing published legal pages.

## Task 1 — Owner review of customer language

1. Approve, edit, or reject the exact unchecked-box disclosure.
2. Confirm V1 is transactional repair-order messaging only and excludes marketing, review requests, promotions, and two-way SMS.
3. Approve phone/in-person/QR fallback as a complete path when SMS is declined, unavailable, or revoked.
4. Confirm a shop employee cannot infer or verbally manufacture written customer consent.

## Task 2 — Lock policy direction

1. Approve the draft Privacy Policy amendment, mobile-information non-sharing statement, and provider disclosure direction.
2. Approve a separate public, stable, shop-resolved consumer SMS Terms route plus the shop-user Terms obligations, opt-out/help/rates language, non-transferability, and shop responsibilities.
3. Choose a retention/deletion policy with qualified legal review before Row 31 implementation; do not invent indefinite retention in code.
4. Preserve the current controller/processor split: the shop is the customer-facing sender/controller; Vyntechs is its messaging technology/processor.

## Task 3 — Convert the approved packet into Row 31 contracts

1. Add failing schema/domain tests for customer/destination-scoped versioned consent proof with immutable rendered disclosure/sender/link snapshot, append-only events, caller/destination suppression truth, duplicate contacts, current projection, multi-tenant isolation, and opt-out precedence.
2. Ensure `never_asked`/`declined`/`opted_out` remain non-blocking and that only a customer-controlled full-disclosure written event creates `consented`; a provider START event alone never does.
3. Keep consent scoped to one shop, customer, destination, and transactional program; never transfer it to another customer, shop, campaign, or marketing purpose.
4. Define privacy-minimized retention and deletion behavior from the separately approved policy.

## Task 4 — Row 26 procurement gate

1. Re-check current official Twilio/carrier registration, fee, sender, and campaign requirements.
2. Decide the actual legal/business identity and ISV/downstream-shop brand structure.
3. Obtain explicit owner approval for representations, provider terms, recurring spend, number purchase, and credentials.
4. Store credentials only in approved secret storage; never write them to source, markdown, logs, ordinary JSONB, or browser payloads.

## Task 5 — Rows 35 and legal publication gates

1. Publish the owner-approved Privacy Policy, Terms, and subprocessor changes before any production messaging data reaches the provider.
2. Implement persisted `queued → claimed → submitting → submitted` truth with cancellation branches `queued → cancelled` and `claimed → cancelled`, caller/destination suppression linearization, and idempotent reasonable-revocation/STOP/START/HELP ingestion; use provider-managed confirmation exactly once and state honestly that a `submitting`/`submitted` carrier message cannot be recalled.
3. Validate webhook signatures over the exact public URL and raw request, bind provider sender to one shop, dedupe provider IDs, make revocation monotonic across out-of-order events, and ensure START/HELP never restore application consent.
4. Test only with approved provider test/sandbox resources or an owner-approved controlled number. Never send an agent-generated real-customer message.
5. Re-review official policy at build time and run legal/product/security review before production enablement.

## Verification

This docs-only row is ready for owner decision when:

- every normative provider/legal claim links to current official evidence;
- exact opt-in, first-message, STOP, HELP, START, and unsupported-reply copy is present;
- transactional scope and marketing exclusion are unambiguous;
- immutable written-proof, sender identity, consent scope, caller/destination suppression, and in-flight race semantics are explicit;
- privacy/consumer-SMS-terms/shop-terms/subprocessor drafts match the controller/processor model;
- customer, technician, and non-diagnostic fallbacks remain complete; and
- independent product/security review reports no unresolved implementation ambiguity.

Later implementation verification must include tenant/race/retry/STOP-before-send tests, provider test-number proof, published legal pages, and a fresh policy check. Real-customer messaging remains an owner-run field validation.

## Done when

The owner approves or red-lines the exact Row 25 language and policy direction, leaving Rows 26 and 31 with testable contracts and no need to infer consent, sender identity, permitted message purpose, or fallback behavior.

## Stop if

Stop for business/legal identity representation, final legal publication, retention-policy judgment, provider terms, account creation, credentials, spend, sender procurement, production enablement, or any real-customer message.
