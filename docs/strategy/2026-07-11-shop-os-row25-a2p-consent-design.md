# Shop OS Row 25 — A2P Consent, Policy, and Disclosure Design

## Outcome

Give each shop a clear, optional, provable way to obtain customer consent for transactional repair texts before Vyntechs builds or buys the SMS channel. Phone and in-person service remain complete. A customer who declines, ignores, or later revokes SMS consent must never lose access to an estimate, approval path, repair update, or shop contact.

This packet drafts product and policy language for owner approval. It is not legal advice, does not amend the published Privacy Policy or Terms, and does not authorize A2P registration, sender purchase, credentials, production messaging, or customer sends.

## Current official baseline

Checked July 11, 2026:

- Twilio classifies all traffic sent through its Messaging Services as A2P. Its current policy requires consent before messaging, proof of the date and capture method, clear sender identity, subject-matter limitation, and an accessible revocation path. For software customers messaging downstream users, Twilio requires prior express written consent.
- Twilio's current A2P campaign intake requires a verifiable opt-in flow, public Privacy Policy and Terms links, representative messages, sender identification, message frequency, message/data-rate language, and opt-out/help behavior.
- Twilio requires the first message to include a standard opt-out instruction. Its built-in or Advanced Opt-Out service can recognize standard STOP, START, and HELP events; the application must still retain its own current consent truth and must not send a duplicate automated reply after Twilio handles one.
- FCC rules require reasonable revocation methods to be honored. A one-time non-marketing confirmation is allowed, but further covered robocalls/robotexts must stop. Vyntechs adopts the stricter operational rule: suppress new automated texts immediately when a STOP or other unambiguous revocation reaches any controlled channel.
- CTIA guidance calls for a clear, conspicuous call to action that describes the type and purpose of messages and does not bury opt-in terms.

Primary references:

- [Twilio Messaging Policy](https://www.twilio.com/en-us/legal/messaging-policy) — updated April 13, 2026
- [Twilio A2P 10DLC overview](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc)
- [Twilio campaign information requirements](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/collect-business-info)
- [Twilio Advanced Opt-Out](https://www.twilio.com/docs/messaging/tutorials/advanced-opt-out)
- [Twilio webhook request validation](https://www.twilio.com/docs/usage/webhooks/webhooks-security)
- [FCC TCPA Consent Order, FCC 24-24](https://docs.fcc.gov/public/attachments/FCC-24-24A1.pdf)
- [FCC April 2025 revocation order, DA 25-312](https://docs.fcc.gov/public/attachments/DA-25-312A1.pdf)
- [CTIA Messaging Principles & Best Practices](https://www.ctia.org/the-wireless-industry/industry-commitments/messaging-interoperability-sms-mms)
- [CTIA Messaging Security Best Practices 2025](https://api.ctia.org/wp-content/uploads/2025/10/Messaging-Security-Best-Practices-_October-2025.pdf)

Carrier, provider, and legal requirements can change. Row 26 must re-check registration fields and fees before procurement; Row 35 must re-check messaging and revocation behavior before implementation.

## Product decision

V1 SMS is a **transactional repair-order channel only**. It may deliver:

- a secure estimate/approval link;
- an approval, decline, or submitted-question confirmation;
- a repair-status or pickup update that the customer requested for the active repair order; and
- required consent, HELP, or STOP confirmations.

It may not deliver promotions, coupons, review requests, win-back campaigns, newsletters, unrelated reminders, or any message whose purpose falls outside the disclosure the customer accepted. Marketing requires a separate future design, consent record, campaign registration, and owner/legal approval.

The repair shop—not Vyntechs—is the consumer-facing sender and the party obtaining consent. Every ordinary outbound message identifies the shop. Vyntechs is disclosed as the technology/data processor. Row 26 still owns the unresolved provider-registration structure for a multi-shop software platform; this design does not pretend that one Vyntechs campaign can represent every shop.

## Consent collection contract

### Allowed sources

An SMS-enabled state may be created only from one of these provable written actions:

1. the customer personally checks an initially unchecked box beside the complete disclosure on a customer-facing page or device; or
2. the customer signs a paper or electronic intake document containing the method-specific versioned disclosure.

A staff member may record where signed consent is stored, but may not check the box for the customer, infer consent from a phone number, select SMS as a preferred channel, convert verbal agreement into written consent, or silently restore consent after an opt-out. A customer's inbound one-off question permits only the direct conversational response allowed by provider policy; it does not create recurring repair-update consent. A provider-reported `START` event may remove the provider's transport block, but Vyntechs remains suppressed until the customer completes a fresh full-disclosure consent action. V1 does not treat a keyword alone as recurring-program re-consent.

### Exact checkbox copy

**Label**

> Text me repair updates from [SHOP NAME]

**Disclosure immediately beside the unchecked control**

> By checking this box, I agree to receive recurring transactional text messages from [SHOP NAME] about estimates, authorizations, repair status, and pickup for vehicles I bring to this shop. Message frequency varies by repair order. Message and data rates may apply. Reply STOP to unsubscribe or HELP for help. Consent is not a condition of purchase. See [SMS Terms] and [Privacy Policy]. Vyntechs provides the messaging technology.

The links and disclosure must be visible before the customer acts; the product must not hide them in a modal, preselect the box, bundle the choice with repair authorization, or make SMS consent necessary to continue.

### Paper/electronic staff-assisted copy

Use this method-specific disclosure, followed by:

> By signing below, I agree to receive recurring transactional text messages from [SHOP NAME] about estimates, authorizations, repair status, and pickup for vehicles I bring to this shop. Message frequency varies by repair order. Message and data rates may apply. Reply STOP to unsubscribe or HELP for help. Consent is not a condition of purchase. SMS Terms: [PUBLIC URL]. Privacy Policy: [PUBLIC URL]. Vyntechs provides the messaging technology.

Then capture:

> Mobile number: __________  Customer signature: __________  Date/time: __________

The shop retains the signed source under its approved records policy. Vyntechs stores a privacy-minimized reference and the exact disclosure version, not an employee's unsupported assertion that the customer “said yes.”

### Decline and no-decision behavior

- `Not now` and leaving the box unchecked are first-class outcomes, not errors.
- No consent may be inferred from a missing response.
- The quote page remains available by a staff-presented link/QR code, or the shop records exact-version approval by phone/in person through the existing Row 21 flow.
- The UI may later offer SMS again only in a neutral customer-facing consent surface. It must not nag after an explicit decline during the same repair order.
- An opt-out is stronger than a decline and stays suppressed across repair orders until a valid re-opt-in.

## Draft message library

Every template uses the registered shop identity. Customer name, full VIN, plate, complaint, diagnosis, price, and raw approval token never appear in Vyntechs application logs or durable `sms_log` records; the live provider necessarily receives the complete secure URL and minimum content needed for delivery. Provider-side message-content retention must be disclosed and configured under the selected provider contract before production. Links use the real Vyntechs domain, not a public URL shortener.

### Initial estimate message

> [SHOP NAME]: Your vehicle estimate is ready: [SECURE LINK]. Reply STOP to unsubscribe or HELP for help.

### Status update

> [SHOP NAME]: Your vehicle status has been updated. View details: [SECURE LINK]. Reply STOP to unsubscribe or HELP for help.

### Approval/question confirmation

> [SHOP NAME]: We received your response for this vehicle. View the current status: [SECURE LINK]. Reply STOP to unsubscribe or HELP for help.

### STOP confirmation

> [SHOP NAME]: You have opted out and will receive no more messages from this sender.

### HELP response

> [SHOP NAME]: For help with repair updates, call [SHOP PHONE]. Message and data rates may apply. Reply STOP to unsubscribe.

### START response

> [SHOP NAME]: To restart repair texts, complete the consent form at [PUBLIC CONSENT LINK] or contact [SHOP PHONE]. Reply HELP for help.

Provider `START` handling must not change Vyntechs consent to `consented`. The linked surface repeats the complete unchecked disclosure; only its customer-controlled submission creates new program consent.

### Unsupported inbound reply

> [SHOP NAME]: This number does not accept repair questions by text. Use your secure estimate page or call [SHOP PHONE]. Reply STOP to unsubscribe.

Row 35 must classify revocation before sending the unsupported-reply template. Exact normalized standalone keywords such as `stop`, `unsubscribe`, `cancel`, `end`, `quit`, and `revoke` create immediate suppression. Bounded phrase patterns that explicitly target communication—such as `do not text`, `don't message me`, `stop texting`, `remove me from texts`, or `do not contact me`—also suppress. Keyword substring matching is prohibited: “cancel my repair” is not an opt-out merely because it contains `cancel`. Only a message that reasonably expresses possible communication revocation fails toward suppression and privacy-minimized staff follow-up; ordinary replies such as “thanks” or repair questions proceed to the unsupported-reply path. Staff-recorded revocation from phone, email, or in-person requests uses the same suppression path.

Row 35 must use Twilio's built-in or Advanced Opt-Out confirmation exactly once. If Twilio already replied to STOP/START/HELP, Vyntechs records the webhook event but sends no duplicate response. Because provider-managed `START` would otherwise unblock transport, the application-level suppression remains authoritative until fresh full-disclosure consent is captured.

## Draft Row 26 campaign packet

These fields reduce procurement-time invention but remain placeholders until Row 26 confirms the provider, registered brands, public URLs, and sender structure.

**Campaign description**

> Each participating automotive repair shop sends transactional customer-care messages to its own customers who provided prior written consent. Messages deliver secure estimate and authorization links, repair-status updates, response confirmations, and pickup notices for an active repair order. The program sends no marketing, promotions, or review solicitations.

**Message flow**

> A customer opts in on a public or staff-presented customer-facing Vyntechs surface for the identified repair shop. The mobile-number field is followed by an initially unchecked “Text me repair updates from [SHOP NAME]” box and the complete disclosure in this packet, including message purpose, variable frequency, message/data rates, STOP, HELP, no-purchase condition, and public SMS Terms and Privacy links. The customer personally checks the box and submits it. A shop may alternatively retain a customer-signed paper/electronic form containing the method-specific versioned disclosure. Staff cannot opt in for a customer. After an opt-out, a START keyword alone does not restore application consent; the recipient must complete the current full-disclosure consent surface again.

**Proposed use case**

`CUSTOMER_CARE` for a standard brand, or the provider-approved low-volume equivalent. Row 26 must not select a campaign type until it has resolved whether each shop is a downstream brand and whether that type accurately covers the submitted samples.

**Representative samples**

Use the initial-estimate, status-update, and approval/question-confirmation templates above with the real registered shop name, real Vyntechs HTTPS domain, and bracketed variable values. If the production program includes a phone number or link, the filed samples must include it. The filing must not submit a marketing example “just in case.”

## Consent proof and revocation truth for Row 31

Row 31 owns physical schema, but its contract must preserve two distinct truths:

1. **Consent evidence** keyed to the shop, customer, normalized destination number, sender/program, and disclosure version. One family member's consent record must not authorize a different customer record merely because both use the same number.
2. **Suppression truth** keyed to the shop/caller identity and normalized destination number. Program/sender metadata records where revocation arrived, but suppression covers every Vyntechs automated message from that caller identity to the destination; duplicate customer records or campaigns cannot bypass STOP. If Vyntechs later adds automated voice, it must consume this same caller-level suppression. The shop remains responsible for propagating revocation to automated systems it operates outside Vyntechs.

The contract must retain:

- shop and customer identity plus the normalized destination number;
- state: never asked, declined, consented, or opted out;
- exact disclosure/program version plus a bounded immutable snapshot of the rendered shop-specific disclosure, sender/program identity, public link destinations, and its hash;
- capture method, source timestamp, and customer-controlled action;
- privacy-minimized evidence reference or provider event ID;
- the staff actor only when staff recorded a signed source;
- latest revocation timestamp, method, and provider event ID; and
- an append-only event history so a projection bug cannot erase proof or an opt-out.

Consent is scoped to one shop, one customer record, one normalized destination, and this transactional repair-update program. It may cover later repair orders for that same shop/customer/destination because the disclosure says so, but it is not transferable among customers, shops, affiliates, numbers, campaigns, or marketing purposes. Suppression is broader: a reasonable revocation blocks all Vyntechs automated texts from the matching shop/caller identity to that destination, regardless of duplicate customer rows or repair orders.

Row 35 must state the race honestly and implement a persisted send state machine: `queued → claimed → submitting → submitted`, with `cancelled` reachable from every pre-`submitting` state. The worker acquires the caller/destination suppression lock, rechecks consent, and atomically crosses into `submitting`; that commit is the submission linearization point. If revocation commits first, the worker cancels and may not call the provider. If `submitting` commits first, revocation records the send as already in flight, suppresses every later send, and allows only the one permitted confirmation. A message handed to the carrier/provider cannot be recalled and may arrive after the customer sends STOP because of network delay. A crashed `submitting` attempt is ambiguous and may not be blindly retried without reconciling a provider message identifier or an approved idempotency mechanism. Provider suppression and Vyntechs suppression are defense in depth, not substitutes for one another.

The durable record must never store a raw approval token, entire inbound message body, government identifier, payment data, or unrelated signed document. Retention and deletion periods require owner/legal approval before Row 31 ships; no packet may invent an indefinite retention promise.

## Draft public Privacy Policy amendment

Add a “Repair text messages” section before production messaging:

> If a shop customer chooses repair text messages, we process the mobile number, shop identity, repair-order messaging status, consent and opt-out records, delivery status, and a redacted template record on the shop's behalf. We use this information only to deliver transactional estimate, authorization, repair-status, and pickup messages requested for the shop relationship.
>
> We do not sell mobile information. We do not share mobile numbers, text-message opt-in data, or consent with third parties or affiliates for their marketing or promotional purposes. We disclose the minimum necessary information to messaging providers and telecommunications carriers that deliver and secure the requested messages, subject to their service-provider obligations.
>
> Message frequency varies by repair order, and message and data rates may apply. The messaging provider receives the destination mobile number, shop sender identity, minimum message content, secure approval-page URL, delivery events, and opt-out/help keywords. The secure URL contains a high-entropy credential and should not be forwarded; Vyntechs stores only its hash and redacted message templates.
>
> The shop is the sender and is responsible for presenting the approved consent disclosure. Vyntechs provides the messaging technology and maintains consent, delivery, and opt-out records on the shop's behalf. Reply STOP to a shop's message to stop messages from that sender. You can still contact the shop directly and use non-SMS approval options.
>
> A vehicle owner can ask the shop to access, correct, or delete shop-held customer information. If the shop is unavailable, email [brandon@vyntechs.com](mailto:brandon@vyntechs.com) with only the shop name, approximate message date, and last two digits of the destination number; do not email a full phone number, vehicle details, or a secure approval link. Vyntechs will coordinate a separate verified shop/customer process and will not disclose, correct, or delete customer data based on an unverified email request. Consent and revocation proof may be retained after opt-out or deletion for the separately published period required to document compliance. Delivery records and backups follow the separately published retention schedule.

Add Twilio to the subprocessor table only when Row 26 selects it and before any production number is used:

| Service | What this service does and what it sees |
|---|---|
| Twilio | Delivers transactional repair text messages and processes the destination mobile number, shop sender identity, message content, delivery events, and opt-out/help keywords. Twilio does not receive diagnostic artifacts or supplier-cost data through this channel. |

The published policy's audience section must expressly include vehicle-owner message recipients. Its retention, deletion, rights-request, and cross-border sections must be reconciled against the selected provider contract before release; adding only the table row is insufficient.

## Row 35 webhook security and ordering contract

Before any webhook field can affect consent, suppression, delivery, or customer response truth, Row 35 must:

1. validate the provider signature against the exact externally visible HTTPS URL and untouched raw request parameters/body, using a secret held only in approved secret storage;
2. map the authenticated provider account, Messaging Service, and destination sender to exactly one approved shop/caller identity before looking up a customer or ticket;
3. deduplicate the provider event/message identifier and retain provider event time plus server receipt time without trusting either as authorization;
4. process STOP/reasonable revocation as a monotonic caller/destination suppression event that wins over all earlier consent and every duplicate contact;
5. treat HELP as non-consent and START as transport unblocking only; neither clears application suppression; and
6. clear application suppression only through a later, server-committed, customer-controlled full-disclosure consent event. Transaction order—not a client timestamp or provider delivery order—decides that it follows the revocation.

Invalid signatures, unknown senders, replayed payload changes, and cross-shop mappings fail closed and generate privacy-minimized security telemetry. Raw webhook bodies, phone numbers, signatures, approval links/tokens, and message bodies never enter ordinary logs.

## Draft public Terms amendment

The current `/terms` page is a shop-user service agreement, not consumer SMS program terms. Before registration, add a separate, public, no-login shop-resolved SMS Terms route (for example, `/sms/[shopSlug]/terms`) for message recipients and link that exact stable page from the consent surface. A query string or client-supplied shop name cannot establish sender identity. Its draft content is:

> [SHOP NAME] Repair Updates is a recurring transactional text-message program for estimates, authorizations, repair status, and pickup. [SHOP NAME] is the sender; Vyntechs provides the messaging technology.
>
> For customers who opt in, message frequency varies by repair order and message and data rates may apply. Reply STOP to unsubscribe or HELP for help. Consent is not a condition of purchase. Delivery is not guaranteed. Customers may continue by phone, in person, or through another option the shop provides.
>
> Vyntechs may suppress messaging that lacks consent, follows an opt-out, violates provider or carrier rules, or threatens service integrity. Consent applies only to the identified shop and program and may not be bought, sold, rented, or transferred.

The existing shop-user Terms must separately require shops to use only approved consent, preserve its source, honor revocation, maintain sender/contact accuracy, and exclude marketing. Final consumer SMS Terms must identify the actual program/sender structure selected in Row 26 and must not promise supported carriers, delivery timing, or a registration model that has not been approved.

## Edge cases that must remain painless

- **Customer declines SMS:** staff uses the existing phone/in-person exact-version approval; no warning blocks the ticket.
- **Customer has no mobile number or uses a landline:** the UI records no usable SMS channel and stays complete.
- **Technician completes diagnostics without customer messaging:** diagnosis, story review, quote build, repair, and closeout continue under existing capability gates; consent is counter/advisor work, not a technician interruption.
- **Simple install or customer-supplied part:** the same optional transactional consent applies to that ticket; no diagnosis or AI session is required.
- **Multiple vehicles or repair orders:** consent is reusable only for the same shop, customer record, destination, and disclosed transactional program, while every send remains tied to one exact quote/version or status event.
- **Shared family phone or duplicate customer rows:** one customer's consent cannot authorize another customer's record, while one STOP suppresses every matching destination under that shop/caller identity. The message body stays generic and the secure page owns sensitive detail.
- **Number reassigned or provider reports permanent failure:** suppress future sends pending fresh customer-controlled consent; do not “repair” consent by editing the number in place.
- **STOP races a queued send:** revocation cancels `queued`/`claimed` work when it commits first. If the send crossed the persisted `submitting` linearization point first, it is honestly recorded as in flight and cannot be recalled; all later submissions remain suppressed.
- **Revocation arrives by phone, email, hosted page, or staff conversation:** staff can record it immediately, and it suppresses automated SMS without requiring the customer to text STOP.
- **Customer texts a diagnosis question:** STOP/HELP/START plumbing and a bounded redirect response do not become a two-way inbox; hosted questions remain the structured path.
- **Shop disables SMS or loses registration:** all manual approval/service paths stay available and queued sends fail closed.

## Owner decisions remaining

Approval of this packet means the quoted checkbox, message library, program scope, and draft Privacy/Terms direction may become implementation requirements. It does **not** approve published legal-page edits or provider procurement.

Before production messaging, the owner must separately approve:

1. the exact registered legal/business identity and whether shops are onboarded as downstream brands;
2. the selected sender type, provider account, campaign filing, recurring fees, and credentials;
3. a provider-accepted final frequency disclosure if “message frequency varies by repair order” is insufficient for the selected campaign;
4. final published Privacy Policy, Terms, subprocessor, retention, and deletion language, ideally after qualified counsel review; and
5. a controlled test-number validation before any real customer receives a message.

## Explicit non-goals

- no Twilio account, brand/campaign filing, sender purchase, credential, or spend
- no published legal-page edit or claim that counsel approved this draft
- no production message, real-customer test, marketing program, review request, or two-way inbox
- no schema, route, webhook, token, notification, or provider implementation
- no diagnostic-engine, topology, prompt, retrieval, corpus, or session change
